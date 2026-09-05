# SLMS v4.2 Routine — Sub-project #3: Persistence + Nurse Approval — Design

**Date:** 2026-09-05
**Status:** Draft design → awaiting user review
**Governing spec:** `SLMS_v4.2_AS_Goals_Tasks_24-Hour_Routine (2).xlsx` (authoritative).
**This sub-project implements:** Routine Assembly Rules **14, 15, 18, 19** + the Dashboard
Workflow rows **Care-plan revision / Discontinuation / Correction / Role scope**, plus the
original **Shift Rules** activation/approval requirements (Activation, Care day, Shift
reference/ownership, Clinical safeguard).
**Depends on:** #1 Foundations (`vocab.ts`, `assistance.ts`, `loc_bundles.json`,
`condition_pathways.json`, `result_schemas.json`, `as_care_delivery_map.json`) and
#2 Assembly engine (`assembleRoutine()` → in-memory `DraftEvent[]`).

## Program context (why this sub-project exists)

#2 produces a **deduplicated DRAFT** — pure, in-memory `DraftEvent[]` from `assembleRoutine()`.
It writes nothing and it renders nothing. This sub-project is the **governance seam**: it
persists that draft, gives the nurse a Draft→Review→Approve board, and — only after
Approved + effective — materializes the day's `RoutineOccurrence` rows that #4 (caregiver
execution) reads. It owns the two real Prisma models, the versioning/lifecycle rules
(revision preserves history; stop/review expiry; discontinuation), and the audited
approve/version/generate API surface.

The invariant that anchors the whole phase (Rule 14): **Draft / Returned / Expired /
Cancelled definitions generate NOTHING.** Only `APPROVED` + effective produces occurrences.

## Decisions locked (from shared program context)

- **Real Prisma models** — `RoutineEventDefinition` + `RoutineOccurrence` (defined below).
  Foundations stays migration-free JSON+TS; governance data is relational for auditability,
  versioning and RBAC. The `prisma db push` runs **out of session** (see §1.4 — dev server
  holds a prisma-generate EPERM lock, per memory `prisma-migration-constraint`).
