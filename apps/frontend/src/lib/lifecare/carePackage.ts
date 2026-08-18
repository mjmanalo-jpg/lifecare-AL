// Package gate — what care is INCLUDED in a resident's Level of Care package.
//
// The v3.9 care model ties each level to a baseline care package. Care outside
// that package is a DT-014 Additional Clinical Service: it should not be routinely
// logged/performed, and when it is (e.g. resident/family requests it) it routes to
// the ACS flow for authorisation + charge (never an automatic fee — governance).
//
// Included-domain sets by level are derived from the "Operational Care Task
// Package — Baseline by LOC" + the level's Care Activities. Tunable at runtime via
// the app-setting `lifecare_care_package` (same override pattern as other rules).

import { DOMAIN_CODES, type DomainCode } from "./types.ts";
import type { AcsDetermination } from "./acs.ts";

export type CareLevelEnum = "INDEPENDENT" | "ASSISTED" | "MEMORY" | "SKILLED";

/** Scored domains included in the baseline package at each Level of Care (1–5). */
export const LEVEL_PACKAGE_DOMAINS: Record<number, DomainCode[]> = {
  // L1 Minimal — wellness monitoring, basic fall prevention, engagement only.
  1: ["AS-03", "AS-06", "AS-14"],
  // L2 Moderate — + regular ADL / mobility / meds / nutrition / continence.
  2: ["AS-01", "AS-02", "AS-03", "AS-06", "AS-07", "AS-08", "AS-10", "AS-14"],
  // L3 Extensive — + cognition, communication, skin, sleep, safety (all but behavior).
  3: ["AS-01", "AS-02", "AS-03", "AS-04", "AS-06", "AS-07", "AS-08", "AS-09", "AS-10", "AS-11", "AS-12", "AS-13", "AS-14"],
  // L4 Comprehensive — all 14 domains.
  4: [...DOMAIN_CODES],
  // L5 Palliative — comfort-focused across all clinical/personal domains (reablement not applicable).
  5: DOMAIN_CODES.filter((c) => c !== "AS-14"),
};

/** Map the resident.careLevel enum to a representative level number. */
export function careLevelEnumToLevel(careLevel: string | undefined | null): number {
  switch ((careLevel || "").toUpperCase()) {
    case "INDEPENDENT": return 1;
    case "ASSISTED": return 2;   // ASSISTED spans L2–L3; L2 is the safe baseline
    case "MEMORY": return 4;
    case "SKILLED": return 5;
    default: return 2;
  }
}

/** Clamp any level-ish value to 1–5. */
export function clampLevel(level: number | undefined | null): number {
  const n = Math.round(Number(level) || 0);
  return n < 1 ? 1 : n > 5 ? 5 : n;
}

/** Human labels for the 14 scored domains (for gate messages/badges). */
export const DOMAIN_LABEL: Record<string, string> = {
  "AS-01": "ADLs / Personal Care", "AS-02": "Mobility / Transfers", "AS-03": "Fall Risk",
  "AS-04": "Cognition", "AS-05": "Behavior / BPSD", "AS-06": "Clinical Monitoring",
  "AS-07": "Medication Support", "AS-08": "Nutrition / Hydration", "AS-09": "Communication",
  "AS-10": "Continence / Toileting", "AS-11": "Skin Integrity", "AS-12": "Sleep / Daily Routine",
  "AS-13": "Safety / Supervision", "AS-14": "Reablement / Therapy",
};

/**
 * Resolve a free-text domain/category/task label to an AS-code (for boards that
 * reference domains by label — Today's Care bundles, Task Assignment categories).
 * Returns null when it can't confidently map (callers should then NOT gate).
 */
