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

-- DropIndex
DROP INDEX "Resident_roomNumber_key";

-- DropIndex
DROP INDEX "Room_roomNumber_key";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "authUserId" TEXT,
ADD COLUMN     "platformRole" "PlatformRole";

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "VitalsLog" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Medication" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ResidentGoal" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "MedicationLog" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "TimeTracking" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "MedicalNote" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "CallBell" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ShiftReport" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ResidentNote" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "KnowledgeDoc" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "AppSetting" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "key" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "branding" JSONB,
ADD COLUMN     "emailFromName" TEXT,
ADD COLUMN     "primaryColor" TEXT,
ADD COLUMN     "secondaryColor" TEXT,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "Community" ADD COLUMN     "code" TEXT,
ADD COLUMN     "configuration" JSONB,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "primaryColor" TEXT,
ADD COLUMN     "secondaryColor" TEXT;

-- AlterTable
ALTER TABLE "Building" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Floor" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "AcuityScore" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ServiceCatalog" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "CarePackage" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "CarePackageItem" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "CommunitySop" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Competency" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "StaffCompetency" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ResidentQualityScore" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "CommunityQualityDashboard" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "KpiRecord" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Observation" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "StaffingPlan" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Vaccination" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ResidentDocument" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "EliminationLog" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "PainAssessment" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "WoundCare" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "SleepLog" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "MobilityLog" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "CarePlan" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "CarePlanItem" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "CarePlanReview" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "HospitalReferral" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "FollowUp" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "CareTimelineEntry" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "GeneratedReport" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "InventoryAlert" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "MedicationAdministration" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "MedicationChangeLog" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Admission" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ServiceCharge" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "InsuranceValidation" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "BlogPost" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "SiteContent" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "TransportRequest" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "VehicleMaintenance" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "FuelLog" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "CustomPage" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "DailyMenu" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "DietitianConsult" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "FoodComplianceLog" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ServiceRequest" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "FacilityMaintenance" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ConciergeBooking" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "FrontDeskVisit" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "RoomTurnover" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ResidentPreference" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "CommunityEvent" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "EventAttendance" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "DiningReservation" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "CameraMonitoringLog" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Escalation" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "DailyRound" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "BowelRecord" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "UrineRecord" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "EdemaRecord" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ConcernRecord" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "PainRecord" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "MoodRecord" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "SleepRecord" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "MobilityRecord" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "MealRecord" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "VitalSigns" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "organizationId" TEXT;

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
CREATE UNIQUE INDEX "User_authUserId_key" ON "User"("authUserId");

-- CreateIndex
CREATE INDEX "User_platformRole_idx" ON "User"("platformRole");

-- CreateIndex
CREATE INDEX "Resident_organizationId_idx" ON "Resident"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Resident_communityId_roomNumber_key" ON "Resident"("communityId", "roomNumber");

-- CreateIndex
CREATE INDEX "Staff_organizationId_idx" ON "Staff"("organizationId");

-- CreateIndex
CREATE INDEX "VitalsLog_organizationId_idx" ON "VitalsLog"("organizationId");

-- CreateIndex
CREATE INDEX "VitalsLog_communityId_idx" ON "VitalsLog"("communityId");

-- CreateIndex
CREATE INDEX "Incident_organizationId_idx" ON "Incident"("organizationId");

-- CreateIndex
CREATE INDEX "Incident_communityId_idx" ON "Incident"("communityId");

-- CreateIndex
CREATE INDEX "Medication_organizationId_idx" ON "Medication"("organizationId");

-- CreateIndex
CREATE INDEX "Medication_communityId_idx" ON "Medication"("communityId");

-- CreateIndex
CREATE INDEX "ResidentGoal_organizationId_idx" ON "ResidentGoal"("organizationId");

-- CreateIndex
CREATE INDEX "ResidentGoal_communityId_idx" ON "ResidentGoal"("communityId");

-- CreateIndex
CREATE INDEX "MedicationLog_organizationId_idx" ON "MedicationLog"("organizationId");

