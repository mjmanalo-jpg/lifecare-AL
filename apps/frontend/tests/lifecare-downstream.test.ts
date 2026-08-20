// Wiring — v4.2 Final LOC -> downstream artefacts.
import test from "node:test";
import assert from "node:assert/strict";

import { levelRank, careLevelEnum, downstreamForAssessment, decideLocApplication } from "../src/lib/lifecare/downstream.ts";

test("level rank maps L1-L5 to 1-5", () => {
  assert.deepEqual(["L1", "L2", "L3", "L4", "L5"].map(levelRank), [1, 2, 3, 4, 5]);
});

test("careLevel enum mirrors the Care Acuity mapping", () => {
  assert.equal(careLevelEnum("L1"), "INDEPENDENT");
  assert.equal(careLevelEnum("L2"), "ASSISTED");
  assert.equal(careLevelEnum("L3"), "ASSISTED");
  assert.equal(careLevelEnum("L4"), "MEMORY");
  assert.equal(careLevelEnum("L5"), "SKILLED");
});

test("downstream is only computed for a validated, resident-linked, leveled assessment", () => {
  assert.equal(downstreamForAssessment({ residentId: "r1", finalLevel: "L3", validated: true })?.numericLevel, 3);
  assert.equal(downstreamForAssessment({ residentId: "r1", finalLevel: "L3", validated: false }), null);
  assert.equal(downstreamForAssessment({ residentId: undefined, finalLevel: "L3", validated: true }), null);
  assert.equal(downstreamForAssessment({ residentId: "r1", finalLevel: null, validated: true }), null);
});

test("downstream plan requests LOC charge + care plan generation", () => {
  const d = downstreamForAssessment({ residentId: "r1", finalLevel: "L4", validated: true })!;
  assert.equal(d.careLevelEnum, "MEMORY");
  assert.equal(d.postLocCharge, true);
  assert.equal(d.generatePlan, true);
});

// ── Governance-wired LOC application (H1 + H3): no auto-fee, downgrade guard ──

test("decideLocApplication is null unless validated + resident-linked + leveled", () => {
  assert.equal(decideLocApplication({ residentId: "r1", finalLevel: "L3", validated: false, authorisedBy: "RN" }), null);
  assert.equal(decideLocApplication({ residentId: undefined, finalLevel: "L3", validated: true, authorisedBy: "RN" }), null);
  assert.equal(decideLocApplication({ residentId: "r1", finalLevel: null, validated: true, authorisedBy: "RN" }), null);
});

test("an authorised first assessment applies level, charge and plan", () => {
  const d = decideLocApplication({ residentId: "r1", finalLevel: "L3", validated: true, authorisedBy: "RN Jane" })!;
  assert.equal(d.apply, true);
  assert.equal(d.postLocCharge, true);
  assert.equal(d.generatePlan, true);
  assert.equal(d.isDowngrade, false);
  assert.equal(d.numericLevel, 3);
  assert.equal(d.careLevelEnum, "ASSISTED");
});

test("no authoriser → nothing is applied or charged (no auto-fee, CL-19)", () => {
  const d = decideLocApplication({ residentId: "r1", finalLevel: "L3", validated: true })!;
  assert.equal(d.apply, false);
  assert.equal(d.postLocCharge, false);
  assert.equal(d.generatePlan, false);
  assert.match(d.blockedReason ?? "", /authoris/i);
});

test("a downgrade without a reassessment is blocked (CL-21)", () => {
  const d = decideLocApplication({ residentId: "r1", finalLevel: "L2", priorLevel: "L4", validated: true, authorisedBy: "RN", reassessed: false })!;
  assert.equal(d.isDowngrade, true);
  assert.equal(d.apply, false);
  assert.equal(d.postLocCharge, false);
  assert.match(d.blockedReason ?? "", /reassess/i);
});

test("a downgrade WITH an authorised reassessment proceeds", () => {
  const d = decideLocApplication({ residentId: "r1", finalLevel: "L2", priorLevel: "L4", validated: true, authorisedBy: "RN", reassessed: true })!;
  assert.equal(d.isDowngrade, true);
  assert.equal(d.apply, true);
  assert.equal(d.postLocCharge, true);
});

test("an upgrade is never treated as a downgrade", () => {
  const d = decideLocApplication({ residentId: "r1", finalLevel: "L4", priorLevel: "L2", validated: true, authorisedBy: "RN" })!;
  assert.equal(d.isDowngrade, false);
  assert.equal(d.apply, true);
});
