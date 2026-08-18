// Offline outbox — anti-clobber merge/diff tests.
import test from "node:test";
import assert from "node:assert/strict";

import { diffArrayById, applyItemOps, isDiffable, applyOutboxToRows, applyOutboxToAppSettings } from "../src/lib/offline/merge.ts";
import type { OutboxOp } from "../src/lib/offline/types.ts";

test("diffArrayById captures new, changed and deleted items", () => {
  const prev = [{ id: "a", v: 1 }, { id: "b", v: 2 }, { id: "c", v: 3 }];
  const next = [{ id: "a", v: 1 }, { id: "b", v: 20 }, { id: "d", v: 4 }]; // b changed, c deleted, d added
  const ops = diffArrayById(prev, next);
  assert.deepEqual(ops.find((o) => o.id === "b"), { op: "upsert", id: "b", item: { id: "b", v: 20 } });
  assert.deepEqual(ops.find((o) => o.id === "d"), { op: "upsert", id: "d", item: { id: "d", v: 4 } });
  assert.deepEqual(ops.find((o) => o.id === "c"), { op: "delete", id: "c" });
  assert.equal(ops.find((o) => o.id === "a"), undefined); // unchanged → no op
});

test("applyItemOps merges offline changes WITHOUT clobbering concurrent server edits", () => {
  // Server, meanwhile, gained item "e" and edited "a" while we were offline.
  const server = [{ id: "a", v: 99 }, { id: "b", v: 2 }, { id: "c", v: 3 }, { id: "e", v: 5 }];
  // Our offline diff: change b, delete c, add d.
  const ops = diffArrayById([{ id: "b", v: 2 }, { id: "c", v: 3 }], [{ id: "b", v: 20 }, { id: "d", v: 4 }]);
  const merged = applyItemOps(server, ops);
  const byId = Object.fromEntries(merged.map((m) => [m.id, m]));
  assert.equal(byId.b.v, 20, "our b change applied");
  assert.equal(byId.d.v, 4, "our d added");
  assert.equal(byId.c, undefined, "our c delete applied");
  assert.equal(byId.a.v, 99, "server's concurrent a edit PRESERVED (not clobbered)");
  assert.equal(byId.e.v, 5, "server's concurrent new item e PRESERVED");
});

test("isDiffable flags arrays that lack ids", () => {
  assert.equal(isDiffable([{ id: "a" }], [{ id: "b" }]), true);
  assert.equal(isDiffable([{ foo: 1 }], [{ id: "b" }]), false);
});

test("applyOutboxToRows folds queued creates/updates/deletes for optimistic read", () => {
  const rows = [{ id: "t1", status: "PENDING" }, { id: "t2", status: "PENDING" }];
  const ops: OutboxOp[] = [
    { opId: "1", model: "tasks", method: "POST", url: "", body: { id: "t3", status: "PENDING" }, createdAt: 0, tries: 0 },
    { opId: "2", model: "tasks", method: "PATCH", url: "", recordId: "t1", body: { status: "COMPLETED" }, createdAt: 0, tries: 0 },
    { opId: "3", model: "tasks", method: "DELETE", url: "", recordId: "t2", createdAt: 0, tries: 0 },
  ];
  const out = applyOutboxToRows(rows, ops);
  const byId = Object.fromEntries(out.map((r) => [r.id, r]));
  assert.ok(byId.t3, "queued create appears");
  assert.equal(byId.t1.status, "COMPLETED", "queued update applied");
  assert.equal(byId.t2, undefined, "queued delete applied");
});

test("applyOutboxToAppSettings patches the affected key with the queued value", () => {
  const rows = [{ id: "org:comm:assessments_v42", key: "assessments_v42", value: "[]" }];
  const ops: OutboxOp[] = [
    { opId: "1", model: "app-settings", method: "POST", url: "", settingKey: "assessments_v42", wholeValue: '[{"id":"a"}]', createdAt: 0, tries: 0 },
    { opId: "2", model: "app-settings", method: "POST", url: "", settingKey: "loc_history", wholeValue: '[{"id":"h"}]', createdAt: 0, tries: 0 },
  ];
  const out = applyOutboxToAppSettings(rows, ops);
  assert.equal(out.find((r) => r.key === "assessments_v42")?.value, '[{"id":"a"}]');
  assert.ok(out.find((r) => r.key === "loc_history"), "missing key row is added");
});
