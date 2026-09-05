# SLMS v4.2 Routine — Sub-project #4: Caregiver Atomic Execution — Design

**Date:** 2026-09-05
**Status:** Draft design → awaiting user review
**Governing spec:** `SLMS_v4.2_AS_Goals_Tasks_24-Hour_Routine (2).xlsx` (authoritative).
Primary sheets for this sub-project: **Dashboard & Workflow Rules**, **Caregiver Execution
Rules** (+ worked examples EX-CG-001..008), **Care Event Result Fields**; **Shift Rules**
(shift windows). **Assembly Rules 7, 15–17** frame the atomic contract.
**Reference:** the facility's manual "Resident Routine" form (Time | Activity | Level of
Assistance | Assisted By) is the target caregiver-view shape — **the manual "DATE" column is
replaced by TIME / WINDOW**, and two operational columns (Status, Action) are appended.
**Consumes:** #1 Foundations (`vocab.ts`, `result_schemas.json` + `resultSchema.ts`,
`assistance.ts`, `loc_bundles.json`) and #3 Persistence (`RoutineEventDefinition` +
`RoutineOccurrence` Prisma models — read-then-write occurrences).

## Program context (where #4 sits)

Sub-projects: 1 Foundations *(done)* · 2 Assembly engine · 3 Persistence + Nurse approval ·
**4 Caregiver atomic execution** *(this spec)* · 5 Exceptions / escalation / handover / audit.

#3 approves `RoutineEventDefinition`s and generates one `RoutineOccurrence` per scheduled
time/window/interval/trigger for the care day (Assembly Rule 15). **#4 is the caregiver-facing
read-and-close layer over those occurrences.** Its one structural change: **replace the bundled
"encounter checklist" of today's `TodaysCareBoard` with ATOMIC event rows** — one occurrence =
one observable action = one required result = one completion decision (Assembly Rule 7,
Caregiver Execution Rule "Atomic event"). This supersedes the grouped-card design in
`2026-09-04-high-frequency-routine-occurrences-design.md`.

#4 does **not** own escalation runtime, handover acceptance, no-silent-rollover recurrence
generation, correction, or discontinuation — those are #5. #4 *surfaces* the state fields those
lifecycles read/write (`escalationState`, `exceptionReason`, criticality banners, handover-item
list) and posts the `CareEvent` audit record that #5's escalation logic keys off, but the
lifecycle transitions themselves land in #5.

## Decisions locked (from shared context + brainstorming)

- **Atomic, not bundled.** Each `RoutineOccurrence` renders as one row. Completing one never
  closes another (`occId = ${definitionId}@${careDateISO}@${HHMM}`; distinct id per occurrence).
- **Two linked views.** *Resident Daily Routine* (one resident, full 24h, the manual-form
  table) and *My Shift* (one caregiver, current shift, urgency-ordered). My Shift → select a
  resident → opens that resident's Resident Daily Routine (deep-link, embedded).
- **Assistance is DISPLAY-labelled** via `ASSISTANCE_DISPLAY` (Independent→Observation,
  Setup/Cueing→Supervision, Minimal→Min. Assistance, Extensive→Extensive Assist,
  Total→Fully Dependent). Assigned-To uses `ROLE_ABBR` (CGs / NOD / OTH); medication & clinical
  orders = NOD.
- **Completion is gated by the typed result schema.** Complete = confirmation only;
  Record & Complete opens `schemaFor(resultSchemaKey)` required fields and `validateResult` MUST
  pass before close. Medication → Open MAR; ordered treatment → Open TAR/Treatment Record.
- **Timezone Asia/Manila** everywhere (care day, status derivation, actual time) — reuse
  `careDay()` from `routineCompletions.ts`.
- **Per-occurrence time-window gate** reuses TodaysCareBoard's existing gate math (lead-min +
  grace), keyed to each occurrence's `scheduledTime` rather than a shared window.
- **RBAC:** caregivers never see nurse approval / clinical-interpretation controls.

## Reuse map (extend, don't build new — Ponytail)

