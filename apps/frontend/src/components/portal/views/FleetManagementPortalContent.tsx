"use client";

import FleetDashboard from "@/components/portal/views/fleet/FleetDashboard";
import FleetRequests from "@/components/portal/views/fleet/FleetRequests";
import FleetTrips from "@/components/portal/views/fleet/FleetTrips";
import FleetVehicles from "@/components/portal/views/fleet/FleetVehicles";
import FleetDrivers from "@/components/portal/views/fleet/FleetDrivers";
import FleetMaintenance from "@/components/portal/views/fleet/FleetMaintenance";
import FleetFuel from "@/components/portal/views/fleet/FleetFuel";

interface FleetManagementPortalContentProps {
  tab: string;
}

/**
 * Fleet & Transport portal router (Phase 6) — every module is live
 * (Supabase realtime + polling fallback via useLiveQuery):
 * dispatcher request review → vehicle/driver/escort assignment →
 * pre-trip inspection → live GPS trip → drop-off → billable charge,
 * plus the maintenance & compliance loop.
 */
export default function FleetManagementPortalContent({
  tab,
}: FleetManagementPortalContentProps) {
  switch (tab) {
    case "requests":
      return <FleetRequests />;
    case "trips":
      return <FleetTrips />;
    case "vehicles":
      return <FleetVehicles />;
    case "drivers":
      return <FleetDrivers />;
    case "maintenance":
      return <FleetMaintenance />;
    case "fuel":
      return <FleetFuel />;
    default:
      return <FleetDashboard />;
  }
}
