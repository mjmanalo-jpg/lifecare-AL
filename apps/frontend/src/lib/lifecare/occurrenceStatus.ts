// SLMS v4.2 caregiver occurrence status (sub-project #4) — PURE display-state
// derivation extracted + generalised from TodaysCareBoard's window/item gate.
// Derives the live workflow state (Upcoming/Due/Overdue) of an atomic occurrence
// from its scheduled time + now (Asia/Manila), and counts a day's progress. The
// persisted Closed/Cancelled state (written by #3/#5) always wins.

import { countsAsCompleted, type WorkflowState, type CareOutcome } from "./vocab.ts";

// Reused from TodaysCareBoard. ponytail: flat grace; criticality-scaled grace is a #5 knob.
export const WINDOW_LEAD_MIN = 5;
export const OCCURRENCE_GRACE_MIN = 30;

const toMin = (hhmm: string): number => {
  const m = /(\d{1,2}):(\d{2})/.exec(hhmm || "");
  return m ? +m[1] * 60 + +m[2] : 0;
};

/** Minutes-from-midnight for "now" in Asia/Manila (fixed +08:00, no DST). Impure —
 * the UI calls this; pure logic takes nowMin so tests are deterministic. */
export function manilaMinutesNow(d: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const h = +(parts.find((p) => p.type === "hour")?.value || "0");
  const mi = +(parts.find((p) => p.type === "minute")?.value || "0");
  return (h % 24) * 60 + mi;
}

export interface OccLike {
  scheduledTime: string;
  workflowState?: string | null;
}

/** Derived display state. Persisted Closed/Cancelled short-circuit; an open row
 * derives Upcoming (before lead) / Due (in window+grace) / Overdue (past grace). */
export function deriveState(occ: OccLike, nowMin: number): WorkflowState {
  if (occ.workflowState === "Closed") return "Closed";
  if (occ.workflowState === "Cancelled") return "Cancelled";
  const sched = toMin(occ.scheduledTime);
  if (nowMin < sched - WINDOW_LEAD_MIN) return "Upcoming";
  if (nowMin <= sched + OCCURRENCE_GRACE_MIN) return "Due";
  return "Overdue";
}

/** A gated caregiver may chart from lead-before through past-grace (Due/Overdue). */
export function isChartable(occ: OccLike, nowMin: number): boolean {
  const s = deriveState(occ, nowMin);
  return s === "Due" || s === "Overdue";
}

/** True when charting now would be past the grace window (a "late" completion). */
export function isLate(occ: OccLike, nowMin: number): boolean {
  if (occ.workflowState === "Closed" || occ.workflowState === "Cancelled") return false;
  return nowMin > toMin(occ.scheduledTime) + OCCURRENCE_GRACE_MIN;
}

export interface ProgressRow {
  scheduledTime: string;
  workflowState?: string | null;
  careDeliveryOutcome?: string | null;
  escalationState?: string | null;
}

/**
 * Day progress. `completed` counts only rows whose outcome countsAsCompleted (so an
 * exception / "Not completed" never raises it); a Cancelled row is excluded from
 * `total`. `overdue` = derived-Overdue open rows; `pendingReview` = rows with a live
 * escalation awaiting the nurse.
 */
export function countProgress(rows: ProgressRow[], nowMin: number): {
  completed: number; total: number; overdue: number; pendingReview: number;
} {
  let completed = 0, total = 0, overdue = 0, pendingReview = 0;
  for (const r of rows) {
    if (r.workflowState === "Cancelled") continue;
    total += 1;
    if (r.careDeliveryOutcome && countsAsCompleted(r.careDeliveryOutcome as CareOutcome)) completed += 1;
    if (deriveState(r, nowMin) === "Overdue") overdue += 1;
    if (r.escalationState === "Pending acknowledgement" || r.escalationState === "Acknowledged") pendingReview += 1;
  }
  return { completed, total, overdue, pendingReview };
}
