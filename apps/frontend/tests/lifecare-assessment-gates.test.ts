import test from "node:test";
import assert from "node:assert/strict";

import { assessmentValidationIssues, requiredModifierIds, type AssessmentV42 } from "../src/lib/lifecare/assessment.ts";
import { DOMAIN_CODES, type CareLevel, type DomainCode } from "../src/lib/lifecare/types.ts";

function assessment(finalLevel: CareLevel = "L1"): AssessmentV42 {
  return {
    id: "gate-test",
    status: "COMPLETED",
    modelVersion: "test",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    layer1: { residentName: "Test Resident" },
    domains: Object.fromEntries(DOMAIN_CODES.map((code) => [code, { score: 0, evidence: "Current assessment evidence" }])) as Partial<Record<DomainCode, { score: number; evidence: string }>>,
    context: {},
    layer3: { finalLevel, finalLevelJustification: "Final LOC reflects intrinsic assessed need." },
  };
}

test("a fully evidenced low-acuity assessment satisfies finalized G1-G5 gates", () => {
  assert.deepEqual(assessmentValidationIssues(assessment()), []);
});

test("G1 requires a valid score and supporting evidence for every scored domain", () => {
  const a = assessment();
  delete a.domains["AS-09"];
  a.domains["AS-10"] = { score: 2 };
  const g1 = assessmentValidationIssues(a).find((issue) => issue.gate === "G1");
  assert.ok(g1);
  assert.match(g1.message, /AS-09/);
  assert.match(g1.message, /AS-10/);
});

test("G2 requires an explicit disposition for every suggested or in-flow modifier", () => {
  const a = assessment("L2");
  a.domains["AS-03"] = { score: 3, evidence: "Validated high fall risk" };
  assert.ok(requiredModifierIds(a).includes("MOD-MOB-01"));
  assert.ok(assessmentValidationIssues(a).some((issue) => issue.gate === "G2"));

  a.layer3.modifierReconciliations = { "MOD-MOB-01": { decision: "NOT_APPLICABLE" } };
  assert.ok(assessmentValidationIssues(a).some((issue) => issue.gate === "G2"), "cleared modifiers require rationale");

  a.layer3.modifierReconciliations["MOD-MOB-01"].rationale = "Risk controls reviewed; current evidence does not meet the modifier definition.";
  assert.ok(!assessmentValidationIssues(a).some((issue) => issue.gate === "G2"));
});

test("G3 prevents Final LOC from falling below the highest triggered MLR floor", () => {
  const a = assessment("L2");
  a.domains["AS-02"] = { score: 3, evidence: "Extensive transfer assistance" };
  a.layer3.modifierReconciliations = { "MOD-MOB-02": { decision: "APPLIED" } };
  a.layer3.reconciledModifiers = ["MOD-MOB-02"];
  const g3 = assessmentValidationIssues(a).find((issue) => issue.gate === "G3");
  assert.ok(g3);
  assert.match(g3.message, /L3 minimum-level floor/);
});

test("G4 requires override and capability-review rationale", () => {
  const a = assessment("L4");
  a.domains["AS-04"] = { score: 4, evidence: "Pervasive cognitive supervision" };
  a.layer3.modifierReconciliations = { "MOD-COG-01": { decision: "APPLIED" } };
  a.layer3.reconciledModifiers = ["MOD-COG-01"];
  a.context.overrideLevel = "L4";

  const missing = assessmentValidationIssues(a).filter((issue) => issue.gate === "G4");
  assert.equal(missing.length, 2);

  a.context.overrideReason = "Authorized clinical judgment confirms comprehensive care.";
  a.layer3.capabilityReview = { outcome: "WITHIN_CAPABILITY", rationale: "Required staffing, competency and equipment are available." };
  assert.ok(!assessmentValidationIssues(a).some((issue) => issue.gate === "G4"));
});
