"use client";

import NurseDashboard from "@/components/portal/views/NurseDashboard";
import AlertCenter from "@/components/portal/views/clinical/AlertCenter";
import ApprovalWorkflows from "@/components/portal/views/clinical/ApprovalWorkflows";
import FacilityIncidents from "@/components/portal/views/FacilityIncidents";
import DailyRoundsBoard from "@/components/portal/views/clinical/DailyRoundsBoard";
import AssessmentAcuityBoard from "@/components/portal/views/clinical/AssessmentAcuityBoard";
import CarePlanBoard from "@/components/portal/views/clinical/CarePlanBoard";
import LabsAllergiesBoard from "@/components/portal/views/clinical/LabsAllergiesBoard";
import EscalationsBoard from "@/components/portal/views/clinical/EscalationsBoard";
import MARBoard from "@/components/portal/views/clinical/MARBoard";
import ReferralsBoard from "@/components/portal/views/clinical/ReferralsBoard";
import PhysicianCommsLog from "@/components/portal/views/clinical/PhysicianCommsLog";
import FollowUpTracker from "@/components/portal/views/clinical/FollowUpTracker";
import ClinicalReports from "@/components/portal/views/clinical/ClinicalReports";
import AuditLogViewer from "@/components/portal/views/clinical/AuditLogViewer";
import ConsentFormsManager from "@/components/portal/views/ConsentFormsManager";
import MonitoringView from "@/components/portal/views/MonitoringView";
import QualityMonitoringBoard from "@/components/portal/views/clinical/QualityMonitoringBoard";
import MedSafetyDashboard from "@/components/portal/views/clinical/MedSafetyDashboard";

/**
 * Care Manager portal — clinical oversight split out of Facility Operations:
 * approvals, incidents, alerts, rounds, assessments, care planning, MAR,
 * referrals, and physician coordination. The Care Manager acts with facility-
 * admin clinical authority (permission checks key off the CARE_MANAGER session
 * role); the clinical boards take `clinicianRole="FACILITY_ADMIN"` since that
 * enum is what those components model.
 */
export default function CareManagerPortalContent({ tab }: { tab: string }) {
  switch (tab) {
    case "alertcenter":
      return <AlertCenter />;
    case "incidents":
      return <FacilityIncidents />;
    case "dailyrounds":
      return <DailyRoundsBoard clinicianRole="FACILITY_ADMIN" />;
    case "escalations":
      return <EscalationsBoard role="FACILITY_ADMIN" />;
    case "approvalworkflows":
      return <ApprovalWorkflows />;
    case "mar":
      return <MARBoard />;
    case "medsafety":
      return <MedSafetyDashboard />;
    case "monitoring":
      return <MonitoringView />;
    case "rounds":
      return <AssessmentAcuityBoard clinicianRole="FACILITY_ADMIN" />;
    case "careplans":
      return <CarePlanBoard />;
    case "labs":
      return <LabsAllergiesBoard />;
    case "referrals":
      return <ReferralsBoard canApprove />;
    case "physiciancomms":
      return <PhysicianCommsLog />;
    case "followups":
      return <FollowUpTracker />;
    case "clinicalreports":
      return <ClinicalReports />;
    case "quality":
      return <QualityMonitoringBoard />;
    case "auditlog":
      return <AuditLogViewer focus="clinical" />;
    case "consentforms":
      return <ConsentFormsManager />;
    default:
      return <NurseDashboard />;
  }
}
