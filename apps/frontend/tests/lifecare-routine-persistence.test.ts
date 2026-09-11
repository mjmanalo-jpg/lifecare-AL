// SLMS v4.2 Persistence + Nurse approval (sub-project #3) — pure-logic self-checks
// (no DB). Acceptance mapped to Routine Assembly Rules 14, 15, 18, 19.
import test from "node:test";
import assert from "node:assert/strict";

import {
  makeOccId, isEligibleForCareDay, eligibleForCareDay, expandDefinitionOccurrences,
  materializeCareDay, applyRevision, assertAssistanceLevel, draftEventToDefinitionRow,
  routineFamily, routineFamilyKey, sharedRoutineFields,
} from "../src/lib/lifecare/routineDefinitions.ts";
import { assembleRoutine, assembleRoutine24h } from "../src/lib/lifecare/assembleRoutine.ts";

test("occId keying: stable, colon-stripped, unique per HH:MM", () => {
  assert.equal(makeOccId("def1", "2026-09-05", "08:00"), "def1@2026-09-05@0800");
  assert.equal(makeOccId("def1", "2026-09-05", "08:00"), makeOccId("def1", "2026-09-05", "08:00"));
  assert.notEqual(makeOccId("def1", "2026-09-05", "08:00"), makeOccId("def1", "2026-09-05", "20:00"));
});

test("Rule 14: only APPROVED + effective + not-past-stop generate occurrences", () => {
  const day = "2026-09-05";
  assert.equal(isEligibleForCareDay({ status: "APPROVED", effectiveDate: "2026-09-01" }, day), true);
  assert.equal(isEligibleForCareDay({ status: "DRAFT", effectiveDate: "2026-09-01" }, day), false);
  assert.equal(isEligibleForCareDay({ status: "RETURNED", effectiveDate: "2026-09-01" }, day), false);
  assert.equal(isEligibleForCareDay({ status: "EXPIRED", effectiveDate: "2026-09-01" }, day), false);
  assert.equal(isEligibleForCareDay({ status: "CANCELLED", effectiveDate: "2026-09-01" }, day), false);
  assert.equal(isEligibleForCareDay({ status: "APPROVED", effectiveDate: "2026-09-10" }, day), false); // not yet effective
  const defs = [
    { status: "APPROVED", effectiveDate: "2026-09-01" },
    { status: "DRAFT", effectiveDate: "2026-09-01" },
  ];
  assert.equal(eligibleForCareDay(defs, day).length, 1);
});

test("Rule 19: a temporary bundle past its stop date generates nothing (FRAIL-01)", () => {
  const def = { status: "APPROVED", effectiveDate: "2026-08-01", stopDate: "2026-09-04" };
  assert.equal(isEligibleForCareDay(def, "2026-09-04"), true);  // on stop date, still active
  assert.equal(isEligibleForCareDay(def, "2026-09-05"), false); // day after stop → nothing
});

test("Rule 15: schedule expansion covers the day, pins version, no duplicate occId", () => {
  const day = "2026-09-05";
  const wake = expandDefinitionOccurrences(
    { id: "d1", version: 2, residentId: "R1", frequencyMethod: "while_awake", schedule: { intervalHours: 3, wakeStart: 7, wakeEnd: 22 } }, day);
  assert.equal(wake.length, 6, "six while awake");
  assert.ok(wake.every((o) => o.definitionVersion === 2), "definitionVersion pinned");
  assert.equal(new Set(wake.map((o) => o.occId)).size, 6, "unique occIds");
  const exact = expandDefinitionOccurrences(
    { id: "d2", version: 1, residentId: "R1", frequencyMethod: "exact_time", schedule: { times: ["08:00", "20:00"] } }, day);
  assert.equal(exact.length, 2);
  const prn = expandDefinitionOccurrences(
    { id: "d3", version: 1, residentId: "R1", frequencyMethod: "trigger_prn", schedule: { trigger: "on pain" } }, day);
  assert.equal(prn.length, 0, "PRN schedules nothing");
  // materialize dedups across defs
  const all = materializeCareDay([
    { id: "d2", version: 1, residentId: "R1", frequencyMethod: "exact_time", schedule: { times: ["08:00"] } },
    { id: "d2", version: 1, residentId: "R1", frequencyMethod: "exact_time", schedule: { times: ["08:00"] } },
  ], day);
  assert.equal(all.length, 1, "same def+time dedups by occId");
});

test("Rule 18: applyRevision creates v+1 draft without mutating the prior version", () => {
  const prev = {
    id: "old", version: 1, status: "APPROVED", name: "Repositioning", assistanceLevel: "Extensive Assist",
    approvedBy: "nurseA", approvedAt: new Date(), originalRecommendation: { finalLoc: "LOC 4" },
  };
  const frozen = JSON.stringify(prev);
  const next = applyRevision(prev as never, { assistanceLevel: "Total Assist" }, "condition worsened");
  assert.equal(JSON.stringify(prev), frozen, "prior version object not mutated");
  assert.equal(next.version, 2);
  assert.equal(next.status, "DRAFT");
  assert.equal(next.supersedesVersion, 1);
  assert.equal(next.revisionReason, "condition worsened");
  assert.equal(next.assistanceLevel, "Total Assist");
  assert.equal(next.approvedBy, null, "new version is not pre-approved");
  assert.ok(!("id" in next), "new row has no carried id");
});

