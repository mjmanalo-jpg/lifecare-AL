// ---------------------------------------------------------------------------
// Short-lived result cache for the portal admin endpoints.
//
// The database lives on a remote pooler (~150ms per round-trip), and the
// organization-admin and platform-admin dashboards resolve several multi-include
// Prisma queries on every tab load (each nested relation adds a round trip), so
// a single mount can take 1s+. Admin dashboards tolerate a few seconds of
// staleness, so we memoize the resolved payloads with a short TTL and explicitly
// invalidate on any mutation that touches the data. Only successful loads are
// cached; a null/error result falls through and re-queries next time so a
// just-provisioned record is never hidden for the TTL.
// ---------------------------------------------------------------------------
const PORTAL_DATA_TTL_MS = Number(process.env.PORTAL_DATA_CACHE_TTL_MS || 5000);

type CacheEntry<T> = { expires: number; value: T };
const store = new Map<string, CacheEntry<unknown>>();

function sweep() {
  if (store.size <= 500) return;
  const now = Date.now();
  for (const [k, v] of store) if (v.expires <= now) store.delete(k);
}

export async function cachedPortalData<T>(key: string, loader: () => Promise<T | null>): Promise<T | null> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await loader();
  if (value != null) {
    store.set(key, { expires: Date.now() + PORTAL_DATA_TTL_MS, value });
    sweep();
  }
  return value;
}

export function invalidatePortalData(key: string): void {
  store.delete(key);
}

export function invalidatePortalDataPrefix(prefix: string): void {
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
}
