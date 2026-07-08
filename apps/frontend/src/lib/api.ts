"use client";

/**
 * Thin client-side mutation helpers over the /api/db routes.
 * Reads use the useLiveQuery hook; these cover create/update/delete.
 * After a mutation, call the hook's refetch() (realtime will also fire).
 */

async function mutate(method: string, path: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || res.statusText);
  return json;
}

export const createRecord = (model: string, body: unknown) =>
  mutate("POST", `/api/db/${model}`, body);

export const updateRecord = (model: string, id: string, body: unknown) =>
  mutate("PATCH", `/api/db/${model}/${id}`, body);

export const deleteRecord = (model: string, id: string) =>
  mutate("DELETE", `/api/db/${model}/${id}`);
