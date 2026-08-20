"use client";
import { useState } from "react";
import PhysicianCommandCenter from "@/components/portal/views/physician/PhysicianCommandCenter";
import PhysicianCaseReview from "@/components/portal/views/physician/PhysicianCaseReview";
import PhysicianOrders from "@/components/portal/views/physician/PhysicianOrders";
import PhysicianConsults from "@/components/portal/views/physician/PhysicianConsults";
import PhysicianIncidents from "@/components/portal/views/physician/PhysicianIncidents";
import ClinicalNotes from "@/components/portal/views/clinical/ClinicalNotes";
import ClinicalMessages from "@/components/portal/views/clinical/ClinicalMessages";
import EscalationsBoard from "@/components/portal/views/clinical/EscalationsBoard";
import PhysicianCommsLog from "@/components/portal/views/clinical/PhysicianCommsLog";
import ReferralsBoard from "@/components/portal/views/clinical/ReferralsBoard";
import CareAcuityBoard from "@/components/portal/views/clinical/CareAcuityBoard";
import NurseRecords from "@/components/portal/views/NurseRecords";
import DailyDocumentation from "@/components/portal/views/clinical/DailyDocumentation";
import LabsAllergiesBoard from "@/components/portal/views/clinical/LabsAllergiesBoard";
import VaccinationTracker from "@/components/portal/views/clinical/VaccinationTracker";
import ResidentDocuments from "@/components/portal/views/clinical/ResidentDocuments";
import FollowUpTracker from "@/components/portal/views/clinical/FollowUpTracker";
import ClinicalReports from "@/components/portal/views/clinical/ClinicalReports";
import AuditLogViewer from "@/components/portal/views/clinical/AuditLogViewer";
import { NurseMonitoringView } from "@/components/portal/views/NursePortalContent";
import DailyRoundsBoard from "@/components/portal/views/clinical/DailyRoundsBoard";
// Newer clinical boards transferred from the Care Manager portal — the physician
// reviews the whole care record, so these render the same up-to-date boards.
import CareLogsBoard, { CareLogsTimeline } from "@/components/portal/views/clinical/CareLogsBoard";
import ResidentCareHistory from "@/components/portal/views/clinical/ResidentCareHistory";
import ClinicalRecordsBoard from "@/components/portal/views/clinical/ClinicalRecordsBoard";
import VitalsTrendBoard from "@/components/portal/views/clinical/VitalsTrendBoard";
import ADLMonitoringBoard from "@/components/portal/views/clinical/ADLMonitoringBoard";
import WeightMonitoringBoard from "@/components/portal/views/clinical/WeightMonitoringBoard";
import WoundCareBoard from "@/components/portal/views/clinical/WoundCareBoard";
import CarePlanReviewsBoard from "@/components/portal/views/clinical/CarePlanReviewsBoard";
import MARDailyBoard from "@/components/portal/views/clinical/MARDailyBoard";
import MedicationComplianceBoard from "@/components/portal/views/clinical/MedicationComplianceBoard";
import MedicationInventoryBoard from "@/components/portal/views/clinical/MedicationInventoryBoard";
import MiniPharmacyBoard from "@/components/portal/views/clinical/MiniPharmacyBoard";
import ResidentProgressReport from "@/components/portal/views/clinical/ResidentProgressReport";

interface PhysicianPortalContentProps {
  tab: string;
}

/**
 * Physician portal — a medical-authority / oversight perspective, deliberately
 * distinct from the nurse's hands-on operations portal. The physician diagnoses,
 * prescribes & signs, sets care-plan directives, answers consults/referrals, and
 * reviews & co-signs what the patient, family, nurse & caregiver report. It shares
 * the Care Manager's up-to-date clinical boards for review. Every module is live
 * via Supabase realtime + polling.
 */
export default function PhysicianPortalContent({ tab }: PhysicianPortalContentProps) {
  const [monitoringFallAlert, setMonitoringFallAlert] = useState(false);
  switch (tab) {
    case "dashboard":
      return <PhysicianCommandCenter />;

    // ── Resident Care ──
    case "residents":
      return <CareLogsBoard clinicianRole="PHYSICIAN" />;
    case "records":
      return <NurseRecords />;
    case "clinicalrecords":
      return <ClinicalRecordsBoard clinicianRole="PHYSICIAN" />;
    case "dailyrounds":
      return <DailyRoundsBoard clinicianRole="PHYSICIAN" />;
    case "carelogs":
      return <CareLogsTimeline clinicianRole="PHYSICIAN" />;
    case "carehistory":
      return <ResidentCareHistory clinicianRole="PHYSICIAN" />;
    case "vitalstrend":
    case "vitals": // legacy alias
      return <VitalsTrendBoard clinicianRole="PHYSICIAN" />;
    case "weightmonitoring":
      return <WeightMonitoringBoard clinicianRole="PHYSICIAN" />;
    case "adlmonitoring":
      return <ADLMonitoringBoard clinicianRole="PHYSICIAN" />;
    case "casereview":
      return <PhysicianCaseReview />;
    case "woundcare":
      return <WoundCareBoard clinicianRole="PHYSICIAN" />;
    case "labs":
      return <LabsAllergiesBoard />;
    case "careplans":
      return <CarePlanReviewsBoard clinicianRole="PHYSICIAN" />;

    // ── Medication ──
    case "orders":
      return <PhysicianOrders approveMode />;
    case "mar":
      return <MARDailyBoard clinicianRole="PHYSICIAN" />;
    case "medcompliance":
      return <MedicationComplianceBoard />;
    case "medinventory":
      return <MedicationInventoryBoard clinicianRole="PHYSICIAN" />;
    case "minipharmacy":
      return <MiniPharmacyBoard clinicianRole="PHYSICIAN" />;

    // ── Coordination & Comms ──
    case "consults":
      return <PhysicianConsults />;
    case "physiciancomms":
      return <PhysicianCommsLog />;
    case "referrals":
      return <ReferralsBoard />;
    case "escalations":
      return <EscalationsBoard role="PHYSICIAN" />;
    case "notes":
      return <ClinicalNotes clinicianRole="PHYSICIAN" />;
    case "followups":
      return <FollowUpTracker />;
    case "progressreport":
      return <ResidentProgressReport clinicianRole="PHYSICIAN" />;

    // ── Operations ──
    case "incidents":
      return <PhysicianIncidents />;

    // ── Administration ──
    case "auditlog":
      return <AuditLogViewer />;

    // ── Legacy / removed-from-sidebar routes still resolve so deep links work ──
    case "rounds":
      return <CareAcuityBoard clinicianRole="PHYSICIAN" />;
    case "tasks":
      return <DailyDocumentation clinicianRole="PHYSICIAN" />;
    case "reports":
      return <ClinicalReports />;
    case "vaccinations":
      return <VaccinationTracker />;
    case "documents":
      return <ResidentDocuments />;
    case "messages":
      return <ClinicalMessages clinicianRole="PHYSICIAN" />;
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
