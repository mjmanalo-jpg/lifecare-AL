/**
 * LifeCare Pre-Admission Resident Assessment Form v2.0 — Stage 2 of the care
 * continuum (Pre-Admission Screen). Migration-free: every completed form is one
 * JSON object in a community-scoped app-setting keyed `preadmission_assessments`,
 * read via the generic app-settings query and written with upsertRecord — the
 * same storage contract as the CRM lead pipeline (see crmLeads.ts).
 *
 * The scoring functions below are PURE and unit-tested
 * (tests/preadmission-assessment.test.ts). The file uses erasable-only TS (union
 * types + const arrays, no enums) so it runs both in Next and under `node --test`
 * type-stripping. The LifeCare acuity total (0–50) maps to Level 1–5.
 */

export const PREADMISSION_KEY = "preadmission_assessments";

// ── Small option-catalogue helper (label + point value), reused by the form ──
export interface Opt<V extends string = string> { value: V; label: string; points: number; }

// ── Section C — Mobility (6 pts, driven by the Walking scale) ────────────────
export const WALKING_OPTIONS = [
  { value: "INDEPENDENT", label: "Independent", points: 0 },
  { value: "SUPERVISION", label: "Supervision", points: 1 },
  { value: "CANE", label: "Cane", points: 2 },
  { value: "WALKER", label: "Walker", points: 3 },
  { value: "WHEELCHAIR", label: "Wheelchair", points: 4 },
  { value: "BEDBOUND", label: "Bedbound", points: 6 },
] as const satisfies readonly Opt[];
export type WalkingValue = (typeof WALKING_OPTIONS)[number]["value"];

// Transfers & Falls are captured for the clinical picture but do not score.
export const TRANSFER_OPTIONS = [
  "Independent", "Supervision", "One-person Assist", "Two-person Assist", "Mechanical Lift",
] as const;
export const FALLS_OPTIONS = ["None", "One", "Multiple"] as const;

// ── Section D — ADLs (12 pts: 6 items × Independent 0 / Assistance 1 / Dependent 2)
export const ADL_ITEMS = ["bathing", "dressing", "grooming", "toileting", "feeding", "transfers"] as const;
export type AdlItem = (typeof ADL_ITEMS)[number];
export const ADL_LEVEL_OPTIONS = [
  { value: "INDEPENDENT", label: "Independent / Supervision", points: 0 },
  { value: "ASSISTANCE", label: "Assistance", points: 1 },
  { value: "DEPENDENT", label: "Dependent", points: 2 },
] as const satisfies readonly Opt[];
export type AdlLevel = (typeof ADL_LEVEL_OPTIONS)[number]["value"];

// ── Section E — Continence (4 pts, worst of urinary/bowel capped at 4) ───────
export const URINARY_OPTIONS = [
  { value: "CONTINENT", label: "Continent", points: 0 },
  { value: "OCCASIONAL", label: "Occasional Incontinence", points: 1 },
  { value: "DIAPERS", label: "Uses Diapers", points: 2 },
  { value: "CATHETER", label: "Catheter", points: 4 },
] as const satisfies readonly Opt[];
export type UrinaryValue = (typeof URINARY_OPTIONS)[number]["value"];
export const BOWEL_OPTIONS = [
  { value: "CONTINENT", label: "Continent", points: 0 },
  { value: "NEEDS_ASSIST", label: "Needs Assistance", points: 2 },
  { value: "INCONTINENT", label: "Incontinent", points: 3 },
] as const satisfies readonly Opt[];
export type BowelValue = (typeof BOWEL_OPTIONS)[number]["value"];

