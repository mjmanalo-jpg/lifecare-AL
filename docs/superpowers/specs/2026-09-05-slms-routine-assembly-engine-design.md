# SLMS v4.2 Routine — Sub-project #2: Assembly Engine — Design

**Date:** 2026-09-05
**Status:** Draft design → awaiting user review
**Governing spec:** `SLMS_v4.2_AS_Goals_Tasks_24-Hour_Routine (2).xlsx` (authoritative) — sheet
**Routine Assembly Rules** (the ordered algorithm, steps 1–21), plus LOC Standard Routine Bundles,
Conditional Bundle Activation, Caregiver Execution Rules, Care Event Result Fields, Controlled Vocabulary.
**Consumes:** Sub-project #1 Foundations
(`docs/superpowers/specs/2026-09-05-slms-routine-foundations-design.md`) — all rule tables + pure helpers.

## Program context (this sub-project's role)

Foundations shipped the typed rule tables + pure helpers. This sub-project is the **one pure function**
that consumes them:

```
assembleRoutine(input) → RoutineEventDefinition[]   // all DRAFT, in-memory
```

It implements **Routine Assembly Rules steps 1–13 + step 20** (the Memory-Care invariant), producing
draft event definitions with full provenance. Steps **14–19 & 21** (nurse approval, occurrence
persistence, no-silent-rollover, versioning, stop/review, release validation) belong to **#3
(Persistence + Nurse approval)** and **#5 (Exceptions/escalation/handover/audit)** — this engine does
**not** persist, approve, or generate `RoutineOccurrence` rows. The workbook precedence for conflicts is
enforced here: **current order → resident-specific approved plan → active AS-domain rule → conditional
pathway → LOC baseline. The engine proposes; a nurse approves before activation.**

