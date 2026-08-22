
# Care360 Role-Based Dashboards — Implementation Plan

Source: `Care360_LC_Role_Based_Dashboard_Requirements_v1.1.docx.pdf`

Status: implemented in application code on 2026-08-22; database migration is staged and must be applied during deployment.

Implemented scope:

- Shared, tenant-scoped dashboard read model, deterministic P1-P4 policy, Stable/Watch/Escalated state, KPI definitions, freshness, comparisons, lineage, and exact numerator/denominator drill-down API.
- Nurse Shift Command, Caregiver My Shift, Care Manager Clinical Governance, Facility Care Oversight, Resident Coordinator, and Physician Professional Review dashboards wired as each role's default surface.
- Caregiver assignment-only server scope, late-change acknowledgement, traceable Need Nurse/Need Help escalation, standardized Today's Care outcome links, and shift-close/handover continuity links.
- `RESIDENT_COORDINATOR` role registration, provisioning, navigation, session validation, portal routing, and a fail-closed generic-data boundary; coordination selectors fetch non-clinical sources only.
- Relational shift/assignment/history/work-item/help-request/handover/metric-snapshot schema and migration, with legacy JSON schedule/endorsement compatibility retained for rollout.
- Correct `CARE_MANAGER` identity propagation through shared clinical boards, audited dashboard writes, permission-safe source links, and community/service-context contracts.

Deployment note: run the included Prisma migration in the target environment before relying on relational mirrors. Prisma Client generation is also required in deployment; local generation was blocked by the currently running Next.js process holding the Windows query-engine DLL.

## 1. Outcome and scope

Build role-specific command surfaces over one governed resident and care-delivery record. Each role sees the same underlying facts through a view shaped around its decisions and permitted actions.

The first release covers:

- Nurse / Nurse on Duty: shift command and clinical triage.
- Caregiver: a personal shift worklist limited to assigned residents and tasks.
- Care Manager / Clinical Lead: cross-shift clinical governance.
- Facility Administrator: aggregate facility operations and quality oversight.
- Resident Coordinator: non-clinical resident coordination.
- Other professionals: limited, discipline-appropriate review using existing physician and allied-health roles.

The first release does not add finance, revenue, marketing, or Home Care screens. The data contracts will carry a service context so Home Care can be added later without rebuilding assignment and queue logic.

## 2. Product principles and non-negotiables

1. One record, multiple views. Dashboards must link back to the same resident, care plan, care event, task, incident, assessment, and handover records already used elsewhere.
2. No parallel clinical logic. Level of care, decision-tree triggers, escalation conditions, and care-plan rules remain in `src/lib/lifecare`; dashboards consume their outputs.
3. No hidden automation. A KPI or queue may recommend review, but it must not silently alter level of care, fees, care plans, assignments, or task outcomes.
4. Every actionable item has an owner, status, priority, due time, source, and direct drill-down.
5. Every metric defines its numerator, denominator, time window, exclusions, current value, baseline/comparison, freshness, and source lineage.
6. Shift views are operational, not analytical: urgent work first, then due work, staffing gaps, watchlist, and handover.
7. Oversight views are aggregate-first but never dead ends: every count opens the filtered source list.
8. Clinical state uses the vocabulary `Stable`, `Watch`, and `Escalated`, with a visible reason and last-updated time.

## 3. Current-state assessment

### Reusable foundations

- Dynamic role routing already exists in `src/app/[role]/[tab]/page.tsx` and the role-specific portal content components.
- `NurseDashboard.tsx`, `caregiver/CaregiverDashboard.tsx`, `CareManagerDashboard.tsx`, and `FacilityDashboard.tsx` provide existing layouts and live-query patterns.
- Governed LifeCare data already exists for assessments, active care plans, care-plan items, generated tasks, and `CareEvent` outcomes.
- Relevant operational boards already exist: Today's Care, Task Assignment, Caregiver Schedule, Care Delivery, Care Acuity, Care Plan Reviews, Shift Endorsements, Resident Journey, incidents, alerts, call bells, and resident profiles.
- Signed server sessions already carry the active organization and community context.
- Audit logging and Supabase-driven refresh infrastructure already exist.

### Material gaps

