"use client";

import { useMemo, useState, useEffect } from "react";
import {
  Siren, Search, RefreshCw, Plus, X, CheckCircle2, Clock, AlertTriangle,
  Eye, Loader2, ChevronLeft, ChevronRight, UserRound, ArrowUpCircle,
  Stethoscope, ClipboardList, Printer, Link2, type LucideIcon,
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
import { PRIORITY_META, STATUS_LABEL, PRIORITIES, slaState } from "./escalationMeta";
import { StatusPill, MicroLabel, ClinicalHeader, ClinicalCard } from "./clinical-ui";

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

  // Close the loop: record the physician communication that resulted from this
  // SBAR and link it back (relatedEscalationId) — one record, full clinical context.
  const logPhysicianComm = async (e: EscVM) => {
    const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string));
    const result = await Swal.fire({
      title: "Log physician communication",
      html:
        `<input id="pc-phys" class="swal2-input" placeholder="Physician name (e.g. Dr. Reyes)">` +
        `<select id="pc-method" class="swal2-select" style="display:block;width:80%;margin:0.5em auto">` +
          `<option value="PHONE">Phone Call</option><option value="IN_PERSON">In-Person Visit</option><option value="WRITTEN">Written</option><option value="TELEMEDICINE">Telemedicine</option>` +
        `</select>` +
        `<textarea id="pc-instr" class="swal2-textarea" placeholder="Instructions received (verbatim)">${esc(e.response || "")}</textarea>`,
      showCancelButton: true, confirmButtonText: "Save & link", confirmButtonColor: "#2E4A48",
      preConfirm: () => {
        const phys = (document.getElementById("pc-phys") as HTMLInputElement | null)?.value.trim() || "";
        const method = (document.getElementById("pc-method") as HTMLSelectElement | null)?.value || "PHONE";
        const instr = (document.getElementById("pc-instr") as HTMLTextAreaElement | null)?.value.trim() || "";
        if (!phys) { Swal.showValidationMessage("Physician name is required"); return false; }
        if (!instr) { Swal.showValidationMessage("Instructions received is required"); return false; }
        return { phys, method, instr };
      },
    });
    if (!result.isConfirmed || !result.value) return;
    const v = result.value as { phys: string; method: string; instr: string };
    try {
      await createRecord("physician-communications", {
        residentId: e.residentId, method: v.method, physicianName: v.phys,
        reason: e.situation || "SBAR escalation follow-up", instructionsReceived: v.instr,
        loggedById: clinician.userId || null, loggedByName: clinician.name,
        relatedEscalationId: e.id, occurredAt: new Date().toISOString(),
      });
      Swal.fire({ title: "Logged & linked", text: "Physician communication recorded and linked to this SBAR.", icon: "success", timer: 1800, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not save.", icon: "error" });
    }
  };

  return (
    <div className="-m-4 sm:-m-6 p-4 sm:p-6 min-h-full space-y-6" style={{ background: "#FFFFFF" }}>
      <ClinicalHeader
        eyebrow="SBAR Clinical Escalation"
        title="SBAR Escalations"
        subtitle={canRaise ? "Raise a clinical concern (Situation · Background · Assessment · Recommendation)" : canRespond ? "Acknowledge, respond with orders & resolve" : "Escalation oversight & SLA monitoring"}
        right={
          <div className="flex items-center gap-2 self-start">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#7E9B6F] mr-1"><span className="w-2 h-2 rounded-full bg-[#7E9B6F] animate-pulse" /> Live</span>
            <button onClick={() => void refetch()} className="flex items-center gap-2 px-3 py-2 bg-white border border-[#D6D8CD] rounded-lg text-[#2B2B27] hover:bg-[#F3F4EE] transition text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#2E4A48]/30">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
            {canRaise && (
              <button onClick={() => setShowRaise(true)} className="flex items-center gap-2 px-4 py-2 bg-[#2E4A48] hover:bg-[#25403D] text-white font-semibold rounded-lg transition active:scale-95 text-sm focus:outline-none focus:ring-2 focus:ring-[#2E4A48]/30">
                <Plus className="w-4 h-4" /> New SBAR Escalation
              </button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Open" value={stats.open} icon={ClipboardList} tone="amber" />
        <Stat label="SLA Breached" value={stats.breached} icon={AlertTriangle} tone="coral" />
        <Stat label="Emergency" value={stats.emergency} icon={Siren} tone="coral" />
        <Stat label="Resolved" value={stats.resolved} icon={CheckCircle2} tone="green" />
      </div>

      {/* Filters */}
      <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
        <div className="flex gap-2 flex-wrap">
          {["open", "resolved", "all"].map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition border focus:outline-none focus:ring-2 focus:ring-[#2E4A48]/30 ${statusFilter === s ? "bg-[#2E4A48] text-white border-[#2E4A48]" : "bg-white text-[#6B6E63] border-[#D6D8CD] hover:bg-[#F3F4EE]"}`}>
              {s === "open" ? "Open" : s === "resolved" ? "Resolved" : "All"}
            </button>
          ))}
          <span className="w-px bg-[#D6D8CD] mx-1 hidden sm:block" />
          {["all", ...PRIORITIES].map((p) => (
            <button key={p} onClick={() => setPriorityFilter(p)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition border focus:outline-none focus:ring-2 focus:ring-[#2E4A48]/30 ${priorityFilter === p ? "bg-[#2E4A48] text-white border-[#2E4A48]" : "bg-white text-[#6B6E63] border-[#D6D8CD] hover:bg-[#F3F4EE]"}`}>
              {p === "all" ? "All Priorities" : PRIORITY_META[p].label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-3 w-4 h-4 text-[#8A8D82]" />
          <input type="text" placeholder="Search resident, situation, or clinician…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-[#D6D8CD] rounded-lg text-sm text-[#2B2B27] focus:outline-none focus:ring-2 focus:ring-[#2E4A48]/30" />
        </div>
      </div>

      {error && <div className="bg-[#C0573F]/[0.06] border border-[#C0573F]/30 text-[#C0573F] rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {/* List */}
      {loading && escalations.length === 0 ? (
        <ClinicalCard className="p-10 text-center text-[#8A8D82]">Loading escalations…</ClinicalCard>
      ) : filtered.length === 0 ? (
        <ClinicalCard className="p-10 text-center text-[#8A8D82]">No {statusFilter !== "all" ? statusFilter : ""} escalations.</ClinicalCard>
      ) : (
        <div className="space-y-2">
          {paginated.map((e) => {
            const pm = PRIORITY_META[e.priority] ?? PRIORITY_META.URGENT;
            const sla = slaState(e.createdAt, e.priority, e.status, nowTs);
            const busy = busyId === e.id;
            const alarm = sla.overdue || e.priority === "EMERGENCY";
            return (
              <ClinicalCard key={e.id} top={alarm ? "coral" : "teal"} className="p-4 transition hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <button onClick={() => setViewing(e)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <StatusPill status={e.priority}>{pm.label}</StatusPill>
                      <StatusPill status={e.status}>{STATUS_LABEL[e.status] ?? e.status}</StatusPill>
                      {sla.overdue && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#C0573F]"><Clock className="w-3 h-3" /> {sla.label}</span>}
                    </div>
                    <p className="text-sm font-semibold text-[#2B2B27]">{e.residentName} <span className="text-[#8A8D82] font-normal">· Room {e.room || "—"}</span></p>
                    <p className="text-sm text-[#6B6E63] line-clamp-2">{e.situation}</p>
                    <p className="text-[11px] text-[#8A8D82] mt-0.5">Raised by {e.raisedBy || "—"} ({e.raisedByRole || "—"}) → {e.assignedToRole.replace(/_/g, " ")}</p>
                  </button>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => setViewing(e)} className="p-1.5 rounded hover:bg-[#2E4A48]/10 text-[#2E4A48] transition" title="View"><Eye className="w-4 h-4" /></button>
                    {canRespond && !["RESOLVED", "CANCELLED"].includes(e.status) && (
                      busy ? <Loader2 className="w-4 h-4 text-[#8A8D82] animate-spin" /> : (
                        <>
                          {e.status === "OPEN" && <button onClick={() => acknowledge(e)} className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-white text-[#2E4A48] border border-[#2E4A48]/30 rounded-lg hover:bg-[#2E4A48]/10 transition" title="Acknowledge"><CheckCircle2 className="w-3.5 h-3.5" /> Ack</button>}
                          <button onClick={() => respondResolve(e)} className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-[#2E4A48] text-white rounded-lg hover:bg-[#25403D] transition" title="Respond & Resolve"><Stethoscope className="w-3.5 h-3.5" /> Respond</button>
                        </>
                      )
                    )}
                  </div>
                </div>
              </ClinicalCard>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {filtered.length > PER_PAGE && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm text-[#6B6E63]">{(pageClamped - 1) * PER_PAGE + 1}–{Math.min(pageClamped * PER_PAGE, filtered.length)} of {filtered.length}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pageClamped === 1} className="flex items-center gap-1 px-3 py-2 bg-white border border-[#D6D8CD] rounded-lg text-[#2B2B27] hover:bg-[#F3F4EE] disabled:opacity-50 transition text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#2E4A48]/30"><ChevronLeft className="w-4 h-4" /> Prev</button>
            <span className="px-3 py-2 text-sm font-medium text-[#2B2B27]">Page {pageClamped} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={pageClamped === totalPages} className="flex items-center gap-1 px-3 py-2 bg-white border border-[#D6D8CD] rounded-lg text-[#2B2B27] hover:bg-[#F3F4EE] disabled:opacity-50 transition text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#2E4A48]/30">Next <ChevronRight className="w-4 h-4" /></button>
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
              <div className={`sticky top-0 text-white p-5 flex items-start justify-between gap-3 z-10 ${e.priority === "EMERGENCY" ? "bg-[#C0573F]" : "bg-[#2E4A48]"}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-[0.05em] bg-white/20">{pm.label}</span>
                    <span className="px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-[0.05em] bg-white/20">{STATUS_LABEL[e.status] ?? e.status}</span>
                  </div>
                  <h2 className="text-lg sm:text-xl font-bold mt-1 break-words" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>{e.residentName} · Room {e.room || "—"}</h2>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => printEscalation(e, pm.label, STATUS_LABEL[e.status] ?? e.status)} className="p-2 hover:bg-white/20 rounded-lg transition" title="Print SBAR"><Printer className="w-5 h-5" /></button>
                  <button onClick={() => setViewing(null)} className="p-2 hover:bg-white/20 rounded-lg transition"><X className="w-6 h-6" /></button>
                </div>
              </div>
              <div className="p-6 space-y-3">
                {!closed && (
                  <div className={`rounded-lg px-3 py-2 text-sm flex items-center gap-2 ${sla.overdue ? "bg-[#C0573F]/[0.06] text-[#C0573F] border border-[#C0573F]/30" : "bg-[#F3F4EE] text-[#6B6E63] border border-[#E1E3D9]"}`}>
                    <Clock className="w-4 h-4 flex-shrink-0" /> {sla.label} · raised {e.createdAt ? new Date(e.createdAt).toLocaleString() : "—"}
                  </div>
                )}
                <StatusStepper status={e.status} />
                <div className="space-y-0">
                  <SbarRow letter="S" label="Situation" value={e.situation} />
                  <SbarRow letter="B" label="Background" value={e.background} />
                  <SbarRow letter="A" label="Assessment" value={e.assessment} />
                  <SbarRow letter="R" label="Recommendation" value={e.recommendation} letterTone="coral" />
                </div>
                <p className="text-[11px] text-[#8A8D82]">Raised by {e.raisedBy || "—"} ({e.raisedByRole || "—"}) → {e.assignedToRole.replace(/_/g, " ")}{e.acknowledgedBy ? ` · acknowledged by ${e.acknowledgedBy}` : ""}</p>
                {e.response && (
                  <div className="bg-[#7E9B6F]/[0.1] border border-[#7E9B6F]/40 rounded-lg p-3">
                    <MicroLabel className="!text-[#5E7A50] mb-0.5">Physician Response{e.resolvedBy ? ` — ${e.resolvedBy}` : ""}</MicroLabel>
                    <p className="text-sm text-[#2B2B27] whitespace-pre-wrap">{e.response}</p>
                  </div>
                )}
                <button onClick={() => logPhysicianComm(e)} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white text-[#2E4A48] border border-[#2E4A48]/30 font-semibold rounded-lg hover:bg-[#2E4A48]/[0.06] transition text-sm">
                  <Link2 className="w-4 h-4 text-[#C0573F]" /> Log physician communication
                </button>
              </div>
              {canRespond && !closed && (
                <div className="sticky bottom-0 bg-[#F3F4EE] border-t border-[#E1E3D9] px-6 py-4 flex items-center justify-between gap-2 flex-wrap">
                  <button onClick={() => escalateOnCall(e)} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 bg-white text-[#C0573F] border border-[#C0573F]/30 font-semibold rounded-lg hover:bg-[#C0573F]/[0.06] transition text-sm disabled:opacity-50"><ArrowUpCircle className="w-4 h-4" /> On-call</button>
                  <div className="flex items-center gap-2">
                    {e.status === "OPEN" && <button onClick={() => acknowledge(e)} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 bg-white text-[#2E4A48] border border-[#2E4A48]/30 font-semibold rounded-lg hover:bg-[#2E4A48]/10 transition text-sm disabled:opacity-50"><CheckCircle2 className="w-4 h-4" /> Acknowledge</button>}
                    <button onClick={() => respondResolve(e)} disabled={busy} className="flex items-center gap-1.5 px-5 py-2 bg-[#2E4A48] hover:bg-[#25403D] text-white font-semibold rounded-lg transition text-sm disabled:opacity-50">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Stethoscope className="w-4 h-4" />} Respond & Resolve</button>
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
  const [drafting, setDrafting] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const valid = form.residentId && form.situation.trim();

  // Offline fallback draft, used when no Gemini key is configured or the call fails.
  const templateDraft = () => {
    const urgent = form.priority === "EMERGENCY";
    const resp = /spo2|oxygen|breath|resp|desat/i.test(form.situation + form.assessment);
    return `${urgent ? "Escalate immediately. " : ""}Reassess vitals now, ${resp ? "consider supplemental O₂, " : ""}monitor closely, and carry out physician orders. Document the response and re-escalate if there is no improvement within the SLA window.`;
  };

  // AI-assisted draft: asks Gemini for the Recommendation (the "R" of SBAR) from
  // the Situation / Background / Assessment; falls back to the template offline.
  const aiDraft = async () => {
    const sit = form.situation.trim();
    if (!sit) { Swal.fire("Add a Situation first", "The draft uses the Situation and Assessment fields.", "info"); return; }
    setDrafting(true);
    try {
      const resName = residentOpts.find((r) => r.id === form.residentId)?.name || "the resident";
      const res = await fetch("/api/ai-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sbar", situation: sit, background: form.background.trim(), assessment: form.assessment.trim(), priority: form.priority, resident: resName }),
      });
      const data = await res.json().catch(() => ({}));
      set("recommendation", res.ok && data?.recommendation ? String(data.recommendation).trim() : templateDraft());
    } catch {
      set("recommendation", templateDraft());
    } finally {
      setDrafting(false);
    }
  };
  const inputCls = "w-full px-3 py-2 bg-white border border-[#D6D8CD] rounded-lg text-sm text-[#2B2B27] focus:outline-none focus:ring-2 focus:ring-[#2E4A48]/30";
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
        <div className="sticky top-0 bg-[#C0573F] text-white p-5 flex items-center justify-between z-10">
          <h2 className="text-xl font-bold flex items-center gap-2" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}><Siren className="w-6 h-6" /> New SBAR Escalation</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <label className="text-sm font-semibold text-[#2B2B27] mb-1 flex items-center gap-1"><UserRound className="w-3.5 h-3.5" /> Resident <span className="text-[#C0573F]">*</span></label>
              <select value={form.residentId} onChange={(e) => onPickResident(e.target.value)} className={inputCls}>
                <option value="">Select…</option>
                {residentOpts.map((r) => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#2B2B27] mb-1">Priority</label>
              <select value={form.priority} onChange={(e) => set("priority", e.target.value)} className={inputCls}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label} (SLA {PRIORITY_META[p].slaMin}m)</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#2B2B27] mb-1">Route to</label>
              <select value={form.assignedToRole} onChange={(e) => set("assignedToRole", e.target.value)} className={inputCls}>
                <option value="PHYSICIAN">Physician</option>
                <option value="FACILITY_ADMIN">On-call (Facility Admin)</option>
              </select>
            </div>
          </div>
          <SbarField letter="S" label="Situation" required value={form.situation} onChange={(v) => set("situation", v)} placeholder="What is happening right now? e.g. Sudden SpO2 drop to 88%, laboured breathing." />
          <SbarField letter="B" label="Background" value={form.background} onChange={(v) => set("background", v)} placeholder="Relevant history (auto-filled from the record — edit as needed)." />
          <SbarField letter="A" label="Assessment" value={form.assessment} onChange={(v) => set("assessment", v)} placeholder="Your clinical read. e.g. Possible respiratory distress; vitals trending down." />
          <div className="flex justify-end -mb-2">
            <button type="button" onClick={aiDraft} disabled={drafting} className="text-xs font-semibold text-[#2E4A48] hover:underline flex items-center gap-1 disabled:opacity-60">
              {drafting ? <><Loader2 className="w-3 h-3 animate-spin" /> Drafting…</> : <>⚡ AI draft recommendation</>}
            </button>
          </div>
          <SbarField letter="R" label="Recommendation" value={form.recommendation} onChange={(v) => set("recommendation", v)} placeholder="What you're asking for. e.g. Please review now; consider O2 + orders." />
        </div>
        <div className="sticky bottom-0 bg-[#F3F4EE] border-t border-[#E1E3D9] px-6 py-4 flex items-center justify-between">
          <button onClick={onClose} className="px-5 py-2 text-[#6B6E63] hover:bg-[#E8E9E1] rounded-lg transition text-sm">Cancel</button>
          <button onClick={() => void submit()} disabled={!valid || saving} className="flex items-center gap-2 px-6 py-2 bg-[#C0573F] hover:bg-[#A94832] text-white font-semibold rounded-lg transition disabled:opacity-50 text-sm">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Siren className="w-4 h-4" />} {saving ? "Sending…" : "Send Escalation"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SbarField({ letter, label, value, onChange, placeholder, required }: { letter: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean }) {
  const coral = letter === "R";
  return (
    <div>
      <label className="block text-sm font-semibold text-[#2B2B27] mb-1"><span className={`inline-flex items-center justify-center w-5 h-5 rounded text-white text-xs font-bold mr-1.5 ${coral ? "bg-[#C0573F]" : "bg-[#2E4A48]"}`} style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>{letter}</span>{label}{required && <span className="text-[#C0573F]"> *</span>}</label>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} placeholder={placeholder} className="w-full px-3 py-2 bg-white border border-[#D6D8CD] rounded-lg text-sm text-[#2B2B27] focus:outline-none focus:ring-2 focus:ring-[#2E4A48]/30 resize-y" />
    </div>
  );
}

function SbarRow({ letter, label, value, letterTone }: { letter: string; label: string; value: string; letterTone?: "teal" | "coral" }) {
  if (!value) return null;
  const coral = letterTone === "coral";
  return (
    <div className={`flex gap-3 border-t border-[#EBEDE4] pt-3 mt-3 first:border-t-0 first:mt-0 first:pt-0 ${coral ? "bg-[#C0573F]/[0.04] -mx-2 px-2 rounded" : ""}`}>
      <span className={`inline-flex items-center justify-center w-11 h-11 rounded text-white text-xl font-bold flex-shrink-0 ${coral ? "bg-[#C0573F]" : "bg-[#2E4A48]"}`} style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>{letter}</span>
      <div className="min-w-0 pt-0.5">
        <MicroLabel className={coral ? "!text-[#C0573F]" : ""}>{label}</MicroLabel>
        <p className="text-sm text-[#2B2B27] whitespace-pre-wrap mt-0.5">{value}</p>
      </div>
    </div>
  );
}

/* Compact 3-step lifecycle: OPEN → RESPONDED/ACKNOWLEDGED → CLOSED/RESOLVED. */
function StatusStepper({ status }: { status: string }) {
  const isResponded = ["ACKNOWLEDGED", "IN_PROGRESS", "ESCALATED", "RESOLVED"].includes(status);
  const isClosed = ["RESOLVED", "CANCELLED"].includes(status);
  const steps = [
    { key: "open", active: status === "OPEN", block: "bg-[#C39A3E]", Icon: Clock, title: "Open", sub: "Awaiting response" },
    { key: "responded", active: isResponded && !isClosed, block: "bg-[#2E4A48]", Icon: Stethoscope, title: "Responded", sub: "Response recorded" },
    { key: "closed", active: isClosed, block: "bg-[#7E9B6F]", Icon: CheckCircle2, title: "Closed", sub: "Issue resolved" },
  ];
  return (
    <div className="flex items-stretch gap-1">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1 flex-1">
          <div className={`flex-1 flex items-center gap-2 rounded-lg px-2.5 py-2 ${s.active ? "" : "opacity-40"}`}>
            <span className={`inline-flex items-center justify-center w-8 h-8 rounded ${s.block} text-white flex-shrink-0`}><s.Icon className="w-4 h-4" /></span>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#2B2B27] leading-tight">{s.title}</p>
              <p className="text-[10px] text-[#8A8D82] leading-tight truncate">{s.sub}</p>
            </div>
          </div>
          {i < steps.length - 1 && <ChevronRight className="w-4 h-4 text-[#8A8D82] flex-shrink-0" />}
        </div>
      ))}
    </div>
  );
}

const TONES: Record<string, { color: string; top: "amber" | "coral" | "green" }> = {
  amber: { color: "#C39A3E", top: "amber" },
  coral: { color: "#C0573F", top: "coral" },
  green: { color: "#7E9B6F", top: "green" },
};
function Stat({ label, value, icon: Icon, tone }: { label: string; value: number; icon: LucideIcon; tone: keyof typeof TONES }) {
  const t = TONES[tone];
  return (
    <ClinicalCard top={t.top} className="p-4">
      <div className="flex items-center justify-between"><MicroLabel>{label}</MicroLabel><Icon className="w-4 h-4" style={{ color: t.color }} /></div>
      <p className="text-2xl sm:text-3xl font-bold mt-1" style={{ color: t.color, fontFamily: "Georgia, 'Times New Roman', serif" }}>{value}</p>
    </ClinicalCard>
  );
}