-- CreateIndex
CREATE INDEX "MedicationLog_communityId_idx" ON "MedicationLog"("communityId");

-- CreateIndex
CREATE INDEX "Task_organizationId_idx" ON "Task"("organizationId");

-- CreateIndex
CREATE INDEX "Message_organizationId_idx" ON "Message"("organizationId");

-- CreateIndex
CREATE INDEX "Message_communityId_idx" ON "Message"("communityId");

-- CreateIndex
CREATE INDEX "TimeTracking_organizationId_idx" ON "TimeTracking"("organizationId");

-- CreateIndex
CREATE INDEX "TimeTracking_communityId_idx" ON "TimeTracking"("communityId");

-- CreateIndex
CREATE INDEX "MedicalNote_organizationId_idx" ON "MedicalNote"("organizationId");

-- CreateIndex
CREATE INDEX "MedicalNote_communityId_idx" ON "MedicalNote"("communityId");

-- CreateIndex
CREATE INDEX "CallBell_organizationId_idx" ON "CallBell"("organizationId");

-- CreateIndex
CREATE INDEX "CallBell_communityId_idx" ON "CallBell"("communityId");

-- CreateIndex
CREATE INDEX "ShiftReport_organizationId_idx" ON "ShiftReport"("organizationId");

-- CreateIndex
CREATE INDEX "ShiftReport_communityId_idx" ON "ShiftReport"("communityId");

-- CreateIndex
CREATE INDEX "Notification_organizationId_idx" ON "Notification"("organizationId");

-- CreateIndex
CREATE INDEX "Notification_communityId_idx" ON "Notification"("communityId");

-- CreateIndex
CREATE INDEX "Visit_organizationId_idx" ON "Visit"("organizationId");

-- CreateIndex
CREATE INDEX "Visit_communityId_idx" ON "Visit"("communityId");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_idx" ON "Invoice"("organizationId");

-- CreateIndex
CREATE INDEX "Invoice_communityId_idx" ON "Invoice"("communityId");

-- CreateIndex
CREATE INDEX "ResidentNote_organizationId_idx" ON "ResidentNote"("organizationId");

-- CreateIndex
CREATE INDEX "ResidentNote_communityId_idx" ON "ResidentNote"("communityId");

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
CREATE INDEX "Room_organizationId_idx" ON "Room"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Room_communityId_roomNumber_key" ON "Room"("communityId", "roomNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_status_idx" ON "Organization"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Community_organizationId_code_key" ON "Community"("organizationId", "code");

-- CreateIndex
CREATE INDEX "Building_organizationId_idx" ON "Building"("organizationId");

-- CreateIndex
CREATE INDEX "Floor_organizationId_idx" ON "Floor"("organizationId");

-- CreateIndex
CREATE INDEX "Unit_organizationId_idx" ON "Unit"("organizationId");

-- CreateIndex
CREATE INDEX "Assessment_organizationId_idx" ON "Assessment"("organizationId");

-- CreateIndex
CREATE INDEX "AcuityScore_organizationId_idx" ON "AcuityScore"("organizationId");

-- CreateIndex
CREATE INDEX "ServiceCatalog_organizationId_idx" ON "ServiceCatalog"("organizationId");

-- CreateIndex
CREATE INDEX "CarePackage_organizationId_idx" ON "CarePackage"("organizationId");

-- CreateIndex
CREATE INDEX "CarePackageItem_organizationId_idx" ON "CarePackageItem"("organizationId");

-- CreateIndex
CREATE INDEX "CarePackageItem_communityId_idx" ON "CarePackageItem"("communityId");

-- CreateIndex
CREATE INDEX "CommunitySop_organizationId_idx" ON "CommunitySop"("organizationId");

-- CreateIndex
CREATE INDEX "Competency_organizationId_idx" ON "Competency"("organizationId");

-- CreateIndex
CREATE INDEX "StaffCompetency_organizationId_idx" ON "StaffCompetency"("organizationId");