| Area | Current state | Required change |
| --- | --- | --- |
| Nurse dashboard | General incidents, vitals, call bells, residents, and unassigned tasks | Create priority queues (P1–P4), nurse-review queue, due/overdue work, staffing/deployment, watchlist, next-two-hours view, new-since-shift, and handover state |
| Caregiver dashboard | Filters tasks to the signed-in staff record, but also loads facility-wide residents, incidents, bells, and unassigned work | Enforce assignment scope on the server; present Now/Next/Later, resident precautions, standardized outcomes, Need Nurse/Need Help, assignment acknowledgement, and shift close |
| Care Manager dashboard | Lean incident oversight only | Add cross-shift governance, care-plan/assessment/review queues, delivery variance, trends, staffing coverage, handover quality, and quality KPIs |
| Facility Admin dashboard | Facility services, admissions, inventory, purchasing, CRM, and staffing | Add aggregate care quality, staffing coverage, safety, documentation, responsiveness, trend, and drill-down zones; exclude finance/revenue/marketing from this dashboard |
| Resident Coordinator | No application role or portal | Add role, permissions, account provisioning, route, navigation, and non-clinical coordination dashboard |
| Assignments | Task assignee exists; caregiver schedules are stored as `AppSetting` JSON | Add relational shift and resident assignments with history and acknowledgement |
| Handover | `ShiftReport` exists; the richer endorsement workflow also uses `AppSetting` JSON | Move the required structured per-resident handover and acceptance state to relational records |
| Queue ownership | Derived independently in client components | Add a shared, server-derived work-item contract and common prioritization policy |
| KPIs | Calculated ad hoc in each browser, often from capped result sets | Add server-side metric definitions and queries with lineage and freshness metadata |
| Access control | Client filtering is common | Enforce role, tenant, community, assignment, and resident scope in dashboard APIs |

`RESIDENT_COORDINATOR` is absent from the Prisma `Role` enum, the TypeScript `Role` union, valid-session roles, role configuration, provisioning definitions, and portal routing. It must be added end-to-end before that dashboard can ship.

## 4. Target architecture

### 4.1 Shared dashboard read model

Add role-specific endpoints backed by shared server queries:

- `GET /api/dashboards/nurse?shiftId=...`
- `GET /api/dashboards/caregiver?shiftId=...`
- `GET /api/dashboards/care-manager?window=...`
- `GET /api/dashboards/facility-admin?window=...`
- `GET /api/dashboards/resident-coordinator?window=...`
- `GET /api/dashboards/drilldown/[metricKey]?...`

Each response includes:

- `asOf` and `freshnessSeconds`;
- active organization, community, service context, shift, and role scope;
- queue sections with stable item IDs;
- KPI cards with metric definition metadata;
- `sourceHref` for every item and drill-down parameters for every aggregate;
- explicit partial-data or stale-data warnings.

Do not build these views by downloading hundreds of generic records into the browser and recounting them. Queries must be tenant-scoped and aggregate in the database so counts are complete, auditable, and consistent across roles.

### 4.2 Shared domain contracts

Create `src/lib/dashboard/` with:

- `types.ts` — shared queue, metric, shift, clinical-state, and role response types.
- `authorization.ts` — centralized role/action matrix and assignment-scope checks.
- `priority.ts` — deterministic P1–P4 classification, due-state calculation, and tie-breaking.
- `metrics.ts` — versioned KPI registry.
- `queries/` — tenant-scoped Prisma selectors for queues, coverage, handover, care delivery, and drill-downs.
- `links.ts` — canonical source-record and filtered-list routes.

The common queue item contains a stable ID, kind, P1–P4 priority, Stable/Watch/Escalated state, title, resident and room references, owner, due/occurred timestamps, reason, source type/ID, and source link. Names and rooms must come from database records, never constants.

### 4.3 Relational data changes

Add Prisma models through `prisma/schema.prisma` and mirror them in the FastAPI SQLAlchemy/Pydantic layer if the backend needs to read or write them.

1. `CareShift`
   - community, service context (`FACILITY` initially), shift type, start/end, status, lead, opened/closed timestamps.
2. `ShiftStaffAssignment`
   - shift, staff, role-on-shift, zone/unit, assigned by, acknowledgement state and timestamp.
3. `ShiftResidentAssignment`
   - shift, resident, primary caregiver, covering nurse, assistance-level snapshot, assigned by, acknowledgement, active interval.
4. `AssignmentHistory`
   - immutable old/new assignment, reason, actor, timestamp; supports “new since shift” and late-change acknowledgement.
5. `ClinicalWorkItem`
   - optional persisted coordination item for records that do not already have an owner/due lifecycle; stores source reference, queue class, owner, due time, status, disposition, and resolution. Do not duplicate incident/task/care-event facts.
6. `StaffHelpRequest`
   - caregiver-originated Need Nurse / Need Help, resident/task context, priority, recipient/owner, accepted/resolved timestamps.
