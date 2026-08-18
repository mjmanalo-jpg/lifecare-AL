"use client";

// Sync engine + network-aware write. Drains the outbox in order when the server
// is reachable; queues writes (returning an optimistic result) when it is not.
// Exposes a pub/sub status + the useOfflineSync() hook for the UI indicator.

import { useEffect, useState } from "react";
import { allOps, enqueueWrite, isOfflineModel, pendingCount, removeOp, putOp } from "./outbox.ts";
import { applyItemOps } from "./merge.ts";
import type { HttpMethod, OutboxOp, Rec, SyncStatus } from "./types.ts";

// ── status pub/sub ───────────────────────────────────────────────────────────
let status: SyncStatus = {
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  pending: 0,
  syncing: false,
  lastSyncedAt: null,
  lastError: null,
};
const listeners = new Set<(s: SyncStatus) => void>();
function emit(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l(status));
}
export function getSyncStatus(): SyncStatus { return status; }
export function subscribeSync(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
async function refreshPending() { emit({ pending: await pendingCount() }); }

// ── network helpers ──────────────────────────────────────────────────────────
function isOnline(): boolean { return typeof navigator === "undefined" ? true : navigator.onLine; }

function isNetworkError(err: unknown): boolean {
  // fetch() rejects with a TypeError when the server is unreachable / offline.
  return err instanceof TypeError;
}

async function sendJson(method: HttpMethod, url: string, body?: Rec): Promise<Response> {
  return fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
    cache: "no-store",
  });
}

function parseArray(raw: string | null | undefined): unknown[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
}

// ── replay one op ────────────────────────────────────────────────────────────
async function replayOp(op: OutboxOp): Promise<void> {
  if (op.model === "app-settings" && op.settingKey) {
    // Merge into the CURRENT server value so concurrent edits aren't clobbered.
    let value = op.wholeValue ?? "";
    if (op.itemOps) {
      const res = await fetch(`/api/db/app-settings?f_key=${encodeURIComponent(op.settingKey)}&take=1`, { credentials: "same-origin", cache: "no-store" });
      const cur = res.ok ? ((await res.json())?.data as Rec[] | undefined)?.[0] : undefined;
      value = JSON.stringify(applyItemOps(parseArray(cur?.value as string | undefined), op.itemOps));
    }
    const r = await sendJson("POST", "/api/db/app-settings", { id: op.settingKey, key: op.settingKey, value });
    if (!r.ok) throw new Error(`app-settings sync failed (${r.status})`);
    return;
  }
  const r = await sendJson(op.method, op.url, op.body);
  // A 404 on DELETE/PATCH means the row is already gone server-side — treat as done.
  if (!r.ok && !(op.method !== "POST" && r.status === 404)) throw new Error(`sync failed (${r.status})`);
}

let draining = false;

/** Replay the outbox in order. Stops at the first failure to preserve ordering. */
export async function drain(): Promise<void> {
  if (draining || !isOnline()) return;
  draining = true;
  emit({ syncing: true, lastError: null });
  try {
    const ops = await allOps();
    for (const op of ops) {
      try {
        await replayOp(op);
        await removeOp(op.opId);
        await refreshPending();
      } catch (err) {
        if (isNetworkError(err)) break; // still offline — try again later
        // A server-side (non-network) failure: record it, keep the op, stop.
        await putOp({ ...op, tries: op.tries + 1, lastError: err instanceof Error ? err.message : "sync error" });
        emit({ lastError: err instanceof Error ? err.message : "sync error" });
        break;
      }
    }
    emit({ lastSyncedAt: Date.now() });
  } finally {
    draining = false;
    emit({ syncing: false });
    await refreshPending();
  }
}

// ── network-aware write (used by @/lib/api) ──────────────────────────────────
/**
 * Perform a write, queueing to the outbox when the server is unreachable.
 * Returns the server JSON on success, or an optimistic `{ data: body }` when
 * queued. Only clinical/high-value models are queued; other models throw as
 * before so nothing is silently swallowed.
 */
export async function offlineWrite(model: string, method: HttpMethod, url: string, body?: Rec, recordId?: string): Promise<unknown> {
  const queue = async () => {
    const op = await enqueueWrite({ model, method, url, recordId, body });
    await refreshPending();
    void tryDrainSoon();
    // Optimistic result mirrors the /api/db POST shape ({ data: <record> }).
    const optimistic = op.settingKey ? { id: op.settingKey, key: op.settingKey, value: op.wholeValue } : body;
    return { data: optimistic, __queuedOffline: true };
  };

  if (!isOfflineModel(model)) {
    // Non-clinical models: normal behaviour (throws on failure).
    const res = await sendJson(method, url, body);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.detail ? `${json.error}: ${json.detail}` : json?.error || res.statusText);
    return json;
  }

  if (!isOnline()) return queue();

  try {
    const res = await sendJson(method, url, body);
    if (res.ok) return res.json().catch(() => ({}));
    // Server reachable but erroring: 5xx/timeout → likely down → queue; else real error.
    if (res.status >= 500) return queue();
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.detail ? `${json.error}: ${json.detail}` : json?.error || res.statusText);
  } catch (err) {
    if (isNetworkError(err)) return queue();
    throw err;
  }
}

// ── triggers ─────────────────────────────────────────────────────────────────
let started = false;
let drainTimer: ReturnType<typeof setTimeout> | null = null;
function tryDrainSoon() {
  if (drainTimer) return;
  drainTimer = setTimeout(() => { drainTimer = null; void drain(); }, 1200);
}

/** Wire up auto-sync triggers once (called from the app shell). */
export function startOfflineSync(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const onOnline = () => { emit({ online: true }); void drain(); };
  const onOffline = () => emit({ online: false });
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  window.addEventListener("focus", () => void drain());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void drain(); });
  setInterval(() => { if (status.pending > 0) void drain(); }, 30000);
  void refreshPending().then(() => drain());
}

export async function syncNow(): Promise<void> { await drain(); }

// ── React hook ───────────────────────────────────────────────────────────────
export function useOfflineSync(): SyncStatus & { syncNow: () => Promise<void> } {
  const [s, setS] = useState<SyncStatus>(getSyncStatus());
  useEffect(() => {
    const unsub = subscribeSync(setS);
    void refreshPending();
    return unsub;
  }, []);
  return { ...s, syncNow };
}
