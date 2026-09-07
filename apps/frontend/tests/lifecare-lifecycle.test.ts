// SLMS v4.2 occurrence lifecycle (#5) — pure governance self-checks.
// Acceptance mapped to Controlled Vocabulary + Dashboard Workflow Rules + Rules 12/13/17/18/21.
import test from "node:test";
import assert from "node:assert/strict";

import {
  applyOccurrenceState, escalationStateFromStatus, escalationTargetStatus, canCloseEscalation,
  isEditableOccurrence, appendCorrection, canCloseShift, matchOccurrenceForQuickChart,
  validateRoutineRelease, type OccurrenceState,
} from "../src/lib/lifecare/occurrenceLifecycle.ts";
import { countsAsCompleted, EXCEPTION_REASON } from "../src/lib/lifecare/vocab.ts";

const openState: OccurrenceState = { workflowState: "Due", escalationState: "Not required" };

// Rule 12 / Controlled Vocabulary — the five fields are separate
test("applyOccurrenceState: a clinical finding can never be an outcome or exception", () => {
  assert.throws(() => applyOccurrenceState(openState, { careDeliveryOutcome: "Change from baseline" as never }), /invalid careDeliveryOutcome/);
  assert.throws(() => applyOccurrenceState(openState, { exceptionReason: "Poor intake" as never }), /invalid exceptionReason/);
});

test("applyOccurrenceState: cross-field rules (exception ≠ completion)", () => {
  // Not completed requires an exception
  assert.throws(() => applyOccurrenceState(openState, { workflowState: "Closed", careDeliveryOutcome: "Not completed" }), /requires an exceptionReason/);
  // exception cannot accompany a completed outcome
  assert.throws(() => applyOccurrenceState(openState, { careDeliveryOutcome: "Completed as planned", exceptionReason: "Resident declined" }), /cannot accompany a completed outcome/);
  // valid: closed as planned
  const ok = applyOccurrenceState(openState, { workflowState: "Closed", careDeliveryOutcome: "Completed as planned" });
  assert.equal(ok.state.workflowState, "Closed");
  assert.ok(ok.changes.some((c) => c.field === "workflowState"));
  // valid: not completed WITH exception
  const decl = applyOccurrenceState(openState, { workflowState: "Closed", careDeliveryOutcome: "Not completed", exceptionReason: "Resident declined" });
  assert.equal(countsAsCompleted(decl.state.careDeliveryOutcome!), false);
});

test("applyOccurrenceState: workflow transitions (terminal is frozen; Closed needs an outcome)", () => {
  assert.throws(() => applyOccurrenceState({ workflowState: "Closed", careDeliveryOutcome: "Completed as planned", escalationState: "Not required" }, { workflowState: "Due" }), /terminal/);
  assert.throws(() => applyOccurrenceState(openState, { workflowState: "Closed" }), /Closed requires a careDeliveryOutcome/);
  const cancelled = applyOccurrenceState(openState, { workflowState: "Cancelled", careDeliveryOutcome: "Not completed", exceptionReason: "Authorized cancellation" });
  assert.equal(cancelled.state.workflowState, "Cancelled");
});

test("Rule 13: escalation state is orthogonal to the outcome", () => {
  const done = applyOccurrenceState(openState, { workflowState: "Closed", careDeliveryOutcome: "Completed with variance" }).state;
  const escalated = applyOccurrenceState(done, { escalationState: "Pending acknowledgement" });
  assert.equal(escalated.state.careDeliveryOutcome, "Completed with variance", "escalation never rewrites the outcome");
  assert.equal(escalated.state.escalationState, "Pending acknowledgement");
});

test("escalation status mapping + P1 cannot passively close", () => {
  assert.equal(escalationStateFromStatus("OPEN"), "Pending acknowledgement");
  assert.equal(escalationStateFromStatus("RESOLVED"), "Resolved");
  assert.equal(escalationTargetStatus("Acknowledged"), "ACK");
  assert.equal(canCloseEscalation("P1", false), false);
  assert.equal(canCloseEscalation("P1", true), true);
  assert.equal(canCloseEscalation("P3", false), true);
});

