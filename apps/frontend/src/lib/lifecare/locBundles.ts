// SLMS v4.2 LOC Standard Routine Bundles (Foundations unit B) — 61 baseline
// events across LOC 1-5, loaded as a DRAFT template by the assembly engine (#2).
// A bundle is "template only": nurse approval + effective date are required before
// any occurrence generates. Data: data/loc_bundles.json (extracted from (2).xlsx).

import bundlesRaw from "./data/loc_bundles.json" with { type: "json" };

export interface LocBundle {
  bundleEventId: string;
  finalLoc: string; // e.g. "LOC 4 – Comprehensive Care"
  category: string;
  careEvent: string;
  purpose: string;
  defaultAssistancePattern: string;
  frequencyMethod: string;
  defaultTimeShift: string;
  requiredResult: string;
  completionControl: string;
  orderRequired: boolean;
  activationRule: string;
  asDomains: string[];
  criticality: string;
  implementationNote: string;
  resultSchemaKey: string;
  resultSchemaKeyReview?: boolean; // ambiguous mapping flagged for SOP review
  sourceWorkbookVersion: string;
}

export const ALL_LOC_BUNDLES = bundlesRaw as LocBundle[];

const locKey = (loc: string) => loc.replace(/\s/g, "").toLowerCase();

/** Bundles for a Final LOC. Accepts "LOC 4", "LOC4", or the full "LOC 4 – …" label. */
export function bundlesForLoc(loc: string): LocBundle[] {
  const k = locKey(loc);
  return ALL_LOC_BUNDLES.filter((b) => locKey(b.finalLoc).startsWith(k));
}
