import test from "node:test";
import assert from "node:assert/strict";
import { buildJourney } from "../src/lib/residentJourney.ts";

// The aggregator is pure: feed one resident's raw rows, assert the new sources
// (care plan doc, tasks, call bells, service requests) become journey events.
const RID = "R1";

test("care plan document surfaces under CARE_PLAN", () => {
  const j = buildJourney({
    residentId: RID,
    carePlans: [{ id: "cp1", residentId: RID, title: "Individualized Plan", status: "ACTIVE", startDate: "2026-08-01", careGoals: "Maintain mobility" }],
  });
  const e = j.find((x) => x.id === "careplan-doc:cp1");
  assert.ok(e, "care plan event present");
  assert.equal(e!.category, "CARE_PLAN");
  assert.match(e!.title, /Individualized Plan/);
  assert.equal(e!.status, "Active");
});

test("only COMPLETED tasks are recorded; pending ones are excluded", () => {
  const j = buildJourney({
    residentId: RID,
    tasks: [
      { id: "t1", residentId: RID, title: "Bathing", status: "COMPLETED", dueDate: "2026-08-28T08:00:00Z", completedAt: "2026-08-28T09:15:00Z" },
      { id: "t2", residentId: RID, title: "Ambulation", status: "PENDING", dueDate: "2026-08-28T16:00:00Z" },
    ],
  });
  const done = j.find((x) => x.id === "task:t1");
  assert.ok(done, "completed task present");
  assert.equal(done!.category, "TASK");
  assert.equal(done!.date, "2026-08-28T09:15:00Z"); // anchored to completedAt
  assert.equal(done!.status, "Completed");
  assert.equal(j.find((x) => x.id === "task:t2"), undefined); // pending excluded
});

test("call bells and service requests surface", () => {
  const j = buildJourney({
    residentId: RID,
    callBells: [{ id: "b1", residentId: RID, status: "RESOLVED", reason: "Assistance", createdAt: "2026-08-28T07:00:00Z" }],
    serviceRequests: [{ id: "sr1", residentId: RID, category: "HOUSEKEEPING", status: "OPEN", details: "Fresh linens", createdAt: "2026-08-28T06:00:00Z" }],
  });
  const bell = j.find((x) => x.id === "callbell:b1")!;
  const req = j.find((x) => x.id === "svcreq:sr1")!;
  assert.equal(bell.category, "CALL_BELL");
  assert.match(bell.title, /Assistance/);
  assert.equal(req.category, "REQUEST");
  assert.match(req.title, /Housekeeping/);
});

test("rows for other residents are excluded", () => {
  const j = buildJourney({
    residentId: RID,
    tasks: [{ id: "t9", residentId: "OTHER", title: "Not mine", status: "COMPLETED", dueDate: "2026-08-28T08:00:00Z", completedAt: "2026-08-28T08:00:00Z" }],
  });
  assert.equal(j.length, 0);
});
