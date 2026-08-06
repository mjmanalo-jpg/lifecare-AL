"use client";
import { useState } from "react";
import PhysicianCommandCenter from "@/components/portal/views/physician/PhysicianCommandCenter";
import PhysicianCaseReview from "@/components/portal/views/physician/PhysicianCaseReview";
import PhysicianOrders from "@/components/portal/views/physician/PhysicianOrders";
import PhysicianCarePlans from "@/components/portal/views/physician/PhysicianCarePlans";
import PhysicianConsults from "@/components/portal/views/physician/PhysicianConsults";
import PhysicianIncidents from "@/components/portal/views/physician/PhysicianIncidents";
import ClinicalNotes from "@/components/portal/views/clinical/ClinicalNotes";
import ClinicalMessages from "@/components/portal/views/clinical/ClinicalMessages";
import EscalationsBoard from "@/components/portal/views/clinical/EscalationsBoard";
import PhysicianCommsLog from "@/components/portal/views/clinical/PhysicianCommsLog";
import ReferralsBoard from "@/components/portal/views/clinical/ReferralsBoard";
import CaregiverReports from "@/components/portal/views/caregiver/CaregiverReports";
import AssessmentAcuityBoard from "@/components/portal/views/clinical/AssessmentAcuityBoard";
import NurseRecords from "@/components/portal/views/NurseRecords";
import CaregiverTasks from "@/components/portal/views/caregiver/CaregiverTasks";
import DailyDocumentation from "@/components/portal/views/clinical/DailyDocumentation";
import CarePlanBoard from "@/components/portal/views/clinical/CarePlanBoard";
import LabsAllergiesBoard from "@/components/portal/views/clinical/LabsAllergiesBoard";
import VaccinationTracker from "@/components/portal/views/clinical/VaccinationTracker";
import ResidentDocuments from "@/components/portal/views/clinical/ResidentDocuments";
import MARBoard from "@/components/portal/views/clinical/MARBoard";
import FollowUpTracker from "@/components/portal/views/clinical/FollowUpTracker";
import ClinicalReports from "@/components/portal/views/clinical/ClinicalReports";
import AuditLogViewer from "@/components/portal/views/clinical/AuditLogViewer";
import { NurseMonitoringView } from "@/components/portal/views/NursePortalContent";
import DailyRoundsBoard from "@/components/portal/views/clinical/DailyRoundsBoard";

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
  const [monitoringFallAlert, setMonitoringFallAlert] = useState(false);
  switch (tab) {
    case "dashboard":
      return <PhysicianCommandCenter />;
    case "casereview":
      return <PhysicianCaseReview />;
    case "dailyrounds":
      return <DailyRoundsBoard clinicianRole="PHYSICIAN" />;
    case "orders":
      return <PhysicianOrders approveMode />;
    case "careplans":
      return <CarePlanBoard />;
    case "labs":
      return <LabsAllergiesBoard />;
    case "consults":
      return <PhysicianConsults />;
    case "physiciancomms":
      return <PhysicianCommsLog />;
    case "referrals":
      return <ReferralsBoard />;
    case "escalations":
      return <EscalationsBoard role="PHYSICIAN" />;
    case "incidents":
      return <PhysicianIncidents />;
    case "notes":
      return <ClinicalNotes clinicianRole="PHYSICIAN" />;
    case "messages":
      return <ClinicalMessages clinicianRole="PHYSICIAN" />;
    case "reports":
      return <ClinicalReports />;
    // Legacy route segments still resolve to the closest physician module.
    case "rounds":
      return <AssessmentAcuityBoard clinicianRole="PHYSICIAN" />;
    case "records":
      return <NurseRecords />;
    case "tasks":
      return <DailyDocumentation clinicianRole="PHYSICIAN" />;
    case "vitals":
      return <PhysicianCommandCenter />;
    case "vaccinations":
      return <VaccinationTracker />;
    case "documents":
      return <ResidentDocuments />;
    case "mar":
      return <MARBoard />;
    case "followups":
      return <FollowUpTracker />;
    case "auditlog":
      return <AuditLogViewer />;
    case "vitals":
      return <PhysicianCommandCenter />;
    case "monitoring":
      return (
        <NurseMonitoringView
          monitoringFallAlert={monitoringFallAlert}
          handleMonitoringFallTriggered={() => {}}
          setMonitoringFallAlert={setMonitoringFallAlert}
        />
      );
    default:
      return <PhysicianCommandCenter />;
  }
}