| Concern | Already exists | #4 action |
|---|---|---|
| Bundled Today's Care board | `TodaysCareBoard.tsx` (`RoutineEncounter` checklist, exception modal, package gate, optimistic charting) | **REWORK to atomic.** Replace `RoutineEncounter[]` with `RoutineOccurrence[]`; keep the exception modal, optimistic tick, DT-014 package warning, and the `/api/care-events` write. Data source switches from `generateRoutine()` on the fly → reading `RoutineOccurrence` rows for the care day. |
| Mobile My Shift | `CaregiverShiftBoard.tsx` (shift header, Due/Overdue/Up-to-date counts, per-resident cards, Quick record tiles, "Open routine" → embedded board) | **EXTEND.** Re-label buckets to Due Now / Overdue / Upcoming / Completed; order by urgency then scheduled time; surface critical/unresolved/pending-exception/handover items; "Open routine" already deep-links to the board (keep). |
| Time-window gate | `windowGate()` / `itemGate()` / `windowRange()` / `WINDOW_LEAD_MIN` / `OCCURRENCE_GRACE_MIN` in `TodaysCareBoard.tsx` | **Extract to `lib/lifecare/occurrenceStatus.ts`** and generalise to derive `workflowState` (Upcoming/Due/Overdue/Closed/Cancelled) from `scheduledTime` + now (Asia/Manila). Pure, tested. |
| Per-item completion store | `routineCompletions.ts` (`careDay`, `parseRoutineCompletions`, `upsertRoutineCompletion`) | Reuse `careDay()`. The **occurrence itself** (real Prisma row) is now the source of truth for closed/outcome; the app-setting store is retained only as the optimistic/offline echo until the write lands. |
| Governed audit write | `/api/care-events` route + `CareEvent` model | Reuse verbatim — every close/exception still posts a `CareEvent` (escalation, nurse-notify, variance server-side). #4 also writes the `RoutineOccurrence` (workflowState/results/actualTime/completionUserId). |
| Medication | `MARDailyBoard.tsx` (`clinicianRole`, `focusResidentId`, `embedded` props) | Reuse as the **Open MAR** target for medication occurrences (embedded modal, `clinicianRole="CAREGIVER"`, `focusResidentId`). |
| Live data + identity | `useLiveQuery`, `useClinician.ts`, `/api/auth/session` | Reuse. `useClinician("CAREGIVER")` supplies `userId`/`name` for `assignedStaffId` match + `completionUserId`. |
| Clinical UI kit | `clinical-ui.tsx` (`ClinicalPage/Header/Card/Button/Modal`, `StatusPill`, `StatCard`, `DataState`, `SearchInput`, `MicroLabel`) | Reuse for every surface. |
| Result field forms | `result_schemas.json` + `resultSchema.ts` (`schemaFor`, `validateResult`) — #1 | **New thin renderer** `ResultEntryForm` maps each schema's required/optional fields + units to controls; submit calls `validateResult`. |
| Assistance / role display | `assistance.ts` (`ASSISTANCE_DISPLAY`, `ROLE_ABBR`) — #1 | Reuse for the two display columns. |
| Resident glance (name/photo/room/LOC/pathways) | `adapters.ts` `adaptResident()`; `rcard`/`CareLogsBoard` resident header pattern; `caregiver` dashboard packs precautions in `detail` | Reuse the adapter + resident-glance pattern to render the page header **once** (not per row). |

## Design — the units

All UI lives under existing paths. New pure helper: `lib/lifecare/occurrenceStatus.ts`. New
component fragments live inside the reworked `TodaysCareBoard.tsx` (renamed intent: *Resident
Daily Routine*) + `CaregiverShiftBoard.tsx`. No new top-level board.

### Data flow (read model)

