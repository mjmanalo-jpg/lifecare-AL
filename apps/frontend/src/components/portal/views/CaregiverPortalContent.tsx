"use client";

import CaregiverDashboard from "@/components/portal/views/caregiver/CaregiverDashboard";
import CaregiverTasks from "@/components/portal/views/caregiver/CaregiverTasks";
import TaskAssignmentBoard from "@/components/portal/views/clinical/TaskAssignmentBoard";
import CaregiverScheduleBoard from "@/components/portal/views/clinical/CaregiverScheduleBoard";
import ResidentCareHistory from "@/components/portal/views/clinical/ResidentCareHistory";
import VitalsTrendBoard from "@/components/portal/views/clinical/VitalsTrendBoard";
import CaregiverCallBells from "@/components/portal/views/caregiver/CaregiverCallBells";
import CaregiverResidents from "@/components/portal/views/caregiver/CaregiverResidents";
import CaregiverTimeClock from "@/components/portal/views/caregiver/CaregiverTimeClock";
import CaregiverReports from "@/components/portal/views/caregiver/CaregiverReports";
import CaregiverCareTeam from "@/components/portal/views/caregiver/CaregiverCareTeam";
import CaregiverMonitoring from "@/components/portal/views/caregiver/CaregiverMonitoring";
import CameraActivityLog from "@/components/portal/views/clinical/CameraActivityLog";
import EscalationsBoard from "@/components/portal/views/clinical/EscalationsBoard";
import PhysicianCarePlans from "@/components/portal/views/physician/PhysicianCarePlans";
import NurseMedications from "@/components/portal/views/NurseMedications";
import DailyDocumentation from "@/components/portal/views/clinical/DailyDocumentation";
import CarePlanReviewsBoard from "@/components/portal/views/clinical/CarePlanReviewsBoard";
import VaccinationTracker from "@/components/portal/views/clinical/VaccinationTracker";
import ResidentDocuments from "@/components/portal/views/clinical/ResidentDocuments";
import MARDailyBoard from "@/components/portal/views/clinical/MARDailyBoard";
import FollowUpTracker from "@/components/portal/views/clinical/FollowUpTracker";
import DailyRoundsBoard from "@/components/portal/views/clinical/DailyRoundsBoard";
import { CareLogsTimeline } from "@/components/portal/views/clinical/CareLogsBoard";
import ADLMonitoringBoard from "@/components/portal/views/clinical/ADLMonitoringBoard";
import ShiftEndorsementBoard from "@/components/portal/views/clinical/ShiftEndorsementBoard";
import ShiftEndorsementDashboard from "@/components/portal/views/clinical/ShiftEndorsementDashboard";
import WeightMonitoringBoard from "@/components/portal/views/clinical/WeightMonitoringBoard";
import ShiftSummaryBoard from "@/components/portal/views/clinical/ShiftSummaryBoard";
import AssessmentAcuityBoard from "@/components/portal/views/clinical/AssessmentAcuityBoard";
import FacilityIncidents from "@/components/portal/views/FacilityIncidents";

interface CaregiverPortalContentProps {
  tab: string;
}

/**
 * Caregiver Portal router — every module is live (Supabase realtime +
 * polling fallback via useLiveQuery) and cross-role aligned: tasks come
 * from nurse/physician assignments, orders from the physician portal,
 * and call bells from resident SOS requests.
 */
export default function CaregiverPortalContent({ tab }: CaregiverPortalContentProps) {
  switch (tab) {
    case "tasks":
    case "taskboard":
      return <CaregiverTasks />;
    case "taskassignment":
      return <TaskAssignmentBoard clinicianRole="CAREGIVER" />;
    case "caregiverschedule":
      return <CaregiverScheduleBoard clinicianRole="CAREGIVER" />;
    case "carehistory":
      return <ResidentCareHistory clinicianRole="CAREGIVER" />;
    case "vitalstrend":
      return <VitalsTrendBoard clinicianRole="CAREGIVER" />;
    case "cameralogs":
      return <CameraActivityLog />;
    case "dailyrounds":
      return <DailyRoundsBoard clinicianRole="CAREGIVER" />;
    case "carelogs":
      return <CareLogsTimeline clinicianRole="CAREGIVER" />;
    case "adlmonitoring":
      return <ADLMonitoringBoard clinicianRole="CAREGIVER" />;
    case "shiftendorsements":
      return <ShiftEndorsementBoard clinicianRole="CAREGIVER" />;
    case "endorsementdashboard":
      return <ShiftEndorsementDashboard clinicianRole="CAREGIVER" />;
    case "weightmonitoring":
      return <WeightMonitoringBoard clinicianRole="CAREGIVER" />;
    case "shiftsummary":
      return <ShiftSummaryBoard clinicianRole="CAREGIVER" />;
    case "callbells":
      return <CaregiverCallBells />;
    case "residents":
      return <CaregiverResidents />;
    case "timeclock":
      return <CaregiverTimeClock />;
    case "reports":
      return <CaregiverReports />;
    case "careteam":
      return <CaregiverCareTeam />;
    case "monitoring":
      return <CaregiverMonitoring />;
    case "escalations":
      return <EscalationsBoard role="CAREGIVER" />;
    case "rounds":
      return <AssessmentAcuityBoard clinicianRole="CAREGIVER" />;
    case "careplans":
      return <CarePlanReviewsBoard clinicianRole="CAREGIVER" />;
    case "medications":
      return <NurseMedications />;
    case "documentation":
      return <DailyDocumentation clinicianRole="CAREGIVER" />;
    case "vaccinations":
      return <VaccinationTracker />;
    case "documents":
      return <ResidentDocuments />;
    case "mar":
      return <MARDailyBoard clinicianRole="CAREGIVER" />;
    case "followups":
      return <FollowUpTracker />;
    case "incidents":
      return <FacilityIncidents readOnly />;
    default:
      return <CaregiverDashboard />;
  }
}
