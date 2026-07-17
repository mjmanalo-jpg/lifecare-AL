import { prisma } from "./prisma";

/**
 * Whitelist of data models exposed through /api/db/[model].
 * `key`      → URL segment used by the frontend (kebab-case).
 * `delegate` → the Prisma model accessor.
 * `table`    → the Postgres table name (PascalCase) for Supabase realtime.
 * `orderBy`  → default sort for list queries.
 */
export interface ModelDef {
  // Prisma delegates share no common public type; `any` is intentional here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delegate: any;
  table: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  orderBy?: Record<string, any>;
}

export const MODELS: Record<string, ModelDef> = {
  users: { delegate: prisma.user, table: "User", orderBy: { createdAt: "desc" } },
  residents: { delegate: prisma.resident, table: "Resident", orderBy: { createdAt: "desc" } },
  staff: { delegate: prisma.staff, table: "Staff", orderBy: { createdAt: "desc" } },
  vitals: { delegate: prisma.vitalsLog, table: "VitalsLog", orderBy: { recordedAt: "desc" } },
  incidents: { delegate: prisma.incident, table: "Incident", orderBy: { incidentDate: "desc" } },
  medications: { delegate: prisma.medication, table: "Medication", orderBy: { startDate: "desc" } },
  tasks: { delegate: prisma.task, table: "Task", orderBy: { dueDate: "asc" } },
  messages: { delegate: prisma.message, table: "Message", orderBy: { createdAt: "desc" } },
  "shift-reports": { delegate: prisma.shiftReport, table: "ShiftReport", orderBy: { date: "desc" } },
  notifications: { delegate: prisma.notification, table: "Notification", orderBy: { createdAt: "desc" } },
  visits: { delegate: prisma.visit, table: "Visit", orderBy: { checkInTime: "desc" } },
  invoices: { delegate: prisma.invoice, table: "Invoice", orderBy: { dueDate: "desc" } },
  "resident-notes": { delegate: prisma.residentNote, table: "ResidentNote", orderBy: { createdAt: "desc" } },
  "medical-notes": { delegate: prisma.medicalNote, table: "MedicalNote", orderBy: { createdAt: "desc" } },
  "call-bells": { delegate: prisma.callBell, table: "CallBell", orderBy: { createdAt: "desc" } },
  "time-tracking": { delegate: prisma.timeTracking, table: "TimeTracking", orderBy: { startTime: "desc" } },
  "knowledge-docs": { delegate: prisma.knowledgeDoc, table: "KnowledgeDoc", orderBy: { createdAt: "desc" } },
  "app-settings": { delegate: prisma.appSetting, table: "AppSetting", orderBy: { id: "asc" } },
  admissions: { delegate: prisma.admission, table: "Admission", orderBy: { createdAt: "desc" } },
  rooms: { delegate: prisma.room, table: "Room", orderBy: { roomNumber: "asc" } },
  inventory: { delegate: prisma.inventoryItem, table: "InventoryItem", orderBy: { itemName: "asc" } },
  "service-charges": { delegate: prisma.serviceCharge, table: "ServiceCharge", orderBy: { serviceDate: "desc" } },
  "insurance-validations": { delegate: prisma.insuranceValidation, table: "InsuranceValidation", orderBy: { createdAt: "desc" } },
  payments: { delegate: prisma.payment, table: "Payment", orderBy: { paymentDate: "desc" } },
  vehicles: { delegate: prisma.vehicle, table: "Vehicle", orderBy: { name: "asc" } },
  drivers: { delegate: prisma.driver, table: "Driver", orderBy: { name: "asc" } },
  "transport-requests": { delegate: prisma.transportRequest, table: "TransportRequest", orderBy: { requestedDate: "desc" } },
  trips: { delegate: prisma.trip, table: "Trip", orderBy: { scheduledAt: "desc" } },
  "vehicle-maintenance": { delegate: prisma.vehicleMaintenance, table: "VehicleMaintenance", orderBy: { scheduledDate: "desc" } },
  "fuel-logs": { delegate: prisma.fuelLog, table: "FuelLog", orderBy: { logDate: "desc" } },
  "blog-posts": { delegate: prisma.blogPost, table: "BlogPost", orderBy: { publishedAt: "desc" } },
  "site-content": { delegate: prisma.siteContent, table: "SiteContent", orderBy: { id: "asc" } },
  "custom-pages": { delegate: prisma.customPage, table: "CustomPage", orderBy: { sortOrder: "asc" } },
  "resident-goals": { delegate: prisma.residentGoal, table: "ResidentGoal", orderBy: { createdAt: "desc" } },
  "medication-logs": { delegate: prisma.medicationLog, table: "MedicationLog", orderBy: { takenAt: "desc" } },
  "daily-menus": { delegate: prisma.dailyMenu, table: "DailyMenu", orderBy: { menuDate: "desc" } },
  "service-requests": { delegate: prisma.serviceRequest, table: "ServiceRequest", orderBy: { createdAt: "desc" } },
  "facility-maintenance": { delegate: prisma.facilityMaintenance, table: "FacilityMaintenance", orderBy: { scheduledDate: "asc" } },
  "concierge-bookings": { delegate: prisma.conciergeBooking, table: "ConciergeBooking", orderBy: { scheduledAt: "desc" } },
  "front-desk-visits": { delegate: prisma.frontDeskVisit, table: "FrontDeskVisit", orderBy: { arrivalTime: "desc" } },
  "room-turnovers": { delegate: prisma.roomTurnover, table: "RoomTurnover", orderBy: { startedAt: "desc" } },
  "resident-preferences": { delegate: prisma.residentPreference, table: "ResidentPreference", orderBy: { category: "asc" } },
  "community-events": { delegate: prisma.communityEvent, table: "CommunityEvent", orderBy: { startTime: "asc" } },
  "event-attendances": { delegate: prisma.eventAttendance, table: "EventAttendance", orderBy: { createdAt: "desc" } },
  "dining-reservations": { delegate: prisma.diningReservation, table: "DiningReservation", orderBy: { reservedAt: "desc" } },
  announcements: { delegate: prisma.announcement, table: "Announcement", orderBy: { publishedAt: "desc" } },
  escalations: { delegate: prisma.escalation, table: "Escalation", orderBy: { createdAt: "desc" } },
  "dietitian-consults": { delegate: prisma.dietitianConsult, table: "DietitianConsult", orderBy: { consultDate: "desc" } },
  "food-compliance-logs": { delegate: prisma.foodComplianceLog, table: "FoodComplianceLog", orderBy: { auditDate: "desc" } },
  "camera-monitoring-logs": { delegate: prisma.cameraMonitoringLog, table: "CameraMonitoringLog", orderBy: { createdAt: "desc" } },

  // V2.1 — Multi-tenant hierarchy
  organizations: { delegate: prisma.organization, table: "Organization", orderBy: { name: "asc" } },
  communities: { delegate: prisma.community, table: "Community", orderBy: { name: "asc" } },
  buildings: { delegate: prisma.building, table: "Building", orderBy: { name: "asc" } },
  floors: { delegate: prisma.floor, table: "Floor", orderBy: { floorNumber: "asc" } },
  units: { delegate: prisma.unit, table: "Unit", orderBy: { name: "asc" } },

  // V2.1 — Assessment & acuity engine
  assessments: { delegate: prisma.assessment, table: "Assessment", orderBy: { createdAt: "desc" } },
  "acuity-scores": { delegate: prisma.acuityScore, table: "AcuityScore", orderBy: { scoredAt: "desc" } },

  // V2.1 — Service catalog & care packages
  "service-catalogs": { delegate: prisma.serviceCatalog, table: "ServiceCatalog", orderBy: { sortOrder: "asc" } },
  "care-packages": { delegate: prisma.carePackage, table: "CarePackage", orderBy: { name: "asc" } },
  "care-package-items": { delegate: prisma.carePackageItem, table: "CarePackageItem", orderBy: { sortOrder: "asc" } },

  // V2.1 — SOP & competency
  "community-sops": { delegate: prisma.communitySop, table: "CommunitySop", orderBy: { title: "asc" } },
  competencies: { delegate: prisma.competency, table: "Competency", orderBy: { name: "asc" } },
  "staff-competencies": { delegate: prisma.staffCompetency, table: "StaffCompetency", orderBy: { createdAt: "desc" } },

  // V2.1 — Quality scorecards & KPIs
  "resident-quality-scores": { delegate: prisma.residentQualityScore, table: "ResidentQualityScore", orderBy: { periodStart: "desc" } },
  "community-quality-dashboards": { delegate: prisma.communityQualityDashboard, table: "CommunityQualityDashboard", orderBy: { snapshotDate: "desc" } },
  "kpi-records": { delegate: prisma.kpiRecord, table: "KpiRecord", orderBy: { periodStart: "desc" } },

  // V2.1 — Audit log & observations
  "audit-logs": { delegate: prisma.auditLog, table: "AuditLog", orderBy: { createdAt: "desc" } },
  observations: { delegate: prisma.observation, table: "Observation", orderBy: { observedAt: "desc" } },

  // V2.1 — Staffing intelligence
  "staffing-plans": { delegate: prisma.staffingPlan, table: "StaffingPlan", orderBy: { planDate: "desc" } },

  // LCMS Module 1 — Vaccinations & Documents
  vaccinations: { delegate: prisma.vaccination, table: "Vaccination", orderBy: { dateGiven: "desc" } },
  "resident-documents": { delegate: prisma.residentDocument, table: "ResidentDocument", orderBy: { createdAt: "desc" } },

  // LCMS Module 3 — Care Plans
  "care-plans": { delegate: prisma.carePlan, table: "CarePlan", orderBy: { startDate: "desc" } },
  "care-plan-items": { delegate: prisma.carePlanItem, table: "CarePlanItem", orderBy: { sortOrder: "asc" } },
  "care-plan-reviews": { delegate: prisma.carePlanReview, table: "CarePlanReview", orderBy: { reviewDate: "desc" } },

  // LCMS Module 4 — Daily Documentation
  eliminations: { delegate: prisma.eliminationLog, table: "EliminationLog", orderBy: { time: "desc" } },
  "pain-assessments": { delegate: prisma.painAssessment, table: "PainAssessment", orderBy: { assessedAt: "desc" } },
  "wound-cares": { delegate: prisma.woundCare, table: "WoundCare", orderBy: { assessedAt: "desc" } },
  "sleep-logs": { delegate: prisma.sleepLog, table: "SleepLog", orderBy: { date: "desc" } },
  "mobility-logs": { delegate: prisma.mobilityLog, table: "MobilityLog", orderBy: { startTime: "desc" } },

  // LCMS Module 6 — Medication Administration & History
  "medication-administrations": { delegate: prisma.medicationAdministration, table: "MedicationAdministration", orderBy: { scheduledTime: "desc" } },
  "medication-change-logs": { delegate: prisma.medicationChangeLog, table: "MedicationChangeLog", orderBy: { changedAt: "desc" } },

  // LCMS Module 7 — Clinical Coordination
  "hospital-referrals": { delegate: prisma.hospitalReferral, table: "HospitalReferral", orderBy: { createdAt: "desc" } },
  "follow-ups": { delegate: prisma.followUp, table: "FollowUp", orderBy: { dueDate: "asc" } },

  // LCMS Module 8 — Timeline, Reports, Alerts
  "care-timeline": { delegate: prisma.careTimelineEntry, table: "CareTimelineEntry", orderBy: { entryDate: "desc" } },
  "generated-reports": { delegate: prisma.generatedReport, table: "GeneratedReport", orderBy: { createdAt: "desc" } },
  "inventory-alerts": { delegate: prisma.inventoryAlert, table: "InventoryAlert", orderBy: { createdAt: "desc" } },

  // LCMS Module 4 — Comprehensive Daily Rounds
  "daily-rounds": { delegate: prisma.dailyRound, table: "DailyRound", orderBy: { roundDate: "desc" } },
  "bowel-records": { delegate: prisma.bowelRecord, table: "BowelRecord", orderBy: { time: "desc" } },
  "urine-records": { delegate: prisma.urineRecord, table: "UrineRecord", orderBy: { time: "desc" } },
  "edema-records": { delegate: prisma.edemaRecord, table: "EdemaRecord", orderBy: { time: "desc" } },
  "concern-records": { delegate: prisma.concernRecord, table: "ConcernRecord", orderBy: { time: "desc" } },
  "pain-records": { delegate: prisma.painRecord, table: "PainRecord", orderBy: { time: "desc" } },
  "mood-records": { delegate: prisma.moodRecord, table: "MoodRecord", orderBy: { time: "desc" } },
  "round-sleep-records": { delegate: prisma.sleepRecord, table: "SleepRecord", orderBy: { createdAt: "desc" } },
  "mobility-records": { delegate: prisma.mobilityRecord, table: "MobilityRecord", orderBy: { time: "desc" } },
  "meal-records": { delegate: prisma.mealRecord, table: "MealRecord", orderBy: { time: "desc" } },
  "vital-signs": { delegate: prisma.vitalSigns, table: "VitalSigns", orderBy: { time: "desc" } },
};

export function getModel(key: string): ModelDef | undefined {
  return MODELS[key];
}

/**
 * True only when a real database connection string is present. Until the user
 * fills in DATABASE_URL (it ships as a `<PROJECT_REF>` placeholder), the API
 * routes serve demo data so the portals are fully populated instead of erroring.
 */
export function isDbConfigured(): boolean {
  let url = process.env.DATABASE_URL;
  if (!url) return false;
  url = url.trim();
  if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
    url = url.slice(1, -1).trim();
  }
  return (url.startsWith("postgresql://") || url.startsWith("postgres://")) && !url.includes("<");
}
