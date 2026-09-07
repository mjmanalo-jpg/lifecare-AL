// SLMS v4.2 Persistence + Nurse approval (sub-project #3) — pure-logic self-checks
// (no DB). Acceptance mapped to Routine Assembly Rules 14, 15, 18, 19.
import test from "node:test";
import assert from "node:assert/strict";

import {
  makeOccId, isEligibleForCareDay, eligibleForCareDay, expandDefinitionOccurrences,
  materializeCareDay, applyRevision, assertAssistanceLevel, draftEventToDefinitionRow,
} from "../src/lib/lifecare/routineDefinitions.ts";
import { assembleRoutine } from "../src/lib/lifecare/assembleRoutine.ts";

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
