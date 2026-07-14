"use client";

import DriverHub from "@/components/portal/views/driver/DriverHub";

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
    default:
      return <DriverHub initialTab="dashboard" />;
  }
}
