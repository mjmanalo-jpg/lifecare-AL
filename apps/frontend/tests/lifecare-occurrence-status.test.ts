// SLMS v4.2 caregiver occurrence status (#4) — pure display-state derivation.
import test from "node:test";
import assert from "node:assert/strict";

import { deriveState, isChartable, isLate, countProgress, WINDOW_LEAD_MIN, OCCURRENCE_GRACE_MIN } from "../src/lib/lifecare/occurrenceStatus.ts";

const at = "08:00"; // 480 min
const S = 480;

test("deriveState: lead/grace boundaries around the scheduled time", () => {
  assert.equal(deriveState({ scheduledTime: at }, S - WINDOW_LEAD_MIN - 1), "Upcoming");
  assert.equal(deriveState({ scheduledTime: at }, S - WINDOW_LEAD_MIN), "Due");     // opens at lead
  assert.equal(deriveState({ scheduledTime: at }, S), "Due");
  assert.equal(deriveState({ scheduledTime: at }, S + OCCURRENCE_GRACE_MIN), "Due"); // last Due minute
  assert.equal(deriveState({ scheduledTime: at }, S + OCCURRENCE_GRACE_MIN + 1), "Overdue");
});

test("deriveState: persisted Closed/Cancelled always win", () => {
  assert.equal(deriveState({ scheduledTime: at, workflowState: "Closed" }, 0), "Closed");
  assert.equal(deriveState({ scheduledTime: at, workflowState: "Cancelled" }, 9999), "Cancelled");
});

test("isChartable / isLate", () => {
  assert.equal(isChartable({ scheduledTime: at }, S), true);
  assert.equal(isChartable({ scheduledTime: at }, S - 60), false); // too early
  assert.equal(isLate({ scheduledTime: at }, S + OCCURRENCE_GRACE_MIN + 5), true);
  assert.equal(isLate({ scheduledTime: at, workflowState: "Closed" }, 9999), false);
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
