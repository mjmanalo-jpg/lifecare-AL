# SLMS v4.2 Routine — Sub-project #5: Exceptions · Escalation · Handover · Audit Lifecycle — Design

**Date:** 2026-09-05
**Status:** Draft design → awaiting user review
**Governing spec:** `SLMS_v4.2_AS_Goals_Tasks_24-Hour_Routine (2).xlsx` (authoritative).
**Primary sheets:** Controlled Vocabulary; Dashboard & Workflow Rules (Exception / Overdue /
Recurring / Auto-escalation / P1–P4 / Handover prep+acceptance / Care-plan revision /
Discontinuation / Correction / Document once / Controlled vocabulary); Routine Assembly Rules
steps 12, 13, 17, 18, 21. Original workbook Shift Rules (Exceptions, Handover, No silent
rollover, Escalation, P1–P4) + High-Frequency Tasks worked example.
**Depends on:** #1 Foundations (`vocab.ts`), #3 Persistence (`RoutineEventDefinition` +
`RoutineOccurrence` Prisma models), #4 Caregiver atomic execution (completion buttons + result
gate).

## Program context (why this sub-project exists)

Sub-projects #1–#4 produce approved, versioned event definitions and atomic caregiver
occurrences with a typed completion gate. What they deliberately leave open is **what happens
when an occurrence is not a clean completion**: it is declined, unsafe, late, missed, or it
surfaces a clinical finding; when a result breaches a parameter and must reach a nurse; when a
shift ends with unresolved items; when the plan is revised, discontinued, or a chart entry needs
correcting. This sub-project is the **lifecycle layer** that governs those paths so that:

- The five workflow/documentation state fields are stored and validated as **separate** columns
  and can never be interchanged (Controlled Vocabulary mandate; Assembly Rule 12).
- An exception **never** counts as completion and never inflates the completed count.
- A qualifying result/exception/finding creates a **linked** nurse-review event (P1–P4) that does
  **not** rewrite the completion outcome (Rule 13); the original occurrence is retained.
- No incomplete occurrence is ever silently rolled forward or marked complete (Rule 17).
- Handover transfers **accountability, not identity/timestamp**; the original miss/delay stays
  auditable.
- Plan revision, discontinuation, and correction all **preserve history** (Rules 18/19; Dashboard
  Correction/Discontinuation) — historical charting never changes.
- The whole configuration is **release-validated** before it can publish (Rule 21).

