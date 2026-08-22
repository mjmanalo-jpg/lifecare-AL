export const COORDINATOR_DASHBOARD_TITLE = "Resident Coordinator / Navigator";

export const COORDINATOR_DASHBOARD_SUBTITLE =
  "A non-clinical coordination view: see what is needed to coordinate the resident experience. Clinical decision fields beyond authorized need-to-know summaries remain with the nurse and care-management roles.";

export const COORDINATOR_DASHBOARD_ZONES = [
  {
    key: "resident-snapshot",
    title: "Resident Snapshot",
    description: "Assigned residents, room and location, current status summary, coordination-relevant preferences, and authorized representative or contact.",
    emptyTitle: "No active resident coordination profiles",
    emptyHint: "Active residents in your assigned community appear here with coordination summaries only.",
  },
  {
    key: "today-schedule",
    title: "Today / Schedule",
    description: "Appointments, activities and engagement schedule, planned family calls or visits, and non-clinical service appointments.",
    emptyTitle: "Nothing scheduled to coordinate",
    emptyHint: "Appointments, transport, activities, and non-clinical service bookings appear here.",
  },
  {
    key: "admissions-returns",
    title: "Admissions / Returns",
    description: "Upcoming or new admissions, hospital returns, and onboarding or transition coordination items.",
    emptyTitle: "No admissions or returns in progress",
    emptyHint: "Move-in and return coordination in progress appears here.",
  },
  {
    key: "open-coordination",
    title: "Open Coordination",
    description: "Transport, external appointment or provider coordination, family or representative follow-up, and documents or consents routed for completion.",
    emptyTitle: "No open coordination items",
    emptyHint: "Transport, requests, follow-ups, and items awaiting another owner appear here.",
  },
  {
    key: "family-preferences",
    title: "Family Update Preferences",
    description: "Routine updates versus significant changes or shared decisions as captured in the resident profile; actual clinical disclosure remains permission-controlled.",
    emptyTitle: "No resident contact profiles",
    emptyHint: "Authorized representatives and recorded non-clinical communication preferences appear here.",
  },
  {
    key: "alerts-for-action",
    title: "Alerts for Action",
    description: "Only coordination-relevant alerts routed by the nurse, care manager, or administrator. No raw clinical triage queue.",
    emptyTitle: "No alerts routed for coordination",
    emptyHint: "Non-clinical alerts explicitly routed to coordination appear here.",
  },
  {
    key: "endorsement-notes",
    title: "Endorsement / Notes",
    description: "Carry forward non-clinical coordination items to the next responsible coordinator or manager.",
    emptyTitle: "No coordination items to carry forward",
    emptyHint: "Unresolved non-clinical items that need an owner or carry-forward note appear here.",
  },
] as const;

export type CoordinatorDashboardZoneKey = (typeof COORDINATOR_DASHBOARD_ZONES)[number]["key"];

export function coordinatorZone(key: CoordinatorDashboardZoneKey) {
  const zone = COORDINATOR_DASHBOARD_ZONES.find((item) => item.key === key);
  if (!zone) throw new Error(`Unknown Resident Coordinator dashboard zone: ${key}`);
  return zone;
}
