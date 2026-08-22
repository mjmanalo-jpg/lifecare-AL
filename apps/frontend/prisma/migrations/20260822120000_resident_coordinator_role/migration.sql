ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'RESIDENT_COORDINATOR';

CREATE TYPE "ServiceContext" AS ENUM ('FACILITY', 'HOME_CARE');
CREATE TYPE "CareShiftType" AS ENUM ('AM', 'PM', 'NOC', 'CUSTOM');
CREATE TYPE "CareShiftStatus" AS ENUM ('PLANNED', 'OPEN', 'CLOSED', 'CANCELLED');
CREATE TYPE "AssignmentAckStatus" AS ENUM ('PENDING', 'ACKNOWLEDGED');
CREATE TYPE "DashboardWorkStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED');
CREATE TYPE "HelpRequestKind" AS ENUM ('NEED_NURSE', 'NEED_HELP');
CREATE TYPE "ShiftHandoverStatus" AS ENUM ('DRAFT', 'SIGNED', 'ACCEPTED', 'AMENDED');

CREATE TABLE "CareShift" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "communityId" TEXT NOT NULL,
  "serviceContext" "ServiceContext" NOT NULL DEFAULT 'FACILITY', "shiftType" "CareShiftType" NOT NULL,
  "label" TEXT, "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3) NOT NULL,
  "status" "CareShiftStatus" NOT NULL DEFAULT 'PLANNED', "leadStaffId" TEXT,
  "openedAt" TIMESTAMP(3), "closedAt" TIMESTAMP(3), "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CareShift_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CareShift_communityId_serviceContext_shiftType_startsAt_key" ON "CareShift"("communityId", "serviceContext", "shiftType", "startsAt");
CREATE INDEX "CareShift_organizationId_communityId_startsAt_idx" ON "CareShift"("organizationId", "communityId", "startsAt");
CREATE INDEX "CareShift_communityId_status_startsAt_idx" ON "CareShift"("communityId", "status", "startsAt");

CREATE TABLE "ShiftStaffAssignment" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "communityId" TEXT NOT NULL, "shiftId" TEXT NOT NULL,
  "staffId" TEXT NOT NULL, "roleOnShift" TEXT NOT NULL, "zone" TEXT, "assignedById" TEXT,
  "acknowledgement" "AssignmentAckStatus" NOT NULL DEFAULT 'PENDING', "acknowledgedAt" TIMESTAMP(3),
  "activeFrom" TIMESTAMP(3) NOT NULL, "activeUntil" TIMESTAMP(3), "sourceLegacyId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShiftStaffAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShiftStaffAssignment_shiftId_staffId_activeFrom_key" ON "ShiftStaffAssignment"("shiftId", "staffId", "activeFrom");
CREATE INDEX "ShiftStaffAssignment_organizationId_communityId_shiftId_idx" ON "ShiftStaffAssignment"("organizationId", "communityId", "shiftId");
CREATE INDEX "ShiftStaffAssignment_staffId_activeFrom_activeUntil_idx" ON "ShiftStaffAssignment"("staffId", "activeFrom", "activeUntil");

CREATE TABLE "ShiftResidentAssignment" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "communityId" TEXT NOT NULL, "shiftId" TEXT NOT NULL,
  "residentId" TEXT NOT NULL, "primaryCaregiverStaffId" TEXT, "coveringNurseStaffId" TEXT,
  "assistanceLevelSnapshot" TEXT, "assignedById" TEXT,
  "acknowledgement" "AssignmentAckStatus" NOT NULL DEFAULT 'PENDING', "acknowledgedAt" TIMESTAMP(3),
  "activeFrom" TIMESTAMP(3) NOT NULL, "activeUntil" TIMESTAMP(3), "sourceLegacyId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShiftResidentAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShiftResidentAssignment_shiftId_residentId_activeFrom_key" ON "ShiftResidentAssignment"("shiftId", "residentId", "activeFrom");
