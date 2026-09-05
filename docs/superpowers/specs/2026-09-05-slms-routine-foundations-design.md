# SLMS v4.2 Routine — Sub-project #1: Foundations — Design

**Date:** 2026-09-05
**Status:** Draft design → awaiting user review
**Governing spec:** `SLMS_v4.2_AS_Goals_Tasks_24-Hour_Routine (2).xlsx` (authoritative — adds
LOC Standard Routine Bundles, Conditional Bundle Activation, Routine Assembly Rules,
Caregiver Execution Rules, Care Event Result Fields, Dashboard Workflow Rules,
Controlled Vocabulary).
**Reference:** the facility's manual "Resident Routine" form (Time | Activity | Level of
Assistance | Assisted By) is the target caregiver-view shape.

## Program context (why this sub-project exists)

The client's 24-hour routine requirement is ~5 dependency-ordered sub-projects, each with
its own spec → plan → build:

1. **Foundations** *(this spec)* — rule data + pure functions. Migration-free. No UI, no schema.
2. **Assembly engine** — pure `assembleRoutine()` implementing the 21-step Routine Assembly
   Rules → draft event definitions (adds day-of-week / PRN / every-other-day frequency).
3. **Persistence + Nurse approval** — `RoutineEventDefinition` + `RoutineOccurrence` Prisma
   models; nurse Draft→Review→Approve board; versioning + immutable history; occurrences
   generated only after Approved + effective.
4. **Caregiver atomic execution** — replace bundled Today's Care with atomic events; My Shift
   ↔ Resident Daily Routine; Complete / Record & Complete / Open MAR / Open TAR; typed result
   gates.
5. **Exceptions · escalation · handover · audit lifecycle** — separate controlled-vocab state
   fields; P1–P4 linked nurse-review; no silent rollover; handover; revision preserves history;
   discontinuation; append-only correction.

Everything downstream consumes Foundations. This sub-project ships **only** typed, tested rule
tables and pure helpers — nothing that renders or writes to a DB.

## Decisions locked (brainstorming)

- **Persistence (later phases): real Prisma models** — not migration-free JSON. Foundations
  itself stays migration-free (JSON + pure TS); the two models arrive in #3. Their field shape
  is fixed now (see Appendix) so Foundations doesn't box us in.
- **Sequencing: Foundations first.**
- **Caregiver view: replace bundled with atomic** per Assembly Rule 7 + Caregiver Execution
  Rules. Supersedes the earlier grouped-card design (`2026-09-04-high-frequency-routine-occurrences`).
- **Assistance: canonical + display map** — store the SLMS canonical assistance level (derived
  from AS score, nurse-adjustable); map to the facility's display labels (Observation /
  Supervision / Min. Assistance / Fully Dependent) in the caregiver view.
- **Responsible role: enum + facility abbreviations** — canonical role (Caregiver / Nurse /
  Other-authorized); display CGs / NOD. Medication + clinical-order events default to Nurse.

## Reuse map (extend, don't duplicate)

