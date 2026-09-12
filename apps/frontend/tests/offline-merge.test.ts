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

test("a queued command POST patches its target row instead of adding a phantom", () => {
  // /api/routine/complete takes a command payload ({occId, outcome, …}), not a row.
  // Merging that body would invent a row; prepending it would show the caregiver a
  // duplicate line for care they just charted.
  const rows = [
    { id: "r1", occId: "o1", workflowState: "Due", careDeliveryOutcome: null },
    { id: "r2", occId: "o2", workflowState: "Due", careDeliveryOutcome: null },
  ];
  const ops: OutboxOp[] = [{
    opId: "1", model: "routine-occurrences", method: "POST", url: "/api/routine/complete",
    recordId: "r1",
    body: { occId: "o1", outcome: "Completed as planned", clientOpId: "k1", chartedAt: "2026-09-12T00:04:00Z" },
    optimistic: { workflowState: "Closed", careDeliveryOutcome: "Completed as planned" },
    createdAt: 1, tries: 0,
  }];
  const out = applyOutboxToRows(rows, ops);
  assert.equal(out.length, 2, "no phantom row added");
  const r1 = out.find((r) => r.id === "r1")!;
  assert.equal(r1.workflowState, "Closed", "charted-offline row shows as closed after a reload");
  assert.equal(r1.careDeliveryOutcome, "Completed as planned");
  assert.equal(r1.occId, "o1", "existing row fields preserved");
  assert.equal(out.find((r) => r.id === "r2")!.workflowState, "Due", "other rows untouched");
  assert.equal(out.some((r) => r.outcome === "Completed as planned"), false, "command payload not merged as row data");
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

// ── single-entry delta writes (upsertSettingEntry / deleteSettingEntry) ───────
// These post { key, op, entry } with no `value`, so enqueueWrite never sets
// settingKey/wholeValue. The optimistic read used to skip them entirely, so an
// ADL entry or care-log note recorded offline vanished from the list until
// reconnect — looking like lost data and inviting a duplicate re-entry.

/** An op shaped exactly as api.ts upsertSettingEntry/deleteSettingEntry builds it. */
const deltaOp = (opId: string, key: string, op: "upsert" | "delete", entry: Record<string, unknown>): OutboxOp =>
  ({ opId, model: "app-settings", method: "POST", url: "/api/db/app-settings", body: { key, op, entry }, createdAt: Number(opId), tries: 0 });

test("applyOutboxToAppSettings shows a queued single-entry upsert (ADL / care-log note)", () => {
  const rows = [{ id: "org:comm:adl_logs", key: "adl_logs", value: JSON.stringify([{ id: "old", score: 1 }]) }];
  const out = applyOutboxToAppSettings(rows, [deltaOp("1", "adl_logs", "upsert", { id: "new", score: 4 })]);
  const entries = JSON.parse(String(out.find((r) => r.key === "adl_logs")!.value)) as { id: string; score: number }[];
  assert.deepEqual(entries.map((e) => e.id).sort(), ["new", "old"], "queued entry is visible alongside cached ones");
  assert.equal(entries.find((e) => e.id === "new")?.score, 4);
});

test("applyOutboxToAppSettings applies a queued delete and later edits of the same entry", () => {
  const rows = [{ id: "org:comm:care_log_notes", key: "care_log_notes", value: JSON.stringify([{ id: "n1", text: "first" }, { id: "n2", text: "keep" }]) }];
  const out = applyOutboxToAppSettings(rows, [
    deltaOp("1", "care_log_notes", "upsert", { id: "n1", text: "edited" }),
    deltaOp("2", "care_log_notes", "delete", { id: "n2" }),
    deltaOp("3", "care_log_notes", "upsert", { id: "n3", text: "added" }),
  ]);
  const notes = JSON.parse(String(out.find((r) => r.key === "care_log_notes")!.value)) as { id: string; text: string }[];
  assert.equal(notes.find((n) => n.id === "n1")?.text, "edited", "later edit wins");
  assert.equal(notes.find((n) => n.id === "n2"), undefined, "queued delete applied");
  assert.equal(notes.find((n) => n.id === "n3")?.text, "added");
});

test("applyOutboxToAppSettings creates the key row when nothing is cached yet", () => {
  const out = applyOutboxToAppSettings([], [deltaOp("1", "weight_logs", "upsert", { id: "w1", kg: 62 })]);
  const row = out.find((r) => r.key === "weight_logs");
  assert.ok(row, "first-ever offline entry still renders");
  assert.deepEqual(JSON.parse(String(row!.value)), [{ id: "w1", kg: 62 }]);
});

test("applyOutboxToAppSettings ignores malformed delta ops instead of corrupting the row", () => {
  const rows = [{ id: "org:comm:adl_logs", key: "adl_logs", value: JSON.stringify([{ id: "keep" }]) }];
  const out = applyOutboxToAppSettings(rows, [
    { opId: "1", model: "app-settings", method: "POST", url: "", body: { key: "adl_logs", op: "upsert" }, createdAt: 1, tries: 0 },        // no entry
    { opId: "2", model: "app-settings", method: "POST", url: "", body: { key: "adl_logs", op: "upsert", entry: {} }, createdAt: 2, tries: 0 }, // entry has no id
    { opId: "3", model: "app-settings", method: "POST", url: "", body: { op: "upsert", entry: { id: "x" } }, createdAt: 3, tries: 0 },      // no key
  ]);
  assert.deepEqual(JSON.parse(String(out.find((r) => r.key === "adl_logs")!.value)), [{ id: "keep" }]);
});
