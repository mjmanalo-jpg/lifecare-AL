export const ADMIN_DASHBOARD_TITLE = "Administrator Dashboard";

export const ADMIN_DASHBOARD_SUBTITLE =
  "Is the community safe, adequately staffed, compliant with the care model, operationally stable, and carrying unresolved risk? Aggregate-first, with authorized drill-down to the resident, assessment, care plan, event, and staffing decision behind each signal.";

export const ADMIN_DASHBOARD_ZONES = [
  {
    key: "community-snapshot",
    title: "A. Community Snapshot",
    description: "Census, occupancy against capacity, admissions, returns and discharges, LOC mix, and residents on Watch or Escalated.",
    emptyTitle: "No residents require elevated oversight",
    emptyHint: "Watch and Escalated residents and in-progress admissions will appear here with their source record.",
  },
  {
    key: "staffing-coverage",
    title: "B. Staffing & Coverage",
    description: "Caregivers and nurses present versus planned, caregiver-to-resident coverage, unassigned residents and tasks, coverage gaps, and DT-013 dedicated-support utilization.",
    emptyTitle: "Staffing and coverage are within plan",
    emptyHint: "Coverage gaps, unowned work, and shared-staffing capability exceptions will appear here.",
  },
  {
    key: "care-delivery-reliability",
    title: "C. Care Delivery Reliability",
    description: "Completion, overdue care, exception volume, repeated variance, and shifts with material care-delivery gaps.",
    emptyTitle: "No care-delivery reliability exceptions",
    emptyHint: "Overdue care and governed delivery variance will appear here.",
  },
  {
    key: "clinical-quality-safety",
    title: "D. Clinical Quality & Safety",
    description: "Falls and unsafe events, medication-safety events, hospital or ED transfers, significant clinical escalations, and active change-of-condition and post-hospital monitoring.",
    emptyTitle: "No open clinical quality or safety events",
    emptyHint: "Incidents, urgent escalations, and transition monitoring will appear here.",
  },
  {
    key: "care-governance-compliance",
    title: "E. Care Governance / Compliance",
    description: "Assessment current, reassessment on-time, care-plan current, approvals overdue, LOC / MLR / override records requiring authorized sign-off, and audit exceptions.",
    emptyTitle: "Care governance is current",
    emptyHint: "Incomplete gates, pending authorization, due reassessments, and audit exceptions will appear here.",
  },
  {
    key: "service-utilization",
    title: "F. Service Utilization",
    description: "LOC mix, DT-013 / PCG utilization and reviews, and DT-014 active additional services with review or stop status.",
    emptyTitle: "No service-utilization reviews open",
    emptyHint: "DT-013 dedicated support and DT-014 additional-service reviews will appear here.",
  },
  {
    key: "management-action-queue",
    title: "G. Management Action Queue",
    description: "Open high-risk issues, aged escalations, overdue reviews, staffing capability problems, and unresolved handover or incident follow-up.",
    emptyTitle: "No management actions outstanding",
    emptyHint: "Aged and high-risk unresolved items across the community will surface here.",
  },
] as const;

export type AdminDashboardZoneKey = (typeof ADMIN_DASHBOARD_ZONES)[number]["key"];

export function adminZone(key: AdminDashboardZoneKey) {
  const zone = ADMIN_DASHBOARD_ZONES.find((item) => item.key === key);
  if (!zone) throw new Error(`Unknown Administrator dashboard zone: ${key}`);
  return zone;
}
