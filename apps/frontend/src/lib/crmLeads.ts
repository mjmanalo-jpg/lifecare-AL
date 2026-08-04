/**
 * CRM leads — migration-free. The whole lead pipeline is stored as a JSON array
 * in an `app-setting` keyed `crm_leads` (community-scoped), read via the generic
 * app-settings query and written with upsertRecord. Promote to a real table
 * later by swapping this module's storage.
 */

export const CRM_LEADS_KEY = "crm_leads";

export const LEAD_STAGES = ["NEW", "CONTACTED", "TOUR_SCHEDULED", "TOURED", "APPLICATION", "MOVE_IN", "LOST"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const STAGE_META: Record<LeadStage, { label: string; color: string; badge: string }> = {
  NEW:            { label: "New Lead",       color: "#3b82f6", badge: "bg-blue-100 text-blue-700 border border-blue-200" },
  CONTACTED:      { label: "Contacted",      color: "#6366f1", badge: "bg-indigo-100 text-indigo-700 border border-indigo-200" },
  TOUR_SCHEDULED: { label: "Tour Scheduled", color: "#a855f7", badge: "bg-purple-100 text-purple-700 border border-purple-200" },
  TOURED:         { label: "Toured",         color: "#f59e0b", badge: "bg-amber-100 text-amber-700 border border-amber-200" },
  APPLICATION:    { label: "Application",    color: "#14b8a6", badge: "bg-teal-100 text-teal-700 border border-teal-200" },
  MOVE_IN:        { label: "Move-In (Won)",  color: "#22c55e", badge: "bg-green-100 text-green-700 border border-green-200" },
  LOST:           { label: "Lost",           color: "#ef4444", badge: "bg-rose-100 text-rose-700 border border-rose-200" },
};

/** Open pipeline stages (exclude the terminal Won/Lost). */
export const OPEN_STAGES: LeadStage[] = ["NEW", "CONTACTED", "TOUR_SCHEDULED", "TOURED", "APPLICATION"];

export const LEAD_SOURCES = ["Website", "Referral", "Walk-in", "Phone", "Event", "Social Media", "Other"];

export interface LeadActivity {
  at: string; // ISO
  by: string;
  note: string;
}

export interface Lead {
  id: string;
  name: string;
  contact?: string;
  email?: string;
  source?: string;
  prospectiveResident?: string;   // who the move-in is for (may differ from the contact)
  stage: LeadStage;
  assignedTo?: string;
  notes?: string;
  followUpDate?: string;          // ISO date
  tourDate?: string;              // ISO datetime
  createdAt: string;
  convertedAdmissionId?: string;
  activity: LeadActivity[];
}

export function parseLeads(raw: string | null | undefined): Lead[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .filter((l) => l && typeof l.name === "string")
      .map((l) => ({ stage: "NEW", createdAt: new Date(0).toISOString(), activity: [], ...l } as Lead));
  } catch {
    return [];
  }
}

export function newId(prefix = "lead"): string {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.floor(performance.now())}`;
}

/** Days until a follow-up date (negative = overdue), or null. */
export function followUpDaysLeft(iso?: string): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}
