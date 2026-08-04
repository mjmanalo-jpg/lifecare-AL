-- =====================================================================
-- LifeCare CMS — Full schema baseline (Supabase bootstrap, step 1 of 2)
-- Generated from prisma/schema.prisma via:
--   prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
-- Reflects the CURRENT schema (supersedes prisma/migrations/, which is stale).
-- Run this FIRST on a fresh Supabase project, then run 02_tenant_rls.sql.
-- Idempotency: run once on an EMPTY database (no IF NOT EXISTS guards).
-- =====================================================================

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPERADMIN', 'FACILITY_ADMIN', 'CARE_MANAGER', 'BILLING_ADMIN', 'PHYSICIAN', 'NURSE', 'CAREGIVER', 'FAMILY', 'RESIDENT', 'FLEET_MANAGEMENT', 'DRIVER', 'SECURITY', 'NUTRITIONIST', 'KITCHEN', 'HOUSEKEEPING', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('PLATFORM_ADMIN', 'PLATFORM_SUPPORT', 'PLATFORM_AUDITOR');

-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('OWNER', 'ADMIN', 'BILLING_ADMIN', 'VIEWER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED');

-- CreateEnum
CREATE TYPE "UsageMetric" AS ENUM ('ACTIVE_COMMUNITIES', 'ACTIVE_RESIDENTS', 'ACTIVE_STAFF', 'STORAGE_BYTES');

-- CreateEnum
CREATE TYPE "CareLevel" AS ENUM ('INDEPENDENT', 'ASSISTED', 'MEMORY', 'SKILLED');

-- CreateEnum
CREATE TYPE "VitalType" AS ENUM ('BLOOD_PRESSURE', 'HEART_RATE', 'TEMPERATURE', 'OXYGEN', 'BLOOD_GLUCOSE', 'WEIGHT', 'RESPIRATORY_RATE');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ResidentStatus" AS ENUM ('ACTIVE', 'DISCHARGED', 'ON_LEAVE', 'DECEASED');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('FALL', 'MEDICATION_ERROR', 'BEHAVIORAL', 'MEDICAL_EMERGENCY', 'SAFETY_HAZARD', 'INFECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('MINOR', 'MODERATE', 'SEVERE', 'CRITICAL');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('GENERAL', 'ALERT', 'URGENT', 'NOTIFICATION');

