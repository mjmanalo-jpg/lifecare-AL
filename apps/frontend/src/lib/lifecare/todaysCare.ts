// Phase 3 — Today's Care shift engine (materialisation + bundling).
// Turns an APPROVED care plan into a per-shift operational view: only what must
// be done now, bundled into the encounters staff naturally perform together,
// split into Caregiver vs Nurse queues, with exception-first charting.
//
// Verified against the workbook's R05-105 "Today's Care" sample view by
// tests/lifecare-todayscare.test.ts.

import type { CarePlanLine, DraftCarePlan } from "./carePlan.ts";

export type ShiftRole = "Caregiver" | "Nurse";
export type BundleKey = "BND-AM" | "BND-BR" | "BND-MEAL" | "BND-MOB" | "BND-NOC" | "BND-RN" | "COC";

export interface BundleDef {
  key: BundleKey;
  label: string;
  role: ShiftRole;
  /** Care Task Master domains whose lines materialise into this bundle. */
  domains: string[];
  timing: string;
}

/** Bundling rules (BND-AM/BR/MEAL/MOB/NOC/RN) derived from the Today's Care design. */
export const BUNDLES: BundleDef[] = [
  { key: "BND-AM",   label: "Morning care",        role: "Caregiver", domains: ["ADLs / Personal Care", "Mobility & Transfers", "Fall Prevention"], timing: "Morning routine" },
  { key: "BND-BR",   label: "Bathroom / continence", role: "Caregiver", domains: ["Continence / Skin"], timing: "Each occurrence" },
  { key: "BND-MEAL", label: "Meals",               role: "Caregiver", domains: ["Nutrition / Hydration"], timing: "Every meal / oral intake" },
  { key: "BND-MOB",  label: "Mobility transitions", role: "Caregiver", domains: ["Mobility & Transfers", "Fall Prevention"], timing: "Each transition" },
  { key: "BND-NOC",  label: "Night care",          role: "Caregiver", domains: ["Sleep / Night Routine"], timing: "Night" },
  { key: "BND-RN",   label: "Medication & monitoring rounds", role: "Nurse", domains: ["Medication Support", "Clinical Monitoring", "Cognition / Dementia"], timing: "MAR / clinical schedule" },
];

/** Exception outcomes that break a line out of its bundle into a structured event. */
export const EXCEPTION_OUTCOMES = [
  "Refused", "Unable", "Unsafe", "Increased assistance", "Frequency variance", "Clinical change",
] as const;
export type ExceptionOutcome = (typeof EXCEPTION_OUTCOMES)[number];

export interface ShiftEncounter {
  bundle: BundleKey;
  label: string;
  role: ShiftRole;
  timing: string;
  taskIds: string[];
  /** Combined, de-duplicated precautions across the bundled lines. */
  precautions: string[];
  /** Expected care events (default event ids) for the bundled lines. */
  expectedEvents: string[];
  /** Whether this encounter is a temporary change-of-condition line (not bundled). */
  temporary: boolean;
}

/** A care-plan line is a temporary change-of-condition line if flagged MLR-015 or given a review/stop date. */
export function isTemporaryCoc(line: CarePlanLine): boolean {
  return /MLR-015/.test(line.sourceModifierMlr) || line.reviewStopDate.trim().length > 0;
}

/** Map a plan line to the bundle keys it materialises into (by domain). */
export function bundlesForLine(line: CarePlanLine): BundleKey[] {
  if (isTemporaryCoc(line)) return ["COC"];
  const keys = BUNDLES.filter((b) => b.domains.includes(line.domain)).map((b) => b.key);
  return keys.length ? keys : ["COC"]; // unmapped domains surface standalone
}

/**
 * Materialise an approved care plan into a shift view. Non-approved plans yield
 * no encounters (governance: routines only activate from an APPROVED plan).
 */
export function materialiseShiftView(plan: Pick<DraftCarePlan, "status" | "lines">): ShiftEncounter[] {
  if (plan.status !== "APPROVED") return [];
  const active = plan.lines;

  const encounters: ShiftEncounter[] = [];

  for (const def of BUNDLES) {
    const lines = active.filter((l) => !isTemporaryCoc(l) && bundlesForLine(l).includes(def.key));
    if (!lines.length) continue;
    encounters.push({
      bundle: def.key,
      label: def.label,
      role: def.role,
      timing: def.timing,
      taskIds: lines.map((l) => l.taskId),
      precautions: uniq(lines.map((l) => l.precautions).filter(Boolean)),
      expectedEvents: uniq(lines.flatMap((l) => l.expectedCareEvent.split(";").map((s) => s.trim()).filter(Boolean))),
      temporary: false,
    });
  }

  // Temporary change-of-condition lines surface standalone (Nurse), never bundled.
  for (const l of active.filter(isTemporaryCoc)) {
    encounters.push({
      bundle: "COC",
      label: "Temporary change-of-condition",
      role: "Nurse",
      timing: "Temporary / symptom-triggered",
      taskIds: [l.taskId],
      precautions: l.precautions ? [l.precautions] : [],
      expectedEvents: l.expectedCareEvent.split(";").map((s) => s.trim()).filter(Boolean),
      temporary: true,
    });
  }

  return encounters;
}

/** Split a shift view into the Caregiver and Nurse work queues (role split). */
export function splitByRole(encounters: ShiftEncounter[]): Record<ShiftRole, ShiftEncounter[]> {
  return {
    Caregiver: encounters.filter((e) => e.role === "Caregiver"),
    Nurse: encounters.filter((e) => e.role === "Nurse"),
  };
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