test("Rule 18: a Closed occurrence is frozen (only corrections append)", () => {
  assert.equal(isEditableOccurrence({ workflowState: "Closed" }), false);
  assert.equal(isEditableOccurrence({ workflowState: "Cancelled" }), false);
  assert.equal(isEditableOccurrence({ workflowState: "Due" }), true);
});

test("correction is append-only — original preserved, both versions present", () => {
  const orig = [{ field: "results", originalValue: { pct: 50 }, amendedValue: { pct: 75 }, reason: "recount", userId: "u1", at: "2026-09-05T10:00:00Z" }];
  const next = appendCorrection(orig, { field: "results", originalValue: { pct: 75 }, amendedValue: { pct: 80 }, reason: "final", userId: "u2", at: "2026-09-05T11:00:00Z" });
  assert.equal(next.length, 2);
  assert.deepEqual(next[0], orig[0], "original entry untouched");
});

test("handover gate: a shift cannot close with an unaddressed critical/P1/P2 item", () => {
  const blocked = canCloseShift([
    { occId: "a", criticality: "Critical" },
    { occId: "b", escalationPriority: "P2", disposition: "transfer" },
  ]);
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.blockers, ["a"]);
  const ok = canCloseShift([{ occId: "a", criticality: "Critical", disposition: "resolve" }, { occId: "c", criticality: "Routine" }]);
  assert.equal(ok.ok, true);
});

test("quick-chart match: nearest open occurrence; never a closed one", () => {
  const occs = [
    { occId: "o1", residentId: "R1", category: "Hydration", scheduledTime: "10:00", workflowState: "Upcoming" },
    { occId: "o2", residentId: "R1", category: "Hydration", scheduledTime: "14:00", workflowState: "Upcoming" },
    { occId: "o3", residentId: "R1", category: "Hydration", scheduledTime: "10:15", workflowState: "Closed" },
  ];
  assert.equal(matchOccurrenceForQuickChart(occs, "R1", "Hydration", 600), "o1"); // 10:00 nearest
  assert.equal(matchOccurrenceForQuickChart(occs, "R1", "Toileting", 600), null); // no category → trigger-based
  assert.equal(matchOccurrenceForQuickChart([occs[2]], "R1", "Hydration", 615), null); // only a Closed one
});

test("Rule 21: release validation blocks on any critical failure; clean passes", () => {
  const clean = validateRoutineRelease({
    occIds: ["d1@2026-09-05@0800", "d1@2026-09-05@1200"],
    definitions: [{ resultSchemaKey: "Hydration", completionControl: "Record & Complete", exceptionSet: ["Resident declined"], escalationPriority: "P2" }],
  });
  assert.equal(clean.ok, true, JSON.stringify(clean.criticalFailures));

  const dupe = validateRoutineRelease({ occIds: ["x", "x"], definitions: [{ resultSchemaKey: "H", completionControl: "Complete" }] });
  assert.ok(dupe.criticalFailures.includes("ID uniqueness"));

  const missing = validateRoutineRelease({ occIds: ["a"], definitions: [{ resultSchemaKey: "H" }] });
  assert.ok(missing.criticalFailures.includes("Required-field"));

  // Order gating disabled (per ops): a missing order is a WARNING, not a release blocker.
  const orderGap = validateRoutineRelease({ occIds: ["a"], definitions: [{ resultSchemaKey: "Medication Support", completionControl: "Open MAR", orderRequired: true }] });
  assert.ok(!orderGap.criticalFailures.includes("Order/scope"), "order gap no longer blocks release");
  assert.ok(orderGap.warnings.includes("Order/scope"), "order gap surfaces as a warning");

  const badVocab = validateRoutineRelease({ occIds: ["a"], definitions: [{ resultSchemaKey: "H", completionControl: "Complete", exceptionSet: ["Poor intake"] }] });
  assert.ok(badVocab.criticalFailures.includes("Vocabulary validity"));

  const mem = validateRoutineRelease({ occIds: ["a"], definitions: [{ resultSchemaKey: "H", completionControl: "Complete", memoryPathwayId: "MC-03", sourceLocBundleId: "MC-03" }] });
  assert.ok(mem.criticalFailures.includes("Memory-Care invariant"));
});

test("release: exceptionSet values are canonical EXCEPTION_REASON", () => {
  // sanity that the check keys off the real enum
  assert.ok((EXCEPTION_REASON as readonly string[]).includes("Resident declined"));
});
