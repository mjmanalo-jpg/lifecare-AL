// Resident Daily Performance — the resident's standing 24-hour routine rendered
// as a flat, editable schedule table (Time · Activities · Level of Assistance ·
// Assisted By), mirroring the facility's paper routine sheet.
//
// Migration-free: a JSON map keyed by residentId in the app-setting
// `resident_daily_performance` (same pattern as `care_plan_drafts`). The table
// is SEEDED from the plan's generated 24-hour routine, then becomes the source
// of truth once a nurse edits it — a "Re-seed from routine" action re-syncs.
//
// PURE: no React / api deps, so the component and its test share one seed +
// persistence implementation.

import type { RoutineEvent } from "./carePlanRoutine.ts";

export const DAILY_PERFORMANCE_KEY = "resident_daily_performance";

/** ADL assistance vocabulary shown in the sample routine sheet (least → most
 * dependent). Also the dropdown options in the editor. */
export const ASSISTANCE_LEVELS = [
  "Independent",
  "Observation",
  "Supervision",
  "Min. Assistance",
  "Mod. Assistance",
  "Fully Dependent",
] as const;

/** Who delivers the activity. CGs = caregivers, NOD = nurse on duty. */
export const ASSISTED_BY = ["CGs", "NOD", "Nurse", "Family", "Self"] as const;

/** One row of the daily routine table. */
export interface PerformanceRow {
  id: string;
  time: string;        // "0600" (HHMM)
  activity: string;
  assistance: string;  // one of ASSISTANCE_LEVELS (free text tolerated on load)
  assistedBy: string;  // one of ASSISTED_BY
}

export interface DailyPerformanceState {
  rows: PerformanceRow[];
  updatedAt: string;
}

export type DailyPerformanceMap = Record<string, DailyPerformanceState>;

/** Map an assessed domain score (0 = independent … 4 = near-total dependence)
 * to the sheet's assistance vocabulary. Unknown/absent score → Supervision (a
 * safe editable default). */
export function scoreToAssistance(score: number | undefined | null): string {
  switch (score) {
    case 0: return "Observation";
    case 1: return "Supervision";
    case 2: return "Min. Assistance";
    case 3: return "Mod. Assistance";
    case 4: return "Fully Dependent";
    default: return "Supervision";
  }
}

/** A routine event's start time as HHMM, parsed from its "HH:MM-…" window (so
 * :30 starts are exact); falls back to startHour on the odd NOC window. */
function eventTime(ev: RoutineEvent): string {
  const m = /(\d{1,2}):(\d{2})/.exec(ev.window || "");
  if (m) return m[1].padStart(2, "0") + m[2];
  return String(ev.startHour ?? 0).padStart(2, "0") + "00";
}

/**
 * Seed one table row per generated routine event: Time = window start, Activity
 * = the care event, Assisted By = NOD for nurse-owned windows else CGs, and
 * Level of Assistance mapped from the highest scored domain active in the window
 * (score comes from `scoreByCode`; baseline meal/activity windows carry no scored
 * domain → the default). Rows keep routine order (ascending time).
 */
export function seedFromRoutine(routine: RoutineEvent[], scoreByCode: Record<string, number>): PerformanceRow[] {
  return routine.map((ev) => {
    const scores = (ev.domainCodes || [])
      .map((c) => scoreByCode[c])
      .filter((n): n is number => Number.isInteger(n));
    const maxScore = scores.length ? Math.max(...scores) : undefined;
    return {
      id: `${ev.id}#perf`,
      time: eventTime(ev),
      activity: ev.label,
      assistance: scoreToAssistance(maxScore),
      assistedBy: ev.role === "Nurse" ? "NOD" : "CGs",
    };
  });
}

const asStr = (v: unknown): string => (typeof v === "string" ? v : "");

const isRow = (v: unknown): v is PerformanceRow =>
  !!v && typeof v === "object" && typeof (v as PerformanceRow).id === "string";

/** Parse the app-setting value into a residentId → DailyPerformanceState map.
 * Tolerant of bad/legacy JSON — returns {} rather than throwing. */
export function parseDailyPerformance(raw: string | null | undefined): DailyPerformanceMap {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: DailyPerformanceMap = {};
    for (const [rid, st] of Object.entries(v as Record<string, unknown>)) {
      const s = st as Partial<DailyPerformanceState> | undefined;
      if (!s || !Array.isArray(s.rows)) continue;
      out[rid] = {
        rows: s.rows.filter(isRow).map((r) => ({
          id: String(r.id),
          time: asStr(r.time),
          activity: asStr(r.activity),
          assistance: asStr(r.assistance),
          assistedBy: asStr(r.assistedBy),
        })),
        updatedAt: asStr(s.updatedAt),
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** Immutably set one resident's table state. */
export function upsertDailyPerformance(map: DailyPerformanceMap, residentId: string, state: DailyPerformanceState): DailyPerformanceMap {
  return { ...map, [residentId]: state };
}
