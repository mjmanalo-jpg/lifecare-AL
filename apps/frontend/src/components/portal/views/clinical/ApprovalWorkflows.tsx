"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, X, Clock, Pill, CalendarClock, TestTube, ClipboardList, Plus, Loader2, User } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord, upsertRecord } from "@/lib/api";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const rname = (o: Row) => { const r = (o.resident ?? {}) as Row; return `${s(r.firstName)} ${s(r.lastName)}`.trim() || "—"; };
const rroom = (o: Row) => s((o.resident as Row)?.roomNumber) || "";
const fmt = (v: unknown) => { const d = new Date(s(v)); return isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); };
const pickApptDate = (m: Row) => m.appointmentDate || m.scheduledDate || m.scheduledAt || m.preferredDate || m.date || m.createdAt;

// Lab-order approvals are stored migration-free (LabResult has no approval column):
// an app-setting map { [labResultId]: { decision, by, at, reason } }.
const LAB_DECISIONS_KEY = "lab_order_decisions";
type LabDecision = { decision: "APPROVED" | "REJECTED"; by: string; at: string; reason?: string };

type Kind = "appointment" | "med" | "lab";
type Item = { kind: Kind; id: string; row: Row; state: "PENDING" | "APPROVED" | "REJECTED"; when: number };

const KIND_META: Record<Kind, { label: string; Icon: typeof Pill; tint: string; ring: string }> = {
  appointment: { label: "Medical Appointment", Icon: CalendarClock, tint: "bg-blue-50 text-blue-600", ring: "border-blue-200" },
  med: { label: "Medication", Icon: Pill, tint: "bg-purple-50 text-purple-600", ring: "border-purple-200" },
  lab: { label: "Lab Order", Icon: TestTube, tint: "bg-amber-50 text-amber-600", ring: "border-amber-200" },
};

/**
 * Pending Approvals — the single review queue where the Care Manager / Administrator
 * signs off on requests raised by staff before they go active:
 *   • Appointments (hospital referrals)  — REQUESTED → APPROVED / CANCELLED
 *   • Medications  (new prescriptions)   — PENDING   → ACTIVE / DISCONTINUED
 *   • Lab orders   (lab results ordered) — ORDERED   → APPROVED / REJECTED (app-setting map)
 * Every decision records a reviewer + timestamp and notifies the submitter.
 */
