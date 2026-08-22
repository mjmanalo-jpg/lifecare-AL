import RoleCommandDashboard from "../shared/RoleCommandDashboard";
import { CAREGIVER_DASHBOARD_SUBTITLE, CAREGIVER_DASHBOARD_TITLE } from "@/lib/dashboard/caregiverZones";

export default function CaregiverMyShift() {
  return (
    <RoleCommandDashboard
      role="caregiver"
      pageTitle={CAREGIVER_DASHBOARD_TITLE}
      pageSubtitle={CAREGIVER_DASHBOARD_SUBTITLE}
    />
  );
}
