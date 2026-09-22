/**
 * Caregiver scheduling — shared types + helpers.
 *
 * A schedule entry assigns ONE caregiver to a GROUP of residents for a single
 * date + shift (AM / PM / Noc / Day 12h / Night 12h). Stored migration-free as an app-setting JSON
 * array under `caregiver_schedules` (see the Prisma-migration constraint).
 *
 * Phase 1 (this file + CaregiverScheduleBoard) only reads/writes the roster.
 * Phase 2's server-side access lock (tenant.ts) reuses `activeResidentIdsFor`
 * to resolve which residents a caregiver may see *right now* — so the shift
 * window logic lives here, in one place, shared by client and server.
 */

import { resolveShiftDefs, type ShiftDef, type ShiftMeta } from "./shiftDefinitions.ts";

export { SHIFT_DEFINITIONS_KEY, parseShiftDefs, DEFAULT_SHIFT_DEFS } from "./shiftDefinitions.ts";
export type { ShiftDef, ShiftMeta } from "./shiftDefinitions.ts";

export const CAREGIVER_SCHEDULE_KEY = "caregiver_schedules";
/** Break-glass grants are hidden from the client (`__` prefix — the generic
 *  /api/db route filters those out) and written only by the dedicated endpoint. */
export const CAREGIVER_BREAKGLASS_KEY = "__caregiver_breakglass";

/** A shift key. The five shipped patterns are named; a nurse-added shift carries a
 *  generated key, so this is a string rather than a closed union. */
export type ShiftKey = string;

/** Kept as a distinct name for "one of the shifts that owns a clock time". */
export type OwnerShiftKey = ShiftKey;

/**
 * Assignable shifts, resolved from the SHIPPED DEFAULTS.
 *
 * A community can re-time these and add its own (see {@link shiftDefinitions}); the
 * table is stored per community, so anything that must honour a community's real
 * shifts takes an optional `defs` argument and passes its table through. Callers
 * with no table — and this constant — fall back to the defaults, which keeps every
 * helper usable in tests and in code that predates the editor.
 *
 * Resident routine times are FIXED clinical times and never move — caregivers
 * rotate around them. So coverage is decided purely by the clock: a caregiver owns
 * the routine occurrences whose scheduled time falls inside their window, and
 * nothing outside it. See {@link caregiversCoveringResidentAt}.
 */
export const SHIFTS: ReadonlyArray<ShiftMeta> = resolveShiftDefs();

/** The community's shifts in clock order, or the defaults when none are stored. */
export const shiftList = (defs?: ReadonlyArray<ShiftDef> | null): ShiftMeta[] => resolveShiftDefs(defs);

/** One shift's resolved window. Unknown key → the first shift, so a roster row left
 *  behind by a deleted shift still renders instead of throwing. */
export const shiftMeta = (shift: ShiftKey, defs?: ReadonlyArray<ShiftDef> | null): ShiftMeta => {
  const list = shiftList(defs);
  return list.find((s) => s.key === shift) ?? list[0];
};

/**
 * The shifts that OWN clock times: the subset whose windows tile the day without
 * overlapping each other, longest-first removal — in practice the 8-hour trio, since
 * the 12-hour patterns overlap them. Answers "which shift does this time belong to"
 * for grouping and labelling; coverage never uses it.
 */
export function ownerShifts(defs?: ReadonlyArray<ShiftDef> | null): ShiftMeta[] {
  const list = shiftList(defs);
  const out: ShiftMeta[] = [];
  for (const s of [...list].sort((a, b) => a.hours - b.hours || a.startMin - b.startMin)) {
    if (!out.some((o) => metaOverlap(o, s))) out.push(s);
  }
  return out.sort((a, b) => a.startMin - b.startMin);
}

/** Minutes-of-day a shift's window starts / ends (end exceeds 1440 when it wraps). */
const windowOf = (m: ShiftMeta): { start: number; end: number } =>
  ({ start: m.startMin, end: m.endMin + (m.nextDay ? 1440 : 0) });

const metaOverlap = (a: ShiftMeta, b: ShiftMeta): boolean => {
  const A = windowOf(a);
  const B = windowOf(b);
  // Compare on a 48-hour line, testing B and its next-day image against A.
  return (A.start < B.end && B.start < A.end)
    || (A.start < B.end + 1440 && B.start + 1440 < A.end)
    || (A.start + 1440 < B.end && B.start < A.end + 1440);
};