This is engine + persistence + a UI extension. No new Prisma model is introduced — the five state
fields, `corrections` json, and `definitionVersion` already live on `RoutineOccurrence` (#3), and
the escalation/notification records already exist. Handover **extends** `ShiftEndorsementBoard`.

## Decisions locked (brainstorming)

- **Five separate state fields, one validator.** `workflowState`, `careDeliveryOutcome`,
  `exceptionReason`, `clinicalFinding` (json), `escalationState` are written **only** through one
  helper (`applyOccurrenceState`) that validates each value against its own `vocab.ts` enum and
  rejects cross-field misuse (a `CLINICAL_FINDING` value can never land in outcome/exception).
- **Reuse `careEvents.ts`, not replace it.** The caregiver still posts to `/api/care-events`,
  which still runs `classifyOutcome` and creates the `Escalation` + `Notification` records. #5
  adds a thin bridge: the atomic occurrence's separated fields are **derived** from the legacy
  outcome via `fromLegacyOutcome` (Foundations), and the occurrence stores `escalationId` linking
  to the `Escalation` the route already creates. `classifyOutcome` stays as the escalation-matrix
  brain (CEG/DT mapping); #5 does not re-implement it.
- **Escalation lifecycle rides the existing `Escalation` model.** `escalationState` on the
  occurrence mirrors the linked `Escalation.status` (OPEN→ACK→RESOLVED) mapped onto the four
  canonical values. No parallel escalation store.
- **Handover extends `ShiftEndorsementBoard`.** It already has carry-over items, a handover
  snapshot (`buildHandover`/`acceptHandover`), a sign-off + acknowledgement flow, and a
  completion checklist. #5 feeds unresolved **occurrences** into the pending list and hardens the
  sign-off gate (cannot close with unaddressed critical items). No new handover board.
- **No silent rollover is a generation invariant, enforced by occId, not by state edits.**
  `occId=${definitionId}@${careDateISO}@${HHMM}` (locked). The next recurrence is a distinct
  occId generated independently by #3/#4; #5 never mutates a past occurrence's `scheduledTime`,
  never closes one as a side effect of another, and never re-parents it to a new shift.
- **Revision/discontinuation/correction are append-only and version-pinned.** Occurrences pin
  `definitionVersion`; historical occurrences are frozen; corrections append to `corrections`
  json and never overwrite the original result.

## Reuse map (extend, don't duplicate)

| Concern | Already exists | #5 action |
|---|---|---|
| Legacy flat outcome + escalation matrix | `careEvents.ts` `OUTCOMES`, `classifyOutcome` (CEG-01..07, DT-xxx, emergency pathway) | **Reuse as the classifier.** Bridge to separated fields via `fromLegacyOutcome`. Do **not** rewrite. |
| Separated 6 enums + bridge | `vocab.ts` (`WORKFLOW_STATE`/`CARE_OUTCOME`/`EXCEPTION_REASON`/`CLINICAL_FINDING`/`ESCALATION_STATE`/`PRIORITY`, `countsAsCompleted`, `fromLegacyOutcome`) | **Consume.** Validator + state helper import these; no new enums. |
| Escalation record + notify + audit | `/api/care-events/route.ts` (creates `Escalation`, `Notification` (community-scoped), `logAudit`) | **Reuse.** #5 links the occurrence to the created escalation and drives its state. |
| Escalation triggers | `care_event_engine_rules.json` (CEG-01..07), `decision_trees.json`/`decisionTrees.ts` (DT-xxx) | **Reuse as trigger vocabulary.** Definition's `escalationTrigger` references these keys. |
| Clinical alert rules | `clinical_alert_rules.json`/`clinicalAlerts.ts` | **Reuse** for finding→alert mapping where relevant (skin/glucose/BP). |
| Handover / shift endorsement | `ShiftEndorsementBoard.tsx` (`buildHandover`, `acceptHandover`, carry-overs, sign-off + `ackOpen`, checklist) | **Extend.** Pending-occurrence source + hardened sign-off gate. |
| Persisted state | `RoutineOccurrence` (5 state fields, `corrections` json, `definitionVersion`, `escalationId`) + `RoutineEventDefinition` (`exceptionSet`, `escalationTrigger`, `escalationPriority`, `stopDate`, `reviewDate`, `version`) | **Consume as-is.** No migration. |
| Notification scoping | memory `notifications-community-scoped` (userId AND active community) | **Reuse the pattern.** All #5 notifications go through the same scoping. |
| Audit | `recordAudit`/`logAudit` + `/api/audit` (memory `audit-trail-caregiver-actions`) | **Reuse.** Every state transition + correction + discontinuation writes an audit entry. |

## Design — lifecycle units

New pure module: `lib/lifecare/occurrenceLifecycle.ts` (validator + state machine helpers, no IO,
assert-based `demo()`). New API surface is minimal (see each unit). All Prisma writes go through
existing routes/patterns.

### 1. Separated state model + write/validation helper

`RoutineOccurrence` carries five state fields, each bound to one `vocab.ts` enum:

| Field | Enum | Never holds |
|---|---|---|
| `workflowState` | `WORKFLOW_STATE` | an outcome, exception, or finding |
| `careDeliveryOutcome` | `CARE_OUTCOME` | an exception reason or a clinical finding |
| `exceptionReason` | `EXCEPTION_REASON` (nullable) | an outcome or finding |
| `clinicalFinding` (json array) | `CLINICAL_FINDING[]` | an outcome or exception |
| `escalationState` | `ESCALATION_STATE` | anything else |

Single write path — `applyOccurrenceState(prev, patch): OccurrenceState`:

```ts
// pure; throws on any invalid or cross-field value
export function applyOccurrenceState(
  prev: OccurrenceState,
  patch: Partial<OccurrenceState>,
): OccurrenceState;
```

Validation rules it enforces (the Controlled Vocabulary "each is stored separately" mandate +
Assembly Rule 12 + Dashboard "Controlled vocabulary" acceptance test):

1. Each field value must be a member of its **own** enum (reject a `CLINICAL_FINDING` string in
   `careDeliveryOutcome` or `exceptionReason`, and vice-versa). This directly satisfies **"No
   clinical finding can be saved as a completion status or exception reason."**
2. `careDeliveryOutcome === "Not completed"` **requires** a non-null `exceptionReason`
   (Controlled Vocabulary: "an exception reason is required").
3. A non-null `exceptionReason` forbids `careDeliveryOutcome ∈ {"Completed as planned","Completed
   with variance"}` (exception is not completion).
4. `clinicalFinding` may co-exist with any outcome (a completed care event can still carry a
   finding) — findings are recorded and escalated separately, never as the outcome.
5. `workflowState` transitions are constrained: `Upcoming→Due→Overdue→Closed`, `→Cancelled` from
   any non-Closed state; `Closed` is terminal for the occurrence's care delivery (corrections are
   append-only, not a re-open). `Closed` requires a recorded `careDeliveryOutcome`.
