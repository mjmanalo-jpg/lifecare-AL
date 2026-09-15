// One definition of "care owed this shift", shared by the metric card and its
// drill-down. They used to compute it separately — the card counted Tasks AND routine
// occurrences while the drill-down listed Tasks only, so "Inspect numerator /
// denominator" contradicted the very card it was opened from.
import assert from "node:assert/strict";
import test from "node:test";

import { occurrenceInstant, owedOccurrences } from "../src/lib/dashboard/delivery.ts";

const TZ = "Asia/Manila";
// 10:00 Manila on 12 Sep 2026 = 02:00 UTC. Mid AM shift.
const NOW = new Date("2026-09-12T02:00:00Z");
const SHIFT_START = new Date("2026-09-11T22:00:00Z"); // 06:00 Manila
const SHIFT_END = new Date("2026-09-12T06:00:00Z"); // 14:00 Manila
// careDate is stored as the care day's Manila midnight.
const CARE_DATE = new Date("2026-09-11T16:00:00Z");

const occ = (scheduledTime: string, extra: Record<string, unknown> = {}) => ({
  careDate: CARE_DATE, scheduledTime, workflowState: "Open", careDeliveryOutcome: null, ...extra,
});

const owed = (rows: Parameters<typeof owedOccurrences>[0]) =>
  owedOccurrences(rows, { from: SHIFT_START, to: SHIFT_END, now: NOW, timeZone: TZ });

test("an occurrence slot resolves in the facility zone", () => {
  assert.equal(occurrenceInstant("2026-09-12", "06:15", TZ), Date.parse("2026-09-11T22:15:00Z"));
});

test("care still inside its window is not owed yet", () => {
  assert.equal(owed([occ("13:00")]).length, 0, "a task later this shift is not a failure");
  assert.equal(owed([occ("06:15")]).length, 0, "hands-on care has the whole shift to be charted");
});

test("care whose window has passed is owed and undelivered", () => {
  // Nurse-owned (medication / clinical monitoring) keeps the tight 30-min window, so
  // an open 06:15 dose is already a miss at 10:00.
  const rows = owed([occ("06:15", { definition: { responsibleRole: "Nurse" } })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].delivered, false);
});

test("a closed occurrence is owed and counts as delivered on a completing outcome", () => {
  const rows = owed([occ("13:00", { workflowState: "Closed", careDeliveryOutcome: "Completed as planned" })]);
  assert.equal(rows.length, 1, "already charted, so it is owed even before its window passes");
  assert.equal(rows[0].delivered, true);
});

test("a refusal is owed but never counts as delivered", () => {
  const rows = owed([occ("06:15", { workflowState: "Closed", careDeliveryOutcome: "Refused" })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].delivered, false);
});

test("cancelled care leaves the denominator entirely", () => {
  assert.equal(owed([occ("06:15", { workflowState: "Cancelled" })]).length, 0);
});

test("care outside the shift window is excluded", () => {
  assert.equal(owed([occ("15:00")]).length, 0, "a PM occurrence is not AM-shift care");
});
