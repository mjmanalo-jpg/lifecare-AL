// Wiring the v4.2 Final LOC into the production flow.
// Pure helpers that translate a validated assessment's Final LOC into the
// downstream artefacts the existing app already consumes:
//   - resident.careLevel enum (INDEPENDENT / ASSISTED / MEMORY / SKILLED)
//   - numeric level 1-5 for /api/billing/loc-charge (engine-A output)
//   - whether a care plan should be (re)generated
// Governance invariants are respected by the callers (no auto-fee change unless
// human-authorised; DRAFT-until-approved for the generated plan).

import type { CareLevel } from "./types.ts";
import { canLowerLevel, feeOrLevelChangeAllowed } from "./governance.ts";

export type CareLevelEnum = "INDEPENDENT" | "ASSISTED" | "MEMORY" | "SKILLED";

/** Numeric rank 1-5 for a CareLevel (for /api/billing/loc-charge). */
export function levelRank(level: CareLevel): number {
  return { L1: 1, L2: 2, L3: 3, L4: 4, L5: 5 }[level];
}

/**
 * Map Final LOC to the resident.careLevel enum. Mirrors the existing Care
 * Acuity board mapping so v4.2 and the legacy acuity board stay consistent:
 * L1 independent, L2/L3 assisted, L4 memory/comprehensive, L5 skilled/palliative.
 */
export function careLevelEnum(level: CareLevel): CareLevelEnum {
  switch (level) {
    case "L1": return "INDEPENDENT";
    case "L2": return "ASSISTED";
    case "L3": return "ASSISTED";
    case "L4": return "MEMORY";
    case "L5": return "SKILLED";
  }
}

export interface DownstreamPlan {
  residentId: string;
  level: CareLevel;
  numericLevel: number;
  careLevelEnum: CareLevelEnum;
  /** post an LOC charge (engine-A). Never auto-applied without an authorised approval upstream. */
  postLocCharge: boolean;
  /** (re)generate a care plan from the assessment. */
  generatePlan: boolean;
}

/**
 * Compute the downstream actions for a validated v4.2 assessment. Returns null
 * when there is no resident link or no Final LOC (nothing to apply yet).
 */
export function downstreamForAssessment(input: {
  residentId?: string;
  finalLevel?: CareLevel | null;
  validated: boolean;
}): DownstreamPlan | null {
  if (!input.residentId || !input.finalLevel || !input.validated) return null;
  return {
    residentId: input.residentId,
    level: input.finalLevel,
    numericLevel: levelRank(input.finalLevel),
    careLevelEnum: careLevelEnum(input.finalLevel),
    postLocCharge: true,
    generatePlan: true,
  };
}

export interface LocApplication {
  residentId: string;
  level: CareLevel;
  numericLevel: number;
  careLevelEnum: CareLevelEnum;
  /** May we set resident.careLevel from this validated Final LOC? */
  apply: boolean;
  /** May we post the LOC fee? Only with an explicit human authoriser (no auto-fee). */
  postLocCharge: boolean;
  /** (Re)generate the care plan — always as a DRAFT the nurse individualises. */
  generatePlan: boolean;
  /** Whether the new level is lower than the prior recorded level. */
  isDowngrade: boolean;
  /** Why apply/charge were withheld (surface to the clinician), if blocked. */
  blockedReason?: string;
}

/**
 * Governed decision for applying a validated Final LOC downstream. Enforces the
 * plan's invariants in the runtime path (not just in tests):
 *   • No auto-fee/level change — an explicit human authoriser is required
 *     (feeOrLevelChangeAllowed / CL-19).
 *   • A downgrade requires a fresh, authorised reassessment (canLowerLevel /
 *     CL-21) — otherwise the level change and charge are withheld and the reason
 *     is surfaced for the clinician.
 * Returns null when there is nothing to apply yet (no resident link / level, or
 * not validated).
 */
export function decideLocApplication(input: {
  residentId?: string;
  finalLevel?: CareLevel | null;
  priorLevel?: CareLevel | null;
  validated: boolean;
  reassessed?: boolean;
  authorisedBy?: string;
}): LocApplication | null {
  if (!input.residentId || !input.finalLevel || !input.validated) return null;
  const level = input.finalLevel;

  const isDowngrade = !!input.priorLevel && levelRank(level) < levelRank(input.priorLevel);
  const downgradeOk = !isDowngrade ||
    canLowerLevel(input.priorLevel as CareLevel, level, { reassessed: !!input.reassessed, approvedBy: input.authorisedBy });
  const authorised = feeOrLevelChangeAllowed({ reason: "MANUAL_AUTHORISED", authorisedBy: input.authorisedBy });

  const apply = authorised && downgradeOk;
  const blockedReason = !authorised
    ? "LOC fee/level change needs an explicit authoriser (no auto-fee — CL-19)."
    : !downgradeOk
      ? "A downgrade requires a fresh, authorised reassessment (CL-21)."
      : undefined;

  return {
    residentId: input.residentId,
    level,
    numericLevel: levelRank(level),
    careLevelEnum: careLevelEnum(level),
    apply,
    postLocCharge: apply,
    generatePlan: apply,
    isDowngrade,
    blockedReason,
  };
}
