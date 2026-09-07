// SLMS v4.2 — Care Task routine + monthly performance ticks stores.
//
// Migration-free app-settings (same JSON-map-by-residentId pattern as
// dailyPerformance.ts / care_plan_drafts):
//
//  - `care_task_routine`     : residentId -> { rows, approved?, approvedAt?, approvedBy?, updatedAt }
//    The nurse-curated standard-activity table (seeded from the approved routine,
//    then editable + lifestyle rows added). Once approved it is "what's sent to
//    the CGs" and the source of the monthly grid's rows.
//  - `resident_performance_ticks` : "${residentId}:${YYYY-MM}" -> string[] of `${HHMM}|${day}`
//    Manual ticks for lifestyle rows that have no clinical occurrence to auto-check.
//
// PURE: no React / api deps, so the components and their tests share one parse +
// upsert implementation.

export const CARE_TASK_KEY = "care_task_routine";
export const PERFORMANCE_TICKS_KEY = "resident_performance_ticks";

/** One row of the Care Task table. `time` (HHMM) is the join key to occurrences. */
export interface CareTaskRow {
  id: string;
  time: string; // "0800" (HHMM) — join key to occurrence scheduledTime
  activity: string;
  assistance: string; // facility display label (free text tolerated on load)
  assistedBy: string; // CGs / NOD / OTH / …
}

export interface CareTaskState {
  rows: CareTaskRow[];
  approved?: boolean;
  approvedAt?: string;
  approvedBy?: string;
  updatedAt: string;
}

export type CareTaskMap = Record<string, CareTaskState>;

const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
const isRow = (v: unknown): v is CareTaskRow =>
  !!v && typeof v === "object" && typeof (v as CareTaskRow).id === "string";

/** Parse the `care_task_routine` value into a residentId → state map. Tolerant. */
export function parseCareTask(raw: string | null | undefined): CareTaskMap {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: CareTaskMap = {};
    for (const [rid, st] of Object.entries(v as Record<string, unknown>)) {
      const s = st as Partial<CareTaskState> | undefined;
      if (!s || !Array.isArray(s.rows)) continue;
      out[rid] = {
        rows: s.rows.filter(isRow).map((r) => ({
          id: String(r.id),
          time: asStr(r.time),
          activity: asStr(r.activity),
          assistance: asStr(r.assistance),
          assistedBy: asStr(r.assistedBy),
        })),
        approved: s.approved === true,
        approvedAt: asStr(s.approvedAt) || undefined,
        approvedBy: asStr(s.approvedBy) || undefined,
        updatedAt: asStr(s.updatedAt),
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** Immutably set one resident's Care Task state. */
export function upsertCareTask(map: CareTaskMap, residentId: string, state: CareTaskState): CareTaskMap {
  return { ...map, [residentId]: state };
}

// ── Time formatting (PH 12-hour, not military) ───────────────────────────────

/** "08:00" | "0800" | "8:00" → "8:00 AM" (Philippine 12-hour display). */
export function to12h(t: string): string {
  if (!t) return "";
  const d = t.replace(":", "").padStart(4, "0").slice(0, 4);
  if (!/^\d{4}$/.test(d)) return t;
  let h = parseInt(d.slice(0, 2), 10);
  const ap = h < 12 ? "AM" : "PM";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${d.slice(2)} ${ap}`;
}

/**
 * Sort rank for the care day, which runs Morning → Night: 06:00 is first, times
 * wrap past midnight to the end (…22:00, 23:00, 00:00, 02:00, 04:00 last). Empty /
 * invalid times sort last. Used to order the routine, Care Task and Daily Performance.
 */
export function careDayRank(t: string): number {
  if (!t) return Number.MAX_SAFE_INTEGER;
  const d = t.replace(":", "").padStart(4, "0").slice(0, 4);
  if (!/^\d{4}$/.test(d)) return Number.MAX_SAFE_INTEGER;
  const min = (+d.slice(0, 2)) * 60 + (+d.slice(2));
  if (min >= 1440) return Number.MAX_SAFE_INTEGER;
  return (min - 360 + 1440) % 1440; // day starts at 06:00
}

/** Any stored time → "HH:MM" for a native <input type="time">. "" stays "". */
export function toTimeInput(t: string): string {
  if (!t) return "";
  const d = t.replace(":", "").padStart(4, "0").slice(0, 4);
  return /^\d{4}$/.test(d) ? `${d.slice(0, 2)}:${d.slice(2)}` : "";
}

/**
 * The table to SHOW = the live approved-routine seed merged with the persisted
 * Care Task. Clinical rows follow the current routine (fresh times/activities);
 * nurse-added lifestyle rows (non-seed ids, no "@") and per-row edits are kept.
 * An APPROVED Care Task is frozen (what CGs receive) until re-seeded. Shared by
 * the Care Task board and the Resident Daily Performance grid so both replicate.
 */
export function mergeCareTaskRows(saved: CareTaskState | undefined, seed: CareTaskRow[]): CareTaskRow[] {
  if (!saved) return seed;
  if (saved.approved) return saved.rows.length ? saved.rows : seed;
  const savedById = new Map(saved.rows.map((r) => [r.id, r]));
  const clinical = seed.map((sr) => {
    const e = savedById.get(sr.id);
    return e ? { ...sr, activity: e.activity || sr.activity, assistance: e.assistance || sr.assistance, assistedBy: e.assistedBy || sr.assistedBy } : sr;
  });
  const lifestyle = saved.rows.filter((r) => !r.id.includes("@"));
  return [...clinical, ...lifestyle];
}

// ── Manual ticks ─────────────────────────────────────────────────────────────

export type TicksMap = Record<string, string[]>; // "${rid}:${YYYY-MM}" -> ["HHMM|day", …]

/** The per-month tick key. */
export function ticksKey(residentId: string, year: number, month1: number): string {
  return `${residentId}:${year}-${String(month1).padStart(2, "0")}`;
}

/** Parse the `resident_performance_ticks` value into a map of key → array. Tolerant. */
export function parseTicks(raw: string | null | undefined): TicksMap {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: TicksMap = {};
    for (const [k, arr] of Object.entries(v as Record<string, unknown>)) {
      if (Array.isArray(arr)) out[k] = arr.filter((x): x is string => typeof x === "string");
    }
    return out;
  } catch {
    return {};
  }
}

/** Immutably toggle one manual cell (`${HHMM}|${day}`) for a month bucket. */
export function toggleTick(map: TicksMap, key: string, cell: string): TicksMap {
  const cur = map[key] ?? [];
  const next = cur.includes(cell) ? cur.filter((c) => c !== cell) : [...cur, cell];
  return { ...map, [key]: next };
}
