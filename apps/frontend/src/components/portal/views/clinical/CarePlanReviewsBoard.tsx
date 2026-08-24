"use client";

/**
 * Care Plan Reviews — review resident indicators, evaluate triggers (ICP / ISP /
 * LOC), and record a Nurse/Admin care-plan decision. Tabs: New Review, Reviews
 * Due, History. Recent indicators + triggers derive from the resident's incidents
 * (last 30 days). Migration-free: reviews are a JSON array in the app-setting
 * `care_plan_reviews`.
 */

import { useMemo, useState } from "react";
import { ClipboardList, ListChecks, Loader2, AlertTriangle } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord, updateRecord } from "@/lib/api";
import { generateCarePlanForResident, releaseCarePlan, materializeTodayTasks, levelPlan, levelCareTasks, parseAssistanceOptions, type PlanIntervention } from "@/lib/carePlanGen";
import { duplicateReview, requiresSecondApproval, reviewOutcome, type CarePlanReviewApprovalStatus } from "@/lib/lifecare/carePlanReviewGuards";
import { levelMeta } from "@/lib/lifecare/levelModel";
import { adaptResident } from "@/lib/adapters";
import { useClinician, type ClinicianRole } from "./useClinician";
import { levelOf } from "./CareLogsBoard";
import { ClinicalButton, ClinicalCard, ClinicalModal, StatCard, DataState, FieldLabel, controlClass, StatusPill, SERIF } from "./clinical-ui";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const REVIEW_KEY = "care_plan_reviews";
const s = (v: unknown) => (v == null ? "" : String(v));
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
const newId = () => globalThis.crypto?.randomUUID?.() ?? `rev-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const isoDate = (d: Date) => d.toISOString().split("T")[0];
const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
const fmt = (isoStr: string) => (isoStr ? new Date(isoStr + (isoStr.length <= 10 ? "T00:00:00" : "")).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");
const periodOf = (d: Date) => `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;

const DECISIONS = ["Continue Current Plan", "Update Care Plan", "Escalate Level of Care", "De-escalate Level of Care", "Refer to Physician", "Schedule Family Conference"];
// Decisions that DON'T release a held plan — the plan stays held for follow-up.
const HOLD_DECISIONS = new Set(["Refer to Physician", "Schedule Family Conference"]);
const PLAN_STATUS = ["No Change", "Updated", "Under Review", "Escalated", "De-escalated"];

interface Review {
  id: string; residentId: string; reviewDate: string; reviewPeriod: string; levelAtReview: number;
  nextReviewDate?: string; carePlanStatus: string; familyUpdate: boolean; physicianFollowup: boolean;
  decision: string; reason?: string; actionPlan?: string; responsible?: string; targetDate?: string;
  reviewedBy?: string; createdAt: string;
  // Governance workflow (migration-free): a review can release the plan directly (single
  // nursing approval) or wait in the Pending Approval queue for a second authorized approver
  // (LOC-change decisions) or for incomplete activation gates.
  approvalStatus?: CarePlanReviewApprovalStatus; // APPROVED (released/recorded) | PENDING | REJECTED
  planId?: string;                                // the draft this review targets
  submittedById?: string;                         // reviewer's User id (segregation of duties)
  approvedById?: string; approvedByName?: string; approvedAt?: string;
  rejectionReason?: string;                       // set on REJECTED
  pendingReason?: string;                         // why it's awaiting approval (missing gates / LOC change)
}
const parseReviews = (raw: string | null | undefined): Review[] => { if (!raw) return []; try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((r) => r && typeof r.id === "string") : []; } catch { return []; } };

