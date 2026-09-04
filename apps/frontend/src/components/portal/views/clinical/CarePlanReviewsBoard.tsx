"use client";

/**
 * Care Plan Reviews — create/finalize/view a resident's care plan, review
 * indicators, evaluate triggers (ICP / ISP / LOC), and record a Nurse/Admin
 * care-plan decision. Tabs: Care Plans (roster: create plan / finalize draft /
 * view current), New Review, Pending Approval, Reviews Due, History. On
 * activation the reviewer picks a flat 30/60-day next-review interval, so the
 * resident surfaces under Reviews Due after that window. Recent indicators +
 * triggers derive from the resident's incidents (last 30 days). Migration-free:
 * reviews are a JSON array in the app-setting `care_plan_reviews`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, ListChecks, Loader2, AlertTriangle, Users, ClipboardCheck, FileClock, FilePlus2, CalendarClock, Target, Trash2, Plus, Printer, Clock } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord, updateRecord, createRecord } from "@/lib/api";
import { generateCarePlanForResident, releaseCarePlan, materializeTodayTasks, levelCareTasks, type PlanIntervention } from "@/lib/carePlanGen";
import { CARE_PLAN_DRAFTS_KEY, parseCarePlanDrafts, upsertDraft, clearDraft, type DraftState, type SavedDomainPlanItem } from "@/lib/carePlanDraft";
import { taskById, SCORED_DOMAINS, tasksForDomain } from "@/lib/lifecare/dataset";
import { domainCodeFromLabel } from "@/lib/lifecare/carePackage";
import { ASSESSMENTS_V42_KEY, authoritativeAssessmentFor, type AssessmentV42, type DomainEntry } from "@/lib/lifecare/assessment";
import { printCarePlan } from "@/lib/lifecare/carePlanReport";
import { generateRoutine } from "@/lib/lifecare/carePlanRoutine";
import RoutineTimeline from "./RoutineTimeline";
import { duplicateReview, reviewOutcome, canFinalizeCarePlan, type CarePlanReviewApprovalStatus } from "@/lib/lifecare/carePlanReviewGuards";
import { levelMeta } from "@/lib/lifecare/levelModel";
import { adaptResident } from "@/lib/adapters";
import { useClinician, type ClinicianRole } from "./useClinician";
import { activeLevel } from "@/lib/lifecare/activeLevel";
import { parseLocHistory, LOC_HISTORY_KEY } from "@/lib/lifecare/locHistory";
import { CAREGIVER_SCHEDULE_KEY, parseSchedules, assigneeForResidentToday } from "@/lib/caregiverSchedule";
import { ClinicalButton, ClinicalCard, ClinicalModal, StatCard, DataState, FieldLabel, controlClass, StatusPill, SERIF } from "./clinical-ui";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const REVIEW_KEY = "care_plan_reviews";
const s = (v: unknown) => (v == null ? "" : String(v));
/** The level a care plan was built at, parsed from its title ("… (Level N) …"). */
const planLevelOf = (plan?: Row | null): number | null => { const m = /\(Level (\d)\)/.exec(s(plan?.title)); return m ? Number(m[1]) : null; };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
const newId = () => globalThis.crypto?.randomUUID?.() ?? `rev-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const isoDate = (d: Date) => d.toISOString().split("T")[0];
const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fmt = (isoStr: string) => (isoStr ? new Date(isoStr + (isoStr.length <= 10 ? "T00:00:00" : "")).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");
const periodOf = (d: Date) => `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;

const DECISIONS = ["New Plan", "Continue Current Plan", "Update Care Plan", "Escalate Level of Care", "De-escalate Level of Care", "Refer to Physician", "Schedule Family Conference"];
// Decisions that DON'T release a held plan — the plan stays held for follow-up.
const HOLD_DECISIONS = new Set(["Refer to Physician", "Schedule Family Conference"]);
// Decisions that CREATE or CHANGE the care plan — they require a generated draft to
// release. "New Plan" is the first-time plan for a newly created resident.
const PLAN_CHANGE_DECISIONS = new Set(["New Plan", "Update Care Plan", "Escalate Level of Care", "De-escalate Level of Care"]);
const PLAN_STATUS = ["No Change", "Updated", "Under Review", "Escalated", "De-escalated"];
// Review cadence options (mirrors the assessment Reassessment Interval). "On change
// of condition" is event-driven — no scheduled date (a 6-month backstop is stored on
// submit so the plan stays finalizable and never silently lapses).
const REVIEW_INTERVALS = ["30 days", "90 days", "6 months", "Annually", "On change of condition"];
const ON_CHANGE_INTERVAL = "On change of condition";

interface Review {
  id: string; residentId: string; reviewDate: string; reviewPeriod: string; levelAtReview: number;
  nextReviewDate?: string; reviewInterval?: string; carePlanStatus: string; familyUpdate: boolean; physicianFollowup: boolean;
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
  // Family sign-off gate: a plan-releasing review is held for the resident's family to
  // approve/reject before a Care Manager finalizes it.
  sponsorId?: string;                             // family sponsor user id (scopes the family portal)
  residentName?: string; room?: string;           // snapshot for the family portal + notifications
  familyDecision?: "APPROVED" | "REJECTED";
  familyDecidedByName?: string; familyDecidedAt?: string; familyRejectReason?: string;
}
const parseReviews = (raw: string | null | undefined): Review[] => { if (!raw) return []; try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((r) => r && typeof r.id === "string") : []; } catch { return []; } };
const parseAssessments = (raw: string | null | undefined): AssessmentV42[] => { if (!raw) return []; try { const v = JSON.parse(raw); return Array.isArray(v) ? (v as AssessmentV42[]) : []; } catch { return []; } };
// The resident's VALIDATED assessment domains — matched by residentId, linked
// admission, OR normalized name (a pre-admission assessment isn't linked by
// residentId yet). ONLY a validated assessment drives the care plan (no
// COMPLETED/DRAFT, no full-package fallback); null when none is validated.
const validatedDomainsFor = (all: AssessmentV42[], residentId: string, residentName: string): Partial<Record<string, DomainEntry>> | null => {
  const a = authoritativeAssessmentFor(all.filter((x) => x.status === "VALIDATED"), { residentId, residentName });
  return a && a.domains && Object.keys(a.domains).length ? a.domains : null;
};

// A stored intervention line ("Title: detail… (Daily)") → title · detail · frequency,
// so the plan view can show the frequency as a pill instead of trailing text.
const parseIntervention = (line: string): { title: string; desc: string; freq: string } => {
  // Pull a trailing "(freq)" — which may itself contain ONE nested paren level, e.g.
  // "(Twice daily (BID))" — into a pill instead of leaking into the title. Anchored at
  // the end with an unrolled inner pattern (no `(x+)*` nesting) so a line with an earlier
  // parenthetical like "(e.g., clothing, ...)" plus a long body can't trigger catastrophic
  // regex backtracking (ReDoS) that freezes the render. ponytail: linear, was exponential.
  const m = line.match(/\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/);
  const freq = m ? m[1].trim() : "";
  const body = (m ? line.slice(0, m.index) : line).trim();
  const ci = body.indexOf(":");
  return { title: ci > -1 ? body.slice(0, ci).trim() : body, desc: ci > -1 ? body.slice(ci + 1).trim() : "", freq };
};

