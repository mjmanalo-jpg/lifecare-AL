"use client";

import { useCallback, useEffect, useState } from "react";
import Swal from "sweetalert2";
import { ClipboardList, Check, X, Clock, CheckCircle2, XCircle, Target, ListChecks, CalendarClock, Inbox } from "lucide-react";

/**
 * Family "Care Plan Reviews" sign-off — the gate before a Care Manager finalizes a
 * plan. Shows care plan reviews awaiting this sponsor (with the actual plan goals +
 * interventions) and lets them Approve or Reject. Styled to the family-portal card
 * language (see FamilyApprovals); backed by /api/family/care-plan-review.
 */

type Review = {
  id: string; residentName?: string; room?: string; decision: string; reason?: string;
  levelAtReview?: number; reviewDate?: string; nextReviewDate?: string; reviewedBy?: string; createdAt?: string;
  approvalStatus?: string; familyDecision?: "APPROVED" | "REJECTED"; familyDecidedByName?: string;
  familyDecidedAt?: string; familyRejectReason?: string;
  planTitle?: string; planGoals?: string; planInterventions?: string;
};

const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
const lines = (v?: string) => (v || "").split("\n").map((x) => x.trim()).filter(Boolean);

function ListBlock({ icon: Icon, title, items }: { icon: typeof Target; title: string; items: string[] }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400"><Icon className="h-3.5 w-3.5 text-indigo-500" /> {title}</p>
      <ul className="space-y-1.5 text-sm text-slate-700">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2.5"><span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" /><span>{t}</span></li>
        ))}
      </ul>
    </div>
  );
}

export default function FamilyCarePlanApprovals() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<Review | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectBusy, setRejectBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/family/care-plan-review", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      setReviews(Array.isArray(body.reviews) ? body.reviews : []);
    } catch { setReviews([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const decide = async (rv: Review, decision: "APPROVE" | "REJECT", reason = "") => {
    setBusyId(rv.id);
    try {
      const res = await fetch("/api/family/care-plan-review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rv.id, decision, reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save your decision");
      await load();
      Swal.fire({ toast: true, position: "top-end", icon: "success", showConfirmButton: false, timer: 2400,
        title: decision === "APPROVE" ? "Signed off — sent to the care team to finalize" : "Care plan review rejected" });
    } catch (e) {
      Swal.fire({ title: "Something went wrong", text: e instanceof Error ? e.message : "Please try again", icon: "error" });
    } finally { setBusyId(null); }
  };

  const pending = reviews.filter((r) => r.approvalStatus === "PENDING_FAMILY");
  const decided = reviews.filter((r) => r.familyDecidedAt).sort((a, b) => (b.familyDecidedAt || "").localeCompare(a.familyDecidedAt || ""));

  return (
    <section className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-2">
        <ClipboardList className="h-4 w-4 text-indigo-600" />
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Care Plan Reviews</h2>
        {pending.length > 0 && <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-amber-100 px-1.5 text-xs font-bold text-amber-700">{pending.length}</span>}
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Loading care plan reviews…</div>
      ) : pending.length === 0 && decided.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
          <Inbox className="h-8 w-8 text-slate-300" />
          <p className="text-sm font-semibold text-slate-600">No care plan reviews need your sign-off</p>
          <p className="text-xs text-slate-400">When the care team updates a plan, it appears here for your approval.</p>
        </div>
      ) : null}

      {pending.map((rv) => {
        const goals = lines(rv.planGoals);
        const interventions = lines(rv.planInterventions);
        const busy = busyId === rv.id;
        return (
          <div key={rv.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-900/5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white shadow-sm"><ClipboardList className="h-5 w-5" /></span>
                <div>
                  <p className="text-[15px] font-bold text-slate-900">{rv.residentName || "Your relative"}{rv.room ? <span className="ml-1.5 text-sm font-medium text-slate-400">Rm {rv.room}</span> : null}</p>
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700"><Clock className="h-3 w-3" /> Awaiting your sign-off</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-slate-900">{rv.decision}</p>
                {rv.levelAtReview ? <p className="mt-0.5 text-xs font-medium text-slate-500">Level {rv.levelAtReview}</p> : null}
              </div>
            </div>

            <div className="space-y-4 px-5 py-4">
              {rv.reason && (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 px-3.5 py-2.5 text-sm text-indigo-900">
                  <span className="font-bold text-indigo-800">Why: </span>{rv.reason}
                </div>
              )}
              {goals.length > 0 && <ListBlock icon={Target} title="Care goals" items={goals} />}
              {interventions.length > 0 && <ListBlock icon={ListChecks} title="What the team will do" items={interventions} />}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-400">
                {rv.reviewedBy && <span>Reviewed by {rv.reviewedBy}</span>}
                {rv.nextReviewDate && <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> Next review {fmtDate(rv.nextReviewDate)}</span>}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button disabled={busy} onClick={() => { setRejectFor(rv); setRejectReason(""); }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-red-300 hover:text-red-600 disabled:opacity-50">
                <X className="h-4 w-4" /> Reject
              </button>
              <button disabled={busy} onClick={() => void decide(rv, "APPROVE")}
                className="inline-flex items-center gap-1.5 rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-green-700 active:scale-95 disabled:opacity-50">
                <Check className="h-4 w-4" /> {busy ? "Saving…" : "Approve & sign off"}
              </button>
            </div>
          </div>
        );
      })}

      {decided.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Recent decisions</h2>
          </div>
          <div className="space-y-2">
            {decided.slice(0, 6).map((rv) => {
              const ok = rv.familyDecision === "APPROVED";
              return (
                <div key={rv.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm ring-1 ring-slate-900/5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${ok ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-500"}`}>{ok ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">{rv.residentName || "Your relative"} — {rv.decision}</p>
                      <p className="text-xs text-slate-500">You {ok ? "signed off" : "rejected"} on {fmtDate(rv.familyDecidedAt)}{!ok && rv.familyRejectReason ? ` · "${rv.familyRejectReason}"` : ""}</p>
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${ok ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-600"}`}>{ok ? "Approved" : "Rejected"}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {rejectFor && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setRejectFor(null); }}>
          <div className="w-full rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-2xl">
            <h3 className="text-base font-bold text-slate-900">Reject this care plan review?</h3>
            <p className="mt-1 text-sm text-slate-500">Let the care team know what should change. They&apos;ll revise and resend it for your approval.</p>
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} placeholder="Reason (optional)"
              className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setRejectFor(null)} disabled={rejectBusy} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
              <button onClick={async () => { const rv = rejectFor; setRejectBusy(true); try { await decide(rv, "REJECT", rejectReason.trim()); setRejectFor(null); } finally { setRejectBusy(false); } }} disabled={rejectBusy}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60">{rejectBusy ? "Rejecting…" : "Reject review"}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
