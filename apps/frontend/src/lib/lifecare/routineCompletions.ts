// Per-task routine completion store — migration-free, so each specific routine
// task a caregiver charts is individually countable AND survives a refresh.
//
// The governed CareEvent write (via /api/care-events) stays the source of truth for
// escalation/variance, but it is scoped to a window's representative careTaskId, not
// each checklist row. This store records the per-item tick (`windowId#index`) keyed by
// resident + care day, in the app-setting `routine_completions` (same JSON-store pattern
// as `care_plan_drafts`). It is display/countability state, never a governance gate.

export const ROUTINE_COMPLETIONS_KEY = "routine_completions";

export interface RoutineCompletion {
  outcome: string;   // "Completed" | an exception outcome
  at: string;        // ISO timestamp
  by?: string;       // actor name
}

/** key = `${careDay}|${residentId}|${itemId}` (itemId e.g. "W04#2"). */
export type RoutineCompletions = Record<string, RoutineCompletion>;

export const completionKey = (careDay: string, residentId: string, itemId: string): string =>
  `${careDay}|${residentId}|${itemId}`;

export function parseRoutineCompletions(raw: string | null | undefined): RoutineCompletions {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: RoutineCompletions = {};
    for (const [k, c] of Object.entries(v as Record<string, unknown>)) {
      const row = c as Partial<RoutineCompletion> | undefined;
      if (row && typeof row.outcome === "string") {
        out[k] = { outcome: row.outcome, at: typeof row.at === "string" ? row.at : "", by: typeof row.by === "string" ? row.by : undefined };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Immutably set one item's completion. */
export function upsertRoutineCompletion(
  map: RoutineCompletions,
  careDay: string, residentId: string, itemId: string,
  c: RoutineCompletion,
): RoutineCompletions {
  return { ...map, [completionKey(careDay, residentId, itemId)]: c };
}

/** Facility-local care day (Asia/Manila), matching the rest of the app. */
export function careDay(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(at);
}
