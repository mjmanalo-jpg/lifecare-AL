// Phase 2 verify — reproduce the workbook's R05-105 sample plan (11 active
// lines) from the Care Task Master, with locked approved text.
import test from "node:test";
import assert from "node:assert/strict";

import { generateDraftPlan, suggestTaskIds, STANDARD_EXCEPTION_RULE } from "../src/lib/lifecare/carePlan.ts";
import { taskById } from "../src/lib/lifecare/dataset.ts";
import type { DomainScores } from "../src/lib/lifecare/types.ts";

// The 11 active Task IDs from the documented R05-105 plan, in order.
const R05_TASK_IDS = [
  "TASK-ADL-01", "TASK-MOB-02", "TASK-FALL-01", "TASK-SKN-01", "TASK-SKN-02",
  "NUT-201", "NUT-204", "TASK-MED-01", "TASK-MED-02", "TASK-CLN-01", "TASK-CLN-02",
];

test("all R05 task IDs resolve in the Care Task Master", () => {
  for (const id of R05_TASK_IDS) assert.ok(taskById(id), `missing ${id}`);
});

test("R05-105 regenerates exactly 11 DRAFT lines in order", () => {
  const plan = generateDraftPlan({
    finalLevel: "L3",
    createdBy: "TEST",
    lines: R05_TASK_IDS.map((taskId) => ({ taskId })),
  });
  assert.equal(plan.status, "DRAFT");
  assert.equal(plan.finalLevel, "L3");
  assert.equal(plan.lines.length, 11);
  assert.deepEqual(plan.lines.map((l) => l.taskId), R05_TASK_IDS);
  assert.deepEqual(plan.lines.map((l) => l.line), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test("approved Need/Goal/Intervention are pulled LOCKED from the master (documented R05 text)", () => {
  const plan = generateDraftPlan({ finalLevel: "L3", lines: R05_TASK_IDS.map((taskId) => ({ taskId })) });
  const l1 = plan.lines[0];
  // Line 1 — TASK-ADL-01 — exact documented approved text from the workbook.
  assert.equal(l1.approvedNeed, "Resident requires support with adl assistance based on assessed functional, cognitive, safety or clinical need.");
  assert.equal(l1.approvedIntervention, "Provide cueing/setup/physical assistance according to assessed ability.");
  // Every line carries non-empty locked library text and the standard exception rule.
  for (const l of plan.lines) {
    assert.ok(l.approvedNeed.length > 0, `${l.taskId} need`);
    assert.ok(l.approvedGoal.length > 0, `${l.taskId} goal`);
    assert.ok(l.approvedIntervention.length > 0, `${l.taskId} intervention`);
    assert.equal(l.exceptionRule, STANDARD_EXCEPTION_RULE);
    assert.ok(l.expectedCareEvent.length > 0, `${l.taskId} expected event`);
  }
});

test("nurse individualisation is applied on top of locked text", () => {
  const plan = generateDraftPlan({
    finalLevel: "L3",
    lines: [{ taskId: "TASK-ADL-01", assistanceLevel: "Minimal Assist", frequency: "Daily / PRN", residentGoal: "Preserve independence; do safely what she can.", sourceModifierMlr: "MLR-006" }],
  });
  const l = plan.lines[0];
  assert.equal(l.assistanceLevel, "Minimal Assist");
  assert.equal(l.frequency, "Daily / PRN");
  assert.equal(l.sourceModifierMlr, "MLR-006");
  // locked text still intact
  assert.match(l.approvedNeed, /adl assistance/);
});

test("unknown Task IDs are rejected — a plan never invents a task", () => {
  assert.throws(() => generateDraftPlan({ finalLevel: "L2", lines: [{ taskId: "TASK-DOES-NOT-EXIST" }] }), /unknown Task ID/);
});

test("inactive lines are excluded", () => {
  const plan = generateDraftPlan({
    finalLevel: "L2",
    lines: [{ taskId: "TASK-ADL-01" }, { taskId: "TASK-MOB-02", active: false }],
  });
  assert.equal(plan.lines.length, 1);
  assert.equal(plan.lines[0].taskId, "TASK-ADL-01");
});

test("suggestTaskIds maps active domains to candidate tasks (advisory)", () => {
  const scores: DomainScores = { "AS-01": 3, "AS-02": 2, "AS-08": 2 };
  const ids = suggestTaskIds(scores);
  assert.ok(ids.includes("TASK-ADL-01"));
  assert.ok(ids.includes("TASK-MOB-01"));
  assert.ok(ids.includes("TASK-NUT-01"));
  assert.ok(!ids.includes("TASK-COG-01"), "cognition not active → not suggested");
});
