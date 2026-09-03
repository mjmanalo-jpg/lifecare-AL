"use client";

import CaregiverMyShift from "@/components/portal/dashboards/caregiver/CaregiverMyShift";
import CaregiverTasks from "@/components/portal/views/caregiver/CaregiverTasks";
import TaskAssignmentBoard from "@/components/portal/views/clinical/TaskAssignmentBoard";
import TodaysCareBoard from "@/components/portal/views/clinical/TodaysCareBoard";
import CaregiverScheduleBoard from "@/components/portal/views/clinical/CaregiverScheduleBoard";
import ResidentCareHistory from "@/components/portal/views/clinical/ResidentCareHistory";
import VitalsTrendBoard from "@/components/portal/views/clinical/VitalsTrendBoard";
import CaregiverCallBells from "@/components/portal/views/caregiver/CaregiverCallBells";
import ClockInBoard from "@/components/portal/views/clinical/ClockInBoard";
import CaregiverReports from "@/components/portal/views/caregiver/CaregiverReports";
import CaregiverCareTeam from "@/components/portal/views/caregiver/CaregiverCareTeam";
import CaregiverMonitoring from "@/components/portal/views/caregiver/CaregiverMonitoring";
import CameraActivityLog from "@/components/portal/views/clinical/CameraActivityLog";
import EscalationsBoard from "@/components/portal/views/clinical/EscalationsBoard";
import PhysicianCarePlans from "@/components/portal/views/physician/PhysicianCarePlans";
import NurseMedications from "@/components/portal/views/NurseMedications";
import DailyDocumentation from "@/components/portal/views/clinical/DailyDocumentation";
import VaccinationTracker from "@/components/portal/views/clinical/VaccinationTracker";
import ResidentDocuments from "@/components/portal/views/clinical/ResidentDocuments";
import MARDailyBoard from "@/components/portal/views/clinical/MARDailyBoard";
import FollowUpTracker from "@/components/portal/views/clinical/FollowUpTracker";
import CareLogsBoard, { CareLogsTimeline } from "@/components/portal/views/clinical/CareLogsBoard";
import ADLMonitoringBoard from "@/components/portal/views/clinical/ADLMonitoringBoard";
import ShiftEndorsementBoard from "@/components/portal/views/clinical/ShiftEndorsementBoard";
import ShiftEndorsementDashboard from "@/components/portal/views/clinical/ShiftEndorsementDashboard";
import WeightMonitoringBoard from "@/components/portal/views/clinical/WeightMonitoringBoard";
import ShiftSummaryBoard from "@/components/portal/views/clinical/ShiftSummaryBoard";
import FacilityIncidents from "@/components/portal/views/FacilityIncidents";
import HubTabs from "@/components/portal/HubTabs";

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
    case "actionqueue":
      return (
        <HubTabs
          storageKey="caregiver-actionqueue"
          tabs={[
            { key: "escalations", label: "Escalate to Nurse", node: <EscalationsBoard role="CAREGIVER" /> },
            { key: "callbells", label: "Call Bells", node: <CaregiverCallBells /> },
            { key: "incidents", label: "Report an Incident", node: <FacilityIncidents readOnly /> },
          ]}
        />
      );
    case "tasks":
    case "taskboard":
      return <CaregiverTasks />;
    case "todayscare":
      return <TodaysCareBoard role="CAREGIVER" />;
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
      // Resident Directory — same layout as the Care Manager directory, but
      // read-only (canManage=false → View + QR, no Edit/Deactivate). The generic
      // residents API scopes a caregiver to their active-shift assignments via
      // tenantWhere, so only assigned residents appear.
      return <CareLogsBoard clinicianRole="CAREGIVER" canManage={false} />;
    case "clockin":
      return <ClockInBoard clinicianRole="CAREGIVER" />;
    case "reports":
      return <CaregiverReports />;
    case "careteam":
      return <CaregiverCareTeam />;
    case "monitoring":
      return <CaregiverMonitoring />;
    case "escalations":
      return <EscalationsBoard role="CAREGIVER" />;
    // Leveling surfaces removed for caregivers: the system assigns Level of Care,
    // a caregiver never sets it. `rounds` (Care Acuity → v4.2 assessment) and
    // `careplans` (Care Plan Review) no longer resolve and fall through to My Shift.
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
      return <CaregiverMyShift />;
  }
}
