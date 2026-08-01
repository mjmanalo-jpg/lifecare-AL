"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Plus, X, Check, Ban, Stethoscope, ClipboardCheck } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, updateRecord } from "@/lib/api";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const fmtD = (v: unknown) => (v ? new Date(s(v)).toLocaleDateString() : "—");

const STATUS_BADGE: Record<string, string> = {
  REQUESTED: "bg-amber-100 text-amber-700 border-amber-200",
  APPROVED: "bg-blue-100 text-blue-700 border-blue-200",
  SCHEDULED: "bg-indigo-100 text-indigo-700 border-indigo-200",
  COMPLETED: "bg-green-100 text-green-700 border-green-200",
  CANCELLED: "bg-gray-100 text-gray-500 border-gray-200",
};

/**
 * Referrals & Appointments (Modules 13 + 15) — specialist referrals follow the
 * approval flow: Submit → Pending approval → Confirmed (scheduled) → Outcome
 * documented. A Care Manager gate approves/rejects before confirmation.
 */
export default function ReferralsBoard({ canApprove = false }: { canApprove?: boolean }) {
  const { data: rows, loading, refetch } = useLiveQuery<Row>("hospital-referrals", { query: "include=resident&take=400", tables: ["HospitalReferral"] });
  const { data: residentRows } = useLiveQuery<Row>("residents", { query: "take=300", tables: ["Resident"] });
  const residents = useMemo(() => residentRows.map(adaptResident), [residentRows]);

  const [session, setSession] = useState<{ id: string | null; name: string | null }>({ id: null, name: null });
  useEffect(() => { fetch("/api/auth/session").then((r) => r.json()).then((d) => { if (d?.authenticated) setSession({ id: d.session?.userId ?? null, name: d.session?.name ?? "Clinician" }); }).catch(() => {}); }, []);

  const [statusFilter, setStatusFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ residentId: "", specialist: "", facilityName: "", scheduledDate: "", reason: "", urgency: "ROUTINE" });

  const rname = (c: Row) => { const r = (c.resident ?? {}) as Row; return `${s(r.firstName)} ${s(r.lastName)}`.trim() || "—"; };

  const filtered = useMemo(() => rows.filter((r) => statusFilter === "all" || s(r.status) === statusFilter), [rows, statusFilter]);
  const stats = useMemo(() => ({
    pending: rows.filter((r) => s(r.status) === "REQUESTED").length,
    scheduled: rows.filter((r) => s(r.status) === "SCHEDULED").length,
    completed: rows.filter((r) => s(r.status) === "COMPLETED").length,
  }), [rows]);

  const submit = async () => {
    if (!form.residentId || !form.specialist.trim() || !form.reason.trim()) { Swal.fire("Missing fields", "Resident, specialist, and purpose are required.", "warning"); return; }
    setBusy(true);
    try {
      await createRecord("hospital-referrals", {
        residentId: form.residentId,
        facilityName: form.facilityName.trim() || "—",
        reason: form.reason.trim(),
        urgency: form.urgency,
        status: "REQUESTED",
        referredById: session.id,
        referredByName: session.name,
        scheduledDate: form.scheduledDate ? new Date(form.scheduledDate).toISOString() : null,
        notes: `Specialist: ${form.specialist.trim()}`,
      });
      await refetch();
      setShowAdd(false);
      setForm({ residentId: "", specialist: "", facilityName: "", scheduledDate: "", reason: "", urgency: "ROUTINE" });
      Swal.fire({ title: "Referral submitted", text: "Awaiting Care Manager approval.", icon: "success", timer: 1600, showConfirmButton: false });
    } catch (e) { Swal.fire("Failed", e instanceof Error ? e.message : "Could not submit.", "error"); }
    finally { setBusy(false); }
  };

  const patch = async (r: Row, data: Row, confirm?: { title: string; text: string; color?: string }) => {
    if (confirm) { const res = await Swal.fire({ title: confirm.title, text: confirm.text, icon: "question", showCancelButton: true, confirmButtonColor: confirm.color ?? "#3b82f6" }); if (!res.isConfirmed) return; }
    try { await updateRecord("hospital-referrals", s(r.id), data); await refetch(); } catch (e) { Swal.fire("Failed", e instanceof Error ? e.message : "Could not update.", "error"); }
  };

  const approve = (r: Row) => patch(r, { status: "APPROVED", approvedByName: session.name, approvedAt: new Date().toISOString() }, { title: "Approve referral?", text: `Approve ${rname(r)}'s referral?`, color: "#16a34a" });
  const reject = async (r: Row) => { const res = await Swal.fire({ title: "Reject referral?", input: "textarea", inputLabel: "Reason", showCancelButton: true, confirmButtonColor: "#dc2626", confirmButtonText: "Reject" }); if (!res.isConfirmed) return; await patch(r, { status: "CANCELLED", rejectionReason: res.value || "Rejected" }); };
  const schedule = async (r: Row) => { const res = await Swal.fire({ title: "Confirm & schedule", input: "text", inputLabel: "Appointment date (YYYY-MM-DD)", inputValue: new Date().toISOString().slice(0, 10), showCancelButton: true }); if (!res.isConfirmed) return; await patch(r, { status: "SCHEDULED", scheduledDate: new Date(res.value || Date.now()).toISOString() }); };
  const complete = async (r: Row) => { const res = await Swal.fire({ title: "Document outcome", input: "textarea", inputLabel: "Findings, follow-up & notes", showCancelButton: true, confirmButtonText: "Complete", confirmButtonColor: "#16a34a" }); if (!res.isConfirmed) return; await patch(r, { status: "COMPLETED", outcome: res.value || "Completed", completedAt: new Date().toISOString() }); };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2 flex items-center gap-3"><CalendarClock className="w-8 h-8 text-indigo-500" /> Referrals &amp; Appointments</h1>
          <p className="text-gray-600">Submit → approve → confirm → outcome. Specialist referrals require Care Manager sign-off.</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="self-start inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-sm font-semibold shadow hover:shadow-lg"><Plus className="w-4 h-4" /> New Referral</button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Pending Approval" value={String(stats.pending)} tint="text-amber-600 bg-amber-50" />
        <Stat label="Scheduled" value={String(stats.scheduled)} tint="text-indigo-600 bg-indigo-50" />
        <Stat label="Completed" value={String(stats.completed)} tint="text-green-600 bg-green-50" />
      </div>

      <div className="flex gap-2 flex-wrap">
        {["all", "REQUESTED", "APPROVED", "SCHEDULED", "COMPLETED", "CANCELLED"].map((st) => (
          <button key={st} onClick={() => setStatusFilter(st)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${statusFilter === st ? "bg-blue-500 text-white border-blue-500" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>{st === "all" ? "All" : st}</button>
        ))}
      </div>

      <div className="space-y-3">
        {loading && filtered.length === 0 ? <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">Loading…</div>
          : filtered.length === 0 ? <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">No referrals.</div>
          : filtered.map((r) => {
            const st = s(r.status);
            const specialist = s(r.notes).replace(/^Specialist:\s*/, "");
            return (
              <div key={s(r.id)} className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2"><Stethoscope className="w-4 h-4 text-teal-500" /><span className="font-bold text-gray-900">{specialist || s(r.facilityName)}</span><span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_BADGE[st]}`}>{st}</span></div>
                  <span className="text-xs text-gray-500">{s(r.scheduledDate) ? `Scheduled ${fmtD(r.scheduledDate)}` : ""}</span>
                </div>
                <p className="text-sm text-gray-600">{rname(r)} · {s(r.facilityName)} · {s(r.reason)}</p>
                {r.rejectionReason && <p className="text-xs text-red-600 mt-1">Rejected: {s(r.rejectionReason)}</p>}
                {r.outcome && <p className="text-sm text-gray-800 mt-2 p-2 bg-green-50 border border-green-100 rounded">Outcome: {s(r.outcome)}</p>}
                <div className="flex items-center gap-2 mt-3">
                  {st === "REQUESTED" && canApprove && (<>
                    <button onClick={() => approve(r)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-500 text-white text-xs font-semibold hover:bg-green-600"><Check className="w-3.5 h-3.5" /> Approve</button>
                    <button onClick={() => reject(r)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs font-semibold hover:bg-red-50"><Ban className="w-3.5 h-3.5" /> Reject</button>
                  </>)}
                  {st === "REQUESTED" && !canApprove && <span className="text-xs text-amber-600 font-medium">Awaiting Care Manager approval</span>}
                  {st === "APPROVED" && <button onClick={() => schedule(r)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-xs font-semibold hover:bg-indigo-600"><CalendarClock className="w-3.5 h-3.5" /> Confirm &amp; schedule</button>}
                  {st === "SCHEDULED" && <button onClick={() => complete(r)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-500 text-white text-xs font-semibold hover:bg-green-600"><ClipboardCheck className="w-3.5 h-3.5" /> Document outcome</button>}
                </div>
              </div>
            );
          })}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between bg-gradient-to-r from-blue-500 to-indigo-600 p-5 text-white"><h2 className="text-xl font-bold flex items-center gap-2"><CalendarClock className="w-5 h-5" /> New Referral</h2><button onClick={() => setShowAdd(false)} className="rounded-lg p-1.5 hover:bg-white/20"><X className="w-5 h-5" /></button></div>
            <div className="space-y-4 p-6">
              <div><label className="mb-1 block text-sm font-semibold text-gray-700">Resident <span className="text-red-500">*</span></label>
                <select value={form.residentId} onChange={(e) => setForm({ ...form, residentId: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400"><option value="">Select…</option>{residents.map((r) => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}</select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-sm font-semibold text-gray-700">Specialist <span className="text-red-500">*</span></label><input value={form.specialist} onChange={(e) => setForm({ ...form, specialist: e.target.value })} placeholder="Dr. … (Cardiology)" className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400" /></div>
                <div><label className="mb-1 block text-sm font-semibold text-gray-700">Clinic</label><input value={form.facilityName} onChange={(e) => setForm({ ...form, facilityName: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400" /></div>
                <div><label className="mb-1 block text-sm font-semibold text-gray-700">Preferred date</label><input type="date" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400" /></div>
                <div><label className="mb-1 block text-sm font-semibold text-gray-700">Urgency</label><select value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-blue-400">{["ROUTINE", "URGENT", "EMERGENCY"].map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
                <div className="col-span-2"><label className="mb-1 block text-sm font-semibold text-gray-700">Purpose <span className="text-red-500">*</span></label><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400" /></div>
              </div>
            </div>
            <div className="sticky bottom-0 flex items-center justify-between border-t border-gray-200 bg-gray-50 px-6 py-4"><button onClick={() => setShowAdd(false)} disabled={busy} className="rounded-lg px-4 py-2 text-gray-700 hover:bg-gray-100 disabled:opacity-50">Cancel</button><button onClick={submit} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-6 py-2 font-semibold text-white shadow hover:shadow-lg disabled:opacity-50"><Plus className="w-4 h-4" /> {busy ? "Submitting…" : "Submit"}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tint }: { label: string; value: string; tint: string }) {
  return (<div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm"><div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span><span className={`w-8 h-8 rounded-lg flex items-center justify-center ${tint}`}><CalendarClock className="w-4 h-4" /></span></div><p className="text-2xl font-bold text-gray-900">{value}</p></div>);
}
