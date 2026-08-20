// Scheduled LOC reassessment cadence (DT-012 support).
//
// A Level of Care must be re-confirmed on a cadence that tightens with acuity.
// This is the data the reassessment-due cron uses to flag residents whose LOC
// review has come due, so the loop that "keeps the level honest" isn't purely
// event-driven. Tunable; migration-free (reads existing loc_history dates).

import type { CareLevel } from "./types.ts";

/** Days between LOC reassessments per level — higher acuity, shorter interval. */
export const REASSESSMENT_INTERVAL_DAYS: Record<CareLevel, number> = {
  L1: 365, // stable / independent — annual
  L2: 180, // low assist — semi-annual
  L3: 90,  // moderate — quarterly
  L4: 90,  // comprehensive — quarterly
  L5: 30,  // palliative / skilled — monthly
};

const DAY = 86_400_000;

export interface ReassessmentStatus {
  level: CareLevel;
  lastAssessedISO: string;
  dueISO: string;
  overdue: boolean;
  /** Days until due (negative once overdue). */
  daysUntilDue: number;
  /** Whole days overdue (0 when not overdue). */
  daysOverdue: number;
}

/**
 * Compute the reassessment-due status for a resident from their last LOC date.
 * `nowISO` is injectable for deterministic tests. Returns null on a bad date.
 */
export function reassessmentStatus(input: {
  level: CareLevel;
  lastAssessedISO: string;
  nowISO?: string;
  intervalDays?: Partial<Record<CareLevel, number>>;
}): ReassessmentStatus | null {
  const last = new Date(input.lastAssessedISO);
  if (Number.isNaN(last.getTime())) return null;
  const interval = input.intervalDays?.[input.level] ?? REASSESSMENT_INTERVAL_DAYS[input.level];
  const due = new Date(last.getTime() + interval * DAY);
  const now = input.nowISO ? new Date(input.nowISO) : new Date();
  const deltaMs = due.getTime() - now.getTime();
  const overdue = deltaMs < 0;
  return {
    level: input.level,
    lastAssessedISO: input.lastAssessedISO,
    dueISO: due.toISOString(),
    overdue,
    daysUntilDue: Math.ceil(deltaMs / DAY),
    daysOverdue: overdue ? Math.floor(-deltaMs / DAY) : 0,
  };
}