6. Every accepted call returns the new state **plus an audit tuple** (field, from, to, actor, ts)
   for the caller to persist via `logAudit` — satisfies Dashboard "All state transitions, values,
   user and timestamp."

The `#4` completion buttons and `/api/care-events` bridge both route through this helper; no field
is ever set by raw assignment.

### 2. Exceptions

The six `EXCEPTION_REASON` values (Resident declined / Resident unavailable / Unsafe to perform /
Clinical hold / Missed / Authorized cancellation) are **not completion**:

- Choosing an exception sets `careDeliveryOutcome="Not completed"` + the chosen `exceptionReason`,
  `workflowState` stays `Due`/`Overdue` until closed, then `Closed` with the exception retained.
- `countsAsCompleted("Not completed") === false` (Foundations) — the completed count is derived
  from `careDeliveryOutcome`, so an exception can **never** increase it (Dashboard "Exception never
  increases completed count").
- The definition's `exceptionSet` (json, from #3) constrains which reasons are offered per event
  type — e.g. Medication offers no "Unsafe to perform" per the result schema's `allowedExceptions`;
  Sleep/Safety Round omits "Resident declined". The UI reads `exceptionSet`; the validator only
  checks canonical membership.
- **Bridge to `careEvents.ts`:** when the caregiver posts a legacy outcome, `fromLegacyOutcome`
  maps it onto the separated fields (`Refused → {outcome:"Not completed", exception:"Resident
  declined"}`, `Unable → {outcome:"Not completed", exception:"Resident unavailable"}`, `Unsafe →
  {outcome:"Not completed", exception:"Unsafe to perform"}`, `Increased Assist →
  {outcome:"Completed with variance", finding:"Increased assistance"}`, `Frequency Variance →
  {outcome:"Completed with variance", finding:"Frequency variance"}`, `Clinical Change →
  {finding:"Change from baseline"}` + escalation). The occurrence stores the separated fields; the
  `CareEvent` row (legacy) is still created by the route for continuity of the existing variance
  loop and reports.

### 3. Escalation lifecycle

A qualifying result/exception/finding creates a **linked** nurse-review event, reusing the exact
machinery already in `/api/care-events`:

- **Trigger.** The definition carries `escalationTrigger` (a CEG/DT/clinical-alert key) and
  `escalationPriority` (P1–P4). At completion, if `classifyOutcome` returns `immediateEscalation`
  **or** the definition's parameter is breached **or** a `clinicalFinding` is present, the route
  creates the `Escalation` (+ `Notification`, community-scoped) it already creates today. #5's
  addition: stamp the created escalation's id onto `RoutineOccurrence.escalationId` and set
  `escalationState`.
- **State machine.** `escalationState`: `Not required → Pending acknowledgement → Acknowledged →
  Resolved`. Mapped to the existing `Escalation.status`: OPEN→`Pending acknowledgement`,
  acknowledged→`Acknowledged`, RESOLVED→`Resolved`. The mapping is a pure function
  `escalationStateFromStatus(status)`; the reverse `escalationTargetStatus(state)` is used when the
  nurse acts. Occurrence and Escalation stay in sync but remain separate rows.
- **Priorities (Controlled Vocabulary + Dashboard P1–P4).**
  - **P1** — immediate/emergency. Creates an immediate alert (severity CRITICAL, the route's
    `escalate`/`emergency` path, `emergencyProtocol` DT-010) and **cannot passively close**: the
    occurrence's escalation cannot reach `Resolved` without an explicit nurse acknowledgement +
    disposition (a critical banner persists until accepted). Enforced by `canCloseEscalation`.
  - **P2** — urgent within shift; top of nurse action queue; visible in both caregiver and nurse
    views; requires acknowledgement + resolution.
  - **P3/P4** — monitor/trend; added to the review queue with a review date; must not disappear.
- **Rule 13 invariant — escalation does not rewrite the outcome.** Creating/acknowledging/
  resolving an escalation touches only `escalationState`/`escalationId`; it never writes
  `careDeliveryOutcome`. A late completion that also breaches a parameter stays "Completed with
  variance" **and** carries a `Resolved` escalation — the two are orthogonal. This is the
  acceptance test "Out-of-parameter result creates an escalation without rewriting completion
  outcome." The original occurrence row is retained unchanged except for the escalation link.
- **Trigger→rule map (traceability).** `escalationTrigger` values reference `care_event_engine_
  rules.json` (CEG-01..07) and `decision_trees.json` (DT-xxx); the map is asserted by the release
  suite (unit 10) so every trigger resolves to a real rule/tree key.

### 4. No silent rollover (Rule 17; Shift Rules; HF worked example)

Enforced structurally, not by policy text:

- **Independent generation.** Each recurrence is a distinct `occId=${definitionId}@${careDateISO}
  @${HHMM}` produced by #3/#4 from the approved schedule. #5 owns no code that creates the next
  occurrence — it only guarantees it never *mutates* a prior one.
- **Overdue stays put.** When a due window ends without completion/resolution, `workflowState`
  becomes `Overdue`; the original `scheduledTime` and (on late completion) `actualTime` are both
  retained. The Overdue transition never removes, reschedules, or completes the occurrence
  (Dashboard "Overdue": "Do not silently complete, remove or reschedule the original
  occurrence").
- **Completing one never completes another.** `applyOccurrenceState` operates on a single occId;
  there is no batch-close path. The 2 PM occurrence stays `Missed` even when the 4 PM occurrence
  is `Completed` — they are separate rows with separate ids (acceptance test "Missed 2 PM task
  remains missed even when 4 PM occurrence is completed"; HF worked example rows).
- **Late completion doesn't move the next scheduled time.** #5 never writes `scheduledTime`; the
  fixed schedule (e.g. 12:00 PM) is unchanged by a prior late event (HF worked example "Fixed
  schedule remains 12:00 PM despite prior late event"). Completion-based intervals (if any) are a
  #3/#4 generation concern, not #5.
- **Missed = terminal exception, not rollover.** A `Missed` exception closes the occurrence in its
  original care-day/shift audit record; it is transferred (if unresolved) via handover as a
  follow-up, which moves **accountability, not the occurrence** (unit 5).

### 5. Handover (extend `ShiftEndorsementBoard`)

`ShiftEndorsementBoard` already builds a handover snapshot and has carry-over + sign-off +
acknowledgement. #5 extends it minimally:

- **Pending source = unresolved occurrences.** `buildHandover` gains a source: occurrences with
  `workflowState ∈ {Overdue}` OR `careDeliveryOutcome="Not completed"` with an unresolved
  exception OR `escalationState ∈ {Pending acknowledgement, Acknowledged}` for the outgoing shift.
  Each pending item carries the **original due time, exception/reason, and follow-up owner** —
  never the occurrence's identity or timestamp (Rule 17 "Handover transfers accountability, not
  timestamp or occurrence identity").
- **Outgoing shift must address each item.** For every unresolved item the outgoing caregiver
  chooses **resolve / escalate / transfer** with a follow-up owner + due time (Dashboard "Handover
  preparation"). Building this list reuses the existing carry-over draft.
- **Incoming shift explicitly accepts accountability.** `acceptHandover` records incoming
  identity + timestamp **without altering the original event** (Dashboard "Handover acceptance":
  "Transfer accountability without altering original event"). The original occurrence's
  miss/delay row is unchanged and remains auditable ("Original miss/delay remains auditable").
- **Hardened sign-off gate.** The existing sign-off checklist is extended so a shift **cannot
  close with unaddressed critical items**: any pending item that is `criticality:"Critical"` or
  carries an unresolved P1/P2 escalation blocks sign-off until resolved/escalated/transferred
  (Dashboard "Handover preparation" acceptance test "Shift cannot close with unaddressed critical
  items"). Pure predicate `canCloseShift(pendingItems): { ok; blockers[] }`.

### 6. Care-plan revision & history immutability (Rule 18; Dashboard revision)

- New instructions apply **only after nursing approval + effective date** (#3 approval flow). A
  revision creates a **new `RoutineEventDefinition.version`**; occurrences already generated pin
  the **old** `definitionVersion` and are never touched.
- Revision updates **future** occurrences only (those generated from the new version on/after the
  effective date). Completed/historical occurrences keep their pinned version and their recorded
  results (Rule 18 "Do not retroactively alter historical occurrences"; Dashboard "preserve
  completed and historical events").
- Historical charting never changes → acceptance test "Past records remain unchanged after plan
  revision" / "Historical charting does not change." #5 provides `isEditableOccurrence(occ)` =
  `false` once `Closed` (only corrections, unit 8, may append) — the guard the UI/API honor.

### 7. Discontinuation (Dashboard)

- An authorized `stopDate` on the definition (from #3) cancels **future** occurrences: generation
  stops on/after `stopDate`; any not-yet-due occurrence for a discontinued definition is set
  `workflowState="Cancelled"` with `exceptionReason="Authorized cancellation"` + reason + actor
  (Dashboard "Discontinuation": "Cancel future occurrences with reason; retain past records").
- **Past occurrences are retained** unchanged (acceptance test "No new events generate after stop
  date"). The temporary-bundle stop rule (Rule 19) is the same mechanism: expire/stop on the
  configured date unless actively renewed. #5 provides `cancelFutureOccurrences(defId, stopDate,
  reason, actor)` (a query + `applyOccurrenceState` per future occurrence + audit) — no new model.

### 8. Correction (Dashboard, append-only)

- A correction **appends** the amended value to `RoutineOccurrence.corrections` (json array) and
  **preserves the original** result untouched (Dashboard "Correction": "never overwrite original
  documentation"). Each entry: `{ field, originalValue, amendedValue, reason, userId, at }`.
- Helper `appendCorrection(occ, entry)` (pure) returns the new `corrections` array; the occurrence
  row shows a "Corrected" indicator; the audit + the correction array together satisfy "Audit
  shows both versions." The original `careDeliveryOutcome`/`results`/`actualTime` are immutable —
  the current displayed value is the latest correction, but both versions are always present.
- Corrections are the **only** post-`Closed` write; they do not re-open the occurrence or change
  `workflowState`.

### 9. Document once

- One structured occurrence (`occId`) is the single source across resident timeline, handover,
  alerts, and reports (Dashboard "Document once"). Quick-Chart entries link to the matched
  scheduled occurrence when one exists (Dashboard "Quick Chart": "Link entry to scheduled
  occurrence when matched; otherwise create trigger-based event") and are deduplicated so the
  entry appears **once** in the timeline. #5 provides `matchOccurrenceForQuickChart(residentId,
  category, at)` and asserts no duplicate completion of the same occId (Dashboard "Recurring
  event": "Completing one does not close another" + "Prevent duplicate completion").
- Handover, escalation, and reports all reference the occurrence by `occId`; none creates a
  parallel daily-log entry (acceptance test "No duplicate daily-log entry is required").

### 10. Release validation (Rule 21)

A `validateRoutineRelease(config)` suite runs before a routine configuration can publish; any
**critical** failure blocks publication (Rule 21 "Any critical validation failure blocks
publication"):

| Check | Rule | Critical? |
|---|---|---|
| **ID uniqueness** | zero duplicate `occId` / event-definition ids across the care day | Yes |
| **Source-link** | every definition retains Source Task ID + AS domain + Goal ID; every occurrence pins `definitionId` + `definitionVersion` | Yes |
| **Required-field** | every event has one Care Event, one Required Result schema, one Completion Control (Rule 7); zero missing completion controls | Yes |
| **Vocabulary validity** | every stored state value ∈ its own enum; every `exceptionSet` / `escalationTrigger` value canonical | Yes |
| **Order/scope** | no medication/monitoring/treatment/restriction task without required order + authorized role (Rule 11) | Yes |
| **Conflict** | zero unresolved assistance/timing/order conflicts (Rules 8–10) | Yes |
| **Escalation-trigger resolves** | every `escalationTrigger` maps to a real CEG/DT/alert key | Warn→block if unresolved key |
| **Memory-Care invariant** | no config equates Memory pathway with LOC 4 (Rule 20) | Yes |

Returns `{ ok, criticalFailures[], warnings[], results }`; the suite result is stored with the
released version (Rule 21 "Store test results with released version"). Acceptance test: "Zero
duplicate event IDs, zero missing completion controls and zero unresolved order conflicts."

## Out of scope (this sub-project)

- The `assembleRoutine()` algorithm and occurrence **generation** (#2/#3/#4) — #5 consumes
  generated occurrences and only guards their lifecycle.
- New Prisma models or migrations — the five state fields, `corrections`, `definitionVersion`,
  `escalationId`, `exceptionSet`, `stopDate`, `reviewDate`, `version` all exist from #3.
- Re-implementing `classifyOutcome` / the CEG-DT escalation matrix (reused verbatim).
- Rebuilding the shift endorsement / handover board (extended, not rebuilt).
- Nurse escalation-queue UI beyond linking occurrence↔escalation (the existing
  `EscalationsBoard` + notifications carry it); a dedicated routine-escalation queue view, if
  wanted, is a follow-on.
- Tuning grace periods / resident-specific parameters (SOP-driven, provisional — unit 3/4).

## Testing

`lib/lifecare/occurrenceLifecycle.ts` ships an assert-based `demo()`; a single
`tests/lifecare-lifecycle.test.ts` runs it + cross-checks against `vocab.ts` and the reused
datasets:

- **State-separation validator:** `applyOccurrenceState` rejects a `CLINICAL_FINDING` value put in
  `careDeliveryOutcome` or `exceptionReason` (→ "No clinical finding can be saved as a completion
  status"); `"Not completed"` without an `exceptionReason` throws; an `exceptionReason` with a
  "Completed…" outcome throws.
- **Exception ≠ completion:** for all six exception reasons, `countsAsCompleted` of the resulting
  outcome is `false`; the completed-count derivation ignores them (acceptance "Resident declined
  cannot count as completed"; "Exception never increases completed count").
- **`fromLegacyOutcome` bridge:** all 8 legacy outcomes map to disjoint separated fields.
- **No-rollover / occId independence:** two occIds sharing a `definitionId` but different `HHMM`
  are independent; completing one leaves the other's state unchanged; `applyOccurrenceState` has no
  path that writes `scheduledTime` (acceptance "Missed 2 PM… even when 4 PM… completed";
  "Completing one does not close another").
- **Escalation orthogonality (Rule 13):** creating/resolving an escalation on a "Completed with
  variance" occurrence leaves `careDeliveryOutcome` unchanged (acceptance "Out-of-parameter result
  creates an escalation without rewriting completion outcome"); P1 `canCloseEscalation` is `false`
  without explicit acknowledgement.
- **Revision immutability:** a `Closed` occurrence is `isEditableOccurrence === false`; bumping the
  definition version does not alter a pinned historical occurrence (acceptance "Past records
  remain unchanged after plan revision").
- **Discontinuation:** `cancelFutureOccurrences` cancels only future occurrences with reason;
  past rows untouched.
- **Correction append-only:** `appendCorrection` preserves the original and adds the amendment;
  both versions present (acceptance "Audit shows both versions").
- **Handover gate:** `canCloseShift` blocks when a Critical/P1/P2 item is unaddressed; passes when
  each is resolved/escalated/transferred with owner + due time.
- **Release suite:** `validateRoutineRelease` fails a config with a duplicate occId, a missing
  completion control, an unresolved order conflict, an off-vocabulary value, and a Memory=LOC4
  equation; a clean config passes (acceptance "Zero duplicate event IDs, zero missing completion
  controls and zero unresolved order conflicts").

## Risks / provisional values

- **`escalationState`↔`Escalation.status` mapping is a bridge, not a merge.** The two rows can
  drift if the nurse resolves an `Escalation` outside the routine flow. Mitigation: the occurrence
  reads `escalationState` from the linked `Escalation.status` on load (derive, don't cache blindly);
  a reconciliation is a follow-on if drift is observed. `ponytail:` derive-on-read, add a sync job
  only if drift shows up.
- **Grace periods / resident-specific parameters that decide Due→Overdue and P-level are
  provisional** — kept as definition fields (#3), tunable to SOP; #5 only consumes them.
- **`exceptionSet` per event type** is seeded from each result schema's `allowedExceptions`
  (Foundations unit D); a few event types may need SOP review (e.g. whether Sleep/Safety Round
  allows "Resident declined").
- **Quick-Chart occurrence matching** (`matchOccurrenceForQuickChart`) is heuristic on
  resident+category+time-window; an ambiguous match falls back to a trigger-based event rather than
  guessing (per Dashboard rule), flagged for review.
- **P1 "cannot passively close"** is enforced in `canCloseEscalation`; the actual emergency
  dispatch remains the existing `/api/care-events` emergency path (DT-010) — #5 does not change
  emergency behavior, only the state gate.

## Acceptance criteria (this sub-project done when)

1. The five state fields are stored **separately** and every write goes through
   `applyOccurrenceState`, which rejects cross-field values — **"No clinical finding can be saved
   as a completion status or exception reason."**
2. An exception sets `careDeliveryOutcome="Not completed"` + a required reason and **never**
   increases the completed count — **"Resident declined cannot count as completed"**; **"Exception
   never increases completed count."**
3. A qualifying result/exception/finding creates a **linked** escalation (reusing
   `/api/care-events` Escalation + community-scoped Notification) with P1–P4 and an
   `escalationState` lifecycle, **without rewriting the completion outcome** — **"Out-of-parameter
   result creates an escalation without rewriting completion outcome"**; P1 cannot passively close.
4. No silent rollover: an overdue/incomplete occurrence stays in its original care-day/shift record
   with original scheduled + actual times; the next recurrence is a distinct occId; completing one
   never completes another — **"Missed 2 PM task remains missed even when 4 PM occurrence is
   completed."**
5. Handover (extended `ShiftEndorsementBoard`) transfers each unresolved item with original due
   time + reason + follow-up owner; incoming shift explicitly accepts accountability without
   altering the original event; a shift **cannot close with unaddressed critical items** — **"Shift
   cannot close with unaddressed critical items"**; **"Original miss/delay remains auditable."**
6. Plan revision applies only after approval + effective date, updates future occurrences, and
   preserves historical ones (version-pinned) — **"Past records remain unchanged after plan
   revision"** / **"Historical charting does not change."**
7. Discontinuation cancels future occurrences with reason and retains past records — **"No new
   events generate after stop date."**
8. Correction is append-only; the original is preserved and both versions are visible — **"Audit
   shows both versions."**
9. One occId is reused across timeline/handover/alerts/reports with no duplicate daily-log entry —
   **"No duplicate daily-log entry is required"**; **"Completing one does not close another."**
10. `validateRoutineRelease` runs ID-uniqueness, source-link, required-field, vocabulary,
    order/scope, conflict, escalation-trigger and Memory-Care checks; any critical failure blocks
    publication and the result is stored with the released version — **"Zero duplicate event IDs,
    zero missing completion controls and zero unresolved order conflicts."**
11. `tests/lifecare-lifecycle.test.ts` passes (per-module `demo()` + the above assertions);
    `classifyOutcome`, the `Escalation`/`Notification` route, and `ShiftEndorsementBoard` are
    reused, not duplicated. Zero new Prisma model / migration.
