// Phase 1 — Classification rule engine.
//
// INVARIANTS (enforced here):
//  * Score is advisory; rules classify. 19 Minimum-Level Rules (floors) + 13
//    Clinical Modifiers + clinical override produce the level.
//  * Auto score->level banding stays behind SCORE_BANDING_ENABLED=false until
//    LifeCare clinicians calibrate the 56-point thresholds (GAP-001). The
//    deterministic MLR-floor + modifier + override + L5-pathway engine drives
//    classification regardless; the raw /56 and legacy band are advisory only.
//  * Three separate engines: Level of Care (LOC) != Private Caregiver (DT-013)
//    != Additional Clinical Services (DT-014). This module emits the LOC result
//    plus DT-013 / DT-014 *review recommendations* only — it never decides them.
//  * Score the intrinsic need — a current private caregiver/family must not lower
//    the assessed dependency (the caller supplies intrinsic scores).
//
// Verified against the workbook "Level of Care Validation" sheet (LOC-001..018)
// by tests/lifecare-classification.test.ts.

import { MODEL_VERSION } from "./dataset.ts";
import {
  DOMAIN_CODES, BASIC_ADL,
  type CareLevel, type DomainCode, type DomainScores, type ClinicalContext,
  type AppliedMlr, type ClassificationResult, type DtRecommendation,
} from "./types.ts";

const LEVEL_RANK: Record<CareLevel, number> = { L1: 1, L2: 2, L3: 3, L4: 4, L5: 5 };

