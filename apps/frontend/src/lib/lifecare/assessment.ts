// Phase 0 — Resident Assessment v4.2 data model + persistence contract.
// The v4.2 three-layer assessment replaces the legacy 50-point pre-admission
// form. Stored migration-free in the app-setting `assessments_v42` (JSON array),
// tenant-scoped like every other board. The old `preadmission_assessments`
// store is kept read-only.

import { classify, rawScore } from "./classification.ts";
import { traceStamp } from "./governance.ts";
import { DOMAIN_CODES } from "./types.ts";
import type {
  CareLevel, DomainCode, DomainScores, ClinicalContext, ClassificationResult,
} from "./types.ts";

export const ASSESSMENTS_V42_KEY = "assessments_v42";

export type AssessmentStatus = "DRAFT" | "COMPLETED" | "VALIDATED" | "SUPERSEDED";

/**
 * Which board an assessment belongs to. The same v4.2 instrument is used in two
 * separate places that must NOT share their lists:
 *  - PREADMISSION — the Pre-Admission Assessment board (intake).
 *  - ACUITY       — the Care Acuity & Level of Care board (ongoing reassessments).
 * Legacy records written before this tag existed default to PREADMISSION (the
 * instrument's original home), via {@link originOf}.
 */
export type AssessmentOrigin = "PREADMISSION" | "ACUITY" | "ADMISSION";

/** The board an assessment belongs to; untagged legacy records → PREADMISSION. */
export function originOf(a: Pick<AssessmentV42, "origin">): AssessmentOrigin {
  return a.origin ?? "PREADMISSION";
}

export type YesNoVerify = "YES" | "NO" | "NEEDS_VERIFICATION";
export type ParticipationLevel = "INDEPENDENTLY" | "WITH_SUPPORT" | "LIMITED_NO";
export type AdvanceDirectiveStatus = "AVAILABLE" | "REQUESTED" | "NOT_AVAILABLE" | "NOT_APPLICABLE";

/** A single structured medication captured in the shared Medications editor
 * (assessment + admission). Flows into each resident's MAR via medSync. */
export interface MedItem {
  name: string;
  dose?: string;
  frequency?: string;         // one of medConstants.FREQUENCIES
  instructions?: string;      // special instructions, e.g. "Take with food, monitor BP"
  requiresVitals?: boolean;   // Vitals First — alert to record vitals before a Given dose
}

/** Layer 1 — resident profile + clinical history + decision-support baseline. */
export interface AssessmentLayer1 {
  // Resident profile
  residentName: string;              // composed "First Middle Last" (kept for all readers)
  firstName?: string;                // structured name parts (prefilled from CRM lead)
  middleName?: string;
  lastName?: string;
  residentId?: string;               // linked resident record, once admitted
  convertedAdmissionId?: string;     // link to in-progress admission (CRM lead)
  dateOfBirth?: string;
  age?: string;
  sex?: string;
  assessmentDate?: string;
  assessmentLocation?: string;       // (was `location`)
  location?: string;                 // retained for backward-compat
  primaryContact?: string;
  primaryContactRelationship?: string;
  contactNo?: string;
  referralSource?: string;
  assessor?: string;
  assessorRole?: string;
  currentLivingArrangement?: string;
  primaryCaregiver?: string;
  reasonForAdmission?: string;
  admissionTargetDate?: string;

  // Clinical history (non-scored baseline)
  diagnoses?: string;                // primary/current diagnoses
  surgeries?: string;                // significant history / surgeries
  allergies?: string;
  medications?: string;              // legacy free-text (parsed by medItemsOf for back-compat)
  medicationList?: MedItem[];        // structured medications (authoritative)
  medicationListReviewed?: YesNoVerify;
  hospitalEd12mo?: boolean;
  hospitalEdReason?: string;
  significantChange3090?: boolean;
  significantChangeDescribe?: string;
  physicianFollowUp?: string;
  hospitalizations?: string;         // retained for backward-compat

