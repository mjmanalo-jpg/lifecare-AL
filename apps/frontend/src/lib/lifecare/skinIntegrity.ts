// SLMS v4.2 — AS-11 repositioning signal + its every-2h pressure off-load schedule.
//
// Client rule (2026-09): when AS-11 (Skin Integrity) supporting evidence flags a
// repositioning need (bedbound / pressure-injury risk), the plan adds a dedicated
// repositioning / pressure off-load event EVERY 2 HOURS — the standard-of-care
// interval for pressure-injury prevention, round-the-clock. Sibling of continence.ts
// (AS-10 diaper q4h); shared by assembleRoutine24h and generateCarePlanFromV42.

/** Quick-add chip shown under AS-11 Supporting Evidence. */
export const REPOSITION_EVIDENCE_TAG = "Repositioning q2h";
/** q2h — pressure-injury prevention standard. */
export const REPOSITION_INTERVAL_HOURS = 2;
/** Human-facing frequency shown on the care-plan intervention line. */
export const REPOSITION_FREQUENCY_LABEL = "Every 2 hours";

/** True when AS-11 supporting evidence indicates a scheduled repositioning need. */
export function needsRepositioning(evidence?: string | null): boolean {
  return /reposition/i.test(evidence ?? "");
}

// ── self-check ───────────────────────────────────────────────────────────────
export function demo(): void {
  const assert = (c: boolean, m: string) => { if (!c) throw new Error(`skinIntegrity demo: ${m}`); };
  assert(needsRepositioning("Repositioning q2h, bedbound"), "detects the chip tag");
  assert(needsRepositioning("needs REPOSITION off-load"), "case-insensitive");
  assert(!needsRepositioning("Pressure injury risk, skin monitoring"), "no false positive without reposition intent");
  assert(!needsRepositioning(undefined) && !needsRepositioning(""), "empty is false");
}
