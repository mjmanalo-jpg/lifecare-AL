/**
 * CRM leads — migration-free. The whole lead pipeline is stored as a JSON array
 * in an `app-setting` keyed `crm_leads` (community-scoped), read via the generic
 * app-settings query and written with upsertRecord. Promote to a real table
 * later by swapping this module's storage.
 */

export const CRM_LEADS_KEY = "crm_leads";

export const LEAD_STAGES = ["NEW", "CONTACTED", "TOUR_SCHEDULED", "TOURED", "CARE_ASSESSMENT", "APPLICATION", "MOVE_IN", "LOST"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const STAGE_META: Record<LeadStage, { label: string; color: string; badge: string }> = {
  NEW:             { label: "New Lead",        color: "#3b82f6", badge: "bg-blue-100 text-blue-700 border border-blue-200" },
  CONTACTED:       { label: "Contacted",       color: "#6366f1", badge: "bg-indigo-100 text-indigo-700 border border-indigo-200" },
  TOUR_SCHEDULED:  { label: "Tour Scheduled",  color: "#a855f7", badge: "bg-purple-100 text-purple-700 border border-purple-200" },
  TOURED:          { label: "Toured",          color: "#f59e0b", badge: "bg-amber-100 text-amber-700 border border-amber-200" },
  CARE_ASSESSMENT: { label: "Care Assessment", color: "#0ea5e9", badge: "bg-sky-100 text-sky-700 border border-sky-200" },
  APPLICATION:     { label: "Application",     color: "#14b8a6", badge: "bg-teal-100 text-teal-700 border border-teal-200" },
  MOVE_IN:         { label: "Move-In (Won)",   color: "#22c55e", badge: "bg-green-100 text-green-700 border border-green-200" },
  LOST:            { label: "Lost",            color: "#ef4444", badge: "bg-rose-100 text-rose-700 border border-rose-200" },
};

/** Open pipeline stages (exclude the terminal Won/Lost). */
export const OPEN_STAGES: LeadStage[] = ["NEW", "CONTACTED", "TOUR_SCHEDULED", "TOURED", "CARE_ASSESSMENT", "APPLICATION"];

export const LEAD_SOURCES = ["Website", "Referral", "Walk-in", "Phone", "Event", "Social Media", "Other"];

/** Why a lead was lost — captured for win/loss analytics. */
export const LOST_REASONS = ["Chose competitor", "Cost / budget", "Care needs not a fit", "No longer needed", "Went home / family care", "Unresponsive", "Other"];

export type ActivityType = "note" | "call" | "email" | "stage" | "tour" | "task" | "system";
export type TaskType = "call" | "email" | "visit" | "todo";
export const TASK_TYPES: TaskType[] = ["call", "email", "visit", "todo"];

export interface LeadActivity {
  at: string; // ISO
  by: string;
  note: string;
  type?: ActivityType;
}

export interface LeadTask {
  id: string;
  title: string;
  type: TaskType;
  dueDate: string;   // ISO date
  done: boolean;
  doneAt?: string;
  by?: string;
}

export interface Lead {
  id: string;
  name: string;
  contact?: string;
  email?: string;
  source?: string;
  prospectiveResident?: string;   // who the move-in is for (composed First Middle Last; may differ from the contact)
  residentFirstName?: string;     // structured prospective-resident name (prefills Admission + Assessment)
  residentMiddleName?: string;
  residentLastName?: string;
  stage: LeadStage;
  assignedTo?: string;
  notes?: string;
  followUpDate?: string;          // ISO date — legacy single follow-up; superseded by tasks[] but still honoured
  tourDate?: string;              // ISO datetime
  tourOutcome?: "" | "completed" | "no_show" | "rescheduled";
  tourNotes?: string;
  lostReason?: string;
  tasks?: LeadTask[];
  createdAt: string;
  convertedAdmissionId?: string;
  /** External source key for idempotent ingestion (e.g. SLMS Home care_recipient id). */
  externalId?: string;
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

// ── Tasks / follow-ups ────────────────────────────────────────────────────
export function openTasks(lead: Lead): LeadTask[] {
  return (lead.tasks ?? []).filter((t) => !t.done);
}

/** The soonest open task due date, falling back to the legacy followUpDate. */
export function nextFollowUpDate(lead: Lead): string | undefined {
  const dues = openTasks(lead).map((t) => t.dueDate).filter(Boolean).sort();
  return dues[0] ?? (lead.followUpDate || undefined);
}

export type DueBucket = "overdue" | "today" | "upcoming" | "none";
export function dueBucket(iso?: string): DueBucket {
  const d = followUpDaysLeft(iso);
  if (d == null) return "none";
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  return "upcoming";
}

/** An open task flattened with its parent lead — the cross-lead work queue. */
export interface QueueItem { lead: Lead; task: LeadTask; bucket: DueBucket }
export function followUpQueue(leads: Lead[]): QueueItem[] {
  const items: QueueItem[] = [];
  for (const lead of leads) {
    if (!OPEN_STAGES.includes(lead.stage)) continue; // no chasing won/lost leads
    for (const task of openTasks(lead)) items.push({ lead, task, bucket: dueBucket(task.dueDate) });
  }
  const order: Record<DueBucket, number> = { overdue: 0, today: 1, upcoming: 2, none: 3 };
  return items.sort((a, b) => order[a.bucket] - order[b.bucket] || (a.task.dueDate || "").localeCompare(b.task.dueDate || ""));
}

// ── Tours ─────────────────────────────────────────────────────────────────
export function upcomingTours(leads: Lead[]): Lead[] {
  return leads
    .filter((l) => l.tourDate && !l.tourOutcome && new Date(l.tourDate).getTime() >= Date.now() - 86_400_000)
    .sort((a, b) => (a.tourDate! < b.tourDate! ? -1 : 1));
}

// ── Velocity / analytics ──────────────────────────────────────────────────
export function daysBetween(aIso?: string, bIso?: string): number | null {
  if (!aIso || !bIso) return null;
  const a = new Date(aIso).getTime(), b = new Date(bIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** When a lead first entered a stage, read from its activity trail (type "stage"). */
export function stageEnteredAt(lead: Lead, label: string): string | undefined {
  return (lead.activity ?? []).find((a) => a.type === "stage" && a.note.includes(label))?.at;
}

/** Average days from creation to Move-In across won leads (null if none). */
export function avgDaysToWin(leads: Lead[]): number | null {
  const spans = leads
    .filter((l) => l.stage === "MOVE_IN")
    .map((l) => daysBetween(l.createdAt, stageEnteredAt(l, STAGE_META.MOVE_IN.label)))
    .filter((n): n is number => n != null);
  if (!spans.length) return null;
  return Math.round(spans.reduce((s, n) => s + n, 0) / spans.length);
}