// ── Section F — Cognition (8 pts: Memory + behavior modifiers, capped at 8) ──
export const MEMORY_OPTIONS = [
  { value: "NORMAL", label: "Normal", points: 0 },
  { value: "MILD", label: "Mild Forgetfulness", points: 2 },
  { value: "MODERATE", label: "Moderate Dementia", points: 5 },
  { value: "SEVERE", label: "Severe Dementia", points: 8 },
] as const satisfies readonly Opt[];
export type MemoryValue = (typeof MEMORY_OPTIONS)[number]["value"];
export const ORIENTATION_OPTIONS = ["Oriented x3", "Occasionally Confused", "Frequently Confused"] as const;
export const COMMUNICATION_OPTIONS = ["Normal", "Speech Difficulty", "Aphasia"] as const;
// Behaviors are multi-select; each contributes a modifier added to the Memory score.
export const BEHAVIOR_OPTIONS = [
  { value: "CALM", label: "Calm", points: 0 },
  { value: "WANDERING", label: "Wandering", points: 1 },
  { value: "AGITATED", label: "Agitated", points: 0 },
  { value: "AGGRESSIVE", label: "Aggressive", points: 2 },
  { value: "SUNDOWNING", label: "Sundowning", points: 1 },
] as const satisfies readonly Opt[];
export type BehaviorValue = (typeof BEHAVIOR_OPTIONS)[number]["value"];

// ── Section G — Nursing Requirements (8 pts, 1 pt per scoring item) ──────────
// Only the (1)-point clinical procedures score; routine flags are captured 0-pt.
export const NURSING_SCORING_ITEMS = [
  { value: "WOUND_CARE", label: "Wound Care", points: 1 },
  { value: "OXYGEN", label: "Oxygen Therapy", points: 1 },
  { value: "NEBULIZATION", label: "Nebulization", points: 1 },
  { value: "CATHETER_CARE", label: "Catheter Care", points: 1 },
  { value: "PEG_FEEDING", label: "Tube / PEG Feeding", points: 1 },
  { value: "SUCTIONING", label: "Suctioning", points: 1 },
  { value: "IV_MEDICATION", label: "IV Medication", points: 1 },
  { value: "FREQUENT_RN", label: "Frequent RN Monitoring", points: 1 },
] as const satisfies readonly Opt[];
export const NURSING_FLAG_ITEMS = [
  { value: "MED_ADMIN", label: "Medication Administration", points: 0 },
  { value: "VITAL_SIGNS", label: "Vital Signs Monitoring", points: 0 },
  { value: "BLOOD_SUGAR", label: "Blood Sugar Monitoring", points: 0 },
] as const satisfies readonly Opt[];
export const NURSING_ITEMS = [...NURSING_FLAG_ITEMS, ...NURSING_SCORING_ITEMS];
export type NursingValue = (typeof NURSING_ITEMS)[number]["value"];
const NURSING_SCORING_SET = new Set(NURSING_SCORING_ITEMS.map((i) => i.value as string));

// ── Section H — Clinical Risk (12 pts: 4 risks × None 0 / Low 1 / Mod 2 / High 3)
export const RISK_ITEMS = ["fall", "aspiration", "pressure", "infection"] as const;
export type RiskItem = (typeof RISK_ITEMS)[number];
export const RISK_LEVEL_OPTIONS = [
  { value: "NONE", label: "None", points: 0 },
  { value: "LOW", label: "Low", points: 1 },
  { value: "MODERATE", label: "Moderate", points: 2 },
  { value: "HIGH", label: "High", points: 3 },
] as const satisfies readonly Opt[];
export type RiskLevel = (typeof RISK_LEVEL_OPTIONS)[number]["value"];

// ── Unscored profile catalogues (Sections B, I, L, N) ────────────────────────
export const OTHER_CONDITIONS = ["HTN", "DM", "Stroke", "Dementia", "Parkinson's", "Heart Disease", "COPD", "CKD", "Cancer"] as const;
export const REFERRAL_SOURCES = ["Resident", "Family", "Physician", "Hospital", "Other"] as const;
export const DIET_OPTIONS = ["Regular", "Soft", "Minced", "Pureed", "Thickened Fluids"] as const;
export const APPETITE_OPTIONS = ["Good", "Fair", "Poor"] as const;
export const CARE_PRIORITY_OPTIONS = [
  "Fall Prevention", "Medication Management", "Dementia Support", "Continence Care", "Skin Integrity",
  "Nutrition", "Rehabilitation", "Social Engagement", "Infection Prevention", "Family Support",
] as const;
export const STAFFING_OPTIONS = [
  "Standard Community Staffing", "Increased Observation", "Enhanced Fall Monitoring", "Frequent Nursing Review",
  "Daytime Companion (8 hours)", "Daytime Companion (12 hours)", "Dedicated 24-Hour Private Caregiver Required",
] as const;
export const REASSESSMENT_OPTIONS = ["30 Days", "90 Days", "180 Days", "Upon Significant Change in Condition"] as const;

