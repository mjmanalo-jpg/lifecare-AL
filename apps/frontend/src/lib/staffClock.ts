/**
 * Staff clock in/out events — the verified attendance log. Migration-free JSON
 * array in the app-setting `staff_clock_events`. Each event records who, when,
 * the action, and the facial + geofence verification outcome for audit.
 */

export const STAFF_CLOCK_KEY = "staff_clock_events";

export type ClockType = "IN" | "OUT";

export interface ClockEvent {
  id: string;
  userId: string;
  name: string;
  role: string;
  type: ClockType;
  at: string;                 // ISO
  faceOk?: boolean;
  faceDistance?: number;      // face-api euclidean distance (lower = closer match)
  geoOk?: boolean;
  geoDistanceM?: number;      // metres from the facility centre
  lat?: number;
  lng?: number;
}

export function parseClockEvents(raw: string | null | undefined): ClockEvent[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((e) => e && typeof e.id === "string") : [];
  } catch {
    return [];
  }
}

/** Events for one user, newest first. */
export function eventsFor(events: ClockEvent[], userId: string): ClockEvent[] {
  return events.filter((e) => e.userId === userId).sort((a, b) => (b.at || "").localeCompare(a.at || ""));
}

export function lastEventFor(events: ClockEvent[], userId: string): ClockEvent | null {
  return eventsFor(events, userId)[0] ?? null;
}

/** On duty when the most recent event is a clock-IN. */
export function isOnDuty(events: ClockEvent[], userId: string): boolean {
  return lastEventFor(events, userId)?.type === "IN";
}

/**
 * Everyone currently on the floor, for a shift-bounded attendance window.
 *
 * `isOnDuty` answers "is this user's latest event an IN?" — correct for the staffer's
 * own view, but it also reports someone who clocked in days ago and never clocked out
 * as present. A shift dashboard needs presence bounded to the active window, so an IN
 * older than `windowStart` is treated as stale rather than staffing.
 *
 * Latest-event-wins per user, computed without assuming array order. Returns the
 * winning IN event per user so callers can read the recorded name/role too.
 */
export function onDutyFromClockLog(events: ClockEvent[], windowStart: Date): Map<string, ClockEvent> {
  const latest = new Map<string, ClockEvent>();
  for (const e of events) {
    if (!e?.userId || (e.type !== "IN" && e.type !== "OUT")) continue;
    if (Number.isNaN(new Date(e.at || "").getTime())) continue;
    const prev = latest.get(e.userId);
    if (!prev || (e.at || "") > (prev.at || "")) latest.set(e.userId, e);
  }
  const onDuty = new Map<string, ClockEvent>();
  const floor = windowStart.getTime();
  for (const [userId, e] of latest) {
    if (e.type === "IN" && new Date(e.at).getTime() >= floor) onDuty.set(userId, e);
  }
  return onDuty;
}

/** A user's events on a given local day (YYYY-MM-DD). */
export function eventsOnDay(events: ClockEvent[], userId: string, dayISO: string): ClockEvent[] {
  return eventsFor(events, userId).filter((e) => localDay(e.at) === dayISO);
}

export function localDay(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
