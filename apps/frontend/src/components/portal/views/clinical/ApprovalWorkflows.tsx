"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, X, Clock, Pill, CalendarClock, Send, Eye, Gavel, ShieldCheck } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord } from "@/lib/api";
import { ClinicalHeader, ClinicalCard, StatusPill, MicroLabel, Eyebrow } from "./clinical-ui";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const rname = (o: Row) => { const r = (o.resident ?? {}) as Row; return `${s(r.firstName)} ${s(r.lastName)}`.trim() || "—"; };
const rroom = (o: Row) => s((o.resident as Row)?.roomNumber) || "—";

type Item =
  | { kind: "med"; id: string; row: Row }
  | { kind: "referral"; id: string; row: Row };

/**
 * Approval Workflows (Module 13) — the single review queue where the right
 * authority (Care Manager / Administrator) signs off before a clinical decision
 * goes active. Two request types flow through it:
 *   • Medication prescriptions — PENDING until approved, then ACTIVE in the MAR.
 *   • Appointment referrals    — REQUESTED until approved, then confirmed/scheduled.
 * Every decision records a reviewer + timestamp and notifies the submitter.
 */
export default function ApprovalWorkflows() {
  const { data: meds, loading: mLoading, refetch: refetchMeds } = useLiveQuery<Row>("medications", { query: "include=resident&take=400", tables: ["Medication", "Resident"] });
  const { data: referrals, loading: rLoading, refetch: refetchRefs } = useLiveQuery<Row>("hospital-referrals", { query: "include=resident&take=400", tables: ["HospitalReferral"] });

  const [session, setSession] = useState<{ id: string | null; name: string | null }>({ id: null, name: null });
  useEffect(() => { fetch("/api/auth/session").then((r) => r.json()).then((d) => { if (d?.authenticated) setSession({ id: d.session?.userId ?? null, name: d.session?.name ?? d.session?.role ?? "Care Manager" }); }).catch(() => {}); }, []);

  const pendingMeds = useMemo(() => meds.filter((m) => s(m.status) === "PENDING"), [meds]);
  const pendingRefs = useMemo(() => referrals.filter((r) => s(r.status) === "REQUESTED"), [referrals]);

  const queue = useMemo<Item[]>(() => [
    ...pendingMeds.map((row) => ({ kind: "med" as const, id: s(row.id), row })),
    ...pendingRefs.map((row) => ({ kind: "referral" as const, id: s(row.id), row })),
  ], [pendingMeds, pendingRefs]);

  const decided = useMemo(() => {
    const m = meds.filter((x) => x.approvedAt || (x.rejectionReason && s(x.status) === "DISCONTINUED")).map((row) => ({ kind: "med" as const, row }));
    const r = referrals.filter((x) => x.approvedAt || (x.rejectionReason && s(x.status) === "CANCELLED")).map((row) => ({ kind: "referral" as const, row }));
    return [...m, ...r].sort((a, b) => new Date(s(b.row.updatedAt)).getTime() - new Date(s(a.row.updatedAt)).getTime()).slice(0, 40);
  }, [meds, referrals]);

  const approvedCount = meds.filter((m) => m.approvedAt).length + referrals.filter((r) => r.approvedAt).length;
  const rejectedCount = meds.filter((m) => m.rejectionReason && s(m.status) === "DISCONTINUED").length + referrals.filter((r) => r.rejectionReason && s(r.status) === "CANCELLED").length;

  const notifySubmitter = async (userId: string, title: string, message: string, relatedId: string, relatedType: string) => {
    if (!userId) return;
    try { await createRecord("notifications", { userId, type: "SYSTEM_ALERT", title, message, relatedEntityId: relatedId, relatedEntityType: relatedType, severity: "INFO" }); } catch { /* non-critical */ }
  };

  // ── Medication decisions ──
  const approveMed = async (m: Row) => {
    const res = await Swal.fire({ title: "Approve prescription?", text: `Activate ${s(m.name)} ${s(m.dosage)} for ${rname(m)} in the MAR?`, icon: "question", showCancelButton: true, confirmButtonColor: "#2E4A48", confirmButtonText: "Approve" });
    if (!res.isConfirmed) return;
    try {
      await updateRecord("medications", s(m.id), { status: "ACTIVE", approvedByName: session.name, approvedAt: new Date().toISOString(), rejectionReason: null });
      await notifySubmitter(s(m.submittedById), "Prescription approved", `${s(m.name)} for ${rname(m)} was approved and is now active in the MAR.`, s(m.id), "medication");
      await refetchMeds();
      Swal.fire({ title: "Approved", text: "Now active in the MAR.", icon: "success", timer: 1500, showConfirmButton: false });
    } catch (e) { Swal.fire("Failed", e instanceof Error ? e.message : "Could not approve.", "error"); }
  };
  const rejectMed = async (m: Row) => {
    const res = await Swal.fire({ title: "Reject prescription?", input: "textarea", inputLabel: "Reason (sent back to the submitting clinician)", inputPlaceholder: "e.g. dose too high for renal function…", showCancelButton: true, confirmButtonColor: "#C0573F", confirmButtonText: "Reject" });
    if (!res.isConfirmed) return;
    const reason = res.value || "Rejected";
    try {
      await updateRecord("medications", s(m.id), { status: "DISCONTINUED", rejectionReason: reason, approvedByName: null, approvedAt: null });
      await notifySubmitter(s(m.submittedById), "Prescription rejected", `${s(m.name)} for ${rname(m)} was rejected: ${reason}`, s(m.id), "medication");
      await refetchMeds();
      Swal.fire({ title: "Rejected", text: "The submitting clinician has been notified.", icon: "success", timer: 1600, showConfirmButton: false });
    } catch (e) { Swal.fire("Failed", e instanceof Error ? e.message : "Could not reject.", "error"); }
  };

  // ── Referral decisions ──
  const approveRef = async (r: Row) => {
    const res = await Swal.fire({ title: "Approve referral?", text: `Approve ${rname(r)}'s referral? It can then be confirmed & scheduled.`, icon: "question", showCancelButton: true, confirmButtonColor: "#2E4A48", confirmButtonText: "Approve" });
    if (!res.isConfirmed) return;
    try {
      await updateRecord("hospital-referrals", s(r.id), { status: "APPROVED", approvedByName: session.name, approvedAt: new Date().toISOString(), rejectionReason: null });
      await notifySubmitter(s(r.referredById), "Referral approved", `The referral for ${rname(r)} was approved and can now be scheduled.`, s(r.id), "hospitalReferral");
      await refetchRefs();
      Swal.fire({ title: "Approved", text: "Ready to schedule.", icon: "success", timer: 1500, showConfirmButton: false });
    } catch (e) { Swal.fire("Failed", e instanceof Error ? e.message : "Could not approve.", "error"); }
  };
  const rejectRef = async (r: Row) => {
    const res = await Swal.fire({ title: "Reject referral?", input: "textarea", inputLabel: "Reason (sent back to the submitting nurse)", showCancelButton: true, confirmButtonColor: "#C0573F", confirmButtonText: "Reject" });
    if (!res.isConfirmed) return;
    const reason = res.value || "Rejected";
    try {
      await updateRecord("hospital-referrals", s(r.id), { status: "CANCELLED", rejectionReason: reason });
      await notifySubmitter(s(r.referredById), "Referral rejected", `The referral for ${rname(r)} was rejected: ${reason}`, s(r.id), "hospitalReferral");
      await refetchRefs();
      Swal.fire({ title: "Rejected", text: "The submitting nurse has been notified.", icon: "success", timer: 1600, showConfirmButton: false });
    } catch (e) { Swal.fire("Failed", e instanceof Error ? e.message : "Could not reject.", "error"); }
  };

  const loading = mLoading || rLoading;
  const STEPS = [
    { n: 1, icon: Send, label: "Nurse submits request", sub: "Prescription or referral with full clinical context", tone: "#2E4A48" },
    { n: 2, icon: Eye, label: "Reviewer checks context", sub: "Resident, medication/appointment details, prescriber", tone: "#2E4A48" },
    { n: 3, icon: Gavel, label: "Decision with notes", sub: "Approve or reject with reviewer notes + timestamp", tone: "#C0573F" },
  ];

  return (
    <div className="-m-4 sm:-m-6 p-4 sm:p-6 min-h-full space-y-5" style={{ background: "#FFFFFF" }}>
      <ClinicalHeader eyebrow="Approval Workflows" title="Approval Workflows" subtitle="Clinical decisions require the right authority — new prescriptions and referrals are signed off here before they go active." />

      {/* Process strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {STEPS.map((st) => (
          <div key={st.n} className="flex items-start gap-3 rounded-lg p-3.5" style={{ background: st.tone }}>
            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-white/20 text-white grid place-items-center text-sm font-bold">{st.n}</span>
            <div className="min-w-0">
              <p className="text-white font-semibold text-sm flex items-center gap-1.5"><st.icon className="w-3.5 h-3.5" /> {st.label}</p>
              <p className="text-[12px] text-white/70 mt-0.5">{st.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <ClinicalCard top="amber" className="p-4"><MicroLabel>Pending</MicroLabel><p className="text-2xl font-bold text-[#C39A3E] mt-1">{queue.length}</p></ClinicalCard>
        <ClinicalCard top="green" className="p-4"><MicroLabel>Approved</MicroLabel><p className="text-2xl font-bold text-[#7E9B6F] mt-1">{approvedCount}</p></ClinicalCard>
        <ClinicalCard top="coral" className="p-4"><MicroLabel>Rejected</MicroLabel><p className="text-2xl font-bold text-[#C0573F] mt-1">{rejectedCount}</p></ClinicalCard>
      </div>

      <Eyebrow>Awaiting Approval</Eyebrow>
      <div className="space-y-3">
        {loading && queue.length === 0 ? (
          <ClinicalCard className="p-8 text-center text-[#8A8D82]">Loading…</ClinicalCard>
        ) : queue.length === 0 ? (
          <ClinicalCard className="p-8 text-center text-[#8A8D82]">Nothing awaiting approval. 🎉</ClinicalCard>
        ) : queue.map((it) => {
          const m = it.row;
          const isMed = it.kind === "med";
          const specialist = isMed ? "" : s(m.notes).replace(/^Specialist:\s*/, "");
          return (
            <ClinicalCard key={`${it.kind}:${it.id}`} top={isMed ? "teal" : "coral"} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <StatusPill status={isMed ? "SCHEDULED" : "REQUESTED"}>{isMed ? <><Pill className="w-3 h-3 mr-1 inline" />Medication</> : <><CalendarClock className="w-3 h-3 mr-1 inline" />Referral</>}</StatusPill>
                    <span className="font-bold text-[#2B2B27]">{isMed ? s(m.name) : (specialist || s(m.facilityName))}</span>
                    {isMed && <span className="text-[13px] text-[#6B6E63]">{s(m.dosage)} · {s(m.route) || "PO"} · {s(m.frequency)}</span>}
                  </div>
                  <p className="text-[13px] text-[#6B6E63]">
                    {rname(m)} · Room {rroom(m)}
                    {isMed
                      ? `${m.submittedByName ? ` · submitted by ${s(m.submittedByName)}` : ""}${m.reason ? ` · ${s(m.reason)}` : ""}`
                      : `${m.facilityName ? ` · ${s(m.facilityName)}` : ""}${m.reason ? ` · ${s(m.reason)}` : ""}${m.referredByName ? ` · submitted by ${s(m.referredByName)}` : ""}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => (isMed ? approveMed(m) : approveRef(m))} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-[#7E9B6F] text-white text-sm font-semibold hover:bg-[#6E8A5F]"><Check className="w-4 h-4" /> Approve</button>
                  <button onClick={() => (isMed ? rejectMed(m) : rejectRef(m))} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-[#C0573F]/30 text-[#C0573F] text-sm font-semibold hover:bg-[#C0573F]/[0.06]"><X className="w-4 h-4" /> Reject</button>
                </div>
              </div>
            </ClinicalCard>
          );
        })}
      </div>

      {decided.length > 0 && (
        <>
          <Eyebrow>Recent Decisions</Eyebrow>
          <ClinicalCard className="divide-y divide-[#EBEDE4]">
            {decided.map((d, i) => {
              const m = d.row; const isMed = d.kind === "med";
              const approved = Boolean(m.approvedAt);
              return (
                <div key={i} className="px-4 py-3 flex items-center justify-between gap-3 text-sm">
                  <span className="text-[#2B2B27] inline-flex items-center gap-1.5">{isMed ? <Pill className="w-3.5 h-3.5 text-[#2E4A48]" /> : <CalendarClock className="w-3.5 h-3.5 text-[#C0573F]" />}{isMed ? s(m.name) : (s(m.notes).replace(/^Specialist:\s*/, "") || s(m.facilityName))} · {rname(m)}</span>
                  {approved
                    ? <span className="inline-flex items-center gap-1 text-[#5F7A52] font-medium"><ShieldCheck className="w-3.5 h-3.5" /> Approved{m.approvedByName ? ` · ${s(m.approvedByName)}` : ""}</span>
                    : <span className="inline-flex items-center gap-1 text-[#C0573F] font-medium" title={s(m.rejectionReason)}><X className="w-3.5 h-3.5" /> Rejected</span>}
                </div>
              );
            })}
          </ClinicalCard>
        </>
      )}

      <div className="flex items-center gap-2 pt-1">
        <span className="text-[11px] text-[#8A8D82] uppercase tracking-wider">Approving roles:</span>
        <StatusPill status="APPROVED">Care Manager</StatusPill>
        <StatusPill status="SCHEDULED">Administrator</StatusPill>
      </div>
    </div>
  );
}
