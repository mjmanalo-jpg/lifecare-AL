import RoleCommandDashboard from "../shared/RoleCommandDashboard";
import { NURSE_DASHBOARD_SUBTITLE, NURSE_DASHBOARD_TITLE } from "@/lib/dashboard/nurseZones";

export default function NurseShiftCommand() {
  return (
    <RoleCommandDashboard
      role="nurse"
      pageTitle={NURSE_DASHBOARD_TITLE}
      pageSubtitle={NURSE_DASHBOARD_SUBTITLE}
    />
  );
}
