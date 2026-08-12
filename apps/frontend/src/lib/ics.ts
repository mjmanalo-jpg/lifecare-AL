/**
 * iCalendar (RFC 5545) helpers shared by the client "Add to calendar" buttons
 * and the server subscription-feed route (`/api/calendar/[token]/appointments.ics`).
 *
 * No dependencies, no DB — pure string building so it runs in the browser and in
 * a Node route handler alike.
 */

export interface IcsEvent {
  /** Stable unique id for the VEVENT (dedupes across re-imports). */
  uid: string;
  /** Event start (ISO string or Date). */
  start: string | Date;
  /** Event end (ISO string or Date). Defaults to start + 60min when omitted. */
  end?: string | Date | null;
  summary: string;
  description?: string;
  location?: string;
}

/** Escape TEXT values per RFC 5545 §3.3.11 (\, ; , and newlines). */
export function escapeIcsText(value: string): string {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Format a Date/ISO as a UTC timestamp: YYYYMMDDTHHMMSSZ. */
export function toIcsUtc(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/** Fold long content lines to 75 octets per RFC 5545 §3.1 (best-effort, char-based). */
function foldLine(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 74));
  rest = rest.slice(74);
  while (rest.length > 0) {
    parts.push(" " + rest.slice(0, 73));
    rest = rest.slice(73);
  }
  return parts.join("\r\n");
}

function buildEvent(ev: IcsEvent, stamp: string): string {
  const start = ev.start instanceof Date ? ev.start : new Date(ev.start);
  const end = ev.end ? (ev.end instanceof Date ? ev.end : new Date(ev.end)) : new Date(start.getTime() + 60 * 60 * 1000);
  const lines = [
    "BEGIN:VEVENT",
    `UID:${ev.uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${escapeIcsText(ev.summary)}`,
  ];
  if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
  if (ev.location) lines.push(`LOCATION:${escapeIcsText(ev.location)}`);
  lines.push("END:VEVENT");
  return lines.map(foldLine).join("\r\n");
}

/** Build a full VCALENDAR document from a list of events. */
export function buildIcsCalendar(events: IcsEvent[], calendarName = "Appointments"): string {
  const stamp = toIcsUtc(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Assisted Living//Appointment Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    "X-PUBLISHED-TTL:PT1H",
    ...events.map((ev) => buildEvent(ev, stamp)),
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}

/** A single-event .ics document (for a per-appointment download). */
export function buildIcsEvent(event: IcsEvent, calendarName = "Appointment"): string {
  return buildIcsCalendar([event], calendarName);
}

/** Google Calendar "add event" template URL for a single event. */
export function googleCalendarUrl(ev: IcsEvent): string {
  const start = ev.start instanceof Date ? ev.start : new Date(ev.start);
  const end = ev.end ? (ev.end instanceof Date ? ev.end : new Date(ev.end)) : new Date(start.getTime() + 60 * 60 * 1000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.summary,
    dates: `${toIcsUtc(start)}/${toIcsUtc(end)}`,
  });
  if (ev.description) params.set("details", ev.description);
  if (ev.location) params.set("location", ev.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
