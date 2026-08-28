// Care-plan draft store — the editable, per-resident snapshot of a nurse's
// individualized package selections in the Care Plan Reviews builder.
//
// Migration-free: a JSON map keyed by residentId, stored in the app-setting
// `care_plan_drafts` (the same pattern `care_plan_reviews` uses). This is the
// SINGLE SOURCE OF TRUTH for the builder — it hydrates from here and auto-saves
// back, so a nurse's assistance/frequency/note edits are never lost when they
// navigate away or regenerate. The CarePlan record + care-plan-items remain the
// downstream release artifact, (re)built from this state on generate.

export const CARE_PLAN_DRAFTS_KEY = "care_plan_drafts";

/** The nurse-editable fields of one package intervention. Everything else
 * (name, domain, assistance choices…) is rebuilt from the level task master. */
export interface SavedTaskItem {
  taskId: string;
  included: boolean;
  assistance: string;
  freq: string;
  note: string;
}

export interface DraftState {
  level: number;
  goals: string[];
  items: SavedTaskItem[];
  updatedAt: string;
}

export type CarePlanDrafts = Record<string, DraftState>;

const isSaved = (v: unknown): v is SavedTaskItem =>
  !!v && typeof (v as SavedTaskItem).taskId === "string";

/** Parse the app-setting value into a residentId → DraftState map. Tolerant of
 * bad/legacy JSON — returns {} rather than throwing. */
export function parseCarePlanDrafts(raw: string | null | undefined): CarePlanDrafts {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: CarePlanDrafts = {};
    for (const [rid, st] of Object.entries(v as Record<string, unknown>)) {
      const s = st as Partial<DraftState> | undefined;
      if (!s || !Array.isArray(s.items)) continue;
      out[rid] = {
        level: Number(s.level) || 0,
        goals: Array.isArray(s.goals) ? s.goals.filter((g): g is string => typeof g === "string") : [],
        items: s.items.filter(isSaved).map((i) => ({
          taskId: String(i.taskId),
          included: i.included !== false,
          assistance: typeof i.assistance === "string" ? i.assistance : "",
          freq: typeof i.freq === "string" && i.freq ? i.freq : "Daily",
          note: typeof i.note === "string" ? i.note : "",
        })),
        updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : "",
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** Immutably set one resident's draft state. */
export function upsertDraft(map: CarePlanDrafts, residentId: string, state: DraftState): CarePlanDrafts {
  return { ...map, [residentId]: state };
}

/** Immutably drop one resident's draft (e.g. after the plan is finalized). */
export function clearDraft(map: CarePlanDrafts, residentId: string): CarePlanDrafts {
  if (!(residentId in map)) return map;
  const next = { ...map };
  delete next[residentId];
  return next;
}

/**
 * Overlay a saved snapshot onto the current level task list. The level task
 * list stays AUTHORITATIVE for which tasks exist (governance): saved ids no
 * longer in the package are dropped, and package tasks with no saved entry keep
 * their built-in defaults (included). Only the nurse-editable fields
 * (included/assistance/freq/note) are overlaid — so an assistance level the
 * nurse chose survives, but a retired governed task can't linger.
 */
export function mergeSavedIntoTasks<T extends SavedTaskItem>(baseItems: T[], saved?: DraftState | null): T[] {
  if (!saved?.items?.length) return baseItems;
  const bySaved = new Map(saved.items.map((i) => [i.taskId, i]));
  return baseItems.map((base) => {
    const s = bySaved.get(base.taskId);
    return s ? { ...base, included: s.included, assistance: s.assistance, freq: s.freq, note: s.note } : base;
  });
}

/** Reduce full builder items to the persisted editable subset. */
export function toSavedItems<T extends SavedTaskItem>(items: T[]): SavedTaskItem[] {
  return items.map(({ taskId, included, assistance, freq, note }) => ({ taskId, included, assistance, freq, note }));
}