export default function ApprovalWorkflows() {
  const { data: meds, refetch: refetchMeds } = useLiveQuery<Row>("medications", { query: "include=resident&take=400", tables: ["Medication", "Resident"] });
  const { data: referrals, refetch: refetchRefs } = useLiveQuery<Row>("hospital-referrals", { query: "include=resident&take=400", tables: ["HospitalReferral"] });
  const { data: labs, refetch: refetchLabs } = useLiveQuery<Row>("lab-results", { query: "include=resident&take=400", tables: ["LabResult", "Resident"] });
  const settingsQ = useLiveQuery<Row>("app-settings", { tables: ["AppSetting"] });

  const [session, setSession] = useState<{ id: string | null; name: string | null; role: string | null }>({ id: null, name: null, role: null });
  useEffect(() => { fetch("/api/auth/session").then((r) => r.json()).then((d) => { if (d?.authenticated) setSession({ id: d.session?.userId ?? null, name: d.session?.name ?? d.session?.role ?? "Care Manager", role: d.session?.role ?? null }); }).catch(() => {}); }, []);
  const canDecide = session.role === "FACILITY_ADMIN" || session.role === "SUPERADMIN" || session.role === "CARE_MANAGER";
  // Nurses manage the appointment schedule too, so they can approve/reject
  // appointments (medications & lab orders stay Care-Manager / Admin only).
  const canDecideAppointment = canDecide || session.role === "NURSE";
  const canAct = (kind: Kind) => (kind === "appointment" ? canDecideAppointment : canDecide);

  const [tab, setTab] = useState<"pending" | "all">("pending");

  // Lab-order decision map (migration-free).
  const labDecisions = useMemo<Record<string, LabDecision>>(() => {
    const row = (settingsQ.data || []).find((r) => s(r.key || r.id) === LAB_DECISIONS_KEY);
    try { return row ? (JSON.parse(s(row.value)) as Record<string, LabDecision>) : {}; } catch { return {}; }
  }, [settingsQ.data]);

  // Residents for the "Request Meds" submission form (non-deciders).
  const { data: residentRows } = useLiveQuery<Row>("residents", { query: "take=300", tables: ["Resident"] });
  const residents = useMemo(() => residentRows.map((r) => ({ id: s(r.id), name: `${s(r.firstName)} ${s(r.lastName)}`.trim() || "—", room: s(r.roomNumber) })), [residentRows]);
  const [showRequest, setShowRequest] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reqForm, setReqForm] = useState({ residentId: "", name: "", dosage: "", route: "ORAL", frequency: "", reason: "" });
  const setReq = (k: string, v: string) => setReqForm((f) => ({ ...f, [k]: v }));

  const submitRequest = async () => {
    if (!reqForm.residentId || !reqForm.name.trim() || !reqForm.dosage.trim() || !reqForm.frequency.trim()) { Swal.fire("Missing fields", "Resident, medication name, dosage, and frequency are all required.", "warning"); return; }
    setSaving(true);
    try {
      await createRecord("medications", {
        residentId: reqForm.residentId, name: reqForm.name.trim(), dosage: reqForm.dosage.trim(),
        route: reqForm.route, frequency: reqForm.frequency.trim(), reason: reqForm.reason.trim() || null,
        startDate: new Date().toISOString(),
        status: "PENDING", submittedById: session.id, submittedByName: session.name,
      });
      await refetchMeds();
      setShowRequest(false);
      setReqForm({ residentId: "", name: "", dosage: "", route: "ORAL", frequency: "", reason: "" });
      Swal.fire({ title: "Request submitted", text: "Sent for Care Manager approval.", icon: "success", timer: 1600, showConfirmButton: false });
    } catch (e) { Swal.fire("Failed", e instanceof Error ? e.message : "Could not submit the request.", "error"); }
    finally { setSaving(false); }
  };

  // ── Build the unified item list ──────────────────────────────────────────
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const row of referrals) {
      const st = s(row.status);
      const state = row.approvedAt ? "APPROVED" : (row.rejectionReason && st === "CANCELLED") ? "REJECTED" : st === "REQUESTED" ? "PENDING" : null;
      if (state) out.push({ kind: "appointment", id: s(row.id), row, state, when: new Date(s(row.updatedAt || row.createdAt)).getTime() || 0 });
    }
    for (const row of meds) {
      const st = s(row.status);
      const state = row.approvedAt ? "APPROVED" : (row.rejectionReason && st === "DISCONTINUED") ? "REJECTED" : st === "PENDING" ? "PENDING" : null;
      if (state) out.push({ kind: "med", id: s(row.id), row, state, when: new Date(s(row.updatedAt || row.createdAt)).getTime() || 0 });
    }
    for (const row of labs) {
      const st = s(row.status).toUpperCase();
      if (st !== "ORDERED" && st !== "PENDING" && st !== "REQUESTED") continue; // only lab orders awaiting sign-off
      const dec = labDecisions[s(row.id)];
      const state = dec ? (dec.decision === "APPROVED" ? "APPROVED" : "REJECTED") : "PENDING";
      out.push({ kind: "lab", id: s(row.id), row, state, when: dec ? new Date(dec.at).getTime() || 0 : new Date(s(row.createdAt)).getTime() || 0 });
    }
    return out.sort((a, b) => b.when - a.when);
  }, [referrals, meds, labs, labDecisions]);

  const pending = useMemo(() => items.filter((i) => i.state === "PENDING"), [items]);
  const counts = useMemo(() => ({
    total: pending.length,
    appointment: pending.filter((i) => i.kind === "appointment").length,
    med: pending.filter((i) => i.kind === "med").length,
    lab: pending.filter((i) => i.kind === "lab").length,
  }), [pending]);

  const notifySubmitter = async (userId: string, title: string, message: string, relatedId: string, relatedType: string) => {
    if (!userId) return;
    try { await createRecord("notifications", { userId, type: "SYSTEM_ALERT", title, message, relatedEntityId: relatedId, relatedEntityType: relatedType, severity: "INFO" }); } catch { /* non-critical */ }
  };

  // ── Reject wiring (designed modal replaces the bare Swal textarea prompt) ──
  const [rejectFor, setRejectFor] = useState<Item | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectBusy, setRejectBusy] = useState(false);
  const openReject = (it: Item) => { setRejectReason(""); setRejectFor(it); };

  // ── Decisions ─────────────────────────────────────────────────────────────
  const approve = async (it: Item) => {
    const m = it.row;
    const label = it.kind === "med" ? `${s(m.name)} ${s(m.dosage)}` : it.kind === "lab" ? s(m.testName) : "this appointment";
    const res = await Swal.fire({ title: "Approve request?", text: `Approve ${label} for ${rname(m)}?`, icon: "question", showCancelButton: true, confirmButtonColor: "#2563eb", confirmButtonText: "Approve" });
    if (!res.isConfirmed) return;
    try {
      if (it.kind === "med") {
        await updateRecord("medications", it.id, { status: "ACTIVE", approvedByName: session.name, approvedAt: new Date().toISOString(), rejectionReason: null });
        await notifySubmitter(s(m.submittedById), "Prescription approved", `${s(m.name)} for ${rname(m)} is now active in the MAR.`, it.id, "medication");
        await refetchMeds();
      } else if (it.kind === "appointment") {
        await updateRecord("hospital-referrals", it.id, { status: "APPROVED", approvedByName: session.name, approvedAt: new Date().toISOString(), rejectionReason: null });
        await notifySubmitter(s(m.referredById), "Appointment approved", `The appointment for ${rname(m)} was approved and can now be scheduled.`, it.id, "hospitalReferral");
        await refetchRefs();
      } else {
        await saveLabDecision(it.id, { decision: "APPROVED", by: session.name || "Reviewer", at: new Date().toISOString() });
      }
      Swal.fire({ title: "Approved", icon: "success", timer: 1400, showConfirmButton: false });
    } catch (e) { Swal.fire("Failed", e instanceof Error ? e.message : "Could not approve.", "error"); }
  };

  const submitReject = async () => {
    if (!rejectFor) return;
    const it = rejectFor;
    const m = it.row;
    const reason = rejectReason.trim() || "Rejected";
    setRejectBusy(true);
    try {
      if (it.kind === "med") {
        await updateRecord("medications", it.id, { status: "DISCONTINUED", rejectionReason: reason, approvedByName: null, approvedAt: null });
        await notifySubmitter(s(m.submittedById), "Prescription rejected", `${s(m.name)} for ${rname(m)} was rejected: ${reason}`, it.id, "medication");
        await refetchMeds();
      } else if (it.kind === "appointment") {
        await updateRecord("hospital-referrals", it.id, { status: "CANCELLED", rejectionReason: reason });
        await notifySubmitter(s(m.referredById), "Appointment rejected", `The appointment for ${rname(m)} was rejected: ${reason}`, it.id, "hospitalReferral");
        await refetchRefs();
      } else {
        await saveLabDecision(it.id, { decision: "REJECTED", by: session.name || "Reviewer", at: new Date().toISOString(), reason });
      }
      setRejectFor(null);
      Swal.fire({ title: "Rejected", text: "The submitter has been notified.", icon: "success", timer: 1500, showConfirmButton: false });
    } catch (e) { Swal.fire("Failed", e instanceof Error ? e.message : "Could not reject.", "error"); }
    finally { setRejectBusy(false); }
  };

  const saveLabDecision = async (labId: string, dec: LabDecision) => {
    const next = { ...labDecisions, [labId]: dec };
    await upsertRecord("app-settings", LAB_DECISIONS_KEY, { key: LAB_DECISIONS_KEY, value: JSON.stringify(next) });
    await Promise.allSettled([settingsQ.refetch(), refetchLabs()]);
  };

  const shown = tab === "pending" ? pending : items;

  return (
    <div className="min-h-full bg-[#F7F8FA] -m-4 sm:-m-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 flex items-center gap-2"><ClipboardList className="w-6 h-6 text-blue-500" /> Pending Approvals</h1>
          <p className="text-sm text-slate-500 mt-1">Review and action requests from staff</p>
        </div>
        {!canDecide && <button onClick={() => setShowRequest(true)} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"><Plus className="w-4 h-4" /> Request Meds</button>}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <ApprovalStat value={counts.total} label="Total Pending" tone="#d97706" ring="border-amber-200" />
        <ApprovalStat value={counts.appointment} label="Appointments" tone="#2563eb" ring="border-blue-200" />
        <ApprovalStat value={counts.med} label="Medications" tone="#7c3aed" ring="border-purple-200" />
        <ApprovalStat value={counts.lab} label="Lab Orders" tone="#d97706" ring="border-amber-200" />
      </div>

      {/* Tabs */}
      <div className="inline-flex gap-1 bg-slate-100 rounded-xl p-1 mb-5">
        <button onClick={() => setTab("pending")} className={`px-3.5 py-1.5 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 ${tab === "pending" ? "bg-white shadow-sm text-slate-800" : "text-slate-500"}`}>Pending {pending.length > 0 && <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-amber-500 text-white text-[11px] font-bold">{pending.length}</span>}</button>
        <button onClick={() => setTab("all")} className={`px-3.5 py-1.5 rounded-lg text-sm font-medium ${tab === "all" ? "bg-white shadow-sm text-slate-800" : "text-slate-500"}`}>All Requests</button>
      </div>

      {/* Queue */}
      <div className="space-y-3">
        {shown.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-400">{tab === "pending" ? "Nothing awaiting approval. 🎉" : "No requests yet."}</div>
        ) : shown.map((it) => {
          const m = it.row; const meta = KIND_META[it.kind]; const Icon = meta.Icon;
          const room = rroom(m);
          const detail = it.kind === "med"
            ? `${s(m.dosage)} · ${s(m.route) || "PO"} · ${s(m.frequency)}`
            : it.kind === "lab"
              ? [s(m.category), s(m.specimen)].filter(Boolean).join(" · ")
              : [s(m.notes).replace(/^Specialist:\s*/, ""), s(m.facilityName), fmt(pickApptDate(m))].filter(Boolean).join(" · ");
          const subtitle = it.kind === "med" ? s(m.name) : it.kind === "lab" ? s(m.testName) : (s(m.reason) || "Referral");
          const requester = it.kind === "med" ? s(m.submittedByName) : it.kind === "appointment" ? s(m.referredByName) : s(m.orderingProvider);
          const requestedAt = fmt(m.createdAt);
          return (
            <div key={`${it.kind}:${it.id}`} className={`rounded-2xl border bg-white p-4 ${it.state === "PENDING" ? meta.ring : "border-slate-200"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex gap-3 min-w-0">
                  <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${meta.tint}`}><Icon className="w-5 h-5" /></span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-900">{meta.label}</span>
                      <StatePill state={it.state} />
                    </div>
                    <p className="text-sm text-slate-700 mt-0.5 flex items-center gap-1.5"><User className="w-3.5 h-3.5 text-slate-400" />{rname(m)}{room && <span className="text-[11px] text-slate-500 border border-slate-200 rounded px-1.5 py-0.5">Rm {room}</span>}</p>
                    {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
                    {detail && <p className="text-[13px] text-slate-500">{detail}</p>}
                    {(requester || requestedAt) && <p className="text-xs text-slate-400 mt-0.5">{requester ? `Requested by ${requester}` : "Requested"}{requestedAt ? ` · ${requestedAt}` : ""}</p>}
                    {it.state === "REJECTED" && m.rejectionReason && <p className="text-xs text-red-500 mt-0.5">Reason: {s(m.rejectionReason)}</p>}
                  </div>
                </div>
                {it.state === "PENDING" && canAct(it.kind) ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => openReject(it)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50"><X className="w-4 h-4" /> Reject</button>
                    <button onClick={() => approve(it)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700"><Check className="w-4 h-4" /> Approve</button>
                  </div>
                ) : it.state === "PENDING" ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-700"><Clock className="w-3.5 h-3.5" /> Pending</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {rejectFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setRejectFor(null); }}>
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between bg-red-600 p-5 text-white">
              <h2 className="text-lg font-bold flex items-center gap-2"><X className="w-5 h-5" /> Reject request</h2>
              <button onClick={() => setRejectFor(null)} className="rounded-lg p-1.5 hover:bg-white/15"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4 p-6">
              {(() => {
                const it = rejectFor; const m = it.row; const meta = KIND_META[it.kind];
                const label = it.kind === "med" ? `${s(m.name)} ${s(m.dosage)}`.trim() : it.kind === "lab" ? s(m.testName) : (s(m.reason) || "this appointment");
                return (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-sm font-bold text-slate-900">{meta.label}</p>
                    <p className="text-sm text-slate-600 mt-0.5">{label || "—"} · {rname(m)}</p>
                  </div>
                );
              })()}
              <div>
                <label htmlFor="reject-reason" className="block text-sm font-bold text-slate-700 mb-1.5">Reason <span className="font-normal text-slate-400">(sent back to the submitter)</span></label>
                <textarea id="reject-reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={4} autoFocus placeholder="e.g. not clinically indicated…" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-red-400/40 resize-y" />
              </div>
            </div>
            <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
              <button onClick={() => setRejectFor(null)} disabled={rejectBusy} className="rounded-xl px-4 py-2 text-slate-600 hover:bg-black/5 disabled:opacity-50">Cancel</button>
              <button onClick={submitReject} disabled={rejectBusy} className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-6 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50">{rejectBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />} {rejectBusy ? "Rejecting…" : "Reject"}</button>
            </div>
          </div>
        </div>
      )}

      {showRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between bg-blue-600 p-5 text-white">
              <h2 className="text-lg font-bold flex items-center gap-2"><Pill className="w-5 h-5" /> Request Medication</h2>
              <button onClick={() => setShowRequest(false)} className="rounded-lg p-1.5 hover:bg-white/15"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1.5">Resident *</label>
                <select value={reqForm.residentId} onChange={(e) => setReq("residentId", e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-400/40">
                  <option value="">Select resident…</option>
                  {residents.map((r) => <option key={r.id} value={r.id}>{r.name}{r.room ? ` — Room ${r.room}` : ""}</option>)}
                </select>
              </div>
              <div><label className="block text-sm font-bold text-slate-700 mb-1.5">Medication *</label><input value={reqForm.name} onChange={(e) => setReq("name", e.target.value)} placeholder="e.g. Amlodipine" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-400/40" /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="block text-sm font-bold text-slate-700 mb-1.5">Dosage</label><input value={reqForm.dosage} onChange={(e) => setReq("dosage", e.target.value)} placeholder="e.g. 5mg" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-400/40" /></div>
                <div><label className="block text-sm font-bold text-slate-700 mb-1.5">Route</label><select value={reqForm.route} onChange={(e) => setReq("route", e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-400/40">{["ORAL", "IV", "IM", "SUBCUTANEOUS", "TOPICAL", "INHALATION", "RECTAL", "OTHER"].map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
              </div>
              <div><label className="block text-sm font-bold text-slate-700 mb-1.5">Frequency</label><input value={reqForm.frequency} onChange={(e) => setReq("frequency", e.target.value)} placeholder="e.g. Once daily, BID, PRN" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-400/40" /></div>
              <div><label className="block text-sm font-bold text-slate-700 mb-1.5">Indication / reason</label><textarea value={reqForm.reason} onChange={(e) => setReq("reason", e.target.value)} rows={2} placeholder="Why is this being prescribed?" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-400/40 resize-y" /></div>
              <p className="text-[11px] text-slate-400">Saved as <span className="font-semibold text-slate-600">Pending</span> — it won&apos;t activate in the MAR until a Care Manager approves it.</p>
            </div>
            <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
              <button onClick={() => setShowRequest(false)} disabled={saving} className="rounded-xl px-4 py-2 text-slate-600 hover:bg-black/5 disabled:opacity-50">Cancel</button>
              <button onClick={submitRequest} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {saving ? "Submitting…" : "Submit request"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ApprovalStat({ value, label, tone, ring }: { value: number; label: string; tone: string; ring: string }) {
  return <div className={`rounded-2xl border bg-white p-4 ${ring}`}><p className="text-3xl font-bold" style={{ color: tone }}>{value}</p><p className="text-sm text-slate-500 mt-0.5">{label}</p></div>;
}

function StatePill({ state }: { state: "PENDING" | "APPROVED" | "REJECTED" }) {
  const map = {
    PENDING: { cls: "bg-amber-50 text-amber-700 border-amber-200", label: "Pending", Icon: Clock },
    APPROVED: { cls: "bg-green-50 text-green-700 border-green-200", label: "Approved", Icon: Check },
    REJECTED: { cls: "bg-red-50 text-red-700 border-red-200", label: "Rejected", Icon: X },
  }[state];
  const Icon = map.Icon;
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${map.cls}`}><Icon className="w-3 h-3" /> {map.label}</span>;
}
