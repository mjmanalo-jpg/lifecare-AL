// Pure, testable governance guards for Care Plan Reviews.
// Grounded in LifeCare Decision Rules v3.6 (Assessment → Care Plan, Steps 6–9):
//   • Step 9 "Nursing Approval" is a single nursing action that releases the plan.
//   • Step 6 "Final LOC" is owned by "Nurse + Administrator/Authorized Approver" —
//     so a LEVEL-OF-CARE change needs a second authorized sign-off before release.
// Kept free of React/Prisma imports so it unit-tests under `node --test`.

export type CarePlanReviewApprovalStatus = "APPROVED" | "PENDING" | "REJECTED";

export interface ReviewLike {
  residentId: string;
  reviewPeriod: string;
  decision: string;
  reviewDate?: string;
  createdAt?: string;
  approvalStatus?: CarePlanReviewApprovalStatus;
}

// LOC-change decisions are reassessment/event-driven and require a second authorized
// approver (Step 6). They are also exempt from the same-period duplicate block, since a
// genuine change of condition can legitimately trigger a re-review within a period.
export const LOC_CHANGE_DECISIONS = new Set(["Escalate Level of Care", "De-escalate Level of Care"]);

export function requiresSecondApproval(decision: string): boolean {
  return LOC_CHANGE_DECISIONS.has(decision);
}

/**
 * Idempotency guard. Returns the existing review that blocks a new submission — same
 * resident, same review period, not previously rejected — or `null` when the submission
 * is allowed. LOC-change decisions are exempt (see above). A rejected prior review never
 * blocks: the nurse fixed it and is resubmitting.
 */
export function duplicateReview<T extends ReviewLike>(
  reviews: readonly T[],
  residentId: string,
  reviewPeriod: string,
  decision: string,
): T | null {
  if (requiresSecondApproval(decision)) return null;
  return (
    reviews.find(
      (r) => r.residentId === residentId && r.reviewPeriod === reviewPeriod && r.approvalStatus !== "REJECTED",
    ) ?? null
  );
}

/**
 * Durable, human-readable status for History + the Pending queue, so an approved,
 * held, or awaiting-approval plan always reads consistently instead of vanishing behind
 * a transient toast.
 */
export function reviewOutcome(input: {
  decision: string;
  approvalStatus?: CarePlanReviewApprovalStatus;
  released?: boolean;
  approvedByName?: string;
}): string {
  if (input.approvalStatus === "PENDING") {
    return requiresSecondApproval(input.decision) ? "Awaiting second approval" : "Awaiting approval";
  }
  if (input.approvalStatus === "REJECTED") return "Rejected";
  if (input.released) return `Approved · Released${input.approvedByName ? ` · ${input.approvedByName}` : ""}`;
  return "Submitted";
}
