import test from "node:test";
import assert from "node:assert/strict";

import { carePlanReleaseIssues } from "../src/lib/lifecare/carePlanRelease.ts";

const validPlan = () => ({
  status: "DRAFT",
  careGoals: "Maintain safe independence.",
  carePlanItems: [{
    title: "Transfer support",
    status: "ACTIVE",
    description: "Frequency: Every shift · Individualized: Assistance: Minimal · Preferred device and pace · Role: Caregiver [task:TASK-MOB-01]",
  }],
});

test("an individualized draft with approver, effective date and review date can activate", () => {
  assert.deepEqual(carePlanReleaseIssues(validPlan(), {
    approvedByName: "Nurse Reviewer",
    effectiveDate: "2026-08-22",
    nextReviewDate: "2026-11-22",
  }), []);
});

test("an auto-generated but unindividualized assessment draft cannot activate", () => {
  const plan = validPlan();
  plan.carePlanItems[0].description = "Task TASK-MOB-01 [task:TASK-MOB-01]";
  const issues = carePlanReleaseIssues(plan, { approvedByName: "Nurse Reviewer", effectiveDate: "2026-08-22", nextReviewDate: "2026-11-22" });
  assert.ok(issues.some((issue) => /frequency/i.test(issue)));
  assert.ok(issues.some((issue) => /resident-specific/i.test(issue)));
});

test("release requires a future review date and a governed task marker", () => {
  const plan = validPlan();
  plan.carePlanItems[0].description = plan.carePlanItems[0].description.replace(/ \[task:[^\]]+\]/, "");
  const issues = carePlanReleaseIssues(plan, { approvedByName: "Nurse Reviewer", effectiveDate: "2026-08-22", nextReviewDate: "2026-08-22" });
  assert.ok(issues.some((issue) => /after the effective date/i.test(issue)));
  assert.ok(issues.some((issue) => /Care Task ID/i.test(issue)));
});
