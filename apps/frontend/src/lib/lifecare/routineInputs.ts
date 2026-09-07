// SLMS v4.2 — derive the assembly engine's AssembleInput from a resident's REAL
// records (validated assessment + active medications + diet order), so generate-draft
// produces order-resolved events instead of order-blocked placeholders. PURE mapping
// (no IO); the route gathers the rows and calls these.

import domainsData from "./data/assessment_domains.json" with { type: "json" };
import type { DomainInput, OrderInput, FinalLoc, AssembleInput } from "./assembleRoutine.ts";

const DOMAIN_NAME: Record<string, string> =
  Object.fromEntries((domainsData as { code: string; name: string }[]).map((d) => [d.code, d.name]));

/** "L4" (or "Level 4") → "LOC 4"; undefined when unparseable. */
export function careLevelToLoc(level: string | undefined | null): FinalLoc | undefined {
  const m = /([1-5])/.exec(level || "");
  return m ? (`LOC ${m[1]}` as FinalLoc) : undefined;
}

export interface AssessmentLike {
  domains?: Record<string, { score?: number } | undefined> | null;
  context?: { dysphagia?: boolean; weightLoss?: boolean; recentHospitalization?: boolean; acuteInstability?: boolean } | null;
  layer1?: { diagnoses?: string } | null;
  layer3?: { finalLevel?: string } | null;
}

/** One DomainInput per scored AS domain. activeNeed = score ≥ 1 (score 0 =
 * independent, no staff action → the engine generates nothing for it, Rule 2). */
export function domainsFromAssessment(a: AssessmentLike): DomainInput[] {
  const out: DomainInput[] = [];
  for (const [code, entry] of Object.entries(a.domains ?? {})) {
    const score = entry?.score;
    if (typeof score !== "number" || !Number.isFinite(score)) continue;
    const s = Math.max(0, Math.min(4, Math.round(score))) as 0 | 1 | 2 | 3 | 4;
    out.push({ code, name: DOMAIN_NAME[code] ?? code, score: s, activeNeed: s >= 1 });
  }
  return out;
}

// Diagnosis-text keyword → condition pathway bundleId (condition_pathways.json).
const COND_KEYWORDS: [RegExp, string][] = [
  [/diabet/, "DM-01"],
  [/hypertens|high blood pressure|\bhtn\b/, "HTN-01"],
  [/\bckd\b|renal|kidney/, "CKD-01"],
  [/dysphagia|swallow|aspiration/, "DYSPH-01"],
  [/\bfalls?\b|gait instab/, "FALL-01"],
  [/malnutrition|weight loss|underweight/, "NUTR-01"],
  [/incontinen|\buti\b|urinary/, "UI-01"],
  [/stroke|\bcva\b|hemipar/, "CVA-01"],
  [/parkinson/, "PD-01"],
  [/hearing/, "HEAR-01"],
  [/vision|visual|blind/, "VISION-01"],
  [/pressure (injury|ulcer|sore)|\bwound|skin breakdown|bedsore/, "SKIN-01"],
  [/anxiet|agitat/, "ANX-01"],
  [/sleep|insomnia|sundown/, "SLEEP-01"],
  [/\bpain\b/, "PAIN-01"],
  [/frail|decondition|post-hospital/, "FRAIL-01"],
];
const DEMENTIA = /dementia|alzheimer|cognitive impairment|\bmci\b/;

/**
 * Active condition pathway bundleIds from structured context flags + diagnosis
 * keywords, plus a separate Memory pathway intensity (decoupled from LOC, Rule 20)
 * derived from the AS-04 cognition score when dementia is indicated.
 */
export function conditionsFromAssessment(a: AssessmentLike): {
  activeConditions: string[];
  memoryIntensity?: AssembleInput["memoryIntensity"];
} {
  const set = new Set<string>();
  const dx = (a.layer1?.diagnoses ?? "").toLowerCase();
  for (const [re, id] of COND_KEYWORDS) if (re.test(dx)) set.add(id);
  if (a.context?.dysphagia) set.add("DYSPH-01");
  if (a.context?.weightLoss) set.add("NUTR-01");
  if (a.context?.recentHospitalization) set.add("FRAIL-01");

  let memoryIntensity: AssembleInput["memoryIntensity"] | undefined;
  if (DEMENTIA.test(dx)) {
    const cog = a.domains?.["AS-04"]?.score ?? 0;
    memoryIntensity = cog >= 4 ? "Intensive" : cog >= 3 ? "Enhanced" : cog >= 2 ? "Structured" : "Supportive";
  }
  return { activeConditions: [...set], memoryIntensity };
}

export interface MedRecord {
  id: string; name: string; dosage: string; frequency: string; route?: string | null;
  startDate: string | Date; endDate?: string | Date | null; prescribedBy?: string | null;
}
export interface DietRecord {
  id: string; dietType: string; restrictions?: string | null; mealType: string; orderedBy?: string | null;
}

const iso = (d: string | Date): string => (typeof d === "string" ? d : d.toISOString());

/** Active medications + diet order → OrderInput (unblocks orderRequired events, Rule 5). */
export function ordersFromRecords(meds: MedRecord[], diet?: DietRecord | null): OrderInput {
  const orders: OrderInput = {};
  if (meds.length) {
    orders.medications = meds.map((m) => ({
      id: m.id, name: m.name, dosage: m.dosage, frequency: m.frequency, route: m.route || "oral",
      startDate: iso(m.startDate), endDate: m.endDate ? iso(m.endDate) : undefined, prescribedBy: m.prescribedBy || undefined,
    }));
  }
  if (diet) {
    orders.diet = {
      id: diet.id, dietType: diet.dietType, restrictions: diet.restrictions || undefined,
      texture: diet.dietType, mealType: diet.mealType, orderedBy: diet.orderedBy || undefined,
      startDate: new Date(0).toISOString(), // effective-from unknown at order level; engine only reads texture/dietType
    };
  }
  return orders;
}