export function domainCodeFromLabel(label: string): DomainCode | null {
  const l = (label || "").toLowerCase();
  if (/\b(adl|personal care|bath|dress|groom)\b/.test(l)) return "AS-01";
  if (/(mobil|transfer|ambulat|reposition)/.test(l)) return "AS-02";
  if (/fall/.test(l)) return "AS-03";
  if (/(cognit|memory|dementia|reorient|cue)/.test(l)) return "AS-04";
  if (/(behav|bpsd|agitation)/.test(l)) return "AS-05";
  if (/(clinical monitor|vital|monitoring)/.test(l)) return "AS-06";
  if (/(medicat|\bmed\b|mar)/.test(l)) return "AS-07";
  if (/(nutrition|meal|feed|hydrat|diet)/.test(l)) return "AS-08";
  if (/communicat/.test(l)) return "AS-09";
  if (/(contin|toilet|bowel|urine|diaper|perineal)/.test(l)) return "AS-10";
  if (/(skin|wound|pressure)/.test(l)) return "AS-11";
  if (/(sleep|night)/.test(l)) return "AS-12";
  if (/(safety|supervis|wander)/.test(l)) return "AS-13";
  if (/(reablement|therapy|rehab|engage|activit)/.test(l)) return "AS-14";
  return null;
}

/** Is a scored domain (AS-code) part of the resident's package at this level? */
export function domainInPackage(level: number, domainCode: string): boolean {
  const set = LEVEL_PACKAGE_DOMAINS[clampLevel(level)] ?? LEVEL_PACKAGE_DOMAINS[4];
  return set.includes(domainCode as DomainCode);
}

/** Included / excluded domain codes for a level. */
export function packageForLevel(level: number): { included: DomainCode[]; excluded: DomainCode[] } {
  const included = LEVEL_PACKAGE_DOMAINS[clampLevel(level)] ?? LEVEL_PACKAGE_DOMAINS[4];
  const excluded = DOMAIN_CODES.filter((c) => !included.includes(c));
  return { included, excluded };
}

/**
 * Route out-of-package care to DT-014 (Additional Clinical Services). Creates a
 * pending ACS determination (governed by ACS-014, the anti-double-charge test)
 * for nurse/admin authorisation + charge in the Additional Services board — it
 * never posts a fee automatically. Best-effort; never throws.
 */
export async function recordOutOfPackageService(opts: {
  residentId: string;
  residentName: string;
  room?: string;
  domainCode: string;
  domainLabel: string;
  level: number;
  by?: string;
  notes?: string;
  nowISO?: string;
}): Promise<boolean> {
  try {
    if (!opts.residentId) return false;
    // Lazy-load client-only deps so the pure gate logic stays import-light/testable.
    const { createRecord } = await import("@/lib/api");
    const { ACS_KEY, parseAcsDeterminations } = await import("./acs.ts");
    const res = await fetch(`/api/db/app-settings?f_key=${ACS_KEY}&take=1`, { credentials: "include" });
    const json = res.ok ? await res.json() : null;
    const row = (json?.data as Array<{ value?: string }> | undefined)?.[0];
    const items = parseAcsDeterminations(row?.value);
    const now = opts.nowISO ?? new Date().toISOString();
    const det: AcsDetermination = {
      id: `acs-${Date.now().toString(36)}-${items.length}`,
      residentId: opts.residentId,
      residentName: opts.residentName,
      room: opts.room,
      acsRuleId: "ACS-014",
      service: `Out-of-package care — ${opts.domainLabel}`,
      includedInLoc: "No",
      separateChargeAllowed: true,
      rationale: `${opts.domainLabel} is outside the resident's Level ${opts.level} package. Delivered on request; requires DT-014 review + authorisation before any charge (anti-double-charge test ACS-014).`,
      status: "ACTIVE",
      startDate: now,
      createdBy: opts.by,
      createdAt: now,
      notes: opts.notes,
    };
    await createRecord("app-settings", { id: ACS_KEY, key: ACS_KEY, value: JSON.stringify([det, ...items]) });
    return true;
  } catch {
    return false;
  }
}