-- CreateEnum
CREATE TYPE "MedicationStatus" AS ENUM ('ACTIVE', 'DISCONTINUED', 'PENDING', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "CallBellStatus" AS ENUM ('PENDING', 'RESPONDED', 'CANCELLED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ShiftType" AS ENUM ('MORNING', 'AFTERNOON', 'NIGHT', 'OVERNIGHT');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('TASK_ASSIGNMENT', 'VITAL_ALERT', 'INCIDENT_REPORT', 'MEDICATION_REMINDER', 'CALL_BELL', 'MESSAGE', 'SHIFT_REMINDER', 'SYSTEM_ALERT', 'TRANSPORT_UPDATE', 'SERVICE_UPDATE', 'ANNOUNCEMENT', 'EVENT_INVITE', 'SBAR_ESCALATION', 'BILLING_UPDATE');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EARLY_LEAVE');

-- CreateEnum
CREATE TYPE "AdmissionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CommunityType" AS ENUM ('ASSISTED_LIVING', 'INDEPENDENT_LIVING', 'MEMORY_CARE', 'TRANSITIONAL_CARE', 'HOME_CARE');

-- CreateEnum
CREATE TYPE "CommunityUnitType" AS ENUM ('ASSISTED_LIVING', 'INDEPENDENT_LIVING', 'MEMORY_CARE', 'SKILLED_NURSING', 'TRANSITIONAL_CARE', 'HOME_CARE');

-- CreateEnum
CREATE TYPE "AssessmentType" AS ENUM ('ADMISSION', 'ANNUAL', 'QUARTERLY', 'CONDITION_CHANGE', 'CARE_PLAN_REVIEW', 'DISCHARGE', 'TRANSFER');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'REVIEWED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "AcuityLevel" AS ENUM ('LOW', 'MODERATE', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ServiceCategory" AS ENUM ('PERSONAL_CARE', 'MOBILITY', 'MEDICATION', 'NUTRITION', 'HYDRATION', 'VITALS', 'SKIN_CARE', 'COGNITIVE', 'BEHAVIORAL', 'SOCIAL', 'REHABILITATION', 'TRANSPORT', 'DOCUMENTATION', 'COMMUNICATION');

-- CreateEnum
CREATE TYPE "ServiceFrequency" AS ENUM ('DAILY', 'TWICE_DAILY', 'WEEKLY', 'AS_NEEDED');

-- CreateEnum
CREATE TYPE "SOPCategory" AS ENUM ('CLINICAL', 'OPERATIONAL', 'SAFETY', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "SOPStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "KpiCategory" AS ENUM ('CLINICAL', 'OPERATIONAL', 'FINANCIAL', 'QUALITY', 'STAFFING', 'SATISFACTION');

-- CreateEnum
CREATE TYPE "ObservationType" AS ENUM ('INTAKE', 'OUTPUT', 'SKIN_ASSESSMENT', 'MOOD_BEHAVIOR', 'PAIN_LEVEL', 'SLEEP', 'ACTIVITY', 'SOCIAL', 'COGNITIVE', 'VITALS_RECORDED', 'WEIGHT', 'MEDICATION_TAKEN', 'FALL_NEAR_MISS', 'REPOSITIONING');

-- CreateEnum
CREATE TYPE "QualityPeriodType" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "StaffingPlanStatus" AS ENUM ('PLANNED', 'CONFIRMED', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "OvertimeRisk" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'SEPARATED', 'PARTNER');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('ACTIVE', 'WITHDRAWN', 'PENDING', 'EXPIRED');

-- CreateEnum
CREATE TYPE "IADLLevel" AS ENUM ('INDEPENDENT', 'MINIMAL_ASSISTANCE', 'MODERATE_ASSISTANCE', 'MAXIMAL_ASSISTANCE', 'DEPENDENT');

-- CreateEnum
CREATE TYPE "InfectionRiskLevel" AS ENUM ('LOW', 'MODERATE', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CareDependencyLevel" AS ENUM ('INDEPENDENT', 'MINIMAL_ASSISTANCE', 'MODERATE_ASSISTANCE', 'MAXIMAL_ASSISTANCE', 'FULL_ASSISTANCE');

-- CreateEnum
CREATE TYPE "CarePlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'UNDER_REVIEW', 'COMPLETED', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "CarePlanReviewFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "EliminationType" AS ENUM ('URINATION', 'BOWEL_MOVEMENT', 'BOTH');

-- CreateEnum
CREATE TYPE "ContinenceStatus" AS ENUM ('CONTINENT', 'OCCASIONAL_INCONTINENCE', 'FREQUENT_INCONTINENCE', 'INCONTINENT', 'CATHETER', 'OSTOMY');

-- CreateEnum
CREATE TYPE "MobilityType" AS ENUM ('WALKING', 'WHEELCHAIR', 'TRANSFER', 'EXERCISE', 'BED_REST', 'STANDING');

-- CreateEnum
CREATE TYPE "PainScale" AS ENUM ('NONE', 'MILD', 'MODERATE', 'SEVERE', 'VERY_SEVERE', 'WORST_POSSIBLE');

-- CreateEnum
CREATE TYPE "SleepQuality" AS ENUM ('RESTFUL', 'FAIR', 'POOR', 'RESTLESS', 'INSOMNIA');

-- CreateEnum
CREATE TYPE "WoundStage" AS ENUM ('EPISODE', 'HEALING', 'HEALED', 'DETERIORATED');

-- CreateEnum
CREATE TYPE "MARStatus" AS ENUM ('GIVEN', 'REFUSED', 'HELD', 'MISSED', 'PARTIAL', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('REQUESTED', 'APPROVED', 'SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('PENDING', 'SCHEDULED', 'COMPLETED', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('RESIDENT', 'MEDICATION', 'CLINICAL', 'COMPLIANCE', 'MANAGEMENT', 'AUDIT', 'FINANCIAL', 'STAFF_PERFORMANCE');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('TABLE', 'CHART', 'SUMMARY', 'DETAILED');

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'RESERVED');

-- CreateEnum
CREATE TYPE "RoomType" AS ENUM ('PRIVATE', 'SEMI_PRIVATE', 'WARD', 'SUITE');

-- CreateEnum
CREATE TYPE "InventoryCategory" AS ENUM ('MEDICAL_SUPPLIES', 'PERSONAL_CARE', 'LINEN', 'FOOD', 'CLEANING', 'OFFICE', 'FURNITURE', 'EQUIPMENT', 'PPE', 'OTHER');

-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('REQUESTED', 'APPROVED', 'ORDERED', 'RECEIVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PhysicianContactMethod" AS ENUM ('PHONE', 'IN_PERSON', 'WRITTEN', 'TELEMEDICINE');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('SHUTTLE', 'WHEELCHAIR_VAN', 'AMBULANCE', 'SEDAN');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('AVAILABLE', 'ON_TRIP', 'MAINTENANCE', 'OUT_OF_SERVICE');

-- CreateEnum
CREATE TYPE "TransportRequestType" AS ENUM ('MEDICAL_APPOINTMENT', 'DIALYSIS', 'THERAPY', 'FAMILY_OUTING', 'EMERGENCY_TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "TransportRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'SCHEDULED', 'DECLINED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransportPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('SCHEDULED', 'INSPECTION', 'EN_ROUTE', 'ARRIVED', 'RETURNING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('PREVENTIVE', 'REPAIR', 'INSPECTION');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('SCHEDULED', 'OPEN', 'IN_PROGRESS', 'AWAITING_PARTS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ServiceRequestCategory" AS ENUM ('AIRCON_HVAC', 'HOUSEKEEPING', 'ROOM_SERVICE', 'LAUNDRY', 'REPAIRS');

-- CreateEnum
CREATE TYPE "ServiceRequestPriority" AS ENUM ('ROUTINE', 'URGENT', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "ServiceRequestStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ServiceTeam" AS ENUM ('HOUSEKEEPING_TEAM', 'MAINTENANCE_ENGINEER', 'KITCHEN', 'IT_SUPPORT', 'CONCIERGE');

-- CreateEnum
CREATE TYPE "FacilitySystem" AS ENUM ('HVAC', 'GENERATOR', 'ELEVATOR', 'FIRE_SAFETY', 'PEST_CONTROL', 'OTHER');

-- CreateEnum
CREATE TYPE "MaintenanceFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL');

-- CreateEnum
CREATE TYPE "ConciergeCategory" AS ENUM ('CONCIERGE_DESK', 'WAKE_UP_CALL', 'TURNDOWN', 'SALON_BARBER', 'CAFE_BISTRO', 'MOVIE_GAME_NIGHT', 'GARDEN_LOUNGE', 'GUEST_SUITE', 'SPA_MASSAGE', 'CHAPLAIN');

-- CreateEnum
CREATE TYPE "ConciergeBookingStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('MAKE_READY', 'INSPECTION', 'READY', 'OCCUPIED', 'TURNOVER', 'MOVE_OUT', 'DEEP_CLEAN');

-- CreateEnum
CREATE TYPE "FrontDeskVisitType" AS ENUM ('GUEST_VISIT', 'NEW_RESIDENT_ARRIVAL', 'TOUR', 'CONTRACTOR', 'DELIVERY');

-- CreateEnum
CREATE TYPE "FrontDeskStatus" AS ENUM ('ARRIVED', 'CHECKED_IN', 'CHECKED_OUT');

-- CreateEnum
CREATE TYPE "EventCategory" AS ENUM ('SOCIAL', 'WELLNESS', 'RECREATION', 'SPIRITUAL', 'EDUCATIONAL', 'DINING', 'OUTING');

-- CreateEnum
CREATE TYPE "RSVPStatus" AS ENUM ('INVITED', 'GOING', 'DECLINED', 'ATTENDED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "DiningReservationStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('ALL', 'RESIDENTS', 'FAMILIES', 'STAFF');

-- CreateEnum
CREATE TYPE "EscalationPriority" AS ENUM ('ROUTINE', 'URGENT', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "EscalationStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'ESCALATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Shift" AS ENUM ('DAY', 'EVENING', 'NIGHT');

-- CreateEnum
CREATE TYPE "DailyRoundStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'REVIEWED');

-- CreateEnum
CREATE TYPE "EdemaSeverity" AS ENUM ('NONE', 'TRACE', 'MILD', 'MODERATE', 'SEVERE', 'DEEP');

-- CreateEnum
CREATE TYPE "MoodState" AS ENUM ('CALM', 'HAPPY', 'SAD', 'ANXIOUS', 'AGITATED', 'CONFUSED', 'AGGRESSIVE', 'WITHDRAWN', 'COOPERATIVE', 'APATHETIC');

-- CreateEnum
CREATE TYPE "ConcernCategory" AS ENUM ('PHYSICAL', 'BEHAVIORAL', 'SKIN', 'NUTRITION', 'HYDRATION', 'MOBILITY', 'PAIN', 'SLEEP', 'MEDICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ConcernSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "MealType" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACK');

-- CreateEnum
CREATE TYPE "AppetiteLevel" AS ENUM ('GOOD', 'FAIR', 'POOR', 'REFUSED', 'NPO');

-- CreateEnum
CREATE TYPE "AssistanceLevel" AS ENUM ('INDEPENDENT', 'SUPERVISED', 'MINIMAL', 'MODERATE', 'MAXIMAL', 'DEPENDENT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "authUserId" TEXT,
    "role" "Role" NOT NULL DEFAULT 'FAMILY',
    "platformRole" "PlatformRole",
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "pinHash" TEXT,
    "name" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resident" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "gender" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "roomNumber" TEXT NOT NULL,
    "careLevel" "CareLevel" NOT NULL,
    "status" "ResidentStatus" NOT NULL DEFAULT 'ACTIVE',
    "admissionDate" TIMESTAMP(3) NOT NULL,
    "emergencyContact" TEXT,
    "emergencyContactPhone" TEXT,
    "medicalHistory" TEXT,
    "allergies" TEXT,
    "notes" TEXT,
    "sponsorId" TEXT,
    "userId" TEXT,
    "communityId" TEXT,
    "organizationId" TEXT,
    "buildingId" TEXT,
    "unitId" TEXT,
    "currentCarePackageId" TEXT,
    "currentAcuityScoreId" TEXT,
    "currentAcuityLevel" "AcuityLevel",
    "lastAssessmentDate" TIMESTAMP(3),
    "nextAssessmentDue" TIMESTAMP(3),
    "nationality" TEXT,
    "religion" TEXT,
    "maritalStatus" "MaritalStatus",
    "language" TEXT,
    "diagnosis" TEXT,
    "surgeries" TEXT,
    "hospitalizations" TEXT,
    "causeOfDeath" TEXT,
    "deathDate" TIMESTAMP(3),
    "isDeceased" BOOLEAN NOT NULL DEFAULT false,
    "photoUrl" TEXT,
    "advanceDirectives" TEXT,
    "dnrStatus" BOOLEAN NOT NULL DEFAULT false,
    "livingWill" TEXT,
    "healthcareProxy" TEXT,
    "healthcareProxyPhone" TEXT,
    "codeStatus" TEXT DEFAULT 'FULL_CODE',
    "careDependencyLevel" "CareDependencyLevel",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "department" TEXT,
    "hireDate" TIMESTAMP(3) NOT NULL,
    "license" TEXT,
    "licenseExpiry" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "avatarUrl" TEXT,
    "experience" TEXT,
    "documents" JSONB,
    "communityId" TEXT,
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VitalsLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "type" "VitalType" NOT NULL,
    "value" TEXT NOT NULL,
    "unit" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "recordedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VitalsLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "incidentType" "IncidentType" NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "title" TEXT,
    "description" TEXT NOT NULL,
    "location" TEXT,
    "reportedById" TEXT,
    "witnesses" TEXT,
    "immediateActions" TEXT,
    "photoUrl" TEXT,
    "reviewNotes" TEXT,
    "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
    "followUpNotes" TEXT,
    "incidentDate" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Medication" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "route" TEXT NOT NULL DEFAULT 'oral',
    "status" "MedicationStatus" NOT NULL DEFAULT 'ACTIVE',
    "submittedById" TEXT,
    "submittedByName" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "prescribedBy" TEXT,
    "reason" TEXT,
    "sideEffects" TEXT,
    "contraindications" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Medication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResidentGoal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "goalDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResidentGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "medicationId" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "marStatus" "MARStatus" NOT NULL DEFAULT 'GIVEN',
    "dosage" TEXT,
    "route" TEXT,
    "refusedReason" TEXT,
    "heldReason" TEXT,
    "witnessId" TEXT,
    "witnessName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "residentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "assignedToId" TEXT,
    "createdById" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "communityId" TEXT,
    "unitId" TEXT,
    "serviceCatalogId" TEXT,
    "sopId" TEXT,
    "recurringPattern" JSONB,
    "generatedFrom" TEXT,
    "documentationRequired" TEXT,
    "observationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "subject" TEXT,
    "content" TEXT NOT NULL,
    "messageType" "MessageType" NOT NULL DEFAULT 'GENERAL',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeTracking" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "staffId" TEXT NOT NULL,
    "shiftType" "ShiftType" NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "breakDuration" INTEGER,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeTracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "noteType" TEXT,
    "authorName" TEXT,
    "isConfidential" BOOLEAN NOT NULL DEFAULT false,
    "coSignedBy" TEXT,
    "coSignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallBell" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "status" "CallBellStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "respondedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallBell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "staffId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shiftType" "ShiftType" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "summary" TEXT,
    "residentUpdates" TEXT,
    "incidentsOccurred" BOOLEAN NOT NULL DEFAULT false,
    "incidentDetails" TEXT,
    "medicationsAdministered" TEXT,
    "taskCompleted" TEXT,
    "handoverNotes" TEXT,
    "signedAt" TIMESTAMP(3),
    "aiSummary" TEXT,
    "acknowledgedById" TEXT,
    "acknowledgedByName" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "relatedEntityId" TEXT,
    "relatedEntityType" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "severity" TEXT DEFAULT 'INFO',
    "snoozedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "visitorName" TEXT NOT NULL,
    "visitorPhone" TEXT,
    "relationship" TEXT,
    "checkInTime" TIMESTAMP(3) NOT NULL,
    "checkOutTime" TIMESTAMP(3),
    "purpose" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "billingPeriodStart" TIMESTAMP(3) NOT NULL,
    "billingPeriodEnd" TIMESTAMP(3) NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "notes" TEXT,
    "sentAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResidentNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "category" TEXT,
    "authorName" TEXT,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResidentNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDoc" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'unknown',
    "size" INTEGER NOT NULL DEFAULT 0,
    "chars" INTEGER NOT NULL DEFAULT 0,
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'client',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT '',
    "value" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "roomNumber" TEXT NOT NULL,
    "floor" INTEGER,
    "wing" TEXT,
    "roomType" "RoomType" NOT NULL DEFAULT 'SEMI_PRIVATE',
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "status" "RoomStatus" NOT NULL DEFAULT 'AVAILABLE',
    "housekeepingStatus" "UnitStatus" NOT NULL DEFAULT 'READY',
    "features" TEXT,
    "rateMonthly" DOUBLE PRECISION,
    "notes" TEXT,
    "communityId" TEXT,
    "buildingId" TEXT,
    "floorId" TEXT,
    "unitId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "slug" TEXT,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "taxId" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "emailFromName" TEXT,
    "branding" JSONB,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Community" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "communityType" "CommunityType" NOT NULL DEFAULT 'ASSISTED_LIVING',
    "licenseNumber" TEXT,
    "licenseExpiry" TIMESTAMP(3),
    "bedsTotal" INTEGER,
    "bedsAvailable" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "configuration" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Community_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "OrganizationRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResidentAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "accessRole" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResidentAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "communityId" TEXT,
    "organizationRole" "OrganizationRole",
    "communityRole" "Role",
    "residentId" TEXT,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "maxCommunities" INTEGER,
    "maxActiveResidents" INTEGER,
    "maxStaffSeats" INTEGER,
    "maxStorageBytes" BIGINT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanEntitlement" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "limit" INTEGER,
    "config" JSONB,

    CONSTRAINT "PlanEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "overrides" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "communityId" TEXT,
    "metric" "UsageMetric" NOT NULL,
    "value" BIGINT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Building" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "floorsCount" INTEGER NOT NULL DEFAULT 1,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Building_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Floor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "buildingId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "floorNumber" INTEGER NOT NULL,
    "name" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Floor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "floorId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitType" "CommunityUnitType" NOT NULL DEFAULT 'ASSISTED_LIVING',
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "staffingRatio" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "residentId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "assessmentType" "AssessmentType" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "adlScore" INTEGER NOT NULL,
    "cognitionScore" INTEGER NOT NULL,
    "mobilityScore" INTEGER NOT NULL,
    "medicalScore" INTEGER NOT NULL,
    "behavioralScore" INTEGER NOT NULL,
    "nutritionScore" INTEGER NOT NULL,
    "hydrationScore" INTEGER NOT NULL,
    "skinIntegrityScore" INTEGER NOT NULL,
    "socialEngagementScore" INTEGER NOT NULL,
    "totalRawScore" INTEGER NOT NULL,
    "dimensionCount" INTEGER NOT NULL DEFAULT 9,
    "maxPossibleScore" INTEGER NOT NULL,
    "assessedById" TEXT,
    "assessedByName" TEXT NOT NULL,
    "assessmentTool" TEXT,
    "notes" TEXT,
    "attachments" JSONB,
    "isReassessment" BOOLEAN NOT NULL DEFAULT false,
    "previousAssessmentId" TEXT,
    "reassessmentReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcuityScore" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "assessmentId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "dimensionScores" JSONB NOT NULL,
    "weightedScore" DOUBLE PRECISION NOT NULL,
    "normalizedScore" DOUBLE PRECISION NOT NULL,
    "acuityLevel" "AcuityLevel" NOT NULL,
    "careLevel" "CareLevel" NOT NULL,
    "careLevelConfidence" DOUBLE PRECISION,
    "dailyCareMinutes" INTEGER NOT NULL,
    "shiftBreakdown" JSONB NOT NULL,
    "staffingDemand" JSONB NOT NULL,
    "weightsUsed" JSONB NOT NULL,
    "weightVersion" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scoredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcuityScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCatalog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ServiceCategory" NOT NULL,
    "description" TEXT,
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 15,
    "requiredCompetencies" JSONB,
    "suppliesNeeded" JSONB,
    "sopId" TEXT,
    "documentationRequired" TEXT,
    "documentationTemplate" TEXT,
    "qualityIndicator" TEXT,
    "monitoringFrequency" TEXT,
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "baseRate" DOUBLE PRECISION,
    "billingCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarePackage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "careLevel" "CareLevel" NOT NULL,
    "description" TEXT,
    "baseMonthlyRate" DOUBLE PRECISION,
    "serviceCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarePackageItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "carePackageId" TEXT NOT NULL,
    "serviceCatalogId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "frequency" "ServiceFrequency" NOT NULL DEFAULT 'DAILY',
    "shifts" JSONB,
    "customMinutes" INTEGER,
    "customRate" DOUBLE PRECISION,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarePackageItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunitySop" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "SOPCategory" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "SOPStatus" NOT NULL DEFAULT 'DRAFT',
    "procedureText" TEXT NOT NULL,
    "checklistItems" JSONB,
    "escalationPathway" JSONB,
    "competencyRequired" JSONB,
    "effectiveDate" TIMESTAMP(3),
    "reviewDate" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "attachments" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunitySop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competency" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "validityMonths" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffCompetency" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "staffId" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "trainingHours" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffCompetency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResidentQualityScore" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "residentId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "periodType" "QualityPeriodType" NOT NULL,
    "careCompletionScore" DOUBLE PRECISION,
    "medicationComplianceScore" DOUBLE PRECISION,
    "nutritionScore" DOUBLE PRECISION,
    "hydrationScore" DOUBLE PRECISION,
    "mobilityScore" DOUBLE PRECISION,
    "engagementScore" DOUBLE PRECISION,
    "riskManagementScore" DOUBLE PRECISION,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "acuityAdjusted" DOUBLE PRECISION,
    "tasksScheduled" INTEGER NOT NULL DEFAULT 0,
    "tasksCompleted" INTEGER NOT NULL DEFAULT 0,
    "medsScheduled" INTEGER NOT NULL DEFAULT 0,
    "medsTaken" INTEGER NOT NULL DEFAULT 0,
    "incidentsCount" INTEGER NOT NULL DEFAULT 0,
    "observationsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResidentQualityScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityQualityDashboard" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "documentationCompletionRate" DOUBLE PRECISION,
    "lateEntryRate" DOUBLE PRECISION,
    "carePlanReviewCompliance" DOUBLE PRECISION,
    "incidentClosureRate" DOUBLE PRECISION,
    "incidentRate" DOUBLE PRECISION,
    "fallRate" DOUBLE PRECISION,
    "medicationErrorRate" DOUBLE PRECISION,
    "staffingUtilization" DOUBLE PRECISION,
    "overtimeRate" DOUBLE PRECISION,
    "competencyCompliance" DOUBLE PRECISION,
    "averageResidentQualityScore" DOUBLE PRECISION,
    "weightLossRate" DOUBLE PRECISION,
    "pressureInjuryRate" DOUBLE PRECISION,
    "taskCompletionRate" DOUBLE PRECISION,
    "callBellResponseTime" DOUBLE PRECISION,
    "occupancyRate" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityQualityDashboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT NOT NULL,
    "category" "KpiCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "target" DOUBLE PRECISION,
    "delta" DOUBLE PRECISION,
    "deltaDirection" TEXT,
    "period" TEXT NOT NULL DEFAULT 'MONTHLY',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "trend" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "sessionId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "residentId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "observationType" "ObservationType" NOT NULL,
    "category" TEXT,
    "value" TEXT NOT NULL,
    "numericValue" DOUBLE PRECISION,
    "unit" TEXT,
    "severity" TEXT,
    "notes" TEXT,
    "observedById" TEXT,
    "observedByName" TEXT,
    "taskLink" TEXT,
    "medicationLogLink" TEXT,
    "vitalsLogLink" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffingPlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT NOT NULL,
    "unitId" TEXT,
    "planDate" TIMESTAMP(3) NOT NULL,
    "shiftType" "ShiftType" NOT NULL,
    "totalCareMinutes" INTEGER NOT NULL DEFAULT 0,
    "requiredFTE" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "requiredStaff" INTEGER NOT NULL DEFAULT 0,
    "scheduledStaff" INTEGER NOT NULL DEFAULT 0,
    "scheduledHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "availableStaff" INTEGER NOT NULL DEFAULT 0,
    "coverageGap" INTEGER NOT NULL DEFAULT 0,
    "coverageRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overtimeRisk" "OvertimeRisk" NOT NULL DEFAULT 'NONE',
    "assignments" JSONB,
    "status" "StaffingPlanStatus" NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vaccination" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "vaccineName" TEXT NOT NULL,
    "vaccineType" TEXT,
    "manufacturer" TEXT,
    "lotNumber" TEXT,
    "doseNumber" INTEGER,
    "totalDoses" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "scheduledDate" TIMESTAMP(3),
    "dateGiven" TIMESTAMP(3),
    "site" TEXT,
    "administeredBy" TEXT,
    "expirationDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vaccination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResidentDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileName" TEXT,
    "fileUrl" TEXT,
    "fileContent" TEXT,
    "uploadedById" TEXT,
    "uploadedByName" TEXT,
    "isConfidential" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResidentDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EliminationLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "type" "EliminationType" NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "continenceStatus" "ContinenceStatus" NOT NULL DEFAULT 'CONTINENT',
    "volume" TEXT,
    "consistency" TEXT,
    "color" TEXT,
    "odor" TEXT,
    "assistanceNeeded" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "observedById" TEXT,
    "observedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EliminationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PainAssessment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "painScale" "PainScale" NOT NULL,
    "numericScore" INTEGER,
    "location" TEXT,
    "type" TEXT,
    "duration" TEXT,
    "triggers" TEXT,
    "reliefActions" TEXT,
    "medicationGiven" TEXT,
    "medicationResponse" TEXT,
    "notes" TEXT,
    "assessedById" TEXT,
    "assessedByName" TEXT,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PainAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WoundCare" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "woundType" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "stage" "WoundStage" NOT NULL DEFAULT 'EPISODE',
    "sizeLength" DOUBLE PRECISION,
    "sizeWidth" DOUBLE PRECISION,
    "sizeDepth" DOUBLE PRECISION,
    "woundBed" TEXT,
    "exudateType" TEXT,
    "exudateAmount" TEXT,
    "surroundingSkin" TEXT,
    "odor" BOOLEAN NOT NULL DEFAULT false,
    "painLevel" INTEGER,
    "treatment" TEXT,
    "dressingType" TEXT,
    "dressingChangeFrequency" TEXT,
    "photoUrl" TEXT,
    "healedDate" TIMESTAMP(3),
    "assessedById" TEXT,
    "assessedByName" TEXT,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WoundCare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SleepLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "bedtime" TIMESTAMP(3) NOT NULL,
    "wakeTime" TIMESTAMP(3),
    "totalHours" DOUBLE PRECISION,
    "quality" "SleepQuality" NOT NULL DEFAULT 'FAIR',
    "interruptions" INTEGER DEFAULT 0,
    "interruptionReason" TEXT,
    "medicationUsed" TEXT,
    "notes" TEXT,
    "observedById" TEXT,
    "observedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SleepLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobilityLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "type" "MobilityType" NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "duration" INTEGER,
    "distance" TEXT,
    "assistanceLevel" TEXT,
    "assistiveDevice" TEXT,
    "fallOccurred" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "observedById" TEXT,
    "observedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobilityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarePlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "CarePlanStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3) NOT NULL,
    "reviewDate" TIMESTAMP(3),
    "reviewFrequency" "CarePlanReviewFrequency" NOT NULL DEFAULT 'MONTHLY',
    "nextReviewDate" TIMESTAMP(3),
    "careGoals" TEXT,
    "interventions" TEXT,
    "responsibleRoles" TEXT,
    "assignedStaff" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "discontinuedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarePlanItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "carePlanId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "targetDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "completedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarePlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarePlanReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "carePlanId" TEXT NOT NULL,
    "reviewDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewerName" TEXT NOT NULL,
    "reviewerRole" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "changesMade" TEXT,
    "nextReviewDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarePlanReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HospitalReferral" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "facilityName" TEXT NOT NULL,
    "facilityAddress" TEXT,
    "facilityPhone" TEXT,
    "reason" TEXT NOT NULL,
    "urgency" TEXT NOT NULL DEFAULT 'ROUTINE',
    "status" "ReferralStatus" NOT NULL DEFAULT 'REQUESTED',
    "referredById" TEXT,
    "referredByName" TEXT,
    "referredByRole" TEXT,
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "scheduledDate" TIMESTAMP(3),
    "transportArranged" BOOLEAN NOT NULL DEFAULT false,
    "transportRequestId" TEXT,
    "outcome" TEXT,
    "rejectionReason" TEXT,
    "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HospitalReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" "FollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "completedDate" TIMESTAMP(3),
    "assignedToId" TEXT,
    "assignedToName" TEXT,
    "assignedToRole" TEXT,
    "outcome" TEXT,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareTimelineEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" TEXT,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "entryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enteredById" TEXT,
    "enteredByName" TEXT,
    "isImportant" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareTimelineEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "reportType" "ReportType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "format" "ReportFormat" NOT NULL DEFAULT 'TABLE',
    "parameters" JSONB,
    "data" JSONB NOT NULL,
    "summary" TEXT,
    "communityId" TEXT,
    "generatedById" TEXT,
    "generatedByName" TEXT,
    "isScheduled" BOOLEAN NOT NULL DEFAULT false,
    "scheduleCron" TEXT,
    "lastGenerated" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryAlert" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "inventoryItemId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "currentQuantity" INTEGER NOT NULL,
    "minimumStock" INTEGER NOT NULL,
    "alertType" TEXT NOT NULL DEFAULT 'LOW_STOCK',
    "message" TEXT NOT NULL,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationAdministration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "medicationId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "status" "MARStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledTime" TIMESTAMP(3) NOT NULL,
    "actualTime" TIMESTAMP(3),
    "dosage" TEXT,
    "route" TEXT,
    "reasonForRefusal" TEXT,
    "heldReason" TEXT,
    "witnessId" TEXT,
    "witnessName" TEXT,
    "notes" TEXT,
    "recordedById" TEXT,
    "recordedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicationAdministration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationChangeLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "medicationId" TEXT NOT NULL,
    "changeType" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT,
    "changedById" TEXT,
    "changedByName" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicationChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "itemName" TEXT NOT NULL,
    "category" "InventoryCategory" NOT NULL DEFAULT 'OTHER',
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "minimumStock" INTEGER NOT NULL DEFAULT 5,
    "location" TEXT,
    "supplier" TEXT,
    "batchNumber" TEXT,
    "expiryDate" TIMESTAMP(3),
    "unitCost" DOUBLE PRECISION,
    "reorderPoint" INTEGER,
    "lastRestocked" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admission" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "gender" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "emergencyContact" TEXT,
    "emergencyContactPhone" TEXT,
    "medicalAssessment" TEXT,
    "allergies" TEXT,
    "medicalHistory" TEXT,
    "careAssessment" TEXT,
    "careLevel" "CareLevel",
    "mobility" TEXT,
    "insuranceProvider" TEXT,
    "insurancePolicyNumber" TEXT,
    "insuranceVerified" BOOLEAN NOT NULL DEFAULT false,
    "insuranceVerifiedAt" TIMESTAMP(3),
    "roomNumber" TEXT,
    "qrPayload" TEXT,
    "careTeam" TEXT,
    "carePlan" TEXT,
    "carePlanGoals" TEXT,
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "completedSteps" TEXT NOT NULL DEFAULT '[]',
    "status" "AdmissionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "sponsorName" TEXT,
    "sponsorEmail" TEXT,
    "sponsorId" TEXT,
    "residentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Admission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "inventoryItemId" TEXT,
    "itemName" TEXT NOT NULL,
    "category" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT,
    "estimatedUnitCost" DOUBLE PRECISION,
    "supplier" TEXT,
    "reason" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT,
    "requestedByName" TEXT,
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "orderedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "receivedQuantity" INTEGER,
    "rejectionReason" TEXT,
    "autoGenerated" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhysicianCommunication" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "method" "PhysicianContactMethod" NOT NULL DEFAULT 'PHONE',
    "physicianName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "instructionsReceived" TEXT NOT NULL,
    "loggedById" TEXT,
    "loggedByName" TEXT,
    "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
    "followUpDeadline" TIMESTAMP(3),
    "followUpCompletedAt" TIMESTAMP(3),
    "relatedEscalationId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhysicianCommunication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCharge" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "serviceDate" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Care Services',
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceValidation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "groupNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "coverageDetails" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InsuranceValidation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "invoiceId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentMethod" TEXT NOT NULL,
    "transactionId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogPost" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "content" TEXT,
    "imageUrl" TEXT,
    "author" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteContent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "name" TEXT NOT NULL,
    "licensePlate" TEXT NOT NULL,
    "type" "VehicleType" NOT NULL DEFAULT 'SHUTTLE',
    "status" "VehicleStatus" NOT NULL DEFAULT 'AVAILABLE',
    "make" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "vin" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 4,
    "wheelchairCapacity" INTEGER NOT NULL DEFAULT 0,
    "odometer" INTEGER NOT NULL DEFAULT 0,
    "fuelLevel" INTEGER NOT NULL DEFAULT 100,
    "insuranceProvider" TEXT,
    "insurancePolicyNumber" TEXT,
    "insuranceExpiry" TIMESTAMP(3),
    "registrationExpiry" TIMESTAMP(3),
    "lastServiceDate" TIMESTAMP(3),
    "nextServiceDate" TIMESTAMP(3),
    "nextServiceOdometer" INTEGER,
    "gpsDeviceId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "licenseNumber" TEXT NOT NULL,
    "licenseClass" TEXT,
    "licenseExpiry" TIMESTAMP(3),
    "certifications" TEXT,
    "certificationExpiry" TIMESTAMP(3),
    "safetyScore" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "tripHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "avatarUrl" TEXT,
    "hireDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "type" "TransportRequestType" NOT NULL DEFAULT 'MEDICAL_APPOINTMENT',
    "pickupLocation" TEXT,
    "dropoffLocation" TEXT,
    "destination" TEXT NOT NULL,
    "purpose" TEXT,
    "requestedDate" TIMESTAMP(3) NOT NULL,
    "returnRequired" BOOLEAN NOT NULL DEFAULT true,
    "wheelchairNeeded" BOOLEAN NOT NULL DEFAULT false,
    "escortRequired" BOOLEAN NOT NULL DEFAULT false,
    "escortRole" TEXT,
    "priority" "TransportPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "TransportRequestStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL DEFAULT 'PORTAL',
    "notes" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "requestId" TEXT,
    "residentId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "driverId" TEXT,
    "escortName" TEXT,
    "escortRole" TEXT,
    "status" "TripStatus" NOT NULL DEFAULT 'SCHEDULED',
    "pickupLocation" TEXT,
    "dropoffLocation" TEXT,
    "destination" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'Golden Hearth Facility',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "departedAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "returnDepartedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "distanceKm" DOUBLE PRECISION,
    "currentLat" DOUBLE PRECISION,
    "currentLng" DOUBLE PRECISION,
    "lastPingAt" TIMESTAMP(3),
    "inspectionDone" BOOLEAN NOT NULL DEFAULT false,
    "inspectionChecklist" TEXT,
    "familyNotified" BOOLEAN NOT NULL DEFAULT false,
    "billed" BOOLEAN NOT NULL DEFAULT false,
    "charge" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleMaintenance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "vehicleId" TEXT NOT NULL,
    "type" "MaintenanceType" NOT NULL DEFAULT 'PREVENTIVE',
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'SCHEDULED',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scheduledDate" TIMESTAMP(3),
    "completedDate" TIMESTAMP(3),
    "odometerAt" INTEGER,
    "cost" DOUBLE PRECISION,
    "vendor" TEXT,
    "downtimeHours" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleMaintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FuelLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "vehicleId" TEXT NOT NULL,
    "driverId" TEXT,
    "logDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "odometer" INTEGER NOT NULL,
    "liters" DOUBLE PRECISION NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL,
    "fuelType" TEXT NOT NULL DEFAULT 'Diesel',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FuelLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomPage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "pagePurpose" TEXT DEFAULT 'informational',
    "parcelType" TEXT DEFAULT 'standard',
    "published" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyMenu" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "mealType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "dietaryTags" TEXT,
    "imageUrl" TEXT,
    "menuDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyMenu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DietitianConsult" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "dietitianName" TEXT NOT NULL,
    "consultDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "recommendations" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DietitianConsult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodComplianceLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "auditedBy" TEXT NOT NULL,
    "auditDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "details" TEXT,
    "checklistJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoodComplianceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "roomNumber" TEXT,
    "category" "ServiceRequestCategory" NOT NULL DEFAULT 'HOUSEKEEPING',
    "subType" TEXT,
    "details" TEXT,
    "source" TEXT NOT NULL DEFAULT 'RESIDENT_PORTAL',
    "priority" "ServiceRequestPriority" NOT NULL DEFAULT 'ROUTINE',
    "status" "ServiceRequestStatus" NOT NULL DEFAULT 'OPEN',
    "assignedTeam" "ServiceTeam",
    "assignedTo" TEXT,
    "photoProofUrl" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "rating" INTEGER,
    "ratingComment" TEXT,
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "charge" DOUBLE PRECISION,
    "billed" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityMaintenance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "title" TEXT NOT NULL,
    "system" "FacilitySystem" NOT NULL DEFAULT 'OTHER',
    "type" "MaintenanceType" NOT NULL DEFAULT 'PREVENTIVE',
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'SCHEDULED',
    "frequency" "MaintenanceFrequency" NOT NULL DEFAULT 'QUARTERLY',
    "location" TEXT,
    "description" TEXT,
    "scheduledDate" TIMESTAMP(3),
    "completedDate" TIMESTAMP(3),
    "nextDueDate" TIMESTAMP(3),
    "assignedTo" TEXT,
    "vendor" TEXT,
    "cost" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacilityMaintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConciergeBooking" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "category" "ConciergeCategory" NOT NULL DEFAULT 'CONCIERGE_DESK',
    "serviceName" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "ConciergeBookingStatus" NOT NULL DEFAULT 'REQUESTED',
    "staffName" TEXT,
    "location" TEXT,
    "price" DOUBLE PRECISION,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "billed" BOOLEAN NOT NULL DEFAULT false,
    "rating" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConciergeBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FrontDeskVisit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "visitType" "FrontDeskVisitType" NOT NULL DEFAULT 'GUEST_VISIT',
    "status" "FrontDeskStatus" NOT NULL DEFAULT 'ARRIVED',
    "visitorName" TEXT NOT NULL,
    "visitorPhone" TEXT,
    "idType" TEXT,
    "idNumber" TEXT,
    "visitorPass" TEXT,
    "residentId" TEXT,
    "roomNumber" TEXT,
    "purpose" TEXT,
    "arrivalTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkInTime" TIMESTAMP(3),
    "checkOutTime" TIMESTAMP(3),
    "ancillaryItems" TEXT,
    "ancillaryTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "receiptNumber" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrontDeskVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomTurnover" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "roomNumber" TEXT NOT NULL,
    "stage" "UnitStatus" NOT NULL DEFAULT 'MOVE_OUT',
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "outgoingResident" TEXT,
    "incomingResident" TEXT,
    "assignedTo" TEXT,
    "inspectionPassed" BOOLEAN NOT NULL DEFAULT false,
    "checklist" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomTurnover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResidentPreference" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "preference" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResidentPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "title" TEXT NOT NULL,
    "category" "EventCategory" NOT NULL DEFAULT 'SOCIAL',
    "description" TEXT,
    "location" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "capacity" INTEGER,
    "host" TEXT,
    "imageUrl" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventAttendance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "eventId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "status" "RSVPStatus" NOT NULL DEFAULT 'GOING',
    "checkedInAt" TIMESTAMP(3),
    "rating" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiningReservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "mealType" TEXT NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL,
    "partySize" INTEGER NOT NULL DEFAULT 1,
    "venue" TEXT,
    "status" "DiningReservationStatus" NOT NULL DEFAULT 'REQUESTED',
    "guestNames" TEXT,
    "specialRequests" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiningReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" "AnnouncementAudience" NOT NULL DEFAULT 'ALL',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "authorName" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "autoNotify" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CameraMonitoringLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT,
    "residentName" TEXT,
    "roomNumber" TEXT,
    "logType" TEXT NOT NULL DEFAULT 'ANALYSIS',
    "emotion" TEXT,
    "emotionConfidence" DOUBLE PRECISION,
    "behavior" TEXT,
    "posture" TEXT,
    "sleepState" TEXT,
    "confused" BOOLEAN NOT NULL DEFAULT false,
    "alert" BOOLEAN NOT NULL DEFAULT false,
    "alertReason" TEXT,
    "summary" TEXT,
    "objects" JSONB,
    "heartRate" DOUBLE PRECISION,
    "bloodPressureSys" INTEGER,
    "bloodPressureDia" INTEGER,
    "respirationRate" INTEGER,
    "temperature" DOUBLE PRECISION,
    "oxygen" DOUBLE PRECISION,
    "snapshotUrl" TEXT,
    "cameraId" TEXT,
    "sessionStart" TIMESTAMP(3),
    "sessionEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CameraMonitoringLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Escalation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "situation" TEXT NOT NULL,
    "background" TEXT,
    "assessment" TEXT,
    "recommendation" TEXT,
    "priority" "EscalationPriority" NOT NULL DEFAULT 'URGENT',
    "status" "EscalationStatus" NOT NULL DEFAULT 'OPEN',
    "raisedBy" TEXT NOT NULL,
    "raisedByRole" TEXT NOT NULL,
    "assignedToRole" TEXT NOT NULL DEFAULT 'PHYSICIAN',
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "response" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "relatedIncidentId" TEXT,
    "relatedVitalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Escalation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyRound" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT NOT NULL,
    "caregiverId" TEXT,
    "caregiverName" TEXT,
    "shift" "Shift" NOT NULL,
    "roundDate" DATE NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endTime" TIMESTAMP(3),
    "status" "DailyRoundStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "generalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BowelRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "dailyRoundId" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "bristolType" INTEGER,
    "consistency" TEXT,
    "color" TEXT,
    "amount" TEXT,
    "hasMucus" BOOLEAN NOT NULL DEFAULT false,
    "hasBlood" BOOLEAN NOT NULL DEFAULT false,
    "odor" TEXT,
    "containment" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BowelRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UrineRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "dailyRoundId" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "color" TEXT,
    "clarity" TEXT,
    "volume" TEXT,
    "estimatedMl" INTEGER,
    "hasBlood" BOOLEAN NOT NULL DEFAULT false,
    "odor" TEXT,
    "urgency" TEXT,
    "containment" TEXT,
    "outputMl" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UrineRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EdemaRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "dailyRoundId" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "location" TEXT NOT NULL,
    "severity" "EdemaSeverity" NOT NULL,
    "pitting" BOOLEAN NOT NULL DEFAULT false,
    "skinColor" TEXT,
    "skinTemperature" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EdemaRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConcernRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "dailyRoundId" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "category" "ConcernCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "ConcernSeverity" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "actionTaken" TEXT,
    "escalatedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConcernRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PainRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "dailyRoundId" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "location" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "type" TEXT,
    "duration" TEXT,
    "triggers" TEXT,
    "reliefActions" TEXT,
    "medicationGiven" TEXT,
    "medicationResponse" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PainRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoodRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "dailyRoundId" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "mood" "MoodState" NOT NULL,
    "behaviorNotes" TEXT,
    "socialEngagement" TEXT,
    "cooperation" TEXT,
    "communication" TEXT,
    "triggers" TEXT,
    "interventions" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoodRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SleepRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "dailyRoundId" TEXT NOT NULL,
    "bedtime" TIMESTAMP(3),
    "wakeTime" TIMESTAMP(3),
    "totalHours" DOUBLE PRECISION,
    "quality" "SleepQuality" NOT NULL,
    "interruptions" INTEGER NOT NULL DEFAULT 0,
    "interruptionReason" TEXT,
    "naps" INTEGER NOT NULL DEFAULT 0,
    "napDuration" TEXT,
    "medicationUsed" TEXT,
    "positionalChanges" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SleepRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobilityRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "dailyRoundId" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "activityType" TEXT NOT NULL,
    "assistanceLevel" "AssistanceLevel" NOT NULL,
    "assistiveDevice" TEXT,
    "durationMinutes" INTEGER,
    "distance" TEXT,
    "gaitPattern" TEXT,
    "fallOccurred" BOOLEAN NOT NULL DEFAULT false,
    "fallCircumstances" TEXT,
    "transferFrom" TEXT,
    "transferTo" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobilityRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "dailyRoundId" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "mealType" "MealType" NOT NULL,
    "appetite" "AppetiteLevel" NOT NULL,
    "intakeLevel" TEXT NOT NULL,
    "fluidIntake" TEXT,
    "fluidAmountMl" INTEGER,
    "foodRefusals" TEXT,
    "textureDiet" TEXT,
    "supplements" TEXT,
    "feedingAssist" TEXT,
    "chokingRisk" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MealRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VitalSigns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "dailyRoundId" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "systolic" INTEGER,
    "diastolic" INTEGER,
    "heartRate" INTEGER,
    "temperature" DOUBLE PRECISION,
    "temperatureUnit" TEXT NOT NULL DEFAULT 'F',
    "respRate" INTEGER,
    "spo2" INTEGER,
    "bloodSugarLevel" INTEGER,
    "weight" DOUBLE PRECISION,
    "weightUnit" TEXT NOT NULL DEFAULT 'lbs',
    "painScore" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VitalSigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "guardStaffId" TEXT,
    "guardName" TEXT,
    "logType" TEXT NOT NULL DEFAULT 'PATROL',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'MINOR',
    "residentId" TEXT,
    "residentName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DietOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "residentId" TEXT,
    "residentName" TEXT,
    "roomNumber" TEXT,
    "dietType" TEXT NOT NULL DEFAULT 'REGULAR',
    "restrictions" TEXT,
    "mealType" TEXT NOT NULL DEFAULT 'ALL',
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "orderedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DietOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_authUserId_key" ON "User"("authUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "User_platformRole_idx" ON "User"("platformRole");

-- CreateIndex
CREATE UNIQUE INDEX "Resident_userId_key" ON "Resident"("userId");

-- CreateIndex
CREATE INDEX "Resident_careLevel_idx" ON "Resident"("careLevel");

-- CreateIndex
CREATE INDEX "Resident_roomNumber_idx" ON "Resident"("roomNumber");

-- CreateIndex
CREATE INDEX "Resident_admissionDate_idx" ON "Resident"("admissionDate");

-- CreateIndex
CREATE INDEX "Resident_sponsorId_idx" ON "Resident"("sponsorId");

-- CreateIndex
CREATE INDEX "Resident_createdAt_idx" ON "Resident"("createdAt");

-- CreateIndex
CREATE INDEX "Resident_communityId_idx" ON "Resident"("communityId");

-- CreateIndex
CREATE INDEX "Resident_organizationId_idx" ON "Resident"("organizationId");

-- CreateIndex
CREATE INDEX "Resident_currentAcuityLevel_idx" ON "Resident"("currentAcuityLevel");

-- CreateIndex
CREATE INDEX "Resident_careDependencyLevel_idx" ON "Resident"("careDependencyLevel");

-- CreateIndex
CREATE UNIQUE INDEX "Resident_communityId_roomNumber_key" ON "Resident"("communityId", "roomNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_userId_key" ON "Staff"("userId");

-- CreateIndex
CREATE INDEX "Staff_userId_idx" ON "Staff"("userId");

-- CreateIndex
CREATE INDEX "Staff_position_idx" ON "Staff"("position");

-- CreateIndex
CREATE INDEX "Staff_isActive_idx" ON "Staff"("isActive");

-- CreateIndex
CREATE INDEX "Staff_communityId_idx" ON "Staff"("communityId");

-- CreateIndex
CREATE INDEX "Staff_organizationId_idx" ON "Staff"("organizationId");

-- CreateIndex
CREATE INDEX "VitalsLog_residentId_idx" ON "VitalsLog"("residentId");

-- CreateIndex
CREATE INDEX "VitalsLog_recordedAt_idx" ON "VitalsLog"("recordedAt");

-- CreateIndex
CREATE INDEX "VitalsLog_type_idx" ON "VitalsLog"("type");

-- CreateIndex
CREATE INDEX "VitalsLog_residentId_type_recordedAt_idx" ON "VitalsLog"("residentId", "type", "recordedAt");

-- CreateIndex
CREATE INDEX "VitalsLog_organizationId_idx" ON "VitalsLog"("organizationId");

-- CreateIndex
CREATE INDEX "VitalsLog_communityId_idx" ON "VitalsLog"("communityId");

-- CreateIndex
CREATE INDEX "Incident_residentId_idx" ON "Incident"("residentId");

-- CreateIndex
CREATE INDEX "Incident_incidentType_idx" ON "Incident"("incidentType");

-- CreateIndex
CREATE INDEX "Incident_severity_idx" ON "Incident"("severity");

-- CreateIndex
CREATE INDEX "Incident_reportedById_idx" ON "Incident"("reportedById");

-- CreateIndex
CREATE INDEX "Incident_incidentDate_idx" ON "Incident"("incidentDate");

-- CreateIndex
CREATE INDEX "Incident_organizationId_idx" ON "Incident"("organizationId");

-- CreateIndex
CREATE INDEX "Incident_communityId_idx" ON "Incident"("communityId");

-- CreateIndex
CREATE INDEX "Medication_residentId_idx" ON "Medication"("residentId");

-- CreateIndex
CREATE INDEX "Medication_status_idx" ON "Medication"("status");

-- CreateIndex
CREATE INDEX "Medication_startDate_idx" ON "Medication"("startDate");

-- CreateIndex
CREATE INDEX "Medication_organizationId_idx" ON "Medication"("organizationId");

-- CreateIndex
CREATE INDEX "Medication_communityId_idx" ON "Medication"("communityId");

-- CreateIndex
CREATE INDEX "ResidentGoal_residentId_goalDate_idx" ON "ResidentGoal"("residentId", "goalDate");

-- CreateIndex
CREATE INDEX "ResidentGoal_isCompleted_idx" ON "ResidentGoal"("isCompleted");

-- CreateIndex
CREATE INDEX "ResidentGoal_organizationId_idx" ON "ResidentGoal"("organizationId");

-- CreateIndex
CREATE INDEX "ResidentGoal_communityId_idx" ON "ResidentGoal"("communityId");

-- CreateIndex
CREATE INDEX "MedicationLog_residentId_takenAt_idx" ON "MedicationLog"("residentId", "takenAt");

-- CreateIndex
CREATE INDEX "MedicationLog_medicationId_idx" ON "MedicationLog"("medicationId");

-- CreateIndex
CREATE INDEX "MedicationLog_marStatus_idx" ON "MedicationLog"("marStatus");

-- CreateIndex
CREATE INDEX "MedicationLog_organizationId_idx" ON "MedicationLog"("organizationId");

-- CreateIndex
CREATE INDEX "MedicationLog_communityId_idx" ON "MedicationLog"("communityId");

-- CreateIndex
CREATE INDEX "Task_residentId_idx" ON "Task"("residentId");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

-- CreateIndex
CREATE INDEX "Task_priority_idx" ON "Task"("priority");

-- CreateIndex
CREATE INDEX "Task_assignedToId_idx" ON "Task"("assignedToId");

-- CreateIndex
CREATE INDEX "Task_createdById_idx" ON "Task"("createdById");

-- CreateIndex
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");

-- CreateIndex
CREATE INDEX "Task_communityId_idx" ON "Task"("communityId");

-- CreateIndex
CREATE INDEX "Task_organizationId_idx" ON "Task"("organizationId");

-- CreateIndex
CREATE INDEX "Message_senderId_idx" ON "Message"("senderId");

-- CreateIndex
CREATE INDEX "Message_recipientId_idx" ON "Message"("recipientId");

-- CreateIndex
CREATE INDEX "Message_isRead_idx" ON "Message"("isRead");

-- CreateIndex
CREATE INDEX "Message_createdAt_idx" ON "Message"("createdAt");

-- CreateIndex
CREATE INDEX "Message_organizationId_idx" ON "Message"("organizationId");

-- CreateIndex
CREATE INDEX "Message_communityId_idx" ON "Message"("communityId");

-- CreateIndex
CREATE INDEX "TimeTracking_staffId_idx" ON "TimeTracking"("staffId");

-- CreateIndex
CREATE INDEX "TimeTracking_startTime_idx" ON "TimeTracking"("startTime");

-- CreateIndex
CREATE INDEX "TimeTracking_shiftType_idx" ON "TimeTracking"("shiftType");

-- CreateIndex
CREATE INDEX "TimeTracking_status_idx" ON "TimeTracking"("status");

-- CreateIndex
CREATE INDEX "TimeTracking_organizationId_idx" ON "TimeTracking"("organizationId");

-- CreateIndex
CREATE INDEX "TimeTracking_communityId_idx" ON "TimeTracking"("communityId");

-- CreateIndex
CREATE INDEX "MedicalNote_residentId_idx" ON "MedicalNote"("residentId");

-- CreateIndex
CREATE INDEX "MedicalNote_noteType_idx" ON "MedicalNote"("noteType");

-- CreateIndex
CREATE INDEX "MedicalNote_createdAt_idx" ON "MedicalNote"("createdAt");

-- CreateIndex
CREATE INDEX "MedicalNote_organizationId_idx" ON "MedicalNote"("organizationId");

-- CreateIndex
CREATE INDEX "MedicalNote_communityId_idx" ON "MedicalNote"("communityId");

-- CreateIndex
CREATE INDEX "CallBell_residentId_idx" ON "CallBell"("residentId");

-- CreateIndex
CREATE INDEX "CallBell_status_idx" ON "CallBell"("status");

-- CreateIndex
CREATE INDEX "CallBell_createdAt_idx" ON "CallBell"("createdAt");

-- CreateIndex
CREATE INDEX "CallBell_organizationId_idx" ON "CallBell"("organizationId");

-- CreateIndex
CREATE INDEX "CallBell_communityId_idx" ON "CallBell"("communityId");

-- CreateIndex
CREATE INDEX "ShiftReport_staffId_idx" ON "ShiftReport"("staffId");

-- CreateIndex
CREATE INDEX "ShiftReport_userId_idx" ON "ShiftReport"("userId");

-- CreateIndex
CREATE INDEX "ShiftReport_date_idx" ON "ShiftReport"("date");

-- CreateIndex
CREATE INDEX "ShiftReport_shiftType_idx" ON "ShiftReport"("shiftType");

-- CreateIndex
CREATE INDEX "ShiftReport_organizationId_idx" ON "ShiftReport"("organizationId");

-- CreateIndex
CREATE INDEX "ShiftReport_communityId_idx" ON "ShiftReport"("communityId");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_type_idx" ON "Notification"("type");

-- CreateIndex
CREATE INDEX "Notification_isRead_idx" ON "Notification"("isRead");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_organizationId_idx" ON "Notification"("organizationId");

-- CreateIndex
CREATE INDEX "Notification_communityId_idx" ON "Notification"("communityId");

-- CreateIndex
CREATE INDEX "Visit_residentId_idx" ON "Visit"("residentId");

-- CreateIndex
CREATE INDEX "Visit_checkInTime_idx" ON "Visit"("checkInTime");

-- CreateIndex
CREATE INDEX "Visit_organizationId_idx" ON "Visit"("organizationId");

-- CreateIndex
CREATE INDEX "Visit_communityId_idx" ON "Visit"("communityId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_residentId_idx" ON "Invoice"("residentId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");

-- CreateIndex
CREATE INDEX "Invoice_invoiceNumber_idx" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_idx" ON "Invoice"("organizationId");

-- CreateIndex
CREATE INDEX "Invoice_communityId_idx" ON "Invoice"("communityId");

-- CreateIndex
CREATE INDEX "ResidentNote_residentId_idx" ON "ResidentNote"("residentId");

-- CreateIndex
CREATE INDEX "ResidentNote_category_idx" ON "ResidentNote"("category");

-- CreateIndex
CREATE INDEX "ResidentNote_isPinned_idx" ON "ResidentNote"("isPinned");

-- CreateIndex
CREATE INDEX "ResidentNote_createdAt_idx" ON "ResidentNote"("createdAt");

-- CreateIndex
CREATE INDEX "ResidentNote_organizationId_idx" ON "ResidentNote"("organizationId");

-- CreateIndex
CREATE INDEX "ResidentNote_communityId_idx" ON "ResidentNote"("communityId");

-- CreateIndex
CREATE INDEX "KnowledgeDoc_createdAt_idx" ON "KnowledgeDoc"("createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeDoc_organizationId_idx" ON "KnowledgeDoc"("organizationId");

-- CreateIndex
CREATE INDEX "KnowledgeDoc_communityId_idx" ON "KnowledgeDoc"("communityId");

-- CreateIndex
CREATE INDEX "AppSetting_organizationId_idx" ON "AppSetting"("organizationId");

-- CreateIndex
CREATE INDEX "AppSetting_communityId_idx" ON "AppSetting"("communityId");

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_organizationId_communityId_key_key" ON "AppSetting"("organizationId", "communityId", "key");

-- CreateIndex
CREATE INDEX "Room_status_idx" ON "Room"("status");

-- CreateIndex
CREATE INDEX "Room_housekeepingStatus_idx" ON "Room"("housekeepingStatus");

-- CreateIndex
CREATE INDEX "Room_wing_idx" ON "Room"("wing");

-- CreateIndex
CREATE INDEX "Room_roomType_idx" ON "Room"("roomType");

-- CreateIndex
CREATE INDEX "Room_communityId_idx" ON "Room"("communityId");

-- CreateIndex
CREATE INDEX "Room_buildingId_idx" ON "Room"("buildingId");

-- CreateIndex
CREATE INDEX "Room_floorId_idx" ON "Room"("floorId");

-- CreateIndex
CREATE INDEX "Room_unitId_idx" ON "Room"("unitId");

-- CreateIndex
CREATE INDEX "Room_organizationId_idx" ON "Room"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Room_communityId_roomNumber_key" ON "Room"("communityId", "roomNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_isActive_idx" ON "Organization"("isActive");

-- CreateIndex
CREATE INDEX "Organization_status_idx" ON "Organization"("status");

-- CreateIndex
CREATE INDEX "Community_organizationId_idx" ON "Community"("organizationId");

-- CreateIndex
CREATE INDEX "Community_communityType_idx" ON "Community"("communityType");

-- CreateIndex
CREATE INDEX "Community_isActive_idx" ON "Community"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Community_organizationId_code_key" ON "Community"("organizationId", "code");

-- CreateIndex
CREATE INDEX "OrganizationMembership_organizationId_status_idx" ON "OrganizationMembership"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMembership_userId_organizationId_key" ON "OrganizationMembership"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "CommunityMembership_communityId_status_idx" ON "CommunityMembership"("communityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityMembership_userId_communityId_key" ON "CommunityMembership"("userId", "communityId");

-- CreateIndex
CREATE INDEX "ResidentAccess_residentId_isActive_idx" ON "ResidentAccess"("residentId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ResidentAccess_userId_residentId_key" ON "ResidentAccess"("userId", "residentId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_organizationId_status_idx" ON "Invitation"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Invitation_email_status_idx" ON "Invitation"("email", "status");

-- CreateIndex
CREATE INDEX "Invitation_residentId_idx" ON "Invitation"("residentId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_key_key" ON "Plan"("key");

-- CreateIndex
CREATE INDEX "Plan_isActive_idx" ON "Plan"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PlanEntitlement_planId_featureKey_key" ON "PlanEntitlement"("planId", "featureKey");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_organizationId_key" ON "Subscription"("organizationId");

-- CreateIndex
CREATE INDEX "Subscription_planId_status_idx" ON "Subscription"("planId", "status");

-- CreateIndex
CREATE INDEX "UsageSnapshot_organizationId_metric_periodEnd_idx" ON "UsageSnapshot"("organizationId", "metric", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "UsageSnapshot_organizationId_communityId_metric_periodStart_key" ON "UsageSnapshot"("organizationId", "communityId", "metric", "periodStart");

-- CreateIndex
CREATE INDEX "Building_communityId_idx" ON "Building"("communityId");

-- CreateIndex
CREATE INDEX "Building_organizationId_idx" ON "Building"("organizationId");

-- CreateIndex
CREATE INDEX "Floor_buildingId_idx" ON "Floor"("buildingId");

-- CreateIndex
CREATE INDEX "Floor_communityId_idx" ON "Floor"("communityId");

-- CreateIndex
CREATE INDEX "Floor_organizationId_idx" ON "Floor"("organizationId");

-- CreateIndex
CREATE INDEX "Unit_floorId_idx" ON "Unit"("floorId");

-- CreateIndex
CREATE INDEX "Unit_communityId_idx" ON "Unit"("communityId");

-- CreateIndex
CREATE INDEX "Unit_unitType_idx" ON "Unit"("unitType");

-- CreateIndex
CREATE INDEX "Unit_organizationId_idx" ON "Unit"("organizationId");

-- CreateIndex
CREATE INDEX "Assessment_residentId_idx" ON "Assessment"("residentId");

-- CreateIndex
CREATE INDEX "Assessment_communityId_idx" ON "Assessment"("communityId");

-- CreateIndex
CREATE INDEX "Assessment_assessmentType_idx" ON "Assessment"("assessmentType");

-- CreateIndex
CREATE INDEX "Assessment_completedAt_idx" ON "Assessment"("completedAt");

-- CreateIndex
CREATE INDEX "Assessment_residentId_completedAt_idx" ON "Assessment"("residentId", "completedAt");

-- CreateIndex
CREATE INDEX "Assessment_organizationId_idx" ON "Assessment"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AcuityScore_assessmentId_key" ON "AcuityScore"("assessmentId");

-- CreateIndex
CREATE INDEX "AcuityScore_residentId_idx" ON "AcuityScore"("residentId");

-- CreateIndex
CREATE INDEX "AcuityScore_communityId_idx" ON "AcuityScore"("communityId");

-- CreateIndex
CREATE INDEX "AcuityScore_acuityLevel_idx" ON "AcuityScore"("acuityLevel");

-- CreateIndex
CREATE INDEX "AcuityScore_careLevel_idx" ON "AcuityScore"("careLevel");

-- CreateIndex
CREATE INDEX "AcuityScore_isCurrent_idx" ON "AcuityScore"("isCurrent");

-- CreateIndex
CREATE INDEX "AcuityScore_validUntil_idx" ON "AcuityScore"("validUntil");

-- CreateIndex
CREATE INDEX "AcuityScore_organizationId_idx" ON "AcuityScore"("organizationId");

-- CreateIndex
CREATE INDEX "ServiceCatalog_communityId_idx" ON "ServiceCatalog"("communityId");

-- CreateIndex
CREATE INDEX "ServiceCatalog_category_idx" ON "ServiceCatalog"("category");

-- CreateIndex
CREATE INDEX "ServiceCatalog_isActive_idx" ON "ServiceCatalog"("isActive");

-- CreateIndex
CREATE INDEX "ServiceCatalog_organizationId_idx" ON "ServiceCatalog"("organizationId");

-- CreateIndex
CREATE INDEX "CarePackage_communityId_idx" ON "CarePackage"("communityId");

-- CreateIndex
CREATE INDEX "CarePackage_careLevel_idx" ON "CarePackage"("careLevel");

-- CreateIndex
CREATE INDEX "CarePackage_isActive_idx" ON "CarePackage"("isActive");

-- CreateIndex
CREATE INDEX "CarePackage_organizationId_idx" ON "CarePackage"("organizationId");

-- CreateIndex
CREATE INDEX "CarePackageItem_carePackageId_idx" ON "CarePackageItem"("carePackageId");

-- CreateIndex
CREATE INDEX "CarePackageItem_serviceCatalogId_idx" ON "CarePackageItem"("serviceCatalogId");

-- CreateIndex
CREATE INDEX "CarePackageItem_organizationId_idx" ON "CarePackageItem"("organizationId");

-- CreateIndex
CREATE INDEX "CarePackageItem_communityId_idx" ON "CarePackageItem"("communityId");

-- CreateIndex
CREATE UNIQUE INDEX "CarePackageItem_carePackageId_serviceCatalogId_key" ON "CarePackageItem"("carePackageId", "serviceCatalogId");

-- CreateIndex
CREATE INDEX "CommunitySop_communityId_idx" ON "CommunitySop"("communityId");

-- CreateIndex
CREATE INDEX "CommunitySop_category_idx" ON "CommunitySop"("category");

-- CreateIndex
CREATE INDEX "CommunitySop_status_idx" ON "CommunitySop"("status");

-- CreateIndex
CREATE INDEX "CommunitySop_organizationId_idx" ON "CommunitySop"("organizationId");

-- CreateIndex
CREATE INDEX "Competency_communityId_idx" ON "Competency"("communityId");

-- CreateIndex
CREATE INDEX "Competency_category_idx" ON "Competency"("category");

-- CreateIndex
CREATE INDEX "Competency_organizationId_idx" ON "Competency"("organizationId");

-- CreateIndex
CREATE INDEX "StaffCompetency_staffId_idx" ON "StaffCompetency"("staffId");

-- CreateIndex
CREATE INDEX "StaffCompetency_competencyId_idx" ON "StaffCompetency"("competencyId");

-- CreateIndex
CREATE INDEX "StaffCompetency_expiryDate_idx" ON "StaffCompetency"("expiryDate");

-- CreateIndex
CREATE INDEX "StaffCompetency_organizationId_idx" ON "StaffCompetency"("organizationId");

-- CreateIndex
CREATE INDEX "StaffCompetency_communityId_idx" ON "StaffCompetency"("communityId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffCompetency_staffId_competencyId_key" ON "StaffCompetency"("staffId", "competencyId");

-- CreateIndex
CREATE INDEX "ResidentQualityScore_residentId_idx" ON "ResidentQualityScore"("residentId");

-- CreateIndex
CREATE INDEX "ResidentQualityScore_communityId_idx" ON "ResidentQualityScore"("communityId");

-- CreateIndex
CREATE INDEX "ResidentQualityScore_periodType_idx" ON "ResidentQualityScore"("periodType");

-- CreateIndex
CREATE INDEX "ResidentQualityScore_organizationId_idx" ON "ResidentQualityScore"("organizationId");

-- CreateIndex
CREATE INDEX "CommunityQualityDashboard_communityId_idx" ON "CommunityQualityDashboard"("communityId");

-- CreateIndex
CREATE INDEX "CommunityQualityDashboard_snapshotDate_idx" ON "CommunityQualityDashboard"("snapshotDate");

-- CreateIndex
CREATE INDEX "CommunityQualityDashboard_organizationId_idx" ON "CommunityQualityDashboard"("organizationId");

-- CreateIndex
CREATE INDEX "KpiRecord_communityId_idx" ON "KpiRecord"("communityId");

-- CreateIndex
CREATE INDEX "KpiRecord_category_idx" ON "KpiRecord"("category");

-- CreateIndex
CREATE INDEX "KpiRecord_period_idx" ON "KpiRecord"("period");

-- CreateIndex
CREATE INDEX "KpiRecord_communityId_category_periodStart_idx" ON "KpiRecord"("communityId", "category", "periodStart");

-- CreateIndex
CREATE INDEX "KpiRecord_organizationId_idx" ON "KpiRecord"("organizationId");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_idx" ON "AuditLog"("organizationId");

-- CreateIndex
CREATE INDEX "AuditLog_communityId_idx" ON "AuditLog"("communityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_idx" ON "AuditLog"("entityType");

-- CreateIndex
CREATE INDEX "AuditLog_entityId_idx" ON "AuditLog"("entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Observation_residentId_idx" ON "Observation"("residentId");

-- CreateIndex
CREATE INDEX "Observation_communityId_idx" ON "Observation"("communityId");

-- CreateIndex
CREATE INDEX "Observation_observationType_idx" ON "Observation"("observationType");

-- CreateIndex
CREATE INDEX "Observation_residentId_observationType_observedAt_idx" ON "Observation"("residentId", "observationType", "observedAt");

-- CreateIndex
CREATE INDEX "Observation_organizationId_idx" ON "Observation"("organizationId");

-- CreateIndex
CREATE INDEX "StaffingPlan_communityId_idx" ON "StaffingPlan"("communityId");

-- CreateIndex
CREATE INDEX "StaffingPlan_unitId_idx" ON "StaffingPlan"("unitId");

-- CreateIndex
CREATE INDEX "StaffingPlan_planDate_idx" ON "StaffingPlan"("planDate");

-- CreateIndex
CREATE INDEX "StaffingPlan_communityId_planDate_shiftType_idx" ON "StaffingPlan"("communityId", "planDate", "shiftType");

-- CreateIndex
CREATE INDEX "StaffingPlan_organizationId_idx" ON "StaffingPlan"("organizationId");

-- CreateIndex
CREATE INDEX "Vaccination_residentId_idx" ON "Vaccination"("residentId");

-- CreateIndex
CREATE INDEX "Vaccination_vaccineType_idx" ON "Vaccination"("vaccineType");

-- CreateIndex
CREATE INDEX "Vaccination_status_idx" ON "Vaccination"("status");

-- CreateIndex
CREATE INDEX "Vaccination_dateGiven_idx" ON "Vaccination"("dateGiven");

-- CreateIndex
CREATE INDEX "Vaccination_organizationId_idx" ON "Vaccination"("organizationId");

-- CreateIndex
CREATE INDEX "Vaccination_communityId_idx" ON "Vaccination"("communityId");

-- CreateIndex
CREATE INDEX "ResidentDocument_residentId_idx" ON "ResidentDocument"("residentId");

-- CreateIndex
CREATE INDEX "ResidentDocument_documentType_idx" ON "ResidentDocument"("documentType");

-- CreateIndex
CREATE INDEX "ResidentDocument_isConfidential_idx" ON "ResidentDocument"("isConfidential");

-- CreateIndex
CREATE INDEX "ResidentDocument_organizationId_idx" ON "ResidentDocument"("organizationId");

-- CreateIndex
CREATE INDEX "ResidentDocument_communityId_idx" ON "ResidentDocument"("communityId");

-- CreateIndex
CREATE INDEX "EliminationLog_residentId_idx" ON "EliminationLog"("residentId");

-- CreateIndex
CREATE INDEX "EliminationLog_type_idx" ON "EliminationLog"("type");

-- CreateIndex
CREATE INDEX "EliminationLog_time_idx" ON "EliminationLog"("time");

-- CreateIndex
CREATE INDEX "EliminationLog_residentId_type_time_idx" ON "EliminationLog"("residentId", "type", "time");

-- CreateIndex
CREATE INDEX "EliminationLog_organizationId_idx" ON "EliminationLog"("organizationId");

-- CreateIndex
CREATE INDEX "EliminationLog_communityId_idx" ON "EliminationLog"("communityId");

-- CreateIndex
CREATE INDEX "PainAssessment_residentId_idx" ON "PainAssessment"("residentId");

-- CreateIndex
CREATE INDEX "PainAssessment_painScale_idx" ON "PainAssessment"("painScale");

-- CreateIndex
CREATE INDEX "PainAssessment_assessedAt_idx" ON "PainAssessment"("assessedAt");

-- CreateIndex
CREATE INDEX "PainAssessment_residentId_assessedAt_idx" ON "PainAssessment"("residentId", "assessedAt");

-- CreateIndex
CREATE INDEX "PainAssessment_organizationId_idx" ON "PainAssessment"("organizationId");

-- CreateIndex
CREATE INDEX "PainAssessment_communityId_idx" ON "PainAssessment"("communityId");

-- CreateIndex
CREATE INDEX "WoundCare_residentId_idx" ON "WoundCare"("residentId");

-- CreateIndex
CREATE INDEX "WoundCare_woundType_idx" ON "WoundCare"("woundType");

-- CreateIndex
CREATE INDEX "WoundCare_stage_idx" ON "WoundCare"("stage");

-- CreateIndex
CREATE INDEX "WoundCare_assessedAt_idx" ON "WoundCare"("assessedAt");

-- CreateIndex
CREATE INDEX "WoundCare_organizationId_idx" ON "WoundCare"("organizationId");

-- CreateIndex
CREATE INDEX "WoundCare_communityId_idx" ON "WoundCare"("communityId");

-- CreateIndex
CREATE INDEX "SleepLog_residentId_idx" ON "SleepLog"("residentId");

-- CreateIndex
CREATE INDEX "SleepLog_date_idx" ON "SleepLog"("date");

-- CreateIndex
CREATE INDEX "SleepLog_quality_idx" ON "SleepLog"("quality");

-- CreateIndex
CREATE INDEX "SleepLog_residentId_date_idx" ON "SleepLog"("residentId", "date");

-- CreateIndex
CREATE INDEX "SleepLog_organizationId_idx" ON "SleepLog"("organizationId");

-- CreateIndex
CREATE INDEX "SleepLog_communityId_idx" ON "SleepLog"("communityId");

-- CreateIndex
CREATE INDEX "MobilityLog_residentId_idx" ON "MobilityLog"("residentId");

-- CreateIndex
CREATE INDEX "MobilityLog_type_idx" ON "MobilityLog"("type");

-- CreateIndex
CREATE INDEX "MobilityLog_startTime_idx" ON "MobilityLog"("startTime");

-- CreateIndex
CREATE INDEX "MobilityLog_residentId_type_startTime_idx" ON "MobilityLog"("residentId", "type", "startTime");

-- CreateIndex
CREATE INDEX "MobilityLog_organizationId_idx" ON "MobilityLog"("organizationId");

-- CreateIndex
CREATE INDEX "MobilityLog_communityId_idx" ON "MobilityLog"("communityId");

-- CreateIndex
CREATE INDEX "CarePlan_residentId_idx" ON "CarePlan"("residentId");

-- CreateIndex
CREATE INDEX "CarePlan_status_idx" ON "CarePlan"("status");

-- CreateIndex
CREATE INDEX "CarePlan_startDate_idx" ON "CarePlan"("startDate");

-- CreateIndex
CREATE INDEX "CarePlan_nextReviewDate_idx" ON "CarePlan"("nextReviewDate");

-- CreateIndex
CREATE INDEX "CarePlan_residentId_status_idx" ON "CarePlan"("residentId", "status");

-- CreateIndex
CREATE INDEX "CarePlan_organizationId_idx" ON "CarePlan"("organizationId");

-- CreateIndex
CREATE INDEX "CarePlan_communityId_idx" ON "CarePlan"("communityId");

-- CreateIndex
CREATE INDEX "CarePlanItem_carePlanId_idx" ON "CarePlanItem"("carePlanId");

-- CreateIndex
CREATE INDEX "CarePlanItem_category_idx" ON "CarePlanItem"("category");

-- CreateIndex
CREATE INDEX "CarePlanItem_status_idx" ON "CarePlanItem"("status");

-- CreateIndex
CREATE INDEX "CarePlanItem_organizationId_idx" ON "CarePlanItem"("organizationId");

-- CreateIndex
CREATE INDEX "CarePlanItem_communityId_idx" ON "CarePlanItem"("communityId");

-- CreateIndex
CREATE INDEX "CarePlanReview_carePlanId_idx" ON "CarePlanReview"("carePlanId");

-- CreateIndex
CREATE INDEX "CarePlanReview_reviewDate_idx" ON "CarePlanReview"("reviewDate");

-- CreateIndex
CREATE INDEX "CarePlanReview_organizationId_idx" ON "CarePlanReview"("organizationId");

-- CreateIndex
CREATE INDEX "CarePlanReview_communityId_idx" ON "CarePlanReview"("communityId");

-- CreateIndex
CREATE INDEX "HospitalReferral_residentId_idx" ON "HospitalReferral"("residentId");

-- CreateIndex
CREATE INDEX "HospitalReferral_status_idx" ON "HospitalReferral"("status");

-- CreateIndex
CREATE INDEX "HospitalReferral_urgency_idx" ON "HospitalReferral"("urgency");

-- CreateIndex
CREATE INDEX "HospitalReferral_createdAt_idx" ON "HospitalReferral"("createdAt");

-- CreateIndex
CREATE INDEX "HospitalReferral_organizationId_idx" ON "HospitalReferral"("organizationId");

-- CreateIndex
CREATE INDEX "HospitalReferral_communityId_idx" ON "HospitalReferral"("communityId");

-- CreateIndex
CREATE INDEX "FollowUp_residentId_idx" ON "FollowUp"("residentId");

-- CreateIndex
CREATE INDEX "FollowUp_status_idx" ON "FollowUp"("status");

-- CreateIndex
CREATE INDEX "FollowUp_dueDate_idx" ON "FollowUp"("dueDate");

-- CreateIndex
CREATE INDEX "FollowUp_type_idx" ON "FollowUp"("type");

-- CreateIndex
CREATE INDEX "FollowUp_residentId_status_idx" ON "FollowUp"("residentId", "status");

-- CreateIndex
CREATE INDEX "FollowUp_organizationId_idx" ON "FollowUp"("organizationId");

-- CreateIndex
CREATE INDEX "FollowUp_communityId_idx" ON "FollowUp"("communityId");

-- CreateIndex
CREATE INDEX "CareTimelineEntry_residentId_idx" ON "CareTimelineEntry"("residentId");

-- CreateIndex
CREATE INDEX "CareTimelineEntry_entryType_idx" ON "CareTimelineEntry"("entryType");

-- CreateIndex
CREATE INDEX "CareTimelineEntry_entryDate_idx" ON "CareTimelineEntry"("entryDate");

-- CreateIndex
CREATE INDEX "CareTimelineEntry_residentId_entryType_entryDate_idx" ON "CareTimelineEntry"("residentId", "entryType", "entryDate");

-- CreateIndex
CREATE INDEX "CareTimelineEntry_isImportant_idx" ON "CareTimelineEntry"("isImportant");

-- CreateIndex
CREATE INDEX "CareTimelineEntry_organizationId_idx" ON "CareTimelineEntry"("organizationId");

-- CreateIndex
CREATE INDEX "CareTimelineEntry_communityId_idx" ON "CareTimelineEntry"("communityId");

-- CreateIndex
CREATE INDEX "GeneratedReport_reportType_idx" ON "GeneratedReport"("reportType");

-- CreateIndex
CREATE INDEX "GeneratedReport_communityId_idx" ON "GeneratedReport"("communityId");

-- CreateIndex
CREATE INDEX "GeneratedReport_createdAt_idx" ON "GeneratedReport"("createdAt");

-- CreateIndex
CREATE INDEX "GeneratedReport_organizationId_idx" ON "GeneratedReport"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryAlert_inventoryItemId_idx" ON "InventoryAlert"("inventoryItemId");

-- CreateIndex
CREATE INDEX "InventoryAlert_alertType_idx" ON "InventoryAlert"("alertType");

-- CreateIndex
CREATE INDEX "InventoryAlert_acknowledged_idx" ON "InventoryAlert"("acknowledged");

-- CreateIndex
CREATE INDEX "InventoryAlert_createdAt_idx" ON "InventoryAlert"("createdAt");

-- CreateIndex
CREATE INDEX "InventoryAlert_organizationId_idx" ON "InventoryAlert"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryAlert_communityId_idx" ON "InventoryAlert"("communityId");

-- CreateIndex
CREATE INDEX "MedicationAdministration_medicationId_idx" ON "MedicationAdministration"("medicationId");

-- CreateIndex
CREATE INDEX "MedicationAdministration_residentId_idx" ON "MedicationAdministration"("residentId");

-- CreateIndex
CREATE INDEX "MedicationAdministration_status_idx" ON "MedicationAdministration"("status");

-- CreateIndex
CREATE INDEX "MedicationAdministration_scheduledTime_idx" ON "MedicationAdministration"("scheduledTime");

-- CreateIndex
CREATE INDEX "MedicationAdministration_residentId_scheduledTime_idx" ON "MedicationAdministration"("residentId", "scheduledTime");

-- CreateIndex
CREATE INDEX "MedicationAdministration_organizationId_idx" ON "MedicationAdministration"("organizationId");

-- CreateIndex
CREATE INDEX "MedicationAdministration_communityId_idx" ON "MedicationAdministration"("communityId");

-- CreateIndex
CREATE INDEX "MedicationChangeLog_medicationId_idx" ON "MedicationChangeLog"("medicationId");

-- CreateIndex
CREATE INDEX "MedicationChangeLog_changeType_idx" ON "MedicationChangeLog"("changeType");

-- CreateIndex
CREATE INDEX "MedicationChangeLog_changedAt_idx" ON "MedicationChangeLog"("changedAt");

-- CreateIndex
CREATE INDEX "MedicationChangeLog_organizationId_idx" ON "MedicationChangeLog"("organizationId");

-- CreateIndex
CREATE INDEX "MedicationChangeLog_communityId_idx" ON "MedicationChangeLog"("communityId");

-- CreateIndex
CREATE INDEX "InventoryItem_category_idx" ON "InventoryItem"("category");

-- CreateIndex
CREATE INDEX "InventoryItem_itemName_idx" ON "InventoryItem"("itemName");

-- CreateIndex
CREATE INDEX "InventoryItem_expiryDate_idx" ON "InventoryItem"("expiryDate");

-- CreateIndex
CREATE INDEX "InventoryItem_batchNumber_idx" ON "InventoryItem"("batchNumber");

-- CreateIndex
CREATE INDEX "InventoryItem_organizationId_idx" ON "InventoryItem"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryItem_communityId_idx" ON "InventoryItem"("communityId");

-- CreateIndex
CREATE UNIQUE INDEX "Admission_residentId_key" ON "Admission"("residentId");

-- CreateIndex
CREATE INDEX "Admission_status_idx" ON "Admission"("status");

-- CreateIndex
CREATE INDEX "Admission_currentStep_idx" ON "Admission"("currentStep");

-- CreateIndex
CREATE INDEX "Admission_createdAt_idx" ON "Admission"("createdAt");

-- CreateIndex
CREATE INDEX "Admission_organizationId_idx" ON "Admission"("organizationId");

-- CreateIndex
CREATE INDEX "Admission_communityId_idx" ON "Admission"("communityId");

-- CreateIndex
CREATE INDEX "PurchaseRequest_communityId_idx" ON "PurchaseRequest"("communityId");

-- CreateIndex
CREATE INDEX "PurchaseRequest_organizationId_idx" ON "PurchaseRequest"("organizationId");

-- CreateIndex
CREATE INDEX "PurchaseRequest_status_idx" ON "PurchaseRequest"("status");

-- CreateIndex
CREATE INDEX "PurchaseRequest_inventoryItemId_idx" ON "PurchaseRequest"("inventoryItemId");

-- CreateIndex
CREATE INDEX "PhysicianCommunication_residentId_idx" ON "PhysicianCommunication"("residentId");

-- CreateIndex
CREATE INDEX "PhysicianCommunication_communityId_idx" ON "PhysicianCommunication"("communityId");

-- CreateIndex
CREATE INDEX "PhysicianCommunication_occurredAt_idx" ON "PhysicianCommunication"("occurredAt");

-- CreateIndex
CREATE INDEX "ServiceCharge_residentId_idx" ON "ServiceCharge"("residentId");

-- CreateIndex
CREATE INDEX "ServiceCharge_invoiceId_idx" ON "ServiceCharge"("invoiceId");

-- CreateIndex
CREATE INDEX "ServiceCharge_serviceDate_idx" ON "ServiceCharge"("serviceDate");

-- CreateIndex
CREATE INDEX "ServiceCharge_organizationId_idx" ON "ServiceCharge"("organizationId");

-- CreateIndex
CREATE INDEX "ServiceCharge_communityId_idx" ON "ServiceCharge"("communityId");

-- CreateIndex
CREATE INDEX "InsuranceValidation_residentId_idx" ON "InsuranceValidation"("residentId");

-- CreateIndex
CREATE INDEX "InsuranceValidation_status_idx" ON "InsuranceValidation"("status");

-- CreateIndex
CREATE INDEX "InsuranceValidation_organizationId_idx" ON "InsuranceValidation"("organizationId");

-- CreateIndex
CREATE INDEX "InsuranceValidation_communityId_idx" ON "InsuranceValidation"("communityId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_transactionId_key" ON "Payment"("transactionId");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_paymentDate_idx" ON "Payment"("paymentDate");

-- CreateIndex
CREATE INDEX "Payment_organizationId_idx" ON "Payment"("organizationId");

-- CreateIndex
CREATE INDEX "Payment_communityId_idx" ON "Payment"("communityId");

-- CreateIndex
CREATE INDEX "BlogPost_publishedAt_idx" ON "BlogPost"("publishedAt");

-- CreateIndex
CREATE INDEX "BlogPost_published_idx" ON "BlogPost"("published");

-- CreateIndex
CREATE INDEX "BlogPost_organizationId_idx" ON "BlogPost"("organizationId");

-- CreateIndex
CREATE INDEX "BlogPost_communityId_idx" ON "BlogPost"("communityId");

-- CreateIndex
CREATE INDEX "SiteContent_organizationId_idx" ON "SiteContent"("organizationId");

-- CreateIndex
CREATE INDEX "SiteContent_communityId_idx" ON "SiteContent"("communityId");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_licensePlate_key" ON "Vehicle"("licensePlate");

-- CreateIndex
CREATE INDEX "Vehicle_status_idx" ON "Vehicle"("status");

-- CreateIndex
CREATE INDEX "Vehicle_type_idx" ON "Vehicle"("type");

-- CreateIndex
CREATE INDEX "Vehicle_licensePlate_idx" ON "Vehicle"("licensePlate");

-- CreateIndex
CREATE INDEX "Vehicle_insuranceExpiry_idx" ON "Vehicle"("insuranceExpiry");

-- CreateIndex
CREATE INDEX "Vehicle_registrationExpiry_idx" ON "Vehicle"("registrationExpiry");

-- CreateIndex
CREATE INDEX "Vehicle_organizationId_idx" ON "Vehicle"("organizationId");

-- CreateIndex
CREATE INDEX "Vehicle_communityId_idx" ON "Vehicle"("communityId");

-- CreateIndex
CREATE INDEX "Driver_isActive_idx" ON "Driver"("isActive");

-- CreateIndex
CREATE INDEX "Driver_licenseExpiry_idx" ON "Driver"("licenseExpiry");

-- CreateIndex
CREATE INDEX "Driver_organizationId_idx" ON "Driver"("organizationId");

-- CreateIndex
CREATE INDEX "Driver_communityId_idx" ON "Driver"("communityId");

-- CreateIndex
CREATE INDEX "TransportRequest_residentId_idx" ON "TransportRequest"("residentId");

-- CreateIndex
CREATE INDEX "TransportRequest_status_idx" ON "TransportRequest"("status");

-- CreateIndex
CREATE INDEX "TransportRequest_priority_idx" ON "TransportRequest"("priority");

-- CreateIndex
CREATE INDEX "TransportRequest_requestedDate_idx" ON "TransportRequest"("requestedDate");

-- CreateIndex
CREATE INDEX "TransportRequest_organizationId_idx" ON "TransportRequest"("organizationId");

-- CreateIndex
CREATE INDEX "TransportRequest_communityId_idx" ON "TransportRequest"("communityId");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_requestId_key" ON "Trip"("requestId");

-- CreateIndex
CREATE INDEX "Trip_residentId_idx" ON "Trip"("residentId");

-- CreateIndex
CREATE INDEX "Trip_vehicleId_idx" ON "Trip"("vehicleId");

-- CreateIndex
CREATE INDEX "Trip_driverId_idx" ON "Trip"("driverId");

-- CreateIndex
CREATE INDEX "Trip_status_idx" ON "Trip"("status");

-- CreateIndex
CREATE INDEX "Trip_scheduledAt_idx" ON "Trip"("scheduledAt");

-- CreateIndex
CREATE INDEX "Trip_organizationId_idx" ON "Trip"("organizationId");

-- CreateIndex
CREATE INDEX "Trip_communityId_idx" ON "Trip"("communityId");

-- CreateIndex
CREATE INDEX "VehicleMaintenance_vehicleId_idx" ON "VehicleMaintenance"("vehicleId");

-- CreateIndex
CREATE INDEX "VehicleMaintenance_status_idx" ON "VehicleMaintenance"("status");

-- CreateIndex
CREATE INDEX "VehicleMaintenance_type_idx" ON "VehicleMaintenance"("type");

-- CreateIndex
CREATE INDEX "VehicleMaintenance_scheduledDate_idx" ON "VehicleMaintenance"("scheduledDate");

-- CreateIndex
CREATE INDEX "VehicleMaintenance_organizationId_idx" ON "VehicleMaintenance"("organizationId");

-- CreateIndex
CREATE INDEX "VehicleMaintenance_communityId_idx" ON "VehicleMaintenance"("communityId");

-- CreateIndex
CREATE INDEX "FuelLog_vehicleId_idx" ON "FuelLog"("vehicleId");

-- CreateIndex
CREATE INDEX "FuelLog_logDate_idx" ON "FuelLog"("logDate");

-- CreateIndex
CREATE INDEX "FuelLog_organizationId_idx" ON "FuelLog"("organizationId");

-- CreateIndex
CREATE INDEX "FuelLog_communityId_idx" ON "FuelLog"("communityId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomPage_slug_key" ON "CustomPage"("slug");

-- CreateIndex
CREATE INDEX "CustomPage_slug_idx" ON "CustomPage"("slug");

-- CreateIndex
CREATE INDEX "CustomPage_published_idx" ON "CustomPage"("published");

-- CreateIndex
CREATE INDEX "CustomPage_pagePurpose_idx" ON "CustomPage"("pagePurpose");

-- CreateIndex
CREATE INDEX "CustomPage_parcelType_idx" ON "CustomPage"("parcelType");

-- CreateIndex
CREATE INDEX "CustomPage_organizationId_idx" ON "CustomPage"("organizationId");

-- CreateIndex
CREATE INDEX "CustomPage_communityId_idx" ON "CustomPage"("communityId");

-- CreateIndex
CREATE INDEX "DailyMenu_menuDate_idx" ON "DailyMenu"("menuDate");

-- CreateIndex
CREATE INDEX "DailyMenu_mealType_idx" ON "DailyMenu"("mealType");

-- CreateIndex
CREATE INDEX "DailyMenu_organizationId_idx" ON "DailyMenu"("organizationId");

-- CreateIndex
CREATE INDEX "DailyMenu_communityId_idx" ON "DailyMenu"("communityId");

-- CreateIndex
CREATE INDEX "DietitianConsult_residentId_idx" ON "DietitianConsult"("residentId");

-- CreateIndex
CREATE INDEX "DietitianConsult_status_idx" ON "DietitianConsult"("status");

-- CreateIndex
CREATE INDEX "DietitianConsult_organizationId_idx" ON "DietitianConsult"("organizationId");

-- CreateIndex
CREATE INDEX "DietitianConsult_communityId_idx" ON "DietitianConsult"("communityId");

-- CreateIndex
CREATE INDEX "FoodComplianceLog_category_idx" ON "FoodComplianceLog"("category");

-- CreateIndex
CREATE INDEX "FoodComplianceLog_status_idx" ON "FoodComplianceLog"("status");

-- CreateIndex
CREATE INDEX "FoodComplianceLog_auditDate_idx" ON "FoodComplianceLog"("auditDate");

-- CreateIndex
CREATE INDEX "FoodComplianceLog_organizationId_idx" ON "FoodComplianceLog"("organizationId");

-- CreateIndex
CREATE INDEX "FoodComplianceLog_communityId_idx" ON "FoodComplianceLog"("communityId");

-- CreateIndex
CREATE INDEX "ServiceRequest_residentId_idx" ON "ServiceRequest"("residentId");

-- CreateIndex
CREATE INDEX "ServiceRequest_status_idx" ON "ServiceRequest"("status");

-- CreateIndex
CREATE INDEX "ServiceRequest_category_idx" ON "ServiceRequest"("category");

-- CreateIndex
CREATE INDEX "ServiceRequest_priority_idx" ON "ServiceRequest"("priority");

-- CreateIndex
CREATE INDEX "ServiceRequest_assignedTeam_idx" ON "ServiceRequest"("assignedTeam");

-- CreateIndex
CREATE INDEX "ServiceRequest_createdAt_idx" ON "ServiceRequest"("createdAt");

-- CreateIndex
CREATE INDEX "ServiceRequest_organizationId_idx" ON "ServiceRequest"("organizationId");

-- CreateIndex
CREATE INDEX "ServiceRequest_communityId_idx" ON "ServiceRequest"("communityId");

-- CreateIndex
CREATE INDEX "FacilityMaintenance_system_idx" ON "FacilityMaintenance"("system");

-- CreateIndex
CREATE INDEX "FacilityMaintenance_status_idx" ON "FacilityMaintenance"("status");

-- CreateIndex
CREATE INDEX "FacilityMaintenance_scheduledDate_idx" ON "FacilityMaintenance"("scheduledDate");

-- CreateIndex
CREATE INDEX "FacilityMaintenance_nextDueDate_idx" ON "FacilityMaintenance"("nextDueDate");

-- CreateIndex
CREATE INDEX "FacilityMaintenance_organizationId_idx" ON "FacilityMaintenance"("organizationId");

-- CreateIndex
CREATE INDEX "FacilityMaintenance_communityId_idx" ON "FacilityMaintenance"("communityId");

-- CreateIndex
CREATE INDEX "ConciergeBooking_residentId_idx" ON "ConciergeBooking"("residentId");

-- CreateIndex
CREATE INDEX "ConciergeBooking_status_idx" ON "ConciergeBooking"("status");

-- CreateIndex
CREATE INDEX "ConciergeBooking_category_idx" ON "ConciergeBooking"("category");

-- CreateIndex
CREATE INDEX "ConciergeBooking_scheduledAt_idx" ON "ConciergeBooking"("scheduledAt");

-- CreateIndex
CREATE INDEX "ConciergeBooking_organizationId_idx" ON "ConciergeBooking"("organizationId");

-- CreateIndex
CREATE INDEX "ConciergeBooking_communityId_idx" ON "ConciergeBooking"("communityId");

-- CreateIndex
CREATE INDEX "FrontDeskVisit_status_idx" ON "FrontDeskVisit"("status");

-- CreateIndex
CREATE INDEX "FrontDeskVisit_visitType_idx" ON "FrontDeskVisit"("visitType");

-- CreateIndex
CREATE INDEX "FrontDeskVisit_residentId_idx" ON "FrontDeskVisit"("residentId");

-- CreateIndex
CREATE INDEX "FrontDeskVisit_arrivalTime_idx" ON "FrontDeskVisit"("arrivalTime");

-- CreateIndex
CREATE INDEX "FrontDeskVisit_organizationId_idx" ON "FrontDeskVisit"("organizationId");

-- CreateIndex
CREATE INDEX "FrontDeskVisit_communityId_idx" ON "FrontDeskVisit"("communityId");

-- CreateIndex
CREATE INDEX "RoomTurnover_roomNumber_idx" ON "RoomTurnover"("roomNumber");

-- CreateIndex
CREATE INDEX "RoomTurnover_stage_idx" ON "RoomTurnover"("stage");

-- CreateIndex
CREATE INDEX "RoomTurnover_status_idx" ON "RoomTurnover"("status");

-- CreateIndex
CREATE INDEX "RoomTurnover_startedAt_idx" ON "RoomTurnover"("startedAt");

-- CreateIndex
CREATE INDEX "RoomTurnover_organizationId_idx" ON "RoomTurnover"("organizationId");

-- CreateIndex
CREATE INDEX "RoomTurnover_communityId_idx" ON "RoomTurnover"("communityId");

-- CreateIndex
CREATE INDEX "ResidentPreference_residentId_idx" ON "ResidentPreference"("residentId");

-- CreateIndex
CREATE INDEX "ResidentPreference_category_idx" ON "ResidentPreference"("category");

-- CreateIndex
CREATE INDEX "ResidentPreference_organizationId_idx" ON "ResidentPreference"("organizationId");

-- CreateIndex
CREATE INDEX "ResidentPreference_communityId_idx" ON "ResidentPreference"("communityId");

-- CreateIndex
CREATE INDEX "CommunityEvent_startTime_idx" ON "CommunityEvent"("startTime");

-- CreateIndex
CREATE INDEX "CommunityEvent_category_idx" ON "CommunityEvent"("category");

-- CreateIndex
CREATE INDEX "CommunityEvent_published_idx" ON "CommunityEvent"("published");

-- CreateIndex
CREATE INDEX "CommunityEvent_organizationId_idx" ON "CommunityEvent"("organizationId");

-- CreateIndex
CREATE INDEX "CommunityEvent_communityId_idx" ON "CommunityEvent"("communityId");

-- CreateIndex
CREATE INDEX "EventAttendance_eventId_idx" ON "EventAttendance"("eventId");

-- CreateIndex
CREATE INDEX "EventAttendance_residentId_idx" ON "EventAttendance"("residentId");

-- CreateIndex
CREATE INDEX "EventAttendance_status_idx" ON "EventAttendance"("status");

-- CreateIndex
CREATE INDEX "EventAttendance_organizationId_idx" ON "EventAttendance"("organizationId");

-- CreateIndex
CREATE INDEX "EventAttendance_communityId_idx" ON "EventAttendance"("communityId");

-- CreateIndex
CREATE UNIQUE INDEX "EventAttendance_eventId_residentId_key" ON "EventAttendance"("eventId", "residentId");

-- CreateIndex
CREATE INDEX "DiningReservation_residentId_idx" ON "DiningReservation"("residentId");

-- CreateIndex
CREATE INDEX "DiningReservation_status_idx" ON "DiningReservation"("status");

-- CreateIndex
CREATE INDEX "DiningReservation_reservedAt_idx" ON "DiningReservation"("reservedAt");

-- CreateIndex
CREATE INDEX "DiningReservation_organizationId_idx" ON "DiningReservation"("organizationId");

-- CreateIndex
CREATE INDEX "DiningReservation_communityId_idx" ON "DiningReservation"("communityId");

-- CreateIndex
CREATE INDEX "Announcement_audience_idx" ON "Announcement"("audience");

-- CreateIndex
CREATE INDEX "Announcement_published_idx" ON "Announcement"("published");

-- CreateIndex
CREATE INDEX "Announcement_pinned_idx" ON "Announcement"("pinned");

-- CreateIndex
CREATE INDEX "Announcement_publishedAt_idx" ON "Announcement"("publishedAt");

-- CreateIndex
CREATE INDEX "Announcement_organizationId_idx" ON "Announcement"("organizationId");

-- CreateIndex
CREATE INDEX "Announcement_communityId_idx" ON "Announcement"("communityId");

-- CreateIndex
CREATE INDEX "CameraMonitoringLog_residentId_idx" ON "CameraMonitoringLog"("residentId");

-- CreateIndex
CREATE INDEX "CameraMonitoringLog_logType_idx" ON "CameraMonitoringLog"("logType");

-- CreateIndex
CREATE INDEX "CameraMonitoringLog_createdAt_idx" ON "CameraMonitoringLog"("createdAt");

-- CreateIndex
CREATE INDEX "CameraMonitoringLog_alert_idx" ON "CameraMonitoringLog"("alert");

-- CreateIndex
CREATE INDEX "CameraMonitoringLog_organizationId_idx" ON "CameraMonitoringLog"("organizationId");

-- CreateIndex
CREATE INDEX "CameraMonitoringLog_communityId_idx" ON "CameraMonitoringLog"("communityId");

-- CreateIndex
CREATE INDEX "Escalation_residentId_idx" ON "Escalation"("residentId");

-- CreateIndex
CREATE INDEX "Escalation_status_idx" ON "Escalation"("status");

-- CreateIndex
CREATE INDEX "Escalation_priority_idx" ON "Escalation"("priority");

-- CreateIndex
CREATE INDEX "Escalation_assignedToRole_idx" ON "Escalation"("assignedToRole");

-- CreateIndex
CREATE INDEX "Escalation_createdAt_idx" ON "Escalation"("createdAt");

-- CreateIndex
CREATE INDEX "Escalation_organizationId_idx" ON "Escalation"("organizationId");

-- CreateIndex
CREATE INDEX "Escalation_communityId_idx" ON "Escalation"("communityId");

-- CreateIndex
CREATE INDEX "DailyRound_residentId_idx" ON "DailyRound"("residentId");

-- CreateIndex
CREATE INDEX "DailyRound_roundDate_idx" ON "DailyRound"("roundDate");

-- CreateIndex
CREATE INDEX "DailyRound_shift_idx" ON "DailyRound"("shift");

-- CreateIndex
CREATE INDEX "DailyRound_status_idx" ON "DailyRound"("status");

-- CreateIndex
CREATE INDEX "DailyRound_residentId_roundDate_shift_idx" ON "DailyRound"("residentId", "roundDate", "shift");

-- CreateIndex
CREATE INDEX "DailyRound_organizationId_idx" ON "DailyRound"("organizationId");

-- CreateIndex
CREATE INDEX "DailyRound_communityId_idx" ON "DailyRound"("communityId");

-- CreateIndex
CREATE INDEX "BowelRecord_dailyRoundId_idx" ON "BowelRecord"("dailyRoundId");

-- CreateIndex
CREATE INDEX "BowelRecord_time_idx" ON "BowelRecord"("time");

-- CreateIndex
CREATE INDEX "BowelRecord_organizationId_idx" ON "BowelRecord"("organizationId");

-- CreateIndex
CREATE INDEX "BowelRecord_communityId_idx" ON "BowelRecord"("communityId");

-- CreateIndex
CREATE INDEX "UrineRecord_dailyRoundId_idx" ON "UrineRecord"("dailyRoundId");

-- CreateIndex
CREATE INDEX "UrineRecord_time_idx" ON "UrineRecord"("time");

-- CreateIndex
CREATE INDEX "UrineRecord_organizationId_idx" ON "UrineRecord"("organizationId");

-- CreateIndex
CREATE INDEX "UrineRecord_communityId_idx" ON "UrineRecord"("communityId");

-- CreateIndex
CREATE INDEX "EdemaRecord_dailyRoundId_idx" ON "EdemaRecord"("dailyRoundId");

-- CreateIndex
CREATE INDEX "EdemaRecord_location_idx" ON "EdemaRecord"("location");

-- CreateIndex
CREATE INDEX "EdemaRecord_organizationId_idx" ON "EdemaRecord"("organizationId");

-- CreateIndex
CREATE INDEX "EdemaRecord_communityId_idx" ON "EdemaRecord"("communityId");

-- CreateIndex
CREATE INDEX "ConcernRecord_dailyRoundId_idx" ON "ConcernRecord"("dailyRoundId");

-- CreateIndex
CREATE INDEX "ConcernRecord_category_idx" ON "ConcernRecord"("category");

-- CreateIndex
CREATE INDEX "ConcernRecord_severity_idx" ON "ConcernRecord"("severity");

-- CreateIndex
CREATE INDEX "ConcernRecord_organizationId_idx" ON "ConcernRecord"("organizationId");

-- CreateIndex
CREATE INDEX "ConcernRecord_communityId_idx" ON "ConcernRecord"("communityId");

-- CreateIndex
CREATE INDEX "PainRecord_dailyRoundId_idx" ON "PainRecord"("dailyRoundId");

-- CreateIndex
CREATE INDEX "PainRecord_score_idx" ON "PainRecord"("score");

-- CreateIndex
CREATE INDEX "PainRecord_organizationId_idx" ON "PainRecord"("organizationId");

-- CreateIndex
CREATE INDEX "PainRecord_communityId_idx" ON "PainRecord"("communityId");

-- CreateIndex
CREATE INDEX "MoodRecord_dailyRoundId_idx" ON "MoodRecord"("dailyRoundId");

-- CreateIndex
CREATE INDEX "MoodRecord_mood_idx" ON "MoodRecord"("mood");

-- CreateIndex
CREATE INDEX "MoodRecord_organizationId_idx" ON "MoodRecord"("organizationId");

-- CreateIndex
CREATE INDEX "MoodRecord_communityId_idx" ON "MoodRecord"("communityId");

-- CreateIndex
CREATE UNIQUE INDEX "SleepRecord_dailyRoundId_key" ON "SleepRecord"("dailyRoundId");

-- CreateIndex
CREATE INDEX "SleepRecord_dailyRoundId_idx" ON "SleepRecord"("dailyRoundId");

-- CreateIndex
CREATE INDEX "SleepRecord_quality_idx" ON "SleepRecord"("quality");

-- CreateIndex
CREATE INDEX "SleepRecord_organizationId_idx" ON "SleepRecord"("organizationId");

-- CreateIndex
CREATE INDEX "SleepRecord_communityId_idx" ON "SleepRecord"("communityId");

-- CreateIndex
CREATE INDEX "MobilityRecord_dailyRoundId_idx" ON "MobilityRecord"("dailyRoundId");

-- CreateIndex
CREATE INDEX "MobilityRecord_activityType_idx" ON "MobilityRecord"("activityType");

-- CreateIndex
CREATE INDEX "MobilityRecord_fallOccurred_idx" ON "MobilityRecord"("fallOccurred");

-- CreateIndex
CREATE INDEX "MobilityRecord_organizationId_idx" ON "MobilityRecord"("organizationId");

-- CreateIndex
CREATE INDEX "MobilityRecord_communityId_idx" ON "MobilityRecord"("communityId");

-- CreateIndex
CREATE INDEX "MealRecord_dailyRoundId_idx" ON "MealRecord"("dailyRoundId");

-- CreateIndex
CREATE INDEX "MealRecord_mealType_idx" ON "MealRecord"("mealType");

-- CreateIndex
CREATE INDEX "MealRecord_organizationId_idx" ON "MealRecord"("organizationId");

-- CreateIndex
CREATE INDEX "MealRecord_communityId_idx" ON "MealRecord"("communityId");

-- CreateIndex
CREATE INDEX "VitalSigns_dailyRoundId_idx" ON "VitalSigns"("dailyRoundId");

-- CreateIndex
CREATE INDEX "VitalSigns_time_idx" ON "VitalSigns"("time");

-- CreateIndex
CREATE INDEX "VitalSigns_organizationId_idx" ON "VitalSigns"("organizationId");

-- CreateIndex
CREATE INDEX "VitalSigns_communityId_idx" ON "VitalSigns"("communityId");

-- CreateIndex
CREATE INDEX "SecurityLog_communityId_idx" ON "SecurityLog"("communityId");

-- CreateIndex
CREATE INDEX "SecurityLog_organizationId_idx" ON "SecurityLog"("organizationId");

-- CreateIndex
CREATE INDEX "SecurityLog_logType_idx" ON "SecurityLog"("logType");

-- CreateIndex
CREATE INDEX "SecurityLog_occurredAt_idx" ON "SecurityLog"("occurredAt");

-- CreateIndex
CREATE INDEX "DietOrder_communityId_idx" ON "DietOrder"("communityId");

-- CreateIndex
CREATE INDEX "DietOrder_organizationId_idx" ON "DietOrder"("organizationId");

-- CreateIndex
CREATE INDEX "DietOrder_residentId_idx" ON "DietOrder"("residentId");

-- CreateIndex
CREATE INDEX "DietOrder_active_idx" ON "DietOrder"("active");

-- AddForeignKey
ALTER TABLE "Resident" ADD CONSTRAINT "Resident_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resident" ADD CONSTRAINT "Resident_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resident" ADD CONSTRAINT "Resident_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resident" ADD CONSTRAINT "Resident_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resident" ADD CONSTRAINT "Resident_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resident" ADD CONSTRAINT "Resident_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resident" ADD CONSTRAINT "Resident_currentCarePackageId_fkey" FOREIGN KEY ("currentCarePackageId") REFERENCES "CarePackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VitalsLog" ADD CONSTRAINT "VitalsLog_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medication" ADD CONSTRAINT "Medication_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResidentGoal" ADD CONSTRAINT "ResidentGoal_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationLog" ADD CONSTRAINT "MedicationLog_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationLog" ADD CONSTRAINT "MedicationLog_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "Medication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_serviceCatalogId_fkey" FOREIGN KEY ("serviceCatalogId") REFERENCES "ServiceCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeTracking" ADD CONSTRAINT "TimeTracking_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalNote" ADD CONSTRAINT "MedicalNote_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallBell" ADD CONSTRAINT "CallBell_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftReport" ADD CONSTRAINT "ShiftReport_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftReport" ADD CONSTRAINT "ShiftReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResidentNote" ADD CONSTRAINT "ResidentNote_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSetting" ADD CONSTRAINT "AppSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSetting" ADD CONSTRAINT "AppSetting_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Floor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Community" ADD CONSTRAINT "Community_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMembership" ADD CONSTRAINT "CommunityMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMembership" ADD CONSTRAINT "CommunityMembership_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResidentAccess" ADD CONSTRAINT "ResidentAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResidentAccess" ADD CONSTRAINT "ResidentAccess_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanEntitlement" ADD CONSTRAINT "PlanEntitlement_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageSnapshot" ADD CONSTRAINT "UsageSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageSnapshot" ADD CONSTRAINT "UsageSnapshot_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Floor" ADD CONSTRAINT "Floor_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Floor" ADD CONSTRAINT "Floor_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Floor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcuityScore" ADD CONSTRAINT "AcuityScore_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcuityScore" ADD CONSTRAINT "AcuityScore_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcuityScore" ADD CONSTRAINT "AcuityScore_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCatalog" ADD CONSTRAINT "ServiceCatalog_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePackage" ADD CONSTRAINT "CarePackage_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePackageItem" ADD CONSTRAINT "CarePackageItem_carePackageId_fkey" FOREIGN KEY ("carePackageId") REFERENCES "CarePackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePackageItem" ADD CONSTRAINT "CarePackageItem_serviceCatalogId_fkey" FOREIGN KEY ("serviceCatalogId") REFERENCES "ServiceCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunitySop" ADD CONSTRAINT "CommunitySop_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competency" ADD CONSTRAINT "Competency_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffCompetency" ADD CONSTRAINT "StaffCompetency_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffCompetency" ADD CONSTRAINT "StaffCompetency_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffCompetency" ADD CONSTRAINT "StaffCompetency_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResidentQualityScore" ADD CONSTRAINT "ResidentQualityScore_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResidentQualityScore" ADD CONSTRAINT "ResidentQualityScore_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityQualityDashboard" ADD CONSTRAINT "CommunityQualityDashboard_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiRecord" ADD CONSTRAINT "KpiRecord_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingPlan" ADD CONSTRAINT "StaffingPlan_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingPlan" ADD CONSTRAINT "StaffingPlan_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vaccination" ADD CONSTRAINT "Vaccination_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResidentDocument" ADD CONSTRAINT "ResidentDocument_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EliminationLog" ADD CONSTRAINT "EliminationLog_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PainAssessment" ADD CONSTRAINT "PainAssessment_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WoundCare" ADD CONSTRAINT "WoundCare_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SleepLog" ADD CONSTRAINT "SleepLog_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobilityLog" ADD CONSTRAINT "MobilityLog_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePlan" ADD CONSTRAINT "CarePlan_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePlanItem" ADD CONSTRAINT "CarePlanItem_carePlanId_fkey" FOREIGN KEY ("carePlanId") REFERENCES "CarePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePlanReview" ADD CONSTRAINT "CarePlanReview_carePlanId_fkey" FOREIGN KEY ("carePlanId") REFERENCES "CarePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HospitalReferral" ADD CONSTRAINT "HospitalReferral_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareTimelineEntry" ADD CONSTRAINT "CareTimelineEntry_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAlert" ADD CONSTRAINT "InventoryAlert_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationAdministration" ADD CONSTRAINT "MedicationAdministration_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "Medication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationAdministration" ADD CONSTRAINT "MedicationAdministration_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationChangeLog" ADD CONSTRAINT "MedicationChangeLog_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "Medication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicianCommunication" ADD CONSTRAINT "PhysicianCommunication_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCharge" ADD CONSTRAINT "ServiceCharge_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCharge" ADD CONSTRAINT "ServiceCharge_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceValidation" ADD CONSTRAINT "InsuranceValidation_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRequest" ADD CONSTRAINT "TransportRequest_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TransportRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleMaintenance" ADD CONSTRAINT "VehicleMaintenance_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelLog" ADD CONSTRAINT "FuelLog_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelLog" ADD CONSTRAINT "FuelLog_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DietitianConsult" ADD CONSTRAINT "DietitianConsult_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConciergeBooking" ADD CONSTRAINT "ConciergeBooking_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrontDeskVisit" ADD CONSTRAINT "FrontDeskVisit_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResidentPreference" ADD CONSTRAINT "ResidentPreference_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAttendance" ADD CONSTRAINT "EventAttendance_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CommunityEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAttendance" ADD CONSTRAINT "EventAttendance_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiningReservation" ADD CONSTRAINT "DiningReservation_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CameraMonitoringLog" ADD CONSTRAINT "CameraMonitoringLog_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRound" ADD CONSTRAINT "DailyRound_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BowelRecord" ADD CONSTRAINT "BowelRecord_dailyRoundId_fkey" FOREIGN KEY ("dailyRoundId") REFERENCES "DailyRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UrineRecord" ADD CONSTRAINT "UrineRecord_dailyRoundId_fkey" FOREIGN KEY ("dailyRoundId") REFERENCES "DailyRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EdemaRecord" ADD CONSTRAINT "EdemaRecord_dailyRoundId_fkey" FOREIGN KEY ("dailyRoundId") REFERENCES "DailyRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConcernRecord" ADD CONSTRAINT "ConcernRecord_dailyRoundId_fkey" FOREIGN KEY ("dailyRoundId") REFERENCES "DailyRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PainRecord" ADD CONSTRAINT "PainRecord_dailyRoundId_fkey" FOREIGN KEY ("dailyRoundId") REFERENCES "DailyRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoodRecord" ADD CONSTRAINT "MoodRecord_dailyRoundId_fkey" FOREIGN KEY ("dailyRoundId") REFERENCES "DailyRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SleepRecord" ADD CONSTRAINT "SleepRecord_dailyRoundId_fkey" FOREIGN KEY ("dailyRoundId") REFERENCES "DailyRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobilityRecord" ADD CONSTRAINT "MobilityRecord_dailyRoundId_fkey" FOREIGN KEY ("dailyRoundId") REFERENCES "DailyRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealRecord" ADD CONSTRAINT "MealRecord_dailyRoundId_fkey" FOREIGN KEY ("dailyRoundId") REFERENCES "DailyRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VitalSigns" ADD CONSTRAINT "VitalSigns_dailyRoundId_fkey" FOREIGN KEY ("dailyRoundId") REFERENCES "DailyRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

