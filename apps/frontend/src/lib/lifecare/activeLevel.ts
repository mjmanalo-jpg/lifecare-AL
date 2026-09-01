import { historyForResident, normalizeLevel, type LocHistoryEntry } from "./locHistory.ts";
import { careLevelEnumToLevel, clampLevel } from "./carePackage.ts";

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
}): number {
  const latest = historyForResident(opts.locHistory, opts.residentId, opts.admissionIds ?? [], opts.residentName ?? "")[0];
  if (latest) {
    const n = Number(normalizeLevel(latest.level).replace(/^L/, ""));
    if (n >= 1 && n <= 5) return n;
  }
  return clampLevel(careLevelEnumToLevel(opts.careLevel));
}
