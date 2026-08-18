// B5 — Governance guards (shared util) reused by every engine.
// Encodes the plan's invariants as small, testable helpers:
//   * Generated care plans stay DRAFT until a nurse individualises and approves.
//   * No event auto-changes fee or level — observed variance raises a review
//     alert only; a human authorises any change.
//   * Capability gate + emergency-never-delayed: needs beyond capability
//     escalate/transfer; revenue never overrides safety.
// B2 — versioning & traceability spine lives here too (traceStamp / traceChain).

import { MODEL_VERSION } from "./dataset.ts";
import type { CareLevel } from "./types.ts";

export type ApprovalStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "SUPERSEDED";

/** A care plan / routine may only activate once a nurse has approved the DRAFT. */
export function canActivate(status: ApprovalStatus): boolean {
  return status === "APPROVED";
}

/** Guard: throw if something tries to activate a routine from an unapproved draft. */
export function assertActivatable(status: ApprovalStatus, what = "routine"): void {
  if (!canActivate(status)) {
    throw new Error(`Governance: cannot activate ${what} — care plan is ${status}, not APPROVED (CL-13 / plan step 9).`);
  }
}

export interface FeeChangeRequest {
  reason: "MANUAL_AUTHORISED" | "CARE_EVENT" | "VARIANCE_COUNTER" | "ASSESSMENT" | "MODIFIER";
  authorisedBy?: string;
}

/**
 * No event/variance/score/modifier auto-changes a fee or level. Only an
 * explicitly human-authorised change is permitted. Returns whether the change
 * may proceed; callers should raise a review alert for the disallowed reasons.
 */
export function feeOrLevelChangeAllowed(req: FeeChangeRequest): boolean {
  return req.reason === "MANUAL_AUTHORISED" && !!req.authorisedBy;
}

export interface CapabilityDecision {
  gateRequired: boolean;
  /** Whether LifeCare's approved scope/staffing can safely deliver the plan. */
  withinCapability: boolean;
  emergency?: boolean;
}

export type CapabilityOutcome = "PROCEED" | "CONDITIONAL" | "ESCALATE_TRANSFER" | "EMERGENCY_PATHWAY";

/**
 * Capability gate (CL-06 / CL-23). Emergency is never delayed by revenue: an
 * emergency always routes to the emergency pathway regardless of capability
 * gate. Otherwise, needs beyond capability escalate/transfer.
 */
export function capabilityOutcome(d: CapabilityDecision): CapabilityOutcome {
  if (d.emergency) return "EMERGENCY_PATHWAY";
  if (!d.gateRequired) return "PROCEED";
  return d.withinCapability ? "CONDITIONAL" : "ESCALATE_TRANSFER";
}

/** B2 — stamp every assessment/decision with the model version + timestamp. */
export function traceStamp(nowISO?: string): { modelVersion: string; stampedAt: string } {
  return {
    modelVersion: `${MODEL_VERSION.assessmentVersion}/${MODEL_VERSION.careModelVersion}`,
    stampedAt: nowISO ?? new Date().toISOString(),
  };
}

export interface TraceLink {
  from: string;
  to: string;
  ruleId?: string;
  note?: string;
}

/**
 * B2 — build a trace chain linking assessment → level → modifier → task →
 * event → escalation → plan change (SYS-SLMS-LOP-011/012). Callers append
 * links as decisions are made; the chain is stored with the record for audit.
 */
export function traceChain(links: TraceLink[]): string {
  return links
    .map((l) => `${l.from} → ${l.to}${l.ruleId ? ` [${l.ruleId}]` : ""}${l.note ? `: ${l.note}` : ""}`)
    .join("\n");
}

/** A downgrade in level always requires a fresh, authorised reassessment (CL-21). */
export function canLowerLevel(from: CareLevel, to: CareLevel, opts: { reassessed: boolean; approvedBy?: string }): boolean {
  const rank: Record<CareLevel, number> = { L1: 1, L2: 2, L3: 3, L4: 4, L5: 5 };
  if (rank[to] >= rank[from]) return true; // not a downgrade
  return opts.reassessed && !!opts.approvedBy;
}