CREATE INDEX "ShiftResidentAssignment_organizationId_communityId_shiftId_idx" ON "ShiftResidentAssignment"("organizationId", "communityId", "shiftId");
CREATE INDEX "ShiftResidentAssignment_residentId_activeFrom_activeUntil_idx" ON "ShiftResidentAssignment"("residentId", "activeFrom", "activeUntil");
CREATE INDEX "ShiftResidentAssignment_primaryCaregiverStaffId_activeFrom_activeUntil_idx" ON "ShiftResidentAssignment"("primaryCaregiverStaffId", "activeFrom", "activeUntil");

CREATE TABLE "AssignmentHistory" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "communityId" TEXT NOT NULL, "shiftId" TEXT,
  "assignmentType" TEXT NOT NULL, "assignmentId" TEXT NOT NULL, "previousValue" JSONB, "nextValue" JSONB NOT NULL,
  "reason" TEXT, "actorId" TEXT, "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssignmentHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AssignmentHistory_organizationId_communityId_occurredAt_idx" ON "AssignmentHistory"("organizationId", "communityId", "occurredAt");
CREATE INDEX "AssignmentHistory_assignmentType_assignmentId_occurredAt_idx" ON "AssignmentHistory"("assignmentType", "assignmentId", "occurredAt");
CREATE INDEX "AssignmentHistory_shiftId_occurredAt_idx" ON "AssignmentHistory"("shiftId", "occurredAt");

CREATE TABLE "ClinicalWorkItem" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "communityId" TEXT NOT NULL, "shiftId" TEXT,
  "residentId" TEXT, "sourceType" TEXT NOT NULL, "sourceId" TEXT NOT NULL, "queueClass" TEXT NOT NULL,
  "priority" TEXT NOT NULL, "clinicalState" TEXT NOT NULL, "ownerRole" TEXT, "ownerUserId" TEXT,
  "dueAt" TIMESTAMP(3), "status" "DashboardWorkStatus" NOT NULL DEFAULT 'OPEN', "disposition" TEXT,
  "resolvedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClinicalWorkItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClinicalWorkItem_sourceType_sourceId_queueClass_key" ON "ClinicalWorkItem"("sourceType", "sourceId", "queueClass");
CREATE INDEX "ClinicalWorkItem_organizationId_communityId_status_priority_idx" ON "ClinicalWorkItem"("organizationId", "communityId", "status", "priority");
CREATE INDEX "ClinicalWorkItem_shiftId_status_idx" ON "ClinicalWorkItem"("shiftId", "status");
CREATE INDEX "ClinicalWorkItem_residentId_status_idx" ON "ClinicalWorkItem"("residentId", "status");

CREATE TABLE "StaffHelpRequest" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "communityId" TEXT NOT NULL, "shiftId" TEXT,
  "residentId" TEXT NOT NULL, "taskId" TEXT, "kind" "HelpRequestKind" NOT NULL, "category" TEXT NOT NULL,
  "detail" TEXT NOT NULL, "observation" TEXT, "priority" TEXT NOT NULL, "requestedById" TEXT NOT NULL,
  "recipientRole" TEXT NOT NULL, "ownerUserId" TEXT, "status" "DashboardWorkStatus" NOT NULL DEFAULT 'OPEN',
  "acceptedAt" TIMESTAMP(3), "resolvedAt" TIMESTAMP(3), "escalationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StaffHelpRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StaffHelpRequest_organizationId_communityId_status_createdAt_idx" ON "StaffHelpRequest"("organizationId", "communityId", "status", "createdAt");
CREATE INDEX "StaffHelpRequest_shiftId_status_idx" ON "StaffHelpRequest"("shiftId", "status");
CREATE INDEX "StaffHelpRequest_residentId_createdAt_idx" ON "StaffHelpRequest"("residentId", "createdAt");
CREATE INDEX "StaffHelpRequest_requestedById_createdAt_idx" ON "StaffHelpRequest"("requestedById", "createdAt");

CREATE TABLE "ShiftHandover" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "communityId" TEXT NOT NULL,
  "outgoingShiftId" TEXT, "incomingShiftId" TEXT, "status" "ShiftHandoverStatus" NOT NULL DEFAULT 'DRAFT',
  "summary" TEXT, "outgoingSignedById" TEXT, "outgoingSignedAt" TIMESTAMP(3),
  "incomingAcceptedById" TEXT, "incomingAcceptedAt" TIMESTAMP(3), "amendmentReason" TEXT,
  "sourceLegacyId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShiftHandover_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ShiftHandover_organizationId_communityId_createdAt_idx" ON "ShiftHandover"("organizationId", "communityId", "createdAt");
