// DT-001 admission-suitability gate + scheduled LOC reassessment cadence.
import test from "node:test";
import assert from "node:assert/strict";

import { evaluateAdmissionSuitability } from "../src/lib/lifecare/admissionSuitability.ts";
import { reassessmentStatus, REASSESSMENT_INTERVAL_DAYS } from "../src/lib/lifecare/reassessment.ts";

// ── DT-001 admission suitability ──
test("within scope + manageable risk → ACCEPT", () => {
  const r = evaluateAdmissionSuitability({ withinCapability: true, risksManageable: true });
  assert.equal(r.outcome, "ACCEPT");
  assert.equal(r.requiresSeniorReview, false);
  assert.ok(r.appliedRules.includes("BR-001.01"));
});

test("out of scope but gaps mitigable → CONDITIONAL (BR-001.03)", () => {
  const r = evaluateAdmissionSuitability({ withinCapability: false, risksManageable: true, gapsMitigable: true });
  assert.equal(r.outcome, "CONDITIONAL");
  assert.ok(r.appliedRules.includes("BR-001.03"));
  assert.equal(r.requiresSeniorReview, true);
});

test("out of scope, gaps NOT mitigable → DECLINE", () => {
  const r = evaluateAdmissionSuitability({ withinCapability: false, risksManageable: true, gapsMitigable: false });
  assert.equal(r.outcome, "DECLINE");
});

test("unmanaged high risk → ESCALATE (BR-001.02)", () => {
  const r = evaluateAdmissionSuitability({ withinCapability: true, risksManageable: false });
  assert.equal(r.outcome, "ESCALATE");
  assert.ok(r.appliedRules.includes("BR-001.02"));
});

test("DECLINE outranks ESCALATE when both fire", () => {
  const r = evaluateAdmissionSuitability({ withinCapability: false, gapsMitigable: false, risksManageable: false });
  assert.equal(r.outcome, "DECLINE");
});

test("a high-acuity capability gate forces Care-Manager review even when acceptable", () => {
  const r = evaluateAdmissionSuitability({ withinCapability: true, risksManageable: true, capabilityGate: true, suggestedLevel: "L4" });
  assert.equal(r.outcome, "CONDITIONAL");
  assert.equal(r.requiresSeniorReview, true);
});

// ── Scheduled LOC reassessment cadence ──
test("interval tightens with acuity", () => {
  assert.ok(REASSESSMENT_INTERVAL_DAYS.L1 > REASSESSMENT_INTERVAL_DAYS.L3);
  assert.ok(REASSESSMENT_INTERVAL_DAYS.L3 > REASSESSMENT_INTERVAL_DAYS.L5);
});

test("a recent L3 assessment is not yet due", () => {
  const s = reassessmentStatus({ level: "L3", lastAssessedISO: "2026-08-01T00:00:00Z", nowISO: "2026-08-20T00:00:00Z" })!;
  assert.equal(s.overdue, false);
  assert.equal(s.daysOverdue, 0);
  assert.ok(s.daysUntilDue > 0);
});

test("an L3 assessment past 90 days is overdue", () => {
  const s = reassessmentStatus({ level: "L3", lastAssessedISO: "2026-04-01T00:00:00Z", nowISO: "2026-08-20T00:00:00Z" })!;
  assert.equal(s.overdue, true);
  assert.ok(s.daysOverdue > 50);
  assert.equal(s.dueISO.slice(0, 10), "2026-06-30");
});

test("L5 is monthly — 40 days out is overdue", () => {
  const s = reassessmentStatus({ level: "L5", lastAssessedISO: "2026-07-10T00:00:00Z", nowISO: "2026-08-20T00:00:00Z" })!;
  assert.equal(s.overdue, true);
});

test("a bad date returns null", () => {
  assert.equal(reassessmentStatus({ level: "L2", lastAssessedISO: "not-a-date" }), null);
});
