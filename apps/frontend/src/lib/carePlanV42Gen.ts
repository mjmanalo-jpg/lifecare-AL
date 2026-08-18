import { createRecord } from "@/lib/api";
import { generateDraftPlan, suggestTaskIds, type CarePlanLineInput } from "@/lib/lifecare/carePlan";
import { domainScores, type AssessmentV42 } from "@/lib/lifecare/assessment";
import { levelRank } from "@/lib/lifecare/downstream";
import { parseSchedules, assigneeForResidentToday } from "@/lib/caregiverSchedule";

async function fetchSchedules() {
  try {
    const r = await fetch("/api/db/app-settings?f_key=caregiver_schedules&take=1", { credentials: "same-origin", cache: "no-store" });
    const j = await r.json();
    return parseSchedules((j?.data as Array<{ value?: string }> | undefined)?.[0]?.value);
  } catch { return []; }
}

/**
 * Assessment-driven Care Plan generator (Phase 2 in production form).
 *
 * Unlike the level-only baseline generator (carePlanGen.ts), this builds the
 * plan from the resident's ACTIVE assessment needs: it selects Care Task IDs
 * from the active Layer-2 domains and pulls the approved Need / Goal /
 * Intervention LOCKED from the Care Task Master, then persists a DRAFT-style
 * CarePlan + CarePlanItem + Task set. The nurse individualises before use.
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
    status: "ACTIVE",
    startDate: now,
    reviewFrequency: REVIEW_FREQ[levelNum] || "MONTHLY",
    careGoals: draft.lines.map((l) => l.approvedGoal).filter((v, i, a) => a.indexOf(v) === i).join("\n"),
    interventions: draft.lines.map((l) => l.approvedIntervention).join("\n"),
    notes: `Auto-generated from v4.2 assessment ${assessment.id} (${draft.modelVersion}). DRAFT — nurse must individualise and approve before routine activation.`,
    createdByName: opts.createdByName || "System",
  });
  const planId = recId(planRes);
  if (!planId) throw new Error("Could not create the care plan.");

  let order = 0;
  for (const line of draft.lines) {
    // Need/goal as GOAL items; the intervention as an INTERVENTION item + task.
    await createRecord("care-plan-items", {
      carePlanId: planId, communityId: community, category: "GOAL",
      title: line.approvedGoal, description: line.approvedNeed, status: "ACTIVE", sortOrder: order++,
    }).catch(() => null);
    await createRecord("care-plan-items", {
      carePlanId: planId, communityId: community, category: "INTERVENTION",
      title: line.approvedIntervention,
      description: [line.assistanceLevel, line.frequency, line.precautions].filter(Boolean).join(" · ") || `Task ${line.taskId}`,
      status: "ACTIVE", sortOrder: order++,
    }).catch(() => null);
  }

  const due = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const assignee = assigneeForResidentToday(await fetchSchedules(), opts.residentId);
  let taskCount = 0;
  for (const line of draft.lines) {
    try {
      await createRecord("tasks", {
        residentId: opts.residentId, communityId: community,
        title: line.approvedIntervention,
        description: `From v4.2 care plan · ${line.taskId}${line.frequency ? ` · ${line.frequency}` : ""}`,
        category: line.domain, status: "PENDING", priority: "MEDIUM",
        dueDate: due, generatedFrom: planId,
        assignedToId: assignee?.caregiverStaffId || undefined,
      });
      taskCount++;
    } catch { /* best-effort per task */ }
  }

  return { planId, taskCount, lineCount: draft.lines.length };
}
