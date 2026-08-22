export const NURSE_DASHBOARD_TITLE = "Nurse Dashboard - Shift Command";

export const NURSE_DASHBOARD_SUBTITLE =
  "Within seconds: who needs clinical attention, who is caring for whom, whether approved care is being delivered safely and on time, and what must carry forward.";

export const NURSE_DASHBOARD_ZONES = [
  {
    key: "clinical-triage",
    title: "Clinical Triage Queue",
    description: "P1 act now, P2 review this shift, P3 due this shift, and P4 verification, coordination, or follow-up.",
    emptyTitle: "No open clinical triage items",
    emptyHint: "Clinical events and due work will appear here in governed priority order.",
  },
  {
    key: "caregiver-deployment",
    title: "Caregiver Deployment",
    description: "Present or off-unit status, resident assignments, high-risk caseloads, unowned work, exceptions, and Need Nurse / Help requests.",
    emptyTitle: "Caregiver deployment is within plan",
    emptyHint: "Coverage, assignment, safety-gate, and help-request exceptions will appear here.",
  },
  {
    key: "shift-watchlist",
    title: "Shift Watchlist",
    description: "Change of condition, post-hospital or new admission, falls, mobility, nutrition, swallowing, behavior, and other residents requiring active monitoring.",
    emptyTitle: "No residents require elevated shift monitoring",
    emptyHint: "Watch and Escalated residents will appear here with the source of concern.",
  },
  {
    key: "care-delivery-status",
    title: "Care Delivery Status",
    description: "On track, due soon, overdue, refused, unable, unsafe, increased assistance, frequency variance, and clinical change.",
    emptyTitle: "Approved care is on track",
    emptyHint: "Due care and observed delivery exceptions will appear here.",
  },
  {
    key: "next-two-hours",
    title: "Next 2 Hours",
    description: "Chronological nursing monitoring, reviews, medication or clinical requirements, and planned reassessments.",
    emptyTitle: "Nothing requires preparation in the next two hours",
    emptyHint: "Upcoming governed care will appear here in chronological order.",
  },
  {
    key: "new-since-shift",
    title: "New Since My Shift Started",
    description: "One-click filtering for new changes, exceptions, assistance requests, and assignment changes.",
    emptyTitle: "No new shift events",
    emptyHint: "New events will remain visible here for the active shift.",
  },
  {
    key: "shift-endorsement",
    title: "Shift Endorsement",
    description: "Unresolved clinical issues, caregiver or coverage issues, completed and pending actions, next-shift watch items, owner, and due time.",
    emptyTitle: "No unresolved items to endorse",
    emptyHint: "Carry-forward work will appear here with its accountable owner and due time.",
  },
] as const;

export type NurseDashboardZoneKey = (typeof NURSE_DASHBOARD_ZONES)[number]["key"];

export const NURSE_COMMAND_SHORTCUTS = [
  { key: "act-now", label: "Act now", sectionKey: "clinical-triage", priority: "P1" },
  { key: "nurse-review", label: "Nurse review", sectionKey: "clinical-triage", priority: "P2" },
  { key: "due-this-shift", label: "Due this shift", sectionKey: "clinical-triage", priority: "P3" },
  { key: "overdue", label: "Overdue", sectionKey: "care-delivery-status", priority: undefined },
  { key: "coverage-issue", label: "Caregiver / coverage issue", sectionKey: "caregiver-deployment", priority: undefined },
  { key: "handover", label: "Handover", sectionKey: "shift-endorsement", priority: undefined },
] as const;

export function nurseDashboardZone(key: NurseDashboardZoneKey) {
  const zone = NURSE_DASHBOARD_ZONES.find((item) => item.key === key);
  if (!zone) throw new Error(`Unknown Nurse dashboard zone: ${key}`);
  return zone;
}
