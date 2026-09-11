// Family sign-off gate for a Level-of-Care CHANGE (reassessment). A validated
// reassessment that would move a resident to a new level is NOT applied
// immediately — it is held here for the resident's family to approve/reject
// (because the LOC change drives billing), then a nurse/Care Manager finalizes
// it, which applies the level + billing + generates the draft care plan.
// Migration-free: a JSON array in the app-setting `loc_signoffs`.

import { createRecord, updateRecord } from "@/lib/api";
import { generateCarePlanFromV42 } from "@/lib/carePlanV42Gen";
import { recordLocChange } from "./locHistory";
import type { AssessmentV42 } from "./assessment";

export const LOC_SIGNOFF_KEY = "loc_signoffs";
export type LocSignoffStatus = "PENDING_FAMILY" | "FAMILY_APPROVED" | "REJECTED" | "APPLIED";

export interface LocSignoff {
  id: string;
  residentId: string;
  residentName?: string;
  sponsorId?: string;          // family sponsor user id (scopes the family portal)
  oldLevel?: string;           // "L2"
  newLevel: string;            // "L3"
  careLevelEnum?: string;      // enum written to resident.careLevel on apply
  numericLevel?: number;       // 1..5 (for the LOC billing charge)
  postLocCharge?: boolean;
  generatePlan?: boolean;
  assessmentId?: string;       // the v4.2 assessment this change came from
  justification?: string;
  status: LocSignoffStatus;
  submittedById?: string;
  submittedByName?: string;
  role?: string;
  createdAt: string;
  familyDecision?: "APPROVED" | "REJECTED";
  familyDecidedByName?: string; familyDecidedAt?: string; familyRejectReason?: string;
  appliedByName?: string; appliedAt?: string;
}

export function parseLocSignoffs(raw?: string | null): LocSignoff[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((x) => x && typeof x.id === "string") : []; } catch { return []; }
}

// Only a Care Manager or Superadmin approves a LOC change (per the client: the
// nurse cannot approve a reassessment; no family sign-off is required).
export function canFinalizeLoc(role: string | null | undefined): boolean {
  return role === "CARE_MANAGER" || role === "SUPERADMIN";
}

let seq = 0;
const newId = () => `locs-${Date.now().toString(36)}-${(seq += 1)}`;

/** Append a PENDING_FAMILY LOC-change sign-off and persist (best-effort). */
export async function recordLocSignoff(opts: Omit<LocSignoff, "id" | "status" | "createdAt"> & { nowISO?: string }): Promise<LocSignoff | null> {
  try {
    const res = await fetch(`/api/db/app-settings?f_key=${LOC_SIGNOFF_KEY}&take=1`, { credentials: "include", cache: "no-store" });
    const json = res.ok ? await res.json() : null;
    const row = (json?.data as Array<{ value?: string }> | undefined)?.[0];
    const items = parseLocSignoffs(row?.value);
    const { nowISO, ...rest } = opts;
    const entry: LocSignoff = { ...rest, id: newId(), status: "PENDING_FAMILY", createdAt: nowISO ?? new Date().toISOString() };
    await createRecord("app-settings", { id: LOC_SIGNOFF_KEY, key: LOC_SIGNOFF_KEY, value: JSON.stringify([entry, ...items]) });
    return entry;
  } catch { return null; }
}

/**
 * Apply a family-approved LOC change (the deferred downstream flow): write
 * resident.careLevel, post the LOC billing charge, generate the draft care plan,
 * and append to loc_history so the new level becomes the active level of record.
 */
export async function applyLocSignoff(signoff: LocSignoff, assessment: AssessmentV42 | null, byName: string, role?: string): Promise<void> {
  if (signoff.careLevelEnum) await updateRecord("residents", signoff.residentId, { careLevel: signoff.careLevelEnum });
  if (signoff.postLocCharge && signoff.numericLevel) {
    await fetch("/api/billing/loc-charge", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ residentId: signoff.residentId, level: signoff.numericLevel }),
    }).catch(() => {});
  }
  if (signoff.generatePlan && assessment) {
    await generateCarePlanFromV42({ residentId: signoff.residentId, assessment: { ...assessment, status: "VALIDATED" } as AssessmentV42, createdByName: byName || "Clinician" });
  }
  await recordLocChange({
    residentId: signoff.residentId, residentName: signoff.residentName,
    level: signoff.newLevel, source: "REASSESSMENT", assessmentId: signoff.assessmentId,
    by: byName || "Clinician", role, notes: signoff.justification,
  });
}