// ── Form data shape (all optional so drafts persist partially) ───────────────
export interface PreAdmissionData {
  // A — Resident Information
  residentName?: string; age?: string; sex?: string; dateOfBirth?: string;
  assessmentLocation?: string; primaryContact?: string; contactNo?: string;
  dateOfAssessment?: string; referralSource?: string; relationship?: string; assessor?: string;
  // B — Medical History
  primaryDiagnosis?: string; secondaryDiagnosis?: string; otherConditions?: string[];
  previousSurgeries?: string; allergies?: string; currentMedications?: string;
  hospitalized12mo?: boolean; hospitalizationReason?: string;
  // C — Mobility
  walking?: WalkingValue; transfers?: string; fallsHistory?: string; lastFall?: string;
  // D — ADLs
  adl?: Partial<Record<AdlItem, AdlLevel>>;
  // E — Continence
  urinary?: UrinaryValue; bowel?: BowelValue; continenceComments?: string;
  // F — Cognition
  memory?: MemoryValue; orientation?: string; behaviors?: BehaviorValue[]; communication?: string;
  // G — Nursing
  nursing?: NursingValue[]; nursingOther?: string;
  // H — Clinical Risk
  risk?: Partial<Record<RiskItem, RiskLevel>>;
  // I — Nutrition
  diet?: string; appetite?: string; swallowingDifficulty?: boolean;
  // J — Social & Emotional
  livingArrangement?: string; primaryCaregiver?: string; reasonForAdmission?: string;
  favoriteActivities?: string; religion?: string; familyExpectations?: string;
  familyAvailable?: boolean; livesAlone?: boolean; caregiverBurnout?: boolean; recentCaregiverLoss?: boolean;
  // K — Clinical Observations
  generalAppearance?: string; obsMobility?: string; obsCommunication?: string;
  moodAffect?: string; clinicalConcerns?: string; strengths?: string;
  // L — Initial Care Priorities
  carePriorities?: string[];
  // N — Staffing Recommendation
  staffing?: string[]; clinicalJustification?: string; reassessment?: string; assessorSignature?: string;
}

// DRAFT → COMPLETED (scored) → VALIDATED (clinical sign-off; care plan may go live).
export type AssessmentStatus = "DRAFT" | "COMPLETED" | "VALIDATED";

export type ValidationDecision = "APPROVED" | "APPROVED_WITH_CHANGES" | "NEEDS_REASSESSMENT";

/** Stage 6–7 — Nurse / Care Manager sign-off on the (possibly overridden) level. */
export interface CarePlanValidation {
  by: string;
  role: string;
  at: string;
  decision: ValidationDecision;
  notes?: string;
}

/** Stage 8 — one problem line of the individualized, problem-oriented care plan. */
export interface CarePlanProblem {
  id: string;
  domain: string;
  problem: string;
  goal: string;
  interventions: string[];
  frequency: string;
  responsible: string;
  expectedOutcome: string;
  status: "OPEN" | "IN_PROGRESS" | "MET" | "DISCONTINUED";
}

export interface CarePlan {
  problems: CarePlanProblem[];
  generatedAt: string;
  updatedAt: string;
  generatedBy?: string;
}

export interface PreAdmissionAssessment extends PreAdmissionData {
  id: string;
  status: AssessmentStatus;
  createdAt: string;
  updatedAt: string;
  /** Snapshot of computed scores at save time (for list/report without recompute). */
  scores?: ScoreBreakdown;
  /** Stage 5 — clinical override of the computed Level of Care (1–5) + reason. */
  overrideLevel?: number;
  overrideReason?: string;
  overrideBy?: string;
  /** Stage 6–7 — clinical validation / decision. */
  validation?: CarePlanValidation;
  /** Stage 8 — individualized care plan derived from the validated assessment. */
  carePlan?: CarePlan;
  /** Stage 13 — reassessment cycle. `reassessment` (interval label) lives in
   *  PreAdmissionData; nextReviewDate is derived; priorAssessmentId links a
   *  reassessment back to the assessment it superseded. */
  nextReviewDate?: string;
  priorAssessmentId?: string;
  /** Link to the Admission record this assessment fed, once converted. */
  convertedAdmissionId?: string;
}

