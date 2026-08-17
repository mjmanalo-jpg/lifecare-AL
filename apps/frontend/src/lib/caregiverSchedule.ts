/**
 * Caregiver scheduling — shared types + helpers.
 *
 * A schedule entry assigns ONE caregiver to a GROUP of residents for a single
 * date + shift (AM / PM / NOC). Stored migration-free as an app-setting JSON
 * array under `caregiver_schedules` (see the Prisma-migration constraint).
 *
 * Phase 1 (this file + CaregiverScheduleBoard) only reads/writes the roster.
 * Phase 2's server-side access lock (tenant.ts) reuses `activeResidentIdsFor`
 * to resolve which residents a caregiver may see *right now* — so the shift
 * window logic lives here, in one place, shared by client and server.
 */

export const CAREGIVER_SCHEDULE_KEY = "caregiver_schedules";

export type ShiftKey = "AM" | "PM" | "NOC";

/** Assignable shifts. Windows mirror TaskAssignmentBoard: AM 6a–2p, PM 2p–10p,
 *  Noc 10p–6a (spills into the next calendar day). */
export const SHIFTS: ReadonlyArray<{
  key: ShiftKey; label: string; range: string; startH: number; endH: number; nextDay: boolean;
}> = [
  { key: "AM",  label: "AM Shift",  range: "6:00 – 14:00",  startH: 6,  endH: 14, nextDay: false },
  { key: "PM",  label: "PM Shift",  range: "14:00 – 22:00", startH: 14, endH: 22, nextDay: false },
  { key: "NOC", label: "Noc Shift", range: "22:00 – 6:00",  startH: 22, endH: 6,  nextDay: true  },
];

export const shiftMeta = (shift: ShiftKey) => SHIFTS.find((s) => s.key === shift) ?? SHIFTS[0];

export interface CaregiverSchedule {
  id: string;
  date: string;            // YYYY-MM-DD (local calendar date the shift starts)
  shift: ShiftKey;
  caregiverStaffId: string;
  caregiverUserId?: string; // resolved so the server lock can match by session userId
  caregiverName: string;
  residentIds: string[];
  note?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
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

/** Local Date range [start, end) a schedule's shift occupies. */
export function shiftWindow(date: string, shift: ShiftKey): { start: Date; end: Date } {
  const m = shiftMeta(shift);
  const [y, mo, d] = date.split("-").map(Number);
  const start = new Date(y, (mo || 1) - 1, d || 1, m.startH, 0, 0, 0);
  const end = new Date(y, (mo || 1) - 1, (d || 1) + (m.nextDay ? 1 : 0), m.endH, 0, 0, 0);
  return { start, end };
}

/** True when `at` falls inside the schedule entry's shift window. */
export function isScheduleActiveAt(s: CaregiverSchedule, at: Date): boolean {
  const { start, end } = shiftWindow(s.date, s.shift);
  return at >= start && at < end;
}

/**
 * Resident ids a caregiver (by session userId) is actively assigned to at `at`.
 * This is the authority for Phase 2's "only during the shift" access boundary.
 */
export function activeResidentIdsFor(userId: string, schedules: CaregiverSchedule[], at: Date): string[] {
  const ids = new Set<string>();
  for (const s of schedules) {
    if (s.caregiverUserId && s.caregiverUserId === userId && isScheduleActiveAt(s, at)) {
      s.residentIds.forEach((r) => ids.add(r));
    }
  }
  return [...ids];
}

// ── Local date helpers (calendar grid) ────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");
export const toDateStr = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = (): string => toDateStr(new Date());