-- CreateIndex
CREATE INDEX "StaffCompetency_communityId_idx" ON "StaffCompetency"("communityId");

-- CreateIndex
CREATE INDEX "ResidentQualityScore_organizationId_idx" ON "ResidentQualityScore"("organizationId");

-- CreateIndex
CREATE INDEX "CommunityQualityDashboard_organizationId_idx" ON "CommunityQualityDashboard"("organizationId");

-- CreateIndex
CREATE INDEX "KpiRecord_organizationId_idx" ON "KpiRecord"("organizationId");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_idx" ON "AuditLog"("organizationId");

-- CreateIndex
CREATE INDEX "Observation_organizationId_idx" ON "Observation"("organizationId");

-- CreateIndex
CREATE INDEX "StaffingPlan_organizationId_idx" ON "StaffingPlan"("organizationId");

-- CreateIndex
CREATE INDEX "Vaccination_organizationId_idx" ON "Vaccination"("organizationId");

-- CreateIndex
CREATE INDEX "Vaccination_communityId_idx" ON "Vaccination"("communityId");

-- CreateIndex
CREATE INDEX "ResidentDocument_organizationId_idx" ON "ResidentDocument"("organizationId");

-- CreateIndex
CREATE INDEX "ResidentDocument_communityId_idx" ON "ResidentDocument"("communityId");

-- CreateIndex
CREATE INDEX "EliminationLog_organizationId_idx" ON "EliminationLog"("organizationId");

-- CreateIndex
CREATE INDEX "EliminationLog_communityId_idx" ON "EliminationLog"("communityId");

-- CreateIndex
CREATE INDEX "PainAssessment_organizationId_idx" ON "PainAssessment"("organizationId");

-- CreateIndex
CREATE INDEX "PainAssessment_communityId_idx" ON "PainAssessment"("communityId");

-- CreateIndex
CREATE INDEX "WoundCare_organizationId_idx" ON "WoundCare"("organizationId");

-- CreateIndex
CREATE INDEX "WoundCare_communityId_idx" ON "WoundCare"("communityId");

-- CreateIndex
CREATE INDEX "SleepLog_organizationId_idx" ON "SleepLog"("organizationId");

-- CreateIndex
CREATE INDEX "SleepLog_communityId_idx" ON "SleepLog"("communityId");

-- CreateIndex
CREATE INDEX "MobilityLog_organizationId_idx" ON "MobilityLog"("organizationId");

-- CreateIndex
CREATE INDEX "MobilityLog_communityId_idx" ON "MobilityLog"("communityId");

-- CreateIndex
CREATE INDEX "CarePlan_organizationId_idx" ON "CarePlan"("organizationId");

-- CreateIndex
CREATE INDEX "CarePlan_communityId_idx" ON "CarePlan"("communityId");

-- CreateIndex
CREATE INDEX "CarePlanItem_organizationId_idx" ON "CarePlanItem"("organizationId");

-- CreateIndex
CREATE INDEX "CarePlanItem_communityId_idx" ON "CarePlanItem"("communityId");

-- CreateIndex
CREATE INDEX "CarePlanReview_organizationId_idx" ON "CarePlanReview"("organizationId");

-- CreateIndex
CREATE INDEX "CarePlanReview_communityId_idx" ON "CarePlanReview"("communityId");

-- CreateIndex
CREATE INDEX "HospitalReferral_organizationId_idx" ON "HospitalReferral"("organizationId");

-- CreateIndex
CREATE INDEX "HospitalReferral_communityId_idx" ON "HospitalReferral"("communityId");

-- CreateIndex
CREATE INDEX "FollowUp_organizationId_idx" ON "FollowUp"("organizationId");

-- CreateIndex
CREATE INDEX "FollowUp_communityId_idx" ON "FollowUp"("communityId");

-- CreateIndex
CREATE INDEX "CareTimelineEntry_organizationId_idx" ON "CareTimelineEntry"("organizationId");

-- CreateIndex
CREATE INDEX "CareTimelineEntry_communityId_idx" ON "CareTimelineEntry"("communityId");