export default function CarePlanReviewsBoard({ clinicianRole = "NURSE", tabs, focusResidentId, embedded }: { clinicianRole?: ClinicianRole | "SUPERADMIN"; tabs?: Array<"plans" | "new" | "due" | "history" | "pending">; focusResidentId?: string; embedded?: boolean }) {
  // SUPERADMIN isn't a staff-linked clinician role; resolve its display name via the
  // admin path, while the finalize guards below key off the raw "SUPERADMIN" string.
  const { name: clinicianName, userId: clinicianId, staffId: clinicianStaffId } = useClinician(clinicianRole === "SUPERADMIN" ? "FACILITY_ADMIN" : clinicianRole);
  // Caregivers are view-only here: they can open the plan of record but cannot
  // create, finalize, approve, or start a review. Only the "View" action shows,
  // and they see ONLY the residents assigned to them (plans list + history).
  const readOnly = clinicianRole === "CAREGIVER";
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const incQ = useLiveQuery<Row>("incidents", { query: "take=400", tables: ["Incident"] });
  const ceQ = useLiveQuery<Row>("care-events", { query: "take=1000", tables: ["CareEvent"] });
  const { data: settingRows, loading, error, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  const cpQ = useLiveQuery<Row>("care-plans", { query: "take=300", tables: ["CarePlan"] });
  const residents = useMemo(() => {
    let all = (resQ.data || []).map(adaptResident);
    // Embedded single-resident view: lock the whole board (roster, pickers, Reviews
    // Due, History, pending) to the one tapped resident by scoping the source list.
    if (focusResidentId) all = all.filter((r: Row) => s(r.id) === focusResidentId);
    if (clinicianRole !== "CAREGIVER" || !clinicianStaffId) return all;
    // Scope to the residents assigned to this caregiver today (same roster the
    // task materializer + /api/caregiver/my-residents use).
    const schedules = parseSchedules(settingRows.find((r) => (r.key || r.id) === CAREGIVER_SCHEDULE_KEY)?.value);
    const now = new Date();
    return all.filter((r: Row) => assigneeForResidentToday(schedules, s(r.id), now, "Asia/Manila")?.caregiverStaffId === clinicianStaffId);
  }, [resQ.data, settingRows, clinicianRole, clinicianStaffId, focusResidentId]);
  const reviews = useMemo(() => parseReviews(settingRows.find((r) => (r.key || r.id) === REVIEW_KEY)?.value), [settingRows]);
  // Editable per-resident builder snapshots (migration-free) — the source of
  // truth the CarePlanBuilder hydrates from and auto-saves to, so a nurse's
  // assistance/frequency/note edits survive navigation and regeneration.
  const drafts = useMemo(() => parseCarePlanDrafts(settingRows.find((r) => (r.key || r.id) === CARE_PLAN_DRAFTS_KEY)?.value), [settingRows]);
  // Resident assessments (migration-free `assessments_v42`) — the source of the
  // per-domain Goal / Preference Note + scores the care plan builds from.
  const assessments = useMemo(() => parseAssessments(settingRows.find((r) => (r.key || r.id) === ASSESSMENTS_V42_KEY)?.value), [settingRows]);
  // Read the latest settings without re-creating the persist callback (a stable
  // callback keeps the builder's debounced auto-save effect from re-firing).
  const settingRowsRef = useRef(settingRows);
  useEffect(() => { settingRowsRef.current = settingRows; }, [settingRows]);
  // Authoritative ACTIVE level of care, resolved from loc_history (the true L1..L5)
  // rather than the coarse careLevel enum (which can't tell L2 from L3). Returns a
  // levelOf-shaped { n, label } so existing call sites work unchanged.
  const locHistory = useMemo(() => parseLocHistory(settingRows.find((r) => (r.key || r.id) === LOC_HISTORY_KEY)?.value), [settingRows]);
  const resLevel = useCallback((r: Row) => {
    // Prefer the resident's validated Final LOC (matched by id / admission / name) over
    // the coarse careLevel enum or a stale loc_history entry, so this board always
    // agrees with Pre-admission. See activeLevel() for the precedence rule.
    const n = activeLevel({ residentId: s(r.id), careLevel: s(r.careLevel), locHistory, residentName: s(r.name), assessments });
    return { n, label: levelMeta(n).name };
  }, [locHistory, assessments]);
  // Print/PDF the resident's care plan of record — reuses the SAME printCarePlan
  // document the builder's "Print Care Plan" produces. Domains come from the
  // resident's validated assessment overlaid with any individualized draft snapshot;
  // falls back to the stored plan strings for legacy plans without a snapshot.
  const printPlan = (res: Row, plan?: Row | null) => {
    const rid = s(res.id);
    const rl = resLevel(res);
    const snap = new Map((drafts[rid]?.domainPlan || []).map((d) => [d.code, d]));
    let domains = assessmentDomainRows(validatedDomainsFor(assessments, rid, s(res.name)), rl.n)
      .filter((r) => { const o = snap.get(r.code); return o ? o.included !== false : true; })
      .map((r) => { const o = snap.get(r.code); return { code: r.code, name: r.name, score: r.score, goal: (o?.goal ?? r.goal) || "", interventions: o?.interventions ?? r.interventions }; });
    if (!domains.length && plan) {
      const goals = s(plan.careGoals).split("\n").map((x) => x.trim()).filter(Boolean);
      const ivs = s(plan.interventions).split("\n").map((x) => x.trim()).filter(Boolean);
      domains = [{ code: "", name: "Care Plan", score: 0, goal: goals.join("; "), interventions: ivs }];
    }
    printCarePlan({
      residentName: s(res.name) || "Resident", room: s(res.room), level: rl.n,
      levelName: `Level ${rl.n} — ${rl.label}`,
      reviewFrequency: plan?.reviewFrequency ? s(plan.reviewFrequency) : undefined,
      domains,
    });
  };
  const residentsWithPlan = useMemo(() => new Set((cpQ.data || []).filter((p) => s(p.status) !== "DISCONTINUED").map((p) => s(p.residentId))), [cpQ.data]);
  // Held (DRAFT) plans awaiting review approval, keyed by resident.
  const draftPlansByResident = useMemo(() => {
    const m = new Map<string, Row[]>();
    (cpQ.data || []).filter((p) => s(p.status) === "DRAFT").forEach((p) => { const rid = s(p.residentId); const g = m.get(rid) || []; g.push(p); m.set(rid, g); });
    return m;
  }, [cpQ.data]);
  // Plans submitted for review (a plan-changing review flips its plan to UNDER_REVIEW)
  // — pending family sign-off / finalize. Kept separate so the roster shows "pending"
  // instead of "No plan" and never offers a duplicate "Create care plan".
  const underReviewByResident = useMemo(() => {
    const m = new Map<string, Row>();
    (cpQ.data || []).filter((p) => s(p.status) === "UNDER_REVIEW").forEach((p) => { const rid = s(p.residentId); if (!m.has(rid)) m.set(rid, p); });
    return m;
  }, [cpQ.data]);
  // Active (released) plan per resident — the current care plan of record.
  const activePlanByResident = useMemo(() => {
    const m = new Map<string, Row>();
    (cpQ.data || []).filter((p) => s(p.status) === "ACTIVE").forEach((p) => { const rid = s(p.residentId); if (!m.has(rid)) m.set(rid, p); });
    return m;
  }, [cpQ.data]);

  const [tab, setTab] = useState<"plans" | "new" | "due" | "history" | "pending">(tabs?.[0] ?? (embedded ? "new" : "plans"));
  const [viewPlan, setViewPlan] = useState<{ resident: Row; plan: Row } | null>(null);
  const [resId, setResId] = useState(focusResidentId ?? "");
  // The selected resident's assessment domains (Goal / Preference Notes + scores)
  // — what the CarePlanBuilder builds its per-domain Goal + Interventions from.
  const builderDomains = useMemo(() => {
    if (!resId) return null;
    const name = s(residents.find((r: Row) => s(r.id) === resId)?.name);
    return validatedDomainsFor(assessments, resId, name);
  }, [assessments, resId, residents]);
  const [genBusy, setGenBusy] = useState(false);
  const [interventionCount, setInterventionCount] = useState(0);
  const [actingId, setActingId] = useState("");
  // Pending "generate care plan" confirmation (bespoke modal replaces the generic Swal confirm).
  const [genConfirm, setGenConfirm] = useState<{ plan?: { title?: string; goals: string[]; interventions: PlanIntervention[] }; already: boolean } | null>(null);
  // Live plan data from the CarePlanBuilder — the top-level "Generate" button passes this
  // so the nurse's individualized selections are preserved (not dropped to the baseline).
  const [builderPlan, setBuilderPlan] = useState<{ title?: string; goals: string[]; interventions: PlanIntervention[] } | undefined>(undefined);

  // Reviews awaiting approval (LOC-change second sign-off, or incomplete activation gates).
  // Family sign-off gate queues: family-approved (ready for a Care Manager to finalize),
  // awaiting the family, and any legacy clinician-pending reviews.
  const readyToFinalize = useMemo(() => reviews.filter((r) => r.approvalStatus === "FAMILY_APPROVED"), [reviews]);
  const awaitingFamily = useMemo(() => reviews.filter((r) => r.approvalStatus === "PENDING_FAMILY"), [reviews]);
  const legacyPending = useMemo(() => reviews.filter((r) => r.approvalStatus === "PENDING"), [reviews]);
  const pendingQueue = useMemo(() => [...readyToFinalize, ...awaitingFamily, ...legacyPending], [readyToFinalize, awaitingFamily, legacyPending]);

  const today = new Date();
  const resident = residents.find((r: Row) => s(r.id) === resId) || null;

  // Reset the builder plan the instant the resident changes — DURING RENDER, before
  // the remounted CarePlanBuilder's onChange effect repopulates it. Doing this in an
  // effect instead raced with that child effect: in production builds the parent
  // reset ran last and left builderPlan undefined, so Generate wrongly reported "No
  // validated assessment" (dev Strict Mode's double-invoked child effect masked it).
  // Render-phase reset makes the child's populate the deterministic last writer.
  const builderPlanResId = useRef(resId);
  if (builderPlanResId.current !== resId) {
    builderPlanResId.current = resId;
    setBuilderPlan(undefined);
  }

  const latestReview = (rid: string) => reviews.filter((r) => r.residentId === rid).sort((a, b) => (b.reviewDate || "").localeCompare(a.reviewDate || ""))[0];

  // ── "One active plan" gate for the New Review pickers ───────────────────────
  // Once a plan is ACTIVE, the resident is removed from the New Review dropdown +
  // cards. They reappear ONLY when BOTH hold: (a) a VALIDATED reassessment exists
  // that post-dates the active plan, and (b) the plan's review frequency is up
  // (next review date has arrived). This enforces "one plan per resident until a
  // reassessment falls due" — a new plan can't be started otherwise.
  const planDayOf = (p?: Row) => (s(p?.effectiveDate) || s(p?.createdAt) || "").slice(0, 10);
  const reassessedAfterPlan = (rid: string, planDay: string) => {
    const name = s(residents.find((r: Row) => s(r.id) === rid)?.name);
    const a = authoritativeAssessmentFor(assessments.filter((x) => x.status === "VALIDATED"), { residentId: rid, residentName: name });
    if (!a) return false;
    const aDay = (s(a.validation?.at) || s(a.updatedAt) || s(a.createdAt)).slice(0, 10);
    return !!aDay && aDay > planDay; // validated strictly after the active plan → a reassessment
  };
  const frequencyUp = (rid: string, active: Row) => {
    const nextReview = s(active.nextReviewDate) || latestReview(rid)?.nextReviewDate || "";
    return !!nextReview && nextReview <= isoDate(today);
  };
  const eligibleForNewReview = (rid: string) => {
    const active = activePlanByResident.get(rid);
    if (!active) return true; // no active plan → available (first / replacement plan)
    return frequencyUp(rid, active) && reassessedAfterPlan(rid, planDayOf(active));
  };
  const newReviewResidents = residents.filter((r: Row) => eligibleForNewReview(s(r.id)));

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

  // Persist one resident's builder snapshot. Reads the freshest map from the ref
  // (not the render-time `drafts`) so concurrent edits to other residents aren't
  // clobbered. Stable identity — safe as the builder's onPersist dependency.
  const persistDraftState = useCallback(async (residentId: string, state: DraftState) => {
    const cur = parseCarePlanDrafts(settingRowsRef.current.find((r) => (r.key || r.id) === CARE_PLAN_DRAFTS_KEY)?.value);
    const next = upsertDraft(cur, residentId, state);
    await upsertRecord("app-settings", CARE_PLAN_DRAFTS_KEY, { key: CARE_PLAN_DRAFTS_KEY, value: JSON.stringify(next) });
    await refetch();
  }, [refetch]);
  // Drop a resident's snapshot once their plan is released (so a later new plan
  // starts clean instead of hydrating stale selections).
  const clearDraftState = useCallback(async (residentId: string) => {
    const cur = parseCarePlanDrafts(settingRowsRef.current.find((r) => (r.key || r.id) === CARE_PLAN_DRAFTS_KEY)?.value);
    if (!(residentId in cur)) return;
    await upsertRecord("app-settings", CARE_PLAN_DRAFTS_KEY, { key: CARE_PLAN_DRAFTS_KEY, value: JSON.stringify(clearDraft(cur, residentId)) });
    await refetch();
  }, [refetch]);

  // Manual fallback for the Stage 8/9 handoff — build a care plan + caregiver tasks
  // from the resident's current Level of Care (for residents approved before the
  // auto-generation, or missing a plan).
  // Generate a care plan + caregiver tasks. `plan` (from the ICP editor) makes it
  // richer — the nurse's individualized interventions/frequency/notes replace the
  // baseline template. Omitted → the Level-N baseline package is used as before.
  // Open the confirmation modal; the actual generation runs on confirm (runGenerate).
  const genPlan = (plan?: { title?: string; goals: string[]; interventions: PlanIntervention[] }) => {
    if (!resident || genBusy) return;
    // Only a validated assessment produces a plan — no full-package fallback. Block
    // when the builder has no interventions (resident has no validated assessment).
    if (!plan?.interventions?.length) {
      Swal.fire({ icon: "warning", title: "No validated assessment", text: `${s(resident.name)} has no validated assessment. Validate the 14-domain Resident Assessment before generating a care plan.` });
      return;
    }
    setGenConfirm({ plan, already: residentsWithPlan.has(s(resident.id)) });
  };

  // Core generation — supersede prior held drafts, then build the DRAFT plan for
  // `res` from `plan` (individualized) or the level baseline. Shared by the
  // builder's confirm flow and the one-click "Create care plan" roster action.
  const doGenerate = async (res: Row, plan?: { title?: string; goals: string[]; interventions: PlanIntervention[] }): Promise<number> => {
    const n = resLevel(res).n;
    const raw = (res.raw || {}) as Row;
    // Supersede any prior held DRAFT for this resident so regenerating replaces it
    // instead of leaving orphan drafts (A4). Under-review/active plans are untouched.
    for (const d of draftPlansByResident.get(s(res.id)) || []) {
      try { await updateRecord("care-plans", s(d.id), { status: "DISCONTINUED", discontinuedReason: "Superseded by regenerated draft" }); } catch { /* best-effort */ }
    }
    const { interventionCount } = await generateCarePlanForResident({ residentId: s(res.id), level: n, communityId: s(raw.communityId) || undefined, createdByName: clinicianName, plan, hold: true });
    await cpQ.refetch?.();
    return interventionCount;
  };

  const runGenerate = async (plan?: { title?: string; goals: string[]; interventions: PlanIntervention[] }) => {
    if (!resident || genBusy) return;
    const n = resLevel(resident).n;
    setGenConfirm(null);
    setGenBusy(true);
    try {
      const interventionCount = await doGenerate(resident, plan);
      Swal.fire({ icon: "success", title: "Draft care plan created", html: `Level ${n} plan with <b>${interventionCount} intervention${interventionCount === 1 ? "" : "s"}</b> prepared and <b>held</b>. Submit the care plan review below — once approved, tasks are generated daily for the resident's scheduled caregiver.`, timer: 3600, showConfirmButton: false });
    } catch (e) { Swal.fire("Couldn't generate", e instanceof Error ? e.message : "Please try again.", "error"); }
    finally { setGenBusy(false); }
  };

  // One-click "Create care plan" from the roster: seed the resident's editable
  // snapshot with the full Level-N package, generate the DRAFT immediately, and
  // open New Review so the nurse can tailor it (the builder hydrates the seed).
  const createPlanForResident = async (res: Row) => {
    if (genBusy) return;
    const rid = s(res.id);
    const n = resLevel(res).n;
    // Only a validated assessment produces a plan — no full-package fallback.
    const rows = assessmentDomainRows(validatedDomainsFor(assessments, rid, s(res.name)), n);
    if (!rows.length) {
      Swal.fire({ icon: "warning", title: "No validated assessment", text: `${s(res.name)} has no validated assessment. Validate the 14-domain Resident Assessment before creating a care plan.` });
      return;
    }
    setResId(rid);
    setTab("new");
    setGenBusy(true);
    try {
      const plan = buildDomainPlan(rows);
      await persistDraftState(rid, { level: n, goals: plan.goals, items: [], domainPlan: domainSnapshot(rows), updatedAt: new Date().toISOString() });
      const interventionCount = await doGenerate(res, plan);
      Swal.fire({ icon: "success", title: "Draft care plan created", html: `Level ${n} plan with <b>${interventionCount} intervention${interventionCount === 1 ? "" : "s"}</b> prepared and <b>held</b>. Tailor the package below, then submit the care plan review.`, timer: 3600, showConfirmButton: false });
    } catch (e) { Swal.fire("Couldn't create", e instanceof Error ? e.message : "Please try again.", "error"); }
    finally { setGenBusy(false); }
  };

  // Finalize a FAMILY-APPROVED review (Care Manager / Superadmin only): release the held
  // plan and dispatch caregiver tasks. Records the finalizer's name + timestamp.
  const finalizeReview = async (rv: Review) => {
    if (!canFinalizeCarePlan(clinicianRole)) {
      Swal.fire({ icon: "warning", title: "Finalize not permitted", text: "Only a Care Manager or Superadmin can finalize a care plan after family sign-off." });
      return;
    }
    if (!rv.planId) { Swal.fire("No linked plan", "This review has no draft plan to release.", "error"); return; }
    if (!(await confirmRelease(rv))) return;
    setActingId(rv.id);
    try {
      await releaseCarePlan(s(rv.planId), { approvedByName: clinicianName, effectiveDate: rv.reviewDate, nextReviewDate: rv.nextReviewDate || "" });
      const dispatched = await materializeTodayTasks();
      await persist(reviews.map((r) => (r.id === rv.id ? { ...r, approvalStatus: "APPROVED" as const, approvedById: clinicianId, approvedByName: clinicianName, approvedAt: new Date().toISOString(), pendingReason: undefined } : r)));
      await cpQ.refetch?.();
      await clearDraftState(rv.residentId); // released — start any future plan clean
      // Notify the family sponsor that the plan they signed off on is now active (A5).
      if (rv.sponsorId) { try { await createRecord("notifications", { userId: s(rv.sponsorId), type: "SYSTEM_ALERT", title: "Care plan activated", message: `${rv.residentName || "Your relative"}'s care plan is now active.`, relatedEntityId: rv.id, relatedEntityType: "care_plan_review", severity: "INFO" }); } catch { /* non-critical */ } }
      Swal.fire({ icon: "success", title: "Care plan finalized · released", html: dispatched > 0 ? `${dispatched} task${dispatched === 1 ? "" : "s"} dispatched to today's scheduled caregiver.` : "Plan is now active. Tasks appear for the resident's caregiver on days one is scheduled.", timer: 3200, showConfirmButton: false });
    } catch (e) { Swal.fire("Couldn't finalize", e instanceof Error ? e.message : "The plan's activation gates are still incomplete.", "error"); }
    finally { setActingId(""); }
  };

  // Shared release confirmation. Warns when the held plan's baked level no longer matches
  // the resident's current level of care (A2) — releasing a stale-level plan needs an
  // explicit override. Returns true to proceed. `verb` labels the primary action.
  const confirmRelease = async (rv: Review, verb = "Finalize & release"): Promise<boolean> => {
    const planRow = (cpQ.data || []).find((p) => s(p.id) === s(rv.planId));
    const planLvl = planLevelOf(planRow);
    const res = residents.find((x: Row) => s(x.id) === rv.residentId);
    const curLvl = res ? resLevel(res).n : null;
    if (planLvl && curLvl && planLvl !== curLvl) {
      const proceed = await Swal.fire({ icon: "warning", title: "Level of care mismatch", html: `This plan was built at <b>Level ${planLvl}</b>, but the resident's current level of care is <b>Level ${curLvl}</b>. Releasing it activates the <b>Level ${planLvl}</b> plan. Regenerate at Level ${curLvl} first, or release anyway.`, showCancelButton: true, confirmButtonColor: "#D97706", confirmButtonText: "Release anyway", cancelButtonText: "Cancel" });
      return proceed.isConfirmed;
    }
    const c = await Swal.fire({ title: `${verb}?`, text: "Releasing activates the plan and dispatches tasks to the assigned caregiver.", icon: "question", showCancelButton: true, confirmButtonColor: "#4F46E5", confirmButtonText: verb });
    return c.isConfirmed;
  };

  // Approve a pending review (second authorized sign-off / gate completion): release the
  // held plan and mark the review approved. Segregation of duties — the reviewer who
  // submitted a LOC change cannot self-approve it.
  const approvePending = async (rv: Review) => {
    if (!rv.planId) { Swal.fire("No linked plan", "This review has no draft plan to release.", "error"); return; }
    // Care-plan approval is a single clinician sign-off: any nurse / care manager /
    // superadmin (including the reviewer who submitted it) may approve and release.
    if (!(await confirmRelease(rv, "Approve & release"))) return;
    setActingId(rv.id);
    try {
      await releaseCarePlan(s(rv.planId), { approvedByName: clinicianName, effectiveDate: rv.reviewDate, nextReviewDate: rv.nextReviewDate || "" });
      const dispatched = await materializeTodayTasks();
      await persist(reviews.map((r) => (r.id === rv.id ? { ...r, approvalStatus: "APPROVED" as const, approvedById: clinicianId, approvedByName: clinicianName, approvedAt: new Date().toISOString(), pendingReason: undefined } : r)));
      await cpQ.refetch?.();
      await clearDraftState(rv.residentId); // released — start any future plan clean
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

  const body = (
    <>
      {!embedded && (
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.75rem]">Care Plan Reviews</h1>
        <p className="mt-1 text-sm text-slate-500">Review resident indicators, evaluate triggers, and make care plan decisions</p>
      </div>
      )}

      {!embedded && (
      <div className="flex items-center gap-2" role="tablist" aria-label="Care plan reviews view">
        {([["plans", "Care Plans"], ["new", "New Review"], ["pending", "Pending Approval"], ["due", "Reviews Due"], ["history", "History"]] as const).filter(([v]) => !tabs || tabs.includes(v)).map(([v, label]) => (
          <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)} className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${tab === v ? "bg-[#4F46E5] text-white shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{label}{v === "due" && dueList.length ? ` (${dueList.length})` : ""}{v === "pending" && pendingQueue.length ? ` (${pendingQueue.length})` : ""}</button>
        ))}
      </div>
      )}

      {tab === "plans" && (
        <>
          {!readOnly && (
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard value={residents.length} label="Residents" accent="ink" icon={Users} />
            <StatCard value={activePlanByResident.size} label="Active Plans" accent="teal" icon={ClipboardCheck} hint="Released & generating tasks" />
            <StatCard value={residents.filter((r: Row) => draftPlansByResident.has(s(r.id)) && !activePlanByResident.has(s(r.id))).length} label="Drafts" accent="amber" icon={FileClock} hint="Awaiting review" />
            <StatCard value={residents.filter((r: Row) => !residentsWithPlan.has(s(r.id))).length} label="No Plan Yet" accent="coral" icon={FilePlus2} hint="Needs a care plan" />
          </div>
          )}
          <ClinicalCard className="p-5">
            <p className="mb-1 font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>Resident Care Plans</p>
            <p className="mb-3 text-xs text-[var(--clinical-muted)]">Create a care plan for a resident, finalize a held draft, or view the current plan of record. Once activated, the resident&apos;s review appears under Reviews Due after the chosen interval.</p>
            <DataState loading={loading && (cpQ.data || []).length === 0} error={error} empty={residents.length === 0} emptyTitle="No residents" emptyHint="No residents found for this community." onRetry={() => void refetch()} skeletonRows={4}>
              <div className="space-y-2.5">
                {residents.map((r: Row) => {
                  const rid = s(r.id);
                  const active = activePlanByResident.get(rid);
                  const drafts = draftPlansByResident.get(rid) || [];
                  const underReview = underReviewByResident.get(rid);
                  const last = latestReview(rid);
                  const lvl = resLevel(r).n;
                  const activeLvl = planLevelOf(active);
                  const locMismatch = !!active && activeLvl !== null && activeLvl !== lvl;
                  const st = active ? { label: "Active", color: "var(--clinical-green)" }
                    : drafts.length ? { label: "Draft", color: "var(--clinical-amber)" }
                    : underReview ? { label: "Pending approval", color: "var(--clinical-amber)" }
                    : { label: "No plan", color: "var(--clinical-muted)" };
                  return (
                    <div key={rid} className="group flex flex-col gap-3 rounded-xl border px-4 py-3 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_-22px_rgba(15,23,42,0.55)] sm:flex-row sm:items-center sm:gap-3.5" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                      <div className="flex min-w-0 flex-1 items-center gap-3.5">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold" style={{ backgroundColor: `color-mix(in srgb, ${st.color} 15%, transparent)`, color: st.color, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${st.color} 32%, transparent)` }}>{initials(s(r.name))}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="font-bold text-[var(--clinical-ink)]">{s(r.name)}</p>
                            <span className="text-xs font-medium text-[var(--clinical-muted)]">Rm {s(r.room)}</span>
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em]" style={{ backgroundColor: `color-mix(in srgb, ${st.color} 16%, transparent)`, color: st.color }}>{st.label}</span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--clinical-muted)]">
                            <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--clinical-panel) 12%, transparent)", color: "var(--clinical-panel)" }}>Level {lvl}</span>
                            {locMismatch && <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--clinical-amber) 18%, transparent)", color: "var(--clinical-amber)" }}><AlertTriangle className="h-3 w-3" /> Plan is Level {activeLvl} · LOC now {lvl}</span>}
                            {active && <span>Active since {fmt(s(active.startDate).slice(0, 10))}</span>}
                            {last?.nextReviewDate && <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> Next review {fmt(last.nextReviewDate)}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 max-sm:w-full">
                        {(active || underReview || drafts.length > 0) && <ClinicalButton variant="secondary" size="sm" className="max-sm:flex-1" onClick={() => setViewPlan({ resident: r, plan: (drafts[0] || underReview || active) as Row })}>View</ClinicalButton>}
                        {active && <ClinicalButton variant="secondary" size="sm" className="max-sm:flex-1" onClick={() => printPlan(r, active as Row)}><Printer className="h-3.5 w-3.5" /> Print</ClinicalButton>}
                        {!readOnly && (drafts.length > 0
                          ? <ClinicalButton variant="primary" size="sm" className="max-sm:flex-1" onClick={() => { setResId(rid); setTab("new"); }}>Finalize draft</ClinicalButton>
                          : underReview
                          ? <ClinicalButton variant="primary" size="sm" className="max-sm:flex-1" onClick={() => setTab("pending")}>Awaiting approval</ClinicalButton>
                          : locMismatch
                          ? <ClinicalButton variant="primary" size="sm" disabled={genBusy} className="max-sm:flex-1" onClick={() => void createPlanForResident(r)}>Update to Level {lvl}</ClinicalButton>
                          : !active && <ClinicalButton variant="primary" size="sm" disabled={genBusy} className="max-sm:flex-1" onClick={() => void createPlanForResident(r)}>Create care plan</ClinicalButton>)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </DataState>
          </ClinicalCard>
        </>
      )}

      {tab === "new" && (
        <div className="space-y-4">
          <ClinicalCard className="p-5">
            {!embedded && <FieldLabel htmlFor="cpr-res">Select Resident</FieldLabel>}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              {!embedded && (
              <select id="cpr-res" value={resId} onChange={(e) => setResId(e.target.value)} className={`${controlClass} max-w-md`}>
                <option value="">Choose a resident…</option>
                {newReviewResidents.map((r: Row) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — Rm {s(r.room)} (Level {resLevel(r).n})</option>)}
              </select>
              )}
              {resident && (
                <div className="flex shrink-0 items-center gap-2">
                  <ClinicalButton variant="primary" onClick={() => genPlan(builderPlan)} disabled={genBusy} className="shrink-0">
                    {genBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
                    Generate Care Plan
                  </ClinicalButton>
                  {interventionCount > 0 && <span className="text-xs text-[var(--clinical-muted)]">{interventionCount} care domain{interventionCount === 1 ? "" : "s"} · held until nursing approval</span>}
                </div>
              )}
            </div>
          </ClinicalCard>

          {!embedded && !resident && (
            <div className="@container">
              <p className="mb-3 text-sm text-[var(--clinical-muted)]">Or tap a resident to start their care plan review</p>
              {newReviewResidents.length === 0 ? (
                <p className="text-sm text-[var(--clinical-muted)]">Every resident has an active care plan. A resident reappears here once a reassessment is validated and their review frequency is up.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 @lg:grid-cols-3 @3xl:grid-cols-4 @5xl:grid-cols-5">
                  {newReviewResidents.map((r: Row, i: number) => { const lv = resLevel(r); return (
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

          {resident && <CarePlanBuilder key={resId} residentId={resId} residentName={s(resident.name)} room={s(resident.room)} level={resLevel(resident).n} assessmentDomains={builderDomains} saved={drafts[resId]} onPersist={persistDraftState} onCountChange={setInterventionCount} onChange={setBuilderPlan} />}

          {resident && <ReviewForm resident={resident} level={resLevel(resident).n} recentInc={recentInc} recentVariances={recentVariances} last={latestReview(resId)} reviewedBy={clinicianName} heldPlanCount={(draftPlansByResident.get(resId) || []).length} hasExistingPlan={residentsWithPlan.has(resId)}
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
              // A plan-changing decision needs a generated draft to release — otherwise the
              // review would record as "approved" with no plan change (A1). Block it.
              if (PLAN_CHANGE_DECISIONS.has(rec.decision) && !targetPlan) {
                const verb = rec.decision === "New Plan" ? "creates a care plan" : "changes the care plan";
                Swal.fire({ icon: "warning", title: rec.decision === "New Plan" ? "No care plan to create" : "No care plan to change", text: `"${rec.decision}" ${verb}, but no draft has been generated. Generate a care plan above first, then submit the review.` });
                return;
              }
              const now = new Date().toISOString();
              const sponsorId = s((resident?.raw as Row | undefined)?.sponsorId);
              const base = { ...rec, id: newId(), createdAt: now, submittedById: clinicianId, planId: targetPlan ? s(targetPlan.id) : undefined,
                residentName: s(resident?.name), room: s(resident?.room), sponsorId: sponsorId || undefined };

              const isHold = HOLD_DECISIONS.has(rec.decision);
              const willRelease = !!targetPlan && !isHold; // this review would activate/change a plan

              // "Continue Current Plan" without any existing or draft plan makes no sense —
              // there's nothing to continue. The review would be recorded but no CarePlan
              // record is created, leaving the resident in a perpetual "NO PLAN" state.
              const hasExistingPlan = residentsWithPlan.has(rec.residentId);
              if (!isHold && !targetPlan && !hasExistingPlan) {
                Swal.fire({ icon: "warning", title: "No care plan exists",
                  text: `"${rec.decision}" requires an existing care plan. Generate a baseline or individualized care plan above first, then submit this review.` });
                return;
              }

              // CLINICIAN APPROVAL GATE — a plan-releasing review is NOT released on submit.
              // It goes to Pending Approval for a nurse / care manager / superadmin to review
              // and release (which dispatches caregiver tasks). No family sign-off step.
              if (willRelease) {
                try { await updateRecord("care-plans", s(targetPlan!.id), { status: "UNDER_REVIEW" }); } catch { /* best-effort */ }
                await persist([{ ...base, approvalStatus: "PENDING", pendingReason: "Awaiting clinician approval (nurse / care manager / superadmin)." }, ...reviews]);
                await cpQ.refetch?.();
                setResId(""); setTab("pending");
                Swal.fire({ icon: "info", title: "Submitted for approval", text: "The care plan is in Pending Approval. A nurse, care manager, or superadmin can review and release it." });
                return;
              }

              // No plan to release (hold decision, or a continue-as-is review) — record directly.
              await persist([{ ...base, approvalStatus: "APPROVED" }, ...reviews]);
              setResId(""); setTab("history");
              Swal.fire({ toast: true, position: "top-end", icon: isHold && targetPlan ? "info" : "success", title: isHold && targetPlan ? "Review submitted · plan kept on hold" : "Care plan review submitted", showConfirmButton: false, timer: 1800 });
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
                        <p className="text-xs text-[var(--clinical-muted)]">Level {resLevel(r).n} • Last review: {lastReview} • Next due: {nextDue}</p>
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
          empty={pendingQueue.length === 0}
          emptyTitle="Nothing awaiting approval"
          emptyHint="Submitted care plans awaiting a nurse / care manager / superadmin approval appear here."
          onRetry={() => void refetch()}
          skeletonRows={3}
        >
          <div className="space-y-3">
            {pendingQueue.map((rv) => {
              const r = residents.find((x: Row) => s(x.id) === rv.residentId);
              const planRow = rv.planId ? (cpQ.data || []).find((p) => s(p.id) === s(rv.planId)) : null;
              const planLvl = planLevelOf(planRow);       // the level the plan was actually built at
              const curLvl = r ? resLevel(r).n : null;    // the resident's current level of care
              const lvlMismatch = planLvl !== null && curLvl !== null && planLvl !== curLvl;
              const acting = actingId === rv.id;
              const isReady = rv.approvalStatus === "FAMILY_APPROVED";
              const isAwaitingFamily = rv.approvalStatus === "PENDING_FAMILY";
              const canFin = canFinalizeCarePlan(clinicianRole);
              // A family-approved plan, or a plan-releasing review with no family linked, is
              // finalized by a Care Manager. Legacy PENDING reviews keep the old approve/reject.
              const finalizable = isReady || (isAwaitingFamily && !rv.sponsorId);
              return (
                <ClinicalCard key={rv.id} className="p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold text-[var(--clinical-ink)]">{s(r?.name) || rv.residentName || "Resident"} <span className="text-xs font-normal text-[var(--clinical-muted)]">Rm {s(r?.room) || rv.room}</span></p>
                        <StatusPill status={isReady ? "FAMILY APPROVED" : isAwaitingFamily ? "AWAITING FAMILY" : "AWAITING APPROVAL"} />
                      </div>
                      <p className="mt-1 text-sm text-[var(--clinical-ink-soft)]"><b>{rv.decision}</b> · Level {planLvl ?? rv.levelAtReview} · {rv.reviewPeriod}</p>
                      {lvlMismatch && <p className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--clinical-amber) 18%, transparent)", color: "var(--clinical-amber)" }}><AlertTriangle className="h-3 w-3" /> Plan is Level {planLvl} · resident now Level {curLvl} — regenerate before finalizing</p>}
                      {rv.reason && <p className="mt-1 text-xs text-[var(--clinical-muted)]">Rationale: {rv.reason}</p>}
                      <p className="mt-1 text-xs text-[var(--clinical-muted)]">Submitted {fmt((rv.createdAt || "").slice(0, 10))}{rv.reviewedBy ? ` by ${rv.reviewedBy}` : ""}</p>
                      {rv.familyDecidedAt && <p className="mt-1 text-xs font-medium" style={{ color: "var(--clinical-green)" }}>Family signed off — {rv.familyDecidedByName || "Family"} · {fmt(rv.familyDecidedAt.slice(0, 10))}</p>}
                      {isAwaitingFamily && <p className="mt-1.5 text-xs" style={{ color: "var(--clinical-amber)" }}>{rv.sponsorId ? "Waiting for the family sponsor to sign off." : "No family linked — a Care Manager or Super Admin may finalize directly."}</p>}
                      {isReady && !canFin && <p className="mt-1.5 text-xs text-[var(--clinical-muted)]">A Care Manager or Superadmin will finalize this plan.</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {planRow && <ClinicalButton variant="secondary" size="sm" onClick={() => setViewPlan({ resident: (r || { id: rv.residentId, name: rv.residentName, room: rv.room }) as Row, plan: planRow as Row })}>View plan</ClinicalButton>}
                      {finalizable ? (
                        <ClinicalButton variant="primary" size="sm" disabled={acting || !canFin} onClick={() => void finalizeReview(rv)} title={!canFin ? "Care Manager / Superadmin only" : undefined}>
                          {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />} Finalize
                        </ClinicalButton>
                      ) : isAwaitingFamily ? (
                        <span className="text-xs font-medium text-[var(--clinical-muted)]">Awaiting family</span>
                      ) : (
                        <>
                          <ClinicalButton variant="secondary" size="sm" disabled={acting} onClick={() => void rejectPending(rv)}>Reject</ClinicalButton>
                          <ClinicalButton variant="primary" size="sm" disabled={acting} onClick={() => void approvePending(rv)}>
                            {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />} Approve &amp; release
                          </ClinicalButton>
                        </>
                      )}
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
                {[...reviews].filter((rv) => !readOnly || residents.some((x: Row) => s(x.id) === rv.residentId)).sort((a, b) => (b.reviewDate || "").localeCompare(a.reviewDate || "")).map((rv) => { const r = residents.find((x: Row) => s(x.id) === rv.residentId); return (
                  <tr key={rv.id} className="border-b last:border-0" style={{ borderColor: "var(--clinical-line)" }}>
                    <td className="px-4 py-2.5"><span className="font-semibold text-[var(--clinical-ink)]">{s(r?.name) || "Resident"}</span> <span className="text-xs text-[var(--clinical-muted)]">Rm {s(r?.room)}</span></td>
                    <td className="px-4 py-2.5 text-[var(--clinical-ink-soft)]">{fmt(rv.reviewDate)} <span className="text-[var(--clinical-muted)]">· {rv.reviewPeriod}</span></td>
                    <td className="px-4 py-2.5 font-semibold text-[var(--clinical-ink-soft)]">Level {rv.levelAtReview}</td>
                    <td className="px-4 py-2.5 text-[var(--clinical-ink-soft)]">{rv.decision}</td>
                    <td className="px-4 py-2.5 text-[var(--clinical-ink-soft)]">
                      {reviewOutcome({ decision: rv.decision, approvalStatus: rv.approvalStatus, released: !!rv.approvedAt, approvedByName: rv.approvedByName })}
                      {rv.familyDecidedAt && <span className="mt-0.5 block text-[11px] text-[var(--clinical-muted)]">Family: {rv.familyDecidedByName || "—"} · {fmt(rv.familyDecidedAt.slice(0, 10))}</span>}
                      {rv.approvedAt && <span className="mt-0.5 block text-[11px] text-[var(--clinical-muted)]">Finalized: {rv.approvedByName || "—"} · {fmt(rv.approvedAt.slice(0, 10))}</span>}
                    </td>
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
          description={`A Level ${resLevel(resident).n} plan for ${s(resident.name)} · ${genConfirm.plan ? `${genConfirm.plan.interventions.length} individualized intervention${genConfirm.plan.interventions.length === 1 ? "" : "s"}` : "baseline package"}`}
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
                  <span className="rounded-md px-1.5 py-0.5 font-bold text-white" style={{ backgroundColor: "var(--clinical-panel)" }}>Level {resLevel(resident).n}</span>
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
                <p>This resident <b className="text-[var(--clinical-ink)]">already has a care plan</b>. Regenerating <b className="text-[var(--clinical-ink)]">replaces any held draft</b>; an active or under-review plan stays in place until this new draft is submitted and finalized.</p>
              </div>
            )}
          </div>
        </ClinicalModal>
      )}
      {viewPlan && (
        <ClinicalModal open onClose={() => setViewPlan(null)} size="lg"
          title={s(viewPlan.plan.status) === "DRAFT" ? "Draft Care Plan · pending review" : s(viewPlan.plan.status) === "UNDER_REVIEW" ? "Care Plan · under review" : "Current Care Plan"}
          description={`${s(viewPlan.resident.name)} — Rm ${s(viewPlan.resident.room)} · ${s(viewPlan.plan.title) || `Level ${resLevel(viewPlan.resident).n} plan`}`}
          footer={<ClinicalButton variant="secondary" onClick={() => setViewPlan(null)}>Close</ClinicalButton>}
        >
          {(() => { const pl = planLevelOf(viewPlan.plan); const cur = resLevel(viewPlan.resident).n; return pl !== null && pl !== cur ? (
            <div className="mb-4 flex items-start gap-2 rounded-xl border p-3 text-xs" style={{ borderColor: "color-mix(in srgb, var(--clinical-amber) 40%, transparent)", backgroundColor: "color-mix(in srgb, var(--clinical-amber) 12%, transparent)", color: "var(--clinical-amber)" }}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>This plan was built at <b>Level {pl}</b>, but the resident&apos;s current level of care is <b>Level {cur}</b>. Create a new Level {cur} plan (Care Plans → Update to Level {cur}) and finalize it to supersede this one.</span>
            </div>
          ) : null; })()}
          <CurrentPlanView plan={viewPlan.plan} nextReviewDate={latestReview(s(viewPlan.resident.id))?.nextReviewDate} draft={s(viewPlan.plan.status) === "DRAFT" ? drafts[s(viewPlan.resident.id)] : undefined} />
        </ClinicalModal>
      )}
    </>
  );
  return embedded ? <div className="space-y-5">{body}</div> : <div className="-m-4 sm:-m-6 p-4 sm:p-6 min-h-full space-y-5" style={{ background: "#F7F8FA" }}>{body}</div>;
}

// Read-only view of a resident's active care plan — meta strip, goals, and
// interventions (each parsed into title · detail · frequency pill).
function CurrentPlanView({ plan, nextReviewDate, draft }: { plan: Row; nextReviewDate?: string; draft?: DraftState | null }) {
  // For a DRAFT with a live builder snapshot, render from the snapshot (the
  // freshest, complete individualization) rather than the plan's stored string,
  // which may lag the nurse's latest un-regenerated edits.
  const goals = (draft?.goals?.length ? draft.goals : s(plan.careGoals).split("\n")).map((x) => String(x ?? "").trim()).filter(Boolean);
  const domName = (code: string) => SCORED_DOMAINS.find((d) => d.code === code)?.name || code;
  // Stored-string interventions (the released plan of record) — also the safe
  // fallback if a draft snapshot is malformed.
  const storedIvs = () => s(plan.interventions).split("\n").map((x) => x.trim()).filter(Boolean).map(parseIntervention);
  // A malformed draft snapshot (a domain with no `interventions`, an item with no
  // `note`, etc.) must NEVER crash this read-only view — every field is guarded and
  // the whole derivation is wrapped so any unexpected shape falls back to the stored plan.
  let ivs: { title: string; desc: string; freq: string }[];
  try {
    ivs = draft?.domainPlan?.length
      // v4.2 assessment-domain draft — one line per included domain, its Interventions bundled.
      ? draft.domainPlan.filter((d) => d.included).map((d) => ({
          title: `${d.code} · ${domName(d.code)}`,
          desc: (d.interventions || []).map((x) => (x || "").trim()).filter(Boolean).join(" • "),
          freq: "",
        })).filter((iv) => iv.desc)
      : draft?.items?.length
      // Legacy level-package draft (taskId-based items).
      ? draft.items.filter((i) => i.included).map((i) => { const t = taskById(i.taskId); return {
          title: t?.name || i.taskId,
          desc: [i.assistance && `Assistance: ${i.assistance}`, (i.note || "").trim() || t?.approvedIntervention || t?.definition || ""].filter(Boolean).join(" · "),
          freq: i.freq,
        }; })
      : storedIvs();
  } catch {
    ivs = storedIvs();
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <StatusPill status={s(plan.status)} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--clinical-muted)]">
          {plan.startDate && <span>Active since <span className="font-semibold text-[var(--clinical-ink-soft)]">{fmt(s(plan.startDate).slice(0, 10))}</span></span>}
          {plan.reviewFrequency && <span className="capitalize">{s(plan.reviewFrequency).toLowerCase()} review</span>}
          {nextReviewDate && <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> Next {fmt(nextReviewDate)}</span>}
        </div>
      </div>

      <section>
        <div className="mb-2.5 flex items-center gap-2"><Target className="h-4 w-4" style={{ color: "var(--clinical-panel)" }} /><h3 className="text-sm font-bold text-[var(--clinical-ink)]">Care Goals</h3></div>
        {goals.length ? (
          <ul className="space-y-1.5">
            {goals.map((g, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-6 text-[var(--clinical-ink-soft)]">
                <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: "var(--clinical-panel)" }} />
                <span>{g}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-[var(--clinical-muted)]">No goals recorded.</p>}
      </section>

      <section>
        <div className="mb-2.5 flex items-center gap-2">
          <ListChecks className="h-4 w-4" style={{ color: "var(--clinical-panel)" }} />
          <h3 className="text-sm font-bold text-[var(--clinical-ink)]">Interventions</h3>
          {ivs.length > 0 && <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--clinical-panel) 12%, transparent)", color: "var(--clinical-panel)" }}>{ivs.length}</span>}
        </div>
        {ivs.length ? (
          <ul className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--clinical-line)" }}>
            {ivs.map((iv, i) => (
              <li key={i} className="flex items-start justify-between gap-3 border-t px-3.5 py-2.5 first:border-t-0" style={{ borderColor: "var(--clinical-line)" }}>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--clinical-ink)]">{iv.title}</p>
                  {iv.desc && <p className="mt-0.5 text-xs leading-5 text-[var(--clinical-muted)]">{iv.desc}</p>}
                </div>
                {iv.freq && <span className="mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em]" style={{ backgroundColor: "color-mix(in srgb, var(--clinical-panel) 12%, transparent)", color: "var(--clinical-panel)" }}>{iv.freq}</span>}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-[var(--clinical-muted)]">No interventions recorded.</p>}
      </section>
    </div>
  );
}

// Read-only Care Plan tab for the resident hub (One Care · One Journey). Resolves
// the resident's current plan of record — Active → Under-review → Draft — and
// reuses CurrentPlanView. Migration-free; no picker, locked to one residentId.
export function ResidentCarePlanView({ residentId }: { residentId: string }) {
  const cpQ = useLiveQuery<Row>("care-plans", { query: "take=300", tables: ["CarePlan"] });
  const { data: settingRows, loading, error } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  const drafts = useMemo(() => parseCarePlanDrafts(settingRows.find((r) => (r.key || r.id) === CARE_PLAN_DRAFTS_KEY)?.value), [settingRows]);
  const reviews = useMemo(() => parseReviews(settingRows.find((r) => (r.key || r.id) === REVIEW_KEY)?.value), [settingRows]);
  const plan = useMemo(() => {
    const mine = (cpQ.data || []).filter((p) => s(p.residentId) === residentId && s(p.status) !== "DISCONTINUED");
    return mine.find((p) => s(p.status) === "ACTIVE") || mine.find((p) => s(p.status) === "UNDER_REVIEW") || mine.find((p) => s(p.status) === "DRAFT") || null;
  }, [cpQ.data, residentId]);
  const nextReviewDate = useMemo(() => reviews.filter((r) => r.residentId === residentId).sort((a, b) => (b.reviewDate || "").localeCompare(a.reviewDate || ""))[0]?.nextReviewDate, [reviews, residentId]);
  return (
    <ClinicalCard className="p-4 sm:p-5">
      <DataState
        loading={(cpQ.loading || loading) && !plan}
        error={error ? String(error) : undefined}
        empty={!plan}
        emptyTitle="No care plan yet"
        emptyHint="A care plan appears here once one is generated and released in Care Plan Reviews."
      >
        {plan && <CurrentPlanView plan={plan} nextReviewDate={nextReviewDate} draft={s(plan.status) === "DRAFT" ? drafts[residentId] : undefined} />}
      </DataState>
    </ClinicalCard>
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

// ── Individualized Care Plan editor — assessment-domain Goal + Interventions ────
// v4.2: the plan is built from the resident's assessment, one card per scored
// domain. Goal seeds from the Goal / Preference Note (which itself defaults from
// the Domain-Level Map); Interventions seed from the Domain-Level Map Core Care
// Tasks for the selected score. Both are freely editable. Each domain still links
// to its representative governed Level-N task (taskId) so a released plan keeps
// dispatching caregiver tasks (governance B5) — see buildDomainPlan.
interface DomainRow {
  code: string; name: string; score: number;
  taskId: string;          // representative governed Level-N task for dispatch (may be "")
  included: boolean;
  goal: string;            // editable Goal / Preference
  interventions: string[]; // editable Core Care Tasks — one row each (add/remove)
}

// Overlay a saved per-domain snapshot onto the assessment-derived base rows. The
// assessment stays authoritative for which domains exist + their score; only the
// nurse-editable fields (included/goal/interventions) are overlaid.
function mergeSavedDomain(base: DomainRow[], saved?: SavedDomainPlanItem[] | null): DomainRow[] {
  if (!saved?.length) return base;
  const by = new Map(saved.map((sv) => [sv.code, sv]));
  return base.map((r) => { const sv = by.get(r.code); return sv ? { ...r, included: sv.included, goal: sv.goal, interventions: sv.interventions } : r; });
}

// Assessment-domain rows (one per scored domain) — the individualized plan basis
// shared by the CarePlanBuilder and the one-click "Create care plan" action, so
// both generate the SAME per-domain plan (not the full Level-N task package). Each
// row carries the representative governed Level-N taskId for dispatch linkage.
function assessmentDomainRows(assessmentDomains: Partial<Record<string, DomainEntry>> | null | undefined, level: number): DomainRow[] {
  const dm = assessmentDomains || {};
  const taskIdByCode: Record<string, string> = {};
  for (const t of levelCareTasks(level)) {
    const code = domainCodeFromLabel(t.domain) || domainCodeFromLabel(t.name);
    if (code && !taskIdByCode[code]) taskIdByCode[code] = t.id;
  }
  return SCORED_DOMAINS.filter((d) => dm[d.code] && typeof dm[d.code]?.score === "number").map((d) => {
    const entry = dm[d.code]!;
    const score = Math.max(0, Math.min(4, entry.score ?? 0));
    return {
      code: d.code, name: d.name, score, taskId: taskIdByCode[d.code] || "", included: true,
      goal: entry.goalNote?.trim() || d.goalDefaults?.[score] || "",
      interventions: (d.interventionDefaults?.[score] || []).map((x) => x.trim()).filter(Boolean),
    };
  });
}
// A per-domain builder snapshot from rows — the migration-free draft persisted so
// the builder re-hydrates the same individualized selections.
const domainSnapshot = (rows: DomainRow[]): SavedDomainPlanItem[] => rows.map((r) => ({ code: r.code, included: r.included, goal: r.goal, interventions: r.interventions }));

// Rows → the generator's { goals, interventions } contract. Goals carry the domain
// label so the flattened plan still reads per-domain; each intervention keeps its
// governed taskId so a released plan still materializes caregiver tasks.
function buildDomainPlan(rows: DomainRow[]): { goals: string[]; interventions: PlanIntervention[] } {
  const inc = rows.filter((r) => r.included);
  return {
    goals: inc.filter((r) => r.goal.trim()).map((r) => `${r.name}: ${r.goal.trim()}`),
    interventions: inc.map((r) => ({
      domain: r.name,
      title: `${r.code} · ${r.name}`,
      freq: "Per care plan",
      taskId: r.taskId || undefined,
      note: r.interventions.map((x) => x.trim()).filter(Boolean).join(" • ") || "Individualize interventions, assistance and preferences.",
    })),
  };
}

function CarePlanBuilder({ residentId, residentName, room, level, assessmentDomains, saved, onPersist, onCountChange, onChange }: {
  residentId: string; residentName?: string; room?: string; level: number;
  assessmentDomains?: Partial<Record<string, DomainEntry>> | null;
  saved?: DraftState | null;
  onPersist?: (residentId: string, state: DraftState) => void;
  onCountChange?: (count: number) => void;
  onChange?: (plan: { title?: string; goals: string[]; interventions: PlanIntervention[] }) => void;
}) {
  const meta = levelMeta(level);
  // One base row per scored domain the assessment actually scored (representative
  // governed Level-N taskId attached for dispatch). Shared with createPlanForResident.
  const baseRows = useMemo<DomainRow[]>(() => assessmentDomainRows(assessmentDomains, level), [assessmentDomains, level]);

  const [rows, setRows] = useState<DomainRow[]>(() => mergeSavedDomain(baseRows, saved?.domainPlan));
  // Re-hydrate only when the assessment's domain/score signature changes (loaded
  // async, or a reassessment) — never on the nurse's own edits or auto-save echo.
  const sig = baseRows.map((r) => `${r.code}:${r.score}`).join("|");
  const sigRef = useRef(sig);
  useEffect(() => {
    if (sigRef.current === sig) return;
    sigRef.current = sig;
    setRows(mergeSavedDomain(baseRows, saved?.domainPlan));
  }, [sig, baseRows, saved]);

  const patch = (code: string, p: Partial<DomainRow>) => setRows((arr) => arr.map((x) => (x.code === code ? { ...x, ...p } : x)));
  // Per-intervention row edits — nurse/CG add, edit or remove individual tasks.
  const setIvx = (code: string, i: number, v: string) => setRows((arr) => arr.map((x) => (x.code === code ? { ...x, interventions: x.interventions.map((t, j) => (j === i ? v : t)) } : x)));
  const addIvx = (code: string) => setRows((arr) => arr.map((x) => (x.code === code ? { ...x, interventions: [...x.interventions, ""] } : x)));
  // Append a specific care task from the Task Library (skip if already present).
  const addIvxText = (code: string, text: string) => setRows((arr) => arr.map((x) => {
    if (x.code !== code) return x;
    const has = x.interventions.some((t) => t.trim().toLowerCase() === text.trim().toLowerCase());
    return has ? x : { ...x, interventions: [...x.interventions, text] };
  }));
  const removeIvx = (code: string, i: number) => setRows((arr) => arr.map((x) => (x.code === code ? { ...x, interventions: x.interventions.filter((_, j) => j !== i) } : x)));
  const included = rows.filter((r) => r.included);
  // The 24-hour routine this plan will generate on release — same pure generator
  // the task materializer uses, so the preview is exactly what gets dispatched.
  const routine = useMemo(
    () => generateRoutine(rows.filter((r) => r.included).map((r) => ({ code: r.code, name: r.name, goal: r.goal, interventions: r.interventions, taskId: r.taskId }))),
    [rows],
  );
  const levelName = meta ? `Level ${meta.n} — ${meta.name}` : `Level ${level}`;
  const doPrint = () => printCarePlan({
    residentName: residentName || "Resident", room, level, levelName,
    domains: included.map((r) => ({ code: r.code, name: r.name, score: r.score, goal: r.goal, interventions: r.interventions })),
  });

  useEffect(() => { onCountChange?.(included.length); }, [included.length, onCountChange]);
  useEffect(() => { onChange?.(buildDomainPlan(rows)); }, [rows, onChange]);

  // Debounced auto-save of the per-domain snapshot (skip the hydration render).
  const hydrated = useRef(false);
  useEffect(() => {
    if (!hydrated.current) { hydrated.current = true; return; }
    if (!onPersist) return;
    const t = setTimeout(() => {
      onPersist(residentId, {
        level,
        goals: buildDomainPlan(rows).goals,
        items: [],
        domainPlan: domainSnapshot(rows),
        updatedAt: new Date().toISOString(),
      });
    }, 700);
    return () => clearTimeout(t);
  }, [rows, level, residentId, onPersist]);

  return (
    <Section title="Individualized Care Plan">
      {meta && (
        <div className="-mt-1 mb-4 rounded-xl border p-3.5" style={{ borderColor: "var(--clinical-line-strong)", backgroundColor: "var(--clinical-surface-2)" }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md px-2 py-0.5 text-xs font-bold text-white" style={{ backgroundColor: "var(--clinical-panel)" }}>Level {meta.n}</span>
            <span className="font-bold text-[var(--clinical-ink)]">{meta.name}</span>
            <span className="text-xs text-[var(--clinical-muted)]">· {meta.intensity} intensity</span>
          </div>
          <p className="mt-1.5 text-[11px] text-[var(--clinical-muted)]">Built from the resident&apos;s assessment — one line per scored domain. <b>Goal</b> is seeded from the Goal / Preference Note; <b>Interventions</b> from the Domain-Level Map for the selected score. Edit any, then Generate Care Plan.</p>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border p-4 text-sm text-[var(--clinical-muted)]" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)" }}>
          No validated assessment found for this resident. <b>Validate</b> the 14-domain <b>Resident Assessment</b> first — the care plan builds only from a validated assessment&apos;s scores and their Goal / Preference Notes.
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--clinical-muted)]">Care domains ({included.length}/{rows.length} included)</p>
            <button type="button" onClick={doPrint} disabled={included.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold text-[var(--clinical-panel)] transition hover:bg-[var(--clinical-surface-2)] disabled:opacity-50"
              style={{ borderColor: "var(--clinical-line-strong)" }}>
              <Printer className="h-3.5 w-3.5" /> Print Care Plan
            </button>
          </div>
          <div className="space-y-3">
            {rows.map((r) => (
              <ClinicalCard key={r.code} top="teal" className={`p-4 sm:p-5 transition ${r.included ? "" : "opacity-55"}`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label className="flex min-w-0 items-center gap-2">
                    <input type="checkbox" checked={r.included} onChange={(e) => patch(r.code, { included: e.target.checked })} aria-label={`Include ${r.name}`} className="h-4 w-4 shrink-0 accent-[var(--clinical-panel)]" />
                    <h3 className="truncate text-sm font-bold text-[var(--clinical-ink)]"><span className="mr-1.5 text-[var(--clinical-panel)]">{r.code}</span>{r.name}</h3>
                  </label>
                  <span className="shrink-0 rounded px-2 py-0.5 text-xs font-bold text-[var(--clinical-panel)]" style={{ backgroundColor: "color-mix(in srgb, var(--clinical-panel) 12%, transparent)" }}>Score {r.score}<span className="font-medium text-[var(--clinical-muted)]">/4</span></span>
                </div>
                {r.included && (
                  <div className="space-y-3">
                    <div>
                      <FieldLabel htmlFor={`goal-${r.code}`}>Goal / Preference</FieldLabel>
                      <textarea id={`goal-${r.code}`} rows={2} value={r.goal} onChange={(e) => patch(r.code, { goal: e.target.value })} placeholder="Resident-specific goal…" className={controlClass} />
                    </div>
                    <div>
                      <FieldLabel>Interventions</FieldLabel>
                      <div className="space-y-1.5">
                        {r.interventions.map((iv, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: "var(--clinical-panel)" }} />
                            <input value={iv} onChange={(e) => setIvx(r.code, i, e.target.value)} placeholder="Care task…" className={`${controlClass} flex-1`} />
                            <button type="button" onClick={() => removeIvx(r.code, i)} aria-label="Remove intervention"
                              className="mt-1 shrink-0 rounded-md p-1.5 text-[var(--clinical-muted)] transition hover:bg-[var(--clinical-surface-2)] hover:text-[var(--clinical-coral)]">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => addIvx(r.code)}
                          className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold text-[var(--clinical-panel)] transition hover:bg-[var(--clinical-surface-2)]"
                          style={{ borderColor: "var(--clinical-line-strong)" }}>
                          <Plus className="h-3.5 w-3.5" /> Add intervention
                        </button>
                        {(() => {
                          const lib = tasksForDomain(r.code, r.score);
                          if (!lib.length) return null;
                          return (
                            <select value="" aria-label={`Add a ${r.code} task from the library`}
                              onChange={(e) => { if (e.target.value) addIvxText(r.code, e.target.value); e.currentTarget.selectedIndex = 0; }}
                              className="rounded-lg border bg-[var(--clinical-surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--clinical-panel)]" style={{ borderColor: "var(--clinical-line-strong)" }}>
                              <option value="">＋ Add from library…</option>
                              <optgroup label="Core tasks">
                                {lib.filter((t) => t.type === "Core").map((t) => <option key={t.id} value={t.text}>{t.text}</option>)}
                              </optgroup>
                              {lib.some((t) => t.type === "Condition") && (
                                <optgroup label="Condition-specific">
                                  {lib.filter((t) => t.type === "Condition").map((t) => <option key={t.id} value={t.text}>{t.condition ? `[${t.condition}] ` : ""}{t.text}</option>)}
                                </optgroup>
                              )}
                            </select>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                )}
              </ClinicalCard>
            ))}
          </div>

          {routine.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 flex items-center gap-2">
                <Clock className="h-4 w-4 text-[var(--clinical-panel)]" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--clinical-muted)]">24-Hour Routine Preview · {routine.length} care event{routine.length === 1 ? "" : "s"}</p>
              </div>
              <p className="mb-3 text-[11px] text-[var(--clinical-muted)]">On approval, these window care events become the resident&apos;s daily caregiver tasks, routed to each shift&apos;s rostered caregiver.</p>
              <RoutineTimeline events={routine} />
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function ReviewForm({ resident, level, recentInc, recentVariances = [], last, reviewedBy, heldPlanCount = 0, hasExistingPlan = false, onSubmit }: {
  resident: Row; level: number; recentInc: Row[]; recentVariances?: Row[]; last?: Review; reviewedBy: string; heldPlanCount?: number; hasExistingPlan?: boolean;
  onSubmit: (rec: Omit<Review, "id" | "createdAt">) => Promise<void>;
}) {
  const today = new Date();
  const lvl = level;
  const nextReviewFor = (opt: string) => {
    switch (opt) {
      case "30 days": return isoDate(addDays(today, 30));
      case "90 days": return isoDate(addDays(today, 90));
      case "6 months": return isoDate(addMonths(today, 6));
      case "Annually": return isoDate(addMonths(today, 12));
      default: return ""; // On change of condition — event-driven, no scheduled date
    }
  };
  const [reviewInterval, setReviewInterval] = useState("90 days");
  const [nextReviewDate, setNextReviewDate] = useState(nextReviewFor("90 days"));
  const onChangeInterval = reviewInterval === ON_CHANGE_INTERVAL;
  const applyInterval = (opt: string) => { setReviewInterval(opt); setNextReviewDate(nextReviewFor(opt)); };
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
    if (!onChangeInterval && !nextReviewDate) { Swal.fire({ title: "Next review date required", text: "Set the next review date before approving the care plan.", icon: "warning" }); return; }
    if (!reason.trim()) { Swal.fire({ title: "Decision rationale required", text: "Document the nursing rationale before submitting the review.", icon: "warning" }); return; }
    setSaving(true);
    try {
      // "On change of condition" has no scheduled date — store a 6-month backstop so the
      // plan stays finalizable and appears in Reviews Due by then at the latest.
      const effectiveNextReview = onChangeInterval ? isoDate(addMonths(today, 6)) : nextReviewDate;
      await onSubmit({ residentId: s(resident.id), reviewDate: isoDate(today), reviewPeriod: periodOf(today), levelAtReview: lvl, nextReviewDate: effectiveNextReview, reviewInterval, carePlanStatus, familyUpdate, physicianFollowup, decision, reason: reason || undefined, actionPlan: actionPlan || undefined, responsible: responsible || undefined, targetDate: targetDate || undefined, reviewedBy });
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
          <div><FieldLabel htmlFor="cpr-interval">Review Interval</FieldLabel><select id="cpr-interval" value={reviewInterval} onChange={(e) => applyInterval(e.target.value)} className={controlClass}>{REVIEW_INTERVALS.map((o) => <option key={o} value={o}>{o}</option>)}</select></div>
          <div><FieldLabel htmlFor="cpr-next">Next Review Date</FieldLabel><input id="cpr-next" type="date" value={nextReviewDate} onChange={(e) => setNextReviewDate(e.target.value)} disabled={onChangeInterval} className={controlClass} />{onChangeInterval && <p className="mt-1 text-[11px] text-[var(--clinical-muted)]">Event-driven — reviewed on any significant change; a 6-month backstop applies.</p>}</div>
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
              <span className="text-[var(--clinical-ink)]"><b>{heldPlanCount} draft care plan{heldPlanCount === 1 ? "" : "s"} held.</b> Submitting a plan-changing review sends it to the resident&apos;s family for sign-off; once they approve, a Care Manager finalizes it and tasks dispatch to caregivers. <i>Refer to Physician</i> and <i>Schedule Family Conference</i> keep the plan on hold instead.</span>
            </div>
          )}
          <div><FieldLabel required htmlFor="cpr-decision">Decision</FieldLabel><select id="cpr-decision" value={decision} onChange={(e) => setDecision(e.target.value)} className={`${controlClass} max-w-xs`}><option value="">Select a decision…</option>{DECISIONS.map((d) => <option key={d} value={d}>{d}</option>)}</select></div>
          {decision && heldPlanCount === 0 && !hasExistingPlan && !HOLD_DECISIONS.has(decision) && (
            <div className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm" style={{ borderColor: "color-mix(in srgb, #dc2626 40%, transparent)", backgroundColor: "color-mix(in srgb, #dc2626 8%, transparent)", color: "var(--clinical-ink-soft)" }}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#dc2626" }} />
              <span className="text-[var(--clinical-ink)]"><b>No care plan exists for this resident.</b> Generate a baseline or individualized care plan above before submitting this review — otherwise the review is recorded but no plan is created.</span>
            </div>
          )}
          <div><FieldLabel required htmlFor="cpr-reason">Reason for Decision / Notes</FieldLabel><textarea id="cpr-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain the nursing rationale…" className={controlClass} /></div>
          <div><FieldLabel htmlFor="cpr-action">Action Plan</FieldLabel><textarea id="cpr-action" rows={2} value={actionPlan} onChange={(e) => setActionPlan(e.target.value)} placeholder="Steps to be taken…" className={controlClass} /></div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><FieldLabel htmlFor="cpr-resp">Responsible Person</FieldLabel><input id="cpr-resp" value={responsible} onChange={(e) => setResponsible(e.target.value)} placeholder="Name or role" className={controlClass} /></div>
            <div><FieldLabel htmlFor="cpr-target">Target Completion Date</FieldLabel><input id="cpr-target" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className={controlClass} /></div>
          </div>
          <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[#4F46E5] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#4338CA] disabled:opacity-60"><ClipboardList className="h-4 w-4" /> {saving ? "Submitting…" : heldPlanCount > 0 ? "Submit Care Plan" : "Submit Care Plan Review"}</button>
        </div>
      </Section>
    </>
  );
}
