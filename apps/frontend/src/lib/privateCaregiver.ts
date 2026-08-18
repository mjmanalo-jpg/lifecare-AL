/**
 * Private (1:1) Caregiver — a nurse dedicates a caregiver to one resident. Because
 * it's a paid add-on, the family sponsor must APPROVE it (seeing the cost) before
 * it goes active and starts billing. Migration-free: assignments are a JSON array
 * in the app-setting `private_caregiver_assignments`.
 *
 * Flow: nurse assigns → PENDING_FAMILY → sponsor approves (with cost + e-sign) →
 * ACTIVE (recurring flat fee posts + accrues monthly) → ENDED (billing stops).
 */

export const PRIVATE_CARE_KEY = "private_caregiver_assignments";

export type PrivateCareStatus = "PENDING_FAMILY" | "ACTIVE" | "DECLINED" | "ENDED";
export type RateUnit = "day" | "month";

/**
 * Dedicated-staffing intensity, mapped to the DT-013 / PCG rules. Each intensity
 * carries the PCG rule that justifies a mandatory PCG fee (PCG-011 requires all
 * mandatory fees be traceable to documented incremental dedicated staffing).
 *   • none       — elective/none (no dedicated clinical need documented yet)
 *   • night      — PCG-004 night-specific safety need
 *   • 8h / 12h / 24h — PCG-003 prolonged 1:1 hands-on / PCG-002 line-of-sight
 *   • temporary  — PCG-005 post-acute/transitional (needs start/duration/exit)
 *   • elective   — PCG-007 family-requested companion (no LOC change; labelled elective)
 */
export type PcgIntensity = "none" | "night" | "8h" | "12h" | "24h" | "temporary" | "elective";

export interface PcgIntensityMeta {
  label: string;
  /** Primary PCG rule reference for this intensity. */
  ruleId: string;
  /** Whether this intensity is a mandatory (clinically-driven) PCG vs elective. */
  mandatory: boolean;
  hint: string;
}

export const PCG_INTENSITY_META: Record<PcgIntensity, PcgIntensityMeta> = {
  none: { label: "None / undecided", ruleId: "PCG-001", mandatory: false, hint: "Routine recurring care within the LOC package — no dedicated PCG." },
  night: { label: "Night-specific", ruleId: "PCG-004", mandatory: true, hint: "Dedicated overnight observation — shared night staffing cannot safely meet the need." },
  "8h": { label: "8h dedicated", ruleId: "PCG-003", mandatory: true, hint: "Prolonged 1:1 hands-on assistance for a defined 8h block." },
  "12h": { label: "12h dedicated", ruleId: "PCG-003", mandatory: true, hint: "Prolonged 1:1 hands-on assistance for a defined 12h block." },
  "24h": { label: "24h line-of-sight", ruleId: "PCG-002", mandatory: true, hint: "Continuous / near-continuous individual observation for safety." },
  temporary: { label: "Temporary / transitional", ruleId: "PCG-005", mandatory: true, hint: "Short-term post-acute decline — mandatory stop/review date + exit criteria." },
  elective: { label: "Elective companion", ruleId: "PCG-007", mandatory: false, hint: "Family-requested companion without assessed clinical necessity — labelled elective." },
};

export const PCG_INTENSITY_ORDER: PcgIntensity[] = ["none", "night", "8h", "12h", "24h", "temporary", "elective"];

// ── Structured coverage + shift ──────────────────────────────────────────────
// The scheduling the assigner picks: how many hours per day the dedicated
// caregiver covers, and on which shift. Composed into the human `schedule`
// string and used to default the clinical intensity.
export type PcgCoverage = 8 | 12 | 24;
export type PcgShift = "MORNING" | "NIGHT" | "FULL";

export const PCG_COVERAGE_OPTIONS: { value: PcgCoverage; label: string }[] = [
  { value: 8, label: "8 hours / day" },
  { value: 12, label: "12 hours / day" },
  { value: 24, label: "24 hours (continuous)" },
];
export const PCG_SHIFT_OPTIONS: { value: PcgShift; label: string }[] = [
  { value: "MORNING", label: "Morning shift" },
  { value: "NIGHT", label: "Night shift" },
];
export const PCG_SHIFT_LABEL: Record<PcgShift, string> = { MORNING: "Morning", NIGHT: "Night", FULL: "Continuous" };

/** Human schedule string from structured coverage + shift (stored in `schedule`). */
export function composeSchedule(coverage: PcgCoverage, shift: PcgShift): string {
  if (coverage === 24) return "24h continuous · all shifts";
  return `${PCG_SHIFT_LABEL[shift]} shift · ${coverage}h/day`;
}

