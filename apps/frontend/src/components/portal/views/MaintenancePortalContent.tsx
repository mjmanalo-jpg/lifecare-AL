"use client";

import ServiceRequestsBoard from "@/components/portal/views/services/ServiceRequestsBoard";
import FacilityMaintenanceBoard from "@/components/portal/views/services/FacilityMaintenanceBoard";

/**
 * Maintenance portal — the repairs/engineering crew's home.
 *   - default: resident repair & HVAC ticket queue (REPAIRS / AIRCON_HVAC).
 *     This is also the apartment-level work-order view the PMS spec was missing.
 *   - maintenance: preventative facility-system schedules (HVAC, generator, …).
 */
export default function MaintenancePortalContent({ tab }: { tab?: string }) {
  if (tab === "maintenance") return <FacilityMaintenanceBoard />;
  return <ServiceRequestsBoard categories={["REPAIRS", "AIRCON_HVAC"]} />;
}
