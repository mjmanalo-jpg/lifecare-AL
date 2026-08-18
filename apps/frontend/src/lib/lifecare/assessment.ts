// Phase 0 — Resident Assessment v4.2 data model + persistence contract.
// The v4.2 three-layer assessment replaces the legacy 50-point pre-admission
// form. Stored migration-free in the app-setting `assessments_v42` (JSON array),
// tenant-scoped like every other board. The old `preadmission_assessments`
// store is kept read-only.

import { classify, rawScore } from "./classification.ts";
import { traceStamp } from "./governance.ts";
import type {
  CareLevel, DomainCode, DomainScores, ClinicalContext, ClassificationResult,
} from "./types.ts";

export const ASSESSMENTS_V42_KEY = "assessments_v42";

export type AssessmentStatus = "DRAFT" | "COMPLETED" | "VALIDATED" | "SUPERSEDED";

/** Layer 1 — resident profile + clinical history + decision-support baseline. */
export interface AssessmentLayer1 {
  residentName: string;
  residentId?: string;          // linked resident record, once admitted
  convertedAdmissionId?: string; // link to in-progress admission (CRM lead)
  dateOfBirth?: string;
  age?: string;
  sex?: string;
  assessmentDate?: string;
  assessor?: string;
  location?: string;
  primaryContact?: string;
  contactNo?: string;
  // Clinical history (non-scored baseline)
  diagnoses?: string;
  medications?: string;
  allergies?: string;
  surgeries?: string;
  hospitalizations?: string;
  // NS-01 goals / preferences / decision support (non-scored)
  goalsPreferences?: string;
  authorizedRepresentative?: string;
  advanceCareContext?: string;
}

/** Per-domain capture: 0-4 score + individualisation goal note + modifier flags. */
export interface DomainEntry {
  score: number;              // 0-4 (AS-*); NS-01 excluded from total
  goalNote?: string;
  evidence?: string;
  modifierFlags?: string[];   // MOD-* the assessor flagged in-flow (CL-02)
}

/** Layer 3 — final evaluation (calibration-safe). */
export interface AssessmentLayer3 {
  finalLevel?: CareLevel;        // nurse-selected Final LOC
  finalLevelJustification?: string;
  reconciledModifiers?: string[];
  // reassessment (Section H)
  reassessmentInterval?: string;
  nextReviewDate?: string;
  priorAssessmentId?: string;
}

export interface AssessmentV42 {
  id: string;
  status: AssessmentStatus;
  modelVersion: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;

  layer1: AssessmentLayer1;
  domains: Partial<Record<DomainCode, DomainEntry>>;
  context: ClinicalContext;     // pathway / acute / dysphagia / recentHospitalization / override
  layer3: AssessmentLayer3;

  // completion / approval (reuse existing PIN-signed + nurse->admin flow)
  completedBy?: string;
  completedAt?: string;
  validation?: {
    by: string; role: string; at: string;
    decision: "APPROVED" | "APPROVED_WITH_CHANGES" | "NEEDS_REASSESSMENT";
    notes?: string;
  };
}

/** Extract the AS-01..AS-14 scores as a DomainScores map for the engine. */
export function domainScores(a: Pick<AssessmentV42, "domains">): DomainScores {
  const out: DomainScores = {};
  for (const [code, entry] of Object.entries(a.domains)) {
    if (entry) out[code as DomainCode] = entry.score;
  }
  return out;
}

/** Run the Phase-1 classification engine against an assessment. */
export function classifyAssessment(a: Pick<AssessmentV42, "domains" | "context">): ClassificationResult {
  return classify(domainScores(a), a.context ?? {});
}

export function assessmentRawScore(a: Pick<AssessmentV42, "domains">): number {
  return rawScore(domainScores(a));
}

/**
 * The authoritative Final LOC for downstream engines (Care Acuity / LOC billing
 * / care-plan generation). Prefers the nurse-selected Final LOC (Layer 3);
 * falls back to the engine suggestion. Never auto-applies the advisory band.
 */
export function finalLevel(a: AssessmentV42): CareLevel | null {
  if (a.layer3?.finalLevel) return a.layer3.finalLevel;
  if (a.status === "DRAFT") return null;
  return classifyAssessment(a).suggestedLevel;
}

export function newAssessment(id: string, createdBy: string | undefined, nowISO: string): AssessmentV42 {
  return {
    id,
    status: "DRAFT",
    ...traceStamp(nowISO),
    createdAt: nowISO,
    updatedAt: nowISO,
    createdBy,
    layer1: { residentName: "", assessmentDate: nowISO.slice(0, 10), assessor: createdBy },
    domains: {},
    context: {},
    layer3: {},
  } as AssessmentV42;
}

/** Clone a validated assessment as a fresh DRAFT for reassessment (Section H). */
export function cloneForReassessment(prior: AssessmentV42, id: string, nowISO: string): AssessmentV42 {
  return {
    ...newAssessment(id, prior.createdBy, nowISO),
    layer1: { ...prior.layer1 },
    domains: JSON.parse(JSON.stringify(prior.domains)),
    context: { ...prior.context, overrideLevel: undefined, overrideReason: undefined },
    layer3: { priorAssessmentId: prior.id },
  };
}
