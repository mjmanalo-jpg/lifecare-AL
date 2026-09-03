"use client";

import LeadPipelineBoard from "@/components/portal/views/LeadPipelineBoard";

interface CRMPortalContentProps {
  tab: string;
}

// Dedicated CRM team portal — the tabbed CRM workspace (pipeline, follow-ups,
// tours, analytics). Each sidebar route deep-links straight to its tab; all
// other roles reach the same workspace via their single `crm` tab.
export default function CRMPortalContent({ tab }: CRMPortalContentProps) {
  if (tab === "followups") return <LeadPipelineBoard initialView="followups" />;
  if (tab === "tours" || tab === "appointmentcalendar") return <LeadPipelineBoard initialView="tours" />;
  if (tab === "analytics") return <LeadPipelineBoard initialView="analytics" />;
  // dashboard / crm / leads → pipeline
  return <LeadPipelineBoard initialView="pipeline" />;
}
