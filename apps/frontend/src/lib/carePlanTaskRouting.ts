import type { ShiftKey } from "./caregiverSchedule";

/**
 * Frequency → per-shift occurrences for the care-plan task materializer.
 *
 * A care-plan intervention carries a frequency (Daily / BID / TID / Every shift /
 * Weekly / PRN). This turns that into the concrete task cards for one day, each
 * tagged with the SHIFT it belongs to so the materializer can route it to the
 * caregiver rostered for that shift:
 *
 *   • Every shift        → AM 08:00 · PM 16:00 · NOC 23:00   (one per shift)
 *   • Twice daily (BID)  → AM 08:00 · PM 18:00
 *   • Three times (TID)  → AM 08:00 · PM 14:00 · PM 20:00    (PM shift gets two)
 *   • Daily / Per plan / Weekly → single card, AM shift, due end of AM shift (14:00)
 *   • PRN / as needed    → none (created on demand, never auto-materialized)
 *
 * Weekly's anchor-day check stays in the materializer (it needs the plan's start
 * weekday); everything else about "how many cards, which shift, what hour" lives
 * here so it is unit-testable without a database.
 */
export type Occurrence = { label: string; hour: number; shift: ShiftKey };

export function occurrencesFor(freq: string): Occurrence[] {
  const f = freq.toLowerCase();
  if (/prn|as needed/.test(f)) return []; // on-demand only
  if (/every shift/.test(f)) return [
    { label: "AM", hour: 8, shift: "AM" },
    { label: "PM", hour: 16, shift: "PM" },
    { label: "NOC", hour: 23, shift: "NOC" },
  ];
  if (/\btid\b|three times/.test(f)) return [
    { label: "Morning", hour: 8, shift: "AM" },
    { label: "Afternoon", hour: 14, shift: "PM" },
    { label: "Evening", hour: 20, shift: "PM" },
  ];
  if (/\bbid\b|twice/.test(f)) return [
    { label: "AM", hour: 8, shift: "AM" },
    { label: "PM", hour: 18, shift: "PM" },
  ];
  // Single-occurrence work (Daily / Per care plan / Weekly) defaults to the AM
  // shift's caregiver, due by the end of the AM shift (14:00).
  return [{ label: "", hour: 14, shift: "AM" }];
}
