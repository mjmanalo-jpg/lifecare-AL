// Pure merge/diff logic for the offline outbox. Kept dependency-free so it is
// unit-testable in Node (no IndexedDB / DOM).

import type { ItemOp, OutboxOp, Rec } from "./types.ts";

const idOf = (x: unknown): string => {
  const r = x as Rec | null;
  const v = r && (r.id ?? r.key);
  return v == null ? "" : String(v);
};

/**
 * Diff two app-settings JSON arrays by item `id`, producing the item-level ops
 * needed to turn `prev` into `next`. Used at enqueue time to capture WHAT the
 * offline user changed, so sync can merge those changes into the current server
 * array instead of overwriting it (which would clobber others' concurrent edits).
 */
export function diffArrayById(prev: unknown[], next: unknown[]): ItemOp[] {
  const prevById = new Map<string, Rec>();
  for (const x of prev) { const id = idOf(x); if (id) prevById.set(id, x as Rec); }
  const nextById = new Map<string, Rec>();
  for (const x of next) { const id = idOf(x); if (id) nextById.set(id, x as Rec); }

  const ops: ItemOp[] = [];
  for (const [id, item] of nextById) {
    const p = prevById.get(id);
    if (!p || JSON.stringify(p) !== JSON.stringify(item)) ops.push({ op: "upsert", id, item });
  }
  for (const id of prevById.keys()) {
    if (!nextById.has(id)) ops.push({ op: "delete", id });
  }
  return ops;
}

/**
 * Apply item-level ops onto a base array (the current server value), merging by
 * id: upserts replace/add, deletes remove; untouched items are preserved.
 */
export function applyItemOps(base: unknown[], ops: ItemOp[]): Rec[] {
  const byId = new Map<string, Rec>();
  for (const x of base) { const id = idOf(x); if (id) byId.set(id, x as Rec); }
  for (const op of ops) {
    if (op.op === "delete") byId.delete(op.id);
    else if (op.item) byId.set(op.id, op.item);
  }
  return Array.from(byId.values());
}

/** Whether an id-keyed diff is reliable (both arrays fully id-keyed). */
export function isDiffable(prev: unknown[], next: unknown[]): boolean {
  return [...prev, ...next].every((x) => idOf(x) !== "");
}

/**
 * Optimistic read: fold pending row-level ops (for one model) into a fetched/
 * cached row set so the UI reflects queued offline writes immediately.
 */
export function applyOutboxToRows(rows: Rec[], ops: OutboxOp[]): Rec[] {
  let out = rows.slice();
  for (const op of ops) {
    if (op.method === "POST" && op.body) {
      const id = idOf(op.body);
      if (!id || !out.some((r) => idOf(r) === id)) out = [op.body, ...out];
      else out = out.map((r) => (idOf(r) === id ? { ...r, ...op.body } : r));
    } else if (op.method === "PATCH" && op.recordId) {
      out = out.map((r) => (idOf(r) === op.recordId ? { ...r, ...(op.body ?? {}) } : r));
    } else if (op.method === "DELETE" && op.recordId) {
      out = out.filter((r) => idOf(r) !== op.recordId);
    }
  }
  return out;
}

/**
 * Optimistic read for the app-settings model: patch each affected key row with
 * the queued whole value so a board re-reading app-settings sees its own save.
 */
export function applyOutboxToAppSettings(rows: Rec[], ops: OutboxOp[]): Rec[] {
  let out = rows.slice();
  for (const op of ops) {
    if (op.model !== "app-settings" || !op.settingKey || op.wholeValue == null) continue;
    const idx = out.findIndex((r) => (r.key ?? r.id) === op.settingKey);
    if (idx >= 0) out[idx] = { ...out[idx], value: op.wholeValue };
    else out = [...out, { id: op.settingKey, key: op.settingKey, value: op.wholeValue }];
  }
  return out;
}
