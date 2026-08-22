import RoleCommandDashboard from "../shared/RoleCommandDashboard";
import {
  CARE_MANAGER_DASHBOARD_SUBTITLE,
  CARE_MANAGER_DASHBOARD_TITLE,
} from "@/lib/dashboard/careManagerZones";

export default function CareManagerGovernance() {
  return (
    <RoleCommandDashboard
      role="care-manager"
      pageTitle={CARE_MANAGER_DASHBOARD_TITLE}
      pageSubtitle={CARE_MANAGER_DASHBOARD_SUBTITLE}
      showShiftSummary={false}
    />
  );
}
