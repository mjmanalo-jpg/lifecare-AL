"use client";

import CaregiverDashboard from "@/components/portal/views/caregiver/CaregiverDashboard";
import CaregiverTasks from "@/components/portal/views/caregiver/CaregiverTasks";
import CaregiverCallBells from "@/components/portal/views/caregiver/CaregiverCallBells";
import CaregiverResidents from "@/components/portal/views/caregiver/CaregiverResidents";
import CaregiverTimeClock from "@/components/portal/views/caregiver/CaregiverTimeClock";
import CaregiverReports from "@/components/portal/views/caregiver/CaregiverReports";
import CaregiverCareTeam from "@/components/portal/views/caregiver/CaregiverCareTeam";
import CaregiverMonitoring from "@/components/portal/views/caregiver/CaregiverMonitoring";
import EscalationsBoard from "@/components/portal/views/clinical/EscalationsBoard";

interface CaregiverPortalContentProps {
  tab: string;
}

/**
 * Caregiver Portal router — every module is live (Supabase realtime +
 * polling fallback via useLiveQuery) and cross-role aligned: tasks come
 * from nurse/physician assignments, orders from the physician portal,
 * and call bells from resident SOS requests.
 */
export default function CaregiverPortalContent({ tab }: CaregiverPortalContentProps) {
  switch (tab) {
    case "tasks":
      return <CaregiverTasks />;
    case "callbells":
      return <CaregiverCallBells />;
    case "residents":
      return <CaregiverResidents />;
    case "timeclock":
      return <CaregiverTimeClock />;
    case "reports":
      return <CaregiverReports />;
    case "careteam":
      return <CaregiverCareTeam />;
    case "monitoring":
      return <CaregiverMonitoring />;
    case "escalations":
      return <EscalationsBoard role="CAREGIVER" />;
    default:
      return <CaregiverDashboard />;
  }
}
