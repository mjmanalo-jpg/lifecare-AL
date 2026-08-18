// Wiring — v4.2 Final LOC -> downstream artefacts.
import test from "node:test";
import assert from "node:assert/strict";

import { levelRank, careLevelEnum, downstreamForAssessment } from "../src/lib/lifecare/downstream.ts";

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
