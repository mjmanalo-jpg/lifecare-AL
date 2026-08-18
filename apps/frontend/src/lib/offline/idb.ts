// Minimal promisified IndexedDB wrapper (no external deps). Two object stores:
//   - "outbox":  queued write ops, keyed by opId
//   - "queries": last-known GET responses, keyed by url
// SSR-safe: every call no-ops (resolves empty) when IndexedDB is unavailable.

const DB_NAME = "lifecare-offline";
const DB_VERSION = 1;
export const OUTBOX_STORE = "outbox";
export const QUERY_STORE = "queries";

function hasIDB(): boolean {
  return typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (!hasIDB()) return Promise.reject(new Error("IndexedDB unavailable"));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) db.createObjectStore(OUTBOX_STORE, { keyPath: "opId" });
      if (!db.objectStoreNames.contains(QUERY_STORE)) db.createObjectStore(QUERY_STORE, { keyPath: "url" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

export async function idbGetAll<T>(store: string): Promise<T[]> {
  if (!hasIDB()) return [];
  try { return (await tx<T[]>(store, "readonly", (s) => s.getAll())) ?? []; } catch { return []; }
}

export async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  if (!hasIDB()) return undefined;
  try { return await tx<T | undefined>(store, "readonly", (s) => s.get(key)); } catch { return undefined; }
}

export async function idbPut<T>(store: string, value: T): Promise<void> {
  if (!hasIDB()) return;
  try { await tx(store, "readwrite", (s) => s.put(value as unknown as Record<string, unknown>)); } catch { /* ignore */ }
}

export async function idbDelete(store: string, key: string): Promise<void> {
  if (!hasIDB()) return;
  try { await tx(store, "readwrite", (s) => s.delete(key)); } catch { /* ignore */ }
}
