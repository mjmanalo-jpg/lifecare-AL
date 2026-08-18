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

/** A user's events on a given local day (YYYY-MM-DD). */
export function eventsOnDay(events: ClockEvent[], userId: string, dayISO: string): ClockEvent[] {
  return eventsFor(events, userId).filter((e) => localDay(e.at) === dayISO);
}

export function localDay(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