The engine is **pure**: no `Date.now()`, no random, no IO, no Prisma. It emits plain objects shaped like
`RoutineEventDefinition` (the model built in #3); the caller (#3) persists them.

## Decisions locked (relevant subset)

- **LOC drives the baseline; diagnosis never computes LOC** (Rule 1 / Rule 20). LOC and Memory pathway are
  **independent fields** end-to-end.
- **Atomic events** (Rule 7): one action + one required result + one completion decision. Replaces bundled
  Today's Care. Never combine actions with different times/results/escalation.
- **Assistance = canonical SLMS level (from AS score) + facility display map.** Two-person / mechanical are
  **staffing/equipment**, never an assistance level (`assistance.ts` from Foundations).
- **Responsible role enum** (Caregiver=CGs / Nurse=NOD / Other=OTH); med/clinical-order/glucose → Nurse.
- **Timezone Asia/Manila.** Frequency methods normalize to a schedule shape; occurrences are **computed**
  (Rule 10) but not persisted here.
- **Provenance + `originalRecommendation`**: every draft retains domain/score/goalId/taskId/bundleId/
  pathwayId/orderRef, and the pre-override AS-derived values are snapshotted in `originalRecommendation`
  for the nurse-override audit (#3, Rule 9).

## Reuse map (extend, don't duplicate)

| Concern | Already exists (Foundations / repo) | Assembly action |
|---|---|---|
| LOC baseline events | `data/loc_bundles.json` + `locBundles.ts` `bundlesForLoc(loc)` | **Reuse.** Rule 1 loads one LOC's 6–16 bundle events as the draft baseline. |
| AS domain refinement | `data/as_care_delivery_map.json` + `careDeliveryMap(domain,score)` | **Reuse.** Rule 2 refines/adds/downgrades/suppresses per domain×score. |
| Memory + conditional pathways | `data/condition_pathways.json` + `conditionPathways.ts` `pathwaysForConditions()` / `memoryPathways()` | **Reuse.** Rules 3 (memory, independent) & 4 (other pathways, actionType). |
| Assistance + role | `assistance.ts` `assistanceForScore` / `parseSupport` / `ASSISTANCE_DISPLAY` / `defaultRole` / `ROLE_ABBR` | **Reuse.** Rules 2, 9. Level from score only; staffing/equipment separate. |
| Result schema + exceptions | `data/result_schemas.json` + `resultSchema.ts` `schemaFor` / `validateResult` | **Reuse.** Rule 12 attaches `resultSchemaKey` + `exceptionSet`. |
| Controlled vocab | `vocab.ts` (WORKFLOW_STATE, CARE_OUTCOME, EXCEPTION_REASON, CLINICAL_FINDING, ESCALATION_STATE, PRIORITY) | **Reuse.** Rules 12, 13 keep the 5 fields separate. |
| Occurrence expansion | `highFrequency.ts` `expandOccurrences` (3 methods: `fixed_interval`, `while_awake`, `times_per_shift`) | **Extend** to the full workbook frequency set (see Unit J). `carePlanRoutine.ts` `shiftForMinutes`/`hm` reused. |
| 24h windows / placement | `data/routine_windows.json` + `carePlanRoutine.ts` (`generateRoutine`, `windowForMinutes`, `RoutineShift`) | **Reuse for placement.** `generateRoutine` itself is the *old bundled* generator — Assembly does **not** call it; it borrows its window helpers + shift model. |
| Order data | Prisma `Medication` + `MedicationAdministration` (MAR), `DietOrder` | **Reuse** as the order input for Rule 5; **TAR / fluid-restriction / therapy have no structured model** — thin adapter (see Unit E). |

Everything except Unit J (frequency extension) and the engine orchestrator is **wiring existing helpers**;
Ponytail: no new rule tables, no new vocab.

## Design

New file: `apps/frontend/src/lib/lifecare/assembleRoutine.ts` (pure, one `demo()` self-check).
Frequency extension edits the existing `apps/frontend/src/lib/lifecare/highFrequency.ts`.
Each rule below is a design **unit** citing the workbook's per-step "Acceptance Test".

### Input / output shapes

```ts
// All plain data — the caller (a #3 server route) gathers these from Prisma + assessment JSON.
export interface AssembleInput {
  residentId: string;
  finalLoc: "LOC 1"|"LOC 2"|"LOC 3"|"LOC 4"|"LOC 5"; // nurse-confirmed; NEVER derived here
  assessmentVersion: string;                          // provenance (Rule 1)
  approvedBy?: string;                                // Final-LOC approver (Rule 1 audit)
  domains: DomainInput[];                             // 14 AS domains, active-need flags, scores, goals
  activeConditions: string[];                         // pathway bundleIds whose activation criteria are met
  memoryIntensity?: "Supportive"|"Structured"|"Enhanced"|"Intensive"; // chosen pathway, independent of LOC
  orders: OrderInput;                                 // current orders (Rule 5) — see Unit E
  preferences?: PreferenceInput;                      // Rule 6
  effectiveDate: string;                              // ISO; goes onto every definition (approval sets real one in #3)
}

export interface DomainInput {
  code: string;              // AS-01..AS-14
  name: string;
  score: 0|1|2|3|4;
  activeNeed: boolean;       // Rule 2: a score with no staff-action need generates nothing
  goalId?: string;
  taskId?: string;
}

// assembleRoutine returns DRAFT RoutineEventDefinition[] (see Foundations Appendix for the full shape).
export function assembleRoutine(input: AssembleInput): RoutineEventDefinition[];
```

Internally the engine works on a mutable **draft-event accumulator** (a superset of
`RoutineEventDefinition` with a `_provenance` scratch), then freezes each to a `status:"DRAFT"`
definition at the end. Determinism: events are sorted by `(sourceLocBundleId ?? conditionBundleId, name)`
before return so the same input always yields the same array order.

---

### Unit A — Rule 1: Select Final LOC → baseline

**Input:** `finalLoc`. **Logic:** `bundlesForLoc(finalLoc)` → one LOC's bundle events become the draft
baseline; each becomes a draft `RoutineEventDefinition` with `sourceLocBundleId`, `name`, `instructions`,
`criticality`, `resultSchemaKey`, `frequencyMethod` copied from the bundle. Final LOC value +
`assessmentVersion` + `approvedBy` stored on every draft (`originalRecommendation.finalLoc`).
**Conflict rule:** never compute LOC from diagnosis/memory setting.
**Acceptance Test (workbook):** *"Changing diagnosis alone does not change selected LOC."* — engine ignores
`activeConditions`/`memoryIntensity` when choosing the baseline; only `finalLoc` selects it.

### Unit B — Rule 2: Apply active AS domains

**Input:** `domains`. **Logic:** for each domain with `activeNeed === true`, `careDeliveryMap(code, score)`
returns the per-score caregiver task/oversight/frequency/escalation. This **refines** a matching baseline
event (same domain in `asDomains`), or **adds** a new draft event if the domain has a staff-action need not
covered by baseline, or **downgrades/suppresses** a baseline event when the score implies less action.
Provenance retained: `sourceAsDomain`, `asScore`, `goalId`, `sourceTaskId`. Assistance level set via
`assistanceForScore(score)` (canonical only) + `parseSupport` for staffing/equipment/technique.
**Conflict rule:** an active resident-specific AS rule overrides the generic LOC template.
**Acceptance Test:** *"A score with no staff-action need generates no event."* — `activeNeed === false`
(or a score whose map entry has no task) contributes nothing; a baseline event whose only justification was
that domain is suppressed.

### Unit C — Rule 3: Apply Memory pathway (independent of LOC)

**Input:** `memoryIntensity` + relevant active domains (AS-04/05/07/12/13, and AS-03/09 when relevant).
**Logic:** `memoryPathways()` filters the 4 MC-* pathways (`memoryPathway:true, crossLoc:true`); the chosen
intensity's `actionType` (Modify/Add) applies to cognition/behavior events. Stored on the draft in the
**separate** `memoryPathwayId` field — **never** written to `sourceLocBundleId` or any LOC field.
**Conflict rule:** pathway intensity never maps to or overwrites LOC.
**Acceptance Test:** *"The same Memory pathway can be used at different LOCs when justified."* — see Unit N
(Rule 20) demo: applying `Enhanced` memory at LOC 2 and LOC 4 both succeed with identical `memoryPathwayId`
and unchanged `finalLoc`.

### Unit D — Rule 4: Apply other conditional bundles

**Input:** `activeConditions` (bundleIds already confirmed active by the caller). **Logic:**
`pathwaysForConditions(activeConditions)` returns non-memory pathways; apply `actionType`:
- **Modify** — patch the matching baseline/AS event's instruction, precautions, frequency.
- **Add** — new draft event only when materially distinct (dedup handled in Unit H).
- **Replace** — swap the base event's care action (e.g. DYSPH-01 replaces plain meal support).
- **Suppress** — remove a draft event.

Guard: the pathway JSON carries `doesNotActivateFrom`; the caller must have honored activation criteria, but
the engine additionally refuses to apply any pathway **not** present in `activeConditions` even if a linked
domain is scored — diagnosis/history alone is insufficient. Store `conditionBundleId` + activation evidence
(passed through in `originalRecommendation`).
**Conflict rule:** diagnosis/history alone is insufficient.
**Acceptance Test:** *"Inactive historic conditions produce no tasks."* — a condition whose bundleId is
**not** in `activeConditions` yields no event even when its `linkedDomains` are scored.

### Unit E — Rule 5: Apply current orders (order-input interface — investigated honestly)

**Input:** `OrderInput`. **What structured order data actually exists in the repo** (verified against
`prisma/schema.prisma`):

| Order type | Structured source | Status |
|---|---|---|
| Medication (MAR) | `Medication` (name, dosage, frequency, route, startDate/endDate, status, prescribedBy) + `MedicationAdministration` (scheduledTime, status, actualTime) | **Real & structured.** Feed directly. |
| Diet / texture | `DietOrder` (dietType, restrictions, mealType, active, orderedBy) | **Real & structured.** Feed directly. |
| Thickened fluid / fluid restriction | none (only free-text `DailyRounds.textureDiet` / `DietOrder.restrictions`) | **No dedicated model** — thin adapter (below). |
| TAR (treatment administration) | none | **No model** — free-text `orderRef` for now. |
| Therapy order (PT/OT day-of-week) | none structured (referrals/appointments only) | **No model** — caller passes a typed `TherapyOrderRef`. |

So the **honest interface** is: pass what is structured as typed refs, and everything unmodeled as a typed
free-text `orderRef` with effective dates + authorizing role. No new Prisma models are invented here (that
is a #3 decision if the client wants TAR/therapy structured).

```ts
export interface OrderInput {
  medications: { id:string; name:string; dosage:string; frequency:string; route:string;
                 scheduledTimes?:string[]; startDate:string; endDate?:string; prescribedBy?:string }[]; // from Medication/MAR
  diet?: { id:string; dietType:string; restrictions?:string; texture?:string; mealType:string;
           orderedBy?:string; startDate:string; endDate?:string };                                       // from DietOrder
  // Unmodeled orders: exact ordered parameter as free text, with authority + effective dates.
  freeText?: { orderRef:string; kind:"TAR"|"fluid"|"therapy"|"monitoring"; parameter:string;
               authorizedRole:"Nurse"|"Other authorized"; startDate:string; endDate?:string;
               daysOfWeek?:("Mon"|"Tue"|"Wed"|"Thu"|"Fri"|"Sat"|"Sun")[] }[]; // e.g. Physiotherapy Mon/Wed/Fri
}
```

**Logic:** insert **exact** ordered parameters, effective dates, and authorized role onto the matching event
(`orderRef`, `effectiveDate`, `responsibleRole`). Medication/monitoring/treatment/restriction/technique
events **cannot exist without a matching order** — an `orderRequired` event with no order is marked
`status:"BLOCKED"` (a draft flag, resolved by nurse in #3/Rule 11) rather than emitted as approvable.
**Conflict rule:** current order prevails over template wording; **contradictions block activation** (e.g.
a bundle says "regular diet" but `DietOrder` says pureed → block, do not silently pick one).
**Acceptance Test:** *"No medication, monitoring, treatment, restriction or technique task exists without
required order."* — every `orderRequired` bundle/pathway event with no matching order in `OrderInput` is
blocked, not approvable.

### Unit F — Rule 6: Apply preferences & goals

**Input:** `PreferenceInput` (preferred wake/meal/activity times, approach, choices). **Logic:** personalize
**nonclinical** timing/approach/wording on the event (adjust `schedule` window, prepend preference to
`instructions`). **Conflict rule:** preference may change nonclinical defaults but **cannot contradict** an
active order or safety plan (a preference that would move a med time, loosen a texture, or drop a fall
precaution is ignored + noted).
**Acceptance Test:** *"Preferred wake/meal/activity approach appears in caregiver instruction."* — a
`wakeTime:"07:30"` shifts the morning-hygiene window and the preference text appears in `instructions`.

### Unit G — Rule 7: Create atomic events

**Logic:** split each accumulated intervention into **one action + one required result + one completion
decision**. A bundle event that combined (e.g.) hygiene + skin check at different results is split into two
draft definitions, each with exactly one `resultSchemaKey`, one `completionControl`, one `escalationTrigger`.
Every split row keeps all source references (`sourceLocBundleId`/`sourceAsDomain`/`goalId`/`sourceTaskId`/
`conditionBundleId`/`memoryPathwayId`).
**Conflict rule:** do not combine actions with different times, results, or escalation paths.
**Acceptance Test:** *"Every event has one Care Event, one Required Result and one Completion Control."* —
demo asserts no emitted definition has more than one `resultSchemaKey`.

### Unit H — Rule 8: Resolve overlaps / dedup

**Logic:** compare draft events on `(residentId, category, time/window, action, requiredResult)`. **Modify /
Replace** update the baseline in place; **Add** creates a row only when **materially distinct**; **Suppress**
removes. The canonical merge: a meal event (LOC baseline / AS-08) + a dysphagia `Replace` pathway (DYSPH-01)
→ **one** meal event carrying the ordered swallow precautions, not two rows. Record merge/suppression reason
+ source IDs in `originalRecommendation._merges`.
**Conflict rule:** Modify/Replace update baseline; Add only when materially distinct; Suppress removes.
**Acceptance Test:** *"Meal support plus dysphagia produces one meal event with ordered precautions, not
duplicates."*

### Unit I — Rule 9: Resolve assistance conflicts

**Logic:** when two sources recommend different assistance for the same event, propose the **safest assessed
approved** level but **never silently raise/lower** — record `originalRecommendation.assistance =
{prior, recommended}`; the `final` is left for nurse approval (#3). A **1-person vs 2-person staffing**
conflict is not an assistance-level disagreement (levels come from score only) — it is a **staffing**
conflict that **blocks activation** (`status:"BLOCKED"`) until the nurse resolves it.
**Conflict rule:** never silently raise/lower assistance; nurse approval required.
**Acceptance Test:** *"Conflicting one-person/two-person methods block activation until resolved."*

### Unit J — Rule 10: Resolve timing/frequency + compute occurrences  ⟶ extends `highFrequency.ts`

**This is the one net-new build.** Normalize every event to a canonical **frequency method + window/trigger**
and compute its occurrences (Asia/Manila). `highFrequency.ts` today has **3** methods; the workbook needs the
**full set**. Extend `HFMethod` and `expandOccurrences` (keep the existing 3 unchanged):

| Frequency method | Source | Schedule shape (`schedule` json) | Occurrences |
|---|---|---|---|
| `exact_time` | bundle "Exact scheduled time" | `{ times:["08:00","12:00"] }` | one per listed time |
| `defined_window` | "Defined time window" | `{ window:"06:30-06:45" }` | one, at window start (window carried for the card) |
| `fixed_interval` *(exists)* | "Recurring fixed interval" | `{ intervalHours:2 }` | every N h across 24h |
| `completion_based` | "Completion-based interval" | `{ intervalHours:4, fromCompletion:true }` | **deferred to runtime** — emit the rule only (next occ generated on completion in #3/#4); Assembly emits the seed occurrence + method |
| `times_per_shift` *(exists)* | "Times per shift" | `{ perShift:3 }` | n interior points per shift |
| `while_awake` *(exists)* | "While awake" | `{ intervalHours:2, wakeStart:6, wakeEnd:22 }` | across wake window |
| `trigger_prn` | "Trigger-based / PRN" | `{ trigger:"on transfer" }` | **0 scheduled** — created on trigger (#4) |
| `temporary` | "Temporary frequency" | `{ ...baseMethod, stopDate:"..." }` | as base method, bounded by `stopDate` |
| `day_of_week` **(new — client form/brief)** | "Physiotherapy Mon/Wed/Fri" | `{ days:["Mon","Wed","Fri"], times:["10:00"] }` | one per matching weekday |
| `every_other_day` **(new — client form/brief)** | manual form | `{ everyOtherDayFrom:"2026-09-05", times:["09:00"] }` | on days where `(careDate−anchor) % 2 === 0` |

`day_of_week` / `every_other_day` need the **care date** to decide if today is a match — Foundations' pure
`expandOccurrences(cfg)` is date-free by design. So Assembly adds a **date-aware** sibling that returns the
*rule* on the definition (`frequencyMethod` + `schedule`), and the **per-day occurrence computation** is a
new pure helper `occurrencesForDate(schedule, careDateISO, tz="Asia/Manila")` that #3 calls when generating a
day's occurrences (Rule 15). Assembly itself calls it only inside `demo()` to prove the math.

```ts
// highFrequency.ts — extended union + config
export type HFMethod =
  | "exact_time" | "defined_window" | "fixed_interval" | "completion_based"
  | "times_per_shift" | "while_awake" | "trigger_prn" | "temporary"
  | "day_of_week" | "every_other_day";

// New date-aware computation (pure; used by #3 Rule 15 and by demo here).
export interface DaySchedule { /* the shape column above, discriminated by method */ }
export function occurrencesForDate(
  method: HFMethod, schedule: DaySchedule, careDateISO: string
): HFOccurrence[]; // [] when today isn't a match (day_of_week/every_other_day/trigger_prn)
```

`careDateISO` is interpreted in Asia/Manila (matches `routineCompletions.ts` careDay), keeping occId
`${definitionId}@${careDateISO}@${HHMM}` stable and TZ-consistent.
**Conflict rule:** current order + approved plan prevail; **do not average conflicting frequencies**.
**Acceptance Test:** *"Six-times-while-awake generates six distinct occurrences, not a vague note."* — demo
asserts a `while_awake` config tuned to 6 offers yields exactly 6 distinct `HHMM` occurrences; plus new
demos: `day_of_week` Mon/Wed/Fri yields an occurrence on Wed but none on Tue; `every_other_day` from an
anchor yields on the anchor and skips the next day.

### Unit K — Rule 11: Validate clinical scope

**Logic:** for each event, confirm (a) a current order exists when `orderRequired`, (b) the resident-specific
clinical threshold/parameter is present when the event escalates on a value, and (c) the `responsibleRole` is
authorized for the action (`defaultRole` routes med/glucose/monitoring → Nurse; a caregiver-only event
requiring a nurse action is blocked). Unmet → `status:"BLOCKED"` with an auditable `blockReason`; the block
surfaces to nurse/admin in #3. (Competency check against a staff-competency store is **out of scope** —
the engine records the *requirement*; runtime competency gating is #4/#5.)
**Conflict rule:** unmet requirement blocks event and alerts nurse/administrator.
**Acceptance Test:** *"Clinical event cannot activate when order or authorized role is missing."*

### Unit L — Rule 12: Assign results + exception set

**Logic:** attach `resultSchemaKey` (already on the bundle/derived from category) and pull
`allowedExceptions` from `schemaFor(eventType)` into `exceptionSet` (json). Keep the **5 controlled-vocab
fields separate** — `workflowState`, `careDeliveryOutcome`, `exceptionReason`, `clinicalFinding`,
`escalationState` are distinct columns on `RoutineOccurrence`; the definition only carries the *allowed*
`exceptionSet` + `resultSchemaKey`. Uses `vocab.ts` values only.
**Conflict rule:** workflow state, outcome, exception, finding, escalation remain separate fields.
**Acceptance Test:** *"Resident declined cannot count as completed."* — demo asserts
`countsAsCompleted` is false for every value in an event's `exceptionSet`, and that `exceptionSet ⊆
EXCEPTION_REASON`.

### Unit M — Rule 13: Assign escalation logic

**Logic:** attach **one** `escalationPriority` (P1–P4 from the pathway/bundle) and an explicit
`escalationTrigger` (trigger/action/recipient). A **resident-specific** threshold in `OrderInput.freeText`
(e.g. "BP > 160") **overrides** the generic bundle example. A clinical-value event with **no threshold**
present is blocked (Rule 11 overlap). Escalation is a **separate** field — it never rewrites the completion
outcome.
**Conflict rule:** resident-specific parameter overrides generic example; missing clinical threshold blocks.
**Acceptance Test:** *"Out-of-parameter result creates an escalation without rewriting completion outcome."*
— asserted at the field level: `escalationTrigger` set, `careDeliveryOutcome` untouched by escalation.

### Unit N — Rule 20: Memory-Care invariant

**Logic:** `finalLoc`/`sourceLocBundleId` and `memoryPathwayId` are **distinct fields** on every draft and
are never cross-assigned. A regression assert: no code path writes a memory value into an LOC field or infers
LOC from a memory pathway.
**Conflict rule:** no code or label may equate Memory Care with LOC 4.
**Acceptance Test:** *"A resident at LOC 2 can have enhanced Memory support; LOC 4 can have no Memory
pathway."* — demo builds (LOC 2 + `Enhanced` memory) and (LOC 4 + no memory) and asserts both are valid and
their LOC/memory fields are independent.

---

### Output contract

`assembleRoutine` returns `RoutineEventDefinition[]`, every element `status:"DRAFT"` (or `"BLOCKED"` for
Rule 5/9/11/13 blocks), with:
- full provenance (`sourceLocBundleId, sourceAsDomain, asScore, goalId, sourceTaskId, conditionBundleId,
  memoryPathwayId, orderRef`);
- `originalRecommendation` (json) = the pre-override AS-derived snapshot (assistance prior/recommended, merge
  reasons, block reasons) for the nurse-override audit trail in #3;
- exactly one `resultSchemaKey`, one `completionControl`, one `escalationPriority` per event;
- a normalized `frequencyMethod` + `schedule` (json) computable by `occurrencesForDate` in #3.

## Out of scope (YAGNI — belongs to #3/#5)

- **Rule 14** nurse review/approval board, **Rule 15** occurrence generation + persistence, **Rule 16**
  dashboard completion control, **Rule 17** no-silent-rollover, **Rule 18** versioning/reassessment, **Rule
  19** stop/review expiry, **Rule 21** release validation — all #3/#5.
- Writing any Prisma row (engine returns in-memory objects only).
- New Prisma models for TAR / therapy / fluid restriction — flagged for #3 if the client wants them
  structured; Assembly uses `OrderInput.freeText` today.
- Runtime competency-store gating, trigger/PRN firing, completion-based next-occurrence generation — #4/#5.
- Any UI / caregiver view — #4.
- Editing live `carePlanRoutine.ts generateRoutine` / `TodaysCareBoard` behavior — the old bundled generator
  stays until #4 replaces it; Assembly borrows only its window/shift helpers.

## Testing

One assert-based `demo()` in `assembleRoutine.ts` + the `highFrequency.ts` `demo()` extension, run by
`tests/lifecare-assembly.test.ts`. The acceptance tests are **exactly** the workbook "Acceptance Test"
column for steps 1–13 & 20:

1. **Rule 1** — changing `activeConditions`/diagnosis alone does not change the selected LOC baseline.
2. **Rule 2** — a domain with `activeNeed:false` (or a no-task map entry) generates no event.
3. **Rule 3 / 20** — the same Memory pathway (`Enhanced`) applies at LOC 2 and LOC 4 with identical
   `memoryPathwayId` and unchanged `finalLoc`.
4. **Rule 4** — a condition not in `activeConditions` produces no task even when its linked domains are scored.
5. **Rule 5** — every `orderRequired` event with no matching order in `OrderInput` is `BLOCKED`; a diet
   contradiction (bundle "regular" vs `DietOrder` "pureed") blocks.
6. **Rule 6** — a `wakeTime` preference shifts the morning window and appears in `instructions`; a preference
   contradicting an order/safety plan is ignored.
7. **Rule 7** — no emitted definition carries more than one `resultSchemaKey`/`completionControl`.
8. **Rule 8** — meal support + DYSPH-01 yields exactly **one** meal event with swallow precautions.
9. **Rule 9** — conflicting 1-person/2-person staffing yields a `BLOCKED` event; assistance prior/recommended
   captured in `originalRecommendation`.
10. **Rule 10** — six-while-awake → 6 distinct occurrences; `day_of_week` Mon/Wed/Fri present on Wed, absent
    on Tue; `every_other_day` present on anchor, absent next day; conflicting frequencies are not averaged.
11. **Rule 11** — a clinical event with missing order/role is `BLOCKED` with an auditable `blockReason`.
12. **Rule 12** — every event's `exceptionSet ⊆ EXCEPTION_REASON` and each fails `countsAsCompleted`; the 5
    vocab fields are distinct on the shape.
13. **Rule 13** — a resident-specific threshold in `freeText` overrides the generic escalation example; the
    escalation field is set without touching `careDeliveryOutcome`.
20. **Rule 20** — LOC and memory fields are independent for (LOC 2 + memory) and (LOC 4 + no memory).

Cross-file integrity (already partly in Foundations' test): every `resultSchemaKey` resolves; every
`asDomains`/`linkedDomains` code exists; every emitted vocab value is canonical.

## Risks / provisional

- **Order interface is honest but partial.** MAR + `DietOrder` are structured; **TAR, therapy day-of-week,
  and fluid restriction have no model** → carried as `OrderInput.freeText`. If the client wants these
  structured + validated (parameter ranges, prescriber), that is a #3 Prisma decision. Flagged, not guessed.
- **`careDeliveryMap` refine/downgrade/suppress semantics** (Rule 2) depend on the map's task granularity;
  ambiguous "downgrade" cases (score drops but a residual need remains) default to *modify, keep event* with
  a `ponytail:` note — tune to SOP.
- **`completion_based` and `trigger_prn`** emit a rule + seed only; actual next-occurrence generation is #3/#4
  runtime. Assembly cannot compute them purely (they need real completion/trigger events).
- **Merge heuristic (Rule 8)** keys on `(category, window, action, result)`; a genuinely-distinct event that
  happens to share those keys could be over-merged — the merge reason is audited so the nurse can split in #3.
- **Preference/order contradiction detection (Rule 6)** is conservative: it blocks preference changes to any
  event carrying an `orderRef` or a safety `conditionModifier`. May be stricter than SOP; adjustable.

## Acceptance criteria (Assembly done when)

1. `assembleRoutine(input)` is pure (no Date.now/random/IO/Prisma) and returns `RoutineEventDefinition[]`
   with `status ∈ {DRAFT, BLOCKED}`.
2. Rules 1–13 + 20 each implemented as a named step, in the workbook precedence order (order → plan → AS →
   pathway → LOC), with the per-rule conflict/dedup behavior.
3. LOC is chosen only from `finalLoc`; diagnosis/memory never computes it; LOC and `memoryPathwayId` stay
   independent (Rule 20).
4. `orderRequired` events without a matching order, staffing conflicts, and missing thresholds are `BLOCKED`,
   not silently emitted.
5. Atomic invariant holds — one action/result/completion per event; full provenance +
   `originalRecommendation` snapshot on every event.
6. `highFrequency.ts` extended to the full workbook frequency set incl. `day_of_week` + `every_other_day`,
   with a date-aware `occurrencesForDate` (Asia/Manila) that #3 consumes.
7. `tests/lifecare-assembly.test.ts` passes — the acceptance tests above are the workbook "Acceptance Test"
   entries for steps 1–13 & 20.
8. Zero persistence, zero UI, zero approval logic (those are #3/#5); the old bundled generator untouched.