function maxLevel(a: CareLevel | null, b: CareLevel | null): CareLevel | null {
  if (!a) return b;
  if (!b) return a;
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

/** Read a domain score, defaulting missing to 0. */
function s(scores: DomainScores, code: DomainCode): number {
  const v = scores[code];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function rawScore(scores: DomainScores): number {
  return DOMAIN_CODES.reduce((sum, code) => sum + s(scores, code), 0);
}

/**
 * Advisory legacy band (provisional; NOT production per GAP-001). Reuses the
 * existing calibrated legacy mapping applied to /56: L1 0-10, L2 11-20,
 * L3 21-30, L4 31+. L5 is never assigned from a score — it is a separate
 * authorized pathway only.
 */
export function advisoryBand(raw: number): CareLevel {
  if (raw <= 10) return "L1";
  if (raw <= 20) return "L2";
  if (raw <= 30) return "L3";
  return "L4";
}

/** Count basic ADL domains at/above a threshold. */
function countBasicAdl(scores: DomainScores, threshold: number): number {
  return BASIC_ADL.filter((c) => s(scores, c) >= threshold).length;
}

/** Count of all scored domains at/above a threshold. */
function countDomains(scores: DomainScores, threshold: number): number {
  return DOMAIN_CODES.filter((c) => s(scores, c) >= threshold).length;
}

function anyDomain(scores: DomainScores, threshold: number): boolean {
  return DOMAIN_CODES.some((c) => s(scores, c) >= threshold);
}

/**
 * Evaluate all 19 Minimum-Level Rules against the assessment. Each returns its
 * floor (or null for modifier-only rules). The engine takes the highest floor;
 * higher base always wins ("Floor only; no duplicate points").
 */
export function evaluateMlr(scores: DomainScores, ctx: ClinicalContext): AppliedMlr[] {
  const applied: AppliedMlr[] = [];
  const add = (id: string, level: CareLevel | null, need: string) =>
    applied.push({ id, minimumLevel: level, criticalNeed: need });

  const cln = !!ctx.recentHospitalization; // MOD-CLN-01 makes clinical elevation temporary

  // MLR-001 — Regular assistance across multiple basic ADLs -> L2
  if (countBasicAdl(scores, 2) >= 2) add("MLR-001", "L2", "Regular assistance across multiple basic ADLs");
  // MLR-002 — Regular transfer/ambulation assistance -> L2
  if (s(scores, "AS-02") >= 2) add("MLR-002", "L2", "Regular transfer or ambulation assistance");
  // MLR-003 — Extensive assistance across multiple ADLs -> L3
  //   Extensive support must span the core hands-on ADL domains (personal care
  //   AS-01 or toileting AS-10) — a single very-high nutrition/other score alone
  //   is not "extensive across multiple ADLs" (guards LOC-010 dysphagia at L2).
  if ((s(scores, "AS-01") >= 3 || s(scores, "AS-10") >= 3) && countBasicAdl(scores, 2) >= 3)
    add("MLR-003", "L3", "Extensive assistance across multiple ADLs");
  // MLR-004 — High fall risk alone -> modifier only (no floor)
  if (s(scores, "AS-03") >= 3) add("MLR-004", null, "High fall risk (modifier only)");
  // MLR-005 — High fall risk + transfer assist / unsafe judgment -> L2
  if (s(scores, "AS-03") >= 3 && (s(scores, "AS-02") >= 2 || s(scores, "AS-13") >= 2 || s(scores, "AS-04") >= 2))
    add("MLR-005", "L2", "High fall risk + transfer assistance/unsafe judgment");
  // MLR-006 — Extensive mobility dependence / complex transfers -> L3
  if (s(scores, "AS-02") >= 3) add("MLR-006", "L3", "Extensive mobility dependence / complex transfers");
  // MLR-007 — Dysphagia / swallowing precautions -> modifier only
  if (ctx.dysphagia) add("MLR-007", null, "Dysphagia / swallowing precautions (modifier only)");
  // MLR-008 — Significant nutrition/hydration risk -> L2
  if (s(scores, "AS-08") >= 3) add("MLR-008", "L2", "Significant nutrition/hydration risk");
  // MLR-009 — Complex/high-risk medication support -> modifier only
  if (s(scores, "AS-07") >= 3) add("MLR-009", null, "Complex/high-risk medication support (modifier only)");
  // MLR-010 — Substantial cognitive impairment requiring regular supervision -> L3
  if (s(scores, "AS-04") >= 3) add("MLR-010", "L3", "Substantial cognitive impairment requiring regular supervision");
  // MLR-011 — Pervasive cognitive/behavioral supervision -> L4
  if (s(scores, "AS-04") >= 4 || s(scores, "AS-05") >= 4 || s(scores, "AS-13") >= 4 ||
      (s(scores, "AS-04") >= 3 && s(scores, "AS-13") >= 3))
    add("MLR-011", "L4", "Pervasive cognitive/behavioral supervision");
  // MLR-012 — Active skin breakdown / wound -> modifier / clinical pathway
  if (s(scores, "AS-11") >= 2) add("MLR-012", null, "Active skin breakdown / wound (modifier/clinical pathway)");
  // MLR-013 — Pressure injury risk + >=2 cross-domain contributors -> L3
  if (s(scores, "AS-11") >= 2 &&
      (["AS-02", "AS-08", "AS-10"] as DomainCode[]).filter((c) => s(scores, c) >= 2).length >= 2)
    add("MLR-013", "L3", "Pressure injury risk + major cross-domain contributors");
  // MLR-014 — Frequent clinical monitoring / multi-condition complexity -> L3
  //   (suppressed when the elevation is a temporary post-hospital MOD-CLN-01 case)
  if (s(scores, "AS-06") >= 3 && !cln) add("MLR-014", "L3", "Frequent clinical monitoring / multi-condition complexity");
  // MLR-015 — Acute instability / rapidly changing condition -> clinical override / capability gate
  if (ctx.acuteInstability) add("MLR-015", null, "Acute instability / rapidly changing condition (override/capability gate)");
  // MLR-016 — Near-total functional dependency + substantial supervision -> L4
  if ((s(scores, "AS-01") >= 4 || s(scores, "AS-02") >= 4 || s(scores, "AS-10") >= 4) && s(scores, "AS-13") >= 3)
    add("MLR-016", "L4", "Near-total functional dependency + substantial supervision");
  // MLR-017 — Multi-domain deterioration (>=3 domains material) -> L3 (reassessment floor)
  if (countDomains(scores, 3) >= 3) add("MLR-017", "L3", "Multi-domain deterioration");
  // MLR-018 — Comfort/palliative/end-of-life pathway -> L5 (separate from dependency score)
  if (ctx.l5PathwayAuthorized) add("MLR-018", "L5", "Comfort/palliative/end-of-life pathway");
  // MLR-019 — Sustained comprehensive multi-domain complexity -> L4 (after review)
  if (countDomains(scores, 3) >= 4 && anyDomain(scores, 4) &&
      (s(scores, "AS-01") >= 3 || s(scores, "AS-06") >= 3 || s(scores, "AS-13") >= 3))
    add("MLR-019", "L4", "Sustained comprehensive multi-domain complexity");

  return applied;
}

/**
 * Modifier engine — 13 clinical modifiers auto-suggested from scores/context.
 * Modifiers drive care-plan/task/DT effects; they never inflate the score
 * (CL-19). The nurse reconciles every flagged modifier before LOC sign-off.
 */
export function suggestModifiers(scores: DomainScores, ctx: ClinicalContext): string[] {
  const m = new Set<string>();
  if (s(scores, "AS-03") >= 3) m.add("MOD-MOB-01"); // high fall risk
  if (s(scores, "AS-02") >= 2) m.add("MOD-MOB-02"); // reduced transfer ability
  if (s(scores, "AS-04") >= 2) m.add("MOD-COG-01"); // cognitive impairment
  if (s(scores, "AS-05") >= 2) m.add("MOD-COG-02"); // behavioral symptoms
  if (s(scores, "AS-07") >= 3) m.add("MOD-MED-01"); // medication complexity
  if (ctx.dysphagia) m.add("MOD-NUT-01"); // swallowing/dysphagia
  if (s(scores, "AS-08") >= 2) m.add("MOD-NUT-02"); // poor intake / dehydration risk
  if (ctx.weightLoss) m.add("MOD-NUT-03"); // unintended weight loss
  if (ctx.recentHospitalization) m.add("MOD-CLN-01"); // recent hospitalization / acute change
  if (s(scores, "AS-11") >= 2) m.add("MOD-SKN-01"); // skin/wound risk
  if (s(scores, "AS-10") >= 3) { m.add("MOD-SKN-02"); m.add("MOD-CON-01"); } // continence risk + high-freq toileting
  if (ctx.l5PathwayAuthorized) m.add("MOD-END-01"); // palliative/end-of-life
  return Array.from(m).sort();
}

/** DT-013 (Private Caregiver / dedicated staffing) review recommendation. */
function recommendDt013(scores: DomainScores): DtRecommendation {
  const triggers: string[] = [];
  if (s(scores, "AS-13") >= 3) triggers.push("Pervasive safety supervision (AS-13>=3) — PCG-002 line-of-sight review");
  if (s(scores, "AS-05") >= 3) triggers.push("Frequent behavioral safety need (AS-05>=3) — PCG-006");
  if (s(scores, "AS-12") >= 3 && s(scores, "AS-13") >= 2) triggers.push("Night-specific safety need (AS-12>=3) — PCG-004");
  if (s(scores, "AS-10") >= 4) triggers.push("Very high-frequency toileting workload (AS-10=4) — PCG-003");
  return {
    recommendReview: triggers.length > 0,
    rationale: triggers.length
      ? "Dedicated 1:1 staffing may be needed beyond shared LOC package. DT-013 is a separate determination — first confirm approved care cannot be delivered under 1:6 shared staffing; do not double-charge (BR-013.05)."
      : "No dedicated-staffing indicators from assessment; deliver within shared LOC package.",
    triggers,
  };
}

/** DT-014 (Additional Clinical & Skilled Services) review recommendation. */
function recommendDt014(scores: DomainScores, ctx: ClinicalContext): DtRecommendation {
  const triggers: string[] = [];
  if (s(scores, "AS-11") >= 3) triggers.push("Active/complex skin or wound (AS-11>=3) — possible skilled wound care ACS-004/005");
  if (s(scores, "AS-06") >= 4) triggers.push("Very high clinical monitoring/complexity (AS-06=4) — assess discrete skilled service vs LOC oversight");
  if (ctx.dysphagia && s(scores, "AS-07") >= 3) triggers.push("Complex regimen with swallowing precautions — assess discrete skilled procedures");
  return {
    recommendReview: triggers.length > 0,
    rationale: triggers.length
      ? "A discrete skilled/ancillary service may exist outside the LOC package. Change-of-condition monitoring alone is NOT an add-on. Run the anti-double-charge test (ACS-014) before any separate fee."
      : "No discrete skilled-service indicators; routine nursing oversight remains part of LOC.",
    triggers,
  };
}

/**
 * Classify an assessment into a Level of Care plus DT-013/DT-014 review
 * recommendations. Deterministic and calibration-safe.
 *
 * @param scores domain scores AS-01..AS-14 (0-4)
 * @param ctx clinical context flags (pathway/acute/override/etc.)
 * @param opts.bandingEnabled when true, the advisory band participates in the
 *   suggested level (auto-banding). Defaults to MODEL_VERSION.scoreBandingEnabled
 *   (false) — until calibrated, the suggestion is driven by MLR floors / pathway
 *   / override and the band is shown as advisory only.
 */
export function classify(
  scores: DomainScores,
  ctx: ClinicalContext = {},
  opts: { bandingEnabled?: boolean } = {},
): ClassificationResult {
  const bandingEnabled = opts.bandingEnabled ?? MODEL_VERSION.scoreBandingEnabled;
  const raw = rawScore(scores);
  const band = advisoryBand(raw);
  const appliedMlrs = evaluateMlr(scores, ctx);
  const modifiers = suggestModifiers(scores, ctx);
  const trace: string[] = [];

  const mlrFloor = appliedMlrs.reduce<CareLevel | null>(
    (acc, r) => maxLevel(acc, r.minimumLevel), null,
  );

  const l5Pathway = appliedMlrs.some((r) => r.id === "MLR-018");
  const capabilityGate = l5Pathway ||
    appliedMlrs.some((r) => ["MLR-011", "MLR-015", "MLR-016", "MLR-019"].includes(r.id));

  trace.push(`Raw acuity ${raw}/56 (advisory band ${band}${bandingEnabled ? "" : ", not auto-applied — GAP-001"}).`);
  if (appliedMlrs.length) {
    trace.push(`Minimum-Level Rules triggered: ${appliedMlrs.map((r) => `${r.id}${r.minimumLevel ? `→${r.minimumLevel}` : " (modifier)"}`).join(", ")}.`);
  } else {
    trace.push("No Minimum-Level Rules triggered.");
  }
  if (mlrFloor) trace.push(`Highest MLR floor: ${mlrFloor}.`);

  // Suggested level: L5 pathway supersedes; else clinical override; else the
  // higher of (MLR floor) and (advisory band, only when banding is enabled).
  let suggestedLevel: CareLevel;
  let overrideApplied = false;
  if (l5Pathway) {
    suggestedLevel = "L5";
    trace.push("MLR-018 authorized comfort/palliative pathway → L5 (supersedes dependency score).");
  } else if (ctx.overrideLevel) {
    suggestedLevel = maxLevel(ctx.overrideLevel, mlrFloor) as CareLevel;
    overrideApplied = true;
    trace.push(`Clinical override → ${ctx.overrideLevel}${ctx.overrideReason ? ` (${ctx.overrideReason})` : ""}.`);
  } else {
    const baseFromBand = bandingEnabled ? band : null;
    suggestedLevel = (maxLevel(mlrFloor, baseFromBand) ?? band);
    if (!bandingEnabled && !mlrFloor) {
      // Rules-only mode with no floor: the deterministic engine cannot classify
      // above L1; the nurse selects the Final LOC using the advisory band as
      // decision support. We surface the band as the suggestion but flag it.
      suggestedLevel = band;
      trace.push(`Rules-only mode, no MLR floor — advisory band ${band} shown for nurse confirmation (not auto-applied).`);
    }
  }

  if (capabilityGate) trace.push("Capability gate: required — verify LifeCare can safely deliver this level + modifiers; emergency needs are never delayed by revenue.");

  return {
    rawScore: raw,
    advisoryBand: band,
    bandingEnabled,
    appliedMlrs,
    mlrFloor,
    modifiers,
    l5Pathway,
    capabilityGate,
    overrideApplied,
    suggestedLevel,
    dt013: recommendDt013(scores),
    dt014: recommendDt014(scores, ctx),
    modelVersion: `${MODEL_VERSION.assessmentVersion}/${MODEL_VERSION.careModelVersion}`,
    trace,
  };
}
