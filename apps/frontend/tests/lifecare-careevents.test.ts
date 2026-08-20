// Phase 4 verify — care-event classification + variance loop.
import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyOutcome, evaluateVariance, buildCareEventRecord, OUTCOMES,
} from "../src/lib/lifecare/careEvents.ts";
import engineRules from "../src/lib/lifecare/data/care_event_engine_rules.json" with { type: "json" };
import careEventMaster from "../src/lib/lifecare/data/care_event_master.json" with { type: "json" };
import decisionTreesData from "../src/lib/lifecare/data/decision_trees.json" with { type: "json" };

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

// ── H4: acute events reach the emergency pathway (never revenue-gated) ──

test("acute safety/deterioration outcomes route to the emergency pathway (DT-010)", () => {
  for (const o of ["Unsafe", "Clinical Change"] as const) {
    const c = classifyOutcome(o);
    assert.equal(c.emergencyPathway, true, `${o} should reach the emergency pathway`);
    assert.equal(c.emergencyProtocol, "DT-010");
    assert.equal(c.immediateEscalation, true);
  }
  // Routine / variance outcomes never trigger the emergency pathway.
  for (const o of ["Completed", "Not Required", "Refused", "Unable", "Increased Assist", "Frequency Variance"] as const) {
    assert.equal(classifyOutcome(o).emergencyPathway, false, `${o} should NOT be an emergency`);
  }
});

// ── M1: the classifier is traceable to the rule data (code↔data agreement) ──

test("every classification id exists in the decision-rule data", () => {
  const cegIds = new Set((engineRules as Array<{ id: string }>).map((r) => r.id));
  const archetypes = new Set((careEventMaster as Array<{ archetype?: string }>).map((e) => e.archetype).filter(Boolean) as string[]);
  const dtIds = new Set((decisionTreesData as Array<{ id: string }>).map((d) => d.id));

  for (const o of OUTCOMES) {
    const c = classifyOutcome(o);
    if (c.engineRuleId) assert.ok(cegIds.has(c.engineRuleId), `${o}: engineRuleId ${c.engineRuleId} not in care_event_engine_rules.json`);
    if (c.archetype) assert.ok(archetypes.has(c.archetype), `${o}: archetype ${c.archetype} not in care_event_master.json`);
    if (c.linkedDecisionTree) assert.ok(dtIds.has(c.linkedDecisionTree), `${o}: DT ${c.linkedDecisionTree} not in decision_trees.json`);
    if (c.emergencyProtocol) assert.ok(dtIds.has(c.emergencyProtocol), `${o}: emergencyProtocol ${c.emergencyProtocol} not in decision_trees.json`);
  }
});

test("variance outcomes carry an engine rule and no misassigned generic archetype", () => {
  // Increased Assist / Frequency Variance are traced by CEG (not the CE-04
  // 'abnormal observation' archetype they used to be mislabelled with).
  const ia = classifyOutcome("Increased Assist");
  assert.equal(ia.engineRuleId, "CEG-02");
  assert.equal(ia.archetype, undefined);
  const fv = classifyOutcome("Frequency Variance");
  assert.equal(fv.engineRuleId, "CEG-03");
  assert.equal(fv.archetype, undefined);
});
