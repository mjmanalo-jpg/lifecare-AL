import { createRecord } from "@/lib/api";

/**
 * Shared care-plan + task generator — the Stage 6 → 8 → 9 bridge.
 *
 * Given an approved Level of Care, create a structured Care Plan (CarePlan +
 * CarePlanItem goals/interventions) and spin the interventions into caregiver
 * Tasks. Used by BOTH the Care Acuity board (auto, on approval) and the Care Plan
 * Reviews board (manual "Generate care plan & tasks" button), so the two surfaces
 * produce identical plans and there is a single source of truth for the template.
 */

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

// Per-level template: plan title, care goals, and interventions (title + frequency).
// Interventions become CarePlanItem(category=INTERVENTION) rows AND caregiver tasks.
// Mirrors the CareAcuityBoard level packages / care-activity catalogue.
export const LEVEL_PLAN: Record<number, { title: string; goals: string[]; interventions: { title: string; freq: string }[] }> = {
  1: {
    title: "Independent Living Plus — Care Plan",
    goals: ["Maintain independence and wellness", "Early detection of any change in condition"],
    interventions: [
      { title: "Weekly wellness check", freq: "Weekly" },
      { title: "Medication reminders", freq: "Daily" },
      { title: "Encourage community activities", freq: "Daily" },
    ],
  },
  2: {
    title: "Assisted Living — Care Plan",
    goals: ["Maintain dignity with daily assistance", "Ensure medication adherence", "Sustain nutrition & hydration"],
    interventions: [
      { title: "Assist with ADLs (bathing, dressing, grooming)", freq: "Daily" },
      { title: "Nurse-administered medications", freq: "Per schedule" },
      { title: "Escort to meals & activities", freq: "Each meal" },
      { title: "Scheduled vital signs", freq: "Daily" },
    ],
  },
  3: {
    title: "Enhanced Assisted Care — Care Plan",
    goals: ["Prevent falls and functional decline", "Maintain continence and skin integrity", "Provide extensive ADL support"],
    interventions: [
      { title: "Extensive ADL assistance", freq: "Every shift" },
      { title: "Fall-prevention safety rounding", freq: "Hourly" },
      { title: "Scheduled toileting / continence care", freq: "Every 2–3 hrs" },
      { title: "Nurse-administered medications", freq: "Per schedule" },
      { title: "Frequent nursing review", freq: "Daily" },
    ],
  },
  4: {
    title: "Memory / Comprehensive Care — Care Plan",
    goals: ["Ensure safety and memory support", "Manage behaviors per care plan", "Maintain mobility & skin integrity"],
    interventions: [
      { title: "Secured memory-support supervision", freq: "Continuous" },
      { title: "Behavioral care-plan check-in", freq: "Every shift" },
      { title: "Two-person transfers & repositioning", freq: "Every 2 hrs" },
      { title: "Assist with all ADLs", freq: "Every shift" },
      { title: "Complex medication management", freq: "Per schedule" },
    ],
  },
  5: {
    title: "Skilled / Complex Care — Care Plan",
    goals: ["Stabilize complex medical needs", "Deliver skilled nursing interventions", "Prevent complications"],
    interventions: [
      { title: "Skilled nursing interventions", freq: "Per order" },
      { title: "Wound care", freq: "Daily" },
      { title: "IV / injectable therapy", freq: "Per order" },
      { title: "Complex medication management", freq: "Per schedule" },
      { title: "Continuous supervision", freq: "Continuous" },
      { title: "Feeding assistance", freq: "Each meal" },
    ],
  },
};
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
}): Promise<{ planId: string; taskCount: number }> {
  const level = Math.min(5, Math.max(1, Math.round(opts.level) || 2));
  const tpl = LEVEL_PLAN[level];
  const now = new Date().toISOString();
  const community = opts.communityId || undefined;

  const planRes = await createRecord("care-plans", {
    residentId: opts.residentId,
    communityId: community,
    title: tpl.title,
    status: "ACTIVE",
    startDate: now,
    reviewFrequency: REVIEW_FREQ[level] || "MONTHLY",
    careGoals: tpl.goals.join("\n"),
    interventions: tpl.interventions.map((i) => `${i.title} (${i.freq})`).join("\n"),
    notes: `Auto-generated from approved Care Acuity Level ${level}. Review & personalize.`,
    createdByName: opts.createdByName || "System",
  });
  const planId = recId(planRes);
  if (!planId) throw new Error("Could not create the care plan.");

  // Goals + interventions as CarePlanItem rows (category drives task generation).
  let order = 0;
  for (const g of tpl.goals) {
    await createRecord("care-plan-items", { carePlanId: planId, communityId: community, category: "GOAL", title: g, status: "ACTIVE", sortOrder: order++ }).catch(() => null);
  }
  for (const iv of tpl.interventions) {
    await createRecord("care-plan-items", { carePlanId: planId, communityId: community, category: "INTERVENTION", title: iv.title, description: `Frequency: ${iv.freq}`, status: "ACTIVE", sortOrder: order++ }).catch(() => null);
  }

  // Interventions → caregiver tasks (due within a day), tagged back to the plan.
  const due = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  let taskCount = 0;
  for (const iv of tpl.interventions) {
    try {
      await createRecord("tasks", {
        residentId: opts.residentId, communityId: community,
        title: iv.title, description: `From care plan · ${iv.freq}`,
        category: "Personal Care", status: "PENDING", priority: "MEDIUM",
        dueDate: due, generatedFrom: planId,
      });
      taskCount++;
    } catch { /* best-effort per task */ }
  }
  return { planId, taskCount };
}
