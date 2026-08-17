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
/** Break-glass grants are hidden from the client (`__` prefix — the generic
 *  /api/db route filters those out) and written only by the dedicated endpoint. */
export const CAREGIVER_BREAKGLASS_KEY = "__caregiver_breakglass";

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

/** End of the shift window `at` falls in — a break-glass grant lives until then. */
export function currentShiftEnd(at: Date): Date {
  const h = at.getHours();
  const d = new Date(at);
  if (h >= 6 && h < 14) { d.setHours(14, 0, 0, 0); return d; }   // AM → 14:00
  if (h >= 14 && h < 22) { d.setHours(22, 0, 0, 0); return d; }  // PM → 22:00
  if (h >= 22) { d.setDate(d.getDate() + 1); d.setHours(6, 0, 0, 0); return d; } // Noc → next 06:00
  d.setHours(6, 0, 0, 0); return d;                              // 0–5 → Noc end 06:00
}

// ── Local date helpers (calendar grid) ────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");
export const toDateStr = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = (): string => toDateStr(new Date());
