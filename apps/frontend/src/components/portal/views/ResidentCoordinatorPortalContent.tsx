"use client";

import ResidentCoordinatorDashboard from "@/components/portal/dashboards/resident-coordinator/ResidentCoordinatorDashboard";
import RoleCommandDashboard from "@/components/portal/dashboards/shared/RoleCommandDashboard";
import MoveInBoard from "@/components/portal/views/clinical/MoveInBoard";

const COORDINATOR_PAGES = {
  residents: {
    title: "Resident Snapshot",
    subtitle: "Assigned residents, room/location, status summaries, coordination preferences, and authorized contact.",
    sections: ["resident-snapshot"],
  },
  schedule: {
    title: "Today & Schedule",
    subtitle: "Appointments, activities/engagement, planned family visits, and non-clinical service appointments.",
    sections: ["today-schedule"],
  },
  admissions: {
    title: "Admissions & Returns",
    subtitle: "Upcoming/new admissions, hospital returns, and onboarding or transition coordination items.",
    sections: ["admissions-returns"],
  },
  coordination: {
    title: "Open Coordination",
    subtitle: "Transport, external appointment/provider coordination, family follow-up, and documents routed for completion.",
    sections: ["open-coordination"],
  },
  alerts: {
    title: "Alerts for Action",
    subtitle: "Coordination-relevant alerts routed by the nurse, care manager, or administrator. No raw clinical triage.",
    sections: ["alerts-for-action"],
  },
  familycontacts: {
    title: "Family Update Preferences",
    subtitle: "Authorized representatives and recorded preferences for routine non-clinical updates.",
    sections: ["family-preferences"],
  },
  endorsement: {
    title: "Endorsement / Notes",
    subtitle: "Unresolved non-clinical coordination items to carry forward with a clear owner and next action.",
    sections: ["endorsement-notes"],
  },
} as const;

export default function ResidentCoordinatorPortalContent({ tab }: { tab: string }) {
  if (tab === "dashboard") return <ResidentCoordinatorDashboard />;
  if (tab === "movein") return <MoveInBoard />;
  const page = COORDINATOR_PAGES[tab as keyof typeof COORDINATOR_PAGES];
  if (!page) return <ResidentCoordinatorDashboard />;
  return (
    <RoleCommandDashboard
      role="resident-coordinator"
      sectionKeys={page.sections}
      pageTitle={page.title}
      pageSubtitle={page.subtitle}
      showMetrics={false}
      showShiftSummary={false}
    />
  );
}
