"use client";

import FamilyDashboard from "@/components/portal/views/family/FamilyDashboard";
import FamilyRelative from "@/components/portal/views/family/FamilyRelative";
import FamilyDailyReport from "@/components/portal/views/family/FamilyDailyReport";
import FamilyTimeline from "@/components/portal/views/family/FamilyTimeline";
import FamilyCareTeam from "@/components/portal/views/family/FamilyCareTeam";
import FamilyCareGoals from "@/components/portal/views/family/FamilyCareGoals";
import FamilyAlerts from "@/components/portal/views/family/FamilyAlerts";
import FamilyMessages from "@/components/portal/views/family/FamilyMessages";
import FamilyAppointments from "@/components/portal/views/family/FamilyAppointments";
import FamilyBilling from "@/components/portal/views/family/FamilyBilling";
import FamilyPhotos from "@/components/portal/views/family/FamilyPhotos";
import MyTransport from "@/components/portal/views/fleet/MyTransport";

interface FamilyPortalContentProps {
  tab: string;
}

/**
 * Family Portal router — every module is live (Supabase realtime + polling
 * fallback via useLiveQuery) and scoped to the family's linked resident.
 */
export default function FamilyPortalContent({ tab }: FamilyPortalContentProps) {
  switch (tab) {
    case "relative":
      return <FamilyRelative />;
    case "report":
      return <FamilyDailyReport />;
    case "timeline":
      return <FamilyTimeline />;
    case "careteam":
      return <FamilyCareTeam />;
    case "goals":
      return <FamilyCareGoals />;
    case "alerts":
      return <FamilyAlerts />;
    case "messages":
      return <FamilyMessages />;
    case "appointments":
      return <FamilyAppointments />;
    case "expenses":
    case "billing":
      return <FamilyBilling />;
    case "photos":
      return <FamilyPhotos />;
    case "transport":
      return <MyTransport />;
    default:
      return <FamilyDashboard />;
  }
}
