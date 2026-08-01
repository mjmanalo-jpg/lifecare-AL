"use client";

import { useMemo, useState, useEffect } from "react";
import {
  Siren, Search, RefreshCw, Plus, X, CheckCircle2, Clock, AlertTriangle,
  Eye, Loader2, ChevronLeft, ChevronRight, UserRound, ArrowUpCircle,
  Stethoscope, ClipboardList, Printer, type LucideIcon,
} from "lucide-react";

// Print a single SBAR as a clean standalone document (no page print-CSS needed).
function printEscalation(e: { residentName: string; room?: string; situation: string; background: string; assessment: string; recommendation: string; raisedBy?: string; createdAt?: string | null; response?: string }, priorityLabel: string, statusLabel: string) {
  const esc = (s: string) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  const row = (l: string, v: string) => v ? `<div class="row"><div class="l">${l}</div><div class="v">${esc(v)}</div></div>` : "";
  const w = window.open("", "_blank", "width=720,height=860");
  if (!w) return;
  w.document.write(`<html><head><title>SBAR — ${esc(e.residentName)}</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;padding:36px;color:#111;line-height:1.5}h1{font-size:20px;margin:0 0 4px}.meta{color:#555;font-size:13px;margin-bottom:18px}.row{margin:12px 0}.l{font-weight:700;color:#b91c1c;font-size:13px;text-transform:uppercase;letter-spacing:.04em}.v{white-space:pre-wrap;margin-top:2px}</style></head><body><h1>SBAR Escalation — ${esc(e.residentName)} · Room ${esc(e.room || "—")}</h1><div class="meta">Priority: ${esc(priorityLabel)} · Status: ${esc(statusLabel)} · Raised ${e.createdAt ? new Date(e.createdAt).toLocaleString() : "—"} by ${esc(e.raisedBy || "—")}</div>${row("S — Situation", e.situation)}${row("B — Background", e.background)}${row("A — Assessment", e.assessment)}${row("R — Recommendation", e.recommendation)}${e.response ? row("Physician Response", e.response) : ""}</body></html>`);
  w.document.close(); w.focus(); w.print();
}
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord } from "@/lib/api";
import { useClinician, type ClinicianRole } from "./useClinician";
import { PRIORITY_META, STATUS_PILL, STATUS_LABEL, PRIORITIES, slaState } from "./escalationMeta";

/**
 * SBAR clinical escalation — one role-aware board:
 *   • NURSE / CAREGIVER → raise an SBAR (Situation-Background-Assessment-
 *     Recommendation) on a resident and route it to the physician / on-call.
 *   • PHYSICIAN → acknowledge, respond (orders/recommendation) and resolve.
 *   • FACILITY_ADMIN → oversight of all escalations + take over breached ones.
 * Live via Supabase realtime + polling; SLA breach is computed live from a
 * ticking clock. No static data, no localStorage.
 */

type Row = Record<string, unknown>;
const asStr = (v: unknown): string => (v == null ? "" : String(v));
const rel = (v: unknown): Row => (v && typeof v === "object" ? (v as Row) : {});

const PER_PAGE = 8;
const RESPONDER_ROLES: ClinicianRole[] = ["PHYSICIAN", "FACILITY_ADMIN"];

type EscVM = {
  id: string; residentId: string; residentName: string; room: string;
  situation: string; background: string; assessment: string; recommendation: string;
  priority: string; status: string; raisedBy: string; raisedByRole: string;
  assignedToRole: string; acknowledgedBy: string; response: string;
  resolvedBy: string; resolvedAt: string; createdAt: string;
};

const adapt = (r: Row): EscVM => {
  const res = rel(r.resident);
  return {
    id: asStr(r.id), residentId: asStr(r.residentId),
    residentName: `${asStr(res.firstName)} ${asStr(res.lastName)}`.trim() || "Resident",
    room: asStr(res.roomNumber),
    situation: asStr(r.situation), background: asStr(r.background),
    assessment: asStr(r.assessment), recommendation: asStr(r.recommendation),
    priority: asStr(r.priority) || "URGENT", status: asStr(r.status) || "OPEN",
    raisedBy: asStr(r.raisedBy), raisedByRole: asStr(r.raisedByRole),
    assignedToRole: asStr(r.assignedToRole) || "PHYSICIAN",
    acknowledgedBy: asStr(r.acknowledgedBy), response: asStr(r.response),
    resolvedBy: asStr(r.resolvedBy), resolvedAt: asStr(r.resolvedAt), createdAt: asStr(r.createdAt),
  };
};

