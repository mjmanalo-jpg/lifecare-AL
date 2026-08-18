// Phase 2 — Care Plan Generator.
// Nurse picks Care Task IDs for the active Layer-2 needs. The approved Need /
// Goal / Intervention are auto-pulled from the Care Task Master and LOCKED (the
// generator never reinvents library text — CL-07 / plan step 7). The nurse then
// individualises (assistance, frequency, timing, role, precautions, resident
// goal) and approves; only an APPROVED plan activates routines (governance B5).
//
// Verified against the workbook's R05-105 sample plan (11 active lines) by
// tests/lifecare-careplan.test.ts.

import { CARE_TASK_MASTER, taskById } from "./dataset.ts";
import { traceStamp } from "./governance.ts";
import type { CareLevel, DomainCode, DomainScores } from "./types.ts";
import type { ApprovalStatus } from "./governance.ts";

/** Standard exception/escalation rule applied to every generated line. */
export const STANDARD_EXCEPTION_RULE =
  "Refused / Unable / Unsafe / Increased assistance / Frequency variance / Clinical change → nursing review per threshold.";

/** Nurse-supplied selection + individualisation for one care-plan line. */
export interface CarePlanLineInput {
  taskId: string;
  active?: boolean; // default true
  assistanceLevel?: string;
  frequency?: string;
  timingTrigger?: string;
  responsibleRole?: string;
  precautions?: string;
  residentGoal?: string;
  nurseInstruction?: string;
  sourceModifierMlr?: string;
  dt013Link?: string;
  dt014Link?: string;
  reviewStopDate?: string;
}

/** A generated care-plan line: LOCKED library text + nurse individualisation. */
export interface CarePlanLine {
  line: number;
  taskId: string;
  domain: string;
  careNeedCategory: string;
  approvedNeed: string;         // LOCKED (from Care Task Master)
  approvedGoal: string;         // LOCKED
  approvedIntervention: string; // LOCKED
  assistanceLevel: string;
  frequency: string;
  timingTrigger: string;
  responsibleRole: string;
  precautions: string;
  residentGoal: string;
  nurseInstruction: string;
  expectedCareEvent: string;    // default expected event id(s) from master
  exceptionRule: string;
  sourceModifierMlr: string;
  dt013Link: string;
  dt014Link: string;
  reviewStopDate: string;
}

export interface DraftCarePlan {
  status: ApprovalStatus;       // starts DRAFT
  finalLevel: CareLevel | null;
  assessmentId?: string;
  residentId?: string;
  planVersion: string;
  modelVersion: string;
  stampedAt: string;
  createdBy?: string;
  lines: CarePlanLine[];
}

export interface GeneratePlanOptions {
  finalLevel: CareLevel | null;
  lines: CarePlanLineInput[];
  assessmentId?: string;
  residentId?: string;
  planVersion?: string;
  createdBy?: string;
  nowISO?: string;
}

/**
 * Build a DRAFT care plan. Only ACTIVE lines with a resolvable Task ID are
 * included; the approved Need/Goal/Intervention are pulled locked from the
 * master. Unknown Task IDs throw (a plan must never invent a task).
 */
export function generateDraftPlan(opts: GeneratePlanOptions): DraftCarePlan {
  const active = opts.lines.filter((l) => l.active !== false && l.taskId);
  const lines: CarePlanLine[] = active.map((input, i) => {
    const t = taskById(input.taskId);
    if (!t) throw new Error(`Care Plan Generator: unknown Task ID "${input.taskId}" — not in Care Task Master.`);
    return {
      line: i + 1,
      taskId: t.id,
      domain: t.domain,
      careNeedCategory: t.careNeedCategory,
      approvedNeed: t.approvedNeed,
      approvedGoal: t.approvedGoal,
      approvedIntervention: t.approvedIntervention,
      assistanceLevel: input.assistanceLevel ?? "",
      frequency: input.frequency ?? "",
      timingTrigger: input.timingTrigger ?? "",
      responsibleRole: input.responsibleRole ?? t.responsibleRole,
      precautions: input.precautions ?? "",
      residentGoal: input.residentGoal ?? "",
      nurseInstruction: input.nurseInstruction ?? "",
      expectedCareEvent: t.defaultExpectedEvent,
      exceptionRule: STANDARD_EXCEPTION_RULE,
      sourceModifierMlr: input.sourceModifierMlr ?? "",
      dt013Link: input.dt013Link ?? "",
      dt014Link: input.dt014Link ?? "",
      reviewStopDate: input.reviewStopDate ?? "",
    };
  });
  return {
    status: "DRAFT",
    finalLevel: opts.finalLevel,
    assessmentId: opts.assessmentId,
    residentId: opts.residentId,
    planVersion: opts.planVersion ?? "v1",
    ...traceStamp(opts.nowISO),
    createdBy: opts.createdBy,
    lines,
  };
}

/**
 * CL-07 task suggestion: map active assessment domains (score >= 1) + flagged
 * modifiers to candidate domain-coded Task IDs (TASK-<DOM>-01/02). Advisory —
 * the nurse confirms the final selection. Returns unique task IDs that exist
 * in the master.
 */
const DOMAIN_TO_TASK_PREFIX: Partial<Record<DomainCode, string>> = {
  "AS-01": "TASK-ADL", "AS-02": "TASK-MOB", "AS-03": "TASK-FALL", "AS-04": "TASK-COG",
  "AS-05": "TASK-COG", "AS-06": "TASK-CLN", "AS-07": "TASK-MED", "AS-08": "TASK-NUT",
  "AS-10": "TASK-SKN", "AS-11": "TASK-SKN", "AS-13": "TASK-FALL",
};

export function suggestTaskIds(scores: DomainScores): string[] {
  const ids = new Set<string>();
  for (const [code, prefix] of Object.entries(DOMAIN_TO_TASK_PREFIX)) {
    const v = scores[code as DomainCode];
    if (typeof v === "number" && v >= 1) {
      for (const suffix of ["01", "02"]) {
        const id = `${prefix}-${suffix}`;
        if (taskById(id)) ids.add(id);
      }
    }
  }
  return Array.from(ids);
}

/** Care tasks grouped by domain — used to build the nurse's picker UI. */
export function tasksByDomain(): Record<string, typeof CARE_TASK_MASTER> {
  const out: Record<string, typeof CARE_TASK_MASTER> = {};
  for (const t of CARE_TASK_MASTER) (out[t.domain] ??= []).push(t);
  return out;
}