  // Decision support & person-centered baseline (NS-01, non-scored)
  canParticipate?: ParticipationLevel;
  authorizedRepresentative?: string; // name / relationship
  familyInvolvement?: string[];      // routine / significant-only / shared / other
  familyInvolvementOther?: string;
  advanceDirective?: AdvanceDirectiveStatus;
  culturalPreferences?: string;      // cultural / spiritual / privacy
  overallGoals?: string[];           // independence / function / comfort-safety / social / other
  overallGoalsOther?: string;
  goalsPreferences?: string;         // free-text NS-01 goals/preferences
  advanceCareContext?: string;
}

/** Per-domain capture: 0-4 score + individualisation goal note + modifier flags. */
export interface DomainEntry {
  score: number;              // 0-4 (AS-*); NS-01 excluded from total
  goalNote?: string;
  evidence?: string;
  modifierFlags?: string[];   // MOD-* the assessor flagged in-flow (CL-02)
}

export type ModifierReconciliationDecision = "APPLIED" | "NOT_APPLICABLE";
export interface ModifierReconciliation {
  decision: ModifierReconciliationDecision;
  /** Required when a flagged/suggested modifier is cleared as not applicable. */
  rationale?: string;
}

export type CapabilityReviewOutcome = "WITHIN_CAPABILITY" | "ESCALATE_TRANSFER" | "EMERGENCY_PATHWAY";
export interface CapabilityReview {
  outcome: CapabilityReviewOutcome;
  rationale: string;
}

/** Layer 3 — final evaluation (calibration-safe). */
export interface AssessmentLayer3 {
  finalLevel?: CareLevel;        // nurse-selected Final LOC
  finalLevelJustification?: string;
  /** Clinical rationale when the nurse/CM sets a Final LOC BELOW the engine's MLR floor (G3 soft override). */
  belowFloorReason?: string;
  /** Clinical rationale when the Final LOC differs from the engine's suggested band but is NOT below the MLR floor (that case uses belowFloorReason). */
  overrideReason?: string;
  /** Final applied modifier set retained for existing downstream consumers. */
  reconciledModifiers?: string[];
  /** Per-flag disposition proves every suggested/in-flow modifier was reviewed. */
  modifierReconciliations?: Record<string, ModifierReconciliation>;
  /** Required when an MLR/care pathway invokes the capability gate. */
  capabilityReview?: CapabilityReview;
  // reassessment (Section H)
  reassessmentInterval?: string;
  nextReviewDate?: string;
  priorAssessmentId?: string;
  /** In-progress Clinical Validation sign-off (decision + notes), saved with a DRAFT
   * before the PIN-signed `validation` is committed, so it survives Save Draft / reopen. */
  validationDraft?: { decision: "APPROVED" | "APPROVED_WITH_CHANGES" | "NEEDS_REASSESSMENT"; notes?: string };
}

