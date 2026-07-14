"use client";

import FleetDashboard from "@/components/portal/views/fleet/FleetDashboard";
import FleetVehicles from "@/components/portal/views/fleet/FleetVehicles";
import FleetDrivers from "@/components/portal/views/fleet/FleetDrivers";
import FleetHub from "@/components/portal/views/fleet/FleetHub";

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
    default:
      return <FleetDashboard />;
  }
}
