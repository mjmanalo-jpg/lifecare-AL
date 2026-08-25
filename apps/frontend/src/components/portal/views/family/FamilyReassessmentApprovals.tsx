"use client";

import { useCallback, useEffect, useState } from "react";
import Swal from "sweetalert2";
import { Gauge, Check, X, Clock, CheckCircle2, XCircle, Inbox, ArrowRight } from "lucide-react";

/**
 * Family "Level of Care Changes" sign-off — the gate before a nurse/Care Manager
 * finalizes a reassessment (which changes the resident's level and their billing).
 * Styled to the family-portal card language; backed by /api/family/reassessment.
 */

type Signoff = {
  id: string; residentName?: string; oldLevel?: string; newLevel?: string; justification?: string;
  status?: string; submittedByName?: string; createdAt?: string;
  familyDecision?: "APPROVED" | "REJECTED"; familyDecidedByName?: string; familyDecidedAt?: string; familyRejectReason?: string;
};

const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
const lvlNum = (v?: string) => (v || "").replace(/^L/i, "");

export default function FamilyReassessmentApprovals() {
  const [items, setItems] = useState<Signoff[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<Signoff | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectBusy, setRejectBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/family/reassessment", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      setItems(Array.isArray(body.signoffs) ? body.signoffs : []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const decide = async (sg: Signoff, decision: "APPROVE" | "REJECT", reason = "") => {
    setBusyId(sg.id);
    try {
      const res = await fetch("/api/family/reassessment", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sg.id, decision, reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save your decision");
      await load();
      Swal.fire({ toast: true, position: "top-end", icon: "success", showConfirmButton: false, timer: 2400,
        title: decision === "APPROVE" ? "Signed off — sent to the care team to finalize" : "Level-of-care change rejected" });
    } catch (e) {
      Swal.fire({ title: "Something went wrong", text: e instanceof Error ? e.message : "Please try again", icon: "error" });
    } finally { setBusyId(null); }
  };

  const pending = items.filter((r) => r.status === "PENDING_FAMILY");
  const decided = items.filter((r) => r.familyDecidedAt).sort((a, b) => (b.familyDecidedAt || "").localeCompare(a.familyDecidedAt || ""));

  if (loading && items.length === 0) {
    return <div className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Loading level-of-care changes…</div>;
  }
  if (pending.length === 0 && decided.length === 0) return null; // nothing to show — keep the tab uncluttered

  return (
    <section className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-2">
        <Gauge className="h-4 w-4 text-indigo-600" />
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Level of Care Changes</h2>
        {pending.length > 0 && <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-amber-100 px-1.5 text-xs font-bold text-amber-700">{pending.length}</span>}
      </div>

      {pending.map((sg) => {
        const busy = busyId === sg.id;
        return (
          <div key={sg.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-900/5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white shadow-sm"><Gauge className="h-5 w-5" /></span>
                <div>
                  <p className="text-[15px] font-bold text-slate-900">{sg.residentName || "Your relative"}</p>
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700"><Clock className="h-3 w-3" /> Awaiting your sign-off</span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-slate-900">
                <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-sm font-bold text-slate-500">Level {lvlNum(sg.oldLevel) || "?"}</span>
                <ArrowRight className="h-4 w-4 text-slate-400" />
                <span className="rounded-lg bg-indigo-600 px-2.5 py-1 text-sm font-bold text-white">Level {lvlNum(sg.newLevel) || "?"}</span>
              </div>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 px-3.5 py-2.5 text-sm text-indigo-900">
                A care reassessment recommends changing the level of care. Because the level of care affects the monthly care fee, your sign-off is needed before it takes effect.
              </div>
              {sg.justification && <div className="text-sm text-slate-700"><span className="font-bold text-slate-800">Clinical rationale: </span>{sg.justification}</div>}
              {sg.submittedByName && <p className="text-xs text-slate-400">Reassessed by {sg.submittedByName}{sg.createdAt ? ` · ${fmtDate(sg.createdAt)}` : ""}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button disabled={busy} onClick={() => { setRejectFor(sg); setRejectReason(""); }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-red-300 hover:text-red-600 disabled:opacity-50">
                <X className="h-4 w-4" /> Reject
              </button>
              <button disabled={busy} onClick={() => void decide(sg, "APPROVE")}
                className="inline-flex items-center gap-1.5 rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-green-700 active:scale-95 disabled:opacity-50">
                <Check className="h-4 w-4" /> {busy ? "Saving…" : "Approve & sign off"}
              </button>
            </div>
          </div>
        );
      })}

      {decided.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">Recent decisions</p>
          <div className="space-y-2">
            {decided.slice(0, 6).map((sg) => {
              const ok = sg.familyDecision === "APPROVED";
              return (
                <div key={sg.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm ring-1 ring-slate-900/5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${ok ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-500"}`}>{ok ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">{sg.residentName || "Your relative"} — Level {lvlNum(sg.oldLevel)}→{lvlNum(sg.newLevel)}</p>
                      <p className="text-xs text-slate-500">You {ok ? "signed off" : "rejected"} on {fmtDate(sg.familyDecidedAt)}{!ok && sg.familyRejectReason ? ` · "${sg.familyRejectReason}"` : ""}</p>
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
            <h3 className="text-base font-bold text-slate-900">Reject this level-of-care change?</h3>
            <p className="mt-1 text-sm text-slate-500">Let the care team know your concern. They&apos;ll review and can resubmit for your approval.</p>
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} placeholder="Reason (optional)"
              className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setRejectFor(null)} disabled={rejectBusy} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
              <button onClick={async () => { const sg = rejectFor; setRejectBusy(true); try { await decide(sg, "REJECT", rejectReason.trim()); setRejectFor(null); } finally { setRejectBusy(false); } }} disabled={rejectBusy}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60">{rejectBusy ? "Rejecting…" : "Reject change"}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
