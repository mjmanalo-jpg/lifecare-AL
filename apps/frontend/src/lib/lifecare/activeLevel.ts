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
  /** Validated v4.2 assessments (any scope). When provided, the resident's
   *  authoritative Final LOC is STRICT — a validated Final LOC (including a clinical
   *  override / below-floor "-ovr") always wins over loc_history and the coarse
   *  careLevel enum. A later LOC change is expected to come through a new validated
   *  (re)assessment, which authoritativeAssessmentFor() then surfaces as the most
   *  recent one. Omit it and behaviour is unchanged (loc_history → enum). */
  assessments?: AssessmentV42[];
}): number {
  if (opts.assessments?.length) {
    const a = authoritativeAssessmentFor(opts.assessments, { residentId: opts.residentId, admissionIds: opts.admissionIds, residentName: opts.residentName });
    const lvl = a ? finalLevel(a) : null;
    const aLvl = lvl ? levelNum(lvl) : null;
    if (aLvl && aLvl >= 1 && aLvl <= 5) return aLvl;
  }

  const latest = historyForResident(opts.locHistory, opts.residentId, opts.admissionIds ?? [], opts.residentName ?? "")[0];
  const locLvl = latest ? levelNum(latest.level) : null;
  if (locLvl && locLvl >= 1 && locLvl <= 5) return locLvl;
  return clampLevel(careLevelEnumToLevel(opts.careLevel));
}
