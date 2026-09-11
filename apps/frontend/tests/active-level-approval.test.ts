// activeLevel — a validated reassessment must not move the active LOC until it is
// APPLIED (present in loc_history via direct apply or CM/Superadmin approval).
import test from "node:test";
import assert from "node:assert/strict";

import { activeLevel } from "../src/lib/lifecare/activeLevel.ts";
import type { LocHistoryEntry } from "../src/lib/lifecare/locHistory.ts";
import type { AssessmentV42 } from "../src/lib/lifecare/assessment.ts";

const A = (id: string, fin: string, updatedAt: string): AssessmentV42 =>
  ({ id, status: "VALIDATED", updatedAt, layer1: { residentId: "r1" }, layer3: { finalLevel: fin } }) as unknown as AssessmentV42;
const H = (level: string, assessmentId: string, at: string): LocHistoryEntry =>
  ({ id: `h-${assessmentId}`, residentId: "r1", level, source: "REASSESSMENT", assessmentId, at }) as LocHistoryEntry;

const active = (locHistory: LocHistoryEntry[], assessments: AssessmentV42[]) =>
  activeLevel({ residentId: "r1", locHistory, assessments });

test("pending reassessment does NOT change the active level", () => {
  // Prior L2 applied (a0). New validated L1 (re1) awaiting approval → not in history.
  assert.equal(active([H("L2", "a0", "2026-01-01")], [A("re1", "L1", "2026-02-01")]), 2);
});

test("approved reassessment DOES change the active level", () => {
  // Approval wrote a loc_history entry referencing re1 → now authoritative.
  assert.equal(active([H("L1", "re1", "2026-02-02"), H("L2", "a0", "2026-01-01")], [A("re1", "L1", "2026-02-01")]), 1);
});

test("same-level pending reassessment leaves the level unchanged", () => {
  assert.equal(active([H("L2", "a0", "2026-01-01")], [A("re2", "L2", "2026-02-01")]), 2);
});

test("no history yet → trust the validated assessment (first record / pre-admission)", () => {
  assert.equal(active([], [A("a0", "L3", "2026-01-01")]), 3);
});