/**
 * Default clinical intensity (→ PCG rule) implied by a coverage/shift choice.
 * The assigner may still override to temporary/elective for the clinical nuance.
 *   24h → PCG-002 line-of-sight · 12h → PCG-003 · 8h night → PCG-004 · 8h day → PCG-003.
 */
export function coverageToIntensity(coverage: PcgCoverage, shift: PcgShift): PcgIntensity {
  if (coverage === 24) return "24h";
  if (coverage === 12) return "12h";
  return shift === "NIGHT" ? "night" : "8h";
}

/**
 * Map a DT-013 assessment recommendation's triggers to a suggested coverage/shift
 * (used to pre-fill the assign form when the reassessment flags a private-caregiver
 * need). Ordered by clinical weight: continuous line-of-sight > extended > night.
 */
export interface PcgSuggestion { coverage: PcgCoverage; shift: PcgShift; intensity: PcgIntensity }
export function suggestPcgFromTriggers(triggers: string[]): PcgSuggestion {
  const t = (triggers || []).join(" ");
  if (/PCG-002/.test(t)) return { coverage: 24, shift: "FULL", intensity: "24h" };
  if (/PCG-004/.test(t)) return { coverage: 8, shift: "NIGHT", intensity: "night" };
  if (/PCG-003|PCG-006/.test(t)) return { coverage: 12, shift: "MORNING", intensity: "12h" };
  return { coverage: 8, shift: "MORNING", intensity: "8h" };
}

/** One elevated assessment domain, for the family-facing clinical picture. */
export interface PcgDomainScore { code: string; label: string; score: number }

/**
 * Snapshot of the resident's assessment taken when the PCG request was submitted —
 * shown to the family so they can see the completed assessment (and WHY a private
 * caregiver is needed) before approving/declining. Frozen at request time for audit.
 */
export interface PcgAssessmentSnapshot {
  level: string | null;
  rawScore?: number;
  status?: string;              // DRAFT | COMPLETED | VALIDATED
  assessedAt?: string;
  assessor?: string;
  recommend?: boolean;          // DT-013 recommended a private caregiver
  triggers: string[];           // the DT-013 triggers = why a PCG is indicated
  rationale?: string;
  reassessmentInterval?: string;
  nextReviewDate?: string;
  domains: PcgDomainScore[];    // elevated domains (score >= 2)
}

export interface PrivateCareAssignment {
  id: string;
  residentId: string;
  residentName: string;
  room?: string;
  sponsorId?: string;      // family payer (Resident.sponsorId), when on file
  sponsorName?: string;
  caregiverId: string;     // Staff.id of the assigned caregiver
  caregiverName: string;
  schedule: string;        // composed human string, e.g. "Morning shift · 8h/day"
  coverageHours?: PcgCoverage; // structured coverage behind `schedule` (8 | 12 | 24)
  shift?: PcgShift;            // structured shift behind `schedule`
  rate: number;            // flat fee amount (PHP)
  rateUnit: RateUnit;      // per day / per month
  status: PrivateCareStatus;
  requestedBy: string;     // nurse / care manager name
  requestedAt: string;
  decidedBy?: string;      // sponsor who approved/declined
  decidedAt?: string;
  declineReason?: string;
  startDate?: string;      // set on approval
  endDate?: string;        // set on end
  notes?: string;

  // ── DT-013 governance fields ─────────────────────────────────────────────
  /** Dedicated-staffing intensity → PCG rule mapping (see PCG_INTENSITY_META). */
  intensity?: PcgIntensity;
  /** PCG-002/003/004/006/011: why shared 1:6 staffing is insufficient (required for mandatory PCG). */
  rationale?: string;
  /** PCG-011: reviewer confirmed this is incremental dedicated staffing only (not LOC-included care). */
  incrementalConfirmed?: boolean;
  /** Who authorised the PCG (nurse / care manager / admin). */
  authorisedBy?: string;
  authorisedAt?: string;
  /** Mandatory review-date gate (PCG-002/004/011). An ACTIVE PCG past this is "review overdue". */
  reviewDate?: string;
  /** PCG-005 temporary intensity extras. */
  expectedDurationDays?: number;
  exitCriteria?: string;
  /** Assessment snapshot at request time — the family reviews this before deciding. */
  assessment?: PcgAssessmentSnapshot;
}

