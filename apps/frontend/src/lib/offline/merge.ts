// Pure merge/diff logic for the offline outbox. Kept dependency-free so it is
// unit-testable in Node (no IndexedDB / DOM).

import type { ItemOp, OutboxOp, Rec } from "./types.ts";

const idOf = (x: unknown): string => {
  const r = x as Rec | null;
  const v = r && (r.id ?? r.key);
  return v == null ? "" : String(v);
};

/** Parse an app-settings `value` (JSON string) as an array; [] when unusable. */
export function parseArray(raw: unknown): unknown[] {
  if (typeof raw !== "string" || !raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
}

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
    // A POST that names an existing record is a COMMAND against that row (a custom
    // route such as /api/routine/complete), not a create. Merge its optimistic
    // patch in — never prepend it, which would render a phantom duplicate row.
    if (op.method === "POST" && op.recordId) {
      const patch = op.optimistic ?? {};
      out = out.map((r) => (idOf(r) === op.recordId ? { ...r, ...patch } : r));
    } else if (op.method === "POST" && op.body) {
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

/** Fold one queued app-settings op into `out`, returning the updated rows. */
function patchSettingRow(out: Rec[], key: string, nextValue: string): Rec[] {
  const idx = out.findIndex((r) => (r.key ?? r.id) === key);
  if (idx < 0) return [...out, { id: key, key, value: nextValue }];
  const copy = out.slice();
  copy[idx] = { ...copy[idx], value: nextValue };
  return copy;
}

/**
 * Optimistic read for the app-settings model, covering BOTH write shapes:
 *
 *  - whole-array writes (upsertRecord("app-settings", …)) carry `settingKey` +
 *    `wholeValue`, set at enqueue time;
 *  - single-entry delta writes (upsertSettingEntry/deleteSettingEntry) post
 *    `{ key, op, entry }` with no `value`, so enqueueWrite never populates
 *    settingKey/wholeValue. Those must be replayed onto the cached array here or
 *    the caregiver's own offline entry vanishes from the list until reconnect —
 *    which reads as data loss and invites a duplicate re-entry.
 */
export function applyOutboxToAppSettings(rows: Rec[], ops: OutboxOp[]): Rec[] {
  let out = rows.slice();
  for (const op of ops) {
    if (op.model !== "app-settings") continue;

    if (op.settingKey && op.wholeValue != null) {
      out = patchSettingRow(out, op.settingKey, op.wholeValue);
      continue;
    }

    const body = op.body;
    const key = body?.key == null ? "" : String(body.key);
    const kind = body?.op;
    const entry = body?.entry as Rec | undefined;
    const entryId = entry?.id == null ? "" : String(entry.id);
    if (!key || !entryId || (kind !== "upsert" && kind !== "delete")) continue;

    const current = out.find((r) => (r.key ?? r.id) === key);
    const next = applyItemOps(
      parseArray(current?.value),
      [kind === "delete" ? { op: "delete", id: entryId } : { op: "upsert", id: entryId, item: entry }],
    );
    out = patchSettingRow(out, key, JSON.stringify(next));
  }
  return out;
}
