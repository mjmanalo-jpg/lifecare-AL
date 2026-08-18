/**
 * MAR strict administration window — shared by both MAR boards (MARDailyBoard's
 * derived-slot view and MARBoard's scheduled-row table).
 *
 * A dose may be given within ±MAR_WINDOW_MIN of its scheduled time. Earlier is
 * blocked; later is allowed but flagged "Late". Comparison is against the real
 * clock, so a future-dated dose reads EARLY (blocked) and a past-dated one reads
 * LATE (back-documentation). PRN has no window (callers skip it).
 */

export const MAR_WINDOW_MIN = 60;

export type DosePhase = "EARLY" | "OPEN" | "LATE";
export interface DoseWindow {
  phase: DosePhase;
  scheduledMs: number;
  openMs: number;
  closeMs: number;
}

/** Classify an absolute scheduled timestamp against now. */
export function classifyDoseWindow(scheduledMs: number, nowMs: number): DoseWindow {
  const openMs = scheduledMs - MAR_WINDOW_MIN * 60_000;
  const closeMs = scheduledMs + MAR_WINDOW_MIN * 60_000;
  const phase: DosePhase = nowMs < openMs ? "EARLY" : nowMs > closeMs ? "LATE" : "OPEN";
  return { phase, scheduledMs, openMs, closeMs };
}

/** Friendly 12-hour time from an absolute timestamp (e.g. "7:00 AM"). */
export function fmtWindowTime(ms: number): string {
  const d = new Date(ms);
  if (isNaN(d.getTime())) return "";
  let h = d.getHours(); const m = d.getMinutes();
  const ampm = h < 12 ? "AM" : "PM"; h = h % 12 === 0 ? 12 : h % 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}
