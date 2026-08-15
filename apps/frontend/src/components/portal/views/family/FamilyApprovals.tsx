"use client";

import { useCallback, useEffect, useState } from "react";
import Swal from "sweetalert2";
import { HeartHandshake, Check, X, Clock, CheckCircle2, XCircle, RefreshCw, Inbox, CalendarClock } from "lucide-react";
import { RATE_UNIT_LABEL, PRIVATE_CARE_STATUS_META, type PrivateCareAssignment } from "@/lib/privateCaregiver";

/**
 * Family "Requests & Approvals" — items routed to the family sponsor for sign-off:
 *   • Private (1:1) Caregiver requests  → /api/family/private-care
 *   • Specialist appointments / referrals (raised with "Family Notified") →
 *     /api/family/appointment. Approving one schedules it on the calendar.
 */

type ApptApproval = {
  id: string; residentName: string; room: string; appointmentType: string; specialist: string;
  facilityName: string; reason: string; scheduledDate: string | null; requestedBy: string; requestedAt: string;
};

const peso = (n: number) => `₱${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
const fmtDateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "TBD");

export default function FamilyApprovals() {
  const [assignments, setAssignments] = useState<PrivateCareAssignment[]>([]);
  const [appts, setAppts] = useState<ApptApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [pcRes, apRes] = await Promise.all([
        fetch("/api/family/private-care", { cache: "no-store" }),
        fetch("/api/family/appointment", { cache: "no-store" }),
      ]);
      const pc = await pcRes.json().catch(() => ({}));
      const ap = await apRes.json().catch(() => ({}));
      setAssignments(Array.isArray(pc.assignments) ? pc.assignments : []);
      setAppts(Array.isArray(ap.pending) ? ap.pending : []);
    } catch { setAssignments([]); setAppts([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const decide = async (a: PrivateCareAssignment, decision: "APPROVE" | "DECLINE") => {
    let reason = "";
    if (decision === "DECLINE") {
      const r = await Swal.fire({
        title: "Decline this request?",
        input: "textarea",
        inputLabel: "Reason (optional) — shared with the care team",
        inputPlaceholder: "e.g. Not needed at this time",
        showCancelButton: true, confirmButtonText: "Decline", confirmButtonColor: "#dc2626",
      });
      if (!r.isConfirmed) return;
      reason = String(r.value || "");
    } else {
      const r = await Swal.fire({
        title: "Approve private caregiver?",
        html: `Approve <b>${a.caregiverName}</b> for <b>${a.residentName}</b> at <b>${peso(a.rate)} ${RATE_UNIT_LABEL[a.rateUnit]}</b>?<br/><span style="color:#64748b;font-size:.85em">This starts the recurring charge on your billing account.</span>`,
        icon: "question", showCancelButton: true, confirmButtonText: "Approve & activate", confirmButtonColor: "#16a34a",
      });
      if (!r.isConfirmed) return;
    }

    setBusyId(a.id);
    try {
      const res = await fetch("/api/family/private-care", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: a.id, decision, reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save your decision");
      await load();
      Swal.fire({ toast: true, position: "top-end", icon: "success", showConfirmButton: false, timer: 2200,
        title: decision === "APPROVE" ? "Approved — caregiver activated" : "Request declined" });
    } catch (e) {
      Swal.fire({ title: "Something went wrong", text: e instanceof Error ? e.message : "Please try again", icon: "error" });
    } finally { setBusyId(null); }
  };

  const decideAppt = async (a: ApptApproval, decision: "APPROVE" | "DECLINE") => {
    let reason = "";
    if (decision === "DECLINE") {
      const r = await Swal.fire({
        title: "Decline this appointment?",
        input: "textarea",
        inputLabel: "Reason (optional) — shared with the care team",
        inputPlaceholder: "e.g. Please reschedule to next week",
        showCancelButton: true, confirmButtonText: "Decline", confirmButtonColor: "#dc2626",
      });
      if (!r.isConfirmed) return;
      reason = String(r.value || "");
    } else {
      const r = await Swal.fire({
        title: "Approve appointment?",
        html: `Approve the <b>${a.appointmentType}</b>${a.specialist ? ` with <b>${a.specialist}</b>` : ""} for <b>${a.residentName}</b>?<br/><span style="color:#64748b;font-size:.85em">It will be scheduled on the appointment calendar.</span>`,
        icon: "question", showCancelButton: true, confirmButtonText: "Approve & schedule", confirmButtonColor: "#16a34a",
      });
      if (!r.isConfirmed) return;
    }
    setBusyId(a.id);
    try {
      const res = await fetch("/api/family/appointment", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referralId: a.id, decision, reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save your decision");
      await load();
      Swal.fire({ toast: true, position: "top-end", icon: "success", showConfirmButton: false, timer: 2200,
        title: decision === "APPROVE" ? "Approved — appointment scheduled" : "Appointment declined" });
    } catch (e) {
      Swal.fire({ title: "Something went wrong", text: e instanceof Error ? e.message : "Please try again", icon: "error" });
    } finally { setBusyId(null); }
  };

  const pending = assignments.filter((a) => a.status === "PENDING_FAMILY");
  const decided = assignments.filter((a) => a.status !== "PENDING_FAMILY")
    .sort((a, b) => (b.decidedAt || "").localeCompare(a.decidedAt || ""));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Requests &amp; Approvals</h1>
          <p className="mt-1 text-sm text-slate-500">Review and approve requests that need your sign-off, such as a dedicated private caregiver.</p>
        </div>
        <button onClick={() => { setLoading(true); void load(); }} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Private caregiver — needs your action (hidden when only appointments pend) */}
      {(pending.length > 0 || appts.length === 0) && (
      <section>
        <div className="mb-2 flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber-500" />
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Needs your approval</h2>
          <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-amber-100 px-1.5 text-xs font-bold text-amber-700">{pending.length}</span>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Loading…</div>
        ) : pending.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
            <Inbox className="h-8 w-8 text-slate-300" />
            <p className="text-sm font-semibold text-slate-600">You&apos;re all caught up</p>
            <p className="text-xs text-slate-400">No requests are waiting for your approval right now.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {pending.map((a) => (
              <div key={a.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-900/5">
                {/* Header — what + how much */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
                  <div className="flex items-center gap-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-600 text-white shadow-sm"><HeartHandshake className="h-5 w-5" /></span>
                    <div>
                      <p className="text-[15px] font-bold text-slate-900">Private (1:1) Caregiver</p>
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700"><Clock className="h-3 w-3" /> Awaiting your approval</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-black leading-none text-slate-900">{peso(a.rate)}</p>
                    <p className="mt-1 text-xs font-medium text-slate-500">{RATE_UNIT_LABEL[a.rateUnit]}</p>
                  </div>
                </div>

                {/* Detail grid */}
                <div className="grid gap-px bg-slate-100 sm:grid-cols-2">
                  <Detail label="Caregiver" value={a.caregiverName} />
                  <Detail label="Resident" value={`${a.residentName}${a.room ? ` · Room ${a.room}` : ""}`} />
                  <Detail label="Schedule" value={a.schedule} />
                  <Detail label="Requested by" value={`${a.requestedBy} · ${fmtDate(a.requestedAt)}`} />
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-2 px-5 py-4">
                  <button disabled={busyId === a.id} onClick={() => decide(a, "DECLINE")}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-red-300 hover:text-red-600 disabled:opacity-50">
                    <X className="h-4 w-4" /> Decline
                  </button>
                  <button disabled={busyId === a.id} onClick={() => decide(a, "APPROVE")}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-green-700 active:scale-95 disabled:opacity-50">
                    <Check className="h-4 w-4" /> Approve &amp; activate
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {/* Appointment / referral approvals (raised with "Family Notified") */}
      {appts.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-teal-600" />
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Appointments awaiting approval</h2>
            <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-teal-100 px-1.5 text-xs font-bold text-teal-700">{appts.length}</span>
          </div>
          <div className="space-y-4">
            {appts.map((a) => (
              <div key={a.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-900/5">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
                  <div className="flex items-center gap-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-teal-600 text-white shadow-sm"><CalendarClock className="h-5 w-5" /></span>
                    <div>
                      <p className="text-[15px] font-bold text-slate-900">{a.appointmentType}</p>
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700"><Clock className="h-3 w-3" /> Awaiting your approval</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-900">{fmtDateTime(a.scheduledDate)}</p>
                    <p className="text-xs font-medium text-slate-500">Proposed time</p>
                  </div>
                </div>
                <div className="grid gap-px bg-slate-100 sm:grid-cols-2">
                  <Detail label="Resident" value={`${a.residentName}${a.room ? ` · Room ${a.room}` : ""}`} />
                  <Detail label="Specialist / clinic" value={[a.specialist, a.facilityName].filter((x) => x && x !== "—").join(" · ") || "—"} />
                  <Detail label="Reason" value={a.reason} />
                  <Detail label="Requested by" value={`${a.requestedBy} · ${fmtDate(a.requestedAt)}`} />
                </div>
                <div className="flex items-center justify-end gap-2 px-5 py-4">
                  <button disabled={busyId === a.id} onClick={() => decideAppt(a, "DECLINE")}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-red-300 hover:text-red-600 disabled:opacity-50">
                    <X className="h-4 w-4" /> Decline
                  </button>
                  <button disabled={busyId === a.id} onClick={() => decideAppt(a, "APPROVE")}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-green-700 active:scale-95 disabled:opacity-50">
                    <Check className="h-4 w-4" /> Approve &amp; schedule
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Decided — history */}
      {decided.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">History</h2>
          <div className="space-y-2">
            {decided.map((a) => {
              const meta = PRIVATE_CARE_STATUS_META[a.status];
              const approved = a.status === "ACTIVE";
              return (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-center gap-3">
                    {approved ? <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" /> : <XCircle className="h-5 w-5 shrink-0 text-slate-400" />}
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{a.caregiverName} · {a.residentName}</p>
                      <p className="text-xs text-slate-500">{peso(a.rate)} {RATE_UNIT_LABEL[a.rateUnit]} · {a.decidedAt ? `${approved ? "Approved" : a.status === "DECLINED" ? "Declined" : "Ended"} ${fmtDate(a.decidedAt)}` : ""}{a.declineReason ? ` · ${a.declineReason}` : ""}</p>
                    </div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${meta.cls}`}>{meta.label}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

/** One labelled detail cell in the request card's grid. */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-5 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-800">{value || "—"}</p>
    </div>
  );
}