export interface ScoreBreakdown {
  adl: number; mobility: number; continence: number;
  cognition: number; nursing: number; risk: number;
  behaviorModifier: number; total: number;
  level: number; levelLabel: string; careLabel: string;
}

// ── Point lookups ────────────────────────────────────────────────────────────
const pts = (opts: readonly Opt[], value: string | undefined): number =>
  opts.find((o) => o.value === value)?.points ?? 0;
const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));

// ── Pure scoring functions (unit-tested) ─────────────────────────────────────
export function mobilityScore(walking: string | undefined): number {
  return clamp(pts(WALKING_OPTIONS, walking), 6);
}
export function adlScore(adl: Partial<Record<AdlItem, string>> | undefined): number {
  if (!adl) return 0;
  return clamp(ADL_ITEMS.reduce((sum, item) => sum + pts(ADL_LEVEL_OPTIONS, adl[item]), 0), 12);
}
export function continenceScore(urinary: string | undefined, bowel: string | undefined): number {
  // Worst of the two channels, capped at 4 (they are not summed).
  return clamp(Math.max(pts(URINARY_OPTIONS, urinary), pts(BOWEL_OPTIONS, bowel)), 4);
}
export function behaviorModifier(behaviors: string[] | undefined): number {
  if (!behaviors?.length) return 0;
  return behaviors.reduce((sum, b) => sum + pts(BEHAVIOR_OPTIONS, b), 0);
}
export function cognitionScore(memory: string | undefined, behaviors: string[] | undefined): number {
  return clamp(pts(MEMORY_OPTIONS, memory) + behaviorModifier(behaviors), 8);
}
export function nursingScore(nursing: string[] | undefined): number {
  if (!nursing?.length) return 0;
  return clamp(nursing.filter((n) => NURSING_SCORING_SET.has(n)).length, 8);
}
export function riskScore(risk: Partial<Record<RiskItem, string>> | undefined): number {
  if (!risk) return 0;
  return clamp(RISK_ITEMS.reduce((sum, item) => sum + pts(RISK_LEVEL_OPTIONS, risk[item]), 0), 12);
}

// ── LifeCare Acuity Classification (Section M) ───────────────────────────────
export const ACUITY_LEVELS = [
  { level: 1, min: 0, max: 10, label: "Level 1 — Minimal Care Support", care: "Minimal" },
  { level: 2, min: 11, max: 20, label: "Level 2 — Moderate Care Support", care: "Moderate" },
  { level: 3, min: 21, max: 30, label: "Level 3 — Extensive Care Support", care: "Extensive" },
  { level: 4, min: 31, max: 40, label: "Level 4 — Comprehensive / Dementia Care", care: "Comprehensive" },
  { level: 5, min: 41, max: 50, label: "Level 5 — Palliative / Complex Medical Care", care: "Palliative" },
] as const;

export function classifyLevel(total: number): { level: number; label: string; care: string } {
  const hit = ACUITY_LEVELS.find((l) => total >= l.min && total <= l.max) ?? ACUITY_LEVELS[ACUITY_LEVELS.length - 1];
  return { level: hit.level, label: hit.label, care: hit.care };
}

/** Full breakdown for a form: the six scored domains, the behavior modifier, the
 *  0–50 total, and the derived LifeCare level. */
export function scoreAssessment(data: PreAdmissionData): ScoreBreakdown {
  const adl = adlScore(data.adl);
  const mobility = mobilityScore(data.walking);
  const continence = continenceScore(data.urinary, data.bowel);
  const cognition = cognitionScore(data.memory, data.behaviors);
  const nursing = nursingScore(data.nursing);
  const risk = riskScore(data.risk);
  const total = adl + mobility + continence + cognition + nursing + risk;
  const { level, label, care } = classifyLevel(total);
  return {
    adl, mobility, continence, cognition, nursing, risk,
    behaviorModifier: behaviorModifier(data.behaviors),
    total, level, levelLabel: label, careLabel: care,
  };
}

