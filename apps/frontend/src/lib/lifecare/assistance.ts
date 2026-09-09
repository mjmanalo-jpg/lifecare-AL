// SLMS v4.2 assistance + responsible-role model (Foundations unit E).
//
// The canonical assistance level is derived from the AS score (0-4) and is the
// source of truth. It is displayed with the facility's manual-form labels via
// ASSISTANCE_DISPLAY. Two-person / mechanical are STAFFING / EQUIPMENT, never an
// assistance level — parseSupport routes them to separate fields and NEVER lets
// them become assistanceLevel (which comes only from the score).

export const ASSISTANCE = [
  "Independent", "Setup/Cueing", "Minimal Assist", "Extensive Assist", "Total Assist",
] as const;
export type Assistance = (typeof ASSISTANCE)[number];

/** Facility AS-02 Mobility/Transfers assist-level options. Single source shared by
 *  the v4.2 assessment (DomainScoreGrid EVIDENCE_SELECTS) and the caregiver
 *  Document-care log (CareLogsBoard), so the assessment's selected level auto-fills
 *  the daily log 1:1. Stored/read verbatim as an AS-02 evidence token. */
export const MOBILITY_ASSIST_OPTIONS = [
  "Independent", "Standby assist", "One-person assist", "Two-person assist", "Mechanical lift / hoist",
] as const;

/** The AS-02 assist level chosen in an assessment: the evidence token matching one
 *  of MOBILITY_ASSIST_OPTIONS. "" when none was selected. */
export function mobilityAssistFromEvidence(evidence: string | undefined): string {
  const opts = MOBILITY_ASSIST_OPTIONS.map((o) => o.toLowerCase());
  return (evidence ?? "").split(",").map((t) => t.trim())
    .find((t) => opts.includes(t.toLowerCase())) ?? "";
}
export type AsScore = 0 | 1 | 2 | 3 | 4;

/** AS 0..4 → canonical assistance level. */
export function assistanceForScore(score: AsScore): Assistance {
  return ASSISTANCE[score];
}

/** Canonical level → facility display label (manual "Resident Routine" wording).
 *  Provisional mapping — tune to SOP. "Extensive Assist" has no manual-form label,
 *  so it displays canonically. */
export const ASSISTANCE_DISPLAY: Record<Assistance, string> = {
  Independent: "Observation",
  "Setup/Cueing": "Supervision",
  "Minimal Assist": "Min. Assistance",
  "Extensive Assist": "Extensive Assist",
  "Total Assist": "Fully Dependent",
};

export const ROLE = ["Caregiver", "Nurse", "Other authorized"] as const;
export type Role = (typeof ROLE)[number];
/** Facility abbreviations shown in the "Assisted By" column. */
export const ROLE_ABBR: Record<Role, string> = {
  Caregiver: "CGs",
  Nurse: "NOD",
  "Other authorized": "OTH",
};

/** Medication / clinical-order / glucose / vitals / treatment → Nurse (NOD); else Caregiver. */
export function defaultRole(eventCategory: string, orderRequired: boolean): Role {
  const c = (eventCategory || "").toLowerCase();
  if (orderRequired || /medication|clinical|glucose|vital|treatment/.test(c)) return "Nurse";
  return "Caregiver";
}

export interface SupportProfile {
  assistanceLevel: Assistance; // from score ONLY
  supervision?: string;
  staffing?: string;
  equipment?: string;
  technique?: string;
  conditionModifier?: string;
}

/**
 * Set assistanceLevel from the AS score, then extract the SEPARATE support fields
 * from a bundle's free-text `defaultAssistancePattern`. Heuristic + provisional
 * (covers the vocabulary seen in the LOC bundles + Caregiver Execution examples).
 * assistanceLevel is NEVER derived from the text — so "two-person"/"mechanical"
 * can never become an assistance level.
 */
export function parseSupport(pattern: string, score: AsScore): SupportProfile {
  const lp = (pattern || "").toLowerCase();
  const prof: SupportProfile = { assistanceLevel: assistanceForScore(score) };

  if (/two[- ]person|2[- ]person|two caregivers/.test(lp)) prof.staffing = "Two-person";

  const equip: string[] = [];
  if (/mechanical|lift|hoist/.test(lp)) equip.push("Mechanical lift");
  if (/walker/.test(lp)) equip.push("Walker");
  if (/gait belt/.test(lp)) equip.push("Gait belt");
  if (/wheelchair/.test(lp)) equip.push("Wheelchair");
  if (equip.length) prof.equipment = equip.join("; ");

  if (/standby/.test(lp)) prof.supervision = "Standby";
  else if (/contact guard/.test(lp)) prof.supervision = "Contact guard";
  else if (/continuous|close observation|one-to-one|1:1|1-to-1/.test(lp)) prof.supervision = "Continuous";
  else if (/observe|observation|monitor/.test(lp)) prof.supervision = "Observation";

  if (/fall precaution/.test(lp)) prof.conditionModifier = "Fall precautions";

  return prof;
}
