/**
 * DT-014 — Additional Clinical Services (ACS) pricing engine (pure, client + server safe).
 *
 * A resident may need discrete skilled services beyond their LOC package (skilled
 * procedures, IV therapy, wound care, private-duty nursing, supplies, transport…).
 * Each is an ACS "determination" tied to one ACS rule (ACS-001..015). This module:
 *   • ACS-014 anti-double-charge — never bill for an intervention/time/material
 *     already in LOC / PCG / dedicated nursing / another package.
 *   • ACS-010 dedicated private-duty NURSING is DISTINCT from a private caregiver.
 *   • ACS-015 temporary-to-recurring — a temporary service past its review date
 *     triggers a reassessment alert (never auto-continues billing).
 *
 * Migration-free: determinations live as a JSON array in the app-setting
 * `additional_clinical_services`. The prisma-free apply/marker helpers here are
 * shared by the board (client post) and any future cron accrual.
 */

import { ACS_RULES } from "./dataset.ts";
import { periodTag } from "../billingLibrary.ts";
import type { AcsRule } from "./types.ts";

export const ACS_KEY = "additional_clinical_services";
export const ACS_MARKER_PREFIX = "[acs:";
export const ACS_CATEGORY = "Medical";

export type AcsStatus = "ACTIVE" | "STOPPED";
export type AcsInclusion = "Yes" | "No" | "Maybe";

export interface AcsDetermination {
  id: string;
  residentId: string;
  residentName: string;
  room?: string;
  /** Which ACS rule (ACS-001..015) governs this determination. */
  acsRuleId: string;
  service: string;
  /** Normalised inclusion verdict (derived from the rule but reviewer-confirmable). */
  includedInLoc: AcsInclusion;
  /** Whether a separate charge is allowed at all for this service. */
  separateChargeAllowed: boolean;
  rationale: string;
  startDate?: string;
  /** ACS-015 review date — a temporary service past this triggers reassessment. */
  reviewDate?: string;
  stopDate?: string;
  status: AcsStatus;
  amount?: number;
  authorisedBy?: string;
  authorisedAt?: string;
  createdBy?: string;
  createdAt?: string;
  notes?: string;
}

/** Lookup an ACS rule by id. */
export const acsRuleById = (id: string): AcsRule | undefined => ACS_RULES.find((r) => r.id === id);

/**
 * Normalise a rule's free-text `includedInLoc` string into Yes / No / Maybe.
 * "Yes…" → Yes; anything mentioning "no" (No / No unless…) → No; else Maybe
 * ("Define package threshold", "Reclassify…", "N/A").
 */
export function normaliseInclusion(raw: string): AcsInclusion {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s.startsWith("yes")) return "Yes";
  if (s.startsWith("no")) return "No";
  return "Maybe";
}

/**
 * Normalise a rule's free-text `separateCharge` string into a boolean allow flag.
 * Anything starting with "yes" or "potentially" allows a charge; "usually no" /
 * "no" / "required before charging" / "reassessment trigger" / "do not…" do not.
 */
export function normaliseSeparateCharge(raw: string): boolean {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s.startsWith("yes")) return true;
  if (s.startsWith("potentially")) return true;
  if (s.startsWith("maybe")) return true; // reviewer decides; allow with confirmation
  return false;
}

/** Build a fresh determination shell from a picked ACS rule (auto-fills verdicts). */
export function fromRule(ruleId: string): Pick<AcsDetermination, "acsRuleId" | "service" | "includedInLoc" | "separateChargeAllowed"> | null {
  const rule = acsRuleById(ruleId);
  if (!rule) return null;
  return {
    acsRuleId: rule.id,
    service: rule.service,
    includedInLoc: normaliseInclusion(rule.includedInLoc),
    separateChargeAllowed: normaliseSeparateCharge(rule.separateCharge),
  };
}

