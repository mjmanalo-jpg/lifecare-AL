// Care owed in a window, from the routine engine.
//
// Care reaches the record by two paths: Task completion and RoutineOccurrence closes
// (Today's Care). The delivery metrics count BOTH, so this rule lives in one place —
// the metric card and its drill-down both read it, and can no longer disagree about
// what was owed.

import { localDateStr, localMinutesOfDay, zonedInstant } from "@/lib/caregiverSchedule";
import { countsAsCompleted, type CareOutcome } from "@/lib/lifecare/vocab";
import { isMissed, toMin } from "@/lib/lifecare/occurrenceStatus";

export interface DeliveryOccurrence {
  careDate: Date;
  scheduledTime: string;
  workflowState?: string | null;
  careDeliveryOutcome?: string | null;
  /** Sets the charting window (isMissed): nurse-owned rows are +30 min, hands-on
   *  care has the rest of its shift. Absent → treated as caregiver-delivered. */
  definition?: { responsibleRole?: string | null } | null;
}

/**
 * The true instant an occurrence's scheduled slot falls on. careDate is the care day's
 * FACILITY midnight, so its UTC date prefix is the previous day — resolve the day in
 * the facility zone, then rebuild the wall-clock time there too.
 */
export function occurrenceInstant(careDay: string, scheduledTime: string, timeZone?: string): number {
  const mins = toMin(scheduledTime);
  return zonedInstant(careDay, Math.floor(mins / 60), timeZone).getTime() + (mins % 60) * 60_000;
}

/**
 * Occurrences OWED inside `[from, to)` — window already passed, or the row is already
 * charted — each tagged with whether it counts as delivered. Care whose window has not
 * opened yet is not owed: a task due later this shift is not a failure.
 */
export function owedOccurrences<T extends DeliveryOccurrence>(
  occurrences: readonly T[],
  { from, to, now, timeZone }: { from: Date; to: Date; now: Date; timeZone?: string },
): Array<{ occurrence: T; slot: number; delivered: boolean }> {
  const today = localDateStr(now, timeZone);
  const nowMinutes = localMinutesOfDay(now, timeZone);
  const owed: Array<{ occurrence: T; slot: number; delivered: boolean }> = [];
  for (const occurrence of occurrences) {
    if (occurrence.workflowState === "Cancelled") continue;
    const careDay = localDateStr(occurrence.careDate, timeZone);
    const slot = occurrenceInstant(careDay, occurrence.scheduledTime, timeZone);
    if (slot < from.getTime() || slot >= to.getTime()) continue;
    // Day comparison is a plain string compare of facility calendar days — no clock
    // arithmetic to drift.
    const dayCmp = careDay === today ? 0 : careDay < today ? -1 : 1;
    if (!isMissed(occurrence, nowMinutes, dayCmp) && occurrence.workflowState !== "Closed") continue;
    owed.push({
      occurrence,
      slot,
      delivered: Boolean(occurrence.careDeliveryOutcome)
        && countsAsCompleted(occurrence.careDeliveryOutcome as CareOutcome),
    });
  }
  return owed;
}