| Concern | Already exists | Foundations action |
|---|---|---|
| 14 AS domains, 0–4 anchors, goal defaults | `data/assessment_domains.json` (45KB, `code/name/anchors/goalDefaults/scope/owner`) | **Reuse as-is.** No new domain table. |
| AS Care Delivery Map (goal/tasks/oversight/freq/escalation per domain×score) | partially in `assessment_domains.json` goalDefaults | **Add** `as_care_delivery_map.json` for the per-score caregiver/nurse tasks + escalation not already captured, keyed to existing domain codes. |
| Care-event taxonomy + payload rules | `data/care_event_master.json` (177KB, v3.x archetypes EV-001..), `careEvents.ts` `classifyOutcome` | **Reconcile.** New `result_schemas.json` is the caregiver **completion gate** (16 types from the (2) workbook); it cross-references, does not replace, `care_event_master.json`. |
| Flat outcome enum (conflates outcome+exception+finding) | `careEvents.ts` `OUTCOMES` = `Completed / Not Required / Refused / Unable / Unsafe / Increased Assist / Frequency Variance / Clinical Change` | **Separate** into 5 controlled-vocab fields (`vocab.ts`); provide `fromLegacyOutcome()` bridge. `classifyOutcome` stays until #5 migrates it. |
| Condition modifiers | `data/clinical_modifiers.json` (coarse, `affectedDomains/taskPlanEffect/escalationLink/priority`) | **Supersede/augment** with `condition_pathways.json` (20 pathways w/ actionType + activation guards); note the mapping to legacy modifier IDs. |
| Generic 16-window routine template | `data/routine_windows.json`, `carePlanRoutine.ts` | Not LOC-specific. **Add** `loc_bundles.json` (61 LOC-scoped bundle events). Windows stay for placement in #2/#4. |
| High-frequency occurrence expansion | `highFrequency.ts` (fixed_interval/while_awake/times_per_shift) | Reused in #2; Foundations only adds the missing **frequency-method vocabulary** (exact-time, defined-window, completion-based, day-of-week, every-other-day, PRN/trigger, temporary). |
| Assistance vocabulary | none (only `carePackage.ts` INDEPENDENT→num) | **New** `assistance.ts`. |

## Design — five units

All new files live under `apps/frontend/src/lib/lifecare/` (TS) and
`apps/frontend/src/lib/lifecare/data/` (JSON), matching the existing rule-table pattern. Each TS
module ships an assert-based `demo()` self-check (Ponytail: one runnable check per non-trivial
module) and is a pure function with no `Date.now()`/random/IO.

### A. Controlled Vocabulary — `lib/lifecare/vocab.ts`

Six **separate** typed enums, verbatim from the Controlled Vocabulary sheet. Never interchanged
(Rule 12 + sheet mandate "each is stored separately").

```ts
export const WORKFLOW_STATE   = ["Upcoming","Due","Overdue","Closed","Cancelled"] as const;
export const CARE_OUTCOME     = ["Completed as planned","Completed with variance","Not completed"] as const;
export const EXCEPTION_REASON = ["Resident declined","Resident unavailable","Unsafe to perform","Clinical hold","Missed","Authorized cancellation"] as const;
export const CLINICAL_FINDING = ["Change from baseline","Increased assistance","Poor intake","Swallowing concern","Frequency variance"] as const;
export const ESCALATION_STATE = ["Not required","Pending acknowledgement","Acknowledged","Resolved"] as const;
export const PRIORITY         = ["P1","P2","P3","P4"] as const;
// + exported types, and:
export function countsAsCompleted(o: CareOutcome): boolean; // "Not completed" → false
export function fromLegacyOutcome(o: LegacyOutcome): { outcome: CareOutcome; exception?: ExceptionReason; finding?: ClinicalFinding };
```

`fromLegacyOutcome` maps the existing flat `careEvents.ts` OUTCOMES onto the separated fields
(e.g. `Refused → {outcome:"Not completed", exception:"Resident declined"}`; `Increased Assist →
{outcome:"Completed with variance", finding:"Increased assistance"}`; `Frequency Variance →
{outcome:"Completed with variance", finding:"Frequency variance"}`). This is the single source
every later phase validates against.

### B. LOC Standard Routine Bundles — `data/loc_bundles.json` + loader

The 61 bundle events (LOC 1–5), one object per Bundle Event ID, all 15 columns:

```jsonc
{
  "bundleEventId": "LOC4-RT-008",
  "finalLoc": "LOC 4",
  "category": "Repositioning",
  "careEvent": "Positioning support",
  "purpose": "Maintain comfort and pressure redistribution.",
  "defaultAssistancePattern": "Extensive assistance",
  "frequencyMethod": "Recurring fixed interval",
  "defaultTimeShift": "Per approved plan",
  "requiredResult": "Position; skin; tolerance; actual time",
  "completionControl": "Record & Complete",
  "orderRequired": false,
  "activationRule": "Activate only when assessed/ordered; interval must be individualized.",
  "asDomains": ["AS-02","AS-11"],
  "criticality": "High",
  "resultSchemaKey": "Repositioning"   // FK into result_schemas.json (unit D)
}
```

