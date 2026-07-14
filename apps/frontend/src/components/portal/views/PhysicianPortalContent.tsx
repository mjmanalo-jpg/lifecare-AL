"use client";

import PhysicianCommandCenter from "@/components/portal/views/physician/PhysicianCommandCenter";
import PhysicianCaseReview from "@/components/portal/views/physician/PhysicianCaseReview";
import PhysicianOrders from "@/components/portal/views/physician/PhysicianOrders";
import PhysicianCarePlans from "@/components/portal/views/physician/PhysicianCarePlans";
import PhysicianConsults from "@/components/portal/views/physician/PhysicianConsults";
import PhysicianIncidents from "@/components/portal/views/physician/PhysicianIncidents";
import ClinicalNotes from "@/components/portal/views/clinical/ClinicalNotes";
import ClinicalMessages from "@/components/portal/views/clinical/ClinicalMessages";
import EscalationsBoard from "@/components/portal/views/clinical/EscalationsBoard";

interface PhysicianPortalContentProps {
  tab: string;
}

/**
 * Physician portal — a medical-authority / oversight perspective, deliberately
 * distinct from the nurse's hands-on operations portal. The physician diagnoses,
 * prescribes & signs, sets care-plan directives, answers consults/referrals, and
 * reviews & co-signs what the patient, family, nurse & caregiver report. Every
 * module is live via Supabase realtime + polling.
 */
export default function PhysicianPortalContent({ tab }: PhysicianPortalContentProps) {
  switch (tab) {
    case "dashboard":
      return <PhysicianCommandCenter />;
    case "casereview":
      return <PhysicianCaseReview />;
    case "orders":
      return <PhysicianOrders approveMode />;
    case "careplans":
      return <PhysicianCarePlans />;
    case "consults":
      return <PhysicianConsults />;
    case "escalations":
      return <EscalationsBoard role="PHYSICIAN" />;
    case "incidents":
      return <PhysicianIncidents />;
    case "notes":
      return <ClinicalNotes clinicianRole="PHYSICIAN" />;
    case "messages":
      return <ClinicalMessages clinicianRole="PHYSICIAN" />;
    // Legacy route segments still resolve to the closest physician module.
    case "rounds":
    case "records":
      return <PhysicianCaseReview />;
    case "vitals":
    case "monitoring":
    case "tasks":
      return <PhysicianCommandCenter />;
    default:
      return <PhysicianCommandCenter />;
  }
}
