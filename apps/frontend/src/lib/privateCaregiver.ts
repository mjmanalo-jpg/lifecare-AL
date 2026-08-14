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

export interface PrivateCareAssignment {
  id: string;
  residentId: string;
  residentName: string;
  room?: string;
  sponsorId?: string;      // family payer (Resident.sponsorId), when on file
  sponsorName?: string;
  caregiverId: string;     // Staff.id of the assigned caregiver
  caregiverName: string;
  schedule: string;        // free text, e.g. "Day shift · 8h/day"
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
}

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
