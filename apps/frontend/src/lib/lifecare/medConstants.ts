// Shared medication constants — single source for the MAR board and the
// assessment/admission Medications editor so their frequency options and the
// vitals-required app-setting key never drift apart.

/** Frequency options offered in the MAR Add-Medication modal and the shared editor. */
export const FREQUENCIES = [
  "Once daily (OD)",
  "Twice daily (BID)",
  "Three times daily (TID)",
  "Four times daily (QID)",
  "Five times daily (5x)",
  "Every 6 hours (Q6H)",
  "Every 8 hours (Q8H)",
  "Every 12 hours (Q12H)",
  "As needed (PRN)",
  "Once weekly",
  "Twice weekly (2x/week)",
  "Three times weekly (3x/week)",
  "Alternate days",
  "Once monthly",
  "Every 6 months",
];

/**
 * On-demand frequencies: no fixed clock schedule — the nurse administers via a
 * button whenever it's given (e.g. "5x daily"). Distinct from PRN, which keeps
 * its established single-tile behavior. Excludes PRN on purpose.
 */
export const isOnDemandFreq = (frequency: string): boolean => /\b5x\b|five times|on.?demand/i.test(frequency || "");

/** App-setting key holding the `{ [medicationId]: true }` vitals-required map. */
export const VITALS_KEY = "med_vitals_required";
