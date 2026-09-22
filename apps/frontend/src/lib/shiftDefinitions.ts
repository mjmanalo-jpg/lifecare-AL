/**
 * Shift definitions — the facility's rosterable shifts, editable by a nurse.
 *
 * The five patterns below ship as DEFAULTS. A community may override them (change a
 * shift's clock times or label) and add its own, stored migration-free as an
 * app-setting JSON array under `shift_definitions` — the same pattern the caregiver
 * roster and the MAR's per-med dose times use.
 *
 * Semantics chosen deliberately (see the shift-times change): there is ONE table per
 * community and no version history, so editing a shift's times re-interprets every
 * roster row keyed to that shift, past and future. A roster row stores only a shift
 * KEY; its window is always read from the live table. That keeps one source of truth
 * and makes "what are our shift times?" answerable without a date, at the cost of
 * historical shift attribution moving with the setting.
 *
 * PURE: no react / prisma / api imports, so the nurse editor, the server-side access
 * lock and the routing cron all resolve windows through the same code.
 */

export const SHIFT_DEFINITIONS_KEY = "shift_definitions";

/** A shift as STORED. Times are facility-local "HH:MM"; the window wraps past
 *  midnight whenever `end` is at or before `start`. */
export interface ShiftDef {
  key: string;
  label: string;
  start: string;
  end: string;
  /** True for the five shipped patterns. They may be edited but never deleted —
   *  task-routing defaults and the routine's shift tags refer to AM / PM / NOC. */
  builtin?: boolean;
}

/** A shift RESOLVED for use: window arithmetic plus display strings. */
export interface ShiftMeta extends ShiftDef {
  /** Minutes-of-day the window opens / closes (close is the raw clock value). */
  startMin: number;
  endMin: number;
  /** True when the window runs past midnight into the next calendar day. */
  nextDay: boolean;
  /** Length in hours (8, 12, or whatever a custom shift works). */
  hours: number;
  /** "7:00 AM – 3:00 PM", for display. */
  range: string;
  /** Whole-hour start / end, kept for callers doing `startH * 60` arithmetic. */
  startH: number;
  endH: number;
}

/** The shipped patterns: three 8-hour shifts that tile the day, plus two 12-hour. */
export const DEFAULT_SHIFT_DEFS: ReadonlyArray<ShiftDef> = [
  { key: "AM",  label: "AM Shift",  start: "07:00", end: "15:00", builtin: true },
  { key: "PM",  label: "PM Shift",  start: "15:00", end: "23:00", builtin: true },
  { key: "NOC", label: "Noc Shift", start: "23:00", end: "07:00", builtin: true },
  { key: "D12", label: "Day 12h",   start: "07:00", end: "19:00", builtin: true },
  { key: "N12", label: "Night 12h", start: "19:00", end: "07:00", builtin: true },
];

/** Built-in keys other subsystems name directly, so they can never be deleted. */
export const PROTECTED_SHIFT_KEYS = new Set(["AM", "PM", "NOC"]);

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "HH:MM" -> minutes-of-day, or null when it isn't a real time. */
export function parseHHMM(v: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const h = +m[1];
  const mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** minutes-of-day -> "HH:MM" (24-hour, for inputs and storage). */
export const toHHMM = (min: number): string => {
  const t = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`;
};

/** minutes-of-day -> "7:00 AM" (12-hour, for display). */
export function to12h(min: number): string {
  const t = ((Math.round(min) % 1440) + 1440) % 1440;
  const h24 = Math.floor(t / 60);
  const mi = t % 60;
  const h12 = h24 % 12 || 12;
  return `${h12}:${pad2(mi)} ${h24 < 12 ? "AM" : "PM"}`;
}

/** Resolve one stored definition into usable window arithmetic + display strings. */
export function resolveShiftDef(d: ShiftDef): ShiftMeta {
  const startMin = parseHHMM(d.start) ?? 0;
  const endMin = parseHHMM(d.end) ?? 0;
  const nextDay = endMin <= startMin;
  return {
    ...d,
    startMin,
    endMin,
    nextDay,
    hours: (((endMin - startMin) % 1440) + 1440) % 1440 / 60 || 24,
    range: `${to12h(startMin)} – ${to12h(endMin)}`,
    startH: Math.floor(startMin / 60),
    endH: Math.floor(endMin / 60),
  };
}

/**
 * The community's shifts, resolved and in clock order. Falls back to the shipped
 * defaults for a community that has never edited them (and for any caller that has
 * no table to hand, which keeps every window helper usable without plumbing).
 */
export function resolveShiftDefs(defs?: ReadonlyArray<ShiftDef> | null): ShiftMeta[] {
  const src = defs && defs.length ? defs : DEFAULT_SHIFT_DEFS;
  return src.map(resolveShiftDef).sort((a, b) => a.startMin - b.startMin || a.hours - b.hours);
}

/** Read the stored table. Returns null when unset/unusable so callers fall back to
 *  the defaults rather than to an empty roster of shifts. */
export function parseShiftDefs(raw: string | undefined | null): ShiftDef[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return null;
    const out = v.filter((d): d is ShiftDef =>
      !!d && typeof d.key === "string" && !!d.key.trim()
      && typeof d.label === "string"
      && parseHHMM(d.start) != null && parseHHMM(d.end) != null);
    return out.length ? out : null;
  } catch {
    return null;
  }
}

/** A stable key for a nurse-added shift, unique against the keys already in use. */
export function newShiftKey(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = label.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 12) || "SHIFT";
  if (!used.has(base)) return base;
  for (let i = 2; i < 100; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`;
  return `${base}_${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Reasons this table can't be saved. Empty array = valid.
 *
 * Overlap is NOT an error: the 12-hour patterns deliberately overlap the 8-hour ones,
 * and coverage routing resolves that by preferring the tightest window.
 */
export function validateShiftDefs(defs: ReadonlyArray<ShiftDef>): string[] {
  const errs: string[] = [];
  if (!defs.length) errs.push("Keep at least one shift.");
  const seen = new Set<string>();
  for (const d of defs) {
    const name = d.label?.trim() || d.key;
    if (!d.label?.trim()) errs.push(`${d.key}: give the shift a name.`);
    if (seen.has(d.key)) errs.push(`${name}: duplicate shift key "${d.key}".`);
    seen.add(d.key);
    const s = parseHHMM(d.start);
    const e = parseHHMM(d.end);
    if (s == null) errs.push(`${name}: start time must be HH:MM.`);
    if (e == null) errs.push(`${name}: end time must be HH:MM.`);
    if (s != null && e != null && s === e) errs.push(`${name}: start and end can't be the same time.`);
  }
  for (const k of PROTECTED_SHIFT_KEYS) {
    if (!seen.has(k)) errs.push(`The ${k} shift can be re-timed but not removed — other scheduling rules refer to it.`);
  }
  return errs;
}