/**
 * True when a clock minute-of-day falls inside a shift's window (wrap-aware).
 *
 * Pure window math on the clock alone — no calendar date, no lead-in / grace. This
 * is the "anong oras natapat sa shift" test used to decide which caregiver owns a
 * fixed routine time; {@link isScheduleActiveAt} is the dated, graced variant that
 * governs live data access.
 */
export function shiftCoversMinutes(shift: ShiftKey, minutes: number, defs?: ReadonlyArray<ShiftDef> | null): boolean {
  const { start, end } = windowOf(shiftMeta(shift, defs));
  const t = ((minutes % 1440) + 1440) % 1440;
  return (t >= start && t < end) || (end > 1440 && t < end - 1440);
}

/** True when two shifts' windows share any clock minute (AM and Day 12h both cover 8am). */
export function shiftsOverlap(a: ShiftKey, b: ShiftKey, defs?: ReadonlyArray<ShiftDef> | null): boolean {
  return metaOverlap(shiftMeta(a, defs), shiftMeta(b, defs));
}

/**
 * The shift a clock minute belongs to. Prefers an owning (non-overlapping) shift;
 * falls back to whichever shift most recently started, so a time left uncovered by a
 * hand-edited table still resolves to a real shift instead of nothing.
 */
export function shiftOwningMinutes(minutes: number, defs?: ReadonlyArray<ShiftDef> | null): OwnerShiftKey {
  const owners = ownerShifts(defs);
  const hit = owners.find((s) => shiftCoversMinutes(s.key, minutes, defs));
  if (hit) return hit.key;
  const t = ((minutes % 1440) + 1440) % 1440;
  const behind = [...owners].sort((a, b) => a.startMin - b.startMin)
    .filter((s) => s.startMin <= t).pop();
  return (behind ?? owners[owners.length - 1] ?? shiftList(defs)[0]).key;
}

/** The shift a clock hour belongs to. */
export const shiftOwningHour = (hour: number, defs?: ReadonlyArray<ShiftDef> | null): OwnerShiftKey =>
  shiftOwningMinutes(hour * 60, defs);

/** Grace minutes the shift stays live PAST its end so a caregiver can finish late
 *  tasks and hand over. e.g. 60 → an AM (7–15) caregiver keeps their residents
 *  until 16:00. Extends only the end; the start is unchanged. */
export const SHIFT_GRACE_MINUTES = 60;

/** Lead-in minutes the shift goes live BEFORE its start so a caregiver who clocks
 *  in early sees their assignment and routine. e.g. 15 → a PM (15–23) caregiver
 *  reaches their residents from 14:45. Extends only the start; the end is unchanged. */
export const SHIFT_LEAD_MINUTES = 15;

export interface CaregiverSchedule {
  id: string;
  date: string;            // YYYY-MM-DD (local calendar date the shift starts)
  shift: ShiftKey;
  caregiverStaffId: string;
  caregiverUserId?: string; // resolved so the server lock can match by session userId
  caregiverName: string;
  residentIds: string[];              // the authority for access scoping
  /** Name/room snapshot taken at assign time so a caregiver sees resident names
   *  even for a future shift (their live resident reads are shift-scoped). */
  residents?: { id: string; name: string; room: string }[];
  note?: string;
  /** True when the roster cell represents dedicated/private caregiver coverage. */
  private?: boolean;
  /** Original roster code retained for accountable assignment review. */
  code?: string;
  /** "roster" when generated by the Staff Roster bridge (so a re-sync can replace
   *  its own entries without clobbering hand-made assignments). */
  source?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
  /** Explicit worker receipt of the current assignment version. */
  acknowledgedAt?: string;
  acknowledgedByUserId?: string;
  /** Incremented whenever a manager changes the assignment. */
  changeVersion?: number;
}

export function parseSchedules(raw: string | undefined | null): CaregiverSchedule[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((s): s is CaregiverSchedule =>
      !!s && typeof s.id === "string" && typeof s.date === "string" && Array.isArray(s.residentIds));
  } catch {
    return [];
  }
}