Loader `lib/lifecare/locBundles.ts` → `bundlesForLoc(loc)`. `resultSchemaKey` is added at
extraction time by mapping each bundle's category/careEvent to one of the 16 result schemas.

### C. Conditional Bundle Activation — `data/condition_pathways.json` + loader

The 20 cross-LOC pathways (MC-01→04 Memory, FALL, DYSPH, DM, HTN, CKD, FRAIL, NUTR, UI, CVA, PD,
HEAR, VISION, SKIN, ANX, SLEEP, PAIN):

```jsonc
{
  "bundleId": "DYSPH-01",
  "pathway": "Dysphagia / Aspiration Risk",
  "intensity": "Active",
  "crossLoc": true,
  "memoryPathway": false,
  "linkedDomains": ["AS-08","AS-06"],
  "actionType": "Replace",            // Modify | Add | Replace | Suppress
  "careEvent": "Meal assistance with swallow precautions",
  "caregiverInstruction": "Position, pace and provide only ordered texture/consistency; observe swallow signs.",
  "activationCriteria": "Current swallow assessment/order requires staff action.",
  "doesNotActivateFrom": "Diagnosis/history without a current diet/swallow plan.",
  "frequencyMethod": "Exact scheduled time",
  "orderRequired": true,
  "escalationTrigger": "Choking, respiratory distress or new/worsening swallow sign.",
  "priority": "P2",
  "reviewStopRule": "At order change, swallow reassessment or clinical change.",
  "legacyModifierIds": ["MOD-..."]    // cross-ref to clinical_modifiers.json where applicable
}
```