-- CreateIndex
CREATE INDEX "GeneratedReport_organizationId_idx" ON "GeneratedReport"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryAlert_organizationId_idx" ON "InventoryAlert"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryAlert_communityId_idx" ON "InventoryAlert"("communityId");

-- CreateIndex
CREATE INDEX "MedicationAdministration_organizationId_idx" ON "MedicationAdministration"("organizationId");

-- CreateIndex
CREATE INDEX "MedicationAdministration_communityId_idx" ON "MedicationAdministration"("communityId");

-- CreateIndex
CREATE INDEX "MedicationChangeLog_organizationId_idx" ON "MedicationChangeLog"("organizationId");

-- CreateIndex
CREATE INDEX "MedicationChangeLog_communityId_idx" ON "MedicationChangeLog"("communityId");

-- CreateIndex
CREATE INDEX "InventoryItem_organizationId_idx" ON "InventoryItem"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryItem_communityId_idx" ON "InventoryItem"("communityId");

-- CreateIndex
CREATE INDEX "Admission_organizationId_idx" ON "Admission"("organizationId");

-- CreateIndex
CREATE INDEX "Admission_communityId_idx" ON "Admission"("communityId");

-- CreateIndex
CREATE INDEX "ServiceCharge_organizationId_idx" ON "ServiceCharge"("organizationId");

-- CreateIndex
CREATE INDEX "ServiceCharge_communityId_idx" ON "ServiceCharge"("communityId");

-- CreateIndex
CREATE INDEX "InsuranceValidation_organizationId_idx" ON "InsuranceValidation"("organizationId");

