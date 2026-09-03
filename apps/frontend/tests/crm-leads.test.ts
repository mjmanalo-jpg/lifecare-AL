import assert from "node:assert/strict";
import test from "node:test";
import {
  dueBucket, followUpQueue, nextFollowUpDate, avgDaysToWin, openTasks,
  type Lead, type LeadTask,
} from "../src/lib/crmLeads.ts";

const iso = (dayOffset: number) => new Date(Date.now() + dayOffset * 86_400_000).toISOString();
const task = (o: Partial<LeadTask>): LeadTask => ({ id: o.id ?? "t", title: "call", type: "call", dueDate: o.dueDate ?? iso(0), done: o.done ?? false, ...o });
const lead = (o: Partial<Lead>): Lead => ({ id: o.id ?? "l", name: o.name ?? "Lead", stage: o.stage ?? "NEW", createdAt: o.createdAt ?? iso(-10), activity: o.activity ?? [], ...o });

test("dueBucket classifies overdue / today / upcoming / none", () => {
  assert.equal(dueBucket(iso(-2)), "overdue");
  assert.equal(dueBucket(iso(0)), "today");
  assert.equal(dueBucket(iso(3)), "upcoming");
  assert.equal(dueBucket(undefined), "none");
});

test("openTasks excludes done tasks", () => {
  const l = lead({ tasks: [task({ id: "a" }), task({ id: "b", done: true })] });
  assert.deepEqual(openTasks(l).map((t) => t.id), ["a"]);
});

test("nextFollowUpDate prefers soonest open task, falls back to legacy followUpDate", () => {
  const l = lead({ tasks: [task({ id: "a", dueDate: iso(5) }), task({ id: "b", dueDate: iso(2) })] });
  assert.equal(nextFollowUpDate(l), l.tasks![1].dueDate); // the iso(2) one
  const legacy = lead({ tasks: [], followUpDate: iso(1) });
  assert.equal(nextFollowUpDate(legacy), legacy.followUpDate);
});

test("followUpQueue flattens open tasks of open-stage leads, overdue first, skips won/lost", () => {
  const open = lead({ id: "o", stage: "CONTACTED", tasks: [task({ id: "late", dueDate: iso(-1) }), task({ id: "soon", dueDate: iso(2) })] });
  const won = lead({ id: "w", stage: "MOVE_IN", tasks: [task({ id: "ignored", dueDate: iso(-3) })] });
  const q = followUpQueue([won, open]);
  assert.deepEqual(q.map((i) => i.task.id), ["late", "soon"]); // won lead's task excluded, overdue first
  assert.equal(q[0].bucket, "overdue");
});

test("avgDaysToWin averages creation→Move-In across won leads", () => {
  const l = lead({ stage: "MOVE_IN", createdAt: iso(-20), activity: [{ at: iso(-6), by: "x", note: "Moved to Move-In (Won)", type: "stage" }] });
  assert.equal(avgDaysToWin([l]), 14);
  assert.equal(avgDaysToWin([lead({ stage: "NEW" })]), null);
});
