import test from "node:test";
import assert from "node:assert/strict";

import {
  compareQueueItems, priorityForEscalation, priorityForIncident,
  priorityForTask, stateForPriority,
} from "../src/lib/dashboard/priority.ts";

const now = new Date("2026-08-22T08:00:00.000Z");

test("clinical source severities map deterministically to P1-P4", () => {
  assert.equal(priorityForIncident("CRITICAL"), "P1");
  assert.equal(priorityForIncident("SEVERE"), "P2");
  assert.equal(priorityForIncident("MODERATE"), "P3");
  assert.equal(priorityForIncident("MINOR"), "P4");
  assert.equal(priorityForEscalation("EMERGENCY"), "P1");
  assert.equal(priorityForEscalation("URGENT"), "P2");
  assert.equal(priorityForEscalation("ROUTINE"), "P3");
});

test("due state elevates overdue and time-critical work", () => {
  assert.equal(priorityForTask("URGENT", new Date("2026-08-22T07:59:00.000Z"), now), "P1");
  assert.equal(priorityForTask("NORMAL", new Date("2026-08-22T07:59:00.000Z"), now), "P2");
  assert.equal(priorityForTask("NORMAL", new Date("2026-08-22T09:00:00.000Z"), now), "P3");
  assert.equal(priorityForTask("NORMAL", new Date("2026-08-22T15:00:00.000Z"), now), "P4");
});

test("clinical state and sorting use policy rather than JSX color", () => {
  assert.equal(stateForPriority("P1"), "ESCALATED");
  assert.equal(stateForPriority("P3"), "WATCH");
  assert.equal(stateForPriority("P4"), "STABLE");
  const rows = [
    { priority: "P3" as const, dueAt: "2026-08-22T08:30:00.000Z" },
    { priority: "P1" as const, dueAt: "2026-08-22T09:00:00.000Z" },
    { priority: "P3" as const, dueAt: "2026-08-22T08:15:00.000Z" },
  ].sort(compareQueueItems);
  assert.deepEqual(rows.map((row) => row.priority + ":" + row.dueAt.slice(11, 16)), ["P1:09:00", "P3:08:15", "P3:08:30"]);
});
