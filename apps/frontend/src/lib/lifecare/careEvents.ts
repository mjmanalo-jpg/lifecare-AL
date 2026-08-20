// Phase 4 — Care Events + variance loop (engine logic).
// The Today's Care shift engine charts exception-first: a 1-tap Complete for the
// expected event, or a structured exception/change event. This module classifies
// an outcome, decides the escalation action, and runs the variance counter.
//
// INVARIANT: no event auto-changes level or fee. Material/repeated variance only
// increments a counter and raises a REVIEW ALERT; a human authorises any change
// (governance feeOrLevelChangeAllowed). Persistence uses the CareEvent table via
// the generic /api/db/care-events route.

import { taskById } from "./dataset.ts";

/** Outcomes a care event can carry (universal payload). */
export const OUTCOMES = [
  "Completed", "Not Required", "Refused", "Unable", "Unsafe",
  "Increased Assist", "Frequency Variance", "Clinical Change",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

export type EscalationAction =
  | "none" | "notify_nurse" | "incident" | "plan_review" | "dt013_review" | "dt014_review";

export interface OutcomeClassification {
  outcome: Outcome;
  isExpected: boolean;
  isException: boolean;
  isVariance: boolean;
  immediateEscalation: boolean;
  /**
   * Acute/safety event that must reach the EMERGENCY pathway (DT-010): the nurse
   * is directed to initiate the emergency protocol / call emergency services.
   * Emergency is never delayed or gated by revenue/capability.
   */
  emergencyPathway: boolean;
  escalationAction: EscalationAction;
  /**
   * Care Event archetype (CE-01..CE-07) — set ONLY when the outcome maps to a
   * generic Care Event Master archetype. The generic archetypes are anchored to
   * events EV-002..EV-008: CE-01 Task refused, CE-02 Task unable, CE-03 Task
   * unsafe, CE-04 Abnormal observation, CE-05 Change from baseline, CE-06 Near
   * fall, CE-07 Fall. Pure assistance/frequency variances have no generic
   * archetype — they are traced by {@link engineRuleId} instead.
   */
  archetype?: string;
  /**
   * Care Event engine rule (CEG-01..CEG-07) from care_event_engine_rules.json —
   * the escalation-matrix trigger this outcome fires (the traceable key).
   */
  engineRuleId?: string;
  /** Which decision tree the exception routes to, if any. */
  linkedDecisionTree?: string;
  /** Emergency protocol reference for an acute event (DT-010). */
  emergencyProtocol?: string;
}

/**
 * Escalation matrix per outcome — traced to the Care Event Master generic
 * archetypes (EV-001..EV-008) and the engine rules (CEG-01..CEG-07). Verified
 * against those datasets by tests/lifecare-careevents.test.ts (code↔data).
 */
export function classifyOutcome(outcome: Outcome): OutcomeClassification {
  const base = { outcome, emergencyPathway: false };
  switch (outcome) {
    case "Completed":
    case "Not Required":
      // EV-001 Task completed (Rule) · CEG-01 routine completion.
      return { ...base, isExpected: true, isException: false, isVariance: false, immediateEscalation: false, escalationAction: "none", engineRuleId: "CEG-01" };
    case "Refused":
      // EV-002 Task refused → CE-01 · care-task exception (DT-011).
      return { ...base, isExpected: false, isException: true, isVariance: false, immediateEscalation: false, escalationAction: "notify_nurse", archetype: "CE-01", linkedDecisionTree: "DT-011" };
    case "Unable":
      // EV-003 Task unable → CE-02 · change-in-condition review (DT-003).
      return { ...base, isExpected: false, isException: true, isVariance: false, immediateEscalation: false, escalationAction: "plan_review", archetype: "CE-02", linkedDecisionTree: "DT-003" };
    case "Unsafe":
      // EV-004 Task unsafe → CE-03 · safety/incident (CEG-05) → fall protocol
      // (DT-004) + emergency pathway (DT-010).
      return { ...base, isExpected: false, isException: true, isVariance: false, immediateEscalation: true, emergencyPathway: true, escalationAction: "incident", archetype: "CE-03", linkedDecisionTree: "DT-004", engineRuleId: "CEG-05", emergencyProtocol: "DT-010" };
    case "Increased Assist":
      // Assistance variance (CEG-02) → care-level-change review (DT-012). No
      // generic CE archetype — it is not an "abnormal observation" (CE-04).
      return { ...base, isExpected: false, isException: true, isVariance: true, immediateEscalation: false, escalationAction: "plan_review", linkedDecisionTree: "DT-012", engineRuleId: "CEG-02" };
    case "Frequency Variance":
      // Frequency variance (CEG-03) → care-level-change review (DT-012).
      return { ...base, isExpected: false, isException: true, isVariance: true, immediateEscalation: false, escalationAction: "plan_review", linkedDecisionTree: "DT-012", engineRuleId: "CEG-03" };
    case "Clinical Change":
      // EV-006 Change from baseline → CE-05 · acute deterioration is safety
      // (CEG-05) → change-in-condition (DT-003) + emergency pathway (DT-010).
      return { ...base, isExpected: false, isException: true, isVariance: false, immediateEscalation: true, emergencyPathway: true, escalationAction: "notify_nurse", archetype: "CE-05", linkedDecisionTree: "DT-003", engineRuleId: "CEG-05", emergencyProtocol: "DT-010" };
  }
}

/** 2+ material variances in the review window raises a review alert (CEG-06). */
export const VARIANCE_REVIEW_THRESHOLD = 2;

export interface VarianceReview {
  count: number;
  threshold: number;
  raiseReviewAlert: boolean;
  /** Explicitly false — a review alert NEVER auto-changes level or fee. */
  autoChangesLevelOrFee: false;
  message: string;
}

/**
 * Given the count of material variances for a resident/task within the review
 * window, decide whether to raise a review alert. Never auto-changes LOC/fee.
 */
export function evaluateVariance(count: number, threshold = VARIANCE_REVIEW_THRESHOLD): VarianceReview {
  const raise = count >= threshold;
  return {
    count,
    threshold,
    raiseReviewAlert: raise,
    autoChangesLevelOrFee: false,
    message: raise
      ? `${count} material variances in the review window — nursing reassessment alert raised (no automatic LOC/fee change).`
      : `${count} variance(s) — below the review threshold (${threshold}).`,
  };
}

/** The universal minimum payload for a care event (CL-09/CL-10). */
export interface CareEventInput {
  residentId: string;
  residentName?: string;
  taskId?: string;
  carePlanId?: string;
  routineId?: string;
  bundle?: string;
  domain?: string;
  eventId?: string;
  eventName?: string;
  planVersion?: string;
  outcome: Outcome;
  assistanceDelivered?: string;
  quantValue?: string;
  residentResponse?: string;
  observation?: string;
  exceptionDetail?: string;
  precautions?: string;
  shift?: string;
  actorId?: string;
  actorName?: string;
  reporterRole?: string;
  occurredAt?: string;
  communityId?: string | null;
  organizationId?: string | null;
  /** current variance count for this resident/task, if known (drives the alert) */
  priorVarianceCount?: number;
}

/** Build the CareEvent row payload for /api/db/care-events (classification applied). */
export function buildCareEventRecord(input: CareEventInput, modelVersion: string): Record<string, unknown> {
  const c = classifyOutcome(input.outcome);
  const varianceCount = (input.priorVarianceCount ?? 0) + (c.isVariance ? 1 : 0);
  const review = c.isVariance ? evaluateVariance(varianceCount) : null;
  return {
    residentId: input.residentId,
    residentName: input.residentName,
    communityId: input.communityId ?? undefined,
    organizationId: input.organizationId ?? undefined,
    eventId: input.eventId,
    eventName: input.eventName,
    domain: input.domain,
    eventType: c.isExpected ? "Expected" : "Exception",
    archetype: c.archetype,
    taskId: input.taskId,
    carePlanId: input.carePlanId,
    routineId: input.routineId,
    bundle: input.bundle,
    planVersion: input.planVersion,
    modelVersion,
    outcome: input.outcome,
    assistanceDelivered: input.assistanceDelivered,
    quantValue: input.quantValue,
    residentResponse: input.residentResponse,
    observation: input.observation,
    exceptionDetail: input.exceptionDetail,
    precautions: input.precautions,
    isException: c.isException,
    isVariance: c.isVariance,
    varianceType: c.isVariance ? input.outcome : undefined,
    immediateEscalation: c.immediateEscalation,
    emergencyPathway: c.emergencyPathway,
    emergencyProtocol: c.emergencyProtocol,
    engineRuleId: c.engineRuleId,
    linkedDecisionTree: c.linkedDecisionTree,
    escalationAction: c.escalationAction,
    reviewAlertRaised: !!review?.raiseReviewAlert,
    shift: input.shift,
    actorId: input.actorId,
    actorName: input.actorName,
    reporterRole: input.reporterRole,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  };
}

/**
 * Governed documentation prompt + reassessment note for a routine, from the Care
 * Task Master (TASK-*). Lets task completion surface the task's own care-event
 * documentation template and escalation/reassessment guidance.
 */
export function careTaskDoc(careTaskId?: string | null): { id: string; template: string; reassessment: string; domain: string } | null {
  if (!careTaskId) return null;
  const t = taskById(careTaskId);
  if (!t) return null;
  return { id: t.id, template: t.careEventDocTemplate || "", reassessment: t.escalationReassessment || "", domain: t.domain || "" };
}
