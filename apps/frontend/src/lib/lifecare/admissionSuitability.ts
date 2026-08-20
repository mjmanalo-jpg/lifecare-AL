// DT-001 — Admission suitability gate (executable).
//
// Turns the DT-001 protocol's atomic rules into a real decision the admissions
// flow can act on, rather than a reference protocol only:
//   BR-001.01 Capability check   — is the requested service within approved scope?
//   BR-001.02 Risk acceptability — are risks manageable with available controls?
//   BR-001.03 Conditional admission — can gaps be mitigated before/at admission?
//
// Outcome precedence (highest wins): DECLINE > ESCALATE > CONDITIONAL > ACCEPT.
// Emergency/safety is never traded for revenue — unmanaged high risk escalates.

import type { CareLevel } from "./types.ts";

export type AdmissionOutcome = "ACCEPT" | "CONDITIONAL" | "ESCALATE" | "DECLINE";

const RANK: Record<AdmissionOutcome, number> = { ACCEPT: 0, CONDITIONAL: 1, ESCALATE: 2, DECLINE: 3 };

export const ADMISSION_OUTCOME_LABEL: Record<AdmissionOutcome, string> = {
  ACCEPT: "Suitable for admission",
  CONDITIONAL: "Conditional admission",
  ESCALATE: "Escalate — senior review",
  DECLINE: "Not suitable — decline / refer",
};

export interface AdmissionSuitability {
  outcome: AdmissionOutcome;
  /** Human-readable reasons, in the order the rules fired. */
  reasons: string[];
  /** DT-001 atomic rule ids that fired. */
  appliedRules: string[];
  /** A Care Manager must sign off before admission proceeds. */
  requiresSeniorReview: boolean;
}

/**
 * Evaluate DT-001 admission suitability. Inputs are the clinical judgements the
 * assessor records; `capabilityGate` / `suggestedLevel` can be fed straight from
 * classify() so a high-acuity gate also forces a senior review.
 */
export function evaluateAdmissionSuitability(input: {
  /** BR-001.01 — requested care is within LifeCare's approved scope/capability. */
  withinCapability: boolean;
  /** BR-001.02 — identified risks are manageable with available controls. */
  risksManageable: boolean;
  /** BR-001.03 — identified gaps can be mitigated before/at admission. */
  gapsMitigable?: boolean;
  /** From classify(): a high-acuity capability gate forces Care-Manager sign-off. */
  capabilityGate?: boolean;
  suggestedLevel?: CareLevel;
}): AdmissionSuitability {
  const reasons: string[] = [];
  const appliedRules: string[] = [];
  let outcome: AdmissionOutcome = "ACCEPT";
  const bump = (o: AdmissionOutcome) => { if (RANK[o] > RANK[outcome]) outcome = o; };

  // BR-001.02 — risk acceptability (unmanaged high risk escalates).
  if (!input.risksManageable) {
    appliedRules.push("BR-001.02");
    reasons.push("Identified risks are not manageable with available controls — escalate for senior clinical review / alternate pathway (BR-001.02).");
    bump("ESCALATE");
  }

  // BR-001.01 / BR-001.03 — capability check + conditional admission.
  if (!input.withinCapability) {
    appliedRules.push("BR-001.01");
    if (input.gapsMitigable) {
      appliedRules.push("BR-001.03");
      reasons.push("Requested care is outside current scope, but identified gaps can be mitigated before/at admission — a conditional admission plan is required (BR-001.03).");
      bump("CONDITIONAL");
    } else {
      reasons.push("Requested care is outside LifeCare's approved scope and gaps cannot be mitigated — decline or refer to an alternate pathway (BR-001.01 / BR-001.03).");
      bump("DECLINE");
    }
  }

  // High-acuity capability gate from classification → at least conditional + senior review.
  if (input.capabilityGate) {
    reasons.push(`High-acuity capability gate${input.suggestedLevel ? ` (${input.suggestedLevel})` : ""} — a Care Manager must confirm LifeCare can safely deliver this level before admission.`);
    bump("CONDITIONAL");
  }

  if (outcome === "ACCEPT") {
    reasons.push("Within approved scope; risks manageable with available controls — suitable for admission (BR-001.01 / BR-001.02).");
    appliedRules.push("BR-001.01", "BR-001.02");
  }

  return {
    outcome,
    reasons,
    appliedRules: Array.from(new Set(appliedRules)),
    requiresSeniorReview: outcome !== "ACCEPT" || !!input.capabilityGate,
  };
}
