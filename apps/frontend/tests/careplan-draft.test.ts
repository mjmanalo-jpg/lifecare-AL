// Care-plan draft store — parse tolerance + package-authoritative merge.
import test from "node:test";
import assert from "node:assert/strict";

import {
  parseCarePlanDrafts,
  upsertDraft,
  clearDraft,
  mergeSavedIntoTasks,
  toSavedItems,
  type DraftState,
  type SavedTaskItem,
} from "../src/lib/carePlanDraft.ts";

const draft = (over: Partial<DraftState> = {}): DraftState => ({
  level: 2,
  goals: ["Stay independent"],
  items: [{ taskId: "MOB-101", included: true, assistance: "SBA", freq: "Daily", note: "slow pace" }],
  updatedAt: "2026-08-28T00:00:00Z",
  ...over,
});

test("parse tolerates junk / legacy shapes", () => {
  assert.deepEqual(parseCarePlanDrafts(undefined), {});
  assert.deepEqual(parseCarePlanDrafts("not json"), {});
  assert.deepEqual(parseCarePlanDrafts("[]"), {}); // array, not a map
  assert.deepEqual(parseCarePlanDrafts(JSON.stringify({ r1: { level: 2 } })), {}); // no items array
});

test("parse round-trips a valid draft and defaults missing fields", () => {
  const raw = JSON.stringify({
    r1: { level: 4, goals: ["g"], items: [{ taskId: "T1" }], updatedAt: "x" },
  });
  const m = parseCarePlanDrafts(raw);
  assert.equal(m.r1.level, 4);
  assert.deepEqual(m.r1.items[0], { taskId: "T1", included: true, assistance: "", freq: "Daily", note: "" });
});

test("upsert / clear are immutable", () => {
  const a: Record<string, DraftState> = {};
  const b = upsertDraft(a, "r1", draft());
  assert.equal(Object.keys(a).length, 0);
  assert.ok(b.r1);
  const c = clearDraft(b, "r1");
  assert.equal(Object.keys(c).length, 0);
  assert.ok(b.r1, "clear did not mutate source");
});

test("merge overlays editable fields, level list stays authoritative", () => {
  // Base = the current Level package (defaults). Saved has an edit for MOB-101,
  // a retired task no longer in the package (GONE), and is missing a new one.
  const base: SavedTaskItem[] = [
    { taskId: "MOB-101", included: true, assistance: "", freq: "Daily", note: "" },
    { taskId: "MOB-999-NEW", included: true, assistance: "", freq: "Daily", note: "" },
  ];
  const saved = draft({
    items: [
      { taskId: "MOB-101", included: false, assistance: "Max", freq: "Weekly", note: "hoist" },
      { taskId: "GONE", included: true, assistance: "T", freq: "Daily", note: "x" },
    ],
  });
  const merged = mergeSavedIntoTasks(base, saved);
  assert.equal(merged.length, 2, "only package tasks survive");
  // MOB-101 gets the nurse's edits back
  assert.deepEqual(merged[0], { taskId: "MOB-101", included: false, assistance: "Max", freq: "Weekly", note: "hoist" });
  // New package task keeps defaults (included)
  assert.equal(merged[1].included, true);
  // Retired "GONE" task is dropped
  assert.ok(!merged.some((i) => i.taskId === "GONE"));
});

test("merge with no saved snapshot returns base unchanged", () => {
  const base: SavedTaskItem[] = [{ taskId: "A", included: true, assistance: "", freq: "Daily", note: "" }];
  assert.equal(mergeSavedIntoTasks(base, null), base);
  assert.equal(mergeSavedIntoTasks(base, draft({ items: [] })), base);
});

test("toSavedItems drops derived fields", () => {
  const full = [{ taskId: "A", included: true, assistance: "SBA", freq: "Daily", note: "n", name: "x", domain: "d" }];
  assert.deepEqual(toSavedItems(full), [{ taskId: "A", included: true, assistance: "SBA", freq: "Daily", note: "n" }]);
});
