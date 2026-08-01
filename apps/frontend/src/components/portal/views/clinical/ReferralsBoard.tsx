"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Plus, X, Check, Ban, Stethoscope, ClipboardCheck } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, updateRecord } from "@/lib/api";
import { StatusPill, Eyebrow, MicroLabel, ClinicalCard } from "./clinical-ui";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const fmtD = (v: unknown) => (v ? new Date(s(v)).toLocaleDateString() : "—");

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

  const STEPS = [
    { n: "1", label: "Submit Referral", cap: "Clinician logs request" },
    { n: "2", label: "Pending Approval", cap: "Care Manager review" },
    { n: "3", label: "Confirmed", cap: "Appointment scheduled" },
    { n: "4", label: "Outcome Documented", cap: "Findings recorded" },
  ];

  return (
    <div className="-m-4 sm:-m-6 p-4 sm:p-6 min-h-full space-y-6" style={{ background: "#FFFFFF" }}>
      {/* Header banner */}
      <div className="bg-[#2E4A48] rounded-lg p-6 relative overflow-hidden">
        <Eyebrow className="absolute top-6 right-6 !text-[#E0836B]">Module · Referrals</Eyebrow>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="pr-28 sm:pr-0">
            <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-3" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
              <CalendarClock className="w-7 h-7 text-[#D7DAD1]" /> Medical Appointments
            </h1>
            <p className="text-sm text-[#D7DAD1] mt-1.5">Submit → approve → confirm → outcome. Specialist referrals require Care Manager sign-off.</p>
          </div>
          <button onClick={() => setShowAdd(true)} className="self-start sm:self-auto shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-[#2E4A48] text-sm font-semibold shadow-sm hover:bg-[#F0F1EA]"><Plus className="w-4 h-4" /> New Referral</button>
        </div>
      </div>

      {/* 4-step process bar */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        {STEPS.map((step, i) => (
          <div key={step.n} className={`rounded-lg px-4 py-3 flex items-start gap-3 ${i === STEPS.length - 1 ? "bg-[#C0573F]" : "bg-[#2E4A48]"}`}>
            <span className="mt-0.5 w-6 h-6 shrink-0 rounded-full bg-white/15 text-white text-xs font-bold flex items-center justify-center">{step.n}</span>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-white leading-tight">{step.label}</p>
              <MicroLabel className="!text-white/70 mt-0.5 normal-case tracking-normal">{step.cap}</MicroLabel>
            </div>
          </div>
        ))}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Pending Approval" value={String(stats.pending)} color="#C39A3E" />
        <Stat label="Scheduled" value={String(stats.scheduled)} color="#2E4A48" />
        <Stat label="Completed" value={String(stats.completed)} color="#7E9B6F" />
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 flex-wrap">
        {["all", "REQUESTED", "APPROVED", "SCHEDULED", "COMPLETED", "CANCELLED"].map((st) => (
          <button key={st} onClick={() => setStatusFilter(st)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${statusFilter === st ? "bg-[#2E4A48] text-white border-[#2E4A48]" : "bg-white text-[#6B6E63] border-[#D6D8CD] hover:bg-[#F0F1EA]"}`}>{st === "all" ? "All" : st}</button>
        ))}
      </div>

      {/* Record cards */}
      <div className="space-y-3">
        {loading && filtered.length === 0 ? <ClinicalCard className="p-8 text-center text-[#8A8D82]">Loading…</ClinicalCard>
          : filtered.length === 0 ? <ClinicalCard className="p-8 text-center text-[#8A8D82]">No referrals.</ClinicalCard>
          : filtered.map((r) => {
            const st = s(r.status);
            const specialist = s(r.notes).replace(/^Specialist:\s*/, "");
            const top = st === "REQUESTED" ? "amber" : st === "COMPLETED" ? "green" : "teal";
            return (
              <ClinicalCard key={s(r.id)} top={top} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={s(r.urgency) || "ROUTINE"} />
                    <StatusPill status={st} />
                    <span className="inline-flex items-center gap-1.5 font-bold text-[#2B2B27]"><Stethoscope className="w-4 h-4 text-[#2E4A48]" />{specialist || s(r.facilityName)}</span>
                  </div>
                  {s(r.scheduledDate) && <span className="text-sm font-semibold text-[#2E4A48]">{fmtD(r.scheduledDate)}</span>}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div><MicroLabel>Specialist</MicroLabel><p className="text-sm text-[#2B2B27] mt-0.5">{specialist || "—"}</p></div>
                  <div><MicroLabel>Clinic</MicroLabel><p className="text-sm text-[#2B2B27] mt-0.5">{s(r.facilityName) || "—"}</p></div>
                  <div><MicroLabel>Purpose</MicroLabel><p className="text-sm text-[#2B2B27] mt-0.5">{s(r.reason) || "—"}</p></div>
                  <div>
                    <MicroLabel>{r.approvedByName ? "Approved By" : "Submitted By"}</MicroLabel>
                    <p className="text-sm text-[#2B2B27] mt-0.5">{s(r.approvedByName) || s(r.referredByName) || rname(r)}</p>
                  </div>
                </div>

                {r.rejectionReason && <p className="text-sm text-[#C0573F] font-medium mt-3">Rejected: {s(r.rejectionReason)}</p>}

                {r.outcome && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-[#7E9B6F]/10 border border-[#7E9B6F]/30 p-3">
                    <Check className="w-4 h-4 text-[#7E9B6F] mt-0.5 shrink-0" />
                    <p className="text-sm text-[#2B2B27]"><span className="font-semibold">Outcome:</span> {s(r.outcome)}</p>
                  </div>
                )}

                {st === "REQUESTED" && (
                  <div className="mt-3 rounded-lg bg-[#C39A3E]/12 border border-[#C39A3E]/40 text-[#7a5f1e] px-3 py-2 text-sm">
                    Awaiting Care Manager review — will be confirmed upon approval
                  </div>
                )}

                <div className="flex items-center gap-2 mt-3">
                  {st === "REQUESTED" && canApprove && (<>
                    <button onClick={() => approve(r)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#7E9B6F] text-white text-xs font-semibold hover:bg-[#6E8A60]"><Check className="w-3.5 h-3.5" /> Approve</button>
                    <button onClick={() => reject(r)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#C0573F] text-white text-xs font-semibold hover:bg-[#A94A34]"><Ban className="w-3.5 h-3.5" /> Reject</button>
                  </>)}
                  {st === "APPROVED" && <button onClick={() => schedule(r)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#2E4A48] text-white text-xs font-semibold hover:bg-[#25403D]"><CalendarClock className="w-3.5 h-3.5" /> Confirm &amp; schedule</button>}
                  {st === "SCHEDULED" && <button onClick={() => complete(r)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#7E9B6F] text-white text-xs font-semibold hover:bg-[#6E8A60]"><ClipboardCheck className="w-3.5 h-3.5" /> Document outcome</button>}
                </div>
              </ClinicalCard>
            );
          })}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between bg-[#2E4A48] p-5 text-white"><h2 className="text-xl font-bold flex items-center gap-2" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}><CalendarClock className="w-5 h-5" /> New Referral</h2><button onClick={() => setShowAdd(false)} className="rounded-lg p-1.5 hover:bg-white/20"><X className="w-5 h-5" /></button></div>
            <div className="space-y-4 p-6">
              <div><label className="mb-1 block text-sm font-semibold text-[#2B2B27]">Resident <span className="text-[#C0573F]">*</span></label>
                <select value={form.residentId} onChange={(e) => setForm({ ...form, residentId: e.target.value })} className="w-full rounded-lg border border-[#D6D8CD] px-3 py-2 outline-none focus:ring-2 focus:ring-[#2E4A48]/30"><option value="">Select…</option>{residents.map((r) => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}</select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-sm font-semibold text-[#2B2B27]">Specialist <span className="text-[#C0573F]">*</span></label><input value={form.specialist} onChange={(e) => setForm({ ...form, specialist: e.target.value })} placeholder="Dr. … (Cardiology)" className="w-full rounded-lg border border-[#D6D8CD] px-3 py-2 outline-none focus:ring-2 focus:ring-[#2E4A48]/30" /></div>
                <div><label className="mb-1 block text-sm font-semibold text-[#2B2B27]">Clinic</label><input value={form.facilityName} onChange={(e) => setForm({ ...form, facilityName: e.target.value })} className="w-full rounded-lg border border-[#D6D8CD] px-3 py-2 outline-none focus:ring-2 focus:ring-[#2E4A48]/30" /></div>
                <div><label className="mb-1 block text-sm font-semibold text-[#2B2B27]">Preferred date</label><input type="date" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} className="w-full rounded-lg border border-[#D6D8CD] px-3 py-2 outline-none focus:ring-2 focus:ring-[#2E4A48]/30" /></div>
                <div><label className="mb-1 block text-sm font-semibold text-[#2B2B27]">Urgency</label><select value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })} className="w-full rounded-lg border border-[#D6D8CD] px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-[#2E4A48]/30">{["ROUTINE", "URGENT", "EMERGENCY"].map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
                <div className="col-span-2"><label className="mb-1 block text-sm font-semibold text-[#2B2B27]">Purpose <span className="text-[#C0573F]">*</span></label><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="w-full rounded-lg border border-[#D6D8CD] px-3 py-2 outline-none focus:ring-2 focus:ring-[#2E4A48]/30" /></div>
              </div>
            </div>
            <div className="sticky bottom-0 flex items-center justify-between border-t border-[#D6D8CD] bg-[#F0F1EA] px-6 py-4"><button onClick={() => setShowAdd(false)} disabled={busy} className="rounded-lg px-4 py-2 text-[#2B2B27] hover:bg-[#E1E3D9] disabled:opacity-50">Cancel</button><button onClick={submit} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-[#2E4A48] hover:bg-[#25403D] px-6 py-2 font-semibold text-white shadow-sm disabled:opacity-50"><Plus className="w-4 h-4" /> {busy ? "Submitting…" : "Submit"}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <ClinicalCard className="p-4">
      <div className="flex items-center justify-between mb-2">
        <MicroLabel>{label}</MicroLabel>
        <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}1A`, color }}><CalendarClock className="w-4 h-4" /></span>
      </div>
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
    </ClinicalCard>
  );
}
