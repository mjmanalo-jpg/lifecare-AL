"use client";

import ResidentCoordinatorDashboard from "@/components/portal/dashboards/resident-coordinator/ResidentCoordinatorDashboard";
import RoleCommandDashboard from "@/components/portal/dashboards/shared/RoleCommandDashboard";

const COORDINATOR_PAGES = {
  residents: {
    title: "Resident Snapshot",
    subtitle: "Assigned-community residents, rooms, status summaries, and coordination preferences.",
    sections: ["residents"],
  },
  schedule: {
    title: "Appointments & Activities",
    subtitle: "Resident appointments, transport, activities, and other non-clinical schedule commitments.",
    sections: ["today", "upcoming"],
  },
  coordination: {
    title: "Open Coordination",
    subtitle: "Admissions, returns, transport, resident requests, follow-ups, and items awaiting another owner.",
    sections: ["urgent", "today", "admissions", "awaiting"],
  },
  familycontacts: {
    title: "Contacts & Update Preferences",
    subtitle: "Authorized representatives and recorded preferences for routine non-clinical updates.",
    sections: ["family-contacts"],
  },
  endorsement: {
    title: "Coordination Endorsement",
    subtitle: "Unresolved coordination items to carry forward with a clear owner and next action.",
    sections: ["endorsement"],
  },
} as const;

export default function ResidentCoordinatorPortalContent({ tab }: { tab: string }) {
  if (tab === "dashboard") return <ResidentCoordinatorDashboard />;
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
