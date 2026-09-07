// SLMS v4.2 — deriving AssembleInput from real resident records (generate-draft wiring).
import test from "node:test";
import assert from "node:assert/strict";

import { careLevelToLoc, domainsFromAssessment, conditionsFromAssessment, ordersFromRecords } from "../src/lib/lifecare/routineInputs.ts";
import { assembleRoutine } from "../src/lib/lifecare/assembleRoutine.ts";

test("careLevelToLoc maps L1..L5 (and 'Level n') to LOC n", () => {
  assert.equal(careLevelToLoc("L4"), "LOC 4");
  assert.equal(careLevelToLoc("Level 2"), "LOC 2");
  assert.equal(careLevelToLoc(undefined), undefined);
});

test("domainsFromAssessment: score 0 is inactive, ≥1 active; names resolved", () => {
  const doms = domainsFromAssessment({ domains: { "AS-01": { score: 3 }, "AS-06": { score: 0 }, "AS-08": { score: 2 } } });
  const byCode = Object.fromEntries(doms.map((d) => [d.code, d]));
  assert.equal(byCode["AS-01"].activeNeed, true);
  assert.equal(byCode["AS-01"].score, 3);
  assert.ok(byCode["AS-01"].name && byCode["AS-01"].name !== "AS-01", "domain name resolved from data");
  assert.equal(byCode["AS-06"].activeNeed, false, "score 0 → no staff-action need");
});

test("conditionsFromAssessment: structured flags + diagnosis keywords → bundleIds", () => {
  const r = conditionsFromAssessment({
    layer1: { diagnoses: "Type 2 Diabetes Mellitus; Hypertension; recurrent falls" },
    context: { dysphagia: true, recentHospitalization: true },
  });
  assert.ok(r.activeConditions.includes("DM-01"));
  assert.ok(r.activeConditions.includes("HTN-01"));
  assert.ok(r.activeConditions.includes("FALL-01"));
  assert.ok(r.activeConditions.includes("DYSPH-01"), "context.dysphagia");
  assert.ok(r.activeConditions.includes("FRAIL-01"), "context.recentHospitalization");
  assert.equal(r.memoryIntensity, undefined, "no dementia → no memory pathway");
});

test("conditionsFromAssessment: dementia → memory intensity from AS-04 score (independent of LOC)", () => {
  const r = conditionsFromAssessment({ layer1: { diagnoses: "Alzheimer's dementia" }, domains: { "AS-04": { score: 3 } } });
  assert.equal(r.memoryIntensity, "Enhanced");
  assert.ok(!r.activeConditions.includes("MC-03"), "memory is a pathway intensity, not an activeCondition");
});

test("ordersFromRecords: medications + diet map to OrderInput", () => {
  const o = ordersFromRecords(
    [{ id: "M1", name: "Amlodipine", dosage: "5mg", frequency: "OD", route: "oral", startDate: "2026-09-01" }],
    { id: "D1", dietType: "PUREED", mealType: "ALL" },
  );
  assert.equal(o.medications?.length, 1);
  assert.equal(o.medications?.[0].id, "M1");
  assert.equal(o.diet?.texture, "PUREED", "texture carried from dietType for the dysphagia check");
});

test("end-to-end: real orders unblock the medication event (no more BLOCKED)", () => {
  const base = {
    residentId: "R1", finalLoc: "LOC 4" as const, assessmentVersion: "v4.2",
    domains: domainsFromAssessment({ domains: { "AS-01": { score: 3 }, "AS-07": { score: 2 } } }),
    activeConditions: [], orders: {}, effectiveDate: "2026-09-05",
  };
  const blocked = assembleRoutine(base).find((e) => e.resultSchemaKey === "Medication Support");
  assert.equal(blocked?.status, "BLOCKED", "no med order → blocked");

  const withMeds = assembleRoutine({ ...base, orders: ordersFromRecords([{ id: "M1", name: "Amlodipine", dosage: "5mg", frequency: "OD", startDate: "2026-09-01" }]) });
  const med = withMeds.find((e) => e.resultSchemaKey === "Medication Support");
  assert.equal(med?.status, "DRAFT", "with a real med order → resolved (DRAFT), not blocked");
  assert.equal(med?.orderRef, "M1");
});