7. `ShiftHandover` and `ShiftHandoverItem`
   - outgoing/incoming shift, per-resident situation/background/assessment/recommendation, changes, open risks, overdue/carried work, medication/appointment concerns, follow-up owner and due time, source links, outgoing signature, incoming acceptance, and amendments.
8. `MetricSnapshot` only where a historical baseline cannot be reproduced efficiently from source events.

Migration approach:

- Dual-read existing caregiver schedule and shift-endorsement `AppSetting` values during transition.
- Write new changes only to relational models once parity is verified.
- Backfill identifiable historical records with provenance marking them as migrated.
- Remove the JSON fallback only after acceptance tests and production reconciliation pass.

### 4.4 KPI registry and lineage

Every KPI gets a stable key and versioned definition containing its label, numerator, denominator, exclusions, default window, owning role, source models, and definition version.

Initial KPI catalog:

- Care delivery completion and on-time rates.
- Overdue and missed governed care events.
- Variance and repeated-variance rates.
- Escalation volume, acknowledgement time, and resolution time.
- Incident rate, severity mix, and follow-up completion.
- Assessment, care-plan, and review timeliness.
- Assignment coverage, unassigned residents/tasks, and staffing gaps.
- Handover sign-off, acceptance, completeness, and carried-item closure.
- Documentation completeness and freshness.
- Call-bell response time where source timestamps support it.

Metric cards show the current value, baseline/comparison, time window, status threshold, last refresh, and definition affordance. Clicking a card opens the exact numerator/denominator records; access control is rechecked on the drill-down API.

## 5. Role experiences

### 5.1 Nurse / Nurse on Duty — Shift Command

Default route: `/nurse/dashboard`.

Zones, in order:

1. Shift header: active shift, nurse in charge, census, coverage, last refresh, handover acceptance.
2. Act Now: P1–P2 events including emergency/call-bell escalation, critical incident, acute change, urgent help request, or time-critical overdue care.
3. Nurse Review: clinical observations, care-event variances, modifier/reassessment flags, held/refused medication, abnormal findings, and caregiver escalation awaiting nurse disposition.
4. Due / Overdue: grouped by overdue, due now, and next two hours.
5. Deployment: staffed vs required, unassigned residents, uncovered tasks, assignment changes awaiting acknowledgement.
6. Resident Watchlist: Stable/Watch/Escalated with reason, owner, last meaningful update, and direct resident journey link.
7. Care Delivery: shift completion, missed/variance work, and documentation gaps.
8. New Since Shift Start: new admissions/returns, incidents, orders, care-plan changes, assignment changes, and alerts.
9. Handover: incoming acceptance, carried items, outgoing completion readiness, and sign/accept actions.

P1–P4 must be a shared policy with test cases, not colors inferred in JSX. The dashboard may acknowledge, assign, escalate, open, or resolve only actions permitted by the role matrix; clinical source records remain authoritative.

### 5.2 Caregiver — My Shift

Default route: `/caregiver/dashboard`.

- Server response contains only the signed-in caregiver’s active shift assignments and permitted resident context.
- Header shows shift, unit/zone, assigned-resident count, task progress, and assignment acknowledgement state.
- Work is organized as Now, Next, and Later using due time and priority.
- Each task shows resident, room, task, timing, assistance level, precautions, documentation requirement, and relevant care-plan instruction.
- Standardized outcomes use the governed care-event outcomes already in LifeCare; free text supplements but does not replace the structured outcome.
- Need Nurse and Need Help create traceable help requests and surface immediately in the receiving nurse queue.
- Late assignment changes require acknowledgement and retain history.
- Shift close blocks on unresolved documentation and clearly carries permitted outstanding items into handover.
- Facility-wide clinical queues, unassigned work, and unrelated residents are not returned to this role.

### 5.3 Care Manager / Clinical Lead — Clinical Governance

Default route: `/care-manager/dashboard`.

Zones:

- Clinical state and trend summary across current and recent shifts.
- Residents in Watch/Escalated state and residents with repeated variance.
- Assessments awaiting completion/approval and evidence gaps.
- Care plans awaiting review/release, reviews due/overdue, and inactive/superseded-plan anomalies.
- Care-delivery completion, on-time rate, missed care, variance patterns, and documentation gaps.
- Incident/escalation follow-up and response-time trends.
- Staffing/assignment coverage and continuity risk.
- Handover completeness, acceptance, carried work, and recurring carryover.
- Quality and compliance measures with exact drill-downs.

Use the actual `CARE_MANAGER` role when opening shared clinical boards; existing mappings that pass `FACILITY_ADMIN` should be corrected as part of this work.