// ── Storage helpers (mirror crmLeads.ts) ─────────────────────────────────────
export function parseAssessments(raw: string | null | undefined): PreAdmissionAssessment[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((a) => a && typeof a.id === "string");
  } catch {
    return [];
  }
}

export function newId(prefix = "pra"): string {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// ── Stage 5 — effective Level of Care (override wins over the computed level) ──
export function effectiveLevel(a: Pick<PreAdmissionAssessment, "overrideLevel" | "scores">): number {
  return a.overrideLevel ?? a.scores?.level ?? 1;
}
export function levelLabel(level: number): string {
  return ACUITY_LEVELS.find((l) => l.level === level)?.label ?? `Level ${level}`;
}
export function levelColor(level: number): string {
  return ["#7E9B6F", "#7E9B6F", "#C39A3E", "#C0573F", "#9E3B2A"][Math.max(0, Math.min(4, level - 1))];
}

// ── Stage 13 — reassessment scheduling (pure; caller passes `now`) ───────────
export function reviewIntervalDays(interval: string | undefined): number | null {
  if (!interval) return null;
  const m = /^(\d+)/.exec(interval);
  return m ? Number(m[1]) : null; // "Upon Significant Change in Condition" → null (event-driven)
}
export function computeNextReview(fromISO: string | undefined, interval: string | undefined): string | null {
  const days = reviewIntervalDays(interval);
  if (!fromISO || days == null) return null;
  const t = new Date(fromISO).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t + days * 86_400_000).toISOString();
}
export function isReassessmentDue(nextReviewISO: string | null | undefined, nowISO: string): boolean {
  if (!nextReviewISO) return false;
  const due = new Date(nextReviewISO).getTime();
  const now = new Date(nowISO).getTime();
  return !Number.isNaN(due) && !Number.isNaN(now) && now >= due;
}

// ── Stage 8 — derive a problem-oriented care plan from a scored assessment ────
// Each flagged domain seeds an editable Problem → Goal → Interventions →
// Frequency → Responsible → Expected Outcome line. The clinician refines it.
const NURSING_LABEL = new Map<string, string>(NURSING_ITEMS.map((i) => [i.value as string, i.label]));
const RISK_TEMPLATE: Record<RiskItem, { problem: string; goal: string; interventions: string[]; outcome: string; responsible: string }> = {
  fall: { problem: "Elevated fall risk", goal: "Prevent falls and fall-related injury", interventions: ["Fall-risk precautions & hourly rounding", "Clear pathways, bed low & locked, call bell in reach", "Assistive device within reach"], outcome: "No falls during the review period", responsible: "Caregiver" },
  aspiration: { problem: "Elevated aspiration risk", goal: "Prevent aspiration events", interventions: ["Upright positioning during & after meals", "Modified diet / thickened fluids per plan", "Supervise meals"], outcome: "No aspiration events; safe swallowing maintained", responsible: "Nurse" },
  pressure: { problem: "Elevated pressure-injury risk", goal: "Maintain skin integrity", interventions: ["Repositioning schedule q2h", "Daily skin inspection", "Pressure-relieving surfaces"], outcome: "Skin intact; no new pressure injuries", responsible: "Caregiver" },
  infection: { problem: "Elevated infection risk", goal: "Prevent infection", interventions: ["Standard precautions & hand hygiene", "Monitor for signs of infection each shift", "Device care per protocol"], outcome: "No preventable infections during the review period", responsible: "Nurse" },
};