export function newScheduleId(): string {
  return `cs_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Milliseconds `timeZone` is ahead of UTC at the given instant (DST-aware). */
function zoneOffsetMs(at: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
    return Number.isFinite(asUtc) ? asUtc - at.getTime() : 0;
  } catch {
    return 0;
  }
}

/**
 * A facility wall-clock time (`YYYY-MM-DD` + hour) as the TRUE instant it happens.
 *
 * Without this, `new Date(y, m, d, 6)` means 06:00 *on the server*, which on a UTC
 * host is 14:00 in Manila — so every comparison against a stored timestamp lands a
 * whole shift away. Pass no `timeZone` to keep the old server-local behaviour.
 */
export function zonedInstant(date: string, hour: number, timeZone?: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  if (!timeZone) return new Date(y, (mo || 1) - 1, d || 1, hour, 0, 0, 0);
  const naive = Date.UTC(y, (mo || 1) - 1, d || 1, hour, 0, 0, 0);
  // Sample the offset at the guessed instant, then re-sample at the corrected one so
  // a wall time sitting on a DST boundary still resolves to the right instant.
  const first = naive - zoneOffsetMs(new Date(naive), timeZone);
  return new Date(naive - zoneOffsetMs(new Date(first), timeZone));
}

/** Instant range [start, end) a schedule's shift occupies in the facility's zone. */
export function shiftWindow(date: string, shift: ShiftKey, timeZone?: string, defs?: ReadonlyArray<ShiftDef> | null): { start: Date; end: Date } {
  const m = shiftMeta(shift, defs);
  return {
    start: zonedInstant(date, m.startH, timeZone),
    end: zonedInstant(addDays(date, m.nextDay ? 1 : 0), m.endH, timeZone),
  };
}

/**
 * The shift a moment belongs to, as the roster records it: which AM/PM/NOC key, the
 * calendar date the shift STARTED on (a NOC shift read at 01:00 belongs to yesterday's
 * roster row), and the true instant window. One resolver so the dashboard read model
 * and its metric drill-downs cannot drift apart.
 */
export function resolveShift(at: Date = new Date(), timeZone?: string, defs?: ReadonlyArray<ShiftDef> | null): {
  key: OwnerShiftKey; date: string; start: Date; end: Date;
} {
  const key = currentShiftKey(at, timeZone, defs);
  const day = localDateStr(at, timeZone);
  const m = shiftMeta(key, defs);
  // A wrapping shift read after midnight belongs to the roster row of the day it
  // STARTED on, so wind the date back for the post-midnight part of its window.
  const date = m.nextDay && localMinutesOfDay(at, timeZone) < m.endMin ? addDays(day, -1) : day;
  return { key, date, ...shiftWindow(date, key, timeZone, defs) };
}

/** Roster rows covering a resolved shift — the authority for "who is covered now". */
export function schedulesForShift(
  schedules: CaregiverSchedule[], shift: { date: string; key: ShiftKey },
): CaregiverSchedule[] {
  return schedules.filter((s) => s.date === shift.date && s.shift === shift.key);
}

/**
 * True when `at` falls inside the schedule's SHIFT WINDOW (facility-local).
 *
 * Access is shift-scoped: a caregiver reaches their assigned residents only
 * while the rostered shift is live. The moment the shift ends the residents drop
 * off (an AM caregiver loses them at 15:00) and reappear only when the nurse /
 * care manager rosters them a shift whose window is currently active. Off every
 * rostered window → they see nothing until rescheduled.
 *
 * Compared in facility-local time (hour + calendar date), never as server-local
 * Date objects, so a UTC server still evaluates the window in the facility's zone.
 */
export function isScheduleActiveAt(s: CaregiverSchedule, at: Date, timeZone?: string, defs?: ReadonlyArray<ShiftDef> | null): boolean {
  const day = localDateStr(at, timeZone);
  const nowMin = localMinutesOfDay(at, timeZone);
  const m = shiftMeta(s.shift, defs);
  const startMin = m.startMin - SHIFT_LEAD_MINUTES; // lead-in opens the shift early
  const endMin = m.endMin + SHIFT_GRACE_MINUTES;    // grace extends the shift end
  const DAY = 24 * 60;
  if (!m.nextDay) {
    // AM (07–15) / PM (15–23) / Day 12h (07–19): same calendar day. Grace may push the end past
    // midnight, spilling the overflow into the next calendar day's early hours.
    if (s.date === day && nowMin >= startMin && nowMin < Math.min(endMin, DAY)) return true;
    return endMin > DAY && day === addDays(s.date, 1) && nowMin < endMin - DAY;
  }
  // Noc (23–07 +grace) and Night 12h (19–07) span midnight: the pre-midnight part
  // belongs to s.date; the 00:00–(07:00+grace) part belongs to the day AFTER s.date.
  if (s.date === day && nowMin >= startMin) return true;
  return day === addDays(s.date, 1) && nowMin < endMin;
}

/**
 * Resident ids a caregiver (by session userId) is assigned to AND currently
 * on-shift for at `at`. This is the authority for the server access boundary.
 * `timeZone` (IANA, e.g. "Asia/Manila") evaluates the shift window in the
 * facility's local time — the server may run in UTC.
 */
export function activeResidentIdsFor(userId: string, schedules: CaregiverSchedule[], at: Date, timeZone?: string, defs?: ReadonlyArray<ShiftDef> | null): string[] {
  const ids = new Set<string>();
  for (const s of schedules) {
    if (s.caregiverUserId && s.caregiverUserId === userId && isScheduleActiveAt(s, at, timeZone, defs)) {
      s.residentIds.forEach((r) => ids.add(r));
    }
  }
  return [...ids];
}

/**
 * Caregiver userIds whose LIVE shift covers `residentId` at `at` — the people who
 * can currently see/chart that resident's tasks (shift-window scoped, incl. NOC
 * after midnight + grace). Empty when no one is on an active shift for them.
 * Used to route a due-task alert to exactly the caregiver on duty right now.
 */
export function activeCaregiverUserIdsForResident(residentId: string, schedules: CaregiverSchedule[], at: Date, timeZone?: string, defs?: ReadonlyArray<ShiftDef> | null): string[] {
  const ids = new Set<string>();
  for (const s of schedules) {
    if (s.caregiverUserId && s.residentIds.includes(residentId) && isScheduleActiveAt(s, at, timeZone, defs)) {
      ids.add(s.caregiverUserId);
    }
  }
  return [...ids];
}

/** The 8-hour shift `at` falls in (AM 07–15, PM 15–23, else Noc), rolled forward by
 *  {@link SHIFT_LEAD_MINUTES} so the last minutes before a shift start already report
 *  the incoming shift (14:50 → PM). Always one of the three tiling shifts — the
 *  12-hour patterns overlap, so they can never name "the" current shift. */
export function currentShiftKey(at: Date = new Date(), timeZone?: string, defs?: ReadonlyArray<ShiftDef> | null): OwnerShiftKey {
  return shiftOwningMinutes(localMinutesOfDay(at, timeZone) + SHIFT_LEAD_MINUTES, defs);
}

/** Caregivers scheduled to a resident on the local day of `at` (any shift). */
export function caregiversForResidentToday(
  schedules: CaregiverSchedule[], residentId: string, at: Date = new Date(), timeZone?: string,
): { caregiverStaffId: string; caregiverUserId?: string; caregiverName?: string; shift: ShiftKey }[] {
  const today = localDateStr(at, timeZone);
  return schedules
    .filter((s) => s.date === today && s.residentIds.includes(residentId) && s.caregiverStaffId)
    .map((s) => ({ caregiverStaffId: s.caregiverStaffId, caregiverUserId: s.caregiverUserId, caregiverName: s.caregiverName, shift: s.shift }));
}

/**
 * Best single assignee for a resident's generated tasks today: the caregiver on
 * the CURRENT shift, else the first caregiver scheduled today, else null (leave
 * the task unassigned). Used to route generated tasks straight to the caregiver
 * who is covering the resident.
 */
export function assigneeForResidentToday(
  schedules: CaregiverSchedule[], residentId: string, at: Date = new Date(), timeZone?: string,
): { caregiverStaffId: string; caregiverName?: string } | null {
  const list = caregiversForResidentToday(schedules, residentId, at, timeZone);
  if (!list.length) return null;
  const cur = currentShiftKey(at, timeZone);
  const pick = list.find((c) => c.shift === cur) ?? list[0];
  return { caregiverStaffId: pick.caregiverStaffId, caregiverName: pick.caregiverName };
}

export interface ShiftCover {
  caregiverStaffId: string;
  caregiverUserId?: string;
  caregiverName?: string;
  shift: ShiftKey;
}

/**
 * Caregivers whose rostered window covers a FIXED clock time on the care day of `at`.
 *
 * This is the routing authority for resident routine: a resident's routine times are
 * clinical and immovable, so the caregiver is whoever happens to be on shift at that
 * hour — "kung anong oras ang natapat sa shift ng caregiver, yun lang ang sa kanya".
 * Care outside every rostered window has no owner and routes unassigned.
 *
 * Wrap-aware in BOTH directions, which key-matching could never be:
 *   • a 03:00 occurrence belongs to the Noc caregiver who started 23:00 YESTERDAY,
 *     so roster rows dated the previous day are considered for their post-midnight tail;
 *   • a 12-hour Day caregiver (07–19) covers occurrences an 8-hour AM caregiver
 *     (07–15) would miss, without anything being re-keyed.
 *
 * Ordered tightest-window-first, so when both an 8-hour and an overlapping 12-hour
 * caregiver are rostered the more specific 8-hour assignment wins deterministically.
 */
export function caregiversCoveringResidentAt(
  schedules: CaregiverSchedule[], residentId: string, minutesOfDay: number,
  at: Date = new Date(), timeZone?: string, defs?: ReadonlyArray<ShiftDef> | null,
): ShiftCover[] {
  const day = localDateStr(at, timeZone);
  const prev = addDays(day, -1);
  const t = ((minutesOfDay % 1440) + 1440) % 1440;
  const out: ShiftCover[] = [];
  for (const s of schedules) {
    if (!s.caregiverStaffId || !s.residentIds.includes(residentId)) continue;
    const m = shiftMeta(s.shift, defs);
    const covers = s.date === day
      // Own day: up to midnight for a wrapping shift, else the plain window.
      ? (m.nextDay ? t >= m.startMin : t >= m.startMin && t < m.endMin)
      // Yesterday's wrapping shift still owns this morning's pre-end hours.
      : s.date === prev && m.nextDay && t < m.endMin;
    if (covers) {
      out.push({
        caregiverStaffId: s.caregiverStaffId, caregiverUserId: s.caregiverUserId,
        caregiverName: s.caregiverName, shift: s.shift,
      });
    }
  }
  return out.sort((a, b) => shiftMeta(a.shift, defs).hours - shiftMeta(b.shift, defs).hours);
}

/**
 * The caregiver who owns a resident's care at a fixed clock hour, or null when no
 * rostered window covers that hour (the card is created unassigned and a manager
 * hands it off from the Board View pool).
 */
export function assigneeForResidentAtHour(
  schedules: CaregiverSchedule[], residentId: string, hour: number, at: Date = new Date(), timeZone?: string,
  defs?: ReadonlyArray<ShiftDef> | null,
): { caregiverStaffId: string; caregiverName?: string } | null {
  const pick = caregiversCoveringResidentAt(schedules, residentId, hour * 60, at, timeZone, defs)[0];
  return pick ? { caregiverStaffId: pick.caregiverStaffId, caregiverName: pick.caregiverName } : null;
}

/** The caregiver on duty for a resident at a given INSTANT, evaluated in the
 *  facility's zone. Convenience wrapper for callers holding a timestamp (e.g. a
 *  task's dueDate) rather than an hour. */
export function assigneeForResidentAt(
  schedules: CaregiverSchedule[], residentId: string, at: Date, timeZone?: string,
  defs?: ReadonlyArray<ShiftDef> | null,
): { caregiverStaffId: string; caregiverName?: string } | null {
  const pick = caregiversCoveringResidentAt(schedules, residentId, localMinutesOfDay(at, timeZone), at, timeZone, defs)[0];
  return pick ? { caregiverStaffId: pick.caregiverStaffId, caregiverName: pick.caregiverName } : null;
}

/**
 * The caregiver rostered for a resident on a SPECIFIC shift today, or null when
 * that shift has no coverage.
 *
 * Matched by CLOCK COVERAGE, not by key equality: an occurrence tagged "AM" is
 * owned by any caregiver whose window spans the AM hours — including a 12-hour Day
 * caregiver. Prefer {@link assigneeForResidentAtHour} when the caller knows the
 * occurrence's real hour; this overload exists for callers that only hold a shift tag.
 */
export function assigneeForResidentShift(
  schedules: CaregiverSchedule[], residentId: string, shift: ShiftKey, at: Date = new Date(), timeZone?: string,
  defs?: ReadonlyArray<ShiftDef> | null,
): { caregiverStaffId: string; caregiverName?: string } | null {
  // Probe half an hour into the requested window: interior to it, and — for a
  // wrapping shift — still on the roster row's OWN calendar date. (Probing the
  // middle of a Noc window would land at 03:00, which belongs to the PREVIOUS
  // day's roster row, and resolve the wrong caregiver.)
  return assigneeForResidentAtHour(schedules, residentId, (shiftMeta(shift, defs).startMin + 30) / 60, at, timeZone, defs);
}

// ── Break-glass (emergency off-assignment access) ─────────────────────────────
export interface BreakGlassGrant {
  id: string;
  caregiverUserId: string;
  caregiverName?: string;
  residentId: string;
  residentName?: string;
  reason: string;
  at: string;         // ISO granted-at
  expiresAt: string;  // ISO — end of the shift the grant was opened in
}

export function parseBreakglass(raw: string | undefined | null): BreakGlassGrant[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((g): g is BreakGlassGrant =>
      !!g && typeof g.caregiverUserId === "string" && typeof g.residentId === "string" && typeof g.expiresAt === "string");
  } catch {
    return [];
  }
}

/** Resident ids a caregiver has an UNEXPIRED break-glass grant for at `at`. */
export function activeBreakglassResidentIds(userId: string, grants: BreakGlassGrant[], at: Date): string[] {
  const ids = new Set<string>();
  for (const g of grants) {
    if (g.caregiverUserId === userId && new Date(g.expiresAt) > at) ids.add(g.residentId);
  }
  return [...ids];
}

/** End of the local calendar day `at` — a break-glass grant lives until then
 *  (matches the whole-day access model). */
export function endOfDay(at: Date): Date {
  const d = new Date(at);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** End of the 8-hour shift window `at` falls in (kept for reference / shift math). */
export function currentShiftEnd(at: Date, defs?: ReadonlyArray<ShiftDef> | null): Date {
  const nowMin = at.getHours() * 60 + at.getMinutes();
  const m = shiftMeta(shiftOwningMinutes(nowMin, defs), defs);
  const d = new Date(at);
  // A wrapping shift ends tomorrow when entered before midnight; after midnight its
  // end is still today.
  if (m.nextDay && nowMin >= m.startMin) d.setDate(d.getDate() + 1);
  d.setHours(Math.floor(m.endMin / 60), m.endMin % 60, 0, 0);
  return d;
}

// ── Local date helpers (calendar grid) ────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");
export const toDateStr = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = (): string => toDateStr(new Date());

/** Facility-local minutes-of-day (0–1439) of `at`. Server-local without a tz. */
export function localMinutesOfDay(at: Date, timeZone?: string): number {
  if (!timeZone) return at.getHours() * 60 + at.getMinutes();
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(at);
    const h = Number(parts.find((p) => p.type === "hour")?.value) % 24;
    const mi = Number(parts.find((p) => p.type === "minute")?.value);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(mi) ? mi : 0);
  } catch {
    return at.getHours() * 60 + at.getMinutes();
  }
}

/** YYYY-MM-DD `n` days after a calendar-date string (UTC math avoids tz drift). */
function addDays(dateStr: string, n: number): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (mo || 1) - 1, (d || 1) + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** YYYY-MM-DD for `at` in a given IANA time zone (falls back to server-local).
 *  en-CA formats as YYYY-MM-DD. Used server-side so "today" is the facility's
 *  calendar day, not the server's UTC day. */
export function localDateStr(at: Date, timeZone?: string): string {
  if (!timeZone) return toDateStr(at);
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return toDateStr(at);
  }
}
