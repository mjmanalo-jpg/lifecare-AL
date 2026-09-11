// Alert auto-resolve: an alert is keyed by (relatedEntityType, relatedEntityId).
// The routine keys carry a prefix over the occId, so raise and clear MUST agree
// on that encoding — if they drift, closed occurrences keep alerting forever.
import test from "node:test";
import assert from "node:assert/strict";

import { routineAlertKeys, occIdFromRoutineAlertKey, SETTLED_TASK_STATUS } from "../src/lib/alertAccess.ts";

test("routine alert keys match the ids /api/cron/alerts raises", () => {
  // Mirrors `notify(..., \`routinedue:${o.occId}\`)` / `routinelate:${o.occId}`.
  assert.deepEqual(routineAlertKeys("occ-1"), ["routinedue:occ-1", "routinelate:occ-1"]);
});

test("every raised key round-trips back to its occId", () => {
  const occId = "2026-09-01:arthur:15:00";
  for (const key of routineAlertKeys(occId)) {
    assert.equal(occIdFromRoutineAlertKey(key), occId);
  }
});

test("only the leading prefix is stripped", () => {
  assert.equal(occIdFromRoutineAlertKey("routinelate:a:routinedue:b"), "a:routinedue:b");
  assert.equal(occIdFromRoutineAlertKey("plain-id"), "plain-id");
});

test("a task alert is stale once the task leaves the outstanding states", () => {
  assert.equal(SETTLED_TASK_STATUS.has("COMPLETED"), true);
  assert.equal(SETTLED_TASK_STATUS.has("CANCELLED"), true);
  assert.equal(SETTLED_TASK_STATUS.has("PENDING"), false);
  assert.equal(SETTLED_TASK_STATUS.has("IN_PROGRESS"), false); // still outstanding — keep alerting
});
