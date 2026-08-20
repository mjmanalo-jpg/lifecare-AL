import { createRecord } from "@/lib/api";
import { generateDraftPlan, suggestTaskIds, type CarePlanLineInput } from "@/lib/lifecare/carePlan";
import { domainScores, type AssessmentV42 } from "@/lib/lifecare/assessment";
import { levelRank } from "@/lib/lifecare/downstream";

/**
 * Assessment-driven Care Plan generator (Phase 2 in production form).
 *
 * Unlike the level-only baseline generator (carePlanGen.ts), this builds the
 * plan from the resident's assessment needs: it selects Care Task IDs from the
 * active Layer-2 domains and pulls the approved Need / Goal / Intervention
 * LOCKED from the Care Task Master, then persists a DRAFT CarePlan + goal /
 * intervention CarePlanItems.
 *
 * GOVERNANCE (B5): the plan is created as a DRAFT and NO caregiver tasks are
 * dispatched here — nothing reaches caregivers until the nurse individualises
 * and the plan is released to ACTIVE (releaseCarePlan → the daily materializer
 * spins the interventions into that day's tasks). Each INTERVENTION item carries
 * a [task:TASK-###] marker so the materializer can resolve the governed
 * care-event archetype for its task.
 */

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const recId = (res: unknown) => s((res as Row)?.id) || s(((res as Row)?.data as Row | undefined)?.id);

const REVIEW_FREQ: Record<number, string> = { 1: "QUARTERLY", 2: "MONTHLY", 3: "BIWEEKLY", 4: "WEEKLY", 5: "WEEKLY" };

export async function generateCarePlanFromV42(opts: {
  residentId: string;
  assessment: AssessmentV42;
  /** Optional explicit Task ID selection + individualisation; defaults to suggestTaskIds. */
  lines?: CarePlanLineInput[];
  communityId?: string | null;
  createdByName?: string;
}): Promise<{ planId: string; taskCount: number; lineCount: number }> {
  const { assessment } = opts;
  const finalLevel = assessment.layer3?.finalLevel ?? null;
  const levelNum = finalLevel ? levelRank(finalLevel) : 2;
  const community = opts.communityId || undefined;
  const now = new Date().toISOString();

  const inputLines: CarePlanLineInput[] =
    opts.lines && opts.lines.length
      ? opts.lines
      : suggestTaskIds(domainScores(assessment)).map((taskId) => ({ taskId }));

  const draft = generateDraftPlan({
    finalLevel,
    residentId: opts.residentId,
    assessmentId: assessment.id,
    createdBy: opts.createdByName,
    lines: inputLines,
  });

  const planRes = await createRecord("care-plans", {
    residentId: opts.residentId,
    communityId: community,
    title: `Resident Care Plan — Level ${finalLevel ?? "?"} (v4.2 assessment)`,
    // DRAFT until the nurse individualises + releases (B5). Tasks are NOT
    // dispatched from here — the materializer runs once the plan is ACTIVE.
    status: "DRAFT",
    startDate: now,
    reviewFrequency: REVIEW_FREQ[levelNum] || "MONTHLY",
    careGoals: draft.lines.map((l) => l.approvedGoal).filter((v, i, a) => a.indexOf(v) === i).join("\n"),
    interventions: draft.lines.map((l) => l.approvedIntervention).join("\n"),
    notes: `Auto-generated from v4.2 assessment ${assessment.id} (${draft.modelVersion}). DRAFT — nurse must individualise and release before routine activation; no tasks are dispatched until release.`,
    createdByName: opts.createdByName || "System",
  });
  const planId = recId(planRes);
  if (!planId) throw new Error("Could not create the care plan.");

  let order = 0;
  for (const line of draft.lines) {
    // Need/goal as GOAL items; the intervention as an INTERVENTION item. The
    // [task:TASK-###] marker links the item to its Care Task Master routine so
    // the materializer (on release) can resolve its governed care-event archetype.
    await createRecord("care-plan-items", {
      carePlanId: planId, communityId: community, category: "GOAL",
      title: line.approvedGoal, description: line.approvedNeed, status: "ACTIVE", sortOrder: order++,
    }).catch(() => null);
    await createRecord("care-plan-items", {
      carePlanId: planId, communityId: community, category: "INTERVENTION",
      title: line.approvedIntervention,
      description: `${[line.assistanceLevel, line.frequency, line.precautions].filter(Boolean).join(" · ") || `Task ${line.taskId}`}${line.taskId ? ` [task:${line.taskId}]` : ""}`,
      status: "ACTIVE", sortOrder: order++,
    }).catch(() => null);
  }

  // No inline task creation — held DRAFT plans dispatch nothing. Tasks are
  // materialised from the interventions once the plan is released (ACTIVE).
  return { planId, taskCount: 0, lineCount: draft.lines.length };
}
