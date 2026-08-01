"use client";

import DriverHub from "@/components/portal/views/driver/DriverHub";
import CaregiverResidents from "@/components/portal/views/caregiver/CaregiverResidents";
import AssessmentAcuityBoard from "@/components/portal/views/clinical/AssessmentAcuityBoard";
import PhysicianCarePlans from "@/components/portal/views/physician/PhysicianCarePlans";
import CaregiverTasks from "@/components/portal/views/caregiver/CaregiverTasks";
import CaregiverReports from "@/components/portal/views/caregiver/CaregiverReports";
import NurseMedications from "@/components/portal/views/NurseMedications";
import EscalationsBoard from "@/components/portal/views/clinical/EscalationsBoard";

interface DriverPortalContentProps {
  tab: string;
}

/**
 * Driver portal router — delegates every tab to the unified DriverHub.
 * Dashboard / trips / checklist / fuel are all rendered inside DriverHub
 * with its own pill-tab bar, search, pagination, and realtime data.
 */
export default function DriverPortalContent({
  tab,
}: DriverPortalContentProps) {
  switch (tab) {
    case "trips":
      return <DriverHub initialTab="trips" />;
    case "checklist":
      return <DriverHub initialTab="checklist" />;
    case "fuel":
      return <DriverHub initialTab="fuel" />;
    // Core SLMS Modules Aligned
    case "records":
      return <CaregiverResidents />;
    case "rounds":
      return <AssessmentAcuityBoard clinicianRole="CAREGIVER" />;
    case "careplans":
      return <PhysicianCarePlans />;
    case "tasks":
      return <CaregiverTasks />;
    case "reports":
      return <CaregiverReports />;
    case "medications":
      return <NurseMedications />;
    case "escalations":
      return <EscalationsBoard role="CAREGIVER" />;
    default:
      return <DriverHub initialTab="dashboard" />;
  }
}
