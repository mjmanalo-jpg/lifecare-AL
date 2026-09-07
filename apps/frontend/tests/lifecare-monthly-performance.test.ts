// SLMS v4.2 — Care Task rows + monthly Resident Daily Performance auto-check.
import test from "node:test";
import assert from "node:assert/strict";

import { activityRows, daysInMonth, checkedCells, cellKey } from "../src/lib/lifecare/monthlyPerformance.ts";

test("activityRows: one row per scheduled time; meds at two times → two rows; sorted", () => {
  const defs = [
    { id: "med", name: "Morning medication", assistanceLevel: "Setup/Cueing", responsibleRole: "Nurse", frequencyMethod: "exact_time", schedule: { times: ["08:00", "20:00"] } },
    { id: "hyg", name: "Morning hygiene", assistanceLevel: "Extensive Assist", responsibleRole: "Caregiver", frequencyMethod: "defined_window", schedule: { window: "06:30-06:45" } },
  ];
  const rows = activityRows(defs, "2026-09-07");
  assert.equal(rows.length, 3, "2 med times + 1 hygiene");
  assert.deepEqual(rows.map((r) => r.time), ["06:30", "08:00", "20:00"], "sorted by time");
  assert.equal(rows[0].activity, "Morning hygiene");
  assert.equal(rows[0].assistance, "Extensive Assist");   // display label
  assert.equal(rows[1].assistedBy, "NOD");                 // Nurse abbrev
  assert.equal(rows[1].key, "med@0800");
});

test("daysInMonth", () => {
  assert.equal(daysInMonth(2026, 9), 30);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2024, 2), 29);
});

test("checkedCells: only completed occurrences light; keyed rowKey|day in Manila", () => {
  const occs = [
    // completed on Manila 2026-09-07 (stored as prev-day 16:00Z)
    { definitionId: "med", scheduledTime: "08:00", careDate: "2026-09-06T16:00:00.000Z", careDeliveryOutcome: "Completed as planned" },
    // completed-with-variance still counts
    { definitionId: "med", scheduledTime: "20:00", careDate: "2026-09-08T16:00:00.000Z", careDeliveryOutcome: "Completed with variance" },
    // not completed → excluded
    { definitionId: "hyg", scheduledTime: "06:30", careDate: "2026-09-06T16:00:00.000Z", careDeliveryOutcome: "Not completed" },
    // different month → excluded
    { definitionId: "med", scheduledTime: "08:00", careDate: "2026-10-06T16:00:00.000Z", careDeliveryOutcome: "Completed as planned" },
  ];
  const checked = checkedCells(occs, 2026, 9);
  assert.ok(checked.has(cellKey("08:00", 7)), "8am done on the 7th");
  assert.ok(checked.has(cellKey("20:00", 9)), "8pm done on the 9th (variance counts)");
  assert.ok(!checked.has(cellKey("06:30", 7)), "not-completed excluded");
  assert.equal([...checked].filter((k) => k.startsWith("0800|")).length, 1, "October excluded (only the 7th)");
});
