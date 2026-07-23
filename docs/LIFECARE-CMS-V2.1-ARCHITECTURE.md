# LifeCare CMS v2.1 — Complete Solution Architecture & Feature Matrix

> **Document Type:** Solution Architecture & Development Blueprint
> **Version:** 2.1 (LCOS — LifeCare Care Operating System)
> **Generated:** 2026-07-17
> **Status:** Architecture Review Ready

---

## TABLE OF CONTENTS

1. [Executive Gap Analysis: v2.0 to v2.1](#1-executive-gap-analysis)
2. [Deliverable 1: Updated Solution Architecture](#2-deliverable-1-updated-solution-architecture)
3. [Deliverable 2: Canonical Data Model & ERD](#3-deliverable-2-canonical-data-model--erd)
4. [Deliverable 3: API Specifications](#4-deliverable-3-api-specifications)
5. [Deliverable 4: Workflow Diagrams](#5-deliverable-4-workflow-diagrams)
6. [Deliverable 5: UI Wireframes](#6-deliverable-5-ui-wireframes)
7. [Deliverable 6: Development Backlog](#7-deliverable-6-development-backlog)
8. [Deliverable 7: Testing & Validation Plan](#8-deliverable-7-testing--validation-plan)

---

# 1. EXECUTIVE GAP ANALYSIS

## 1.1 Current System Inventory (v2.0)

| Category | Count | Details |
|----------|-------|---------|
| Prisma Models | 50 | Residents, Staff, Vitals, Incidents, Medications, Tasks, Messages, etc. |
| Roles | 9 | SUPERADMIN, FACILITY_ADMIN, PHYSICIAN, NURSE, CAREGIVER, FAMILY, RESIDENT, FLEET_MANAGEMENT, DRIVER |
| API Endpoints | 25 route groups | Generic CRUD + specialized routes |
| Backend Routers | 12 | FastAPI: camera, voice, EHR, AI companion, call bell, vitals, medications, schedule, messages, room service, family, appointments |
| Frontend Components | 78 | Portal views, widgets, clinical modules |
| Enums | 43+ | Comprehensive status/type enumerations |

## 1.2 Feature Alignment Matrix

**Legend:** EXISTS (fully implemented) | PARTIAL (needs extension) | MISSING (must be built)

### A. CORE CARE INTELLIGENCE LOOP

| v2.1 Requirement | v2.0 Status | Gap Detail | Priority |
|---|---|---|---|
| Resident Assessment model | PARTIAL | Admission has careAssessment text field; rounds route exists as UI-only. No structured assessment model. | **P0** |
| Acuity Score (computed) | MISSING | No acuity scoring engine. Care level is manually set enum. | **P0** |
| Level of Care (derived) | PARTIAL | CareLevel enum exists but manually assigned, not derived from acuity. | **P0** |
| Care Package (service bundle) | MISSING | No concept of care package tied to care level. | **P0** |
| Service Catalog | PARTIAL | ServiceCharge is billing-only. No service catalog with SOPs, competencies, care minutes. | **P0** |
| Automated Task Generation | PARTIAL | Tasks exist but manually created. No auto-generation from care packages. | **P0** |
| Documentation Requirements | MISSING | No link between assessment outcomes and required documentation. | **P1** |
| Monitoring Frequency from acuity | PARTIAL | VitalsLog exists but vitals are manually recorded, not scheduled by acuity. | **P1** |
| Review Schedules | PARTIAL | ResidentGoal exists but no structured care plan review schedule. | **P1** |
| Quality Indicators | MISSING | No quality indicator computation. | **P0** |

### B. MULTI-TENANT HIERARCHY

| v2.1 Requirement | v2.0 Status | Gap Detail | Priority |
|---|---|---|---|
| Organization (tenant) | MISSING | Single-facility system. | **P0** |
| Community (facility) | PARTIAL | AppSetting has facility_name but not an entity. | **P0** |
| Building | MISSING | No Building entity. | **P1** |
| Floor | PARTIAL | Room.floor is a bare integer. | **P1** |
| Unit | MISSING | No Unit grouping. | **P1** |
| Tenant data isolation | MISSING | All data is global. No orgId/communityId on any model. | **P0** |
| Community-specific SOPs | MISSING | No SOP entity at all. | **P1** |

### C. STAFFING INTELLIGENCE

| v2.1 Requirement | v2.0 Status | Gap Detail | Priority |
|---|---|---|---|
| Daily care minutes from acuity | MISSING | No computation of care minutes from resident needs. | **P0** |
| Caregiver hours calculation | MISSING | No calculation from care minutes. | **P0** |
| Shift assignments from demand | PARTIAL | TimeTracking records shifts but is attendance-only. | **P1** |
| Staffing ratios | MISSING | No required ratios per acuity/unit. | **P1** |
| Overtime risk detection | MISSING | No detection or alerting. | **P2** |
| Coverage gap detection | MISSING | No gap analysis. | **P2** |
| Staff competency tracking | MISSING | Staff has license/licenseExpiry but no structured competency model. | **P1** |

### D. SOP INTEGRATION

| v2.1 Requirement | v2.0 Status | Gap Detail | Priority |
|---|---|---|---|
| SOP entity | MISSING | No SOPs in the system. | **P1** |
| Task-SOP linking | MISSING | Tasks have no SOP reference. | **P1** |
| Checklist from SOP | PARTIAL | Task has description field but no SOP-driven checklists. | **P1** |
| Escalation pathway from SOP | PARTIAL | Escalation model exists but no SOP-defined pathways. | **P1** |
| Competency requirement from SOP | MISSING | No link between SOPs and required competencies. | **P2** |

### E. QUALITY SCORECARDS

| v2.1 Requirement | v2.0 Status | Gap Detail | Priority |
|---|---|---|---|
| Resident Quality Score | MISSING | No composite quality score. | **P0** |
| Community Quality Dashboard | PARTIAL | FacilityReports show counts only. No quality metrics. | **P0** |
| Care completion % | PARTIAL | Tasks have status but no aggregate endpoint. | **P1** |
| Medication compliance rate | PARTIAL | MedicationLog tracks doses but no scorecard. | **P1** |
| Documentation completion | MISSING | No required vs completed documentation concept. | **P1** |

### F. AI DECISION SUPPORT

| v2.1 Requirement | v2.0 Status | Gap Detail | Priority |
|---|---|---|---|
| Trend analysis | PARTIAL | VitalsLog + CameraMonitoringLog have data but no analysis engine. | **P2** |
| Reassessment flags | MISSING | No overdue reassessment detection. | **P1** |
| Predictive analytics | MISSING | No predictive models. | **P3** |

### G. EXECUTIVE KPI FRAMEWORK

| v2.1 Requirement | v2.0 Status | Gap Detail | Priority |
|---|---|---|---|
| Clinical KPIs | PARTIAL | Raw data exists in Incident/MedicationLog but no KPI computation. | **P0** |
| Operational KPIs | PARTIAL | Basic dashboard counts only. | **P1** |
| Financial KPIs | PARTIAL | Invoice+ServiceCharge data exists but no financial KPIs. | **P2** |

### H. INTEGRATION LAYER

| v2.1 Requirement | v2.0 Status | Priority |
|---|---|---|
| Accounting | MISSING | **P3** |
| HR/Payroll | MISSING | **P3** |
| Telemedicine | MISSING | **P3** |
| Laboratory | MISSING | **P3** |
| Pharmacy | MISSING | **P3** |
| Wearables | PARTIAL (camera only) | **P3** |
| Nurse call (hardware) | PARTIAL (in-system only) | **P2** |
| Family portal | **EXISTS** | — |
| Home care app | MISSING | **P3** |
| Government reporting | MISSING | **P3** |

## 1.3 Priority Summary

| Priority | Count | Items |
|----------|-------|-------|
| **P0 (Phase 1)** | 12 | Assessment model, Acuity Engine, Care Package, Service Catalog, Task Generation, Quality Scorecard, Multi-tenant entities, Data isolation, Clinical KPIs, Quality indicators |
| **P1 (Phase 2)** | 14 | Staffing Intelligence, SOP Integration, Competency tracking, Monitoring frequency, Review schedules, Documentation requirements, Reassessment flags, Building/Floor/Unit, Community-quality metrics |
| **P2 (Phase 2-3)** | 8 | Overtime/Coverage, SOP-linked escalation, Community configs, Nurse call integration, Financial KPIs |
| **P3 (Phase 3)** | 7 | Predictive analytics, AI recommendations, All external integrations |

---

# 2. DELIVERABLE 1: UPDATED SOLUTION ARCHITECTURE

## 2.1 Component Diagram

```
+=============================================================================+
|                       MULTI-TENANT LAYER (v2.1 NEW)                          |
|  Organization -> Community -> Building -> Floor -> Unit -> Resident          |
|  Each level carries: branding, pricing, SOPs, forms, staffing configs       |
|  All queries filtered: organizationId -> communityId -> ...                  |
+=============================================================================+
                                    |
                                    v
+=============================================================================+
|                   CORE CARE INTELLIGENCE LOOP (v2.1 CENTER)                  |
|                                                                             |
|   Assessment -> Acuity Score -> Level of Care -> Care Package               |
|       ^                                                       |              |
|       |                                                       v              |
|   Reassessment   <- Quality Monitoring <- Documentation <- Service Catalog   |
|                   |                                              |            |
|                   v                                              v            |
|              Daily Tasks (auto-generated)                    SOPs           |
|              (linked to care package + SOPs)                 Competencies   |
+=============================================================================+
                                    |
            +-----------------------+-----------------------+
            v                       v                       v
+=====================+ +=====================+ +=====================+
| STAFFING            | | SOP INTEGRATION     | | QUALITY SCORECARDS  |
| INTELLIGENCE        | |                     | |                     |
| Care Minutes        | | SOP Library         | | Resident Quality    |
| Caregiver Hours     | | Task -> SOP ref     | | Community Dashboard |
| Shift Assignments   | | Checklists          | |                     |
| Staffing Ratios     | | Escalation pathways | | Component scores    |
| Overtime Risk       | | Competency matrix   | | (care, med, nutrition|
| Coverage Gaps       | |                     | |  hydration, mobility|
| Demand Calculator   | |                     | |  engagement, risk)  |
+=====================+ +=====================+ +=====================+
            |                       |                       |
            +-----------------------+-----------------------+
                                    v
+=============================================================================+
|                      EXECUTIVE KPI FRAMEWORK                                 |
|  Clinical KPIs | Operational KPIs | Financial KPIs                          |
|  Falls, Pressure Inj, Med Errors | Task Completion, Doc Completion         |
|  Hospital Xfer, Infections, Weight | Staffing Util, Caregiver Productivity |
|  Rev/RD, Labor Cost/RD, Occupancy, Service Util                            |
|  Each: current value, target, trend, period-over-period delta               |
+=============================================================================+
                                    |
                                    v
+=============================================================================+
|                      AI / ANALYTICS LAYER                                    |
|  AI Decision Support | Predictive Models (P3) | Trend Analysis              |
|  Non-diagnostic      | Fall prediction         | Weight, appetite,           |
|  recommendations     | Weight loss risk        | cognition, med adherence,   |
|  Reassess flags      | Hospital transfer       | hydration, behavioral       |
|  Care plan updates   | Infection risk          |                             |
+=============================================================================+
                                    |
                                    v
+=============================================================================+
|                      INTEGRATION LAYER (Phase 3)                             |
|  Accounting | HR/Payroll | Telemedicine | Laboratory | Pharmacy |          |
|  Wearables  | Nurse Call | Family App   | Home Care  | Government          |
|  Pattern: Webhook receivers + Polling adapters + Event bus publisher         |
+=============================================================================+
                                    |
                                    v
+=============================================================================+
|                  EXISTING v2.0 MODULES (PRESERVE & EXTEND)                   |
|  Admissions (Extend) | Fleet (Complete) | PMS/Hospitality (Complete)       |
|  Clinical Notes (Extend) | AI Assistant (Extend) | Billing | Dining        |
|  Room Mgmt | Incidents (Extend) | Call Bell | Camera Monitoring            |
+=============================================================================+
```

## 2.2 Architectural Trade-off Decisions

### Trade-off 1: Event-Driven vs. Request/Response for Acuity Loop

**Option A:** Synchronous — assessment submission blocks until all downstream work (tasks, staffing) is complete.
**Option B:** Event-driven — assessment emits events; downstream systems subscribe asynchronously.

**Recommendation: Option B with synchronous fast-path.**

**Justification:**
- Acuity loop triggers task generation for potentially hundreds of tasks across shifts. Synchronous blocking causes API timeouts.
- Event-driven allows independent scaling of each subsystem.
- Natural audit trail: each event = one AuditLog entry.
- Fast-path: acuity score computed synchronously for immediate UI feedback; heavier downstream work (care package, tasks, staffing) emitted as events asynchronously.
- Supabase Realtime (already used via `useLiveQuery`) propagates results to connected clients.
- **Phase 1:** In-process event bus. **Phase 2:** BullMQ on Redis for multi-service deployment.

### Trade-off 2: Shared vs. Siloed Tenant Data Model

**Option A:** Shared tables with `communityId` columns + Row-Level Security (RLS).
**Option B:** Schema-per-tenant.
**Option C:** Database-per-tenant.

**Recommendation: Option A — Shared tables with community-scoped rows + RLS.**

**Justification:**
- Operational simplicity: one Prisma schema, one migration set, one deployment.
- Supabase RLS natively scopes queries to user's communityId — zero application-level scoping bugs.
- Existing `scope.ts` already implements per-role scoping; extending to community-level is natural.
- Cost efficient: adding a community = row insert, not database provisioning.
- Cross-community enterprise analytics via simple `UNION ALL`.

**Risk:** Data leakage if RLS policies misconfigured.
**Mitigation:** Mandatory RLS policy testing in CI/CD. `communityId` injected at auth middleware level, never from client request body.

### Trade-off 3: Acuity Scoring — Rule-Based vs. ML-Based

**Option A:** Rule-based — configurable weights per dimension, transparent formula.
**Option B:** ML-trained — requires large historical datasets, black-box.

**Recommendation: Option A — Rule-based with configurable weights; Phase 3 adds ML overlay.**

**Justification:**
- Healthcare regulators require explainable decisions. Rule-based produces clear audit trail.
- Community configurability: different communities weight dimensions differently.
- No training data on greenfield system. Rule-based works immediately.
- After 6-12 months of data, Phase 3 trains ML model to suggest weight adjustments.

---

# 3. DELIVERABLE 2: CANONICAL DATA MODEL & ERD

## 3.1 New Entities (v2.1 Additions)

All entities annotated with **[TENANT]** or **[GLOBAL]**.

### 3.1.1 Multi-Tenant Hierarchy

```
[TENANT] Organization
=====================
id                String     @id @uuid
name              String
legalName         String?
taxId             String?
address           String?
phone             String?
email             String?
website           String?
logoUrl           String?
isActive          Boolean    @default(true)
createdAt/updatedAt DateTime

Relations: communities Community[]

[TENANT] Community (each row = one facility)
=====================
id                String     @id @uuid
organizationId    String     FK -> Organization.id
name              String     // "Golden Hearth Senior Living"
address/city/state/zip String?
phone/email       String?
timezone          String     @default("America/New_York")
latitude/longitude Float?
communityType     CommunityType  // ASSISTED_LIVING, INDEPENDENT_LIVING, MEMORY_CARE, TRANSITIONAL_CARE, HOME_CARE
licenseNumber/licenseExpiry String?/DateTime?
bedsTotal/bedsAvailable Int?
isActive          Boolean    @default(true)

Relations: organization, buildings, staff, residents, rooms, communitySops
@@index([organizationId]), @@index([communityType]), @@index([isActive])

[TENANT] Building
=====================
id, communityId FK, name, code, floorsCount, address?, isActive
Relations: community, floors
@@index([communityId])

[TENANT] Floor
=====================
id, buildingId FK, communityId FK (denormalized), floorNumber, name?, isActive
Relations: building, units
@@index([buildingId]), @@index([communityId])

[TENANT] Unit
=====================
id, floorId FK, communityId FK (denormalized), name, unitType (enum), capacity, staffingRatio Json?, isActive
Relations: floor, rooms, tasks
@@index([floorId]), @@index([communityId]), @@index([unitType])

enum UnitType { ASSISTED_LIVING, INDEPENDENT_LIVING, MEMORY_CARE, SKILLED_NURSING, TRANSITIONAL_CARE, HOME_CARE }
```

### 3.1.2 Assessment & Acuity Engine (THE CORE)

```
[TENANT] Assessment
=====================
id                String     @id @uuid
residentId        String     FK -> Resident.id
communityId       String     FK -> Community.id
assessmentType    AssessmentType   // ADMISSION, ANNUAL, QUARTERLY, CONDITION_CHANGE, CARE_PLAN_REVIEW, DISCHARGE, TRANSFER
version           Int        @default(1)
status            AssessmentStatus @default(DRAFT)

// 9 structured dimensions (1-5 scale)
adlScore          Int   // Activities of Daily Living
cognitionScore    Int   // Cognitive function
mobilityScore     Int   // Ambulation, transfer, fall risk
medicalScore      Int   // Chronic conditions complexity
behavioralScore   Int   // Behavioral/psychological
nutritionScore    Int   // Dietary needs, feeding assistance
hydrationScore    Int   // Fluid intake monitoring
skinIntegrityScore Int  // Pressure injury risk
socialEngagementScore Int // Social participation

// Computed totals
totalRawScore     Int
dimensionCount    Int     @default(9)
maxPossibleScore  Int     // 9 x 5 = 45

// Metadata
assessedById      String  FK -> Staff.id
assessedByName    String
assessmentTool    String?
notes             String? @db.Text
attachments       Json?

// Reassessment chain
isReassessment         Boolean @default(false)
previousAssessmentId   String? FK -> Assessment.id
reassessmentReason     String? // SCHEDULED, CONDITION_CHANGE, INCIDENT_TRIGGERED, CARE_PLAN_REVIEW

completedAt DateTime?
@@index([residentId]), @@index([communityId]), @@index([assessmentType])
@@index([completedAt]), @@index([residentId, completedAt])

enum AssessmentType { ADMISSION, ANNUAL, QUARTERLY, CONDITION_CHANGE, CARE_PLAN_REVIEW, DISCHARGE, TRANSFER }
enum AssessmentStatus { DRAFT, IN_PROGRESS, COMPLETED, REVIEWED, SUPERSEDED }

[TENANT] AcuityScore
=====================
id                String     @id @uuid
assessmentId      String     @unique FK -> Assessment.id
residentId        String     FK -> Resident.id
communityId       String     FK -> Community.id

// Score
dimensionScores   Json       // { adl: 3, cognition: 4, ... } snapshot
weightedScore     Float      // weighted sum
normalizedScore   Float      // 0-100 scale

// Classification
acuityLevel       AcuityLevel  // LOW, MODERATE, HIGH, CRITICAL
careLevel         CareLevel    // INDEPENDENT, ASSISTED, MEMORY, SKILLED (derived)
careLevelConfidence Float?     // 0-1

// Staffing implications
dailyCareMinutes  Int
shiftBreakdown    Json       // { morning: 45, afternoon: 30, night: 15 }
staffingDemand    Json       // { day: 0.8, evening: 0.6, night: 0.3 } FTE

// Weights snapshot
weightsUsed       Json
weightVersion     String

// Validity
validFrom         DateTime   @default(now())
validUntil        DateTime?
isCurrent         Boolean    @default(true)
scoredAt          DateTime   @default(now())
scoredById        String?

@@index([residentId]), @@index([communityId]), @@index([acuityLevel])
@@index([careLevel]), @@index([isCurrent]), @@index([validUntil])

enum AcuityLevel { LOW, MODERATE, HIGH, CRITICAL }
```

### 3.1.3 Service Catalog & Care Packages

```
[TENANT] ServiceCatalog
=====================
id, communityId FK, name, category (enum), description
estimatedMinutes Int, requiredCompetencies Json?, suppliesNeeded Json?
sopId FK -> CommunitySop?, documentationRequired, documentationTemplate
qualityIndicator, monitoringFrequency
billable Boolean, baseRate Float?, billingCode String?
isActive, sortOrder

Relations: community, sop, carePackageItems
@@index([communityId]), @@index([category]), @@index([isActive])

enum ServiceCategory { PERSONAL_CARE, MOBILITY, MEDICATION, NUTRITION, HYDRATION, VITALS, SKIN_CARE, COGNITIVE, BEHAVIORAL, SOCIAL, REHABILITATION, TRANSPORT, DOCUMENTATION, COMMUNICATION }

[TENANT] CarePackage
=====================
id, communityId FK, name, careLevel (CareLevel), description
baseMonthlyRate Float, serviceCount Int (computed)
isActive, isDefault

Relations: community, items (CarePackageItem[]), residents
@@index([communityId]), @@index([careLevel]), @@index([isActive])

[TENANT] CarePackageItem
=====================
id, carePackageId FK, serviceCatalogId FK
quantity, frequency (DAILY/TWICE_DAILY/WEEKLY/AS_NEEDED)
shifts Json?, customMinutes?, customRate?, notes, sortOrder

Relations: carePackage, serviceCatalog
@@index([carePackageId]), @@index([serviceCatalogId])
@@unique([carePackageId, serviceCatalogId])
```

### 3.1.4 SOP & Competency

```
[TENANT] CommunitySop
=====================
id, communityId FK, title, category (CLINICAL/OPERATIONAL/SAFETY/EMERGENCY)
version, status (DRAFT/ACTIVE/ARCHIVED)
procedureText @db.Text, checklistItems Json?
escalationPathway Json?, competencyRequired Json?
effectiveDate, reviewDate?
approvedById?, approvedByName?
attachments Json?, isActive

Relations: community, services
@@index([communityId]), @@index([category]), @@index([status])

[TENANT] Competency
=====================
id, communityId FK, name, category, description
isRequired, validityMonths?

Relations: community, staffCompetencies
@@index([communityId]), @@index([category])

[TENANT] StaffCompetency
=====================
id, staffId FK, competencyId FK, communityId FK
verified, verifiedById?, verifiedAt?, expiryDate?, trainingHours?

Relations: staff, competency
@@index([staffId]), @@index([competencyId]), @@index([expiryDate])
@@unique([staffId, competencyId])
```

### 3.1.5 Quality Scorecards & KPIs

```
[TENANT] ResidentQualityScore
=====================
id, residentId FK, communityId FK
periodStart, periodEnd, periodType (DAILY/WEEKLY/MONTHLY)

// Component scores (0-100 each)
careCompletionScore, medicationComplianceScore, nutritionScore,
hydrationScore, mobilityScore, engagementScore, riskManagementScore

// Composite
overallScore Float, acuityAdjusted Float?
tasksScheduled, tasksCompleted, medsScheduled, medsTaken
incidentsCount, observationsCount

@@index([residentId]), @@index([communityId]), @@index([periodType])

[TENANT] CommunityQualityDashboard
=====================
id, communityId FK, snapshotDate

documentationCompletionRate, lateEntryRate, carePlanReviewCompliance
incidentClosureRate, incidentRate, fallRate, medicationErrorRate
staffingUtilization, overtimeRate, competencyCompliance
averageResidentQualityScore, weightLossRate, pressureInjuryRate
taskCompletionRate, callBellResponseTime, occupancyRate

@@index([communityId]), @@index([snapshotDate])

[TENANT] KpiRecord
=====================
id, communityId FK, category (KpiCategory), name
value, unit?, target?, delta?, deltaDirection?
period (DAILY/WEEKLY/MONTHLY/QUARTERLY/ANNUAL)
periodStart, periodEnd
trend Json?  // [{date, value}] for sparklines

@@index([communityId]), @@index([category]), @@index([period])
@@index([communityId, category, periodStart])

enum KpiCategory { CLINICAL, OPERATIONAL, FINANCIAL, QUALITY, STAFFING, SATISFACTION }
```

### 3.1.6 Audit Log & Observations

```
[GLOBAL] AuditLog
=====================
id, communityId? FK (null for platform-level)
actorId? FK -> User.id, actorName, actorRole
action (CREATE/READ/UPDATE/DELETE/LOGIN/LOGOUT/EXPORT/APPROVE)
entityType, entityId
before Json?, after Json?
ipAddress?, userAgent?, sessionId?
reason? (required for critical actions)

@@index([communityId]), @@index([actorId]), @@index([entityType])
@@index([entityId]), @@index([action]), @@index([createdAt])

[TENANT] Observation
=====================
id, residentId FK, communityId FK
observationType (ObservationType enum), category?, value, numericValue?, unit?
severity? (NORMAL/MILD/MODERATE/SEVERE)
notes?, observedById?, observedByName?
taskLink? FK -> Task.id, medicationLogLink?, vitalsLogLink?
source (MANUAL/TASK_COMPLETION/SENSOR/AI_CAMERA)
observedAt

@@index([residentId]), @@index([communityId]), @@index([observationType])
@@index([residentId, observationType, observedAt])

enum ObservationType { INTAKE, OUTPUT, SKIN_ASSESSMENT, MOOD_BEHAVIOR, PAIN_LEVEL, SLEEP, ACTIVITY, SOCIAL, COGNITIVE, VITALS_RECORDED, WEIGHT, MEDICATION_TAKEN, FALL_NEAR_MISS, REPOSITIONING }
```

### 3.1.7 Staffing Intelligence

```
[TENANT] StaffingPlan
=====================
id, communityId FK, unitId? FK -> Unit.id
planDate, shiftType (ShiftType)

// Demand (computed from acuity)
totalCareMinutes Int, requiredFTE Float, requiredStaff Int

// Supply (from scheduling)
scheduledStaff Int, scheduledHours Float, availableStaff Int

// Gap
coverageGap Int, coverageRatio Float
overtimeRisk (NONE/LOW/MEDIUM/HIGH)

assignments Json?  // [{staffId, staffName, careMinutes, shift}]
status (PLANNED/CONFIRMED/ACTIVE/COMPLETED)

@@index([communityId]), @@index([unitId]), @@index([planDate])
@@index([communityId, planDate, shiftType])
```

## 3.2 Modified Existing Entities

### Resident (new fields)

```
communityId String?  FK -> Community.id
organizationId String? FK -> Organization.id (denormalized)
buildingId String? FK -> Building.id
unitId String? FK -> Unit.id
currentCarePackageId String? FK -> CarePackage.id
currentAcuityScoreId String? FK -> AcuityScore.id
currentAcuityLevel AcuityLevel?
lastAssessmentDate DateTime?
nextAssessmentDue DateTime?

New relations: assessments, acuityScores, observations, qualityScores
```

### Staff (new fields)

```
communityId String? FK -> Community.id
New relations: staffCompetencies, staffingAssignments
```

### Task (new fields)

```
communityId String? FK -> Community.id
unitId String? FK -> Unit.id
serviceCatalogId String? FK -> ServiceCatalog.id
sopId String? FK -> CommunitySop.id
recurringPattern Json?
generatedFrom String?  // CARE_PACKAGE, SCHEDULE, MANUAL
documentationRequired String?
observationId String? FK -> Observation.id
```

### Room (new fields)

```
communityId String? FK -> Community.id
buildingId String? FK -> Building.id
floorId String? FK -> Floor.id
unitId String? FK -> Unit.id
```

## 3.3 ERD Relationship Summary

```
Organization 1--* Community 1--* Building 1--* Floor 1--* Unit 1--* Room
                                                          |
Community 1--* Resident <-- Assessment 1--1 AcuityScore
                       |                |
                       |                +--> CarePackage 1--* CarePackageItem *--1 ServiceCatalog
                       |
                       +--> Observation
                       +--> ResidentQualityScore
                       +--> Task *--1 ServiceCatalog *--1 CommunitySop
                       +--> CommunityEvent / DiningReservation / ...

Community 1--* CommunitySop
Community 1--* Competency 1--* StaffCompetency *--1 Staff
Community 1--* StaffingPlan
Community 1--* CommunityQualityDashboard
Community 1--* KpiRecord

Staff 1--* Task (assignedTo)
User 1--1 Staff (optional)
User 1--1 Resident (optional, self-login)

AuditLog --> Community (optional), User (optional)
```

## 3.4 Tenant-Scoping Summary

| Entity | Scoped? | Field |
|--------|---------|-------|
| Organization | Platform | N/A |
| Community | Org-scoped | organizationId |
| Building, Floor, Unit | Community | communityId |
| Resident, Staff | Community | communityId |
| Assessment, AcuityScore | Community | communityId |
| CarePackage, ServiceCatalog | Community | communityId |
| Task, Observation | Community | communityId |
| ResidentQualityScore, KpiRecord | Community | communityId |
| StaffingPlan | Community | communityId |
| CommunitySop, Competency | Community | communityId |
| AuditLog | Optional | communityId (null = platform) |
| AppSetting, BlogPost, SiteContent | **GLOBAL** | None |

---

# 4. DELIVERABLE 3: API SPECIFICATIONS

## 4.1 Authentication Pattern

```
Authorization: Bearer <supabase_jwt>
X-Community-Id: <community_id>  // injected by middleware from JWT claims
```

JWT claims: `userId`, `role`, `communityId`, `organizationId`. CommunityId extracted server-side, never trusted from client.

## 4.2 Acuity Engine API

### POST /api/v2/acuity/assess

Submit structured assessment and compute acuity score.

**Request:**
```json
{
  "residentId": "uuid",
  "assessmentType": "ADMISSION",
  "dimensions": {
    "adl": 3, "cognition": 4, "mobility": 2,
    "medical": 3, "behavioral": 2, "nutrition": 3,
    "hydration": 4, "skinIntegrity": 4, "socialEngagement": 2
  },
  "notes": "Resident demonstrates moderate ADL dependency...",
  "previousAssessmentId": "uuid"
}
```

**Response 201:**
```json
{
  "assessment": {
    "id": "uuid", "status": "COMPLETED", "totalRawScore": 27,
    "maxPossibleScore": 45, "assessedByName": "Sarah Jenkins, RN",
    "completedAt": "2026-07-17T10:30:00Z"
  },
  "acuityScore": {
    "id": "uuid", "weightedScore": 58.5, "normalizedScore": 65.0,
    "acuityLevel": "HIGH", "careLevel": "ASSISTED", "careLevelConfidence": 0.87,
    "dailyCareMinutes": 180,
    "shiftBreakdown": { "morning": 75, "afternoon": 60, "night": 45 },
    "staffingDemand": { "day": 0.94, "evening": 0.75, "night": 0.56 },
    "validUntil": "2026-10-17T10:30:00Z"
  },
  "carePackage": {
    "id": "uuid", "name": "Assisted Living Standard",
    "serviceCount": 12, "baseMonthlyRate": 4500.00
  }
}
```

### GET /api/v2/acuity/resident/:id/current

```json
{
  "acuityScore": {
    "normalizedScore": 65.0, "acuityLevel": "HIGH",
    "careLevel": "ASSISTED", "dailyCareMinutes": 180,
    "validFrom": "2026-07-17", "validUntil": "2026-10-17",
    "dimensions": { "adl": { "score": 3, "weight": 0.25, "weighted": 0.75 } },
    "assessment": { "type": "ADMISSION", "assessedBy": "Sarah Jenkins, RN" }
  },
  "history": [
    { "date": "2026-04-17", "normalizedScore": 52.0, "acuityLevel": "MODERATE" }
  ]
}
```

### GET /api/v2/acuity/community/summary

```json
{
  "totalResidents": 120,
  "distribution": { "LOW": 25, "MODERATE": 48, "HIGH": 35, "CRITICAL": 12 },
  "careLevelDistribution": { "INDEPENDENT": 22, "ASSISTED": 55, "MEMORY": 28, "SKILLED": 15 },
  "overdueForReassessment": 8,
  "averageDailyCareMinutes": 145,
  "totalRequiredFTE": { "day": 21.8, "evening": 18.2, "night": 13.5 }
}
```

### POST /api/v2/acuity/config/weights

```json
{
  "weights": { "adl": 0.25, "cognition": 0.20, "mobility": 0.15, "medical": 0.15, "behavioral": 0.10, "nutrition": 0.05, "hydration": 0.03, "skinIntegrity": 0.04, "socialEngagement": 0.03 }
}
```

## 4.3 Task Generation API

### POST /api/v2/tasks/generate

**Request:** `{ "residentId", "carePackageId", "startDate", "endDate" }`

**Response 201:**
```json
{
  "generated": 84,
  "tasks": [{ "id", "title", "serviceCatalogId", "sopId", "dueDate", "priority", "recurringPattern": { "frequency": "DAILY", "shift": "MORNING" } }],
  "summary": { "byShift": { "MORNING": 32, "AFTERNOON": 28, "NIGHT": 24 } }
}
```

### GET /api/v2/tasks/community/daily-stats

**Query:** `?date=2026-07-17&unitId=optional`

**Response:** `{ "total": 240, "completed": 198, "completionRate": 82.5, "onTimeRate": 78.3, "byShift": {...}, "overdueTasks": 8 }`

## 4.4 Staffing Intelligence API

### GET /api/v2/staffing/demand

**Query:** `?date=2026-07-18&unitId=optional`

**Response:**
```json
{
  "totalDailyCareMinutes": 17400,
  "demandByShift": {
    "MORNING": { "careMinutes": 7200, "requiredFTE": 9.0, "requiredStaff": 9 },
    "AFTERNOON": { "careMinutes": 6000, "requiredFTE": 7.5, "requiredStaff": 8 },
    "NIGHT": { "careMinutes": 4200, "requiredFTE": 5.25, "requiredStaff": 6 }
  }
}
```

### GET /api/v2/staffing/coverage

**Response:**
```json
{
  "shifts": {
    "MORNING": { "required": 9, "scheduled": 8, "gap": -1, "coverageRatio": 0.89, "overtimeRisk": "MEDIUM" }
  },
  "alerts": [{ "type": "UNDERSTAFFED", "shift": "MORNING", "gap": 1 }]
}
```

## 4.5 Quality Scorecard API

### GET /api/v2/quality/resident/:id

**Query:** `?period=MONTHLY&month=2026-07`

**Response:**
```json
{
  "scores": {
    "careCompletion": { "score": 88, "scheduled": 90, "completed": 79 },
    "medicationCompliance": { "score": 95, "scheduled": 120, "taken": 114 },
    "nutrition": { "score": 82 }, "hydration": { "score": 78 },
    "mobility": { "score": 70 }, "engagement": { "score": 65 },
    "riskManagement": { "score": 92 }
  },
  "overallScore": 81.4,
  "flags": [
    { "type": "REASSESSMENT_RECOMMENDED", "reason": "Mobility score declining 3 months" },
    { "type": "CARE_PLAN_UPDATE", "reason": "Engagement below 70" }
  ]
}
```

### GET /api/v2/quality/community

**Response:** Community-wide quality metrics with grade, component scores, trends, and alerts.

### GET /api/v2/kpi/executive

**Query:** `?period=QUARTERLY&quarter=2026-Q3`

**Response:** Clinical, Operational, and Financial KPIs with values, targets, trends, and severity flags across communities.

## 4.6 External Integration Stubs (Phase 3)

| Endpoint | Purpose |
|----------|---------|
| POST /api/v2/integrations/pharmacy/push-orders | Push medication orders to pharmacy |
| POST /api/v2/integrations/lab/receive-results | Webhook for lab results |
| POST /api/v2/integrations/wearables/ingest | Receive wearable device data |
| POST /api/v2/integrations/telemedicine/schedule | Schedule video visits |
| POST /api/v2/integrations/accounting/sync | Sync invoices/payments |
| POST /api/v2/integrations/hr/export-timesheet | Export time tracking |
| GET /api/v2/integrations/government/quality-measures | Generate regulatory reports |

---

# 5. DELIVERABLE 4: WORKFLOW DIAGRAMS

## 5.1 Core Care Intelligence Loop

```
START: Admission or Reassessment Trigger
  |
  v
+---------------------+
| 1. ASSESSMENT       | Clinician performs 9-dimension assessment
|    (Structured)     | Input: dimensions {1-5}, type, notes, prevId
+----------+----------+
           | POST /api/v2/acuity/assess
           v
+---------------------+
| 2. ACUITY SCORING   | Engine computes synchronously:
|    (SYNCHRONOUS)    |   weightedScore = sum(dim x weight)
|                     |   normalizedScore = 0-100
+----------+----------+   acuityLevel = LOW|MODERATE|HIGH|CRITICAL
           |               careLevel = INDEPENDENT|ASSISTED|MEMORY|SKILLED
           | --> Emit: ACUITY_SCORED
           |
    +------+--------+
    |               |
    v               v
+---------+   +-----------+
| 3. LEVEL|   | 4. CARE   | Auto-match service catalog
| OF CARE |   |  PACKAGE  | to care level
| DERIVE  |   | GENERATE  | Bundle services + SOPs
+----+----+   +-----+-----+
     |              |
     +------+-------+
            v
+---------------------+
| 5. SERVICE CATALOG  | Resolve each item:
|    RESOLUTION       | - SOP reference
|                     | - Competencies required
+----------+----------+ - Care minutes
           |            - Documentation template
           |            - Billing code
           v
+---------------------+
| 6. TASK GENERATION  | Generate recurring tasks:
|                     |   per service x shift x day
| POST /api/v2/       |   link SOP
| tasks/generate      |   set doc requirements
+----------+----------+   assign priority from acuity
           |
           | --> Emit: TASKS_GENERATED
           v
+---------------------+
| 7. DAILY TASK       | Caregivers/Nurses execute
|    EXECUTION        | Each completion records:
|                     |   - Observation
| Shift-based work    |   - Documentation
+----------+----------+ - Task status update
           |            - Quality score feed
           |
           | --> Emit: TASK_COMPLETED
           v
+---------------------+
| 8. DOCUMENTATION    | System validates:
|    & QUALITY        |   Required docs completed?
|    MONITORING       |   Documentation matches reqs?
+----------+----------+ Flags missing/late documentation
           |            Updates community quality metrics
           v
+---------------------+
| 9. QUALITY SCORING  | Compute resident quality score:
|                     |   Care + Meds + Nutrition + Hydration
|                     |   + Mobility + Engagement + Risk
+----------+----------+ = Composite 0-100 score
           |
           | Check triggers:
           |
           +-- Condition change? --> Trigger REASSESSMENT
           +-- Score declining 3 months? --> Flag CARE PLAN UPDATE
           +-- Incident? --> Trigger CONDITION_CHANGE Assessment
           +-- 90 days elapsed? --> Trigger QUARTERLY Assessment
           |
           v
      CONTINUOUS REASSESSMENT (cycle repeats)
```

## 5.2 Incident-to-Closure Workflow

```
+---------------------+
| INCIDENT DETECTED   | Source: Caregiver, Nurse, AI Camera, Call Bell
+----------+----------+
           v
+---------------------+
| 1. INITIAL REPORT   | incidentType, severity, description,
|                     | location, immediateActions, witnesses
| POST /api/db/       |
| incidents           |
+----------+----------+
           | Emit: INCIDENT_REPORTED
           v
+---------------------+
| 2. AUTO-ROUTE       | Severity routing:
|    SLA TIMERS START |   MINOR     -> Charge Nurse (SLA 4h)
|                     |   MODERATE  -> Nurse + Admin (SLA 2h)
+----------+----------+   SEVERE    -> Nurse + Physician + Admin (SLA 30m)
           |            CRITICAL   -> All + Family (SLA 5m)
           v
+---------------------+
| 3. ACKNOWLEDGE      | Clinician acknowledges
|                     | Records initial assessment
| Escalation board    | If SLA breached -> auto-escalate
| updates realtime    | to Facility Admin / on-call
+----------+----------+
           v
+---------------------+
| 4. INVESTIGATE      | Root cause analysis
|    & RESPOND        | Contributing factors
|                     | SBAR format response
| Response recorded   | Orders/recommendations
+----------+----------+
           v
+---------------------+
| 5. CORRECTIVE       | Generate follow-up tasks:
|    ACTIONS          |   - Care plan update
|                     |   - SOP review
| Tasks created       |   - Staff retraining
+----------+----------+   - Equipment maintenance
           | Emit: INCIDENT_ACTIONS_GENERATED
           v
+---------------------+
| 6. RESOLVE & CLOSE  | Resolution notes
|                     | Follow-up confirmation
| status = RESOLVED   | Family notified
|                     | Quality scorecard updated
+----------+----------+
           | Emit: INCIDENT_RESOLVED
           v
+---------------------+
| 7. AUDIT & QUALITY  | AuditLog entry
|    UPDATE           | Community metrics updated:
|                     |   - closure rate, incident rate
| KPI computed        |   - fall rate (if fall)
+---------------------+
```

## 5.3 Staffing Gap Detection & Escalation

```
+---------------------+
| DAILY CRON / MANUAL | Runs at 04:00 AM for upcoming shift
+----------+----------+
           | GET /api/v2/staffing/demand
           v
+---------------------+
| 1. COMPUTE DEMAND   | For each shift:
|                     |   Sum dailyCareMinutes for all residents
| From acuity data    |   Divide by shiftMinutes / staffingRatio
+----------+----------+   = Required FTE (round up)
           |
           v
+---------------------+
| 2. COMPARE TO       | GET /api/v2/staffing/coverage
|    SCHEDULE         | Compare required vs scheduled
|                     | Coverage ratio = scheduled / required
+----------+----------+
           |
           +-- ratio >= 1.0 --> OK, no action
           |
           +-- ratio < 1.0 --> GAP DETECTED
           |
           v
+---------------------+
| 3. CLASSIFY         | Coverage thresholds:
|                     |   0.90-0.99 -> LOW (yellow)
| ratio-based         |   0.75-0.89 -> MEDIUM (orange)
+----------+----------+   < 0.75    -> HIGH (red)
           |
           v
+---------------------+
| 4. ESCALATE         | LOW:   Notify Admin dashboard
|    & NOTIFY         |        Log for shift report
|                     | MEDIUM: Notify Admin + HR
| Role-based          |        Trigger overtime pool
| notifications       |        SMS/Teams notification
+----------+----------+ HIGH:  Notify Org Admin
           |           Trigger emergency protocol
           |           Contact agency temp staffing
           |           Create Urgent escalation (SBAR)
           v
+---------------------+
| 5. AUTO-ASSIGN      | Optional auto-fill:
|    (if enabled)     |   - Check on-call availability
|                     |   - Check overtime-eligible staff
+----------+----------+   - Suggest willing staff swaps
           |
           v
+---------------------+
| 6. ONGOING          | During shift:
|    MONITORING       |   Track call-outs realtime
|                     |   Recompute coverage on change
| Real-time           |   Re-escalate if coverage drops
| adjustment          |
+----------+----------+
           v
+---------------------+
| 7. POST-SHIFT       | Record: actual vs required hours
|    ANALYSIS         |   overtime hours, unfilled gaps
|                     |   care quality impact assessment
| Feeds KPIs &        |   -> CommunityQualityDashboard
| quality scorecard   |   -> KpiRecord
+---------------------+
```

---

# 6. DELIVERABLE 5: UI WIREFRAMES

## 6.1 Resident Dashboard (Enhanced with Acuity)

```
+-----------------------------------------------------------------------+
| RESIDENT DASHBOARD - Arthur Pendelton, Room 302              [EDIT]  |
|-----------------------------------------------------------------------|
|                                                                       |
| +-- ACUITY SNAPSHOT -------------------------------------------------+|
| |                                                                    ||
| | Acuity Score: 65.0/100   Level: HIGH ---+                         ||
| | [##########-----------] 65%             |  Care Level:             ||
| |                                        |  ASSISTED (auto-derived) ||
| | Trend: +13 from last assessment        |                           ||
| | Last: Apr 17 -> 52.0 (MODERATE)       |  Care Package:            ||
| | Next reassessment: Oct 17, 2026        |  AL Standard              ||
| |                                        |  $4,500/mo               ||
| | Daily Care Minutes: 180 min/day        |                           ||
| | +----------+----------+----------+    |  [View Assessment]        ||
| | | MORNING  |  EVENING |  NIGHT   |    |  [History]                ||
| | | 75 min   |  60 min  |  45 min  |    |                           ||
| | +----------+----------+----------+    |                           ||
| +--------------------------------------------------------------------+|
|                                                                       |
| +-- DIMENSION SCORES ------------------------------------------------+|
| |                                                                    ||
| | ADL:           [########----] 3/5                                  ||
| | Cognition:     [##########--] 4/5                                  ||
| | Mobility:      [######------] 2/5  * FLAG: declining trend        ||
| | Medical:       [########----] 3/5                                  ||
| | Behavioral:    [######------] 2/5                                  ||
| | Nutrition:     [########----] 3/5                                  ||
| | Hydration:     [##########--] 4/5                                  ||
| | Skin Integrity:[##########--] 4/5                                  ||
| | Social:        [######------] 2/5  * FLAG: below target           ||
| +--------------------------------------------------------------------+|
|                                                                       |
| +-- QUALITY SCORE ---------+ +-- TODAY'S TASKS -------------------+ ||
| | Overall: 81.4/100        | | 07:00 Bathing ........... [DONE]  | ||
| | [################----]81 | | 08:00 Med Admin ......... [DONE]  | ||
| |                          | | 09:00 Breakfast ......... [DONE]  | ||
| | Care:     88% ^          | | 10:00 Exercise .......... [PEND]  | ||
| | Meds:     95% -          | | 11:00 Hydration ......... [PEND]  | ||
| | Nutrition:82% ^          | | 14:00 Lunch meds ........ [PEND]  | ||
| | Hydration:78% -          | | 15:00 Afternoon care .... [PEND]  | ||
| | Mobility: 70% v          | | 18:00 Dinner meds ....... [PEND]  | ||
| | Engage:   65% v *        | | 20:00 Evening care ...... [PEND]  | ||
| | Risk:     92% -          | | Completion: 3/9 (33%)              | ||
| +---------------------------+ +-----------------------------------+ ||
|                                                                       |
| +-- AI FLAGS -------------------------------------------------------+|
| | * Mobility score declining 3 consecutive months -- reassess        ||
| | * Engagement below 70 -- consider activity plan modification       ||
| | O Medication compliance excellent -- maintain current regimen      ||
| +--------------------------------------------------------------------+|
+-----------------------------------------------------------------------+
```

## 6.2 Community Quality Dashboard

```
+-----------------------------------------------------------------------+
| COMMUNITY QUALITY - Golden Hearth Senior Living         July 2026    |
|=======================================================================|
|                                                                       |
| OVERALL GRADE: B+ (84.0/100)  Trend: +5.8 from Q2                   |
|                                                                       |
| +-- CLINICAL KPIs ----------+ +-- OPERATIONAL KPIs ----------------+ ||
| |                           | |                                    | ||
| | Falls Rate    1.8 /1000  | | Task Completion   82.5%            | ||
| | target: 1.5   ^ +0.3     | | target: 90%       ^ +2.1          | ||
| | [########------] WARN    | | [########------] WARN              | ||
| |                           | |                                    | ||
| | Pressure Inj. 0.3 /1000  | | Doc Completion    91.2%            | ||
| | target: 0.5   v -0.1     | | target: 95%       ^ +1.5          | ||
| | [##########--] OK        | | [#########-------] IMPROVE         | ||
| |                           | |                                    | ||
| | Med Errors    0.5 /1000  | | Late Entries      8.3%             | ||
| | target: 0.3   ^ +0.2     | | target: 5.0%      v -1.2          | ||
| | [######------] CRIT      | | [########------] WARN              | ||
| |                           | |                                    | ||
| | Hospital Xfer 2.1 /100   | | Staffing Util     92.1%            | ||
| | target: 2.0   - +0.1     | | target: 95%       - +0.2          | ||
| | [########------] WARN    | | [#########-------] OK              | ||
| +---------------------------+ +------------------------------------+ ||
|                                                                       |
| +-- ACUITY DISTRIBUTION --------------------------------------------+|
| | 120 Residents:                                                      ||
| | LOW:      [################--------------] 25 (20.8%)              ||
| | MODERATE: [########################------] 48 (40.0%)              ||
| | HIGH:     [################----------] 35 (29.2%)                  ||
| | CRITICAL: [##########------------------] 12 (10.0%)                ||
| | Care Level: Ind:22 | Assist:55 | Memory:28 | Skilled:15            ||
| | Overdue Reassessment: 8 residents                                   ||
| +--------------------------------------------------------------------+|
|                                                                       |
| +-- ALERTS & ACTIONS ------------------------------------------------+|
| | CRIT: Medication error rate (0.5) above target (0.3)               ||
| |   -> Review medication administration SOPs                         ||
| | WARN: Falls rate trending up 3 months                              ||
| |   -> Review fall prevention protocols                              ||
| | WARN: 8 residents overdue for reassessment                         ||
| |   -> Schedule assessments this week                                ||
| | GOOD: Pressure injury rate below target                            ||
| |   -> Continue current skin care protocols                          ||
| +--------------------------------------------------------------------+|
|                                                                       |
| +-- QUALITY TREND (12 MONTHS) --------------------------------------+|
| | 90 -                              *                                ||
| | 85 -                  *          * *                               ||
| | 80 -          *      * *                                          ||
| | 75 -    *    *                                                     ||
| | 70 -  *                                                            ||
| |     J  F  M  A  M  J  J  A  S  O  N  D                           ||
| +--------------------------------------------------------------------+|
+-----------------------------------------------------------------------+
```

## 6.3 Staffing Intelligence View

```
+-----------------------------------------------------------------------+
| STAFFING INTELLIGENCE - Golden Hearth   July 17, 2026     [PLAN]    |
|=======================================================================|
|                                                                       |
| +-- DEMAND SUMMARY -------------------------------------------------+|
| | Total Daily Care Minutes: 17,400 (290 hours)                      ||
| | Residents: 120  |  Required FTE: 36.0  |  Avg/Resident: 145 min  ||
| |                                                                    ||
| | +----------+----------+----------+----------+                      ||
| | |          | MORNING  | EVENING  |  NIGHT   | TOTAL                ||
| | | Required |  9 FTE   |  7.5 FTE |  5.3 FTE | 21.8 FTE           ||
| | | Scheduled|  8 staff |  8 staff |  6 staff | 22 staff           ||
| | | Gap      |  -1 !!   |  +0.5 ok |  +0.7 ok |                     ||
| | | Ratio    |  1:15    |  1:13    |  1:10    |                     ||
| | | OT Risk  |  MED     |  LOW     |  LOW     |                     ||
| | +----------+----------+----------+----------+                      ||
| +--------------------------------------------------------------------+|
|                                                                       |
| +-- TOP ACUITY RESIDENTS -------------------------------------------+|
| | #  Name            Room  Acuity  CareMin  Shift Breakdown         ||
| | -- --------------- ----  ------  -------  ----------------------  ||
| | 1  Margaret Wilson 201   82.0    320 min  AM:130 PM:100 EV:90    ||
| | 2  Robert Chen     105   78.5    290 min  AM:120 PM:90  EV:80    ||
| | 3  Dorothy Harris  308   76.0    275 min  AM:115 PM:85  EV:75    ||
| | 4  James Morrison  412   74.2    265 min  AM:110 PM:80  EV:75    ||
| | 5  Betty Palmer    220   71.8    250 min  AM:105 PM:75  EV:70    ||
| | [View All Residents by Acuity ->]                                 ||
| +--------------------------------------------------------------------+|
|                                                                       |
| +-- MORNING SHIFT (8 staff) --+ +-- ALERTS --------------------+   ||
| | Staff       Assgn  Load  OT | |                              |   ||
| | Sarah J.    1:15   480m  0% | | !! MORNING understaffed      |   ||
| | Caleb R.    1:15   520m  8% | |    by 1 caregiver            |   ||
| | Maria L.    1:13   450m  0% | |                              |   ||
| | David K.    1:13   465m  3% | | * Caleb Randall at 108% util |   ||
| | Emma W.     1:13   445m  0% | | * 3 staff at >95% util       |   ||
| | James P.    1:15   490m  5% | |                              |   ||
| | Lisa M.     1:13   440m  0% | | SUGGESTION: swap James/Caleb |   ||
| | Tom H.      1:15   475m  2% | | to balance load              |   ||
| | Avg util: 92.1%  OT: 2 of 8 | +------------------------------+   ||
| +------------------------------+                                     ||
|                                                                       |
| +-- WEEKLY DEMAND FORECAST -----------------------------------------+|
| | Required FTE:                                                       ||
| | Mon  [################------------] 36.0                           ||
| | Tue  [################------------] 36.0                           ||
| | Wed  [##################----------] 38.2 (admissions expected)     ||
| | Thu  [################------------] 36.0                           ||
| | Fri  [#################-----------] 37.5                           ||
| | Sat  [################------------] 35.0 (weekend pattern)         ||
| | Sun  [################------------] 35.0                           ||
| | Est. overtime this week: 12 hours | Est. labor cost: $28,500       ||
| +--------------------------------------------------------------------+|
+-----------------------------------------------------------------------+
```

## 6.4 Executive KPI Dashboard

```
+-----------------------------------------------------------------------+
| EXECUTIVE KPI DASHBOARD - LifeCare CMS       Q3 2026    [EXPORT PDF] |
|=======================================================================|
|                                                                       |
| +-- CLINICAL KPIs --------------------------------------------------+|
| | Falls Rate      1.8 /1000 RD  ^ +0.3  [########------] WARN      ||
| | Pressure Inj.   0.3 /1000 RD  v -0.1  [##########----] OK        ||
| | Med Errors      0.5 /1000dose ^ +0.2  [######--------] CRIT      ||
| | Hospital Xfer   2.1 /100 res  - +0.1  [########------] WARN      ||
| | Infection Rate  1.2 /1000 RD  ^ +0.2  [########------] WARN      ||
| | Weight Loss     4.2% res      v -0.8  [#######-------] WARN      ||
| |                                                                     ||
| | CLINICAL SCORE: 72/100  Trend: *--*--*--*--* (improving)          ||
| +--------------------------------------------------------------------+|
|                                                                       |
| +-- OPERATIONAL KPIs ------------------------------------------------+|
| | Task Completion  82.5%    ^ +2.1  [########------] WARN           ||
| | Doc Completion   91.2%    ^ +1.5  [#########-----] IMPROVE        ||
| | Late Entries     8.3%     v -1.2  [########------] WARN           ||
| | Caregiver Prod.  78.5%    ^ +3.0  [########------] IMPROVE        ||
| | Staffing Util.   92.1%    - +0.2  [#########-----] OK            ||
| | Call Bell Resp.  4.2 min  v -0.8  [##########----] OK            ||
| |                                                                     ||
| | OPERATIONAL SCORE: 79/100  Trend: *--*--*--*--* (improving)       ||
| +--------------------------------------------------------------------+|
|                                                                       |
| +-- FINANCIAL KPIs --------------------------------------------------+|
| | Rev per Res-Day     $285.00   ^ +$5.00                            ||
| | Labor Cost / R-D    $142.00   ^ +$3.00                            ||
| | Margin / R-D        $143.00   ^ +$2.00                            ||
| | Occupancy Rate      91.7%     ^ +1.2%                             ||
| | Service Utilization 76.3%     ^ +2.5%                             ||
| |                                                                     ||
| | FINANCIAL SCORE: 81/100  Revenue: $1,026,000  Expenses: $541,200  ||
| +--------------------------------------------------------------------+|
|                                                                       |
| +-- CROSS-ENTITY COMPARISON ----------------------------------------+|
| | Community       Clinical  Ops     Financial  Grade                 ||
| | --------------- --------- ------- ---------- -----                 ||
| | Golden Hearth   72/100    79/100  81/100     B+ (77.3)            ||
| | Silver Springs  85/100    82/100  78/100     A- (81.7)            ||
| | Oakwood Manor   68/100    75/100  83/100     B  (75.3)            ||
| | Maple Garden    91/100    88/100  80/100     A  (86.3)            ||
| | Org Average     79/100    81/100  80/100     B+ (80.2)            ||
| +--------------------------------------------------------------------+|
|                                                                       |
| +-- AI RECOMMENDATIONS ---------------------------------------------+|
| | CRIT: Med errors trending up -- review SOPs across communities    ||
| | WARN: Falls rate above target at Golden Hearth + Oakwood Manor   ||
| | GOOD: Pressure injury rates below target everywhere               ||
| | WARN: Task completion below 85% at 2 communities                  ||
| +--------------------------------------------------------------------+|
+-----------------------------------------------------------------------+
```

---

# 7. DELIVERABLE 6: DEVELOPMENT BACKLOG

## Phase 1: Foundation (Weeks 1-8) - "Compliance, Audit, Acuity Engine"

| ID | User Story | Complexity | Depends |
|----|-----------|------------|---------|
| P1-01 | Organization & Community entities -- Prisma models, CRUD API, admin UI, tenant-scoped seed data | XL | -- |
| P1-02 | Building, Floor, Unit hierarchy -- models, CRUD, link Room, migrate Room.floor to Floor entity | L | P1-01 |
| P1-03 | Tenant-scoping middleware -- communityId injection at auth, RLS policies on all 50 existing tables, scope.ts extension | XL | P1-01 |
| P1-04 | Assessment model -- structured 9-dimension assessment, CRUD API, submission UI for Nurse/Physician | L | P1-03 |
| P1-05 | Acuity Score engine -- weighted score computation, configurable weights, acuity/care level derivation, daily care minutes | L | P1-04 |
| P1-06 | Acuity weight config -- admin UI for dimension weights per community, version tracking, presets per community type | M | P1-05 |
| P1-07 | Care Package model -- CarePackage + CarePackageItem, auto-generate from acuity, CRUD API | L | P1-05 |
| P1-08 | Service Catalog model -- CommunitySop + ServiceCatalog, CRUD, admin UI, link SOPs to services | L | P1-03 |
| P1-09 | Automated task generation -- recurring tasks from CarePackage, per-shift creation, SOP linking, batch API | XL | P1-07, P1-08 |
| P1-10 | Audit Log system -- AuditLog model, middleware for critical model logging, audit trail viewer | L | P1-03 |
| P1-11 | RBAC enhancement -- ORGANIZATION_ADMIN + COMMUNITY_ADMIN roles, new portal configs, permission matrix | L | P1-01 |
| P1-12 | Resident quality score -- ResidentQualityScore model, compute from tasks/meds/incidents, period support | L | P1-09 |
| P1-13 | Community quality dashboard -- CommunityQualityDashboard model, aggregate metrics, dashboard UI | L | P1-12 |
| P1-14 | Acuity dashboard -- resident acuity overview, dimension breakdown, trend chart, community distribution | M | P1-05 |
| P1-15 | Enhanced admission flow -- integrate assessment into admission, auto-compute acuity, auto-assign care package | L | P1-04, P1-07 |

## Phase 2: Intelligence (Weeks 9-16) - "Service Catalog, Staffing, SOP, Dashboards"

| ID | User Story | Complexity | Depends |
|----|-----------|------------|---------|
| P2-01 | Staffing intelligence engine -- care minutes from acuity, FTE per shift, compare to scheduled, StaffingPlan model | XL | P1-05, P1-09 |
| P2-02 | Staffing demand API -- /demand and /coverage endpoints, real-time gap detection | L | P2-01 |
| P2-03 | Staffing plan generation -- auto-generate plans for date range, shift assignment recommendations | L | P2-01 |
| P2-04 | Staffing intelligence UI -- demand/coverage dashboard, shift detail, gap alerts, staff load balancing | L | P2-02 |
| P2-05 | Competency model -- Competency + StaffCompetency, CRUD, matrix view, training tracking | L | P1-03 |
| P2-06 | SOP library -- CommunitySop CRUD with versioning, checklists, escalation pathways, search/filter | M | P1-08 |
| P2-07 | Task-SOP linking -- tasks reference SOPs, SOP checklist on task open, compliance tracking | M | P2-06, P1-09 |
| P2-08 | Observation model -- auto-generate from task completion, manual entry, link to vitals/meds | L | P1-09 |
| P2-09 | Documentation compliance -- track required vs completed docs per resident per period, compliance rate | L | P2-08 |
| P2-10 | Executive KPI framework -- KpiRecord model, compute clinical/operational/financial KPIs, multi-community | XL | P1-13 |
| P2-11 | Executive KPI dashboard UI -- cross-community view, trends, AI recommendations, PDF export | L | P2-10 |
| P2-12 | Monitoring frequency engine -- derive vitals schedule from acuity, auto-schedule reminders | M | P1-05 |
| P2-13 | Care plan review scheduler -- auto-schedule reviews by acuity, overdue detection, notifications | M | P1-05, P1-07 |
| P2-14 | Incident quality integration -- feed incidents into quality scorecards, closure rate, root cause metrics | M | P1-13 |
| P2-15 | Staffing ratio config -- per-unit ratio settings, admin UI, auto-apply in demand computation | S | P2-01 |

## Phase 3: AI & Integration (Weeks 17-24) - "Predictive, External, Enterprise"

| ID | User Story | Complexity | Depends |
|----|-----------|------------|---------|
| P3-01 | AI decision support engine -- non-diagnostic recommendations from trend analysis, reassessment flags, care plan suggestions | XL | P1-12, P2-08 |
| P3-02 | Trend analysis dashboard -- weight, appetite, cognition, med adherence, hydration trends with sparklines | L | P3-01 |
| P3-03 | Reassessment flagging -- auto-detect overdue, condition-change triggers, notify clinician | M | P1-04 |
| P3-04 | Predictive analytics (Phase 1) -- fall risk, weight loss risk, hospital transfer probability, model training | XL | P3-01 |
| P3-05 | Pharmacy integration connector -- push orders, receive confirmations, reconciliation | L | -- |
| P3-06 | Laboratory integration connector -- receive results webhook, auto-create observations, notify physician | L | -- |
| P3-07 | Wearable device connector -- ingest heart rate/steps/sleep, auto-create vitals/observations | L | -- |
| P3-08 | Telemedicine integration -- video scheduling, pre-visit summary, visit notes import | L | -- |
| P3-09 | Accounting integration -- push invoices/payments, revenue recognition, GL posting | L | -- |
| P3-10 | HR/Payroll integration -- push time tracking, credential verification, payroll export | L | -- |
| P3-11 | Government reporting -- state/federal reports, MDS-like exports, quality measure submissions | XL | -- |
| P3-12 | Home care mobile companion app -- React Native, tasks, vitals entry, GPS, offline support | XL | P1-09 |
| P3-13 | Family portal enhancements -- acuity trend visibility, quality score, AI care summary | M | P1-12, P3-01 |
| P3-14 | Nurse call hardware integration -- connect physical system, map to CallBell, response tracking | L | -- |
| P3-15 | Event bus migration -- in-process to BullMQ/Redis, event replay, dead letter queue | L | -- |

---

# 8. DELIVERABLE 7: TESTING & VALIDATION PLAN

## 8.1 Unit Testing

| Module | Test Focus | Framework | Coverage |
|--------|-----------|-----------|----------|
| Acuity Engine | Score computation, weight application, edge cases (all zeros, all fives, rounding) | Jest + Prisma mock | 95% |
| Task Generator | Frequency calculation, shift distribution, recurring pattern logic | Jest + Prisma mock | 90% |
| Staffing Calculator | FTE computation, coverage ratio, gap thresholds | Jest | 95% |
| Quality Scorecard | Component scores, weighted average, period boundaries | Jest | 90% |
| KPI Calculator | Rate calculations, trend deltas, target comparison | Jest | 90% |
| Tenant Scoping | communityId injection, query filtering, cross-tenant isolation | Jest + Supertest | 95% |

## 8.2 Integration Testing

| Scenario | Method | Acceptance Criteria |
|----------|--------|-------------------|
| Assessment -> Acuity -> Care Package -> Tasks | API chain test | Full chain produces correct entities with correct relationships |
| Incident -> Quality Score | POST incident, verify metrics updated | Quality scores reflect new incident |
| Task completion -> Observation -> Quality | Complete task with observation | Quality score updated correctly |
| Multi-tenant isolation | Create in Community A, query from Community B | Community B cannot see A's data |
| Reassessment trigger | Create assessment, advance time, verify flag | Overdue detection works |
| Staffing gap detection | Understaffed scenario, verify alert | Gap detection and escalation work |

## 8.3 Clinical Logic Validation

| Validation | Method | Acceptance |
|-----------|--------|-----------|
| Acuity score derivation | Manual calculation vs engine for 10 residents | Scores match within +/-0.1 |
| Care level derivation | Clinical expert review of 20 mappings | 90% agreement with expert |
| Care minute estimation | Computed vs time-study actuals | Within +/-15% |
| Task generation completeness | All CarePackage items generate tasks | Zero missing tasks |
| Quality score accuracy | Manual audit of 10 residents | Within +/-5% |
| Reassessment scheduling | Test all assessment type intervals | Correct trigger timing |

## 8.4 Performance & Load Testing

| Test | Target | Tool |
|------|--------|------|
| Assessment + acuity computation | < 500ms response | k6 |
| Task generation 120 residents x 7 days | < 5 seconds batch | k6 |
| Community quality dashboard | < 2 seconds | k6 |
| Executive KPI across 4 communities | < 3 seconds | k6 |
| 50 concurrent users | < 1s P95 | k6 |
| All queries use community-scoped indexes | < 50ms per query | pg_stat_statements |

## 8.5 Multi-Tenant Isolation Verification

| Test | Method | Pass Criteria |
|------|--------|--------------|
| RLS policy enforcement | Query all tables from wrong community token | Zero rows returned |
| communityId middleware injection | Remove from JWT, verify 401 | Request rejected |
| Cross-community API access | Attempt PATCH on wrong community resource | 403 Forbidden |
| AuditLog capture | CRUD across communities | Each log has correct communityId |
| Data export isolation | Export from Community A | Contains only A data |
| Stale token rejection | Use expired JWT | 401 with proper error |

## 8.6 Compliance & Audit Trail Verification

| Test | Method | Pass Criteria |
|------|--------|--------------|
| Every care level change logged | Change Resident.careLevel, check AuditLog | Entry with before/after |
| Every assessment logged | Submit assessment, check AuditLog | Entry with dimension snapshot |
| Every medication order logged | Create/update medication, check AuditLog | Entry with physician reference |
| Login/logout logged | Authenticate then logout | Both events captured |
| Export actions logged | Export resident data | Event captured with reason |
| Critical action requires reason | Change care level without reason | 400 Bad Request |
| AuditLog immutable | Attempt UPDATE/DELETE on AuditLog | DB rejects (append-only) |
| Retention policy | Verify 7-year retention configured | Policy active |

---

# APPENDIX: ENVIRONMENT & DEPLOYMENT NOTES

## Existing Constraints

- TypeScript strict mode OFF
- Application Control blocks uvicorn.exe -- use `python -m uvicorn`
- No npm exec -- use npx
- Supabase pooler password: stored only in the deployment secret manager; never document or commit it
- Next.js 16 breaking changes -- see node_modules docs
- Build requires prisma generate first
- Vercel: `npm install --include=optional && npm rebuild lightningcss`

## New Requirements

- **BullMQ** for Phase 2 event bus (requires Redis)
- **PostgreSQL RLS** for multi-tenant isolation (Supabase native)
- **k6** for load testing
- **New Prisma models:** ~15 new, ~5 modified
- **New enums:** UnitType, AssessmentType, AssessmentStatus, AcuityLevel, ServiceCategory, KpiCategory, ObservationType
- **New API routes:** /api/v2/acuity/*, /api/v2/tasks/*, /api/v2/staffing/*, /api/v2/quality/*, /api/v2/kpi/*, /api/v2/integrations/*

## Migration Strategy

1. Create new models alongside existing (non-destructive)
2. Add communityId to existing models as nullable (backfill later)
3. Update scope.ts for community scoping
4. Phase 1: backward-compatible (v1 endpoints unchanged)
5. Phase 2: v2 API prefix for new endpoints
6. Phase 3: integration connectors as separate deployable services

---

# 9. PHASE 4: ENTERPRISE MULTI-COMMUNITY INTELLIGENCE (Weeks 25-32)

> **Theme:** "From single-community to enterprise operating system"
> **Goal:** Cross-community benchmarking, enterprise compliance, corporate dashboards, bulk operations, and custom reporting.

## 9.1 Architecture Additions

```
+=============================================================================+
|                    PHASE 4: ENTERPRISE LAYER                                |
|                                                                             |
|  +---------------------------+    +---------------------------+             |
|  | ENTERPRISE DASHBOARD      |    | BENCHMARK ENGINE          |             |
|  | Org-wide KPIs across all  |    | Compare communities on    |             |
|  | communities, drill-down   |    | identical metrics, rank,  |             |
|  | to single community       |    | percentile, peer groups   |             |
|  +---------------------------+    +---------------------------+             |
|                                                                             |
|  +---------------------------+    +---------------------------+             |
|  | BULK OPERATIONS ENGINE    |    | CUSTOM REPORT BUILDER     |             |
|  | Mass care plan updates,   |    | Drag-and-drop report      |             |
|  | bulk assessments, batch   |    | designer, scheduled       |             |
|  | task generation across    |    | generation, CSV/PDF/Excel |             |
|  | communities               |    | export, email delivery    |             |
|  +---------------------------+    +---------------------------+             |
|                                                                             |
|  +---------------------------+    +---------------------------+             |
|  | WHITE-LABEL THEMING       |    | ENTERPRISE AUDIT &        |             |
|  | Per-community branding,   |    | COMPLIANCE               |             |
|  | logos, colors, domain,    |    | Cross-community audit     |             |
|  | email templates           |    | trail, compliance matrix, |             |
|  +---------------------------+    | regulatory report packs   |             |
|                                   +---------------------------+             |
+=============================================================================+
```

## 9.2 New Entities (Phase 4)

```
[TENANT] EnterpriseReport
=====================
id, communityId FK (null = org-wide), organizationId FK
name, description, reportType (SCHEDULED/ON_DEMAND/REGULARY)
template Json?  // report layout definition
schedule CronExpression?  // "0 8 1 * *" = monthly 1st at 8am
recipients Json?  // [{email, role}]
format (PDF/CSV/EXCEL/HTML)
status (ACTIVE/PAUSED)
lastGeneratedAt, nextGenerationAt
@@index([organizationId]), @@index([reportType])

[TENANT] BenchmarkConfig
=====================
id, organizationId FK
name, description
metrics Json  // [{name, metricKey, target, unit, direction}]
peerGroup Json?  // community attributes for peer comparison
weighting Json?  // how to compute composite rank
isActive
@@index([organizationId])

[TENANT] BenchmarkResult
=====================
id, benchmarkConfigId FK, organizationId FK
periodStart, periodEnd, periodType
results Json  // [{communityId, rank, percentile, scores: {...}}]
compositeRank Json  // [{communityId, compositeScore, rank}]
calculatedAt
@@index([organizationId]), @@index([periodStart])

[TENANT] BulkOperation
=====================
id, organizationId FK, initiatedById FK -> User.id
operationType (ASSESSMENT_BULK/CARE_PLAN_UPDATE/TASK_GENERATE/STAFF_ASSIGN/REPORT_EXPORT)
targetScope Json  // {communityIds: [...], unitIds: [...], residentIds: [...]}
payload Json  // operation-specific parameters
status (QUEUED/IN_PROGRESS/COMPLETED/PARTIAL/FAILED)
totalItems, processedItems, failedItems
errors Json?  // [{itemId, error}]
startedAt, completedAt, createdAt
@@index([organizationId]), @@index([status])

[TENANT] ThemeConfig
=====================
id, communityId FK @unique
primaryColor, secondaryColor, accentColor
logoUrl, faviconUrl
headerBgStyle, sidebarStyle
loginBannerText, loginBannerImage
emailTemplate Json?  // custom email branding
customCss?  @db.Text
customDomain? String  // e.g. "goldenhearth.lifecare.health"
isActive
@@index([communityId])

[TENANT] CustomReportTemplate
=====================
id, organizationId FK, communityId?
name, description
layout Json  // {sections: [{type, title, metrics, filters, groupBy}]}
isShared Boolean  // org-wide template available to all communities
createdById FK -> User.id
lastModifiedAt
@@index([organizationId])
```

## 9.3 New APIs (Phase 4)

### GET /api/v2/enterprise/dashboard

```json
// Query: ?period=QUARTERLY&quarter=2026-Q3
{
  "organization": { "id": "uuid", "name": "LifeCare Senior Living" },
  "communityCount": 4,
  "totalResidents": 480,
  "enterpriseKpis": {
    "clinical": { "averageScore": 79.5, "bestCommunity": "Maple Garden", "worstCommunity": "Oakwood Manor" },
    "operational": { "averageScore": 81.2 },
    "financial": { "totalRevenue": 4104000, "averageMargin": 50.2 }
  },
  "communities": [
    { "id": "uuid", "name": "Golden Hearth", "grade": "B+", "score": 77.3, "residents": 120, "trend": "UP" },
    { "id": "uuid", "name": "Silver Springs", "grade": "A-", "score": 81.7, "residents": 130, "trend": "UP" },
    { "id": "uuid", "name": "Oakwood Manor", "grade": "B", "score": 75.3, "residents": 110, "trend": "FLAT" },
    { "id": "uuid", "name": "Maple Garden", "grade": "A", "score": 86.3, "residents": 120, "trend": "UP" }
  ],
  "alerts": [
    { "severity": "CRITICAL", "message": "Medication errors trending up at 3 communities" },
    { "severity": "WARNING", "message": "Oakwood Manor below org average on all metrics" }
  ]
}
```

### POST /api/v2/enterprise/benchmark/run

```json
// Request
{
  "benchmarkConfigId": "uuid",
  "periodStart": "2026-07-01",
  "periodEnd": "2026-09-30"
}

// Response 201
{
  "resultId": "uuid",
  "results": [
    { "communityId": "uuid", "name": "Maple Garden", "compositeScore": 86.3, "rank": 1, "percentile": 95 },
    { "communityId": "uuid", "name": "Silver Springs", "compositeScore": 81.7, "rank": 2, "percentile": 78 },
    { "communityId": "uuid", "name": "Golden Hearth", "compositeScore": 77.3, "rank": 3, "percentile": 55 },
    { "communityId": "uuid", "name": "Oakwood Manor", "compositeScore": 75.3, "rank": 4, "percentile": 30 }
  ],
  "insights": [
    { "type": "BEST_PRACTICE", "community": "Maple Garden", "metric": "Task Completion", "value": 94.2, "message": "Consider adopting Maple Garden's task management approach" },
    { "type": "IMPROVEMENT_NEEDED", "community": "Oakwood Manor", "metric": "Medication Compliance", "value": 82.1, "message": "Below org average by 8.3 points" }
  ]
}
```

### POST /api/v2/enterprise/bulk/execute

```json
// Request
{
  "operationType": "ASSESSMENT_BULK",
  "targetScope": {
    "communityIds": ["uuid1", "uuid2"],
    "unitIds": [],
    "filters": { "careLevel": "ASSISTED", "lastAssessmentDays": 90 }
  },
  "payload": {
    "assessmentType": "QUARTERLY",
    "defaultDimensions": null  // each resident uses their last assessment as baseline
  }
}

// Response 201
{
  "operationId": "uuid",
  "status": "QUEUED",
  "totalItems": 87,
  "estimatedCompletionSeconds": 45,
  "message": "87 assessments queued for generation across 2 communities"
}
```

### POST /api/v2/enterprise/reports/generate

```json
// Request
{
  "templateId": "uuid",
  "format": "PDF",
  "recipients": ["admin@lifecare.health", "cfo@lifecare.health"],
  "period": "2026-Q3"
}

// Response 202
{
  "jobId": "uuid",
  "status": "GENERATING",
  "estimatedMinutes": 3,
  "message": "Report generation started. Will email PDF to 2 recipients when complete."
}
```

## 9.4 Development Backlog

| ID | User Story | Complexity | Depends |
|----|-----------|------------|---------|
| P4-01 | Enterprise dashboard -- org-wide KPIs across all communities, drill-down to single community, community ranking | XL | P2-10 |
| P4-02 | Benchmark engine -- configurable metrics, percentile ranking, peer group comparison, best practice identification | XL | P4-01 |
| P4-03 | Custom report builder -- drag-and-drop report designer, section types (charts, tables, metrics, text), save/load templates | XL | P2-10 |
| P4-04 | Report scheduler & delivery -- cron-based generation, CSV/PDF/Excel export, email delivery, report history | L | P4-03 |
| P4-05 | Bulk operations engine -- mass assessment generation, bulk care plan updates, batch task generation across communities | XL | P1-09, P1-04 |
| P4-06 | Bulk operation monitoring -- progress tracking, error handling, partial completion, retry mechanism | L | P4-05 |
| P4-07 | White-label theming -- per-community colors, logos, CSS, custom domain, email template branding | L | P1-01 |
| P4-08 | Enterprise audit trail -- cross-community audit viewer, compliance matrix, filtered export by community/date/action | L | P1-10 |
| P4-09 | Enterprise notification system -- org-wide announcements, community-specific broadcasts, role-based delivery, escalation chains | L | P4-01 |
| P4-10 | Community comparison view -- side-by-side metric comparison, radar charts, trend overlay, gap analysis | L | P4-02 |
| P4-11 | Multi-community staffing optimizer -- cross-community staff sharing, float pool management, agency integration | XL | P2-01 |
| P4-12 | Enterprise data warehouse export -- scheduled exports to S3/Blob, schema documentation, ETL pipeline hooks | L | P4-03 |
| P4-13 | Regulatory report templates -- state-specific compliance report templates (CMS, Joint Commission, state surveys) | L | P4-03 |
| P4-14 | Mass care plan update workflow -- bulk care plan modifications with approval workflow, rollback capability | L | P4-05 |
| P4-15 | Enterprise search -- cross-community search across residents, staff, incidents, assessments with global filters | L | P1-03 |

---

# 10. PHASE 5: ADVANCED AI & PREDICTIVE CLINICAL INTELLIGENCE (Weeks 33-40)

> **Theme:** "From reactive documentation to proactive intelligence"
> **Goal:** ML-powered predictions, NLP documentation, automated clinical decision support, and generative AI for families.

## 10.1 Architecture Additions

```
+=============================================================================+
|                  PHASE 5: AI/ML INTELLIGENCE LAYER                          |
|                                                                             |
|  +---------------------------+    +---------------------------+             |
|  | ML MODEL SERVER           |    | NLP DOCUMENTATION ENGINE  |             |
|  | TensorFlow/PyTorch model  |    | Voice-to-clinical-note,  |             |
|  | serving via FastAPI       |    | ambient documentation,   |             |
|  | inference API             |    | auto-SOAP note generation|             |
|  |                           |    |                           |             |
|  | Models:                   |    | Whisper + GPT-4 for:     |             |
|  | - Fall risk predictor     |    | - Real-time transcription|             |
|  | - Weight loss predictor   |    | - Clinical summarization |             |
|  | - Hospital transfer risk  |    | - Terminology extraction |             |
|  | - Acuity trend forecaster |    | - ICD-10 suggestion      |             |
|  | - Readmission risk        |    |                           |             |
|  +---------------------------+    +---------------------------+             |
|                                                                             |
|  +---------------------------+    +---------------------------+             |
|  | CARE PLAN OPTIMIZER       |    | GENERATIVE AI ENGINE      |             |
|  | Auto-suggest care plan    |    |                           |             |
|  | modifications based on    |    | - Family care summaries   |             |
|  | outcomes data, peer       |    | - Shift handoff narrative |             |
|  | comparison, and clinical  |    | - Progress notes          |             |
|  | guidelines                |    | - Discharge summaries     |             |
|  +---------------------------+    +---------------------------+             |
|                                                                             |
|  +---------------------------+    +---------------------------+             |
|  | PREDICTIVE STAFFING       |    | MEDICATION INTELLIGENCE   |             |
|  | Seasonal demand models,   |    | Interaction checking,     |             |
|  | day-of-week patterns,     |    | adherence prediction,     |             |
|  | census forecasting,       |    | duplicate therapy detect, |             |
|  | admission/discharge prep  |    | formulary optimization    |             |
|  +---------------------------+    +---------------------------+             |
+=============================================================================+
```

## 10.2 New Entities (Phase 5)

```
[TENANT] PredictionModel
=====================
id, organizationId FK, communityId FK?
modelType (FALL_RISK/WEIGHT_LOSS/HOSPITAL_TRANSFER/ACUITY_TREND/READMISSION/DETERIORATION)
version String
trainedAt DateTime
trainingDataStats Json  // { sampleSize, dateRange, features, accuracy, f1Score }
status (TRAINING/ACTIVE/DEPRECATED)
modelWeights Blob?  // serialized model weights or reference to storage
hyperparameters Json?
featureImportance Json?  // [{feature, importance}] for explainability
performanceMetrics Json  // { accuracy, precision, recall, f1, auc }
@@index([modelType]), @@index([status])

[TENANT] Prediction
=====================
id, residentId FK, communityId FK, predictionModelId FK
predictionType (FALL_RISK/WEIGHT_LOSS/HOSPITAL_TRANSFER/DETERIORATION)
riskScore Float  // 0-1 probability
riskLevel (LOW/MODERATE/HIGH/CRITICAL)
confidence Float  // 0-1
factors Json  // [{feature, value, contribution}] explainability
recommendations Json  // [{action, priority, rationale}]
validFrom, validUntil
isAcknowledged Boolean
acknowledgedById? FK -> Staff.id
acknowledgedAt?
actionTaken String?  // what was done in response
@@index([residentId]), @@index([communityId]), @@index([predictionType])
@@index([riskLevel]), @@index([validFrom])

[TENANT] ClinicalNote
=====================
id, residentId FK, communityId FK
noteType (SOAP/PROGRESS/DISCHARGE/SUMMARY/HANDOFF/SOAP_AUTO)
content String @db.Text
structured Json?  // { subjective, objective, assessment, plan }
source (MANUAL/VOICE/NLP_ASSISTED/AI_GENERATED)
rawTranscription String? @db.Text  // voice input before NLP processing
aiConfidence Float?  // NLP model confidence
reviewedById FK -> Staff.id?
reviewedAt?
approved Boolean @default(false)
coSignedById? FK -> Staff.id
coSignedAt?
@@index([residentId]), @@index([communityId]), @@index([noteType])

[TENANT] CarePlanOptimization
=====================
id, residentId FK, communityId FK
currentCarePackageId FK -> CarePackage.id
suggestedChanges Json  // [{field, currentValue, suggestedValue, rationale, evidenceLevel}]
peerComparison Json  // how similar residents responded to different care plans
outcomePrediction Json  // predicted quality score change if changes adopted
clinicalGuidelineReference String?
status (SUGGESTED/ACCEPTED/REJECTED/PARTIALLY_ADOPTED)
reviewedById? FK -> Staff.id
reviewedAt?
adoptionNotes String? @db.Text
createdAt
@@index([residentId]), @@index([communityId]), @@index([status])

[TENANT] VoiceSession
=====================
id, clinicianId FK -> Staff.id, communityId FK
sessionType (DOCUMENTATION/HANDOFF/ASSESSMENT)
rawAudioUrl String?
transcription String? @db.Text
extractedEntities Json?  // [{type: "medication", value: "Lisinopril"}, {type: "vital", value: "BP 130/80"}]
generatedNote String? @db.Text
confidence Float?
status (RECORDING/TRANSCRIBING/PROCESSING/REVIEW/COMPLETED)
durationSeconds Int?
@@index([clinicianId]), @@index([communityId])

[TENANT] FamilyInsight
=====================
id, residentId FK, familyUserId FK -> User.id
insightType (WEEKLY_SUMMARY/MILESTONE/CONCERN/RECOMMENDATION)
title String
content String @db.Text  // AI-generated care summary in family-friendly language
generatedAt DateTime
viewedAt DateTime?
feedbackRating Int?  // 1-5 helpfulness
feedbackComment String?
@@index([residentId]), @@index([familyUserId]), @@index([generatedAt])
```

## 10.3 New APIs (Phase 5)

### POST /api/v2/ai/predictions/generate

```json
// Request
{
  "residentId": "uuid",
  "predictionTypes": ["FALL_RISK", "WEIGHT_LOSS", "DETERIORATION"]
}

// Response 201
{
  "predictions": [
    {
      "type": "FALL_RISK",
      "riskScore": 0.72,
      "riskLevel": "HIGH",
      "confidence": 0.85,
      "factors": [
        { "feature": "Mobility Score", "value": 2, "contribution": 0.35 },
        { "feature": "Medication Count", "value": 8, "contribution": 0.22 },
        { "feature": "Age", "value": 84, "contribution": 0.18 },
        { "feature": "Prior Falls (90d)", "value": 2, "contribution": 0.15 }
      ],
      "recommendations": [
        { "action": "Increase fall prevention rounding to every 2 hours", "priority": "HIGH", "rationale": "High mobility score + multiple fall-risk medications" },
        { "action": "Physical therapy consult for balance training", "priority": "MEDIUM", "rationale": "Mobility score declining over 3 assessments" },
        { "action": "Review medication for fall-risk-inducing drugs", "priority": "MEDIUM", "rationale": "8 medications including 3 with fall risk" }
      ]
    }
  ]
}
```

### POST /api/v2/ai/documentation/voice-to-note

```json
// Request (multipart: audio file + metadata)
{
  "clinicianId": "staff-uuid",
  "noteType": "SOAP",
  "residentId": "resident-uuid",
  "audioUrl": "uploaded-audio-url"
}

// Response 202
{
  "sessionId": "uuid",
  "status": "TRANSCRIBING",
  "estimatedSeconds": 15,
  "message": "Audio uploaded. Transcription and note generation in progress."
}

// WebSocket update on completion:
{
  "status": "COMPLETED",
  "transcription": "Patient reports feeling better today. Vital signs within normal limits...",
  "generatedNote": {
    "subjective": "Patient reports improved mood, sleeping 6-7 hours. Appetite fair, eating about 75% of meals.",
    "objective": "BP 130/82, HR 72, Temp 98.4F. Alert and oriented x3. Skin intact. Mild edema bilateral LE.",
    "assessment": "Stable. Continue current medication regimen. Monitor fluid balance.",
    "plan": "1. Continue current medications. 2. Daily weight monitoring. 3. Restrict fluids to 1500ml. 4. Reassess in 1 week."
  },
  "entities": [
    { "type": "vital", "value": "BP 130/82" },
    { "type": "vital", "value": "HR 72" },
    { "type": "vital", "value": "Temp 98.4F" },
    { "type": "medication", "value": "current medications" }
  ],
  "confidence": 0.92,
  "reviewRequired": true
}
```

### POST /api/v2/ai/careplan/suggest

```json
// Request
{ "residentId": "uuid" }

// Response 200
{
  "currentPackage": "Assisted Living Standard ($4,500/mo)",
  "currentQualityScore": 81.4,
  "suggestedChanges": [
    {
      "field": "Add Service: Physical Therapy",
      "currentValue": "Not included",
      "suggestedValue": "Add 3x/week PT sessions",
      "rationale": "Mobility score has declined from 3 to 2 over 90 days. PT shown to improve mobility scores by avg 0.8 points in similar residents.",
      "evidenceLevel": "STRONG",
      "estimatedImpact": "+4.2 quality score points",
      "estimatedCostIncrease": "+$1,200/mo"
    },
    {
      "field": "Increase Hydration Monitoring",
      "currentValue": "Daily fluid intake tracking",
      "suggestedValue": "Twice-daily fluid intake + weekly weight",
      "rationale": "Hydration score 78% with declining trend. Similar residents improved to 89% with increased monitoring.",
      "evidenceLevel": "MODERATE",
      "estimatedImpact": "+2.1 quality score points",
      "estimatedCostIncrease": "+$200/mo"
    }
  ],
  "peerComparison": {
    "similarResidents": 34,
    "averageQualityScore": 79.8,
    "bestPerformingPlan": "AL Standard + PT ($5,700/mo) -> avg 87.2 quality",
    "costEffectivenessRank": 2
  },
  "outcomePrediction": {
    "ifAdopted": { "qualityScore": 87.7, "confidence": 0.78 },
    "ifNotAdopted": { "qualityScore": 78.1, "confidence": 0.72, "note": "Based on declining trend projection" }
  }
}
```

### GET /api/v2/ai/family/:residentId/weekly-summary

```json
// Response 200
{
  "residentId": "uuid",
  "familyUserId": "uuid",
  "weekOf": "2026-07-07 to 2026-07-13",
  "summary": {
    "title": "Arthur's Weekly Update - July 13",
    "highlights": [
      "Arthur attended the garden party on Wednesday and enjoyed the live music",
      "Medication compliance was excellent at 98% this week",
      "Completed 4 out of 5 physical therapy sessions"
    ],
    "healthTrends": [
      "Weight stable at 165 lbs (no change from last week)",
      "Blood pressure well controlled, averaging 128/78",
      "Mood improved compared to last week - more social engagement"
    ],
    "upcoming": [
      "Quarterly care plan review scheduled for July 22",
      "Dental appointment on July 25 (transport arranged)",
      "Family video call recommended - Arthur has been asking about grandchildren"
    ],
    "careTeamNotes": "Physical therapist notes continued improvement in balance. Recommend continuing current therapy schedule."
  },
  "generatedAt": "2026-07-14T08:00:00Z"
}
```

## 10.4 Development Backlog

| ID | User Story | Complexity | Depends |
|----|-----------|------------|---------|
| P5-01 | ML model infrastructure -- model serving framework, versioning, A/B testing, monitoring, retraining pipeline | XL | -- |
| P5-02 | Fall risk prediction model -- train on historical falls + vitals + medications + mobility, expose prediction API | XL | P5-01 |
| P5-03 | Weight loss risk prediction -- train on nutrition data + vitals + medications + engagement, expose API | XL | P5-01 |
| P5-04 | Hospital transfer risk model -- train on acuity trends + vitals + incident history + age + comorbidities | XL | P5-01 |
| P5-05 | Deterioration early warning -- multi-vital trend analysis, anomaly detection, alert system | XL | P5-01, P2-08 |
| P5-06 | Acuity trend forecaster -- predict future acuity based on trajectory, seasonal patterns, interventions | L | P5-01, P1-05 |
| P5-07 | Voice documentation engine -- audio recording, Whisper transcription, clinical NLP, SOAP note generation | XL | -- |
| P5-08 | NLP entity extraction -- medications, vitals, diagnoses, procedures from free text | L | P5-07 |
| P5-09 | Auto-SOAP note generation -- structured clinical notes from voice or dictation, review workflow | L | P5-07, P5-08 |
| P5-10 | Care plan optimizer -- peer comparison, outcome prediction, evidence-based suggestions | XL | P1-07, P1-12 |
| P5-11 | Family AI summaries -- weekly/monthly AI-generated care updates in family-friendly language | L | P1-12, P3-01 |
| P5-12 | Predictive staffing -- seasonal demand models, day-of-week patterns, census forecasting | XL | P2-01 |
| P5-13 | Medication intelligence -- interaction checking, adherence prediction, duplicate therapy detection | L | -- |
| P5-14 | Shift handoff AI -- auto-generate handoff summaries from shift tasks, vitals, incidents | L | P5-07 |
| P5-15 | Clinical dashboard AI insights -- anomaly highlighting, trend interpretation, action recommendations | L | P5-02, P5-03 |

---

# 11. PHASE 6: ECOSYSTEM, MARKETPLACE & PAYER INTEGRATION (Weeks 41-48)

> **Theme:** "From platform to ecosystem"
> **Goal:** Third-party integrations, payer/reimbursement intelligence, referral networks, and value-based care compliance.

## 11.1 Architecture Additions

```
+=============================================================================+
|                  PHASE 6: ECOSYSTEM LAYER                                   |
|                                                                             |
|  +---------------------------+    +---------------------------+             |
|  | PLUGIN ARCHITECTURE       |    | PAYER INTEGRATION HUB    |             |
|  |                           |    |                           |             |
|  | Webhook receivers,        |    | Claims submission (837P) |             |
|  | OAuth2 API marketplace,   |    | Eligibility check (270)  |             |
|  | Custom field extensions,  |    | Prior authorization (278) |             |
|  | Event subscriptions,      |    | Remittance (835)          |             |
|  | Sandboxed execution       |    | ERA/EOB parsing          |             |
|  +---------------------------+    +---------------------------+             |
|                                                                             |
|  +---------------------------+    +---------------------------+             |
|  | REFERRAL NETWORK          |    | VALUE-BASED CARE ENGINE   |             |
|  |                           |    |                           |             |
|  | Hospital discharge feeds, |    | Quality measure auto-     |             |
|  | SNF ↔ AL transfers,      |    | calculation, CMS reporting |             |
|  | Home care partner network,|    | MDS-3 integration,        |             |
|  | Provider directory,       |    | VBP contract tracking,    |             |
|  | Bed availability feed     |    | Penalty avoidance         |             |
|  +---------------------------+    +---------------------------+             |
|                                                                             |
|  +---------------------------+    +---------------------------+             |
|  | REVENUE CYCLE MANAGEMENT  |    | COMPLIANCE AUTOMATION     |             |
|  |                           |    |                           |             |
|  | Charge capture,           |    | Auto-regulatory reports,  |             |
|  | denial management,        |    | survey preparation,       |             |
|  | payment posting,          |    | deficiency tracking,      |             |
|  | aging analysis,           |    | corrective action plans,  |             |
|  | AR management             |    | accreditation monitoring  |             |
|  +---------------------------+    +---------------------------+             |
+=============================================================================+
```

## 11.2 New Entities (Phase 6)

```
[TENANT] PayerContract
=====================
id, organizationId FK, communityId FK?
payerName String  // insurance company name
payerId String  // payer NPI/ID
contractType (MEDICAID/MEDICARE_ADVANTAGE/PRIVATE_INSURANCE/PRIVATE_PAY/VA)
effectiveDate, expirationDate
reimbursementRates Json  // { careLevel: rate, serviceCode: rate }
priorAuthRequired Boolean
priorAuthWindowDays Int?
maxBenefitDays Int?
notes String?
isActive Boolean
@@index([communityId]), @@index([payerName])

[TENANT] Claim
=====================
id, residentId FK, communityId FK, payerContractId FK
claimNumber String @unique
claimType (ORIGINAL/ADJUSTMENT/CORRECTION/VOID)
status (DRAFT/SUBMITTED/ACKNOWLEDGED/PENDING/PAID/DENIED/APPEALED)
admissionDate, dischargeDate?
serviceDateStart, serviceDateEnd
totalCharges Float
submittedAmount Float?
paidAmount Float?
denialReason String?
denialCode String?
resubmissionCount Int @default(0)
lastSubmittedAt, lastStatusCheckAt
encounterData Json  // { diagnosisCodes, procedureCodes, modifiers, units }
@@index([residentId]), @@index([communityId]), @@index([status])
@@index([payerContractId]), @@index([claimNumber])

[TENANT] PriorAuthorization
=====================
id, residentId FK, communityId FK, payerContractId FK
authNumber String?
requestType (INITIAL/REVOCATION/EXTENSION/AMENDMENT)
status (DRAFT/SUBMITTED/PENDING/APPROVED/DENIED/EXPIRED)
serviceType String  // e.g. "SNF Level 2", "PT", "Speech"
requestedUnits Int
approvedUnits Int?
authorizedDays Int?
effectiveDate, expirationDate?
clinicalJustification String @db.Text
supportingDocuments Json?
denialReason String?
submittedAt, resolvedAt?
@@index([residentId]), @@index([communityId]), @@index([status])

[TENANT] Referral
=====================
id, referringCommunityId FK -> Community.id, receivingCommunityId FK -> Community.id?
residentId FK?
referralType (INBOUND/OUTBOUND/TRANSFER)
source (HOSPITAL/HOME_CARE/COMMUNITY/PHYSICIAN/FAMILY)
status (INITIATED/SENT/ACCEPTED/DECLINED/ADMITTED/CANCELLED)
residentData Json  // demographics, diagnosis, care level, acuity score
clinicalSummary String @db.Text
urgency (ROUTINE/URGENT/EMERGENCY)
bedAvailable Boolean?
assignedTo String?
notes String?
initiatedAt, respondedAt, admittedAt?
@@index([referringCommunityId]), @@index([receivingCommunityId])
@@index([status]), @@index([referralType])

[TENANT] QualityMeasure
=====================
id, communityId FK, organizationId FK?
measureSet String  // "CMS-QM", "QAPI", "CUSTOM"
measureId String  // e.g. "DTC", "DPP", "IMP", "MRS"
measureName String
calculationType (PROCESS/OUTCOME/STRUCTURE)
numerator Json?  // { field, operator, value } - what to count
denominator Json?  // { field, operator, value } - population
target Float?
direction (HIGHER_BETTER/LOWER_BETTER)
currentValue Float?
status (MET/NOT_MET/IMPROVING/DECLINING)
period String  // QUARTERLY, ANNUAL
periodStart, periodEnd
benchmarkNational Float?
benchmarkState Float?
@@index([communityId]), @@index([measureSet]), @@index([period])

[TENANT] RevenueCycleEntry
=====================
id, communityId FK, residentId FK?
entryType (CHARGE/CASH/ADJUSTMENT/DENIAL/CORRECTION)
amount Float
description String
serviceDate DateTime
category String  // Room & Board, Skilled Nursing, Therapy, Medications, Supplies
payerSource String?
claimId FK -> Claim.id?
invoiceId FK -> Invoice.id?
batchId String?
postedAt DateTime
@@index([communityId]), @@index([entryType]), @@index([postedAt])
@@index([residentId])

[TENANT] Plugin
=====================
id, organizationId FK
name, description
publisher String
version String
type (WEBHOOK_RECEIVER/EVENT_SUBSCRIBER/CUSTOM_FIELD/API_EXTENSION/UI_WIDGET)
config Json  // plugin-specific configuration
status (ACTIVE/PAUSED/INSTALLING/ERROR)
installedAt DateTime
lastUsedAt DateTime?
usageStats Json  // { invocations24h, errors24h, avgLatencyMs }
@@index([organizationId]), @@index([type]), @@index([status])
```

## 11.3 New APIs (Phase 6)

### POST /api/v2/payer/claims/submit

```json
// Request
{
  "residentId": "uuid",
  "payerContractId": "uuid",
  "serviceDateStart": "2026-07-01",
  "serviceDateEnd": "2026-07-31",
  "encounterData": {
    "diagnosisCodes": ["F32.1", "E11.9", "I10"],
    "procedureCodes": [{ "code": "99310", "units": 31, "rate": 285.00 }],
    "modifiers": []
  }
}

// Response 201
{
  "claimId": "uuid",
  "claimNumber": "CLM-2026-0001234",
  "status": "DRAFT",
  "totalCharges": 8835.00,
  "message": "Claim created. Submit for review before sending to payer."
}
```

### POST /api/v2/payer/claims/submit-to-payer

```json
// Request
{ "claimId": "uuid" }

// Response 202
{
  "claimId": "uuid",
  "status": "SUBMITTED",
  "submittedAt": "2026-08-01T10:00:00Z",
  "estimatedResponseDays": 14,
  "trackingNumber": "ERA-2026-56789"
}
```

### POST /api/v2/referrals/initiate

```json
// Request
{
  "referringCommunityId": "uuid",
  "receivingCommunityId": "uuid",
  "residentData": {
    "firstName": "Margaret", "lastName": "Wilson",
    "careLevel": "MEMORY", "acuityScore": 78.5,
    "diagnosis": "Moderate Alzheimer's Disease",
    "currentServices": ["Bathing 3x/week", "Medication management", "Memory care program"]
  },
  "clinicalSummary": "Resident requires memory care unit. Currently in AL standard. Acuity increasing over 3 months...",
  "urgency": "URGENT",
  "bedAvailable": true
}

// Response 201
{
  "referralId": "uuid",
  "status": "SENT",
  "message": "Referral sent to Silver Springs Memory Care Unit"
}
```

### GET /api/v2/vbc/measures/:communityId

```json
// Response 200
{
  "communityId": "uuid",
  "period": "2026-Q3",
  "measures": [
    { "id": "DTC", "name": "Drug Therapy Continuation", "value": 92.1, "target": 90, "status": "MET", "benchmarkNational": 88.5 },
    { "id": "DPP", "name": "Depression Prevention", "value": 85.3, "target": 85, "status": "MET", "benchmarkNational": 82.1 },
    { "id": "IMP", "name": "Improvement in Mobility", "value": 71.2, "target": 75, "status": "NOT_MET", "benchmarkNational": 73.0 },
    { "id": "MRS", "name": "Moderate to Severe Pain", "value": 3.1, "target": 5.0, "status": "MET", "benchmarkNational": 4.2 },
    { "id": "UTI", "name": "Urinary Tract Infections", "value": 2.8, "target": 3.0, "status": "MET", "benchmarkNational": 3.5 }
  ],
  "compositeScore": 84.2,
  "estimatedVBPAdjustment": 1.02,
  "penaltyRisk": "LOW"
}
```

## 11.4 Development Backlog

| ID | User Story | Complexity | Depends |
|----|-----------|------------|---------|
| P6-01 | Plugin architecture -- webhook receivers, OAuth2 marketplace, event subscriptions, sandboxed execution, plugin registry | XL | -- |
| P6-02 | Plugin admin UI -- install/uninstall, configuration, usage monitoring, marketplace browse | L | P6-01 |
| P6-03 | Payer contract management -- contract CRUD, reimbursement rate tables, prior auth rules, benefit limits | L | P1-01 |
| P6-04 | Claims engine -- charge capture, 837P generation, electronic submission, status tracking, ERA/835 parsing | XL | P6-03, P2-10 |
| P6-05 | Prior authorization workflow -- request creation, clinical justification, document attachment, status tracking, renewal | L | P6-03 |
| P6-06 | Denial management -- denial categorization, appeal workflow, root cause analysis, resubmission tracking | L | P6-04 |
| P6-07 | Revenue cycle dashboard -- AR aging, collections rate, denial rate, revenue by payer/service, cash flow projection | L | P6-04 |
| P6-08 | Referral network -- provider directory, bed availability feed, referral initiation/acceptance, transfer documentation | XL | -- |
| P6-09 | Hospital discharge integration -- receive ADT feeds, automatic referral creation, bed hold tracking | L | P6-08 |
| P6-10 | Quality measure engine -- CMS-QM calculation, MDS-3 data mapping, measure trending, benchmark comparison | XL | P1-13 |
| P6-11 | Value-based care dashboard -- measure performance, penalty risk, improvement tracking, peer comparison | L | P6-10 |
| P6-12 | Regulatory report automation -- auto-generate state survey reports, QAPI reports, corrective action tracking | L | P6-10 |
| P6-13 | Charge capture enhancement -- real-time charge posting from task completion, service catalog rate integration | L | P1-08, P6-04 |
| P6-14 | Financial forecasting -- revenue projection by care level, census forecasting, expense budgeting | L | P2-10, P5-12 |
| P6-15 | Provider network marketplace -- list services to external partners, pricing management, availability scheduling | L | P6-08 |

---

# 12. PHASE 7: NEXT-GENERATION PLATFORM (Weeks 49-56)

> **Theme:** "From healthcare software to care operating system"
> **Goal:** IoT integration, ambient intelligence, population health, digital twins, and next-gen interfaces.

## 12.1 Architecture Additions

```
+=============================================================================+
|                  PHASE 7: NEXT-GEN PLATFORM                                 |
|                                                                             |
|  +---------------------------+    +---------------------------+             |
|  | IoT SENSOR MESH           |    | AMBIENT INTELLIGENCE      |             |
|  |                           |    |                           |             |
|  | Bed occupancy sensors,    |    | Context-aware alerts,     |             |
|  | motion/PIR detectors,     |    | environment automation,   |             |
|  | door/window sensors,      |    | fall detection cameras,   |             |
|  | temperature/humidity,     |    | wander prevention,        |             |
|  | water flow monitors,      |    | circadian lighting,       |             |
|  | smart locks, call buttons |    | noise monitoring          |             |
|  +---------------------------+    +---------------------------+             |
|                                                                             |
|  +---------------------------+    +---------------------------+             |
|  | DIGITAL TWIN              |    | POPULATION HEALTH ENGINE  |             |
|  |                           |    |                           |             |
|  | 3D facility model,        |    | Cohort analysis,          |             |
|  | real-time occupancy map,  |    | risk stratification,      |             |
|  | resident location (opt-in)|    | health equity tracking,   |             |
|  | environmental monitoring, |    | SDOH integration,         |             |
|  | evacuation planning       |    | benchmark databases       |             |
|  +---------------------------+    +---------------------------+             |
|                                                                             |
|  +---------------------------+    +---------------------------+             |
|  | REMOTE PATIENT MONITORING |    | NEXT-GEN INTERFACES       |             |
|  |                           |    |                           |             |
|  | Wearable data streams,    |    | AR care guidance (HoloLens|             |
|  | home health monitoring,   |    | or tablet), gesture input,|             |
|  | telehealth integration,   |    | real-time translation,    |             |
|  | patient-reported outcomes |    | accessibility-first UI    |             |
|  +---------------------------+    +---------------------------+             |
|                                                                             |
|  +---------------------------+    +---------------------------+             |
|  | GENOMICS & PERSONALIZED  |    | BLOCKCHAIN AUDIT TRAIL    |             |
|  | CARE                      |    |                           |             |
|  | Pharmacogenomics data,    |    | Immutable record chain,   |             |
|  | genetic risk factors,     |    | regulatory verification,  |             |
|  | personalized medication   |    | smart contracts for       |             |
|  | dosing, hereditary risk   |    | compliance automation     |             |
|  | assessment                |    |                           |             |
|  +---------------------------+    +---------------------------+             |
+=============================================================================+
```

## 12.2 New Entities (Phase 7)

```
[TENANT] IoTDevice
=====================
id, communityId FK, unitId FK?
deviceType (BED_SENSOR/MOTION_DETECTOR/DOOR_SENSOR/TEMPERATURE/CALL_BUTTON/WATER_FLOW/SMART_LOCK/WEARABLE)
deviceName String
deviceId String @unique  // hardware identifier
location String  // room, area, zone
status (ONLINE/OFFLINE/MAINTENANCE/BATTERY_LOW)
batteryLevel Int?
lastHeartbeat DateTime?
config Json  // device-specific settings
firmwareVersion String?
installedAt DateTime?
@@index([communityId]), @@index([deviceType]), @@index([status])

[TENANT] IoTReading
=====================
id, deviceId FK, communityId FK, residentId FK?
readingType (OCCUPANCY/MOTION/TEMPERATURE/HUMIDITY/BATTERY/SIGNAL/LOCATION/CALL/BED_EXIT/WATER_USE/DOOR_OPEN)
value Float
unit String?
rawPayload Json?
anomalyScore Float?  // 0-1, how unusual is this reading
alertTriggered Boolean @default(false)
alertId String?  // FK to Incident or Escalation
recordedAt DateTime
@@index([deviceId]), @@index([communityId])
@@index([readingType]), @@index([recordedAt])
@@index([deviceId, readingType, recordedAt])

[TENANT] DigitalTwinConfig
=====================
id, communityId FK @unique
floorPlanUrl String?  // SVG/image of floor plan
zones Json  // [{id, name, type, coordinates, unitId}]
sensorLayout Json  // [{deviceId, zoneId, position}]
occupancyOverlay Boolean @default(true)
environmentalOverlay Boolean @default(false)
residentLocationOverlay Boolean @default(false)
lastRenderedAt DateTime?
@@index([communityId])

[TENANT] PopulationCohort
=====================
id, organizationId FK, communityId FK?
name String
description String?
definition Json  // { filters: [{field, operator, value}] }
memberCount Int
criteria String  // human-readable description of cohort
isActive Boolean
lastCalculatedAt DateTime
@@index([organizationId]), @@index([communityId])

[TENANT] CohortAnalysis
=====================
id, cohortId FK, organizationId FK
analysisType (RISK_STRATIFICATION/OUTCOMES/BENCHMARK/SDOH/TREND)
periodStart, periodEnd
results Json  // analysis-specific results
insights Json  // [{type, finding, recommendation, confidence}]
comparedToNational Boolean
comparedToState Boolean
calculatedAt DateTime
@@index([cohortId]), @@index([analysisType])

[TENANT] SDOHRecord
=====================
id, residentId FK, communityId FK
assessmentDate DateTime
housingStability Int  // 1-5 scale
foodSecurity Int
transportationAccess Int
socialSupport Int
financialStrain Int
educationLevel String?
employmentStatus String?
languageBarrier Boolean
culturalConsiderations String?
notes String? @db.Text
assessedById FK -> Staff.id?
@@index([residentId]), @@index([communityId])

[TENANT] GenomicProfile
=====================
id, residentId FK, communityId FK
consentDate DateTime
consentStatus (CONSENTED/DECLINED/PENDING)
pharmacogenomics Json?  // [{gene, variant, medication_implication, severity}]
geneticRiskFactors Json?  // [{condition, riskLevel, evidence}]
medicationSensitivities Json?  // [{medication, metabolism, adjusted_dose, alternative}]
uploadedAt DateTime
reviewedById FK -> Staff.id?
reviewedAt?
notes String? @db.Text
@@index([residentId]), @@index([communityId])

[TENANT] AmbientAlert
=====================
id, communityId FK, zoneId String?
alertType (FALL_DETECTED/WANDER/ENVIRONMENTAL/BEHAVIORAL/EQUIPMENT/EMERGENCY)
severity (INFO/WARNING/CRITICAL/EMERGENCY)
source String  // device or system that generated alert
title String
description String @db.Text
location String
relatedResidentId FK -> Resident.id?
relatedDeviceId FK -> IoTDevice.id?
autoResolved Boolean @default(false)
acknowledgedById FK -> Staff.id?
acknowledgedAt?
responseActions Json?  // [{action, by, at}]
falseAlarm Boolean @default(false)
falseAlarmReason String?
triggeredAt DateTime
resolvedAt DateTime?
@@index([communityId]), @@index([alertType]), @@index([severity])
@@index([triggeredAt]), @@index([relatedResidentId])
```

## 12.3 New APIs (Phase 7)

### GET /api/v2/iot/dashboard/:communityId

```json
// Response 200
{
  "communityId": "uuid",
  "deviceSummary": {
    "total": 342,
    "online": 328,
    "offline": 8,
    "batteryLow": 6,
    "byType": {
      "BED_SENSOR": { "total": 120, "online": 118 },
      "MOTION_DETECTOR": { "total": 80, "online": 78 },
      "DOOR_SENSOR": { "total": 64, "online": 60 },
      "SMART_LOCK": { "total": 48, "online": 48 },
      "WEARABLE": { "total": 30, "online": 24 }
    }
  },
  "activeAlerts": 3,
  "environmental": {
    "averageTemperature": 72.4,
    "averageHumidity": 45.2,
    "zonesOutOfRange": []
  },
  "occupancy": {
    "bedsOccupied": 118,
    "bedsTotal": 120,
    "occupancyRate": 98.3,
    "unoccupiedUnits": ["205", "312"]
  },
  "recentAnomalies": [
    { "type": "BED_EXIT", "room": "201", "time": "02:45 AM", "resident": "Margaret Wilson", "status": "ACKNOWLEDGED" },
    { "type": "WATER_USE", "room": "108", "time": "03:12 AM", "note": "No water use for 18 hours - check on resident", "status": "ACTIVE" }
  ]
}
```

### GET /api/v2/population/cohorts/:cohortId/analysis

```json
// Response 200
{
  "cohortId": "uuid",
  "cohortName": "High Acuity Residents",
  "memberCount": 47,
  "analysis": {
    "riskStratification": {
      "critical": { "count": 12, "percentage": 25.5 },
      "high": { "count": 20, "percentage": 42.6 },
      "moderate": { "count": 15, "percentage": 31.9 }
    },
    "outcomes": {
      "averageQualityScore": 72.3,
      "averageLengthOfStay": 285,
      "hospitalTransferRate": 4.2,
      "fallRate": 8.1,
      "pressureInjuryRate": 1.2
    },
    "comparison": {
      "vsNational": { "qualityScore": "+2.1", "transferRate": "-0.3", "fallRate": "+1.2" },
      "vsState": { "qualityScore": "-1.5", "transferRate": "+0.8", "fallRate": "+0.5" }
    },
    "sdoh": {
      "foodInsecurityRate": 15.3,
      "transportationBarriers": 22.1,
      "socialIsolationRate": 18.7
    }
  },
  "insights": [
    { "type": "HEALTH_EQUITY", "finding": "Residents with food insecurity have 2.3x higher weight loss rate", "recommendation": "Partner with Meals on Wheels for supplemental nutrition" },
    { "type": "OUTCOME", "finding": "PT participation correlates with 40% lower fall rate in this cohort", "recommendation": "Increase PT referral rate for high-acuity residents" }
  ]
}
```

### GET /api/v2/ambient/alerts/live

```json
// WebSocket stream for real-time alerts
// Initial payload:
{
  "communityId": "uuid",
  "activeAlerts": [
    {
      "id": "uuid",
      "type": "BED_EXIT",
      "severity": "WARNING",
      "room": "201",
      "resident": "Margaret Wilson",
      "triggeredAt": "2026-07-17T02:45:00Z",
      "acknowledgedBy": "Sarah Jenkins, RN",
      "acknowledgedAt": "2026-07-17T02:46:30Z",
      "location": "Room 201, Memory Care Wing",
      "autoActions": ["Nurse notified", "Call bell activated"]
    }
  ],
  "environmentalAlerts": [
    {
      "type": "TEMPERATURE",
      "severity": "INFO",
      "zone": "Dining Room",
      "message": "Temperature 76.2F - above comfort zone (68-74F)",
      "autoAction": "HVAC adjusted to 72F"
    }
  ]
}
```

### POST /api/v2/sdoh/assess

```json
// Request
{
  "residentId": "uuid",
  "housingStability": 4,
  "foodSecurity": 2,
  "transportationAccess": 3,
  "socialSupport": 2,
  "financialStrain": 2,
  "educationLevel": "High School",
  "employmentStatus": "Retired",
  "languageBarrier": false
}

// Response 201
{
  "recordId": "uuid",
  "riskFactors": [
    { "domain": "Food Security", "score": 2, "riskLevel": "HIGH", "recommendation": "Connect with nutrition services, SNAP benefits" },
    { "domain": "Social Support", "score": 2, "riskLevel": "HIGH", "recommendation": "Increase activity participation, connect with family" },
    { "domain": "Financial Strain", "score": 2, "riskLevel": "MODERATE", "recommendation": "Review billing options, financial counseling referral" }
  ],
  "overallSDOHRisk": "MODERATE",
  "suggestedInterventions": [
    "Refer to social worker for comprehensive assessment",
    "Connect with community food bank partnership",
    "Enroll in facility social engagement program"
  ]
}
```

## 12.4 Development Backlog

| ID | User Story | Complexity | Depends |
|----|-----------|------------|---------|
| P7-01 | IoT platform core -- device registry, MQTT/HTTP ingestion, reading storage, device health monitoring, firmware management | XL | -- |
| P7-02 | Bed occupancy sensors -- real-time bed status (occupied/unoccupied/making), integration with occupancy dashboard | L | P7-01 |
| P7-03 | Motion/PIR detectors -- room-level activity tracking, inactivity alerts (no motion for X hours), pattern learning | L | P7-01 |
| P7-04 | Door/window sensors -- entry/exit tracking, wander prevention for memory care, after-hours door alerts | L | P7-01 |
| P7-05 | Environmental monitoring -- temperature, humidity, air quality, water flow (bathroom safety), noise levels | L | P7-01 |
| P7-06 | Smart lock integration -- remote lock/unlock, access logging, temporary codes for visitors, emergency lockdown | L | P7-01 |
| P7-07 | Anomaly detection engine -- statistical anomaly detection on IoT streams, adaptive baselines per resident, false alarm learning | XL | P7-01, P5-01 |
| P7-08 | Digital twin -- 3D floor plan renderer, real-time sensor overlay, occupancy heatmap, environmental overlay | XL | P7-01 |
| P7-09 | Digital twin mobile -- responsive digital twin for tablets/phones, room-level drill-down, resident location (opt-in) | L | P7-08 |
| P7-10 | Population health cohort builder -- drag-and-drop cohort definition, auto-refresh membership, saved cohorts | L | P1-03 |
| P7-11 | Cohort analysis engine -- risk stratification, outcome analysis, national/state benchmark comparison | XL | P7-10, P6-10 |
| P7-12 | SDOH assessment -- standardized screening tool, risk factor identification, intervention recommendation, community resource mapping | L | -- |
| P7-13 | SDOH-integrated care planning -- SDOH factors influence care plan recommendations, social work referral automation | L | P7-12, P5-10 |
| P7-14 | Remote patient monitoring dashboard -- wearable data streams, home health device integration, telehealth session management | XL | P7-01, P3-07 |
| P7-15 | Genomics data management -- pharmacogenomics upload, consent tracking, medication interaction alerts from genetic data | L | -- |
| P7-16 | Personalized medication dosing -- genotype-based dosing recommendations, CYP450 interaction alerts, alternatives | L | P7-15 |
| P7-17 | AR care guidance (prototype) -- tablet-based AR overlay for care procedures, step-by-step guidance, checklist display | XL | -- |
| P7-18 | Real-time translation -- multi-language support for clinical documentation, family communication, resident interaction | L | P5-07 |
| P7-19 | Accessibility-first UI overhaul -- WCAG 2.1 AAA compliance, screen reader optimization, keyboard navigation, high contrast | L | -- |
| P7-20 | Blockchain audit trail (proof of concept) -- immutable record chain for critical clinical events, regulatory verification | XL | P1-10 |

---

# 13. COMPLETE PHASE ROADMAP SUMMARY

## Timeline Overview

```
Week:  1----8----16----24----32----40----48----56
       |         |          |          |          |          |          |          |
Phase: [Phase 1  ][Phase 2  ][Phase 3  ][Phase 4  ][Phase 5  ][Phase 6  ][Phase 7  ]
       Foundation Intelligence AI/Integ  Enterprise AI/ML     Ecosystem  Next-Gen
       Wk 1-8   Wk 9-16   Wk 17-24  Wk 25-32  Wk 33-40  Wk 41-48  Wk 49-56
```

## Complexity Distribution

| Phase | S | M | L | XL | Total |
|-------|---|---|---|-----|-------|
| Phase 1 | 0 | 3 | 9 | 3 | **15** |
| Phase 2 | 1 | 5 | 8 | 1 | **15** |
| Phase 3 | 0 | 3 | 9 | 3 | **15** |
| Phase 4 | 0 | 2 | 10 | 3 | **15** |
| Phase 5 | 0 | 3 | 6 | 6 | **15** |
| Phase 6 | 0 | 3 | 9 | 3 | **15** |
| Phase 7 | 0 | 4 | 11 | 5 | **20** |
| **Total** | **1** | **23** | **62** | **24** | **110** |

## Cumulative Entity Count

| Phase | New Models | Modified Models | New Enums | Total Models |
|-------|-----------|----------------|-----------|--------------|
| v2.0 (existing) | 50 | — | 43 | 50 |
| Phase 1 | 17 | 4 | 7 | 67 |
| Phase 2 | 1 | 0 | 0 | 68 |
| Phase 3 | 0 | 0 | 0 | 68 |
| Phase 4 | 6 | 0 | 0 | 74 |
| Phase 5 | 6 | 0 | 0 | 80 |
| Phase 6 | 7 | 0 | 0 | 87 |
| Phase 7 | 9 | 0 | 0 | 96 |

## Cumulative API Endpoint Count

| Phase | New Endpoints | Total (approx) |
|-------|--------------|-----------------|
| v2.0 (existing) | ~60 | ~60 |
| Phase 1 | ~15 | ~75 |
| Phase 2 | ~12 | ~87 |
| Phase 3 | ~20 | ~107 |
| Phase 4 | ~10 | ~117 |
| Phase 5 | ~8 | ~125 |
| Phase 6 | ~15 | ~140 |
| Phase 7 | ~10 | ~150 |

## Technology Additions by Phase

| Phase | New Technology Dependencies |
|-------|-----------------------------|
| Phase 1 | PostgreSQL RLS, Supabase Policies |
| Phase 2 | BullMQ + Redis (event bus) |
| Phase 3 | External API connectors (REST/SOAP), React Native |
| Phase 4 | Email service (SendGrid/SES), PDF generation (Puppeteer), S3/Blob storage |
| Phase 5 | TensorFlow/PyTorch (model serving), Whisper (speech), OpenAI/Claude API (NLP) |
| Phase 6 | X12 EDI (claims), HL7 FHIR (interoperability), OAuth2 marketplace |
| Phase 7 | MQTT broker (IoT), Three.js (digital twin), WebXR (AR), Blockchain (immutable audit) |

---

# 14. UPDATED TESTING PLAN (PHASES 4-7)

## Phase 4 Testing

| Test | Target | Method |
|------|--------|--------|
| Cross-community KPI aggregation | < 5s for 10 communities | k6 load test |
| Bulk operations (1000 assessments) | < 30s completion | Async job monitoring |
| Report generation (PDF, 50 pages) | < 10s | Automated generation test |
| White-label rendering | All themes render correctly | Visual regression (Percy) |
| Benchmark engine accuracy | Rank matches manual calculation | 10 community comparison test |

## Phase 5 Testing

| Test | Target | Method |
|------|--------|--------|
| Fall risk model AUC | > 0.80 | ROC analysis on held-out test set |
| Weight loss prediction precision | > 0.75 | Precision-recall analysis |
| Voice transcription accuracy | > 90% WER for medical terms | 100 sample medical dictations |
| SOAP note generation quality | Clinician approval rate > 85% | Blind review by 3 physicians |
| Care plan suggestion acceptance | > 60% adopted by clinicians | Track adoption over 3 months |
| Family summary helpfulness | > 4.0/5.0 rating | Family member feedback |

## Phase 6 Testing

| Test | Target | Method |
|------|--------|--------|
| Claims 837P generation | 100% valid X12 format | X12 validation tool |
| ERA/835 parsing accuracy | > 98% correct payment posting | 100 sample ERAs |
| Prior auth submission success | > 95% accepted by payer | Track submission outcomes |
| Quality measure calculation | Match CMS QM specifications | Compare against CMS calculators |
| Referral network availability | 99.9% uptime | Synthetic monitoring |

## Phase 7 Testing

| Test | Target | Method |
|------|--------|--------|
| IoT ingestion throughput | 10,000 readings/second | k6 load test with simulated devices |
| Alert latency (sensor to notification) | < 5 seconds P95 | End-to-end latency test |
| Anomaly detection precision | > 80% true positive rate | Historical anomaly dataset |
| Digital twin render time | < 2s initial load | Browser performance testing |
| SDOH assessment validity | Cronbach alpha > 0.70 | Psychometric analysis |
| Blockchain write latency | < 500ms per block | Throughput benchmark |
| Accessibility compliance | WCAG 2.1 AAA | Axe automated + manual audit |

---

# APPENDIX B: GLOSSARY

| Term | Definition |
|------|-----------|
| **Acuity Score** | Composite numeric score (0-100) derived from 9 assessment dimensions, indicating resident care complexity |
| **Care Package** | Bundle of services, tasks, SOPs, and documentation requirements assigned to a resident based on care level |
| **Care Intelligence Loop** | Core platform cycle: Assessment -> Acuity -> Care Package -> Tasks -> Documentation -> Quality -> Reassessment |
| **Community** | A single senior living facility/building within the organization hierarchy |
| **SDOH** | Social Determinants of Health — non-medical factors (housing, food, transportation) affecting health outcomes |
| **VBP** | Value-Based Purchasing — CMS payment model linking reimbursement to quality outcomes |
| **MDS** | Minimum Data Set — standardized assessment instrument for post-acute care |
| **SBAR** | Situation-Background-Assessment-Recommendation — clinical communication framework |
| **RLS** | Row-Level Security — PostgreSQL feature for tenant-level data isolation |
| **FTE** | Full-Time Equivalent — staffing unit equal to one person working 40 hours/week |
| **P95** | 95th percentile — response time below which 95% of requests complete |
| **AUC** | Area Under the Curve — ML model performance metric (1.0 = perfect, 0.5 = random) |
