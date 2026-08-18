// LifeCare v3.9 / v4.2 SLMS — shared domain types.
// Source of truth for the governed clinical decision model:
//   Assessment (14 domains) -> Level of Care -> Care Plan -> Today's Care -> Care Events -> reassessment
// plus the three separate pricing engines (LOC / DT-013 PCG / DT-014 Additional Clinical Services).

/** The 14 scored assessment domain codes (AS-01..AS-14) + the non-scored NS-01 profile. */
export type DomainCode =
  | "AS-01" | "AS-02" | "AS-03" | "AS-04" | "AS-05" | "AS-06" | "AS-07"
  | "AS-08" | "AS-09" | "AS-10" | "AS-11" | "AS-12" | "AS-13" | "AS-14";

export const DOMAIN_CODES: DomainCode[] = [
  "AS-01", "AS-02", "AS-03", "AS-04", "AS-05", "AS-06", "AS-07",
  "AS-08", "AS-09", "AS-10", "AS-11", "AS-12", "AS-13", "AS-14",
];

/** Basic ADL domains used by the ADL minimum-level rules (MLR-001/003/016). */
export const BASIC_ADL: DomainCode[] = ["AS-01", "AS-02", "AS-08", "AS-10"];

/** Care level (L1..L4 recurring-complexity + L5 palliative pathway). */
export type CareLevel = "L1" | "L2" | "L3" | "L4" | "L5";

export interface DomainDef {
  code: string;
  name: string;
  scored: boolean;
  anchors: string[]; // [0,1,2,3,4]
  evidenceRequired: string;
  calibrationNote: string;
  scope: string;
  owner: string;
}

export interface MlrRule {
  id: string;
  criticalNeed: string;
  triggerEvidence: string;
  minimumLevel: string;
  modifiers: string;
  effectOnBaseScore: string;
  requiredControls: string;
  escalationReview: string;
  overrideException: string;
  status: string;
}

export interface ClinicalModifier {
  id: string;
  name: string;
  affectedDomains: string[];
  taskPlanEffect: string;
  escalationLink: string;
  priority: string;
}

export interface PcgRule {
  id: string; decisionFactor: string; trigger: string;
  locEffect: string; pcgEffect: string; requiredDocumentation: string;
  reviewSafeguard: string; status: string;
}

export interface AcsRule {
  id: string; service: string; includedInLoc: string; separateCharge: string;
  decisionRule: string; examples: string; requiredDocumentation: string;
  reassessmentSafeguard: string; status: string;
}

export interface DecisionTree {
  id: string; name: string; domain: string; purpose: string; priority: string;
}

/** Atomic business rule (BR-*) — the per-decision-tree rule breakdown (sheet 2). */
export interface AtomicRule {
  decisionTreeId: string;
  id: string;              // BR-XXX.YY
  name: string;
  decisionQuestion: string;
  requiredInputs: string;
  ruleOutcome: string;
  decisionOwner: string;
  requiredEvidence: string;
  benchmarkBasis: string;
  priority: string;
  careEventTrigger: string;
  carePlanImpact: string;
  status: string;
}

export interface CareTask {
  id: string; name: string; domain: string; careLevel: string; category: string;
  definition: string; triggerFrequencyLogic: string; observableOutcome: string;
  primaryRole: string; competency: string; status: string;
  careNeedCategory: string; approvedNeed: string; approvedGoal: string; approvedIntervention: string;
  assistanceOptions: string; frequencyOptions: string; responsibleRole: string;
  individualizationFields: string; residentGoalPrompt: string; carePlanInclusionRule: string;
  defaultExpectedEvent: string; allowedExceptionEvents: string[]; careEventDocTemplate: string;
  exceptionTrigger: string; escalationReassessment: string;
  serviceDeterminationFlag: string; generationStatus: string;
}

export interface CareEvent {
  id: string; name: string; domain: string; eventType: string; definition: string;
  requiredEvidence: string; escalationFollowUp: string; typicalReporter: string;
  applicableLevels: string; linkedDecisionTree: string; archetype: string;
  minimumPayload: string; assistanceDeliveredRequired: string; quantValueRequired: string;
  residentResponseRequired: string; baselineComparisonRequired: string; immediateEscalation: string;
  repeatVarianceRule: string; autoReassessSignal: string; carePlanRoutineEffect: string;
  serviceFeeEffect: string; documentationMode: string; bundleEligible: string;
  minNormalDocumentation: string; exceptionDetailRequired: string; immediateNurseAlert: string;
  trendReassessCounter: string;
}

/** Domain scores 0-4 keyed by AS code. Missing = 0. */
export type DomainScores = Partial<Record<DomainCode, number>>;

/** Clinical context flags that the score cannot infer (from evidence / clinical judgment). */
export interface ClinicalContext {
  /** MLR-018: authorized comfort/palliative/end-of-life goals-of-care pathway. */
  l5PathwayAuthorized?: boolean;
  /** MLR-015: material acute instability / rapidly changing condition. */
  acuteInstability?: boolean;
  /** MOD-CLN-01: recent hospitalization / acute change (makes AS-06 elevation temporary). */
  recentHospitalization?: boolean;
  /** MOD-NUT-01: clinically confirmed swallowing/dysphagia precautions. */
  dysphagia?: boolean;
  /** MOD-NUT-03: unintended weight loss / nutrition decline. */
  weightLoss?: boolean;
  /** Authorized clinical override of the computed level (CL-04/CL-21). */
  overrideLevel?: CareLevel;
  overrideReason?: string;
}

export interface AppliedMlr {
  id: string;
  minimumLevel: CareLevel | null; // null = modifier-only / no floor
  criticalNeed: string;
}

export interface DtRecommendation {
  recommendReview: boolean;
  rationale: string;
  triggers: string[];
}

/** Full deterministic classification result (Phase 1 engine output). */
export interface ClassificationResult {
  rawScore: number;             // sum of AS-01..14, max 56 (NS-01 excluded)
  advisoryBand: CareLevel;      // provisional legacy band (advisory only; GAP-001)
  bandingEnabled: boolean;      // whether advisory band may auto-fill the suggestion
  appliedMlrs: AppliedMlr[];    // every triggered minimum-level rule
  mlrFloor: CareLevel | null;   // highest floor among applied MLRs
  modifiers: string[];          // MOD-* codes auto-suggested from scores/context
  l5Pathway: boolean;           // MLR-018 authorized comfort pathway
  capabilityGate: boolean;      // MLR-011/015/016/019 or L5 -> capability review required
  overrideApplied: boolean;
  suggestedLevel: CareLevel;    // engine recommendation; nurse confirms Final LOC
  dt013: DtRecommendation;      // Private Caregiver / dedicated staffing review
  dt014: DtRecommendation;      // Additional Clinical Services review
  modelVersion: string;
  trace: string[];              // human-readable reasoning chain (B2 traceability)
}
