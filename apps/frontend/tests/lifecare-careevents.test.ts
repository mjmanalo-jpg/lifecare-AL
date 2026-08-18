// Phase 4 verify — care-event classification + variance loop.
import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyOutcome, evaluateVariance, buildCareEventRecord, OUTCOMES,
} from "../src/lib/lifecare/careEvents.ts";

test("expected outcomes do not escalate", () => {
  for (const o of ["Completed", "Not Required"] as const) {
    const c = classifyOutcome(o);
    assert.equal(c.isExpected, true);
    assert.equal(c.isException, false);
    assert.equal(c.escalationAction, "none");
  }
});

test("escalation matrix routes each exception correctly", () => {
  assert.equal(classifyOutcome("Refused").escalationAction, "notify_nurse");
  assert.equal(classifyOutcome("Unable").escalationAction, "plan_review");
  const unsafe = classifyOutcome("Unsafe");
  assert.equal(unsafe.escalationAction, "incident");
  assert.equal(unsafe.immediateEscalation, true);
  assert.equal(unsafe.linkedDecisionTree, "DT-004");
  const clinical = classifyOutcome("Clinical Change");
  assert.equal(clinical.immediateEscalation, true);
  assert.equal(clinical.linkedDecisionTree, "DT-003");
});

test("assist/frequency variances are flagged as variance", () => {
  assert.equal(classifyOutcome("Increased Assist").isVariance, true);
  assert.equal(classifyOutcome("Frequency Variance").isVariance, true);
  assert.equal(classifyOutcome("Refused").isVariance, false);
});

test("variance counter raises a review alert at threshold — never auto-changes level/fee", () => {
  const below = evaluateVariance(1);
  assert.equal(below.raiseReviewAlert, false);
  const at = evaluateVariance(2);
  assert.equal(at.raiseReviewAlert, true);
  assert.equal(at.autoChangesLevelOrFee, false);
  assert.match(at.message, /no automatic LOC\/fee change/i);
});

test("care-event record carries the universal payload + classification", () => {
  const rec = buildCareEventRecord({
    residentId: "r1", taskId: "TASK-ADL-01", outcome: "Unsafe",
    observation: "near-fall during transfer", shift: "AM", actorName: "CG Dela Cruz",
  }, "v4.2/v3.9");
  assert.equal(rec.residentId, "r1");
  assert.equal(rec.outcome, "Unsafe");
  assert.equal(rec.isException, true);
  assert.equal(rec.immediateEscalation, true);
  assert.equal(rec.escalationAction, "incident");
  assert.equal(rec.modelVersion, "v4.2/v3.9");
  assert.ok(rec.occurredAt);
});

test("repeated variance in the window flags the record's review alert", () => {
  const first = buildCareEventRecord({ residentId: "r1", taskId: "t", outcome: "Increased Assist", priorVarianceCount: 0 }, "v");
  assert.equal(first.reviewAlertRaised, false); // count -> 1
  const second = buildCareEventRecord({ residentId: "r1", taskId: "t", outcome: "Increased Assist", priorVarianceCount: 1 }, "v");
  assert.equal(second.reviewAlertRaised, true); // count -> 2
});

test("all documented outcomes are classifiable", () => {
  for (const o of OUTCOMES) assert.ok(classifyOutcome(o));
});
