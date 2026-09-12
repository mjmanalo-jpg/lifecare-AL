// One resident, one governance row. The v4.2 store keeps every assessment ever
// written — a reassessment leaves the superseded draft behind. Governance must read
// the resident's CURRENT assessment, or a validated resident keeps reappearing on the
// board because of a draft nobody is working on any more.
import assert from "node:assert/strict";
import test from "node:test";

import { authoritativeAssessments, type AssessmentStatus, type AssessmentV42 } from "../src/lib/lifecare/assessment.ts";

const record = (
  id: string, status: AssessmentStatus, updatedAt: string,
  layer1: AssessmentV42["layer1"],
): AssessmentV42 => ({
  id, status, modelVersion: "test", createdAt: updatedAt, updatedAt,
  layer1, domains: {}, context: {}, layer3: {},
});

test("a validated assessment wins over the resident's leftover draft", () => {
  const all = [
    record("draft", "DRAFT", "2026-09-01T00:00:00.000Z", { residentName: "QA Test 2", residentId: "res_2" }),
    record("valid", "VALIDATED", "2026-08-20T00:00:00.000Z", { residentName: "QA Test 2", residentId: "res_2" }),
  ];
  const current = authoritativeAssessments(all);
  assert.equal(current.length, 1, "one row per resident");
  assert.equal(current[0].id, "valid", "validated outranks a newer draft");
});

test("residents are kept apart", () => {
  const all = [
    record("a", "VALIDATED", "2026-09-01T00:00:00.000Z", { residentName: "QA Test 2", residentId: "res_2" }),
    record("b", "DRAFT", "2026-09-01T00:00:00.000Z", { residentName: "QA Test 3", residentId: "res_3" }),
  ];
  assert.deepEqual(authoritativeAssessments(all).map((a) => a.id).sort(), ["a", "b"]);
});

test("a pre-admission record with no residentId still matches by name", () => {
  const all = [
    record("pre", "DRAFT", "2026-09-01T00:00:00.000Z", { residentName: "Marina Dacanay Drohman" }),
    record("post", "VALIDATED", "2026-08-01T00:00:00.000Z", { residentName: "MARINA  DACANAY   DROHMAN", residentId: "res_9" }),
  ];
  const current = authoritativeAssessments(all);
  assert.equal(current.length, 1, "the same person, captured before and after admission");
  assert.equal(current[0].id, "post");
});

test("two drafts for one resident collapse to the most recent", () => {
  const all = [
    record("old", "DRAFT", "2026-08-01T00:00:00.000Z", { residentName: "Elma Fabros", residentId: "res_4" }),
    record("new", "DRAFT", "2026-09-05T00:00:00.000Z", { residentName: "Elma Fabros", residentId: "res_4" }),
  ];
  assert.deepEqual(authoritativeAssessments(all).map((a) => a.id), ["new"]);
});

test("unidentifiable records are never merged together", () => {
  const all = [
    record("x", "DRAFT", "2026-09-01T00:00:00.000Z", { residentName: "" }),
    record("y", "DRAFT", "2026-09-02T00:00:00.000Z", { residentName: "" }),
  ];
  assert.equal(authoritativeAssessments(all).length, 2, "no identity is not the same identity");
});
