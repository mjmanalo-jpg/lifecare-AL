import test from "node:test";
import assert from "node:assert/strict";

import {
  duplicateReview,
  requiresSecondApproval,
  reviewOutcome,
  LOC_CHANGE_DECISIONS,
  type ReviewLike,
} from "../src/lib/lifecare/carePlanReviewGuards.ts";

const rev = (over: Partial<ReviewLike>): ReviewLike => ({
  residentId: "r1",
  reviewPeriod: "2026-Q3",
  decision: "Continue Current Plan",
  approvalStatus: "APPROVED",
  ...over,
});

test("requiresSecondApproval is true only for LOC-change decisions", () => {
  assert.equal(requiresSecondApproval("Escalate Level of Care"), true);
  assert.equal(requiresSecondApproval("De-escalate Level of Care"), true);
  assert.equal(requiresSecondApproval("Continue Current Plan"), false);
  assert.equal(requiresSecondApproval("Update Care Plan"), false);
  assert.equal(LOC_CHANGE_DECISIONS.size, 2);
});

test("duplicateReview blocks a same-resident same-period non-LOC resubmission", () => {
  const existing = [rev({})];
  const hit = duplicateReview(existing, "r1", "2026-Q3", "Update Care Plan");
  assert.ok(hit, "expected the existing same-period review to block");
});

test("duplicateReview allows a different resident or a different period", () => {
  const existing = [rev({})];
  assert.equal(duplicateReview(existing, "r2", "2026-Q3", "Update Care Plan"), null);
  assert.equal(duplicateReview(existing, "r1", "2026-Q4", "Update Care Plan"), null);
});

test("duplicateReview exempts LOC-change decisions (reassessment-driven)", () => {
  const existing = [rev({})];
  assert.equal(duplicateReview(existing, "r1", "2026-Q3", "Escalate Level of Care"), null);
});

test("duplicateReview ignores a previously rejected review", () => {
  const existing = [rev({ approvalStatus: "REJECTED" })];
  assert.equal(duplicateReview(existing, "r1", "2026-Q3", "Update Care Plan"), null);
});

test("duplicateReview blocks when an earlier submission is still pending", () => {
  const existing = [rev({ approvalStatus: "PENDING" })];
  assert.ok(duplicateReview(existing, "r1", "2026-Q3", "Update Care Plan"));
});

test("reviewOutcome produces durable, consistent status strings", () => {
  assert.equal(reviewOutcome({ decision: "Escalate Level of Care", approvalStatus: "PENDING" }), "Awaiting second approval");
  assert.equal(reviewOutcome({ decision: "Update Care Plan", approvalStatus: "PENDING" }), "Awaiting approval");
  assert.equal(reviewOutcome({ decision: "Update Care Plan", approvalStatus: "REJECTED" }), "Rejected");
  assert.equal(
    reviewOutcome({ decision: "Update Care Plan", approvalStatus: "APPROVED", released: true, approvedByName: "Grace" }),
    "Approved · Released · Grace",
  );
  assert.equal(reviewOutcome({ decision: "Refer to Physician", approvalStatus: "APPROVED", released: false }), "Submitted");
});