export interface AssessmentV42 {
  id: string;
  status: AssessmentStatus;
  origin?: AssessmentOrigin;    // which board owns this record (default PREADMISSION)
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

/** All modifiers that require an explicit Layer-3 disposition (G2 / CL-02). */
export function requiredModifierIds(a: Pick<AssessmentV42, "domains" | "context">): string[] {
  const ids = new Set(classifyAssessment(a).modifiers);
  for (const entry of Object.values(a.domains)) {
    for (const id of entry?.modifierFlags ?? []) if (id) ids.add(id);
  }
  return [...ids].sort();
}

export type AssessmentValidationGate = "G1" | "G2" | "G3" | "G4" | "G5";
export interface AssessmentValidationIssue {
  gate: AssessmentValidationGate;
  message: string;
  layer: 2 | 3;
}

const LEVEL_RANK: Record<CareLevel, number> = { L1: 1, L2: 2, L3: 3, L4: 4, L5: 5 };

/**
 * Finalized assessment → Final LOC sign-off gates. This keeps the workbook's
 * G1–G5 controls executable instead of relying on the reviewer to notice a
 * missing field in the UI.
 */
export function assessmentValidationIssues(a: Pick<AssessmentV42, "domains" | "context" | "layer3">): AssessmentValidationIssue[] {
  const issues: AssessmentValidationIssue[] = [];
  const result = classifyAssessment(a);

  const unsupported = DOMAIN_CODES.filter((code) => {
    const entry = a.domains[code];
    const scoreValid = !!entry && Number.isInteger(entry.score) && entry.score >= 0 && entry.score <= 4;
    // goalNote is accepted for legacy drafts written before evidence had its own field.
    const evidence = entry?.evidence?.trim() || entry?.goalNote?.trim();
    return !scoreValid || !evidence;
  });
  // One issue per incomplete domain so the "items left" count reflects real work.
  for (const code of unsupported) {
    issues.push({ gate: "G1", layer: 2, message: `Document a 0–4 score and supporting evidence for ${code}.` });
  }

  const modifierIssues: string[] = [];
  for (const id of requiredModifierIds(a)) {
    const review = a.layer3.modifierReconciliations?.[id];
    // Backward-compatible: an id in reconciledModifiers is an APPLIED disposition.
    if (!review && !a.layer3.reconciledModifiers?.includes(id)) modifierIssues.push(`${id} needs a disposition`);
    else if (review?.decision === "NOT_APPLICABLE" && !review.rationale?.trim()) modifierIssues.push(`${id} needs a not-applicable rationale`);
  }
  // One issue per flagged modifier so each counts as its own remaining item.
  for (const m of modifierIssues) {
    issues.push({ gate: "G2", layer: 3, message: `Reconcile flagged modifier — ${m}.` });
  }

  // G3 — a Final LOC below the engine's minimum-level floor is the nurse/CM's
  // clinical call, but must be justified: allowed only with a documented reason.
  if (result.mlrFloor && a.layer3.finalLevel && LEVEL_RANK[a.layer3.finalLevel] < LEVEL_RANK[result.mlrFloor] && !a.layer3.belowFloorReason?.trim()) {
    issues.push({ gate: "G3", layer: 3, message: `Final LOC ${a.layer3.finalLevel} is below the triggered ${result.mlrFloor} minimum-level floor — document the clinical reason for going below the floor.` });
  }

  // G3 — a Final LOC that overrides the engine's suggested band (but is not below
  // the MLR floor, which the check above already covers) needs its own reason.
  if (
    result.suggestedLevel &&
    a.layer3.finalLevel &&
    a.layer3.finalLevel !== result.suggestedLevel &&
    !(result.mlrFloor && LEVEL_RANK[a.layer3.finalLevel] < LEVEL_RANK[result.mlrFloor]) &&
    !a.layer3.overrideReason?.trim()
  ) {
    issues.push({ gate: "G3", layer: 3, message: `Final LOC ${a.layer3.finalLevel} overrides the engine's suggested ${result.suggestedLevel} — document the reason for overriding.` });
  }

  if (a.context.overrideLevel && !a.context.overrideReason?.trim()) {
    issues.push({ gate: "G4", layer: 3, message: "Document the clinical override rationale." });
  }
  if (result.capabilityGate) {
    const review = a.layer3.capabilityReview;
    if (!review?.outcome || !review.rationale?.trim()) {
      issues.push({ gate: "G4", layer: 3, message: "Complete the capability review outcome and rationale." });
    }
  }

  if (!a.layer3.finalLevel) issues.push({ gate: "G5", layer: 3, message: "Select the nurse-confirmed Final Level of Care." });
  if (!a.layer3.finalLevelJustification?.trim()) {
    issues.push({ gate: "G5", layer: 3, message: "Document why the Final LOC reflects the resident's intrinsic need." });
  }
  return issues;
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

const s = (v: unknown) => (v == null ? "" : String(v));

/** The resident's structured medications: the new `medicationList`, or the legacy
 * free-text `medications` string parsed one-per-line into name-only rows. */
export function medItemsOf(l1?: Pick<AssessmentLayer1, "medicationList" | "medications"> | null): MedItem[] {
  const list = l1?.medicationList;
  if (Array.isArray(list) && list.length) return list.filter((m) => (m?.name || "").trim());
  const raw = (l1?.medications || "").trim();
  if (!raw) return [];
  return raw.split(/\r?\n|;|,/).map((x) => x.trim()).filter(Boolean).map((name) => ({ name }));
}

/** Normalized name token-SET key for tolerant resident↔assessment matching — order
 *  and duplicate parts don't matter, so "Marina Dacanay Drohman" matches a resident
 *  record mis-composed as "Marina Dacanay Dacanay Drohman". */
function nameTokenKey(name: string | undefined | null): string {
  return [...new Set(String(name ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean))].sort().join(" ");
}

export interface ResidentKey { residentId?: string; admissionIds?: string[]; residentName?: string }

/**
 * Does this assessment belong to the given resident? Matches by linked residentId,
 * linked admission (convertedAdmissionId), OR normalized name token-set. The name
 * fallback is what links a pre-admission assessment (captured before a Resident
 * record existed, so residentId is empty) to the resident once admitted.
 */
export function assessmentMatchesResident(a: Pick<AssessmentV42, "layer1">, key: ResidentKey): boolean {
  const rid = key.residentId?.trim();
  if (rid && s(a.layer1?.residentId) === rid) return true;
  const adm = s(a.layer1?.convertedAdmissionId);
  if (adm && (key.admissionIds ?? []).includes(adm)) return true;
  const nk = nameTokenKey(key.residentName);
  return !!nk && nameTokenKey(a.layer1?.residentName) === nk;
}

/**
 * Pre-admission assessments still owned by the admissions board: every DRAFT, plus
 * finalized records whose resident has not been onboarded yet. Once the resident is
 * onboarded, the finalized (COMPLETED/VALIDATED) pre-admission assessment belongs to
 * the clinical record and is read in One Care · One Journey instead — keeping it on
 * the admissions list makes onboarded residents look like open admissions work.
 */
export function pendingPreadmissionAssessments<T extends Pick<AssessmentV42, "layer1" | "status">>(all: T[], onboarded: ResidentKey[]): T[] {
  return all.filter((a) => a.status === "DRAFT" || !onboarded.some((k) => assessmentMatchesResident(a, k)));
}

const STATUS_RANK: Record<AssessmentStatus, number> = { VALIDATED: 3, COMPLETED: 2, DRAFT: 1, SUPERSEDED: 0 };

/** The most authoritative assessment for a resident: VALIDATED first, then COMPLETED,
 *  then most-recently updated. Null when none match. */
export function authoritativeAssessmentFor(all: AssessmentV42[], key: ResidentKey): AssessmentV42 | null {
  const mine = all.filter((a) => assessmentMatchesResident(a, key));
  if (!mine.length) return null;
  mine.sort((a, b) => (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0) || s(b.updatedAt).localeCompare(s(a.updatedAt)));
  return mine[0];
}

/**
 * One assessment per resident: each resident's CURRENT record, by the same ranking
 * {@link authoritativeAssessmentFor} uses.
 *
 * The store is append-only — a reassessment leaves the superseded draft behind, and a
 * pre-admission record captured before the Resident existed sits alongside the admitted
 * one. Governance reads must start here, or a resident whose assessment is validated
 * keeps reappearing on the board because of a draft nobody is working on any more.
 *
 * ponytail: O(n²) grouping — n is one community's assessments (tens). Swap in an
 * identity map if that ever reaches thousands.
 */
export function authoritativeAssessments(all: AssessmentV42[]): AssessmentV42[] {
  const groups: AssessmentV42[][] = [];
  for (const a of all) {
    // Identity is fuzzy (residentId, admission, or name), so compare against every
    // member: a name-only pre-admission record and an id-bearing one must collapse.
    const group = groups.find((members) => members.some((m) => assessmentMatchesResident(a, {
      residentId: s(m.layer1?.residentId) || undefined,
      admissionIds: [s(m.layer1?.convertedAdmissionId)].filter(Boolean),
      residentName: m.layer1?.residentName,
    })));
    if (group) group.push(a);
    else groups.push([a]);
  }
  return groups.map((members) => [...members].sort((a, b) =>
    (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0)
    || s(b.updatedAt).localeCompare(s(a.updatedAt)))[0]);
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
