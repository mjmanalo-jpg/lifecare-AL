"use client";

/**
 * Thin client-side mutation helpers over the /api/db routes.
 * Reads use the useLiveQuery hook; these cover create/update/delete.
 * After a mutation, call the hook's refetch() (realtime will also fire).
 *
 * Clinical / high-value models are routed through the offline outbox
 * (offlineWrite): when the server is unreachable the write is queued to
 * IndexedDB and replayed on reconnect, returning an optimistic result so the
 * UI keeps working. Non-clinical models behave exactly as before (throw on
 * failure). See src/lib/offline/*.
 */

import { offlineWrite } from "@/lib/offline/sync";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, unknown>;

// Helpers return `any` (as the previous fetch().json() did) so existing callers
// that read `.data`/`.id` off the result keep type-checking.
export const createRecord = (model: string, body: unknown): Promise<any> =>
  offlineWrite(model, "POST", `/api/db/${model}`, body as Rec);

export const updateRecord = (model: string, id: string, body: unknown): Promise<any> =>
  offlineWrite(model, "PATCH", `/api/db/${model}/${id}`, body as Rec, id);

export const upsertRecord = async (model: string, id: string, body: unknown) => {
  // app-settings POST is an idempotent tenant-scoped upsert (see the db route),
  // so go straight to it — a PATCH by bare key can't resolve the composite id.
  if (model === "app-settings") {
    return createRecord(model, { id, ...(body as Rec) });
  }
  try {
    return await updateRecord(model, id, body);
  } catch {
    return await createRecord(model, { id, ...(body as Rec) });
  }
};

export const deleteRecord = (model: string, id: string) =>
  offlineWrite(model, "DELETE", `/api/db/${model}/${id}`, undefined, id);
