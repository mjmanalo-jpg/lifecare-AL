// Durable read cache: persist each successful GET response so reads keep working
// when the server is unreachable (last-known snapshot).

import { QUERY_STORE, idbGet, idbPut } from "./idb.ts";
import type { Rec } from "./types.ts";

interface CachedQuery { url: string; rows: Rec[]; at: number; }

export async function cacheQuery(url: string, rows: Rec[]): Promise<void> {
  await idbPut<CachedQuery>(QUERY_STORE, { url, rows, at: Date.now() });
}

export async function readCachedQuery(url: string): Promise<Rec[] | null> {
  const row = await idbGet<CachedQuery>(QUERY_STORE, url);
  return row ? row.rows : null;
}

// ── app-settings per-key snapshot ────────────────────────────────────────────
// The last-known SERVER value for each app-settings key, so an offline write can
// diff its new array against the real baseline (to capture deletes correctly).
const asKey = (key: string) => `__as__:${key}`;

/** Store the last-known value of each app-settings key from a fetched rowset. */
export async function snapshotAppSettings(rows: Rec[]): Promise<void> {
  for (const r of rows) {
    const key = String(r.key ?? r.id ?? "");
    if (!key || r.value == null) continue;
    await idbPut<CachedQuery>(QUERY_STORE, { url: asKey(key), rows: [{ value: String(r.value) }], at: Date.now() });
  }
}

/** Read the last-known value (JSON string) of an app-settings key. */
export async function readAppSettingSnapshot(key: string): Promise<string | null> {
  const row = await idbGet<CachedQuery>(QUERY_STORE, asKey(key));
  const v = row?.rows?.[0]?.value;
  return v == null ? null : String(v);
}
