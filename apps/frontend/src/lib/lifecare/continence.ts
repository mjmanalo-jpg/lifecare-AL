// SLMS v4.2 — AS-10 diaper-need signal + its every-4h continence-care schedule.
//
// Client rule (2026-09): when AS-10 (Continence / Toileting) supporting evidence
// flags that the resident needs a diaper, the plan adds a dedicated continence /
// diaper-care event EVERY 4 HOURS — round-the-clock, because skin protection needs
// night checks too. This module is the ONE source of truth shared by the routine
// engine (assembleRoutine24h) and the care-plan generator (generateCarePlanFromV42)
// so both agree on the trigger word and the interval.

/** Quick-add chip shown under AS-10 Supporting Evidence. */
export const DIAPER_EVIDENCE_TAG = "Needs diaper";
/** q4h — the whole point of the client rule. */
export const DIAPER_INTERVAL_HOURS = 4;
/** Human-facing frequency shown on the care-plan intervention line. */
export const DIAPER_FREQUENCY_LABEL = "Every 4 hours";

/** True when AS-10 supporting evidence indicates the resident is in diapers. */
export function needsDiaper(evidence?: string | null): boolean {
  return /diaper/i.test(evidence ?? "");
}

// ── self-check ───────────────────────────────────────────────────────────────
export function demo(): void {
  const assert = (c: boolean, m: string) => { if (!c) throw new Error(`continence demo: ${m}`); };
  assert(needsDiaper("Needs diaper, 6 episodes/24h"), "detects the chip tag");
  assert(needsDiaper("uses DIAPER at night"), "case-insensitive");
  assert(!needsDiaper("Continence status, toileting needs"), "no false positive");
  assert(!needsDiaper(undefined) && !needsDiaper(""), "empty is false");
}
