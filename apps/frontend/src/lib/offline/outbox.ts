// The offline outbox: storage + op construction. Which models are eligible for
// offline queueing (the high-value clinical writes), how a queued op is built
// (row-level vs app-settings item-diff), and basic queue accessors.

import { OUTBOX_STORE, idbGetAll, idbPut, idbDelete } from "./idb.ts";
import { readAppSettingSnapshot } from "./cache.ts";
import { diffArrayById, isDiffable } from "./merge.ts";
import type { HttpMethod, OutboxOp, Rec } from "./types.ts";

/** Clinical / high-value models whose writes are queued offline (v1 scope). */
export const OFFLINE_MODELS = new Set<string>([
  "app-settings",
  "tasks",
  "care-events",
  "daily-rounds",
  "bowel-records", "urine-records", "edema-records", "concern-records",
  "pain-records", "mood-records", "round-sleep-records", "mobility-records",
  "meal-records", "vital-signs",
  "medication-administrations",
  "incidents", "escalations",
]);

export const isOfflineModel = (model: string): boolean => OFFLINE_MODELS.has(model);

const uuid = () => (globalThis.crypto?.randomUUID?.() ?? `op-${Date.now()}-${Math.floor(Math.random() * 1e9)}`);

function parseArray(raw: string | null | undefined): unknown[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** All queued ops, oldest first (replay order). */
export async function allOps(): Promise<OutboxOp[]> {
  const ops = await idbGetAll<OutboxOp>(OUTBOX_STORE);
  return ops.sort((a, b) => a.createdAt - b.createdAt);
}

export async function pendingCount(): Promise<number> {
  return (await idbGetAll<OutboxOp>(OUTBOX_STORE)).length;
}

export async function pendingForModel(model: string): Promise<OutboxOp[]> {
  return (await allOps()).filter((o) => o.model === model);
}

export async function putOp(op: OutboxOp): Promise<void> { await idbPut(OUTBOX_STORE, op); }
export async function removeOp(opId: string): Promise<void> { await idbDelete(OUTBOX_STORE, opId); }

/**
 * Build + persist a queued write. For app-settings whole-array writes, the new
 * value is diffed against the last pending op for the same key (chained) or the
 * last-known server snapshot, so sync can merge item-by-item. Returns the op.
 */
export async function enqueueWrite(input: {
  model: string;
  method: HttpMethod;
  url: string;
  recordId?: string;
  body?: Rec;
}): Promise<OutboxOp> {
  const base: OutboxOp = {
    opId: uuid(),
    model: input.model,
    method: input.method,
    url: input.url,
    recordId: input.recordId,
    body: input.body,
    createdAt: Date.now(),
    tries: 0,
  };

  if (input.model === "app-settings" && input.body && typeof input.body.value === "string") {
    const settingKey = String(input.body.key ?? input.body.id ?? "");
    const nextArr = parseArray(input.body.value as string);
    // Baseline to diff against: the most recent pending op's value for this key
    // (chained deltas), else the last-known server snapshot, else empty.
    const priorOps = (await pendingForModel("app-settings")).filter((o) => o.settingKey === settingKey);
    const prevRaw = priorOps.length ? priorOps[priorOps.length - 1].wholeValue : await readAppSettingSnapshot(settingKey);
    const prevArr = parseArray(prevRaw);
    base.settingKey = settingKey;
    base.wholeValue = input.body.value as string;
    // Only capture item-ops when both sides are id-keyed; otherwise sync will
    // fall back to a whole-value write for this op.
    base.itemOps = isDiffable(prevArr, nextArr) ? diffArrayById(prevArr, nextArr) : undefined;
  }

  await putOp(base);
  return base;
}