export function deriveProblems(data: PreAdmissionData): CarePlanProblem[] {
  const out: CarePlanProblem[] = [];
  const add = (p: Omit<CarePlanProblem, "id" | "status">) => out.push({ ...p, id: `${p.domain.toLowerCase()}-${out.length}`, status: "OPEN" });

  // ADL dependence
  const adlNeeds = ADL_ITEMS.filter((i) => data.adl?.[i] && data.adl[i] !== "INDEPENDENT");
  if (adlNeeds.length) add({
    domain: "ADL", problem: "Requires assistance with activities of daily living",
    goal: "Maintain dignity and optimize independence in daily activities",
    interventions: adlNeeds.map((i) => `Assist with ${i}`),
    frequency: "Every shift", responsible: "Caregiver",
    expectedOutcome: "ADL needs met daily; independence preserved where possible",
  });

  // Mobility
  if (data.walking && data.walking !== "INDEPENDENT") add({
    domain: "MOBILITY", problem: "Impaired mobility",
    goal: "Maintain safe mobility and prevent deconditioning",
    interventions: [`Mobility support: ${WALKING_OPTIONS.find((w) => w.value === data.walking)?.label ?? "assist"}`, "Assist with transfers per plan", "Encourage safe ambulation"],
    frequency: "Every shift", responsible: "Caregiver",
    expectedOutcome: "Mobilizes safely without injury",
  });

  // Continence
  if (continenceScore(data.urinary, data.bowel) >= 1) add({
    domain: "CONTINENCE", problem: "Continence care needs",
    goal: "Maintain continence, comfort and skin integrity",
    interventions: ["Toileting schedule", "Continence products / catheter care per plan", "Perineal skin care"],
    frequency: "Every shift", responsible: "Caregiver",
    expectedOutcome: "Comfortable, dignified continence care; skin intact",
  });

  // Cognition
  if (cognitionScore(data.memory, data.behaviors) >= 2) add({
    domain: "COGNITION", problem: "Cognitive impairment / dementia support",
    goal: "Support orientation, safety and meaningful engagement",
    interventions: ["Consistent routine & reorientation", "Behavioral triggers monitored & de-escalation", "Structured, safe environment"],
    frequency: "Daily", responsible: "Nurse",
    expectedOutcome: "Reduced agitation; safe, engaged and oriented to ability",
  });

  // Skilled nursing procedures
  const procedures = (data.nursing ?? []).filter((n) => NURSING_SCORING_SET.has(n));
  if (procedures.length) add({
    domain: "NURSING", problem: "Skilled nursing requirements",
    goal: "Deliver skilled clinical care safely and on schedule",
    interventions: procedures.map((p) => NURSING_LABEL.get(p) ?? p),
    frequency: "Per order", responsible: "Nurse",
    expectedOutcome: "Clinical interventions delivered as ordered without complication",
  });

  // Clinical risks (Moderate / High only)
  RISK_ITEMS.forEach((r) => {
    const lvl = data.risk?.[r];
    if (lvl === "MODERATE" || lvl === "HIGH") {
      const t = RISK_TEMPLATE[r];
      add({ domain: "RISK", problem: t.problem, goal: t.goal, interventions: t.interventions, frequency: "Every shift", responsible: t.responsible, expectedOutcome: t.outcome });
    }
  });

  // Nutrition (swallowing / poor appetite)
  if (data.swallowingDifficulty || data.appetite === "Poor") add({
    domain: "NUTRITION", problem: "Nutritional risk",
    goal: "Maintain adequate nutrition and hydration",
    interventions: [data.diet ? `Diet: ${data.diet}` : "Diet per plan", "Monitor intake", "Assist / supervise meals"].filter(Boolean),
    frequency: "Every meal", responsible: "Caregiver",
    expectedOutcome: "Adequate intake maintained; weight stable",
  });

  return out;
}

/** Build a fresh care plan record from an assessment (Stage 8). */
export function generateCarePlan(data: PreAdmissionData, at: string, by?: string): CarePlan {
  return { problems: deriveProblems(data), generatedAt: at, updatedAt: at, generatedBy: by };
}

/** Clone a validated assessment forward as a DRAFT reassessment (Stage 13). It
 *  keeps the clinical picture (so the clinician edits deltas) but resets the
 *  lifecycle and links back to the prior record. */
export function cloneForReassessment(prior: PreAdmissionAssessment, id: string, at: string): PreAdmissionAssessment {
  const {
    id: _id, status: _s, createdAt: _c, updatedAt: _u, scores: _sc, validation: _v,
    overrideLevel: _ol, overrideReason: _or, overrideBy: _ob, carePlan: _cp,
    nextReviewDate: _nr, priorAssessmentId: _pa, convertedAdmissionId: _ca, ...data
  } = prior;
  void [_id, _s, _c, _u, _sc, _v, _ol, _or, _ob, _cp, _nr, _pa, _ca];
  return {
    ...data,
    id,
    status: "DRAFT",
    priorAssessmentId: prior.id,
    dateOfAssessment: at.slice(0, 10),
    createdAt: at,
    updatedAt: at,
  };
}
