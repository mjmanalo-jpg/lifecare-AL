// SLMS v4.2 — Care Task activity rows + monthly Resident Daily Performance grid.
// PURE: derives the standard activity list from a resident's APPROVED routine
// definitions (one row per scheduled time, matching the paper "Residents Daily
// Performance Routine"), and the set of auto-checked cells from COMPLETED
// occurrences across a month. No IO; the components render these.

import { occurrencesForDate, type DaySchedule, type HFMethod } from "./highFrequency.ts";
import { ASSISTANCE_DISPLAY, ROLE_ABBR, type Assistance, type Role } from "./assistance.ts";
import { countsAsCompleted, type CareOutcome } from "./vocab.ts";

export interface ActivityRow {
  key: string;        // `${definitionId}@${HHMM}` — stable per activity slot (matches occId minus the date)
  time: string;       // "HH:MM"
  activity: string;
  assistance: string; // facility display label
  assistedBy: string; // CGs / NOD / OTH
}

interface DefLike {
  id: string;
  name: string;
  assistanceLevel?: string | null;
  responsibleRole?: string | null;
  frequencyMethod: string;
  schedule: unknown;
}

const parseSched = (v: unknown): DaySchedule => {
  if (v && typeof v === "object") return v as DaySchedule;
  try { const p = JSON.parse(String(v || "{}")); return p && typeof p === "object" ? p : {}; } catch { return {}; }
};
const hhmm = (t: string) => (t || "").replace(":", "");

/**
 * The resident's standard activity rows — one per scheduled time per approved
 * definition (so "Due Meds" at 07:30 / 12:30 / 18:00 are three rows, and a Q4
 * continence event is one row per interval). Sorted by clock time.
 * `sampleDateISO` drives day_of_week / every_other_day expansion — pass a date the
 * rule matches to include those rows in the standard list (else they only appear
 * on matching days). Trigger/PRN events (no scheduled time) are excluded.
 */
export function activityRows(defs: DefLike[], sampleDateISO: string): ActivityRow[] {
  const rows = new Map<string, ActivityRow>();
  for (const d of defs) {
    for (const o of occurrencesForDate(d.frequencyMethod as HFMethod, parseSched(d.schedule), sampleDateISO)) {
      const key = `${d.id}@${hhmm(o.time)}`;
      if (rows.has(key)) continue;
      rows.set(key, {
        key,
        time: o.time,
        activity: d.name,
        assistance: ASSISTANCE_DISPLAY[(d.assistanceLevel || "") as Assistance] ?? (d.assistanceLevel || "—"),
        assistedBy: ROLE_ABBR[(String(d.responsibleRole || "Caregiver").replace(/_/g, " ")) as Role] ?? "CGs",
      });
    }
  }
  return [...rows.values()].sort((a, b) => a.time.localeCompare(b.time));
}

/** Number of days in a 1-indexed month. */
export function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

interface OccLike {
  definitionId: string;
  scheduledTime: string;
  careDate: unknown;
  careDeliveryOutcome?: string | null;
}
const manilaDay = (v: unknown): string => {
  const d = new Date(String(v ?? ""));
  return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(d);
};

/**
 * Auto-checked cells for the month, keyed by SCHEDULED TIME + day: `${HHMM}|${dom}`
 * for every occurrence whose outcome counts as completed. Time-based (not definition
 * id) so a curated Care Task row — including nurse-added lifestyle activities — lights
 * when a caregiver completes the matching-time occurrence that day. A monthly row at
 * time T checks when `${HHMM(T)}|${day}` is present.
 * (Caveat: two clinical activities at the exact same time share a cell — acceptable
 * for this coarse daily record; the caregiver's per-occurrence board is authoritative.)
 */
export function checkedCells(occs: OccLike[], year: number, month1: number): Set<string> {
  const set = new Set<string>();
  const prefix = `${year}-${String(month1).padStart(2, "0")}-`;
  for (const o of occs) {
    if (!o.careDeliveryOutcome || !countsAsCompleted(o.careDeliveryOutcome as CareOutcome)) continue;
    const day = manilaDay(o.careDate); // Manila YYYY-MM-DD
    if (!day.startsWith(prefix)) continue;
    const dom = parseInt(day.slice(8, 10), 10);
    set.add(`${hhmm(o.scheduledTime)}|${dom}`);
  }
  return set;
}

/** Cell key for a monthly-grid row (its time) on a day-of-month. */
export function cellKey(time: string, dayOfMonth: number): string {
  return `${hhmm(time)}|${dayOfMonth}`;
}