-- CreateIndex
CREATE INDEX "InsuranceValidation_communityId_idx" ON "InsuranceValidation"("communityId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_idx" ON "Payment"("organizationId");

-- CreateIndex
CREATE INDEX "Payment_communityId_idx" ON "Payment"("communityId");

-- CreateIndex
CREATE INDEX "BlogPost_organizationId_idx" ON "BlogPost"("organizationId");

-- CreateIndex
CREATE INDEX "BlogPost_communityId_idx" ON "BlogPost"("communityId");

-- CreateIndex
CREATE INDEX "SiteContent_organizationId_idx" ON "SiteContent"("organizationId");

-- CreateIndex
CREATE INDEX "SiteContent_communityId_idx" ON "SiteContent"("communityId");

-- CreateIndex
CREATE INDEX "Vehicle_organizationId_idx" ON "Vehicle"("organizationId");

-- CreateIndex
CREATE INDEX "Vehicle_communityId_idx" ON "Vehicle"("communityId");

-- CreateIndex
CREATE INDEX "Driver_organizationId_idx" ON "Driver"("organizationId");

-- CreateIndex
CREATE INDEX "Driver_communityId_idx" ON "Driver"("communityId");

-- CreateIndex
CREATE INDEX "TransportRequest_organizationId_idx" ON "TransportRequest"("organizationId");

-- CreateIndex
CREATE INDEX "TransportRequest_communityId_idx" ON "TransportRequest"("communityId");

-- CreateIndex
CREATE INDEX "Trip_organizationId_idx" ON "Trip"("organizationId");

-- CreateIndex
CREATE INDEX "Trip_communityId_idx" ON "Trip"("communityId");

-- CreateIndex
CREATE INDEX "VehicleMaintenance_organizationId_idx" ON "VehicleMaintenance"("organizationId");

-- CreateIndex
CREATE INDEX "VehicleMaintenance_communityId_idx" ON "VehicleMaintenance"("communityId");

-- CreateIndex
CREATE INDEX "FuelLog_organizationId_idx" ON "FuelLog"("organizationId");

-- CreateIndex
CREATE INDEX "FuelLog_communityId_idx" ON "FuelLog"("communityId");

-- CreateIndex
CREATE INDEX "CustomPage_organizationId_idx" ON "CustomPage"("organizationId");

-- CreateIndex
CREATE INDEX "CustomPage_communityId_idx" ON "CustomPage"("communityId");

-- CreateIndex
CREATE INDEX "DailyMenu_organizationId_idx" ON "DailyMenu"("organizationId");

-- CreateIndex
CREATE INDEX "DailyMenu_communityId_idx" ON "DailyMenu"("communityId");

-- CreateIndex
CREATE INDEX "DietitianConsult_organizationId_idx" ON "DietitianConsult"("organizationId");

-- CreateIndex
CREATE INDEX "DietitianConsult_communityId_idx" ON "DietitianConsult"("communityId");

-- CreateIndex
CREATE INDEX "FoodComplianceLog_organizationId_idx" ON "FoodComplianceLog"("organizationId");

-- CreateIndex
CREATE INDEX "FoodComplianceLog_communityId_idx" ON "FoodComplianceLog"("communityId");

-- CreateIndex
CREATE INDEX "ServiceRequest_organizationId_idx" ON "ServiceRequest"("organizationId");

-- CreateIndex
CREATE INDEX "ServiceRequest_communityId_idx" ON "ServiceRequest"("communityId");

-- CreateIndex
CREATE INDEX "FacilityMaintenance_organizationId_idx" ON "FacilityMaintenance"("organizationId");

-- CreateIndex
CREATE INDEX "FacilityMaintenance_communityId_idx" ON "FacilityMaintenance"("communityId");

-- CreateIndex
CREATE INDEX "ConciergeBooking_organizationId_idx" ON "ConciergeBooking"("organizationId");

-- CreateIndex
CREATE INDEX "ConciergeBooking_communityId_idx" ON "ConciergeBooking"("communityId");

-- CreateIndex
CREATE INDEX "FrontDeskVisit_organizationId_idx" ON "FrontDeskVisit"("organizationId");

-- CreateIndex
CREATE INDEX "FrontDeskVisit_communityId_idx" ON "FrontDeskVisit"("communityId");

-- CreateIndex
CREATE INDEX "RoomTurnover_organizationId_idx" ON "RoomTurnover"("organizationId");

-- CreateIndex
CREATE INDEX "RoomTurnover_communityId_idx" ON "RoomTurnover"("communityId");

-- CreateIndex
CREATE INDEX "ResidentPreference_organizationId_idx" ON "ResidentPreference"("organizationId");

-- CreateIndex
CREATE INDEX "ResidentPreference_communityId_idx" ON "ResidentPreference"("communityId");

-- CreateIndex
CREATE INDEX "CommunityEvent_organizationId_idx" ON "CommunityEvent"("organizationId");

-- CreateIndex
CREATE INDEX "CommunityEvent_communityId_idx" ON "CommunityEvent"("communityId");

-- CreateIndex
CREATE INDEX "EventAttendance_organizationId_idx" ON "EventAttendance"("organizationId");

-- CreateIndex
CREATE INDEX "EventAttendance_communityId_idx" ON "EventAttendance"("communityId");

-- CreateIndex
CREATE INDEX "DiningReservation_organizationId_idx" ON "DiningReservation"("organizationId");

-- CreateIndex
CREATE INDEX "DiningReservation_communityId_idx" ON "DiningReservation"("communityId");

-- CreateIndex
CREATE INDEX "Announcement_organizationId_idx" ON "Announcement"("organizationId");

-- CreateIndex
CREATE INDEX "Announcement_communityId_idx" ON "Announcement"("communityId");

-- CreateIndex
CREATE INDEX "CameraMonitoringLog_organizationId_idx" ON "CameraMonitoringLog"("organizationId");

-- CreateIndex
CREATE INDEX "CameraMonitoringLog_communityId_idx" ON "CameraMonitoringLog"("communityId");

-- CreateIndex
CREATE INDEX "Escalation_organizationId_idx" ON "Escalation"("organizationId");

-- CreateIndex
CREATE INDEX "Escalation_communityId_idx" ON "Escalation"("communityId");

-- CreateIndex
CREATE INDEX "DailyRound_organizationId_idx" ON "DailyRound"("organizationId");

-- CreateIndex
CREATE INDEX "DailyRound_communityId_idx" ON "DailyRound"("communityId");

-- CreateIndex
CREATE INDEX "BowelRecord_organizationId_idx" ON "BowelRecord"("organizationId");

-- CreateIndex
CREATE INDEX "BowelRecord_communityId_idx" ON "BowelRecord"("communityId");

-- CreateIndex
CREATE INDEX "UrineRecord_organizationId_idx" ON "UrineRecord"("organizationId");

-- CreateIndex
CREATE INDEX "UrineRecord_communityId_idx" ON "UrineRecord"("communityId");

-- CreateIndex
CREATE INDEX "EdemaRecord_organizationId_idx" ON "EdemaRecord"("organizationId");

-- CreateIndex
CREATE INDEX "EdemaRecord_communityId_idx" ON "EdemaRecord"("communityId");

-- CreateIndex
CREATE INDEX "ConcernRecord_organizationId_idx" ON "ConcernRecord"("organizationId");

-- CreateIndex
CREATE INDEX "ConcernRecord_communityId_idx" ON "ConcernRecord"("communityId");

-- CreateIndex
CREATE INDEX "PainRecord_organizationId_idx" ON "PainRecord"("organizationId");

-- CreateIndex
CREATE INDEX "PainRecord_communityId_idx" ON "PainRecord"("communityId");

-- CreateIndex
CREATE INDEX "MoodRecord_organizationId_idx" ON "MoodRecord"("organizationId");

-- CreateIndex
CREATE INDEX "MoodRecord_communityId_idx" ON "MoodRecord"("communityId");

-- CreateIndex
CREATE INDEX "SleepRecord_organizationId_idx" ON "SleepRecord"("organizationId");

-- CreateIndex
CREATE INDEX "SleepRecord_communityId_idx" ON "SleepRecord"("communityId");

-- CreateIndex
CREATE INDEX "MobilityRecord_organizationId_idx" ON "MobilityRecord"("organizationId");

-- CreateIndex
CREATE INDEX "MobilityRecord_communityId_idx" ON "MobilityRecord"("communityId");

-- CreateIndex
CREATE INDEX "MealRecord_organizationId_idx" ON "MealRecord"("organizationId");

-- CreateIndex
CREATE INDEX "MealRecord_communityId_idx" ON "MealRecord"("communityId");

-- CreateIndex
CREATE INDEX "VitalSigns_organizationId_idx" ON "VitalSigns"("organizationId");

-- CreateIndex
CREATE INDEX "VitalSigns_communityId_idx" ON "VitalSigns"("communityId");

-- AddForeignKey
ALTER TABLE "Resident" ADD CONSTRAINT "Resident_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSetting" ADD CONSTRAINT "AppSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSetting" ADD CONSTRAINT "AppSetting_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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


-- Backfill the existing single-facility installation into its first SaaS tenant.
-- Tenant columns stay nullable in this compatibility migration; a later cutover
-- migration can make them NOT NULL after the exception report is empty.
DO $$
DECLARE
  v_org_id text;
  v_community_id text;
  v_plan_id text;
  tenant_table record;
BEGIN
  SELECT "id" INTO v_org_id FROM "Organization" ORDER BY "createdAt" LIMIT 1;
  IF v_org_id IS NULL THEN
    v_org_id := gen_random_uuid()::text;
    INSERT INTO "Organization" ("id", "name", "slug", "status", "isActive", "createdAt", "updatedAt")
    VALUES (v_org_id, 'Migrated Organization', 'migrated-organization', 'ACTIVE', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
  ELSE
    UPDATE "Organization"
      SET "slug" = COALESCE("slug", 'organization-' || left("id", 8)), "status" = 'ACTIVE'
      WHERE "id" = v_org_id;
  END IF;

  SELECT "id" INTO v_community_id FROM "Community" WHERE "organizationId" = v_org_id ORDER BY "createdAt" LIMIT 1;
  IF v_community_id IS NULL THEN
    v_community_id := gen_random_uuid()::text;
    INSERT INTO "Community" ("id", "organizationId", "name", "code", "timezone", "communityType", "isActive", "createdAt", "updatedAt")
    VALUES (v_community_id, v_org_id, 'Primary Community', 'PRIMARY', 'America/New_York', 'ASSISTED_LIVING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
  ELSE
    UPDATE "Community" SET "code" = COALESCE("code", 'PRIMARY') WHERE "id" = v_community_id;
  END IF;

  -- Derive unique setting keys before tenant IDs are populated, otherwise the tenant-aware unique index would collide.
  UPDATE "AppSetting" SET "key" = "id" WHERE "key" = '';

  -- Every table that already exposes these additive scope columns receives a
  -- deterministic default. Relationship-derived tenant checks remain in place.
  FOR tenant_table IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'communityId'
      AND table_name NOT IN ('BlogPost', 'SiteContent', 'CustomPage')
  LOOP
    EXECUTE format('UPDATE %I SET "communityId" = $1 WHERE "communityId" IS NULL', tenant_table.table_name)
      USING v_community_id;
  END LOOP;
  FOR tenant_table IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'organizationId'
      AND table_name NOT IN ('Community', 'BlogPost', 'SiteContent', 'CustomPage')
  LOOP
    EXECUTE format('UPDATE %I SET "organizationId" = $1 WHERE "organizationId" IS NULL', tenant_table.table_name)
      USING v_org_id;
  END LOOP;

  UPDATE "User" SET "platformRole" = 'PLATFORM_ADMIN' WHERE "role" = 'SUPERADMIN' AND "platformRole" IS NULL;

  INSERT INTO "OrganizationMembership" ("id", "userId", "organizationId", "role", "status", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, u."id", v_org_id,
    CASE WHEN u."role" = 'FACILITY_ADMIN' THEN 'ADMIN'::"OrganizationRole" ELSE 'VIEWER'::"OrganizationRole" END,
    'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "User" u
  WHERE u."role" <> 'SUPERADMIN'
  ON CONFLICT ("userId", "organizationId") DO NOTHING;

  INSERT INTO "CommunityMembership" ("id", "userId", "communityId", "role", "status", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, u."id", COALESCE(s."communityId", v_community_id), u."role", 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "User" u
  LEFT JOIN "Staff" s ON s."userId" = u."id"
  WHERE u."role" NOT IN ('SUPERADMIN', 'FAMILY', 'RESIDENT')
  ON CONFLICT ("userId", "communityId") DO NOTHING;

  INSERT INTO "ResidentAccess" ("id", "userId", "residentId", "accessRole", "isActive", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, r."sponsorId", r."id", 'FAMILY', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "Resident" r WHERE r."sponsorId" IS NOT NULL
  ON CONFLICT ("userId", "residentId") DO NOTHING;
  INSERT INTO "ResidentAccess" ("id", "userId", "residentId", "accessRole", "isActive", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, r."userId", r."id", 'RESIDENT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "Resident" r WHERE r."userId" IS NOT NULL
  ON CONFLICT ("userId", "residentId") DO NOTHING;

  SELECT "id" INTO v_plan_id FROM "Plan" WHERE "key" = 'LEGACY_MIGRATED';
  IF v_plan_id IS NULL THEN
    v_plan_id := gen_random_uuid()::text;
    INSERT INTO "Plan" ("id", "key", "name", "description", "maxCommunities", "maxActiveResidents", "maxStaffSeats", "isActive", "createdAt", "updatedAt")
    VALUES (v_plan_id, 'LEGACY_MIGRATED', 'Migrated Contract', 'Compatibility plan for the existing installation', 10, 1000, 1000, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
  END IF;
  INSERT INTO "Subscription" ("id", "organizationId", "planId", "status", "startsAt", "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, v_org_id, v_plan_id, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  ON CONFLICT ("organizationId") DO NOTHING;
END $$;