CREATE INDEX "ShiftHandover_outgoingShiftId_status_idx" ON "ShiftHandover"("outgoingShiftId", "status");
CREATE INDEX "ShiftHandover_incomingShiftId_status_idx" ON "ShiftHandover"("incomingShiftId", "status");

CREATE TABLE "ShiftHandoverItem" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "communityId" TEXT NOT NULL, "handoverId" TEXT NOT NULL,
  "residentId" TEXT, "situation" TEXT NOT NULL, "background" TEXT, "assessment" TEXT,
  "recommendation" TEXT, "changeSummary" TEXT, "openRisk" TEXT, "medicationConcern" TEXT,
  "appointmentConcern" TEXT, "followUpOwnerRole" TEXT, "followUpOwnerId" TEXT, "dueAt" TIMESTAMP(3),
  "sourceLinks" JSONB, "resolvedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ShiftHandoverItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ShiftHandoverItem_organizationId_communityId_handoverId_idx" ON "ShiftHandoverItem"("organizationId", "communityId", "handoverId");
CREATE INDEX "ShiftHandoverItem_residentId_dueAt_idx" ON "ShiftHandoverItem"("residentId", "dueAt");
CREATE INDEX "ShiftHandoverItem_followUpOwnerId_dueAt_idx" ON "ShiftHandoverItem"("followUpOwnerId", "dueAt");

CREATE TABLE "MetricSnapshot" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "communityId" TEXT NOT NULL,
  "serviceContext" "ServiceContext" NOT NULL DEFAULT 'FACILITY', "metricKey" TEXT NOT NULL,
  "definitionVersion" TEXT NOT NULL, "windowStart" TIMESTAMP(3) NOT NULL, "windowEnd" TIMESTAMP(3) NOT NULL,
  "numerator" DOUBLE PRECISION NOT NULL, "denominator" DOUBLE PRECISION NOT NULL, "value" DOUBLE PRECISION,
  "exclusions" JSONB, "dimensions" JSONB, "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MetricSnapshot_communityId_serviceContext_metricKey_definitionVersion_windowStart_windowEnd_key" ON "MetricSnapshot"("communityId", "serviceContext", "metricKey", "definitionVersion", "windowStart", "windowEnd");
CREATE INDEX "MetricSnapshot_organizationId_communityId_metricKey_recordedAt_idx" ON "MetricSnapshot"("organizationId", "communityId", "metricKey", "recordedAt");

ALTER TABLE "CareShift" ADD CONSTRAINT "CareShift_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
ALTER TABLE "CareShift" ADD CONSTRAINT "CareShift_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE;
ALTER TABLE "ShiftStaffAssignment" ADD CONSTRAINT "ShiftStaffAssignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CareShift"("id") ON DELETE CASCADE;
ALTER TABLE "ShiftStaffAssignment" ADD CONSTRAINT "ShiftStaffAssignment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE;
ALTER TABLE "ShiftResidentAssignment" ADD CONSTRAINT "ShiftResidentAssignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CareShift"("id") ON DELETE CASCADE;
ALTER TABLE "ShiftResidentAssignment" ADD CONSTRAINT "ShiftResidentAssignment_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE;
ALTER TABLE "StaffHelpRequest" ADD CONSTRAINT "StaffHelpRequest_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE;
ALTER TABLE "StaffHelpRequest" ADD CONSTRAINT "StaffHelpRequest_handover_escalationId_fkey" FOREIGN KEY ("escalationId") REFERENCES "Escalation"("id") ON DELETE SET NULL;
ALTER TABLE "ShiftHandoverItem" ADD CONSTRAINT "ShiftHandoverItem_handoverId_fkey" FOREIGN KEY ("handoverId") REFERENCES "ShiftHandover"("id") ON DELETE CASCADE;
ALTER TABLE "ShiftHandoverItem" ADD CONSTRAINT "ShiftHandoverItem_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE SET NULL;
