import { createRecord, updateRecord } from "@/lib/api";
import careLevelModel from "@/lib/lifecare/data/care_level_model.json";
import { domainInPackage, domainCodeFromLabel } from "@/lib/lifecare/carePackage";
import { CARE_TASK_MASTER } from "@/lib/lifecare/dataset";
import type { CareTask } from "@/lib/lifecare/types";
import { parseSchedules, assigneeForResidentToday } from "@/lib/caregiverSchedule";

/** Read the caregiver roster (migration-free app-setting) to route tasks. */
async function fetchSchedules() {
  try {
    const r = await fetch("/api/db/app-settings?f_key=caregiver_schedules&take=1", { credentials: "same-origin", cache: "no-store" });
    const j = await r.json();
    return parseSchedules((j?.data as Array<{ value?: string }> | undefined)?.[0]?.value);
  } catch { return []; }
}

/**
 * Shared care-plan + task generator — the Stage 6 → 8 → 9 bridge.
 *
 * Given an approved Level of Care, create a structured Care Plan (CarePlan +
 * CarePlanItem goals/interventions) and spin the interventions into caregiver
 * Tasks. Used by BOTH the Care Acuity board (auto, on approval) and the Care Plan
 * Reviews board (manual "Generate care plan & tasks" button).
 *
 * The per-level template is DERIVED from the LifeCare v3.9 Care Level Model
 * rule-data (care_level_model.json) — the workbook's authoritative "Operational
 * Care Task Package — Baseline by LOC" — rather than hardcoded prose. Retiring
 * the hardcoded templates keeps a single, tunable source of truth. For
 * assessment-driven plans (nurse picks Task IDs for the active needs), see
 * carePlanV42Gen.ts.
 */

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

interface LevelRow { level: string; conceptualProfile: string; typicalNeedPattern: string; baselineCarePackage: string; }
interface BaselineRow { domain: string; L1: string; L2: string; L3: string; L4: string; modifierRule: string; }
const MODEL = careLevelModel as { levels: LevelRow[]; baselineByDomain: BaselineRow[] };

// Which baseline care domains are included in the package at each level (the
// package broadens as acuity rises). L5 is the comfort/palliative pathway.
const LEVEL_DOMAINS: Record<number, string[]> = {
  1: ["Personal ADLs", "Clinical Monitoring", "Reablement / Engagement"],
  2: ["Personal ADLs", "Mobility / Transfers", "Meals / Nutrition", "Medication", "Clinical Monitoring"],
  3: ["Personal ADLs", "Mobility / Transfers", "Toileting / Continence", "Meals / Nutrition", "Medication", "Clinical Monitoring", "Safety / Fall Prevention", "Skin Integrity"],
  4: MODEL.baselineByDomain.map((b) => b.domain), // comprehensive: all baseline domains
  5: ["Clinical Monitoring", "Medication", "Skin Integrity", "Meals / Nutrition", "Personal ADLs"],
};

const levelCol = (b: BaselineRow, level: number): string =>
  level >= 4 ? b.L4 : level === 3 ? b.L3 : level === 2 ? b.L2 : b.L1;

export interface PlanIntervention { title: string; freq: string; note?: string; domain?: string }
export interface LevelPlanTemplate { title: string; goals: string[]; interventions: PlanIntervention[] }

/** Build the per-level plan template (title, goals, interventions) from rule-data. */
export function levelPlan(level: number): LevelPlanTemplate {
  const n = Math.min(5, Math.max(1, level));
  const lm = MODEL.levels.find((l) => l.level === `L${n}`) ?? MODEL.levels[1];
  const domains = LEVEL_DOMAINS[n] ?? LEVEL_DOMAINS[2];
  const goals = [
    lm.typicalNeedPattern,
    "Maintain the highest practicable independence, dignity, comfort and safety.",
    "Recognise, document and escalate any significant change in condition.",
  ].filter(Boolean);
  const interventions: PlanIntervention[] = domains
    .map((d) => MODEL.baselineByDomain.find((b) => b.domain === d))
    .filter((b): b is BaselineRow => !!b)
    .map((b) => ({
      domain: b.domain,
      title: `${b.domain}: ${n >= 5 ? "comfort-focused support" : levelCol(b, n)}`,
      freq: "Per care plan — individualise",
    }));
  return {
    title: `${lm.conceptualProfile} (Level ${n}) — Care Plan`,
    goals,
    interventions,
  };
}

