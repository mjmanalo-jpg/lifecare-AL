// Phase 4 — Care Events + variance loop (engine logic).
// The Today's Care shift engine charts exception-first: a 1-tap Complete for the
// expected event, or a structured exception/change event. This module classifies
// an outcome, decides the escalation action, and runs the variance counter.
//
// INVARIANT: no event auto-changes level or fee. Material/repeated variance only
// increments a counter and raises a REVIEW ALERT; a human authorises any change
// (governance feeOrLevelChangeAllowed). Persistence uses the CareEvent table via
// the generic /api/db/care-events route.

import type { CareLevel } from "./types.ts";

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
  escalationAction: EscalationAction;
  /** Care Event archetype (CE-01..07) where applicable. */
  archetype?: string;
  /** Which decision tree the exception routes to, if any. */
  linkedDecisionTree?: string;
}

/**
 * Escalation matrix per exception (notify nurse? incident? plan review? DT?).
 * Derived from the Care Event Master + the R05 Today's Care escalation flags.
 */
export function classifyOutcome(outcome: Outcome): OutcomeClassification {
  switch (outcome) {
    case "Completed":
    case "Not Required":
      return { outcome, isExpected: true, isException: false, isVariance: false, immediateEscalation: false, escalationAction: "none" };
    case "Refused":
      return { outcome, isExpected: false, isException: true, isVariance: false, immediateEscalation: false, escalationAction: "notify_nurse", archetype: "CE-01", linkedDecisionTree: "DT-011" };
    case "Unable":
      return { outcome, isExpected: false, isException: true, isVariance: false, immediateEscalation: false, escalationAction: "plan_review", archetype: "CE-02", linkedDecisionTree: "DT-003" };
    case "Unsafe":
      return { outcome, isExpected: false, isException: true, isVariance: false, immediateEscalation: true, escalationAction: "incident", archetype: "CE-03", linkedDecisionTree: "DT-004" };
    case "Increased Assist":
      return { outcome, isExpected: false, isException: true, isVariance: true, immediateEscalation: false, escalationAction: "plan_review", archetype: "CE-04", linkedDecisionTree: "DT-012" };
    case "Frequency Variance":
      return { outcome, isExpected: false, isException: true, isVariance: true, immediateEscalation: false, escalationAction: "plan_review", archetype: "CE-05", linkedDecisionTree: "DT-012" };
    case "Clinical Change":
      return { outcome, isExpected: false, isException: true, isVariance: false, immediateEscalation: true, escalationAction: "notify_nurse", archetype: "CE-06", linkedDecisionTree: "DT-003" };
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
