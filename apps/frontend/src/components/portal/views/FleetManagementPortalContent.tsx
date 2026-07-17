"use client";

import FleetDashboard from "@/components/portal/views/fleet/FleetDashboard";
import FleetVehicles from "@/components/portal/views/fleet/FleetVehicles";
import FleetDrivers from "@/components/portal/views/fleet/FleetDrivers";
import FleetHub from "@/components/portal/views/fleet/FleetHub";
import FacilityResidents from "@/components/portal/views/FacilityResidents";
import AssessmentAcuityBoard from "@/components/portal/views/clinical/AssessmentAcuityBoard";
import PhysicianCarePlans from "@/components/portal/views/physician/PhysicianCarePlans";
import CaregiverTasks from "@/components/portal/views/caregiver/CaregiverTasks";
import FacilityUnifiedView from "@/components/portal/views/FacilityUnifiedView";
import FacilityInventory from "@/components/portal/views/FacilityInventory";
import EscalationsBoard from "@/components/portal/views/clinical/EscalationsBoard";

interface FleetManagementPortalContentProps {
  tab: string;
}

/**
 * Fleet & Transport portal router (Phase 6) — every module is live
 * (Supabase realtime + polling fallback via useLiveQuery):
 * dispatcher request review → vehicle/driver/escort assignment →
 * pre-trip inspection → live GPS trip → drop-off → billable charge,
 * plus the maintenance & compliance loop.
 *
 * maintenance / fuel / requests / trips are now unified into FleetHub.
 */
export default function FleetManagementPortalContent({
  tab,
}: FleetManagementPortalContentProps) {
  switch (tab) {
    case "maintenance":
      return <FleetHub initialTab="maintenance" />;
    case "fuel":
      return <FleetHub initialTab="fuel" />;
    case "requests":
      return <FleetHub initialTab="requests" />;
    case "trips":
      return <FleetHub initialTab="trips" />;
    case "vehicles":
      return <FleetVehicles />;
    case "drivers":
      return <FleetDrivers />;
    // Core LCMS Modules Aligned
    case "records":
      return <FacilityResidents />;
    case "rounds":
      return <AssessmentAcuityBoard clinicianRole="FACILITY_ADMIN" />;
    case "careplans":
      return <PhysicianCarePlans />;
    case "tasks":
      return <CaregiverTasks />;
    case "reports":
      return <FacilityUnifiedView initialTab="reports" />;
    case "medications":
      return <FacilityInventory />;
    case "escalations":
      return <EscalationsBoard role="FACILITY_ADMIN" />;
    default:
      return <FleetDashboard />;
  }
}
