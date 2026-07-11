"use client";

import PhysicianDashboard from "@/components/portal/views/physician/PhysicianDashboard";
import PhysicianRounds from "@/components/portal/views/physician/PhysicianRounds";
import PhysicianRecords from "@/components/portal/views/physician/PhysicianRecords";
import PhysicianOrders from "@/components/portal/views/physician/PhysicianOrders";
import PhysicianNotes from "@/components/portal/views/physician/PhysicianNotes";
import PhysicianVitals from "@/components/portal/views/physician/PhysicianVitals";
import PhysicianIncidents from "@/components/portal/views/physician/PhysicianIncidents";
import PhysicianMessages from "@/components/portal/views/physician/PhysicianMessages";

interface PhysicianPortalContentProps {
  tab: string;
}

export default function PhysicianPortalContent({ tab }: PhysicianPortalContentProps) {
  switch (tab) {
    case "dashboard":
      return <PhysicianDashboard />;
    case "rounds":
      return <PhysicianRounds />;
    case "records":
      return <PhysicianRecords />;
    case "orders":
      return <PhysicianOrders />;
    case "notes":
      return <PhysicianNotes />;
    case "vitals":
      return <PhysicianVitals />;
    case "incidents":
      return <PhysicianIncidents />;
    case "messages":
      return <PhysicianMessages />;
    case "monitoring":
      return <PhysicianVitals />;
    case "tasks":
      return <PhysicianDashboard />;
    default:
      return <PhysicianDashboard />;
  }
}
