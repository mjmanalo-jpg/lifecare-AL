import { historyForResident, normalizeLevel, type LocHistoryEntry } from "./locHistory.ts";
import { careLevelEnumToLevel, clampLevel } from "./carePackage.ts";
import { authoritativeAssessmentFor, finalLevel, type AssessmentV42 } from "./assessment.ts";

const levelNum = (l: string) => Number(normalizeLevel(l).replace(/^L/, ""));

/**
 * A resident's authoritative ACTIVE level of care (1..5).
 *
 * The `resident.careLevel` enum has only four values and collapses L2 & L3 into
 * "ASSISTED", so it cannot represent L3 faithfully. The durable `loc_history`
 * (pre-admission → reassessments → acuity approvals, appended on every approved
 * Final LOC) DOES hold the true L1..L5 — so the most recent recorded entry is the
 * source of truth for a resident's current level, with the coarse careLevel enum
 * as a fallback for residents who have no history yet.
 *
 * Matched by residentId, linked admission, OR resident name (the name fallback is
 * what surfaces PRE-ADMISSION entries captured before a Resident record existed).
 */
export function activeLevel(opts: {
  residentId: string;
  careLevel?: string | null;
  locHistory: LocHistoryEntry[];
  admissionIds?: string[];
  residentName?: string;
  /** Validated v4.2 assessments (any scope). A validated Final LOC (including a
   *  clinical override / below-floor "-ovr") wins over loc_history and the coarse
   *  careLevel enum — but only once it has been APPLIED, i.e. loc_history carries an
   *  entry stamped with that assessment's id. A validated reassessment still awaiting
   *  approval does NOT move the level, since the level drives the care plan and
   *  billing. With no matching history at all, the validated assessment is trusted.
   *  Omit this and behaviour is unchanged (loc_history → enum). */
  assessments?: AssessmentV42[];
}): number {
  const history = historyForResident(opts.locHistory, opts.residentId, opts.admissionIds ?? [], opts.residentName ?? "");
  if (opts.assessments?.length) {
    const a = authoritativeAssessmentFor(opts.assessments, { residentId: opts.residentId, admissionIds: opts.admissionIds, residentName: opts.residentName });
    // A validated Final LOC is authoritative ONLY once it has been APPLIED — i.e. it
    // appears in loc_history (written on direct apply or on CM/Superadmin approval). A
    // validated reassessment still AWAITING approval is not in loc_history yet, so it
    // must NOT move the active level (the prior approved level stays in effect). When
    // there is no matching history at all (first record, or an id/admission/name-keyed
    // pre-admission entry), trust the validated assessment.
    // ponytail: membership-by-assessmentId; legacy history lacking ids falls back to loc_history[0], which already carries the applied level.
    if (a && (!history.length || history.some((e) => e.assessmentId === a.id))) {
      const lvl = finalLevel(a);
      const aLvl = lvl ? levelNum(lvl) : null;
      if (aLvl && aLvl >= 1 && aLvl <= 5) return aLvl;
    }
  }

  const latest = history[0];
  const locLvl = latest ? levelNum(latest.level) : null;
  if (locLvl && locLvl >= 1 && locLvl <= 5) return locLvl;
  return clampLevel(careLevelEnumToLevel(opts.careLevel));
}