test("assistance guard: a two-person/mechanical string can never be an assistance level", () => {
  assert.equal(assertAssistanceLevel("Total Assist"), "Total Assist");
  assert.throws(() => assertAssistanceLevel("Two-person assist"), /staffing\/equipment/);
  assert.throws(() => assertAssistanceLevel("Mechanical lift"), /staffing\/equipment/);
  assert.throws(() => assertAssistanceLevel("banana"), /not a canonical assistance level/);
});

test("draft mapper: #2 BLOCKED event persists as DRAFT + blockReason (no BLOCKED db status)", () => {
  const defs = assembleRoutine({
    residentId: "R1", finalLoc: "LOC 4", assessmentVersion: "v4.2", domains: [],
    activeConditions: [], orders: {}, effectiveDate: "2026-09-05",
  });
  const med = defs.find((e) => e.resultSchemaKey === "Medication Support" && e.status === "BLOCKED");
  assert.ok(med, "a med event is BLOCKED without an order");
  const row = draftEventToDefinitionRow(med!, "R1", "C1");
  assert.equal(row.status, "DRAFT", "persists as DRAFT");
  assert.ok(row.blockReason, "carries the block reason for the board");
  assert.equal(row.version, 1);
  assert.equal(row.residentId, "R1");
});

// ── Recurring-event families: a nurse edit to one occurrence lands on its siblings ──
test("routine family: same-kind events at other times group; catch-all does not", () => {
  const defs = [
    { id: "a", name: "Morning toileting", resultSchemaKey: "Toileting / Continence", status: "DRAFT" },
    { id: "b", name: "Pre-lunch toileting", resultSchemaKey: "Toileting / Continence", status: "DRAFT" },
    { id: "c", name: "Bedtime toileting", resultSchemaKey: "Toileting / Continence", status: "APPROVED" },
    { id: "d", name: "Meal", resultSchemaKey: "Meal / Supplement", status: "DRAFT" },
    { id: "e", name: "Handover preparation", resultSchemaKey: "General Observation", status: "DRAFT" },
    { id: "f", name: "Rest support", resultSchemaKey: "General Observation", status: "DRAFT" },
  ];
  assert.deepEqual(routineFamily(defs[0], defs).map((d) => d.id), ["b"]); // not "c" — different status
  assert.deepEqual(routineFamily(defs[3], defs).map((d) => d.id), []);    // only meal in the draft
  assert.deepEqual(routineFamily(defs[4], defs).map((d) => d.id), []);    // catch-all never groups
  assert.equal(routineFamilyKey(defs[4]), "");
});

test("edit propagation carries the decision, never the per-occurrence schedule", () => {
  const shared = sharedRoutineFields({
    assistanceLevel: "Total Assist", responsibleRole: "Nurse", staffing: "Two-person",
    revisionReason: "MD order", orderRef: "DIET-1",
    schedule: { times: ["06:15"] }, frequencyMethod: "exact_time", shiftOwner: "AM",
    name: "Morning toileting", status: "DRAFT", blockReason: null, id: "a",
  });
  assert.deepEqual(Object.keys(shared).sort(),
    ["assistanceLevel", "orderRef", "responsibleRole", "revisionReason", "staffing"]);
});

test("Breakfast / Lunch / Dinner generate as one recurring 'Meal' event", () => {
  const out = assembleRoutine24h({
    residentId: "R1", finalLoc: "LOC 3", assessmentVersion: "v4.2", domains: [],
    activeConditions: [], orders: {}, effectiveDate: "2026-09-11",
  });
  const meals = out.filter((e) => e.resultSchemaKey === "Meal / Supplement");
  assert.equal(meals.length, 3, "three meals a day");
  assert.ok(meals.every((e) => e.name === "Meal"), "all named Meal");
  assert.deepEqual(meals.map((e) => e.schedule.times?.[0]).sort(), ["08:00", "12:00", "18:00"]);
  assert.equal(out.filter((e) => /^(breakfast|lunch|dinner)$/i.test(e.name)).length, 0);
});

test("client renames: meals collapse to 'Meal', ordered reading is 'Vital Signs'", () => {
  const out = assembleRoutine24h({
    residentId: "R1", finalLoc: "LOC 3", assessmentVersion: "v4.2", domains: [],
    activeConditions: [], orders: {}, effectiveDate: "2026-09-11",
  });
  const byId = (rt: string) => out.find((e) => e.sourceLocBundleId === rt);
  assert.equal(byId("RT-012")?.name, "Vital Signs");
  assert.equal(byId("RT-012")?.resultSchemaKey, "Vital Signs");
  // Every renamed row keeps a family key consistent with its new name.
  for (const rt of ["RT-009", "RT-017", "RT-027"]) assert.equal(byId(rt)?.name, "Meal");
  // Pre-lunch / pre-dinner toileting are continence events, not meals.
  for (const rt of ["RT-016", "RT-026"]) assert.equal(byId(rt)?.resultSchemaKey, "Toileting / Continence");
  assert.equal(out.filter((e) => e.name === "Ordered clinical reading").length, 0);
});