Memory pathways carry `crossLoc:true, memoryPathway:true` and an explicit **invariant flag** so
the engine (#2) can never equate them with LOC 4 (Rule 20). Loader
`lib/lifecare/conditionPathways.ts` → `pathwaysForConditions(activeConditions)` and
`memoryPathways()`.

### D. Care Event Result Fields — `data/result_schemas.json` + `lib/lifecare/resultSchema.ts`

The 16 event types (ADL/Personal Care, Toileting, Meal, Hydration, Mobility, Transfer,
Repositioning, Vital Signs, Blood Glucose, Medication, Behavior, Pain, Activity, Sleep/Safety
Round, Skin Check, General Observation):

```jsonc
{
  "eventType": "Hydration",
  "quickChartCategory": "Hydration",
  "requiredFields": ["amountOffered","amountConsumed","tolerance"],
  "optionalFields": ["fluidType"],
  "completionButton": "Record & Complete",
  "allowedExceptions": ["Resident declined","Resident unavailable","Unsafe to perform","Clinical hold"],
  "units": { "amountOffered": "mL", "amountConsumed": "mL" },
  "countsCompleteWhen": "Offer and intake amount recorded",
  "validation": ["consumed<=offered"]   // machine-checkable rules
}
```

`resultSchema.ts` exposes:

```ts
export function schemaFor(eventType: string): ResultSchema;
export function validateResult(eventType: string, payload: Record<string, unknown>):
  { ok: boolean; missing: string[]; invalid: string[] };
```

`validateResult` enforces required-field presence + machine rules (`consumed<=offered`;
Meal requires a unit when amount given; Medication requires a MAR result; Vitals requires all
ordered readings). This is the pure gate the completion button calls in #4. Medication and
Blood Glucose schemas carry `orderRequired:true` and route to MAR/order in #4.

### E. Assistance + Responsible Role — `lib/lifecare/assistance.ts`

**Canonical assistance scale** (source of truth, derived from AS score):

```ts
export const ASSISTANCE = ["Independent","Setup/Cueing","Minimal Assist","Extensive Assist","Total Assist"] as const;
export function assistanceForScore(score: 0|1|2|3|4): Assistance; // 0→Independent … 4→Total Assist
```

**Facility display map** (provisional — tune to SOP), so the caregiver view resembles the manual
form:

```ts
export const ASSISTANCE_DISPLAY: Record<Assistance,string> = {
  "Independent":     "Observation",
  "Setup/Cueing":    "Supervision",
  "Minimal Assist":  "Min. Assistance",
  "Extensive Assist":"Extensive Assist",   // no manual-form equivalent shown; keep canonical
  "Total Assist":    "Fully Dependent",
};
```

**Separate support fields.** The canonical `assistanceLevel` comes from the **AS score**
(`assistanceForScore`), *never* from parsing text — so "Two-Person Assist"/"Mechanical Lift"
can never end up as an assistance level (spec: they are staffing/equipment). `parseSupport`
extracts only the *support* fields from a bundle's free-text `defaultAssistancePattern`:

```ts
export interface SupportProfile {
  assistanceLevel: Assistance;   // set from score, passed in — canonical only
  supervision?: string;          // e.g. "Continuous during transfer"
  staffing?: string;             // e.g. "Two caregivers"
  equipment?: string;            // e.g. "Mechanical lift", "Walker"
  technique?: string;
  conditionModifier?: string;    // e.g. "Fall precautions"
}
// level from score; support parsed from the pattern string:
export function parseSupport(pattern: string, score: 0|1|2|3|4): SupportProfile;
```

`parseSupport` sets `assistanceLevel = assistanceForScore(score)`, then recognises
"two-person"/"2-person"/"mechanical"/"walker"/"contact guard"/"standby" in `pattern` and routes
them to `staffing`/`equipment`/`supervision`. It is provisional and covers the vocabulary
observed in the LOC bundles + Caregiver Execution examples; unrecognised phrases fall through to
`technique` with a `ponytail:` note. The nurse can override `assistanceLevel` per event in #3
(the original score-derived value is retained for audit).

**Responsible role:**

```ts
export const ROLE = ["Caregiver","Nurse","Other authorized"] as const;
export const ROLE_ABBR: Record<Role,string> = { "Caregiver":"CGs", "Nurse":"NOD", "Other authorized":"OTH" };
export function defaultRole(eventCategory: string, orderRequired: boolean): Role; // med/clinical-order/glucose → Nurse
```

### Supplementary table — `data/as_care_delivery_map.json`

The AS Care Delivery Map (per domain × score 0–4): caregiver tasks, nurse oversight, suggested
frequency/trigger, care-event type, escalation trigger, activation rule — keyed to existing
`assessment_domains.json` codes. Not a code module; a data table consumed by the Assembly engine
(#2, Rule 2 "apply active AS domains") to refine LOC bundle events with domain-specific tasks.
Loaded via a thin `careDeliveryMap(domainCode, score)` helper. This is the 4th JSON table.

## Data-generation approach

`loc_bundles.json`, `condition_pathways.json`, `as_care_delivery_map.json`, and
`result_schemas.json` are generated **from `(2).xlsx`** by a one-off extraction script
(`scripts/extract_slms_v42.py`, committed for reproducibility) so they are faithful to the
workbook. The committed artifacts are the **JSON files**; the app has no runtime dependency on
the script or on openpyxl. Regenerate + re-commit when the workbook version changes; a
`sourceWorkbookVersion` field in each JSON records provenance.

## Out of scope (this sub-project)

- The `assembleRoutine()` algorithm (Rules 1–21) — #2.
- Any Prisma model, migration, or DB write — #3.
- Any UI / board / caregiver view — #4.
- Escalation runtime, handover, rollover, correction — #5.
- Editing the live `carePlanRoutine.ts` / `TodaysCareBoard.tsx` behavior — later phases wire
  Foundations in; Foundations only adds consumable modules.

## Testing

Each module's `demo()` asserts against workbook facts:

- `vocab.ts`: every `EXCEPTION_REASON` → `countsAsCompleted` semantics hold; `fromLegacyOutcome`
  covers all 8 legacy outcomes; the 5 field sets are disjoint.
- `locBundles.ts`: `bundlesForLoc("LOC 4")` returns 16 events; every bundle's `resultSchemaKey`
  resolves in `result_schemas.json`; every `asDomains` code exists in `assessment_domains.json`.
- `conditionPathways.ts`: 20 pathways load; all 4 Memory pathways are `crossLoc && memoryPathway`
  and none imply an LOC; every `actionType` ∈ {Modify,Add,Replace,Suppress}.
- `resultSchema.ts`: `validateResult("Hydration",{amountOffered:100,amountConsumed:200})` fails
  (`consumed<=offered`); Medication with no MAR result fails; a complete Vitals payload passes.
- `assistance.ts`: `assistanceForScore(4)==="Total Assist"`; `parseSupport("Two-person/mechanical
  if approved")` yields `assistanceLevel:"Extensive/Total"` with `staffing:"two-person"` +
  `equipment:"mechanical"` and **no** two-person text in `assistanceLevel`; `defaultRole` sends
  medication to Nurse.

A single `tests/lifecare-foundations.test.ts` runs each `demo()` and adds cross-file integrity
checks (every bundle/pathway domain code exists; every `resultSchemaKey`/`allowedExceptions`
value is canonical vocab).

## Risks / provisional values

- **Assistance display map + `parseSupport` heuristics are provisional** — grounded in the
  workbook/manual-form wording but need SOP sign-off. Kept in one file for easy tuning.
- **`resultSchemaKey` mapping** (bundle category → 1 of 16 schemas) is assigned at extraction;
  a few ambiguous categories (e.g. "Cognition / Behavior") map to Behavior — flag for review.
- **Reconciliation with `care_event_master.json`**: the two must not drift. The integrity test
  asserts every `result_schemas.json` eventType has a corresponding archetype/coverage note; if
  the older master conflicts, the (2) workbook wins for the caregiver completion gate.

## Acceptance criteria (Foundations done when)

1. Five modules + four JSON tables exist, generated from `(2).xlsx`, provenance-stamped.
2. `assessment_domains.json` is reused (no duplicate domain table).
3. Controlled Vocabulary is 6 disjoint enums; `fromLegacyOutcome` bridges all legacy outcomes.
4. `validateResult` gates all 16 event types with required-field + machine rules.
5. Assistance is canonical + display-mapped; staffing/equipment/supervision are separate fields;
   LOC is never used as an assistance value.
6. Memory pathways are structurally decoupled from LOC.
7. `tests/lifecare-foundations.test.ts` passes (per-module `demo()` + cross-file integrity).
8. Zero UI, zero schema change, zero edits to live routine generation behavior.

## Appendix — Prisma model shape (fixed now, built in #3)

Not created in Foundations; recorded so downstream stays consistent.

**RoutineEventDefinition** (versioned, per resident): `id, residentId, version, status
(DRAFT|APPROVED|RETURNED|EXPIRED|CANCELLED), sourceLocBundleId, sourceAsDomain, asScore, goalId,
sourceTaskId, conditionBundleId, memoryPathwayId, orderRef, name, instructions, assistanceLevel,
supervision, staffing, equipment, technique, conditionModifier, responsibleRole, frequencyMethod,
schedule(json), shiftOwner, criticality, resultSchemaKey, exceptionSet(json), escalationTrigger,
escalationPriority, effectiveDate, reviewDate, stopDate, approvedBy, approvedAt,
originalRecommendation(json), createdAt, updatedAt`.

**RoutineOccurrence** (per care day, per definition): `id, definitionId, definitionVersion,
residentId, careDate, scheduledTime, actualTime, assignedStaffId, workflowState,
careDeliveryOutcome, results(json), exceptionReason, clinicalFinding(json), escalationState,
escalationId, completionUserId, completionAt, corrections(json append-only), createdAt`.
