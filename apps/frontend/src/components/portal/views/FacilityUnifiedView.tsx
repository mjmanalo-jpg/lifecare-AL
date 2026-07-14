"use client";

import { useState } from "react";
import {
  BarChart3, CreditCard, UtensilsCrossed, Wrench, Settings, Bell,
  Users, Repeat, Heart, LayoutGrid,
} from "lucide-react";
import FacilityReports from "./FacilityReports";
import FacilityBilling from "./FacilityBilling";
import FacilityDining from "./FacilityDining";
import ServiceRequestsBoard from "./services/ServiceRequestsBoard";
import FacilityMaintenanceBoard from "./services/FacilityMaintenanceBoard";
import ConciergeBoard from "./services/ConciergeBoard";
import FrontDeskBoard from "./pms/FrontDeskBoard";
import UnitTurnoverBoard from "./pms/UnitTurnoverBoard";
import CommunityBoard from "./pms/CommunityBoard";

const TABS = [
  { key: "reports", label: "Reports", icon: BarChart3 },
  { key: "billing", label: "Billing", icon: CreditCard },
  { key: "dining", label: "Dining", icon: UtensilsCrossed },
  { key: "services", label: "Services", icon: Wrench },
  { key: "maintenance", label: "Maintenance", icon: Settings },
  { key: "concierge", label: "Concierge", icon: Bell },
  { key: "frontdesk", label: "Front Desk", icon: Users },
  { key: "turnover", label: "Turnover", icon: Repeat },
  { key: "community", label: "Community", icon: Heart },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const TAB_COMPONENTS: Record<TabKey, React.ComponentType> = {
  reports: FacilityReports,
  billing: FacilityBilling,
  dining: FacilityDining,
  services: ServiceRequestsBoard,
  maintenance: FacilityMaintenanceBoard,
  concierge: ConciergeBoard,
  frontdesk: FrontDeskBoard,
  turnover: UnitTurnoverBoard,
  community: CommunityBoard,
};

interface Props {
  initialTab?: string;
}

export default function FacilityUnifiedView({ initialTab }: Props) {
  const [activeTab] = useState<TabKey>((initialTab as TabKey) ?? "reports");
  const ActiveComponent = TAB_COMPONENTS[activeTab] ?? FacilityReports;

  return (
    <div className="space-y-5">
      {/* Standalone content — no tab bar */}
      <ActiveComponent />
    </div>
  );
}
