// Offline outbox — shared types.
// A durable, in-app (IndexedDB) write queue: when the server is unreachable,
// clinical writes are stored locally and replayed when connectivity returns.

export type HttpMethod = "POST" | "PATCH" | "DELETE";

export type Rec = Record<string, unknown>;

/** An item-level change within an app-settings JSON array (anti-clobber sync). */
export interface ItemOp {
  op: "upsert" | "delete";
  id: string;
  item?: Rec;
}

/** One queued write operation. */
export interface OutboxOp {
  opId: string;              // uuid for this queued op
  model: string;             // "tasks", "care-events", "app-settings", ...
  method: HttpMethod;
  url: string;               // the target /api/db path
  recordId?: string;         // record id (PATCH/DELETE) or app-settings composite id
  body?: Rec;                // row-level create/update payload
  // Custom-route writes (e.g. POST /api/routine/complete) send a command payload
  // that is NOT the row shape, so `body` can't be merged into a cached rowset for
  // the optimistic read. `optimistic` is the row patch to display while queued —
  // without it a charted-offline row reverts to "Due" after a reload.
  optimistic?: Rec;
  // app-settings whole-array writes carry both the whole value (optimistic read)
  // and the item-level diff (merge-on-sync so concurrent edits are not clobbered).
  settingKey?: string;
  wholeValue?: string;       // JSON string of the full array
  itemOps?: ItemOp[];        // item-level diff vs last-known
  createdAt: number;
  tries: number;
  lastError?: string;
}

export interface SyncStatus {
  online: boolean;
  pending: number;
  syncing: boolean;
  lastSyncedAt: number | null;
  lastError: string | null;
}