`RoutineOccurrence` rows for `careDate = careDay()` are read via `useLiveQuery("routine-occurrences", …)`
(a `RoutineOccurrence` table read added in #3). Each row already carries `scheduledTime`,
`assignedStaffId`, `workflowState`, `careDeliveryOutcome`, `results`, `exceptionReason`,
`escalationState`, `criticality` (from its `RoutineEventDefinition`). `workflowState` persisted
by #3/#5 is authoritative for **Closed/Cancelled**; for open rows #4 **derives** live
Upcoming/Due/Overdue from `scheduledTime` + now (a row can't be "Overdue" in the DB until a
cron writes it — the client computes it for display, `occurrenceStatus.ts`).

### 1. Resident Daily Routine view (one resident, 24h)

Chronological **12:00 AM → 11:59 PM** — includes previous-shift (already-closed/overdue),
current-shift, upcoming, and overnight occurrences, so the caregiver sees the whole day's
journey (Assembly Rule 15: one continuous resident routine; shifts divide accountability, not
the plan). Atomic rows, one `RoutineOccurrence` each, sorted by `scheduledTime`.

**Table columns** (manual-form shape + 2 operational):

| Time / Window | Activity | Assistance | Assigned To | Status | Action |
|---|---|---|---|---|---|
| `scheduledTime` (`HH:MM`) or the defined window; a shift tint (Night/Morning/Afternoon per Shift Rules) | event `name` | `ASSISTANCE_DISPLAY[assistanceLevel]` | `ROLE_ABBR[responsibleRole]` (CGs/NOD/OTH) | `StatusPill` of derived `workflowState` (+ "late" tag when past grace) | completion buttons (unit 4) |

- **Grouping:** rows are grouped under Night / Morning / Afternoon subheads for scannability but
  remain individually atomic. Previous-shift overdue rows stay in their original shift group
  (no silent rollover — Rule 17 / Workflow "Overdue").
- **Page header (rendered ONCE, not per row):** resident name + photo, room, **care date
  (once)**, Final LOC badge, active condition / **Memory pathway** badges (Memory shown as a
  distinct cross-LOC badge, never implying LOC 4 — Rule 20), assigned caregiver, current shift,
  **completed / total**, **overdue count**, **pending-nurse-review count** (rows with
  `escalationState ∈ {Pending acknowledgement, Acknowledged}`). Header data via `adaptResident()`
  + the resident-glance pattern already used by `CareLogsBoard`/`rcard`.
- **Counting rule:** `completed = rows where countsAsCompleted(careDeliveryOutcome)`; `total =`
  all non-Cancelled rows for the day. Exceptions and "Not completed" **never** raise `completed`
  (Foundations `countsAsCompleted`; Workflow "Exception never increases completed count").

### 2. My Shift view (one caregiver, current shift)

Extend `CaregiverShiftBoard.tsx`. Show **only** occurrences whose `assignedStaffId` = the
authenticated caregiver's staff id **AND** whose `scheduledTime` falls in the current shift
window (Shift Rules: Night 22:00–06:00 / Morning 06:00–14:00 / Afternoon 14:00–22:00).
"Caregiver sees only authorized assigned work" (Workflow acceptance test).

- **Ordering:** by urgency (Overdue → Due Now → Upcoming → Completed) then `scheduledTime`.
- **Counts (StatCards):** Due Now / Overdue / Upcoming / Completed — derived from the same rows
  as the list (single source, so tiles never disagree with rows; this was an existing bug class
  in `CaregiverShiftBoard` — keep the shared-derivation fix).
- **Always visible** (Workflow "Must Remain Visible"): critical + overdue + unresolved
  (`escalationState` pending) rows, **pending exceptions**, and **required handover items**
  (occurrences unresolved at shift end — surfaced read-only here; acceptance is #5).
- **Selecting a resident opens that resident's Resident Daily Routine** (embedded modal,
  `focusResidentId`, `role="CAREGIVER"`) — the existing "Open routine" deep-link, kept.

### 3. Task card (act without opening the full care plan)

The atomic row expands to a card (tap / already-inline on mobile) showing, from the occurrence's
definition: resident, **due time / window**, **event name**, **key instruction**
(`instructions`), **assistance** (display label), **equipment**, **precautions** (technique /
conditionModifier), **escalation trigger**, **criticality** badge, and the action buttons. This
is the "enough direction for safe execution" contract (Workflow "Task card"; Caregiver Execution
"Resident instruction"). Source `Task ID / AS domain / Goal ID` are retained on the record
(traceability) but not shown on the caregiver card.

### 4. Completion buttons (one per occurrence)

Which button shows is driven by the occurrence's `resultSchemaKey` + `orderRequired`:

| Button | When | Behaviour |
|---|---|---|
| **Complete** | schema `completionButton = "Complete"` (confirmation-only events) | One tap → captures `actualTime` (now, Manila) + `completionUserId`; writes occurrence `workflowState=Closed`, `careDeliveryOutcome="Completed as planned"`; posts `CareEvent`. No result form. |
| **Record & Complete** | schema `completionButton = "Record & Complete"` (structured result required) | Opens `ResultEntryForm` (unit 5). `validateResult` MUST pass — **cannot close with a blank/invalid required field.** |
| **Open MAR** | `resultSchemaKey = "Medication"` (`orderRequired`) | Opens `MARDailyBoard` (embedded, `focusResidentId`, `clinicianRole="CAREGIVER"`). Occurrence closes off the MAR outcome — "never a generic completion without MAR result". |
| **Open TAR / Treatment Record** | ordered treatment / clinical monitoring (`orderRequired`, e.g. `LOC*-RT-014`, `SKIN-01` ordered arm) | Opens the ordered-treatment record for the resident (embedded); occurrence closes off the ordered result. |
| **Exception** (secondary) | any open occurrence | Existing exception modal → `careDeliveryOutcome="Not completed"` + `exceptionReason` (allowed set from schema). Never counts as completed. (Full lifecycle is #5; the button + write live here.) |

**Atomic split example rendered (from EX-CG-005/006 + Shift Rules):**

```
08:00  Breakfast            Meal supervision (Supervision)   CGs  [Record & Complete]
08:00  Hydration offer      Prompt/supervision               CGs  [Record & Complete]
08:15  Morning medication   Per MAR (—)                      NOD  [Open MAR]
```

Three separate occurrences with three separate ids; medication is a separate MAR-linked NOD
event. Completing Breakfast does not close Hydration or Medication.

### 5. Result entry (`ResultEntryForm`)

Renders `schemaFor(resultSchemaKey)`:

- One control per **required field**, then optional fields, each with its **unit** label from the
  schema (mL, mg/dL, BP mmHg / pulse bpm / temp °C / SpO₂ %, minutes, 0–10, position list, etc.).
  Controlled-list fields render as selects; free text only where the schema allows a note.
- **Submit** calls `validateResult(resultSchemaKey, payload)`; on `{ok:false}` it blocks and
  highlights `missing` + `invalid` (e.g. Hydration `consumed>offered`, Meal amount without unit,
  Vitals missing an ordered reading). **No close on invalid** (Workflow "Blank required result
  cannot be completed").
- On `{ok:true}` write, in one action:
  1. `RoutineOccurrence`: `workflowState="Closed"`, `careDeliveryOutcome` (Completed as planned
     / with variance — "with variance" when past-grace late, matching the current late-flag
     behaviour), `results = payload`, `actualTime = now`, `completionUserId`, `completionAt`.
  2. **`CareEvent` audit** via `/api/care-events` (unchanged governed route) so escalation /
     nurse-notify / variance fire server-side.
- **Per-occurrence gating:** `occurrenceStatus.ts` gates the buttons — locked until
  `scheduledTime − lead`, chartable through `scheduledTime + grace` then "late". Caregivers are
  gated; nurses/CMs are not (reuse the existing `isCaregiverView` gate + the guard that blocks a
  stale client charting a not-yet-open occurrence).

### 6. Quick Chart

Keep `CaregiverShiftBoard`'s Quick record tiles (high-frequency categories = the schema
`quickChartCategory` set: Toileting, Nutrition, Hydration, Mobility, Repositioning, Vitals,
Personal Care, etc.), but wire completion to occurrences (Workflow "Quick Chart"):

- On save, **match** the entry to an open scheduled occurrence for that resident + category
  within the current window; if matched, **close that occurrence** (link the entry to it) — so
  the entry "appears once in the resident timeline" and no duplicate close.
- If no match, **create a trigger-based occurrence** (PRN) for the category and close it — a
  distinct auditable row, not a rollover.
- **Duplicate-completion guard:** an already-Closed occurrence can't be re-closed by Quick Chart
  (the read model + occurrence id check; "Prevent duplicate completion of the same occurrence").

### 7. RBAC

- Caregiver session (`effectiveRole === "CAREGIVER"`): sees only own assigned occurrences (My
  Shift), the atomic execution controls, and the structured exception picker. **Hidden:** nurse
  approval/return controls, escalation-disposition / clinical-interpretation controls, the Nurse
  queue, and free-text observation on exceptions (caregivers chart by structured outcome — keep
  the existing `!isCaregiverView` gate on the note field).
- Nurse / CM / Facility Admin / SuperAdmin: full view (both roles' occurrences, no time-gate),
  but the *approval* surfaces live in #3's board, not here.
- Resolution reuses the existing `NURSE_ROLES` set + `/api/auth/session` role.

## Out of scope (this sub-project)

- `RoutineEventDefinition` / `RoutineOccurrence` schema + generation (#3) — #4 reads occurrences
  and writes completion fields only.
- Escalation runtime, P1–P4 routing, nurse-review queue, handover **acceptance**, no-silent-
  rollover recurrence generation, correction append, discontinuation (#5). #4 surfaces their
  state and posts the `CareEvent` they key off.
- `assembleRoutine()` (#2); the Foundations rule tables/helpers (#1).
- Editing MAR internals (reused as-is via its props).

## Testing

Component-level notes + **pure-helper self-checks** (assert-based `demo()`, no framework —
Ponytail: one runnable check per non-trivial helper):

- **`occurrenceStatus.ts`** — the load-bearing logic:
  - `deriveState({scheduledTime, workflowState}, now)` in Asia/Manila: before `lead` →
    `Upcoming`; within window/grace → `Due`; past grace + open → `Overdue`; persisted
    `Closed`/`Cancelled` short-circuit. Assert each boundary (lead-1min, exact start, grace edge,
    grace+1min) and the DST-free Manila offset (fixed +08:00, no DST — assert via
    `Intl` formatting, not local `Date`).
  - `countProgress(rows)` → `{completed, total, overdue, pendingReview}`: assert an exception row
    and a "Not completed" row do **not** raise `completed`; a Cancelled row is excluded from
    `total`; `overdue` counts derived-Overdue open rows.
- **Completion gate** — assert `validateResult` failure blocks close (Hydration
  `consumed>offered`; Medication without MAR outcome; blank required Vitals reading).
- **Atomicity** — assert closing `occId A` leaves sibling `occId B` (same definition, different
  `HHMM`) open (`completing one does not close another`).
- **RBAC** — a `CAREGIVER` payload yields only own-assigned occurrences and no nurse controls.
- **Quick Chart** — assert an entry matched to an open occurrence closes exactly that occurrence
  and creates none; an unmatched entry creates exactly one trigger-based occurrence; a Closed
  occurrence is not re-closable.

## Risks / provisional values

- **Grace period + lead-min are provisional** — reuse `WINDOW_LEAD_MIN=5` / `OCCURRENCE_GRACE_MIN=30`
  from today's board; criticality-scaled grace (critical events open/escalate earlier — High-
  Frequency sheet "Criticality and grace period") is a #5 knob. `// ponytail:` note at the constant.
- **"Completed with variance" for late** rides the existing observation-encoded late flag until a
  variance column is queried; the occurrence's `actualTime` vs `scheduledTime` is the real signal.
- **Occurrence read-then-write races** — two caregivers on the same occurrence: last-write-wins on
  the row, but the duplicate-completion guard (id already Closed) + the immutable `CareEvent`
  audit trail keep it attributable. Per-occurrence optimistic lock deferred to #5 if it bites.
- **`routine-occurrences` read model** assumes #3 exposes a `RoutineOccurrence` list read; if #3
  ships write-only, #4 needs a thin GET (flag to #3).

## Acceptance criteria (Dashboard & Workflow Rules "Acceptance Test" column)

1. **Caregiver sees only authorized assigned work** — My Shift lists only own-assigned, in-shift
   occurrences; nurse controls hidden.
2. **Card provides enough direction for safe execution** — task card shows assistance, equipment,
   precautions, escalation trigger, criticality without opening the care plan.
3. **One click closes a confirmation-only event** — Complete captures actual time + caregiver, no
   result form.
4. **Blank required result cannot be completed** — Record & Complete blocks on `validateResult`
   failure.
5. **Completing one does not close another** — atomic occurrence ids; sibling stays open.
6. **Exception never increases completed count** — `countsAsCompleted` excludes exceptions /
   Not completed; Cancelled excluded from total.
7. **Late task remains attributable to original occurrence** — overdue row keeps original
   `scheduledTime` + shift group; no silent complete/reschedule (display side of Rule 17).
8. **Quick entry appears once in resident timeline** — Quick Chart links to a matched occurrence
   or creates one trigger-based occurrence; no duplicate close.
9. **My Shift shows Due Now / Overdue / Upcoming / Completed** consistent with the rows.
10. **Medication closes only off a MAR result** — medication occurrences route to MAR, never a
    generic Complete.
11. **Assistance & role render as facility DISPLAY labels** (`ASSISTANCE_DISPLAY` / `ROLE_ABBR`);
    care date shown once; Memory pathway badge never implies LOC 4.
12. Resident Daily Routine renders the full 12:00 AM–11:59 PM day, atomic rows, Time/Window
    column (manual "DATE" column replaced), grouped by shift.