### 5.4 Facility Administrator — Facility Oversight

Default route: `/facility-admin/dashboard`.

Aggregate-first zones:

- Facility status: census, staffed shift, coverage, and service freshness.
- Care quality: delivery, variance, reviews, and documentation.
- Safety: incidents, escalation response, falls/medication/safeguarding groupings where supported by source data.
- Workforce operations: required vs assigned coverage, absences, unassigned work, acknowledgement gaps.
- Resident experience and service coordination using available request/event data.
- Handover and continuity performance.
- Trends and comparisons with stable metric definitions.

The role may drill down only to data its permissions allow. Finance/revenue and CRM content remain available in their dedicated modules but are removed from this care-operations dashboard scope.

### 5.5 Resident Coordinator — Resident Coordination

New default route: `/resident-coordinator/dashboard`.

- Upcoming appointments, transport, admissions/returns, community activities, resident/family requests, and non-clinical follow-ups.
- Coordination work grouped as urgent, today, upcoming, and awaiting another owner.
- Resident identity, preferences, contacts, consent/status, and logistics only to the role’s permitted depth.
- Clinical state is a minimal coordination cue (Stable/Watch/Escalated plus contact-the-nurse instruction), not a detailed clinical record.
- Can create/update coordination tasks and acknowledge handoffs; cannot approve assessments, release care plans, resolve clinical incidents, or edit clinical outcomes.

### 5.6 Other professionals

Use existing `PHYSICIAN`, `NUTRITIONIST`, and other discipline roles instead of a broad new “professional” role. Their dashboards can reuse the shared queue/KPI contracts with discipline filters and read/review permissions. Define each in the permissions matrix before exposing any clinical drill-down.

## 6. Navigation and component plan

Retain the existing dynamic role route and replace dashboard bodies incrementally.

Proposed structure:

```text
src/components/portal/dashboards/
  shared/
    DashboardFrame.tsx
    ShiftHeader.tsx
    QueueSection.tsx
    QueueItem.tsx
    MetricCard.tsx
    MetricDefinitionDrawer.tsx
    ClinicalStateBadge.tsx
    FreshnessIndicator.tsx
    DrilldownDrawer.tsx
  nurse/NurseShiftCommand.tsx
  caregiver/CaregiverMyShift.tsx
  care-manager/CareManagerGovernance.tsx
  facility-admin/FacilityCareOversight.tsx
  resident-coordinator/ResidentCoordinatorDashboard.tsx
```

Reuse the clinical visual tokens and interaction patterns in `src/components/portal/views/clinical/clinical-ui.tsx`. Preserve keyboard access, visible focus, semantic headings, minimum touch targets, responsive single-column fallbacks, reduced-motion behavior, and text labels in addition to color/status icons.

Dashboard navigation targets should reuse current boards where possible:

- Today's Care and Care Delivery for governed task/event detail.
- Task Assignment and Caregiver Schedule for deployment.
- Shift Endorsements for handover.
- Resident Journey and Resident Profile for longitudinal detail.
- Assessment & Level of Care and Care Plan Reviews for governance queues.
- Incident, escalation, alert, MAR, call-bell, and appointment boards for source actions.

## 7. Delivery phases

### Phase 0 — Contracts, security, and data integrity (P0)

- Approve the role/action/visibility matrix from the requirements document.
- Add `RESIDENT_COORDINATOR` end-to-end: Prisma role, account definitions/seeds, session validation, provisioning APIs, role config, router, portal content, and tests.
- Add relational shift, assignment, help-request, and handover models.
- Add migration/backfill and dual-read support for schedule/endorsement JSON.
- Implement dashboard authorization helpers and assignment-scoped caregiver access.
- Implement shared queue, priority, clinical-state, KPI, and lineage contracts.
- Add tenant-scoped aggregation and drill-down APIs.
- Add audit events for assignment, acknowledgement, escalation, handover, and dashboard actions.

Exit gate: API contract tests prove cross-tenant isolation, caregiver assignment isolation, deterministic priority, traceable metrics, and no dashboard mutation of LOC/fees/care plans.

### Phase 1 — Shift execution (P0)

- Ship Nurse Shift Command.
- Ship Caregiver My Shift.
- Connect Need Nurse/Need Help to the nurse queue.
- Ship assignment acknowledgement and “new since shift”.
- Ship structured outgoing sign-off and incoming acceptance.
- Integrate Today’s Care and CareEvent outcomes rather than duplicating task completion logic.

Exit gate: a complete test shift can be received, staffed, assigned, executed, escalated, closed, signed, and accepted with an auditable chain.