- **Occurrence identity:** `occId = ${definitionId}@${careDateISO}@${HHMM}`. Completing one
  never completes another; NO silent rollover (Rule 17, enforced fully in #5).
- **Timezone Asia/Manila** for `careDate` derivation (reuse the careDay helper).
- **Assistance:** canonical SLMS level (from AS score) + facility display map; two-person /
  mechanical are staffing/equipment, never an assistance level (from #1 `assistance.ts`).
- **Responsible role:** enum (`Caregiver`=CGs / `Nurse`=NOD / `Other authorized`=OTH);
  med/clinical-order events default to Nurse.
- **On-demand idempotent occurrence materialization** (not a cron) — see §5.
- **Editing an APPROVED routine creates a new version**; historical occurrences keep their
  `definitionVersion` unchanged (Rule 18).

## Reuse map (extend, don't duplicate)

| Concern | Already exists | Action |
|---|---|---|
| Nurse routine board | `RoutineGeneratorBoard.tsx` (read-only preview; resident picker via `useLiveQuery` + `adaptResident`; `Send` gated on ACTIVE care plan) | **Extend into Draft→Review→Approve.** Keep the resident picker, `clinical-ui` primitives (`ClinicalCard`/`ClinicalButton`/`StatusPill`/`DataState`), the shift grouping shell. Replace the read-only timeline with editable per-event rows. |
| Draft overlay pattern | `care_plan_drafts` app-setting + `carePlanDraft.ts` (`parseCarePlanDrafts`) | **Pattern reference only.** DRAFT definitions now live in the real table, not an app-setting, but the debounced-edit UX is the same feel. |
| PIN sign + lock | `SignatureModal` (`mode="sign"`, `onSigned` callback; client-side verify via `signingPin.ts`) + SIGN_LOCK guard pattern (memory `signing-pin-and-barcodes`) | **Reuse for Approve.** `onSigned` runs the approve mutation. |
| Care-day (Asia/Manila) | `routineCompletions.ts` `completionKey(careDay,…)` + the existing careDay helper it uses | **Reuse** careDay derivation for `careDate` + `occId`. |
| Assembly output | #2 `assembleRoutine()` → `DraftEvent[]` | **Consume.** Map each `DraftEvent` → a `RoutineEventDefinition` row. |
| Generic persistence | `/api/db/[model]` + `[id]` routes; `createRecord/updateRecord/upsertRecord/deleteRecord` (`api.ts`); `useLiveQuery` (realtime + polling) | **Reuse for reads + simple field edits.** State-changing transitions (approve / version / generate) get **dedicated routes** (§7). |
| Audit | `recordAudit()` (`auditClient.ts`) → `/api/audit`; `/api/db` auto-audits writes (memory `audit-trail-caregiver-actions`) | **Reuse.** Add `routine-definitions` + `routine-occurrences` to the audit allowlist. |
| FK conventions | `Resident` model: nullable `communityId`/`organizationId` with `onDelete: SetNull` | **Match** for the two new models. |

## Design

### 1. Prisma schema (`apps/frontend/prisma/schema.prisma`)

Two models + two enums. Field shapes are fixed by the shared context / Foundations Appendix;
this makes them concrete with types, indexes and FKs.

```prisma
enum RoutineDefinitionStatus {
  DRAFT
  APPROVED
  RETURNED
  EXPIRED
  CANCELLED
}

enum ResponsibleRole {
  Caregiver          // CGs
  Nurse              // NOD
  Other_authorized   // OTH
}

model RoutineEventDefinition {
  id                     String   @id @default(uuid())
  residentId             String
  resident               Resident @relation(fields: [residentId], references: [id], onDelete: Cascade)
  communityId            String?
  community              Community? @relation(fields: [communityId], references: [id], onDelete: SetNull)

  version                Int      @default(1)
  status                 RoutineDefinitionStatus @default(DRAFT)

  // provenance (Rule 2/3/4/5 — retained for audit + board badges)
  sourceLocBundleId      String?   // e.g. "LOC4-RT-008"
  sourceAsDomain         String?   // e.g. "AS-11"
  asScore                Int?      // 0..4
  goalId                 String?
  sourceTaskId           String?
  conditionBundleId      String?   // e.g. "DYSPH-01"
  memoryPathwayId        String?   // e.g. "MC-03" — kept SEPARATE from LOC (Rule 20)
  orderRef               String?   // MAR/TAR/diet/therapy order id when orderRequired

  // atomic event definition (Rule 7/12)
  name                   String
  instructions           String
  assistanceLevel        String?   // canonical ASSISTANCE value (NEVER two-person/mechanical)
  supervision            String?
  staffing               String?
  equipment              String?
  technique              String?
  conditionModifier      String?
  responsibleRole        ResponsibleRole @default(Caregiver)

  // schedule (Rule 10)
  frequencyMethod        String    // one of the 8 frequency methods (#1 vocab)
  schedule               Json      // { window?, exactTimes?[], intervalMinutes?, count?, activeHours?, trigger?, temporaryStop? }
  shiftOwner             String?   // Night | Morning | Afternoon (accountability, not a separate plan)
  criticality            String    // Routine | High | Critical

  // completion + escalation (Rule 12/13)
  resultSchemaKey        String    // FK into result_schemas.json
  exceptionSet           Json      // allowed EXCEPTION_REASON values for this event
  escalationTrigger      String?
  escalationPriority     String?   // P1..P4
  escalationRecipient    String?   // role/queue

  // lifecycle (Rule 14/18/19)
  effectiveDate          DateTime?
  reviewDate             DateTime?
  stopDate               DateTime?
  approvedBy             String?
  approvedAt             DateTime?

  // versioning provenance
  supersedesVersion      Int?
  revisionReason         String?
  originalRecommendation Json?     // engine's pre-nurse-edit values (audit)

  createdAt              DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  occurrences            RoutineOccurrence[]

  @@index([residentId, status])
  @@index([residentId, version])
  @@index([status])
  @@index([communityId])
}

model RoutineOccurrence {
  id                   String   @id @default(uuid())
  // occId = `${definitionId}@${careDateISO}@${HHMM}` — the natural key
  occId                String   @unique
  definitionId         String
  definition           RoutineEventDefinition @relation(fields: [definitionId], references: [id], onDelete: Cascade)
  definitionVersion    Int      // PINNED at materialization (Rule 15/18)
  residentId           String
  communityId          String?

  careDate             DateTime // Asia/Manila care day (00:00 local)
  scheduledTime        String   // "HH:MM"
  actualTime           DateTime?
  assignedStaffId      String?

  // controlled-vocab fields — stored SEPARATELY (Rule 12)
  workflowState        String   @default("Upcoming") // WORKFLOW_STATE
  careDeliveryOutcome  String?  // CARE_OUTCOME
  results              Json?
  exceptionReason      String?  // EXCEPTION_REASON
  clinicalFinding      Json?    // CLINICAL_FINDING[] + details
  escalationState      String   @default("Not required") // ESCALATION_STATE
  escalationId         String?

  completionUserId     String?
  completionAt         DateTime?
  corrections          Json?    // append-only (Correction rule; runtime in #5)

  createdAt            DateTime @default(now())

  @@index([residentId, careDate])
  @@index([definitionId])
  @@index([careDate])
  @@index([workflowState])
}
```

Back-relations `routineEventDefinitions RoutineEventDefinition[]` and (optionally)
`routineOccurrences` are added to `Resident` (and `Community` for the definition FK).
`RoutineOccurrence.residentId`/`communityId` are **denormalized** (no FK) so caregiver
"My Shift" queries and community-scoped reads don't need a join — consistent with existing
denormalized clinical rows. `occId` uniqueness is the idempotency guarantee (§5).

#### 1.4 Out-of-session `prisma db push` (MANDATORY manual step)

The dev server holds a lock that makes `prisma generate` EPERM mid-session (memory
`prisma-migration-constraint`). The USER runs this with the dev server **stopped**:

```bash
# 1. stop the Next dev server (release the prisma-generate file lock)
# 2. from apps/frontend:
npx prisma db push          # creates the two tables + enums, regenerates client
npx prisma generate         # (db push usually runs it; explicit for safety)
# 3. restart the dev server
```

`db push` (not `migrate dev`) matches how the repo's other real tables were added and avoids
a stale-migrations-dir conflict (memory `supabase-new-project`). No occurrence/definition
code path may run until this completes — until then the board renders the empty state.

### 2. Draft persistence (`lib/lifecare/routineDefinitions.ts` + POST route)

`assembleRoutine()` (#2) returns `DraftEvent[]`. A thin mapper
`draftEventToDefinitionRow(e, residentId, communityId)` produces a `RoutineEventDefinition`
create-payload (`version:1`, `status:"DRAFT"`, `originalRecommendation` = the engine's raw
proposed values). "Generate draft" for a resident:

1. Load existing definitions for the resident.
2. **Delete** all current `status:"DRAFT"` and `status:"RETURNED"` rows (regenerate replaces
   the unapproved draft) — **never** touch `APPROVED`/`EXPIRED`/`CANCELLED` history.
3. Insert the fresh `DraftEvent[]` as v1 DRAFT rows.

**Dedup vs existing APPROVED** (so regenerate doesn't propose a duplicate of a live event):
the mapper carries a stable `dedupeKey` (residentId + sourceLocBundleId|conditionBundleId +
frequencyMethod + scheduled window) already computed by #2's Rule-8 overlap resolver; if an
APPROVED definition with the same key exists, the drafted row is tagged
`supersedesVersion = <approved.version>` and shown on the board as "revision of existing"
rather than "new". Approving it then follows the versioning path (§6), not a fresh insert.

This is a **dedicated POST** `/api/routine/generate-draft` (not generic `/api/db`) because it
does a multi-row replace transaction + audit; §7.

### 3. Nurse Draft→Review→Approve board (extend `RoutineGeneratorBoard.tsx`)

Keep the resident picker and shell. Replace the read-only `RoutineTimeline` with an editable
review grouped by **shift → scheduled time** in the manual-form shape (Time | Activity | Level
of Assistance | Assisted By). Data source: `useLiveQuery("routine-definitions", { tables:
["RoutineEventDefinition"], query: "f_residentId=…&f_status=DRAFT,RETURNED" })`.

**Per-event card** shows: name, instruction, resolved assistance **display** label
(`ASSISTANCE_DISPLAY`), staffing/equipment/technique chips, `responsibleRole` abbreviation
(CGs/NOD/OTH), schedule summary, criticality pill, and **provenance badges**:

- source LOC bundle id (e.g. `LOC4-RT-008`)
- AS domain + score (e.g. `AS-11 · 3`)
- condition / memory pathway (e.g. `DYSPH-01`, `MC-03` — memory badge visually distinct,
  Rule 20)
- order ref (present/absent)

**Blocking conflicts (must resolve before Approve is enabled):**

- **Assistance conflict (Rule 9)** — event flagged by #2 with conflicting one-/two-person
  recommendations. Nurse must pick the single approved level; `originalRecommendation`
  retains prior/recommended values.
- **Missing-order block (Rule 11)** — `orderRequired` event with no `orderRef`
  (medication/glucose/BP/diet/texture/therapy). Blocked until an order is attached/confirmed.

Blocked events show a red banner and are excluded from the approvable set; the Approve button
is disabled while any exist (Rule 21 "zero unresolved order conflicts").

**Per-event nurse edits** (each field is a simple `updateRecord("routine-definitions", id,
{…})` while the row is DRAFT/RETURNED):

- edit time / window (`schedule.window` or `schedule.exactTimes`)
- change frequency method + interval/count (`frequencyMethod`, `schedule.intervalMinutes`,
  `schedule.count`)
- adjust `assistanceLevel` — on change, if `originalRecommendation.assistanceLevel` unset,
  capture it; require an override reason (stored in `revisionReason`)
- set `supervision` / `staffing` / `equipment` / `technique` / `conditionModifier`
- change `responsibleRole`
- attach / confirm a clinical order (MAR/TAR/diet/therapy) → sets `orderRef`; unresolved keeps
  the event blocked
- confirm condition modifiers / Memory pathway intensity (`memoryPathwayId`,
  `conditionModifier`)
- set `escalationTrigger` + `escalationPriority` (P1–P4) + `escalationRecipient`
- set `effectiveDate` / `reviewDate` / `stopDate` (native `<input type="date">`)
- add override reason (`revisionReason`)

**Add a NEW event not proposed** — "Add event" opens a picker sourced from the Task Library /
LOC bundle (`bundlesForLoc`) / condition pathway / custom (e.g. manual form's "Breathing
Exercise", "Physiotherapy M-W-F"). Creates a DRAFT `RoutineEventDefinition` with
`sourceTaskId`/`sourceLocBundleId` provenance (or `custom`), routed through the same
result-schema + role defaults (`defaultRole`, `schemaFor`).

**Remove / suppress with reason (audited)** — "Suppress" sets the DRAFT row's
`status:"CANCELLED"` (draft never generated, so nothing to retain) **with `revisionReason`**
and a `recordAudit({action:"DELETE", entityType:"routine-definitions", reason})`. It stays
visible in a collapsed "Suppressed" section for the review record.

**Role scope (Dashboard rule)** — the board is Nurse + Care Manager only. Approve/edit/version
controls are never rendered for other roles; unauthorized POSTs are rejected server-side (the
dedicated routes check role) and logged.

### 4. Approval (PIN-signed)

"Approve routine" opens `SignatureModal mode="sign"`. `onSigned` calls the dedicated approve
route for the resident's approvable DRAFT set. Server transaction per definition:

- set `status:"APPROVED"`, `approvedBy` (authenticated user), `approvedAt=now()`,
  `effectiveDate` (nurse-set, defaults to today Asia/Manila if blank).
- audit each via `recordAudit({action:"UPDATE", entityType:"routine-definitions",
  entityId, reason:"approved", residentId, residentName})`.

Rule 14 enforced in code: only `APPROVED` rows are ever eligible for occurrence generation;
DRAFT/RETURNED/EXPIRED/CANCELLED generate nothing. A "Return for revision" action sets
`status:"RETURNED"` (with reason) — also generates nothing.

### 5. Occurrence generation — on-demand idempotent materialization

**Recommended: materialize at first read of a care day**, keyed by `occId`, via a dedicated
route `/api/routine/occurrences?residentId=…&careDate=YYYY-MM-DD` (or shift/community scope
for caregiver "My Shift"). Logic:

1. Resolve `careDate` in Asia/Manila (reuse careDay helper).
2. Load `APPROVED` definitions for the resident where
   `effectiveDate <= careDate` AND (`stopDate` is null OR `careDate <= stopDate`)
   AND (`reviewDate` is null OR not past-expiry — see §6).
3. Expand each definition's `schedule` into concrete `HH:MM` occurrences (reuse #1/#2
   `highFrequency.ts` expansion for interval/while-awake/times-per-shift; exact-times and
   defined-window map directly). **Trigger-based/PRN generate NO scheduled occurrence**
   (created on demand in #4).
4. For each, compute `occId = ${definitionId}@${careDateISO}@${HHMM}` and **`upsert` by
   `occId`** with `definitionVersion` pinned from the definition. Upsert = idempotent: a
   second read of the same day creates nothing new and **never overwrites** an occurrence that
   already has a completion/outcome (upsert `update` clause is empty for closed rows).
5. Return the day's occurrences.

**Why on-demand, not a cron** (tradeoff, per Ponytail + repo style): the repo is
derive-then-persist (`routine_completions`, `care_plan_drafts` are lazily written). A cron
adds an always-on job, a scheduling window, and a failure mode where a resident admitted /
approved mid-day has no rows until the next tick. On-demand materialization guarantees the day
is materialized exactly when someone opens it, is naturally idempotent via the `occId` unique
key, and needs no infra. **Ceiling:** a care day is only materialized once someone reads it —
acceptable because the caregiver dashboard (#4) *is* that reader every shift; if a future
report needs pre-materialized rows for unopened days, add a nightly job that calls the same
materializer (the logic is shared, so the cron is a thin wrapper).
`ponytail: on-demand materialize; add a nightly wrapper only if unopened-day reporting needs it.`

Rule 15 acceptance ("all occurrences cover 00:00–23:59 without duplicate IDs") is guaranteed
by the `occId` unique constraint + deterministic HH:MM expansion.

### 6. Versioning + lifecycle (Rules 18, 19; revision / discontinuation)

**Revision of an APPROVED definition** (`/api/routine/revise`):

1. The nurse edits a live event → this **does not mutate** the APPROVED row. Instead:
   - insert a NEW `RoutineEventDefinition` with `version = prev.version + 1`,
     `status:"DRAFT"`, `supersedesVersion = prev.version`, `revisionReason`, the edited fields,
     and a fresh `originalRecommendation` snapshot of the prior approved values.
   - the new version follows the normal approve path (§4) → on approval, its `effectiveDate`
     is the revision effective time; the prior version is set `status:"EXPIRED"` as of that
     date (or kept APPROVED with `stopDate` = new effectiveDate − 1 day; EXPIRED is cleaner).
2. **Future occurrences** (careDate ≥ new effectiveDate) materialize from the new version.
   **Historical occurrences keep their `definitionVersion` UNCHANGED** — never re-materialized,
   never rewritten (Rule 18 / Dashboard "Care-plan revision"). The pinned `definitionVersion`
   on each occurrence is what makes past charting immutable.

**Stop / review expiry (Rule 19):** the materializer (§5 step 2) excludes definitions past
`stopDate`. A definition past `reviewDate` without renewal is flagged for nurse review and its
`status` transitions to `EXPIRED` (queued on the board's "Reviews due" section — reuse the
`CarePlanReviewsBoard` "Reviews Due" pattern). Expired ⇒ generates nothing (Rule 14) — this is
the "temporary post-hospital bundle stops on date unless renewed" acceptance test
(FRAIL-01 has a mandatory stop/review date).

**Discontinuation (Dashboard rule):** `/api/routine/discontinue` sets the definition
`status:"CANCELLED"` with `revisionReason` + authorizer + timestamp. The materializer stops
producing future occurrences; **already-generated future occurrences** (careDate > stopDate)
are marked `workflowState:"Cancelled"` with `exceptionReason:"Authorized cancellation"`;
**past occurrences are retained unchanged**. Audited.

**Correction (Dashboard rule)** — occurrence-level, append-only `corrections` json; the write
path is owned by #5 (runtime execution). Schema support is present here; no UI in #3.

### 7. API routes

Reuse `/api/db/[model]` + `useLiveQuery` for **reads** and **simple DRAFT field edits**
(add `RoutineEventDefinition`/`RoutineOccurrence` to the generic model allowlist, scoped by
role for writes). **Dedicated routes** for transactional/state-changing operations, each
role-gated (Nurse/CM) and audited via `recordAudit`:

| Route | Method | Does |
|---|---|---|
| `/api/routine/generate-draft` | POST | replace unapproved draft for a resident from `assembleRoutine()` (§2) |
| `/api/routine/approve` | POST | PIN-verified; DRAFT→APPROVED + approvedBy/At + effectiveDate (§4) |
| `/api/routine/return` | POST | DRAFT→RETURNED with reason |
| `/api/routine/revise` | POST | create next version DRAFT from an APPROVED definition (§6) |
| `/api/routine/discontinue` | POST | APPROVED→CANCELLED + cancel future occurrences (§6) |
| `/api/routine/occurrences` | GET | idempotent materialize + return a care day (§5) |

Add `routine-definitions` + `routine-occurrences` to `ClientAuditEntity` and the server
`ALLOWED_ENTITIES` allowlist + Audit Trail viewer labels (memory
`audit-trail-caregiver-actions`).

## Out of scope (this sub-project)

- The `assembleRoutine()` algorithm — #2.
- Caregiver "My Shift" / Quick Chart / Complete / Record & Complete UI + typed result gates — #4.
- Escalation runtime, handover, no-silent-rollover enforcement at completion, correction UI,
  P1–P4 nurse-review linkage — #5. (Schema fields exist; runtime is #5.)
- Any change to the legacy `TodaysCareBoard` / bundled-card path — #4 replaces it.

## Testing

**Pure logic self-checks** (assert-based, no DB — Ponytail: one runnable check per non-trivial
module), in `tests/lifecare-routine-persistence.test.ts`:

- **occId keying:** `makeOccId(defId,"2026-09-05","08:00") === "…@2026-09-05@0800"`; two
  different HH:MM produce different ids; same inputs are stable (idempotency precondition).
- **version pinning:** given an occurrence with `definitionVersion:1`, a revision to v2 leaves
  the v1 occurrence's `definitionVersion` unchanged (assert on a pure `applyRevision` helper
  that returns the new-version rows only, never touches historical ones).
- **materialize gate:** `eligibleForCareDay(defs, careDate)` returns only APPROVED + effective
  + not-past-stop; a DRAFT/RETURNED/EXPIRED/CANCELLED def yields zero occurrences (Rule 14).
- **stop-date expiry:** a temporary def with `stopDate < careDate` yields nothing (Rule 19,
  FRAIL-01 post-hospital case).
- **schedule expansion:** "6 times while awake" → 6 distinct `HH:MM` (Rule 10/15); exact-times
  8:00+8:00 PM → 2 occurrences; trigger-based → 0 scheduled.
- **assistance never staffing:** a revised def cannot set `assistanceLevel` to a two-person /
  mechanical string (guard rejects; routes to staffing/equipment via `parseSupport`).

**Integration notes** (manual, post `db push`): generate draft → board shows grouped events
with provenance badges; a missing-order med event blocks Approve; PIN-approve → occurrences
materialize on next `/api/routine/occurrences` read; revise an approved event → yesterday's
occurrence unchanged, today+ uses new version; discontinue → no new future occurrences, past
retained.

## Risks / provisional values

- **Grace/window + exact shift boundaries** are provisional (Shift Rules: Night 10PM–6AM,
  Morning 6AM–2PM, Afternoon 2PM–10PM); tune `schedule.activeHours` + grace to the approved
  roster. `ponytail: config knob, tune to SOP.`
- **EXPIRED-on-review transition** — auto-expiring at `reviewDate` vs. only flagging for review
  is a policy choice; spec auto-expires (safest: nothing silently continues, Rule 19). Confirm
  with SOP whether a grace window before expiry is wanted.
- **On-demand materialization ceiling** — unopened care days are not pre-generated (§5);
  acceptable given the caregiver dashboard reads every shift. Nightly wrapper is the upgrade.
- **`db push` is manual + out-of-session** — until the user runs it, the board is empty; the
  spec must not assume the tables exist at build time (guard reads with the generic route's
  existing "unknown model" empty-state).

## Acceptance criteria (workbook Acceptance Tests for Rules 14, 15, 18, 19)

1. **Rule 14** — Only `APPROVED` + effective definitions appear on the caregiver dashboard;
   Draft / Returned / Expired / Cancelled generate zero occurrences.
2. **Rule 14** — Approval stores approver, timestamp, effective date and review/stop date.
3. **Rule 15** — All scheduled occurrences for a resident cover 00:00–23:59 with **no
   duplicate `occId`**; every occurrence stores its `definitionVersion`.
4. **Rule 18** — Editing an approved routine creates a new version; **past records remain
   unchanged** after the revision (historical `definitionVersion` immutable). Reason, effective
   time, approver and superseded version stored.
5. **Rule 19** — A temporary post-hospital bundle (FRAIL-01) **stops on its stop date unless
   actively renewed**; expired events do not silently continue.
6. **Dashboard / Discontinuation** — no new occurrences generate after the stop date; past
   records retained; cancellation reason + authorizer audited.
7. **Rule 9 / 11 (board gate)** — a conflicting one-/two-person assistance event, or an
   order-required event with no order, **blocks Approve** until resolved.
8. **Role scope** — caregivers cannot approve or alter the clinical plan; nurse/CM only;
   unauthorized writes rejected + logged.
9. Two Prisma models + two enums exist; `npx prisma db push` documented as the out-of-session
   step; audit allowlist updated.
10. Pure versioning/generation self-checks pass without a DB.
