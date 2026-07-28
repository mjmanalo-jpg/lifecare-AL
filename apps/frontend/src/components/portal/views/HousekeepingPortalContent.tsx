"use client";

import ServiceRequestsBoard from "@/components/portal/views/services/ServiceRequestsBoard";
import UnitTurnoverBoard from "@/components/portal/views/pms/UnitTurnoverBoard";

/**
 * Housekeeping portal — the cleaning/linen crew's home. Resident requests are
 * already categorized (HOUSEKEEPING / LAUNDRY) and team-routed, so this portal
 * just scopes the shared boards to housekeeping work.
 *   - default: housekeeping & laundry request queue
 *   - turnover: room make-ready → occupied lifecycle
 */
export default function HousekeepingPortalContent({ tab }: { tab?: string }) {
  if (tab === "turnover") return <UnitTurnoverBoard />;
  return <ServiceRequestsBoard categories={["HOUSEKEEPING", "LAUNDRY"]} />;
}