export default function CarePlanReviewsBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const { name: clinicianName, userId: clinicianId } = useClinician(clinicianRole);
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const incQ = useLiveQuery<Row>("incidents", { query: "take=400", tables: ["Incident"] });
  const ceQ = useLiveQuery<Row>("care-events", { query: "take=1000", tables: ["CareEvent"] });
  const { data: settingRows, loading, error, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  const cpQ = useLiveQuery<Row>("care-plans", { query: "take=300", tables: ["CarePlan"] });
  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const reviews = useMemo(() => parseReviews(settingRows.find((r) => (r.key || r.id) === REVIEW_KEY)?.value), [settingRows]);
  const residentsWithPlan = useMemo(() => new Set((cpQ.data || []).filter((p) => s(p.status) !== "DISCONTINUED").map((p) => s(p.residentId))), [cpQ.data]);
  // Held (DRAFT) plans awaiting review approval, keyed by resident.
  const draftPlansByResident = useMemo(() => {
    const m = new Map<string, Row[]>();
    (cpQ.data || []).filter((p) => s(p.status) === "DRAFT").forEach((p) => { const rid = s(p.residentId); const g = m.get(rid) || []; g.push(p); m.set(rid, g); });
    return m;
  }, [cpQ.data]);

  const [tab, setTab] = useState<"new" | "due" | "history" | "pending">("new");
  const [resId, setResId] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [actingId, setActingId] = useState("");
  // Pending "generate care plan" confirmation (bespoke modal replaces the generic Swal confirm).
  const [genConfirm, setGenConfirm] = useState<{ plan?: { title?: string; goals: string[]; interventions: PlanIntervention[] }; already: boolean } | null>(null);

  // Reviews awaiting approval (LOC-change second sign-off, or incomplete activation gates).
  const pendingReviews = useMemo(() => reviews.filter((r) => r.approvalStatus === "PENDING"), [reviews]);

  const today = new Date();
  const resident = residents.find((r: Row) => s(r.id) === resId) || null;

  const latestReview = (rid: string) => reviews.filter((r) => r.residentId === rid).sort((a, b) => (b.reviewDate || "").localeCompare(a.reviewDate || ""))[0];

  // Recent incidents (last 30 days) for the selected resident → indicators + triggers.
  const recentInc = useMemo(() => {
    if (!resId) return [];
    const cutoff = addMonths(today, 0); cutoff.setDate(cutoff.getDate() - 30);
    return (incQ.data || []).filter((i) => s(i.residentId) === resId && new Date(s(i.incidentDate || i.createdAt)) >= cutoff);
  }, [incQ.data, resId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recent care-event variances (last 30 days) — the ICP triggers from delivery.
  const recentVariances = useMemo(() => {
    if (!resId) return [];
    const cutoff = addMonths(today, 0); cutoff.setDate(cutoff.getDate() - 30);
    return (ceQ.data || []).filter((c) => s(c.residentId) === resId && (c.isException || c.isVariance) && new Date(s(c.createdAt || c.occurredAt)) >= cutoff);
  }, [ceQ.data, resId]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = async (next: Review[]) => { await upsertRecord("app-settings", REVIEW_KEY, { key: REVIEW_KEY, value: JSON.stringify(next) }); await refetch(); };

  // Manual fallback for the Stage 8/9 handoff — build a care plan + caregiver tasks
  // from the resident's current Level of Care (for residents approved before the
  // auto-generation, or missing a plan).
  // Generate a care plan + caregiver tasks. `plan` (from the ICP editor) makes it
  // richer — the nurse's individualized interventions/frequency/notes replace the
  // baseline template. Omitted → the Level-N baseline package is used as before.
  // Open the confirmation modal; the actual generation runs on confirm (runGenerate).
  const genPlan = (plan?: { title?: string; goals: string[]; interventions: PlanIntervention[] }) => {
    if (!resident || genBusy) return;
    setGenConfirm({ plan, already: residentsWithPlan.has(s(resident.id)) });
  };

  const runGenerate = async (plan?: { title?: string; goals: string[]; interventions: PlanIntervention[] }) => {
    if (!resident || genBusy) return;
    const n = levelOf(resident).n;
    setGenConfirm(null);
    setGenBusy(true);
    try {
      const raw = (resident.raw || {}) as Row;
      const { interventionCount } = await generateCarePlanForResident({ residentId: s(resident.id), level: n, communityId: s(raw.communityId) || undefined, createdByName: clinicianName, plan, hold: true });
      await cpQ.refetch?.();
      Swal.fire({ icon: "success", title: "Draft care plan created", html: `Level ${n} plan with <b>${interventionCount} intervention${interventionCount === 1 ? "" : "s"}</b> prepared and <b>held</b>. Submit the care plan review below — once approved, tasks are generated daily for the resident's scheduled caregiver.`, timer: 3600, showConfirmButton: false });
    } catch (e) { Swal.fire("Couldn't generate", e instanceof Error ? e.message : "Please try again.", "error"); }
    finally { setGenBusy(false); }
  };

  // Approve a pending review (second authorized sign-off / gate completion): release the
  // held plan and mark the review approved. Segregation of duties — the reviewer who
  // submitted a LOC change cannot self-approve it.
  const approvePending = async (rv: Review) => {
    if (!rv.planId) { Swal.fire("No linked plan", "This review has no draft plan to release.", "error"); return; }
    if (rv.submittedById && rv.submittedById === clinicianId) {
      Swal.fire({ icon: "warning", title: "Second approver required", text: "A level-of-care change must be approved by someone other than the reviewer who submitted it." });
      return;
    }
    const c = await Swal.fire({ title: "Approve & release plan?", text: `Approve "${rv.decision}" and release this resident's care plan?`, icon: "question", showCancelButton: true, confirmButtonColor: "#4F46E5", confirmButtonText: "Approve & release" });
    if (!c.isConfirmed) return;
    setActingId(rv.id);
    try {
      await releaseCarePlan(s(rv.planId), { approvedByName: clinicianName, effectiveDate: rv.reviewDate, nextReviewDate: rv.nextReviewDate || "" });
      const dispatched = await materializeTodayTasks();
      await persist(reviews.map((r) => (r.id === rv.id ? { ...r, approvalStatus: "APPROVED" as const, approvedById: clinicianId, approvedByName: clinicianName, approvedAt: new Date().toISOString(), pendingReason: undefined } : r)));
      await cpQ.refetch?.();
      Swal.fire({ icon: "success", title: "Approved · plan released", html: dispatched > 0 ? `${dispatched} task${dispatched === 1 ? "" : "s"} dispatched to today's scheduled caregiver.` : "Plan is now active.", timer: 3200, showConfirmButton: false });
    } catch (e) { Swal.fire("Couldn't release", e instanceof Error ? e.message : "The plan's activation gates are still incomplete.", "error"); }
    finally { setActingId(""); }
  };

  // Reject a pending review: record the reason, revert the held draft to DRAFT so it can be
  // revised and re-reviewed.
  const rejectPending = async (rv: Review) => {
    const c = await Swal.fire({ title: "Reject review?", input: "textarea", inputLabel: "Reason for rejection", inputPlaceholder: "Explain what must change before this plan can be approved…", showCancelButton: true, confirmButtonColor: "#dc2626", confirmButtonText: "Reject", inputValidator: (v: string) => (!v || v.trim().length < 4 ? "A reason is required." : undefined) });
    if (!c.isConfirmed) return;
    setActingId(rv.id);
    try {
      if (rv.planId) { try { await updateRecord("care-plans", s(rv.planId), { status: "DRAFT" }); } catch { /* best-effort */ } }
      await persist(reviews.map((r) => (r.id === rv.id ? { ...r, approvalStatus: "REJECTED" as const, rejectionReason: String(c.value || "").trim(), pendingReason: undefined } : r)));
      await cpQ.refetch?.();
      Swal.fire({ toast: true, position: "top-end", icon: "info", title: "Review rejected · plan returned to draft", showConfirmButton: false, timer: 2200 });
    } catch (e) { Swal.fire("Couldn't reject", e instanceof Error ? e.message : "Please try again.", "error"); }
    finally { setActingId(""); }
  };

  // Reviews Due: residents whose next review has passed, or who've never been reviewed.
  const dueList = useMemo(() => residents.map((r: Row) => {
    const last = latestReview(s(r.id));
    const due = !last || (last.nextReviewDate ? last.nextReviewDate <= isoDate(today) : false);
    return { r, last, due };
  }).filter((x) => x.due), [residents, reviews]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="-m-4 sm:-m-6 p-4 sm:p-6 min-h-full space-y-5" style={{ background: "#F7F8FA" }}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.75rem]">Care Plan Reviews</h1>
        <p className="mt-1 text-sm text-slate-500">Review resident indicators, evaluate triggers, and make care plan decisions</p>
      </div>

      <div className="flex items-center gap-2" role="tablist" aria-label="Care plan reviews view">
        {([["new", "New Review"], ["pending", "Pending Approval"], ["due", "Reviews Due"], ["history", "History"]] as const).map(([v, label]) => (
          <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)} className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${tab === v ? "bg-[#4F46E5] text-white shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{label}{v === "due" && dueList.length ? ` (${dueList.length})` : ""}{v === "pending" && pendingReviews.length ? ` (${pendingReviews.length})` : ""}</button>
        ))}
      </div>

      {tab === "new" && (
        <div className="space-y-4">
          <ClinicalCard className="p-5">
            <FieldLabel htmlFor="cpr-res">Select Resident</FieldLabel>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <select id="cpr-res" value={resId} onChange={(e) => setResId(e.target.value)} className={`${controlClass} max-w-md`}>
                <option value="">Choose a resident…</option>
                {residents.map((r: Row) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — Rm {s(r.room)} (Level {levelOf(r).n})</option>)}
              </select>
              {resident && (
                <ClinicalButton variant="secondary" onClick={() => genPlan()} disabled={genBusy} className="shrink-0">
                  {genBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
                  {residentsWithPlan.has(resId) ? "Regenerate baseline plan" : "Generate baseline plan"}
                </ClinicalButton>
              )}
            </div>
            {resident && <p className="mt-2 text-xs text-[var(--clinical-muted)]">Builds a Level {levelOf(resident).n} plan from the approved level of care and spins the interventions <b>included in that level&apos;s package</b> into caregiver tasks — routed straight to the caregiver scheduled for this resident today. Auto-runs on Care Acuity approval — use this for residents approved earlier.</p>}
          </ClinicalCard>

          {!resident && (
            <div className="@container">
              <p className="mb-3 text-sm text-[var(--clinical-muted)]">Or tap a resident to start their care plan review</p>
              {residents.length === 0 ? (
                <p className="text-sm text-[var(--clinical-muted)]">No residents found.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 @lg:grid-cols-3 @3xl:grid-cols-4 @5xl:grid-cols-5">
                  {residents.map((r: Row, i: number) => { const lv = levelOf(r); return (
                    <button key={s(r.id)} onClick={() => setResId(s(r.id))}
                      className="group flex flex-col items-center gap-2.5 rounded-xl border p-4 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md animate-in fade-in slide-in-from-bottom-2 duration-300"
                      style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)", animationDelay: `${i * 40}ms`, animationFillMode: "backwards" }}>
                      <span className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold" style={{ backgroundColor: "var(--clinical-surface-2)", color: "var(--clinical-panel)" }}>{initials(s(r.name))}</span>
                      <span className="block w-full min-w-0">
                        <span className="block truncate text-sm font-semibold text-[var(--clinical-ink)]">{s(r.name)}</span>
                        <span className="block text-xs text-[var(--clinical-muted)]">Room {s(r.room)} · Level {lv.n}</span>
                      </span>
                    </button>
                  ); })}
                </div>
              )}
            </div>
          )}

          {resident && <CarePlanBuilder key={resId} level={levelOf(resident).n} genBusy={genBusy} onGenerate={genPlan} />}

          {resident && <ReviewForm resident={resident} recentInc={recentInc} recentVariances={recentVariances} last={latestReview(resId)} reviewedBy={clinicianName} heldPlanCount={(draftPlansByResident.get(resId) || []).length}
            onSubmit={async (rec) => {
              // Idempotency (governance): block a duplicate review for the same resident in
              // the same review period. LOC-change decisions are exempt (reassessment-driven).
              const dup = duplicateReview(reviews, rec.residentId, rec.reviewPeriod, rec.decision);
              if (dup) {
                Swal.fire({ icon: "warning", title: "Review already submitted",
                  text: `A care plan review for this resident already exists for ${rec.reviewPeriod} (submitted ${fmt(dup.reviewDate || (dup.createdAt || "").slice(0, 10))}${dup.approvalStatus === "PENDING" ? " · awaiting approval" : ""}). Open History, or wait for the next review period.` });
                return;
              }

              const drafts = [...(draftPlansByResident.get(rec.residentId) || [])]
                .sort((a, b) => s(b.createdAt || b.startDate).localeCompare(s(a.createdAt || a.startDate)));
              const targetPlan = drafts[0];
              const now = new Date().toISOString();
              const base = { ...rec, id: newId(), createdAt: now, submittedById: clinicianId, planId: targetPlan ? s(targetPlan.id) : undefined };

              // LOC-change decisions need a SECOND authorized approver (Step 6): route to the
              // Pending Approval queue and hold the draft — do NOT release now.
              if (requiresSecondApproval(rec.decision) && targetPlan) {
                try { await updateRecord("care-plans", s(targetPlan.id), { status: "UNDER_REVIEW" }); } catch { /* status flip is best-effort */ }
                await persist([{ ...base, approvalStatus: "PENDING", pendingReason: `${rec.decision} — requires a second authorized approver.` }, ...reviews]);
                await cpQ.refetch?.();
                setResId(""); setTab("pending");
                Swal.fire({ icon: "info", title: "Sent for authorized approval", text: "This level-of-care change needs a second authorized approver before the plan is released. It is now in Pending Approval." });
                return;
              }

              // Single nursing approval (Step 9): releasing = flip the held draft to ACTIVE; the
              // materializer then spins today's tasks for the scheduled caregiver.
              const isHold = HOLD_DECISIONS.has(rec.decision);
              const willRelease = !!targetPlan && !isHold;
              let dispatched = 0;
              if (willRelease) {
                try {
                  await releaseCarePlan(s(targetPlan.id), { approvedByName: rec.reviewedBy || clinicianName, effectiveDate: rec.reviewDate, nextReviewDate: rec.nextReviewDate || "" });
                  dispatched = await materializeTodayTasks();
                  await cpQ.refetch?.();
                } catch (error) {
                  // Activation gates incomplete → durable Awaiting-approval state (visible in the
                  // Pending Approval queue with the missing gates), not a fleeting toast.
                  const why = error instanceof Error ? error.message : "Activation gates incomplete.";
                  try { await updateRecord("care-plans", s(targetPlan.id), { status: "UNDER_REVIEW" }); } catch { /* best-effort */ }
                  await persist([{ ...base, approvalStatus: "PENDING", pendingReason: why }, ...reviews]);
                  await cpQ.refetch?.();
                  setResId(""); setTab("pending");
                  Swal.fire({ icon: "warning", title: "Plan held — activation gates incomplete", text: `${why} Complete the plan, then approve it from Pending Approval.` });
                  return;
                }
              }
              await persist([{ ...base, approvalStatus: "APPROVED", approvedByName: willRelease ? (rec.reviewedBy || clinicianName) : undefined, approvedById: willRelease ? clinicianId : undefined, approvedAt: willRelease ? now : undefined }, ...reviews]);
              setResId(""); setTab("history");
              if (willRelease) {
                Swal.fire({ icon: "success", title: "Review approved · plan released", html: dispatched > 0
                  ? `${dispatched} task${dispatched === 1 ? "" : "s"} dispatched to today's scheduled caregiver${dispatched === 1 ? "" : "s"}. The plan will keep generating tasks daily for whoever covers the resident.`
                  : `Plan is now active. Tasks will appear for the resident's caregiver on days one is scheduled (none scheduled today).`, timer: 3600, showConfirmButton: false });
              } else if (isHold && targetPlan) {
                Swal.fire({ toast: true, position: "top-end", icon: "info", title: "Review submitted · plan kept on hold", showConfirmButton: false, timer: 2400 });
              } else {
                Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Care plan review submitted", showConfirmButton: false, timer: 1800 });
              }
            }} />}
        </div>
      )}

      {tab === "due" && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard value={residents.length} label="Residents" accent="ink" />
            <StatCard value={dueList.length} label="Reviews Due" accent="amber" />
            <StatCard value={dueList.filter((x) => !x.last).length} label="Never Reviewed" accent="coral" />
            <StatCard value={reviews.length} label="Total Reviews" accent="teal" />
          </div>
          <ClinicalCard className="p-5">
            <p className="mb-3 font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>Residents Needing Review</p>
            <DataState
              loading={loading && reviews.length === 0}
              error={error}
              empty={dueList.length === 0}
              emptyTitle="No reviews due"
              emptyHint="All care plans are up to date."
              onRetry={() => void refetch()}
              skeletonRows={3}
            >
              <div className="space-y-2">
                {dueList.map(({ r, last }) => {
                  const lastReview = last ? fmt(last.reviewDate) : "Never";
                  const overdue = !last?.nextReviewDate || last.nextReviewDate <= isoDate(today);
                  const nextDue = last?.nextReviewDate && last.nextReviewDate > isoDate(today) ? fmt(last.nextReviewDate) : "Overdue";
                  return (
                    <div key={s(r.id)} className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-[var(--clinical-ink)]">{s(r.name)} — Rm {s(r.room)}</p>
                          {overdue && <StatusPill status="OVERDUE" />}
                        </div>
                        <p className="text-xs text-[var(--clinical-muted)]">Level {levelOf(r).n} • Last review: {lastReview} • Next due: {nextDue}</p>
                      </div>
                      <ClinicalButton variant="primary" size="sm" className="shrink-0" onClick={() => { setResId(s(r.id)); setTab("new"); }}>Start Review</ClinicalButton>
                    </div>
                  );
                })}
              </div>
            </DataState>
          </ClinicalCard>
        </>
      )}

      {tab === "pending" && (
        <DataState
          loading={loading && reviews.length === 0}
          error={error}
          empty={pendingReviews.length === 0}
          emptyTitle="Nothing awaiting approval"
          emptyHint="Level-of-care changes and plans with incomplete activation gates appear here for authorized approval."
          onRetry={() => void refetch()}
          skeletonRows={3}
        >
          <div className="space-y-3">
            {pendingReviews.map((rv) => {
              const r = residents.find((x: Row) => s(x.id) === rv.residentId);
              const mine = !!rv.submittedById && rv.submittedById === clinicianId;
              const acting = actingId === rv.id;
              return (
                <ClinicalCard key={rv.id} className="p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold text-[var(--clinical-ink)]">{s(r?.name) || "Resident"} <span className="text-xs font-normal text-[var(--clinical-muted)]">Rm {s(r?.room)}</span></p>
                        <StatusPill status={requiresSecondApproval(rv.decision) ? "AWAITING APPROVAL" : "GATES INCOMPLETE"} />
                      </div>
                      <p className="mt-1 text-sm text-[var(--clinical-ink-soft)]"><b>{rv.decision}</b> · Level {rv.levelAtReview} · {rv.reviewPeriod}</p>
                      {rv.pendingReason && <p className="mt-1 text-xs" style={{ color: "var(--clinical-coral)" }}>{rv.pendingReason}</p>}
                      {rv.reason && <p className="mt-1 text-xs text-[var(--clinical-muted)]">Rationale: {rv.reason}</p>}
                      <p className="mt-1 text-xs text-[var(--clinical-muted)]">Submitted {fmt((rv.createdAt || "").slice(0, 10))}{rv.reviewedBy ? ` by ${rv.reviewedBy}` : ""}</p>
                      {mine && <p className="mt-1.5 text-xs" style={{ color: "var(--clinical-coral)" }}>You submitted this review — a different authorized approver must release it.</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <ClinicalButton variant="secondary" size="sm" disabled={acting} onClick={() => void rejectPending(rv)}>Reject</ClinicalButton>
                      <ClinicalButton variant="primary" size="sm" disabled={acting || mine} onClick={() => void approvePending(rv)} title={mine ? "A second authorized approver is required" : undefined}>
                        {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />} Approve &amp; release
                      </ClinicalButton>
                    </div>
                  </div>
                </ClinicalCard>
              );
            })}
          </div>
        </DataState>
      )}

      {tab === "history" && (
        <DataState
          loading={loading && reviews.length === 0}
          error={error}
          empty={reviews.length === 0}
          emptyTitle="No care plan reviews yet"
          emptyHint="Submitted reviews will appear here."
          onRetry={() => void refetch()}
          skeletonRows={4}
        >
          <div className="overflow-x-auto rounded-xl border" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="border-b text-left text-[var(--clinical-muted)]" style={{ borderColor: "var(--clinical-line)" }}><th className="px-4 py-2.5 font-semibold">Resident</th><th className="px-4 py-2.5 font-semibold">Date</th><th className="px-4 py-2.5 font-semibold">Level</th><th className="px-4 py-2.5 font-semibold">Decision</th><th className="px-4 py-2.5 font-semibold">Status</th><th className="px-4 py-2.5 font-semibold">By</th></tr></thead>
              <tbody>
                {[...reviews].sort((a, b) => (b.reviewDate || "").localeCompare(a.reviewDate || "")).map((rv) => { const r = residents.find((x: Row) => s(x.id) === rv.residentId); return (
                  <tr key={rv.id} className="border-b last:border-0" style={{ borderColor: "var(--clinical-line)" }}>
                    <td className="px-4 py-2.5"><span className="font-semibold text-[var(--clinical-ink)]">{s(r?.name) || "Resident"}</span> <span className="text-xs text-[var(--clinical-muted)]">Rm {s(r?.room)}</span></td>
                    <td className="px-4 py-2.5 text-[var(--clinical-ink-soft)]">{fmt(rv.reviewDate)} <span className="text-[var(--clinical-muted)]">· {rv.reviewPeriod}</span></td>
                    <td className="px-4 py-2.5 font-semibold text-[var(--clinical-ink-soft)]">Level {rv.levelAtReview}</td>
                    <td className="px-4 py-2.5 text-[var(--clinical-ink-soft)]">{rv.decision}</td>
                    <td className="px-4 py-2.5 text-[var(--clinical-ink-soft)]">{reviewOutcome({ decision: rv.decision, approvalStatus: rv.approvalStatus, released: !!rv.approvedAt, approvedByName: rv.approvedByName })}</td>
                    <td className="px-4 py-2.5 text-[var(--clinical-ink-soft)]">{rv.reviewedBy || "—"}</td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
        </DataState>
      )}
      {genConfirm && resident && (
        <ClinicalModal open onClose={() => setGenConfirm(null)} size="md"
          title="Generate care plan &amp; tasks?"
          description={`A Level ${levelOf(resident).n} plan for ${s(resident.name)} · ${genConfirm.plan ? `${genConfirm.plan.interventions.length} individualized intervention${genConfirm.plan.interventions.length === 1 ? "" : "s"}` : "baseline package"}`}
          footer={
            <>
              <ClinicalButton variant="secondary" onClick={() => setGenConfirm(null)} disabled={genBusy}>Cancel</ClinicalButton>
              <ClinicalButton variant="primary" onClick={() => void runGenerate(genConfirm.plan)} disabled={genBusy}>
                {genBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />} Generate draft
              </ClinicalButton>
            </>
          }
        >
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl border p-3" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface-2)" }}>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold" style={{ backgroundColor: "var(--clinical-surface)", color: "var(--clinical-panel)" }}>{initials(s(resident.name))}</span>
              <div className="min-w-0">
                <p className="truncate font-semibold text-[var(--clinical-ink)]">{s(resident.name)}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[var(--clinical-muted)]">
                  <span className="rounded-md px-1.5 py-0.5 font-bold text-white" style={{ backgroundColor: "var(--clinical-panel)" }}>Level {levelOf(resident).n}</span>
                  <span>Room {s(resident.room)}</span>
                  <span aria-hidden>·</span>
                  <span>{genConfirm.plan ? `${genConfirm.plan.interventions.length} individualized intervention${genConfirm.plan.interventions.length === 1 ? "" : "s"}` : "Baseline package"}</span>
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5 rounded-xl border p-3 text-sm" style={{ borderColor: "color-mix(in srgb, #4F46E5 35%, transparent)", backgroundColor: "color-mix(in srgb, #4F46E5 8%, transparent)", color: "var(--clinical-ink-soft)" }}>
              <ListChecks className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#4F46E5" }} />
              <p>The plan is <b className="text-[var(--clinical-ink)]">held as a draft</b> — its tasks are not sent to caregivers until you submit and approve the care plan review below.</p>
            </div>

            {genConfirm.already && (
              <div className="flex items-start gap-2.5 rounded-xl border p-3 text-sm" style={{ borderColor: "color-mix(in srgb, #b45309 40%, transparent)", backgroundColor: "color-mix(in srgb, #b45309 10%, transparent)", color: "var(--clinical-ink-soft)" }}>
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#b45309" }} />
                <p>This resident <b className="text-[var(--clinical-ink)]">already has a care plan</b> — generating creates another draft alongside it.</p>
              </div>
            )}
          </div>
        </ClinicalModal>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) { return <div><p className="text-[11px] uppercase tracking-[0.08em] text-[var(--clinical-muted)]">{label}</p><p className="text-sm font-semibold text-[var(--clinical-ink)]">{value || "—"}</p></div>; }
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <ClinicalCard className="p-5"><p className="mb-3 font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>{title}</p>{children}</ClinicalCard>; }
function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return <button type="button" role="switch" aria-checked={on} onClick={onClick} className="inline-flex items-center gap-2.5 text-sm text-[var(--clinical-ink-soft)]"><span className="relative h-5 w-10 rounded-full transition" style={{ backgroundColor: on ? "var(--clinical-panel)" : "var(--clinical-line-strong)" }}><span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: on ? "22px" : "2px" }} /></span>{label}</button>;
}

// Trigger chip — dot + label, coral when a trigger fired, muted when clear.
function TriggerLine({ label, trig }: { label: string; trig: string }) {
  return (
    <div className="border-b pb-3 last:border-0 last:pb-0" style={{ borderColor: "var(--clinical-line)" }}>
      <p className="text-sm font-bold text-[var(--clinical-ink)]">{label}</p>
      <p className="mt-0.5 inline-flex items-center gap-1.5 text-sm" style={{ color: trig ? "var(--clinical-coral)" : "var(--clinical-muted)" }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: trig ? "var(--clinical-coral)" : "var(--clinical-line-strong)" }} />
        {trig || "No triggers identified."}
      </p>
    </div>
  );
}

// ── Individualized Care Plan editor — the resident's Level-of-Care package ─────
// Interventions are the governed care_task_master tasks for THIS level only
// (levelCareTasks) — a Level-N resident's plan covers Level-N package tasks and
// nothing above/below. Each task is individualized (assistance / frequency / note).
const FREQ_OPTIONS = ["Every shift", "Daily", "Twice daily (BID)", "Three times daily (TID)", "Weekly", "PRN / as needed", "Per care plan"];

interface TaskItem {
  taskId: string; domain: string; name: string; intervention: string; goal: string;
  assistanceChoices: string[]; freqHint: string; prompt: string; responsibleRole: string;
  included: boolean; assistance: string; freq: string; note: string;
}

function CarePlanBuilder({ level, genBusy, onGenerate }: {
  level: number; genBusy: boolean;
  onGenerate: (plan: { title?: string; goals: string[]; interventions: PlanIntervention[] }) => void;
}) {
  const meta = levelMeta(level);
  const base = useMemo(() => levelPlan(level), [level]);
  const [goals, setGoals] = useState(() => base.goals.join("\n"));
  const [items, setItems] = useState<TaskItem[]>(() => levelCareTasks(level).map((t) => ({
    taskId: t.id, domain: t.domain, name: t.name, intervention: t.approvedIntervention || t.definition || "",
    goal: t.approvedGoal || "", assistanceChoices: parseAssistanceOptions(t.assistanceOptions), freqHint: t.frequencyOptions || "",
    prompt: t.residentGoalPrompt || "", responsibleRole: t.responsibleRole || t.primaryRole || "Caregiver",
    included: true, assistance: "", freq: "Daily", note: "",
  })));

  const patch = (id: string, p: Partial<TaskItem>) => setItems((arr) => arr.map((x) => (x.taskId === id ? { ...x, ...p } : x)));
  const setDomain = (domain: string, on: boolean) => setItems((arr) => arr.map((x) => (x.domain === domain ? { ...x, included: on } : x)));
  // Bulk-apply across a domain's INCLUDED tasks — set once, tweak exceptions. Frequency is
  // universal; assistance only lands on tasks that actually offer that governed option.
  const bulkFreq = (domain: string, freq: string) => setItems((arr) => arr.map((x) => (x.domain === domain && x.included ? { ...x, freq } : x)));
  const bulkAssist = (domain: string, assistance: string) => setItems((arr) => arr.map((x) => (x.domain === domain && x.included && x.assistanceChoices.includes(assistance) ? { ...x, assistance } : x)));
  const chosen = items.filter((x) => x.included);

  // Group tasks by domain for a navigable, level-scoped plan.
  const byDomain = useMemo(() => {
    const m = new Map<string, TaskItem[]>();
    for (const it of items) { const g = m.get(it.domain) || []; g.push(it); m.set(it.domain, g); }
    return Array.from(m.entries());
  }, [items]);

  const submit = () => {
    const incomplete = chosen.filter((it) => !it.freq || !it.note.trim() || (it.assistanceChoices.length > 0 && !it.assistance));
    if (incomplete.length) {
      Swal.fire({
        title: "Individualization incomplete",
        text: `Set assistance where applicable and add a resident-specific technique/preference note for: ${incomplete.slice(0, 6).map((it) => it.name).join(", ")}${incomplete.length > 6 ? ` and ${incomplete.length - 6} more` : ""}.`,
        icon: "warning",
      });
      return;
    }
    onGenerate({
      goals: goals.split("\n").map((g) => g.trim()).filter(Boolean),
      interventions: chosen.map((it) => ({
        domain: it.domain,
        title: it.name,
        freq: it.freq,
        taskId: it.taskId,
        note: [it.assistance && `Assistance: ${it.assistance}`, it.note.trim(), it.responsibleRole && `Role: ${it.responsibleRole}`].filter(Boolean).join(" · ") || undefined,
      })),
    });
  };

  return (
    <Section title="Individualized Care Plan">
      {/* Level-of-Care rationale — why this package applies */}
      {meta && (
        <div className="-mt-1 mb-4 rounded-xl border p-3.5" style={{ borderColor: "var(--clinical-line-strong)", backgroundColor: "var(--clinical-surface-2)" }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md px-2 py-0.5 text-xs font-bold text-white" style={{ backgroundColor: "var(--clinical-panel)" }}>Level {meta.n}</span>
            <span className="font-bold text-[var(--clinical-ink)]">{meta.name}</span>
            <span className="text-xs text-[var(--clinical-muted)]">· {meta.intensity} intensity</span>
          </div>
          {meta.needPattern && <p className="mt-1.5 text-xs text-[var(--clinical-ink-soft)]"><span className="font-semibold">Rationale:</span> {meta.needPattern}</p>}
          {meta.packageSummary && <p className="mt-1 text-xs text-[var(--clinical-muted)]">{meta.packageSummary}</p>}
          <p className="mt-1.5 text-[11px] text-[var(--clinical-muted)]">This plan draws only from the <b>Level {meta.n} package</b> ({items.length} governed tasks) — tailor each, then generate.</p>
        </div>
      )}

      <div className="mb-4">
        <FieldLabel htmlFor="cpb-goals">Care Goals</FieldLabel>
        <textarea id="cpb-goals" rows={3} value={goals} onChange={(e) => setGoals(e.target.value)} placeholder="One goal per line…" className={controlClass} />
      </div>

      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--clinical-muted)]">Package interventions ({chosen.length}/{items.length} included)</p>
      <div className="space-y-3">
        {byDomain.map(([domain, group]) => {
          const on = group.filter((g) => g.included).length;
          const assistUnion = Array.from(new Set(group.flatMap((g) => g.assistanceChoices)));
          return (
            <details key={domain} open className="rounded-xl border" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)" }}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5">
                <span className="text-sm font-bold text-[var(--clinical-ink)]">{domain} <span className="text-xs font-normal text-[var(--clinical-muted)]">· {on}/{group.length}</span></span>
                <span className="flex gap-2 text-[11px] font-semibold">
                  <button type="button" onClick={(e) => { e.preventDefault(); setDomain(domain, true); }} className="text-[var(--clinical-panel)] hover:underline">All</button>
                  <button type="button" onClick={(e) => { e.preventDefault(); setDomain(domain, false); }} className="text-[var(--clinical-muted)] hover:underline">None</button>
                </span>
              </summary>
              <div className="space-y-2 border-t px-3 py-3" style={{ borderColor: "var(--clinical-line)" }}>
                {on > 0 && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg px-2.5 py-2" style={{ backgroundColor: "var(--clinical-surface-2)" }}>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--clinical-muted)]">Apply to all {on} included:</span>
                    {assistUnion.length > 0 && (
                      <select value="" onChange={(e) => e.target.value && bulkAssist(domain, e.target.value)} aria-label={`Set assistance for all included ${domain} tasks`}
                        className="rounded-md border bg-[var(--clinical-surface)] px-2 py-1 text-[11px] text-[var(--clinical-ink)]" style={{ borderColor: "var(--clinical-line-strong)" }}>
                        <option value="">Assistance…</option>
                        {assistUnion.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                    )}
                    <select value="" onChange={(e) => e.target.value && bulkFreq(domain, e.target.value)} aria-label={`Set frequency for all included ${domain} tasks`}
                      className="rounded-md border bg-[var(--clinical-surface)] px-2 py-1 text-[11px] text-[var(--clinical-ink)]" style={{ borderColor: "var(--clinical-line-strong)" }}>
                      <option value="">Frequency…</option>
                      {FREQ_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                )}
                {group.map((it) => (
                  <div key={it.taskId} className={`rounded-lg border p-3 transition ${it.included ? "" : "opacity-55"}`} style={{ backgroundColor: "var(--clinical-surface-2)", borderColor: it.included ? "var(--clinical-line-strong)" : "var(--clinical-line)" }}>
                    <div className="flex items-start gap-3">
                      <input type="checkbox" checked={it.included} onChange={(e) => patch(it.taskId, { included: e.target.checked })} aria-label={`Include ${it.name}`} className="mt-1 h-4 w-4 shrink-0 accent-[var(--clinical-panel)]" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[var(--clinical-ink)]">{it.name} <span className="text-[10px] font-normal text-[var(--clinical-muted)]">{it.taskId}</span></p>
                        {it.intervention && <p className="mt-0.5 text-xs text-[var(--clinical-ink-soft)]">{it.intervention}</p>}
                        {it.included && (
                          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                            {it.assistanceChoices.length > 0 && (
                              <select value={it.assistance} onChange={(e) => patch(it.taskId, { assistance: e.target.value })} aria-label="Assistance level" className={controlClass}>
                                <option value="">Assistance…</option>
                                {it.assistanceChoices.map((a) => <option key={a} value={a}>{a}</option>)}
                              </select>
                            )}
                            <select value={it.freq} onChange={(e) => patch(it.taskId, { freq: e.target.value })} aria-label="Frequency" title={it.freqHint} className={controlClass}>
                              {FREQ_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                            </select>
                            <input value={it.note} onChange={(e) => patch(it.taskId, { note: e.target.value })} placeholder={it.prompt ? it.prompt.slice(0, 60) : "Individualization…"} title={it.prompt} className={`${controlClass} ${it.assistanceChoices.length > 0 ? "" : "sm:col-span-2"}`} />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ClinicalButton variant="primary" onClick={submit} disabled={genBusy || chosen.length === 0}>
          {genBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
          Generate individualized draft
        </ClinicalButton>
        <span className="text-xs text-[var(--clinical-muted)]">{chosen.length} governed intervention{chosen.length === 1 ? "" : "s"} · held until nursing approval</span>
      </div>
    </Section>
  );
}

function ReviewForm({ resident, recentInc, recentVariances = [], last, reviewedBy, heldPlanCount = 0, onSubmit }: {
  resident: Row; recentInc: Row[]; recentVariances?: Row[]; last?: Review; reviewedBy: string; heldPlanCount?: number;
  onSubmit: (rec: Omit<Review, "id" | "createdAt">) => Promise<void>;
}) {
  const today = new Date();
  const lvl = levelOf(resident).n;
  const [nextReviewDate, setNextReviewDate] = useState(isoDate(addMonths(today, 3)));
  const [carePlanStatus, setCarePlanStatus] = useState("No Change");
  const [familyUpdate, setFamilyUpdate] = useState(false);
  const [physicianFollowup, setPhysicianFollowup] = useState(false);
  const [decision, setDecision] = useState("");
  const [reason, setReason] = useState("");
  const [actionPlan, setActionPlan] = useState("");
  const [responsible, setResponsible] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [saving, setSaving] = useState(false);

  // Derive triggers from recent incidents + care-event variances.
  const has = (types: string[]) => recentInc.filter((i) => types.includes(s(i.incidentType).toUpperCase()));
  const varianceCount = recentVariances.length;
  const reassessFlagged = recentVariances.some((c) => c.reviewAlertRaised);
  const icp = has(["BEHAVIORAL"]).length ? "Behavioral event in last 30 days — update the individual care plan."
    : varianceCount ? `${varianceCount} care-delivery variance${varianceCount === 1 ? "" : "s"} in last 30 days — update the individual care plan.` : "";
  const isp = has(["MED_ERROR", "MEDICATION"]).length ? "Medication event in last 30 days — review the service plan." : "";
  const loc = recentInc.filter((i) => ["FALL", "CRITICAL"].includes(s(i.incidentType).toUpperCase()) || s(i.severity).toUpperCase() === "CRITICAL").length ? "Fall or critical event in last 30 days — evaluate level of care."
    : reassessFlagged ? "Repeat care variances flagged for reassessment — evaluate level of care." : "";

  const submit = async () => {
    if (!decision) { Swal.fire({ title: "Select a decision", text: "Choose a decision before submitting the review.", icon: "warning" }); return; }
    if (!nextReviewDate) { Swal.fire({ title: "Next review date required", text: "Set the next review date before approving the care plan.", icon: "warning" }); return; }
    if (!reason.trim()) { Swal.fire({ title: "Decision rationale required", text: "Document the nursing rationale before submitting the review.", icon: "warning" }); return; }
    setSaving(true);
    try {
      await onSubmit({ residentId: s(resident.id), reviewDate: isoDate(today), reviewPeriod: periodOf(today), levelAtReview: lvl, nextReviewDate, carePlanStatus, familyUpdate, physicianFollowup, decision, reason: reason || undefined, actionPlan: actionPlan || undefined, responsible: responsible || undefined, targetDate: targetDate || undefined, reviewedBy });
    } finally { setSaving(false); }
  };

  return (
    <>
      <Section title="Review Header">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Field label="Resident" value={s(resident.name)} />
          <Field label="Room" value={s(resident.room)} />
          <Field label="Current Level of Care" value={`Level ${lvl}`} />
          <Field label="Review Period" value={periodOf(today)} />
          <Field label="Review Date" value={isoDate(today)} />
          <Field label="Reviewed By" value={reviewedBy || "Staff"} />
          <Field label="Last Review" value={last ? fmt(last.reviewDate) : "Never"} />
          <div><FieldLabel htmlFor="cpr-next">Next Review Date</FieldLabel><input id="cpr-next" type="date" value={nextReviewDate} onChange={(e) => setNextReviewDate(e.target.value)} className={controlClass} /></div>
        </div>
        <div className="mt-4 grid grid-cols-1 items-center gap-4 lg:grid-cols-3">
          <div><FieldLabel htmlFor="cpr-status">Care Plan Status</FieldLabel><select id="cpr-status" value={carePlanStatus} onChange={(e) => setCarePlanStatus(e.target.value)} className={controlClass}>{PLAN_STATUS.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
          <Toggle label="Family Update Needed" on={familyUpdate} onClick={() => setFamilyUpdate((v) => !v)} />
          <Toggle label="Physician Follow-up Needed" on={physicianFollowup} onClick={() => setPhysicianFollowup((v) => !v)} />
        </div>
      </Section>

      <Section title="Recent Indicators (Last 30 Days)">
        {recentInc.length === 0 && recentVariances.length === 0 ? <p className="text-[var(--clinical-muted)]">No indicator data available.</p> : (
          <div className="space-y-1.5">
            {recentInc.map((i) => <div key={s(i.id)} className="flex items-center gap-2 text-sm"><StatusPill status={s(i.incidentType).replace(/_/g, " ")}>{s(i.incidentType).replace(/_/g, " ")}</StatusPill><span className="text-[var(--clinical-ink-soft)]">{s(i.title) || s(i.description).slice(0, 80)}</span><span className="ml-auto text-xs text-[var(--clinical-muted)]">{fmt(s(i.incidentDate || i.createdAt).slice(0, 10))}</span></div>)}
            {recentVariances.map((c) => <div key={s(c.id)} className="flex items-center gap-2 text-sm"><StatusPill status={c.immediateEscalation ? "CRITICAL" : "WARNING"}>Care variance</StatusPill><span className="text-[var(--clinical-ink-soft)]">{s(c.outcome)}{c.domain ? ` · ${s(c.domain)}` : ""}{c.observation ? ` — ${s(c.observation).slice(0, 60)}` : ""}</span><span className="ml-auto text-xs text-[var(--clinical-muted)]">{fmt(s(c.createdAt || c.occurredAt).slice(0, 10))}</span></div>)}
          </div>
        )}
      </Section>

      <Section title="Trigger Evaluation">
        <div className="space-y-3">
          <TriggerLine label="Individual Care Plan (ICP) Triggers" trig={icp} />
          <TriggerLine label="Individual Service Plan (ISP) Triggers" trig={isp} />
          <TriggerLine label="Level of Care (LOC) Review Triggers" trig={loc} />
        </div>
      </Section>

      <Section title="Nurse/Admin Decision">
        <div className="space-y-4">
          {heldPlanCount > 0 && (
            <div className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm" style={{ borderColor: "#4F46E5", backgroundColor: "color-mix(in srgb, #4F46E5 8%, transparent)" }}>
              <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-[#4F46E5]" />
              <span className="text-[var(--clinical-ink)]"><b>{heldPlanCount} draft care plan{heldPlanCount === 1 ? "" : "s"} held.</b> Submitting this review releases the plan and dispatches its tasks to caregivers — unless you choose <i>Refer to Physician</i> or <i>Schedule Family Conference</i>, which keep it on hold.</span>
            </div>
          )}
          <div><FieldLabel required htmlFor="cpr-decision">Decision</FieldLabel><select id="cpr-decision" value={decision} onChange={(e) => setDecision(e.target.value)} className={`${controlClass} max-w-xs`}><option value="">Select a decision…</option>{DECISIONS.map((d) => <option key={d} value={d}>{d}</option>)}</select></div>
          <div><FieldLabel required htmlFor="cpr-reason">Reason for Decision / Notes</FieldLabel><textarea id="cpr-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain the nursing rationale…" className={controlClass} /></div>
          <div><FieldLabel htmlFor="cpr-action">Action Plan</FieldLabel><textarea id="cpr-action" rows={2} value={actionPlan} onChange={(e) => setActionPlan(e.target.value)} placeholder="Steps to be taken…" className={controlClass} /></div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><FieldLabel htmlFor="cpr-resp">Responsible Person</FieldLabel><input id="cpr-resp" value={responsible} onChange={(e) => setResponsible(e.target.value)} placeholder="Name or role" className={controlClass} /></div>
            <div><FieldLabel htmlFor="cpr-target">Target Completion Date</FieldLabel><input id="cpr-target" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className={controlClass} /></div>
          </div>
          <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[#4F46E5] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#4338CA] disabled:opacity-60"><ClipboardList className="h-4 w-4" /> {saving ? "Submitting…" : heldPlanCount > 0 ? "Submit review & release plan" : "Submit Care Plan Review"}</button>
        </div>
      </Section>
    </>
  );
}
