// Phase 3 verify — reproduce the workbook's R05-105 "Today's Care" shift view
// from the approved care plan: bundling + role split + COC break-out.
import test from "node:test";
import assert from "node:assert/strict";

import { generateDraftPlan } from "../src/lib/lifecare/carePlan.ts";
import { materialiseShiftView, splitByRole, isTemporaryCoc } from "../src/lib/lifecare/todaysCare.ts";
import type { DraftCarePlan } from "../src/lib/lifecare/carePlan.ts";

// Build the R05-105 approved plan (11 lines) with the documented modifiers so
// the temporary COC line (TASK-CLN-02, MLR-015) breaks out standalone.
function r05ApprovedPlan(): DraftCarePlan {
  const draft = generateDraftPlan({
    finalLevel: "L3",
    lines: [
      { taskId: "TASK-ADL-01" },
      { taskId: "TASK-MOB-02", precautions: "HIGH FALL RISK; right weakness/spasticity; slow pace." },
      { taskId: "TASK-FALL-01" },
      { taskId: "TASK-SKN-01" },
      { taskId: "TASK-SKN-02" },
      { taskId: "NUT-201" },
      { taskId: "NUT-204" },
      { taskId: "TASK-MED-01" },
      { taskId: "TASK-MED-02" },
      { taskId: "TASK-CLN-01" },
      { taskId: "TASK-CLN-02", sourceModifierMlr: "MOD-CLN-01; MLR-015", reviewStopDate: "When physician-directed COC monitoring ends" },
    ],
  });
  return { ...draft, status: "APPROVED" };
}

test("no shift view is produced from a non-approved plan (governance)", () => {
  const draft = generateDraftPlan({ finalLevel: "L3", lines: [{ taskId: "TASK-ADL-01" }] });
  assert.equal(materialiseShiftView(draft).length, 0); // DRAFT
});

test("R05 BND-AM bundles morning ADL + mobility + fall for the Caregiver", () => {
  const view = materialiseShiftView(r05ApprovedPlan());
  const am = view.find((e) => e.bundle === "BND-AM");
  assert.ok(am, "BND-AM present");
  assert.equal(am!.role, "Caregiver");
  assert.deepEqual(am!.taskIds, ["TASK-ADL-01", "TASK-MOB-02", "TASK-FALL-01"]);
});

test("R05 continence/skin, meals, mobility, and RN bundles materialise correctly", () => {
  const view = materialiseShiftView(r05ApprovedPlan());
  const by = Object.fromEntries(view.map((e) => [e.bundle, e]));

  assert.deepEqual(by["BND-BR"].taskIds, ["TASK-SKN-01", "TASK-SKN-02"]);
  assert.equal(by["BND-BR"].role, "Caregiver");

  assert.deepEqual(by["BND-MEAL"].taskIds, ["NUT-201", "NUT-204"]);

  // TASK-MOB-02 + TASK-FALL-01 also appear in the mobility-transitions bundle.
  assert.deepEqual(by["BND-MOB"].taskIds, ["TASK-MOB-02", "TASK-FALL-01"]);

  // Nurse queue: medications + ordered monitoring (not the temporary COC line).
  assert.deepEqual(by["BND-RN"].taskIds, ["TASK-MED-01", "TASK-MED-02", "TASK-CLN-01"]);
  assert.equal(by["BND-RN"].role, "Nurse");
});

test("temporary change-of-condition (TASK-CLN-02, MLR-015) breaks out standalone", () => {
  const plan = r05ApprovedPlan();
  const cocLine = plan.lines.find((l) => l.taskId === "TASK-CLN-02")!;
  assert.equal(isTemporaryCoc(cocLine), true);

  const view = materialiseShiftView(plan);
  const coc = view.find((e) => e.bundle === "COC");
  assert.ok(coc, "COC encounter present");
  assert.equal(coc!.temporary, true);
  assert.deepEqual(coc!.taskIds, ["TASK-CLN-02"]);
  // and it must NOT be bundled into BND-RN
  const rn = view.find((e) => e.bundle === "BND-RN")!;
  assert.ok(!rn.taskIds.includes("TASK-CLN-02"));
});

test("role split yields Caregiver and Nurse queues", () => {
  const view = materialiseShiftView(r05ApprovedPlan());
  const { Caregiver, Nurse } = splitByRole(view);
  assert.ok(Caregiver.some((e) => e.bundle === "BND-AM"));
  assert.ok(Nurse.some((e) => e.bundle === "BND-RN"));
  assert.ok(Nurse.some((e) => e.bundle === "COC"));
});

test("BND-AM carries combined precautions and expected events", () => {
  const view = materialiseShiftView(r05ApprovedPlan());
  const am = view.find((e) => e.bundle === "BND-AM")!;
  assert.ok(am.precautions.some((p) => /FALL RISK/i.test(p)));
  assert.ok(am.expectedEvents.length > 0);
});
