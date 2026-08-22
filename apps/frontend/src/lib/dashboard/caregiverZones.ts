export const CAREGIVER_DASHBOARD_TITLE = "Caregiver Dashboard - Facility My Shift";

export const CAREGIVER_DASHBOARD_SUBTITLE =
  "Assigned residents, approved care, documentation, help requests, assignment updates, and shift close in one governed shift view.";

export const CAREGIVER_DASHBOARD_AREAS = [
  {
    key: "my-residents",
    title: "My Residents",
    description: "Photo, name, room, active precautions, current approved assistance, and meaningful current care notes.",
    emptyTitle: "No residents assigned to this shift",
    emptyHint: "Assigned residents appear here when the current roster gives you coverage responsibility.",
  },
  {
    key: "my-care-now",
    title: "My Care Now",
    description: "Overdue and immediate care, sorted by due window and care need.",
    emptyTitle: "No care needs attention now",
    emptyHint: "Urgent or overdue assigned care will appear here first.",
  },
  {
    key: "my-care-next",
    title: "My Care Next",
    description: "Approved care due soon, ordered chronologically by due window and care need.",
    emptyTitle: "No care due soon",
    emptyHint: "Upcoming assigned care moves here before it becomes due now.",
  },
  {
    key: "my-care-later",
    title: "My Care Later",
    description: "Remaining approved care for this shift after the immediate and next windows.",
    emptyTitle: "No later care scheduled",
    emptyHint: "Lower-priority or later-window care appears here after higher-need work.",
  },
  {
    key: "document-care",
    title: "Document Care",
    description: "Record Completed or Not Required with actual assistance and observation; otherwise use a standardized exception reason.",
    emptyTitle: "No care documentation pending",
    emptyHint: "Open assigned tasks that need completion or exception documentation appear here.",
  },
  {
    key: "need-nurse-help",
    title: "Need Nurse / Help",
    description: "One-tap escalation from resident or task context for clinical change, unsafe care, second assist, refusal, behavior, medication concern, or other help.",
    emptyTitle: "No open help requests",
    emptyHint: "Use the Need Nurse / Help button when a resident or task needs nurse support.",
  },
  {
    key: "assignment-update",
    title: "Assignment Update",
    description: "Acknowledge nurse reassignment or helper-support changes in-app.",
    emptyTitle: "No assignment update pending",
    emptyHint: "New or changed resident assignments appear here for acknowledgement.",
  },
  {
    key: "shift-close",
    title: "Shift Close",
    description: "Incomplete and exception items must be completed or given a reason before shift close is submitted to the nurse.",
    emptyTitle: "No shift-close blockers",
    emptyHint: "Incomplete care, exceptions, and carry-forward items appear here before handover.",
  },
] as const;

export type CaregiverDashboardAreaKey = (typeof CAREGIVER_DASHBOARD_AREAS)[number]["key"];

export function caregiverDashboardArea(key: CaregiverDashboardAreaKey) {
  const area = CAREGIVER_DASHBOARD_AREAS.find((item) => item.key === key);
  if (!area) throw new Error(`Unknown Caregiver dashboard area: ${key}`);
  return area;
}