/**
 * The governed care-task PACKAGE for a Level of Care — the tasks whose
 * `careLevel` equals this level (auto-generate set) in the care_task_master
 * decision-rules. This is what an Individualized Care Plan draws from: a Level-N
 * resident's plan may only include Level-N package tasks (nothing above/below).
 */
export function levelCareTasks(level: number): CareTask[] {
  const n = Math.min(5, Math.max(1, Math.round(level) || 1));
  return CARE_TASK_MASTER.filter((t) => t.careLevel === `L${n}` && /AUTO-GENERATE/i.test(t.generationStatus));
}

/** Parse a CareTask.assistanceOptions blob (e.g. "C/S; SBA; CGA; Min … — select …") into levels. */
export function parseAssistanceOptions(raw: string): string[] {
  const head = String(raw || "").split("—")[0];
  return head.split(/[;,]/).map((x) => x.trim()).filter((x) => x && x.length <= 12);
}

// CarePlanReviewFrequency enum: WEEKLY | BIWEEKLY | MONTHLY | QUARTERLY | ANNUAL.
const REVIEW_FREQ: Record<number, string> = { 1: "QUARTERLY", 2: "MONTHLY", 3: "BIWEEKLY", 4: "WEEKLY", 5: "WEEKLY" };

const recId = (res: unknown) => s((res as Row)?.id) || s(((res as Row)?.data as Row | undefined)?.id);

/**
 * Create a structured Care Plan for a resident at the given Level of Care, plus
 * the caregiver tasks derived from its interventions. Returns the new plan id and
 * task count. `communityId` is optional — the tenant-scoped write fills it when omitted.
 */