export interface PackageInclusionContext {
  /** The same intervention/time is already inside the resident's LOC package. */
  locIncluded: boolean;
  /** The same care is already covered by an active Private Caregiver (PCG). */
  pcgIncluded: boolean;
  /** The same nursing time is already covered by a dedicated private-duty nursing add-on. */
  dedicatedNursingIncluded: boolean;
  /** The same unit of service is already billed under another package/add-on. */
  otherPackageIncluded?: boolean;
}

export interface AcsChargeVerdict {
  allowed: boolean;
  reason: string;
}

/**
 * ACS-014 anti-double-charge check (pure). Blocks charging when the same
 * intervention/time/material is already represented in LOC / PCG / dedicated
 * nursing / another package.
 *
 * NOTE (ACS-010): dedicated private-duty NURSING is a DISTINCT service from a
 * private caregiver (PCG). An ACS-010 determination is therefore NOT blocked by
 * `pcgIncluded` — only by `dedicatedNursingIncluded` (its own overlap). Likewise
 * a non-nursing ACS is not blocked merely because dedicated nursing is present.
 */
export function acsChargeAllowed(d: Pick<AcsDetermination, "acsRuleId" | "separateChargeAllowed" | "includedInLoc">, ctx: PackageInclusionContext): AcsChargeVerdict {
  if (!d.separateChargeAllowed) {
    return { allowed: false, reason: "This service is not separately chargeable per its ACS rule." };
  }
  if (d.includedInLoc === "Yes") {
    return { allowed: false, reason: "ACS-014: service is included in the resident's LOC package — no separate charge." };
  }
  if (ctx.locIncluded) {
    return { allowed: false, reason: "ACS-014: the same intervention/time is already covered by the LOC package." };
  }
  if (ctx.otherPackageIncluded) {
    return { allowed: false, reason: "ACS-014: the same unit of service is already billed under another package." };
  }

  const isDedicatedNursing = d.acsRuleId === "ACS-010";
  if (isDedicatedNursing) {
    // ACS-010 is distinct from PCG; overlap is only with an existing dedicated-nursing add-on.
    if (ctx.dedicatedNursingIncluded) {
      return { allowed: false, reason: "ACS-014: dedicated private-duty nursing is already billed — do not duplicate." };
    }
    return { allowed: true, reason: "ACS-010 dedicated private-duty nursing is distinct from PCG and LOC oversight — chargeable." };
  }

  // Non-nursing services: a private caregiver covering the SAME care blocks the charge.
  if (ctx.pcgIncluded) {
    return { allowed: false, reason: "ACS-014: the same care is already delivered under an active Private Caregiver (PCG)." };
  }
  if (ctx.dedicatedNursingIncluded) {
    return { allowed: false, reason: "ACS-014: the same nursing time is already billed under dedicated private-duty nursing." };
  }
  return { allowed: true, reason: "Discrete skilled service outside LOC/PCG/dedicated-nursing coverage — chargeable." };
}

/**
 * ACS-015 temporary-to-recurring reassessment trigger (pure). A temporary/
 * time-limited service whose review date has passed must NOT auto-continue
 * billing — it triggers a reassessment alert instead.
 */
export function acsReassessmentDue(d: Pick<AcsDetermination, "status" | "reviewDate">, now: Date = new Date()): boolean {
  if (d.status !== "ACTIVE" || !d.reviewDate) return false;
  const due = new Date(d.reviewDate);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() < now.getTime();
}

/** Idempotency marker embedded in the ServiceCharge description: [acs:<id>:<YYYY-MM>]. */
export function acsMarker(id: string, tag: string): string {
  return `${ACS_MARKER_PREFIX}${id}:${tag}]`;
}

export { periodTag };

export function parseAcsDeterminations(raw: string | null | undefined): AcsDetermination[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => x && typeof x.id === "string") : [];
  } catch {
    return [];
  }
}

export const ACS_STATUS_META: Record<AcsStatus, { label: string; cls: string }> = {
  ACTIVE: { label: "Active", cls: "bg-green-100 text-green-700" },
  STOPPED: { label: "Stopped", cls: "bg-slate-200 text-slate-600" },
};
