// SLMS v4.2 caregiver occurrence status (#4) — pure display-state derivation.
import test from "node:test";
import assert from "node:assert/strict";

import { deriveState, isChartable, isLate, isMissed, countProgress, manilaDay, shiftOfTime, chartingDeadlineMin, WINDOW_LEAD_MIN, OCCURRENCE_GRACE_MIN } from "../src/lib/lifecare/occurrenceStatus.ts";

const at = "08:00"; // 480 min
const S = 480;
const AM_END = 14 * 60;
const nurse = { scheduledTime: at, responsibleRole: "Nurse" };

test("deriveState: a caregiver row stays Due for the REST OF ITS SHIFT", () => {
  assert.equal(deriveState({ scheduledTime: at }, S - WINDOW_LEAD_MIN - 1), "Upcoming");
  assert.equal(deriveState({ scheduledTime: at }, S - WINDOW_LEAD_MIN), "Due");     // opens at lead
  assert.equal(deriveState({ scheduledTime: at }, S), "Due");
  assert.equal(deriveState({ scheduledTime: at }, S + OCCURRENCE_GRACE_MIN + 1), "Due", "30 min late is NOT overdue");
  assert.equal(deriveState({ scheduledTime: at }, AM_END - 1), "Due", "last minute of the AM shift");
  assert.equal(deriveState({ scheduledTime: at }, AM_END), "Overdue", "the shift ended uncharted");
});

test("deriveState: nurse-owned (medication/vitals) keeps the tight 30-min window", () => {
  assert.equal(deriveState(nurse, S + OCCURRENCE_GRACE_MIN), "Due");
  assert.equal(deriveState(nurse, S + OCCURRENCE_GRACE_MIN + 1), "Overdue");
  // The role may arrive nested on the row's definition.
  assert.equal(deriveState({ scheduledTime: at, definition: { responsibleRole: "Nurse" } }, S + 31), "Overdue");
});

// chartingDeadlineMin = the LAST minute that still counts as on time.
test("chartingDeadlineMin: end of the owning shift, never less than the 30-min grace", () => {
  assert.equal(chartingDeadlineMin({ scheduledTime: "08:00" }), AM_END - 1);      // AM → through 13:59
  assert.equal(chartingDeadlineMin({ scheduledTime: "15:00" }), 22 * 60 - 1);     // PM → through 21:59
  assert.equal(chartingDeadlineMin({ scheduledTime: "00:30" }), 6 * 60 - 1);      // NOC tail → through 05:59
  assert.equal(chartingDeadlineMin({ scheduledTime: "23:00" }), 1439);            // NOC head → end of care day
  assert.equal(chartingDeadlineMin({ scheduledTime: "13:50" }), 13 * 60 + 50 + OCCURRENCE_GRACE_MIN,
    "a task scheduled minutes before the shift ends still gets the 30-min floor");
  assert.equal(chartingDeadlineMin(nurse), S + OCCURRENCE_GRACE_MIN);
});

test("manilaDay: careDate stored as Manila midnight resolves to the correct PH care day (not the UTC prev day)", () => {
  // Manila midnight of 2026-09-07 is 2026-09-06T16:00:00Z — the UTC prefix would wrongly read 09-06.
  assert.equal(manilaDay("2026-09-06T16:00:00.000Z"), "2026-09-07");
  assert.equal(manilaDay("2026-09-07T00:00:00+08:00"), "2026-09-07");
  assert.equal(manilaDay("2026-09-07"), "2026-09-07");
  assert.equal(manilaDay(null), "");
});

test("deriveState: persisted Closed/Cancelled always win", () => {
  assert.equal(deriveState({ scheduledTime: at, workflowState: "Closed" }, 0), "Closed");
  assert.equal(deriveState({ scheduledTime: at, workflowState: "Cancelled" }, 9999), "Cancelled");
});

test("isChartable / isLate", () => {
  assert.equal(isChartable({ scheduledTime: at }, S), true);
  assert.equal(isChartable({ scheduledTime: at }, S - 60), false); // too early
  assert.equal(isLate({ scheduledTime: at }, S + OCCURRENCE_GRACE_MIN + 5), false, "still inside the shift");
  assert.equal(isLate({ scheduledTime: at }, AM_END), true, "charted after the shift ended");
  assert.equal(isLate(nurse, S + OCCURRENCE_GRACE_MIN + 5), true, "medication is late 30 min past its time");
  assert.equal(isLate({ scheduledTime: at, workflowState: "Closed" }, 9999), false);
});

// ── Care Delivery roll-up primitives ────────────────────────────────────────
// isMissed backs the board's completion denominator across a MULTI-DAY period, where
// deriveState alone is wrong (it compares every row to today's clock).
test("isMissed: a past care day's open row is missed regardless of the clock", () => {
  const open = { scheduledTime: "23:00" };
  assert.equal(isMissed(open, 0, -1), true, "yesterday 23:00, still open at 00:00 today");
  assert.equal(isMissed(open, 1439, 1), false, "a future care day is never missed");
  assert.equal(isMissed({ ...open, workflowState: "Closed" }, 0, -1), false, "charted, so not a miss");
  assert.equal(isMissed({ ...open, workflowState: "Cancelled" }, 0, -1), false, "withdrawn from the plan");
});

test("isMissed: today only counts as missed once the charting window has closed", () => {
  assert.equal(isMissed({ scheduledTime: at }, S, 0), false, "inside the window");
  assert.equal(isMissed({ scheduledTime: at }, AM_END - 1, 0), false, "still the caregiver's shift");
  assert.equal(isMissed({ scheduledTime: at }, AM_END, 0), true, "shift ended uncharted");
  assert.equal(isMissed(nurse, S + OCCURRENCE_GRACE_MIN + 1, 0), true, "medication window is tight");
  assert.equal(isMissed({ scheduledTime: at }, S - 120, 0), false, "not yet due");
});

test("shiftOfTime: spec shift rules (AM 06-14 / PM 14-22 / NOC 22-06)", () => {
  assert.deepEqual(["05:59", "06:00", "13:59"].map(shiftOfTime), ["NOC", "AM", "AM"]);
  assert.deepEqual(["14:00", "21:59"].map(shiftOfTime), ["PM", "PM"]);
  assert.deepEqual(["22:00", "00:00", "03:30"].map(shiftOfTime), ["NOC", "NOC", "NOC"]);
});

test("countProgress: exceptions never raise completed; Cancelled excluded from total", () => {
  const now = S;
  const rows = [
    { scheduledTime: "06:00", workflowState: "Closed", careDeliveryOutcome: "Completed as planned" },
    { scheduledTime: "07:00", workflowState: "Closed", careDeliveryOutcome: "Completed with variance" },
    { scheduledTime: "07:30", workflowState: "Closed", careDeliveryOutcome: "Not completed", exceptionReason: "Resident declined" },
    { scheduledTime: "05:00", workflowState: "Overdue", careDeliveryOutcome: null }, // past grace, open
    { scheduledTime: "09:00", workflowState: "Cancelled", careDeliveryOutcome: null },
    { scheduledTime: "06:30", workflowState: "Closed", careDeliveryOutcome: "Completed as planned", escalationState: "Pending acknowledgement" },
  ];
  const p = countProgress(rows, now);
  assert.equal(p.completed, 3, "two completed + one variance, not the exception");
  assert.equal(p.total, 5, "Cancelled excluded");
  assert.equal(p.overdue, 1, "the open past-grace row");
  assert.equal(p.pendingReview, 1);
});