/** Human-readable PCG rule references surfaced in the UI. */
export const PCG_RULE_REFS: { id: string; label: string }[] = [
  { id: "PCG-002", label: "Dedicated line-of-sight supervision" },
  { id: "PCG-003", label: "Prolonged 1:1 hands-on assistance" },
  { id: "PCG-004", label: "Night-specific safety need" },
  { id: "PCG-006", label: "Behavioral / cognitive safety" },
  { id: "PCG-007", label: "Family-requested (elective) companion" },
  { id: "PCG-011", label: "Mandatory PCG-fee justification" },
];

export function parsePrivateCare(raw: string | null | undefined): PrivateCareAssignment[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => x && typeof x.id === "string") : [];
  } catch {
    return [];
  }
}

export const RATE_UNIT_LABEL: Record<RateUnit, string> = { day: "per day", month: "per month" };

export const PRIVATE_CARE_STATUS_META: Record<PrivateCareStatus, { label: string; cls: string }> = {
  PENDING_FAMILY: { label: "Pending family", cls: "bg-amber-100 text-amber-700" },
  ACTIVE: { label: "Active", cls: "bg-green-100 text-green-700" },
  DECLINED: { label: "Declined", cls: "bg-red-100 text-red-700" },
  ENDED: { label: "Ended", cls: "bg-slate-200 text-slate-600" },
};

/** Approximate monthly cost of an assignment (per-day fees × 30) for a comparable stat. */
export function monthlyEquivalent(a: Pick<PrivateCareAssignment, "rate" | "rateUnit">): number {
  return a.rateUnit === "day" ? (Number(a.rate) || 0) * 30 : Number(a.rate) || 0;
}

/**
 * BR-013.05 / PCG-011 anti-double-charge guard (pure). Before activating/charging
 * a PCG, flag when the stated rationale describes care that a resident's LOC
 * package already covers — a PCG fee is permitted only for *incremental* dedicated
 * staffing beyond the LOC-included care. Callers require the reviewer to confirm
 * "incremental dedicated staffing only" before the charge may post.
 *
 * The heuristic scans the rationale for LOC-included care verbs (ADL / toileting /
 * routine monitoring, etc.). A hit does NOT block outright — it warns and requires
 * the incremental-confirmed acknowledgement, mirroring the plan's review safeguard.
 */
const LOC_INCLUDED_TERMS = [
  "adl", "activities of daily living", "toilet", "bath", "shower", "dress", "grooming",
  "feed", "feeding", "meal assist", "routine monitoring", "medication administration",
  "transfer", "ambulation", "mobility assist", "hygiene", "incontinence care",
];

export interface PcgAntiDoubleChargeResult {
  /** True → rationale overlaps LOC-included care; reviewer must confirm incremental-only. */
  overlaps: boolean;
  /** The matched LOC-included terms (for the UI warning). */
  matchedTerms: string[];
  /** Whether the charge may proceed given the reviewer's incrementalConfirmed flag. */
  allowed: boolean;
  reason: string;
}

export function pcgAntiDoubleCharge(a: Pick<PrivateCareAssignment, "rationale" | "intensity" | "incrementalConfirmed">): PcgAntiDoubleChargeResult {
  const text = String(a.rationale ?? "").toLowerCase();
  const matched = LOC_INCLUDED_TERMS.filter((t) => text.includes(t));
  const overlaps = matched.length > 0;
  const elective = a.intensity === "elective" || a.intensity === "none";

  // Elective add-ons are not mandatory fees and are exempt from the LOC-overlap gate.
  if (elective) {
    return { overlaps, matchedTerms: matched, allowed: true, reason: "Elective add-on — not a mandatory PCG fee (PCG-007)." };
  }
  if (!overlaps) {
    return { overlaps: false, matchedTerms: [], allowed: true, reason: "Rationale describes incremental dedicated staffing (no LOC overlap detected)." };
  }
  // Overlap detected — require the reviewer's incremental-only confirmation (PCG-011).
  if (a.incrementalConfirmed) {
    return { overlaps: true, matchedTerms: matched, allowed: true, reason: "LOC-included care referenced, but reviewer confirmed incremental dedicated staffing only (PCG-011)." };
  }
  return {
    overlaps: true,
    matchedTerms: matched,
    allowed: false,
    reason: `Rationale references care already in the LOC package (${matched.join(", ")}). Confirm "incremental dedicated staffing only" before charging (BR-013.05 / PCG-011).`,
  };
}

/** Mandatory review-date gate: an ACTIVE PCG past its reviewDate is "review overdue" (PCG-002/004/011). */
export function pcgReviewOverdue(a: Pick<PrivateCareAssignment, "status" | "reviewDate">, now: Date = new Date()): boolean {
  if (a.status !== "ACTIVE" || !a.reviewDate) return false;
  const due = new Date(a.reviewDate);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() < now.getTime();
}