### Phase 2 — Clinical governance (P1)

- Ship Care Manager dashboard and its KPI drill-downs.
- Add assessments, care-plan review/release, repeated variance, documentation, staffing, and handover-quality queues.
- Add baseline/current trends and persisted snapshots only where necessary.

Exit gate: every aggregate reconciles to the source record list and governance users can resolve the workflow without leaving orphaned queue items.

### Phase 3 — Facility oversight and coordination (P1)

- Ship Facility Administrator care-operations dashboard.
- Add Resident Coordinator role and dashboard.
- Add discipline-filtered other-professional views where approved.
- Remove superseded care-operations widgets from the existing Facility dashboard while keeping finance/CRM in their dedicated navigation modules.

Exit gate: role-based usability and permission testing passes for every required role, including forbidden-action tests.

### Phase 4 — Optimization and future readiness (P2)

- Performance-tune high-volume queries and add caching with explicit freshness.
- Add configurable thresholds with versioned audit history.
- Add exports only where access and metric definitions can be preserved.
- Validate the service-context contract with fixture data for a future `HOME_CARE` value; do not expose Home Care UI or workflows yet.

## 8. Verification strategy

### Unit tests

- P1–P4 priority and due-state classification.
- Stable/Watch/Escalated classification and reason selection.
- KPI numerator, denominator, exclusions, window boundaries, and zero-denominator behavior.
- Role/action matrix and source-link generation.
- Handover completeness and shift-close blockers.

### API and authorization tests

- Organization/community scoping on every endpoint.
- Caregiver sees only assigned residents/tasks and cannot enumerate other data by changing query parameters.
- Nurse, Care Manager, Administrator, Resident Coordinator, and other-professional action permissions.
- Drill-down totals reconcile with the parent KPI.
- Stale/partial-source state is returned explicitly.
- Assignment change, acknowledgement, help request, escalation, sign-off, and acceptance create audit entries.

### End-to-end workflow tests

1. Incoming nurse accepts handover and sees carried items.
2. Nurse identifies an uncovered resident and assigns a caregiver.
3. Caregiver acknowledges the change and sees the resident/task.
4. Caregiver records a standardized variance and requests nurse review.
5. Nurse acknowledges/dispositions the review; source records and queues update together.
6. Care Manager sees the variance in governance metrics and drills to the source.
7. Administrator sees only the aggregate and permitted drill-down.
8. Outgoing shift closes, signs, and transfers unresolved owned work.

### Quality checks

- Responsive validation at phone, tablet, laptop, and wide desktop widths.
- Keyboard-only and screen-reader checks; status never communicated by color alone.
- Loading, empty, error, stale, partial-data, and offline/reconnect states.
- Query plans and response budgets using production-scale fixture volumes.
- `npm run lint`, focused tests, Prisma validation/generation, and `npm run build` in CI.

## 9. Acceptance criteria

- Each required role lands on a materially different, task-appropriate dashboard while reading the same governed source records.
- Nurses can identify P1/P2 work, overdue care, review items, coverage gaps, watch residents, new events, and handover state without searching multiple modules.
- Caregivers receive only their assigned work and resident context, can document standardized outcomes, and can raise traceable help/escalation requests.
- Care Managers can monitor cross-shift delivery, assessment/care-plan governance, variance, incidents, coverage, documentation, and handover quality.
- Facility Administrators see aggregate care quality, safety, staffing, continuity, and trend indicators with permission-safe drill-downs.
- Resident Coordinators can manage non-clinical coordination without gaining clinical approval/edit authority.
- Every metric displays its definition, window, comparison, freshness, and drill-down; displayed totals reconcile exactly with their drill-down records.
- Every actionable item has ownership and due state, and every write is attributable in the audit trail.
- Dashboard automation never changes level of care, pricing, assessments, care plans, or clinical outcomes without the existing governed human action.
- No facility, resident, room, person, contact, or address data is hardcoded.

## 10. Implementation decisions to confirm before Phase 0 closes

- Final user-facing title for `RESIDENT_COORDINATOR` and whether it is assignable at organization or community scope (recommended: community scope).
- Community-configured shift boundaries versus the current fixed three-shift defaults (recommended: configurable boundaries with migration defaults).
- Which existing allied-health roles are in the “other professional” MVP and their exact clinical drill-down permissions.
- KPI status thresholds and baseline periods; definitions must be approved before thresholds are enabled.
- Whether the current `ShiftReport` is retained as a narrative summary alongside structured handover (recommended) or folded into the new handover aggregate.