export async function generateCarePlanForResident(opts: {
  residentId: string;
  level: number;
  communityId?: string | null;
  createdByName?: string;
  /** Route generated tasks to the caregiver scheduled for this resident today. Default true. */
  assignToScheduledCaregivers?: boolean;
  /**
   * Hold for care-plan-review approval: create the plan as DRAFT and leave every
   * task UNASSIGNED, so nothing reaches caregivers until the review is submitted
   * and the plan is released (see {@link releaseCarePlan}).
   */
  hold?: boolean;
  /**
   * Nurse-individualized plan (from the Care Plan sheet ICP editor). When present
   * it REPLACES the baseline template — the nurse has already curated which
   * interventions apply, their frequency and resident-specific notes — so we use
   * it verbatim (no package filter) for a richer, personalized plan + tasks.
   */
  plan?: { title?: string; goals: string[]; interventions: PlanIntervention[] };
}): Promise<{ planId: string; taskCount: number; interventionCount: number; assignedTo?: string }> {
  const level = Math.min(5, Math.max(1, Math.round(opts.level) || 2));
  const base = levelPlan(level);
  const tpl: LevelPlanTemplate = opts.plan
    ? { title: opts.plan.title || base.title, goals: opts.plan.goals, interventions: opts.plan.interventions }
    : base;
  const now = new Date().toISOString();
  const community = opts.communityId || undefined;

  // For a nurse-individualized plan, use the curated interventions as-is. Otherwise
  // package-filter the baseline — only keep interventions whose domain is INCLUDED
  // in this resident's Level-of-Care package (out-of-package care is a DT-014
  // service, not a routine task). Unmappable interventions are kept.
  const interventions = opts.plan
    ? tpl.interventions
    : tpl.interventions.filter((iv) => {
        const code = domainCodeFromLabel(iv.title);
        return !code || domainInPackage(level, code);
      });

  // Route to the caregiver covering this resident today (so the task lands on
  // their Task Assignment dashboard). Held plans stay UNASSIGNED until released.
  const assignee = (opts.hold || opts.assignToScheduledCaregivers === false)
    ? null
    : assigneeForResidentToday(await fetchSchedules(), opts.residentId);

  const planRes = await createRecord("care-plans", {
    residentId: opts.residentId,
    communityId: community,
    title: tpl.title,
    status: opts.hold ? "DRAFT" : "ACTIVE",
    startDate: now,
    reviewFrequency: REVIEW_FREQ[level] || "MONTHLY",
    careGoals: tpl.goals.join("\n"),
    interventions: interventions.map((i) => `${i.title} (${i.freq})`).join("\n"),
    notes: opts.hold
      ? `Level ${level} care plan — HELD pending care-plan-review approval. Tasks are not dispatched until released.`
      : `Auto-generated from approved Level of Care ${level} (v3.9 baseline package). Review & personalize.`,
    createdByName: opts.createdByName || "System",
  });
  const planId = recId(planRes);
  if (!planId) throw new Error("Could not create the care plan.");

  // Goals + interventions as CarePlanItem rows (category drives task generation).
  let order = 0;
  for (const g of tpl.goals) {
    await createRecord("care-plan-items", { carePlanId: planId, communityId: community, category: "GOAL", title: g, status: "ACTIVE", sortOrder: order++ }).catch(() => null);
  }
  for (const iv of interventions) {
    await createRecord("care-plan-items", { carePlanId: planId, communityId: community, category: "INTERVENTION", title: iv.title, description: [`Frequency: ${iv.freq}`, iv.note?.trim() ? `Individualized: ${iv.note.trim()}` : ""].filter(Boolean).join(" · "), status: "ACTIVE", sortOrder: order++ }).catch(() => null);
  }

  // Held plans are TEMPLATES only — no tasks are created here. The daily
  // materializer (/api/cron/care-plan-tasks) spins the interventions into that
  // day's caregiver tasks once the plan is released (ACTIVE) and a caregiver is
  // scheduled. Non-held plans keep the legacy immediate one-shot generation.
  let taskCount = 0;
  if (!opts.hold) {
    const due = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    for (const iv of interventions) {
      try {
        await createRecord("tasks", {
          residentId: opts.residentId, communityId: community,
          title: iv.title, description: [`From care plan · ${iv.freq}`, iv.note?.trim() || ""].filter(Boolean).join(" · "),
          category: (iv.domain || iv.title.split(":")[0]).trim() || "Personal Care",
          status: "PENDING", priority: "MEDIUM",
          dueDate: due, generatedFrom: planId,
          assignedToId: assignee?.caregiverStaffId || undefined,
        });
        taskCount++;
      } catch { /* best-effort per task */ }
    }
  }
  return { planId, taskCount, interventionCount: interventions.length, assignedTo: assignee?.caregiverName };
}

/**
 * Release a HELD (DRAFT) care plan after a care-plan review is approved: flip the
 * plan to ACTIVE. This is the gate — an ACTIVE plan is what the daily materializer
 * turns into caregiver tasks; a DRAFT plan never dispatches. Call {@link
 * materializeTodayTasks} after releasing to spin up today's tasks immediately.
 */
export async function releaseCarePlan(planId: string): Promise<void> {
  await updateRecord("care-plans", planId, { status: "ACTIVE" }).catch(() => null);
}

/**
 * Trigger the materializer for the current user's community so today's tasks
 * appear immediately (rather than waiting for the hourly cron). Idempotent —
 * safe to call after releasing plans. Returns how many tasks were created.
 */
export async function materializeTodayTasks(): Promise<number> {
  try {
    const r = await fetch("/api/cron/care-plan-tasks", { method: "POST", credentials: "same-origin", cache: "no-store" });
    const j = await r.json();
    return Number(j?.created) || 0;
  } catch { return 0; }
}