export default function EscalationsBoard({ role }: { role: ClinicianRole }) {
  const canRaise = role === "NURSE" || role === "CAREGIVER";
  const canRespond = RESPONDER_ROLES.includes(role);
  const clinician = useClinician(role);

  const { data: rows, loading, error, refetch } = useLiveQuery<Row>(
    "escalations", { query: "include=resident&take=400", tables: ["Escalation"], pollMs: 12000 }
  );
  const residentsQ = useLiveQuery<Row>("residents", { query: "take=300", tables: ["Resident"], enabled: canRaise });
  const medsQ = useLiveQuery<Row>("medications", { query: "take=500", tables: ["Medication"], enabled: canRaise });

  const [nowTs, setNowTs] = useState(0);
  useEffect(() => { const t = () => setNowTs(Date.now()); t(); const i = setInterval(t, 30_000); return () => clearInterval(i); }, []);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [showRaise, setShowRaise] = useState(false);
  const [viewing, setViewing] = useState<EscVM | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const escalations = useMemo(() => rows.map(adapt), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return escalations.filter((e) => {
      if (statusFilter === "open" && ["RESOLVED", "CANCELLED"].includes(e.status)) return false;
      if (statusFilter === "resolved" && e.status !== "RESOLVED") return false;
      if (statusFilter !== "open" && statusFilter !== "resolved" && statusFilter !== "all" && e.status !== statusFilter) return false;
      if (priorityFilter !== "all" && e.priority !== priorityFilter) return false;
      if (q && !e.residentName.toLowerCase().includes(q) && !e.situation.toLowerCase().includes(q) && !e.raisedBy.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => {
      // Breached + higher priority first, then newest.
      const rank = (e: EscVM) => (slaState(e.createdAt, e.priority, e.status, nowTs).overdue ? 0 : 1);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [escalations, search, statusFilter, priorityFilter, nowTs]);

  useEffect(() => { setPage(1); }, [search, statusFilter, priorityFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const pageClamped = Math.min(page, totalPages);
  const paginated = filtered.slice((pageClamped - 1) * PER_PAGE, pageClamped * PER_PAGE);

  const stats = useMemo(() => {
    const live = escalations.filter((e) => !["RESOLVED", "CANCELLED"].includes(e.status));
    return {
      open: live.length,
      breached: live.filter((e) => slaState(e.createdAt, e.priority, e.status, nowTs).overdue).length,
      emergency: live.filter((e) => e.priority === "EMERGENCY").length,
      resolved: escalations.filter((e) => e.status === "RESOLVED").length,
    };
  }, [escalations, nowTs]);

  const patch = async (e: EscVM, data: Record<string, unknown>, okMsg?: string) => {
    setBusyId(e.id);
    try {
      await updateRecord("escalations", e.id, data);
      await refetch();
      setViewing((v) => (v && v.id === e.id ? { ...v, ...(data as Partial<EscVM>) } : v));
      if (okMsg) Swal.fire({ title: okMsg, icon: "success", timer: 1300, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not update.", icon: "error" });
    } finally { setBusyId(null); }
  };

  const acknowledge = (e: EscVM) => patch(e, { status: "ACKNOWLEDGED", acknowledgedBy: clinician.name, acknowledgedAt: new Date().toISOString() }, "Acknowledged");

  const respondResolve = async (e: EscVM) => {
    const result = await Swal.fire({
      title: "Respond & Resolve",
      html:
        `<p style="font-size:13px;margin-bottom:8px;text-align:left">Recommendation / orders back to the care team for ${e.residentName}:</p>` +
        `<textarea id="swal-resp" class="swal2-textarea" style="height:120px" placeholder="e.g. Increase O2 to 2L, recheck vitals in 30 min, start IV fluids…">${e.response || ""}</textarea>`,
      showCancelButton: true, confirmButtonColor: "#22c55e", cancelButtonColor: "#6b7280", confirmButtonText: "Resolve",
      preConfirm: () => (document.getElementById("swal-resp") as HTMLTextAreaElement | null)?.value ?? "",
    });
    if (!result.isConfirmed) return;
    await patch(e, { status: "RESOLVED", response: String(result.value || ""), resolvedBy: clinician.name, resolvedAt: new Date().toISOString() }, "Resolved — family notified");
  };

  const escalateOnCall = (e: EscVM) => patch(e, { status: "ESCALATED", assignedToRole: "FACILITY_ADMIN" }, "Escalated to on-call");

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-1 flex items-center gap-2">
            <Siren className="w-7 h-7 text-red-500 flex-shrink-0" /> SBAR Escalations
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live</span>
            {canRaise ? "Raise a clinical concern (Situation · Background · Assessment · Recommendation)" : canRespond ? "Acknowledge, respond with orders & resolve" : "Escalation oversight & SLA monitoring"}
          </p>
        </div>
        <div className="flex items-center gap-2 self-start">
          <button onClick={() => void refetch()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          {canRaise && (
            <button onClick={() => setShowRaise(true)} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">
              <Plus className="w-4 h-4" /> New SBAR Escalation
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Open" value={stats.open} icon={ClipboardList} tone="amber" />
        <Stat label="SLA Breached" value={stats.breached} icon={AlertTriangle} tone="red" />
        <Stat label="Emergency" value={stats.emergency} icon={Siren} tone="red" />
        <Stat label="Resolved" value={stats.resolved} icon={CheckCircle2} tone="green" />
      </div>

      {/* Filters */}
      <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
        <div className="flex gap-2 flex-wrap">
          {["open", "resolved", "all"].map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition border ${statusFilter === s ? "bg-yellow-400 text-black border-yellow-400" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
              {s === "open" ? "Open" : s === "resolved" ? "Resolved" : "All"}
            </button>
          ))}
          <span className="w-px bg-gray-200 mx-1 hidden sm:block" />
          {["all", ...PRIORITIES].map((p) => (
            <button key={p} onClick={() => setPriorityFilter(p)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition border ${priorityFilter === p ? "bg-yellow-400 text-black border-yellow-400" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
              {p === "all" ? "All Priorities" : PRIORITY_META[p].label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search resident, situation, or clinician…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {/* List */}
      {loading && escalations.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">Loading escalations…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">No {statusFilter !== "all" ? statusFilter : ""} escalations.</div>
      ) : (
        <div className="space-y-2">
          {paginated.map((e) => {
            const pm = PRIORITY_META[e.priority] ?? PRIORITY_META.URGENT;
            const sla = slaState(e.createdAt, e.priority, e.status, nowTs);
            const busy = busyId === e.id;
            return (
              <div key={e.id} className={`bg-white rounded-lg border p-4 transition hover:shadow-md ${sla.overdue ? "border-red-300 ring-1 ring-red-100" : "border-gray-200 hover:border-yellow-300"}`}>
                <div className="flex items-start justify-between gap-3">
                  <button onClick={() => setViewing(e)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${pm.pill}`}>{pm.label}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_PILL[e.status] ?? "bg-gray-100 text-gray-700"}`}>{STATUS_LABEL[e.status] ?? e.status}</span>
                      {sla.overdue && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600"><Clock className="w-3 h-3" /> {sla.label}</span>}
                    </div>
                    <p className="text-sm font-semibold text-gray-900">{e.residentName} <span className="text-gray-400 font-normal">· Room {e.room || "—"}</span></p>
                    <p className="text-sm text-gray-600 line-clamp-2">{e.situation}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">Raised by {e.raisedBy || "—"} ({e.raisedByRole || "—"}) → {e.assignedToRole.replace(/_/g, " ")}</p>
                  </button>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => setViewing(e)} className="p-1.5 rounded hover:bg-blue-50 text-blue-600 transition" title="View"><Eye className="w-4 h-4" /></button>
                    {canRespond && !["RESOLVED", "CANCELLED"].includes(e.status) && (
                      busy ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" /> : (
                        <>
                          {e.status === "OPEN" && <button onClick={() => acknowledge(e)} className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition" title="Acknowledge"><CheckCircle2 className="w-3.5 h-3.5" /> Ack</button>}
                          <button onClick={() => respondResolve(e)} className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition" title="Respond & Resolve"><Stethoscope className="w-3.5 h-3.5" /> Respond</button>
                        </>
                      )
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {filtered.length > PER_PAGE && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm text-gray-600">{(pageClamped - 1) * PER_PAGE + 1}–{Math.min(pageClamped * PER_PAGE, filtered.length)} of {filtered.length}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pageClamped === 1} className="flex items-center gap-1 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition text-sm font-medium"><ChevronLeft className="w-4 h-4" /> Prev</button>
            <span className="px-3 py-2 text-sm font-medium text-gray-700">Page {pageClamped} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={pageClamped === totalPages} className="flex items-center gap-1 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition text-sm font-medium">Next <ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {/* Detail / respond modal */}
      {viewing && (() => {
        const e = viewing; const pm = PRIORITY_META[e.priority] ?? PRIORITY_META.URGENT;
        const sla = slaState(e.createdAt, e.priority, e.status, nowTs); const busy = busyId === e.id;
        const closed = ["RESOLVED", "CANCELLED"].includes(e.status);
        return (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
              <div className={`sticky top-0 text-white p-5 flex items-start justify-between gap-3 z-10 ${e.priority === "EMERGENCY" ? "bg-gradient-to-r from-red-500 to-red-600" : "bg-gradient-to-r from-blue-500 to-blue-600"}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-white/20">{pm.label}</span>
                    <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-white/20">{STATUS_LABEL[e.status] ?? e.status}</span>
                  </div>
                  <h2 className="text-lg sm:text-xl font-bold mt-1 break-words">{e.residentName} · Room {e.room || "—"}</h2>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => printEscalation(e, pm.label, STATUS_LABEL[e.status] ?? e.status)} className="p-2 hover:bg-white/20 rounded-lg transition" title="Print SBAR"><Printer className="w-5 h-5" /></button>
                  <button onClick={() => setViewing(null)} className="p-2 hover:bg-white/20 rounded-lg transition"><X className="w-6 h-6" /></button>
                </div>
              </div>
              <div className="p-6 space-y-3">
                {!closed && (
                  <div className={`rounded-lg px-3 py-2 text-sm flex items-center gap-2 ${sla.overdue ? "bg-red-50 text-red-700 border border-red-200" : "bg-gray-50 text-gray-600 border border-gray-200"}`}>
                    <Clock className="w-4 h-4 flex-shrink-0" /> {sla.label} · raised {e.createdAt ? new Date(e.createdAt).toLocaleString() : "—"}
                  </div>
                )}
                <SbarRow letter="S" label="Situation" value={e.situation} />
                <SbarRow letter="B" label="Background" value={e.background} />
                <SbarRow letter="A" label="Assessment" value={e.assessment} />
                <SbarRow letter="R" label="Recommendation" value={e.recommendation} />
                <p className="text-[11px] text-gray-400">Raised by {e.raisedBy || "—"} ({e.raisedByRole || "—"}) → {e.assignedToRole.replace(/_/g, " ")}{e.acknowledgedBy ? ` · acknowledged by ${e.acknowledgedBy}` : ""}</p>
                {e.response && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <p className="text-xs font-semibold text-green-800 mb-0.5">Physician Response{e.resolvedBy ? ` — ${e.resolvedBy}` : ""}</p>
                    <p className="text-sm text-gray-900 whitespace-pre-wrap">{e.response}</p>
                  </div>
                )}
              </div>
              {canRespond && !closed && (
                <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between gap-2 flex-wrap">
                  <button onClick={() => escalateOnCall(e)} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 bg-red-50 text-red-600 border border-red-200 font-semibold rounded-lg hover:bg-red-100 transition text-sm disabled:opacity-50"><ArrowUpCircle className="w-4 h-4" /> On-call</button>
                  <div className="flex items-center gap-2">
                    {e.status === "OPEN" && <button onClick={() => acknowledge(e)} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 bg-blue-50 text-blue-700 border border-blue-200 font-semibold rounded-lg hover:bg-blue-100 transition text-sm disabled:opacity-50"><CheckCircle2 className="w-4 h-4" /> Acknowledge</button>}
                    <button onClick={() => respondResolve(e)} disabled={busy} className="flex items-center gap-1.5 px-5 py-2 bg-gradient-to-r from-green-400 to-green-500 text-white font-semibold rounded-lg hover:shadow-lg transition text-sm disabled:opacity-50">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Stethoscope className="w-4 h-4" />} Respond & Resolve</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {showRaise && (
        <RaiseModal role={role} raisedBy={clinician.name}
          residents={residentsQ.data} meds={medsQ.data}
          onClose={() => setShowRaise(false)} onSaved={() => { void refetch(); setShowRaise(false); }} />
      )}
    </div>
  );
}

/* ── Raise SBAR modal ── */

function RaiseModal({ role, raisedBy, residents, meds, onClose, onSaved }: {
  role: ClinicianRole; raisedBy: string; residents: Row[]; meds: Row[];
  onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    residentId: "", priority: "URGENT", assignedToRole: "PHYSICIAN",
    situation: "", background: "", assessment: "", recommendation: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const valid = form.residentId && form.situation.trim();

  // AI-assisted draft: builds a Recommendation from the Situation + Assessment.
  const aiDraft = () => {
    const sit = form.situation.trim();
    const asmt = form.assessment.trim();
    if (!sit) { Swal.fire("Add a Situation first", "The draft uses the Situation and Assessment fields.", "info"); return; }
    const who = residentOpts.find((r) => r.id === form.residentId)?.name || "the resident";
    const urgent = form.priority === "EMERGENCY";
    const resp = /spo2|oxygen|breath|resp|desat/i.test(sit + asmt);
    const rec = `Request ${urgent ? "immediate" : "prompt"} physician review for ${who}.` +
      `${asmt ? ` Assessment: ${asmt}.` : ""}` +
      ` Recommend: reassess vitals now, ${resp ? "consider supplemental O₂, " : ""}monitor closely, and carry out physician orders.` +
      ` Document the response and re-escalate if there is no improvement within the SLA window.`;
    set("recommendation", rec);
  };
  const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none";
  const residentOpts = useMemo(() => residents.map((r) => ({
    id: asStr(r.id), name: `${asStr(r.firstName)} ${asStr(r.lastName)}`.trim(), room: asStr(r.roomNumber),
    allergies: asStr(r.allergies), history: asStr(r.medicalHistory),
  })).sort((a, b) => a.name.localeCompare(b.name)), [residents]);

  // Auto-prefill Background from the resident's record + active meds.
  const onPickResident = (id: string) => {
    const r = residentOpts.find((x) => x.id === id);
    const active = meds.filter((m) => asStr(m.residentId) === id && asStr(m.status) === "ACTIVE")
      .map((m) => `${asStr(m.name)} ${asStr(m.dosage)}`).slice(0, 8);
    const bg = r
      ? [r.history ? `Hx: ${r.history}` : "", r.allergies ? `Allergies: ${r.allergies}` : "", active.length ? `Active meds: ${active.join(", ")}` : ""].filter(Boolean).join("\n")
      : "";
    setForm((f) => ({ ...f, residentId: id, background: bg || f.background }));
  };

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await createRecord("escalations", {
        residentId: form.residentId,
        situation: form.situation.trim(),
        background: form.background.trim() || null,
        assessment: form.assessment.trim() || null,
        recommendation: form.recommendation.trim() || null,
        priority: form.priority,
        status: "OPEN",
        raisedBy, raisedByRole: role,
        assignedToRole: form.assignedToRole,
      });
      Swal.fire({ title: "Escalation Sent", text: `Routed to the ${form.assignedToRole.replace(/_/g, " ").toLowerCase()} — they've been notified.`, icon: "success", timer: 1900, showConfirmButton: false });
      onSaved();
    } catch (err) {
      setSaving(false);
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not send escalation.", icon: "error" });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-red-500 to-red-600 text-white p-5 flex items-center justify-between z-10">
          <h2 className="text-xl font-bold flex items-center gap-2"><Siren className="w-6 h-6" /> New SBAR Escalation</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <label className="block text-sm font-semibold text-gray-700 mb-1 flex items-center gap-1"><UserRound className="w-3.5 h-3.5" /> Resident <span className="text-red-500">*</span></label>
              <select value={form.residentId} onChange={(e) => onPickResident(e.target.value)} className={`${inputCls} bg-white`}>
                <option value="">Select…</option>
                {residentOpts.map((r) => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Priority</label>
              <select value={form.priority} onChange={(e) => set("priority", e.target.value)} className={`${inputCls} bg-white`}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label} (SLA {PRIORITY_META[p].slaMin}m)</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Route to</label>
              <select value={form.assignedToRole} onChange={(e) => set("assignedToRole", e.target.value)} className={`${inputCls} bg-white`}>
                <option value="PHYSICIAN">Physician</option>
                <option value="FACILITY_ADMIN">On-call (Facility Admin)</option>
              </select>
            </div>
          </div>
          <SbarField letter="S" label="Situation" required value={form.situation} onChange={(v) => set("situation", v)} placeholder="What is happening right now? e.g. Sudden SpO2 drop to 88%, laboured breathing." />
          <SbarField letter="B" label="Background" value={form.background} onChange={(v) => set("background", v)} placeholder="Relevant history (auto-filled from the record — edit as needed)." />
          <SbarField letter="A" label="Assessment" value={form.assessment} onChange={(v) => set("assessment", v)} placeholder="Your clinical read. e.g. Possible respiratory distress; vitals trending down." />
          <div className="flex justify-end -mb-2">
            <button type="button" onClick={aiDraft} className="text-xs font-semibold text-indigo-600 hover:underline flex items-center gap-1">⚡ AI draft recommendation</button>
          </div>
          <SbarField letter="R" label="Recommendation" value={form.recommendation} onChange={(v) => set("recommendation", v)} placeholder="What you're asking for. e.g. Please review now; consider O2 + orders." />
        </div>
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
          <button onClick={onClose} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition text-sm">Cancel</button>
          <button onClick={() => void submit()} disabled={!valid || saving} className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50 text-sm">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Siren className="w-4 h-4" />} {saving ? "Sending…" : "Send Escalation"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SbarField({ letter, label, value, onChange, placeholder, required }: { letter: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1"><span className="inline-flex items-center justify-center w-5 h-5 rounded bg-red-100 text-red-700 text-xs font-bold mr-1.5">{letter}</span>{label}{required && <span className="text-red-500"> *</span>}</label>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} placeholder={placeholder} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none resize-y" />
    </div>
  );
}

function SbarRow({ letter, label, value }: { letter: string; label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-red-100 text-red-700 text-xs font-bold flex-shrink-0 mt-0.5">{letter}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
        <p className="text-sm text-gray-900 whitespace-pre-wrap">{value}</p>
      </div>
    </div>
  );
}

const TONES: Record<string, { wrap: string; icon: string; value: string }> = {
  amber: { wrap: "bg-amber-50 border-amber-200", icon: "text-amber-500", value: "text-amber-600" },
  red: { wrap: "bg-red-50 border-red-200", icon: "text-red-500", value: "text-red-600" },
  green: { wrap: "bg-green-50 border-green-200", icon: "text-green-500", value: "text-green-600" },
};
function Stat({ label, value, icon: Icon, tone }: { label: string; value: number; icon: LucideIcon; tone: keyof typeof TONES }) {
  const t = TONES[tone];
  return (
    <div className={`p-4 rounded-lg border ${t.wrap}`}>
      <div className="flex items-center justify-between"><p className="text-xs sm:text-sm text-gray-600 font-semibold">{label}</p><Icon className={`w-4 h-4 ${t.icon}`} /></div>
      <p className={`text-2xl sm:text-3xl font-bold mt-1 ${t.value}`}>{value}</p>
    </div>
  );
}
