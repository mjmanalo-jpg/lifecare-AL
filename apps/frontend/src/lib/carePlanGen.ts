import { createRecord } from "@/lib/api";
import careLevelModel from "@/lib/lifecare/data/care_level_model.json";
import { domainInPackage, domainCodeFromLabel } from "@/lib/lifecare/carePackage";
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

/** Build the per-level plan template (title, goals, interventions) from rule-data. */
export function levelPlan(level: number): { title: string; goals: string[]; interventions: { title: string; freq: string }[] } {
  const n = Math.min(5, Math.max(1, level));
  const lm = MODEL.levels.find((l) => l.level === `L${n}`) ?? MODEL.levels[1];
  const domains = LEVEL_DOMAINS[n] ?? LEVEL_DOMAINS[2];
  const goals = [
    lm.typicalNeedPattern,
    "Maintain the highest practicable independence, dignity, comfort and safety.",
    "Recognise, document and escalate any significant change in condition.",
  ].filter(Boolean);
  const interventions = domains
    .map((d) => MODEL.baselineByDomain.find((b) => b.domain === d))
    .filter((b): b is BaselineRow => !!b)
    .map((b) => ({
      title: `${b.domain}: ${n >= 5 ? "comfort-focused support" : levelCol(b, n)}`,
      freq: "Per care plan — individualise",
    }));
  return {
    title: `${lm.conceptualProfile} (Level ${n}) — Care Plan`,
    goals,
    interventions,
  };
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
}): Promise<{ planId: string; taskCount: number; assignedTo?: string }> {
  const level = Math.min(5, Math.max(1, Math.round(opts.level) || 2));
  const tpl = levelPlan(level);
  const now = new Date().toISOString();
  const community = opts.communityId || undefined;

  // Package filter — only keep interventions whose domain is INCLUDED in this
  // resident's Level-of-Care package (out-of-package care is a DT-014 service, not
  // a routine task). Unmappable interventions are kept.
  const interventions = tpl.interventions.filter((iv) => {
    const code = domainCodeFromLabel(iv.title);
    return !code || domainInPackage(level, code);
  });

  // Route to the caregiver covering this resident today (so the task lands on
  // their Task Assignment dashboard). Null → leave unassigned.
  const assignee = opts.assignToScheduledCaregivers === false
    ? null
    : assigneeForResidentToday(await fetchSchedules(), opts.residentId);

  const planRes = await createRecord("care-plans", {
    residentId: opts.residentId,
    communityId: community,
    title: tpl.title,
    status: "ACTIVE",
    startDate: now,
    reviewFrequency: REVIEW_FREQ[level] || "MONTHLY",
    careGoals: tpl.goals.join("\n"),
    interventions: interventions.map((i) => `${i.title} (${i.freq})`).join("\n"),
    notes: `Auto-generated from approved Level of Care ${level} (v3.9 baseline package). Review & personalize.`,
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
    await createRecord("care-plan-items", { carePlanId: planId, communityId: community, category: "INTERVENTION", title: iv.title, description: `Frequency: ${iv.freq}`, status: "ACTIVE", sortOrder: order++ }).catch(() => null);
  }

  // Interventions → caregiver tasks (due within a day), tagged back to the plan
  // and assigned to today's scheduled caregiver so they appear on that dashboard.
  const due = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  let taskCount = 0;
  for (const iv of interventions) {
    try {
      await createRecord("tasks", {
        residentId: opts.residentId, communityId: community,
        title: iv.title, description: `From care plan · ${iv.freq}`,
        category: iv.title.split(":")[0].trim() || "Personal Care",
        status: "PENDING", priority: "MEDIUM",
        dueDate: due, generatedFrom: planId,
        assignedToId: assignee?.caregiverStaffId || undefined,
      });
      taskCount++;
    } catch { /* best-effort per task */ }
  }
  return { planId, taskCount, assignedTo: assignee?.caregiverName };
}
