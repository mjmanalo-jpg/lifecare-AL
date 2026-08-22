export const CARE_MANAGER_DASHBOARD_TITLE = "Care Manager / Clinical Lead Dashboard";

export const CARE_MANAGER_DASHBOARD_SUBTITLE =
  "Clinical governance across residents and shifts, with accountable drill-downs to the resident, assessment, care plan, task, event, nurse review, and staffing decision behind each signal.";

export const CARE_MANAGER_DASHBOARD_ZONES = [
  {
    key: "clinical-risk",
    title: "A. Clinical Risk Overview",
    description: "Residents on Watch or Escalated, active change of condition, post-hospital monitoring, and repeated or material variance.",
    emptyTitle: "No residents require elevated clinical oversight",
    emptyHint: "Watch and Escalated signals will appear here with their source record.",
  },
  {
    key: "assessment-loc",
    title: "B. Assessment & LOC Governance",
    description: "New or pending assessments, Final LOC review, modifier and MLR verification, reassessment due dates, and change history.",
    emptyTitle: "Assessment and LOC governance is current",
    emptyHint: "Incomplete gates, pending authorization, and due reassessments will appear here.",
  },
  {
    key: "care-plan-governance",
    title: "C. Care Plan Governance",
    description: "Drafts awaiting approval, current or expired plans, reviews due, new routine versions, and delivery variance against plan.",
    emptyTitle: "Care plans are current",
    emptyHint: "Draft, review-due, expired, and variance-linked plans will appear here.",
  },
  {
    key: "care-delivery-reliability",
    title: "D. Care Delivery Reliability",
    description: "Overdue expected care, exception patterns, repeated assistance or frequency variance, and observed-versus-planned burden.",
    emptyTitle: "No delivery reliability exceptions",
    emptyHint: "Overdue care and governed variance signals will appear here.",
  },
  {
    key: "safety-transitions",
    title: "E. Safety / Transitions",
    description: "Falls and unsafe events, medication safety incidents, hospital or ED transitions, post-hospital monitoring, and significant clinical concerns.",
    emptyTitle: "No open safety or transition concerns",
    emptyHint: "Open incidents, urgent escalations, and post-hospital monitoring will appear here.",
  },
  {
    key: "staffing-team-quality",
    title: "F. Staffing / Team Quality",
    description: "Coverage gaps, shared caseload capability concerns, unowned work, and assignment patterns requiring coaching or review.",
    emptyTitle: "Staffing and assignment coverage is within plan",
    emptyHint: "Coverage gaps, high shared caseloads, and unowned work will appear here.",
  },
  {
    key: "open-decisions",
    title: "G. Open Decisions",
    description: "Nursing reviews, DT-013 or PCG and DT-014 decisions, unresolved clinical communication, handover items, and aging work.",
    emptyTitle: "No open governance decisions",
    emptyHint: "Unresolved decisions and accountable carry-forward work will appear here.",
  },
] as const;

export type CareManagerDashboardZoneKey = (typeof CARE_MANAGER_DASHBOARD_ZONES)[number]["key"];

export function careManagerZone(key: CareManagerDashboardZoneKey) {
  const zone = CARE_MANAGER_DASHBOARD_ZONES.find((item) => item.key === key);
  if (!zone) throw new Error(`Unknown Care Manager dashboard zone: ${key}`);
  return zone;
}
