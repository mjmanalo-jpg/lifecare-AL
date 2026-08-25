# 14-Domain Daily Monitoring, Trends & Escalation Triggers — Design

**Date:** 2026-08-25
**Branch:** `feat/domain-monitoring-triggers`
**Status:** Design (awaiting review)

## Problem

A resident's need for a private caregiver (or a Level-of-Care change) is not
declared up front — it must emerge from evidence. The 14 scored assessment
domains (`AS-01…AS-14`) are only scored during the *periodic* assessment. Between
assessments there is no structured daily signal on those same domains, so a
resident whose Safety, Cognition, Behavior, etc. is drifting is not caught until
the next full assessment.

The Vitals Trend tab already trends *physiological* daily-round signals (vitals,
pain, sleep, bowel, urine, edema, mood, mobility, meal) but not the 14 assessment
domains, and nothing turns a worsening trend into an escalation.

## Goal / Acceptance

1. Nurse/Care Manager can record a **0–4 score for each of the 14 domains, per
   resident, per shift (AM/PM/NOC)**, with carry-forward pre-fill.
2. The **14 domains trend over time** in the Vitals Trend tab, alongside vitals.
3. A **trigger fires** when a domain shows a discrepancy (four rules below).
4. A trigger opens an **escalation ladder**: notify → nurse manages/escalates →
   a series of managed observations accumulates → on **persistence** the case
   calls for a **Level of Care review** (full re-assessment — all questions again).
5. Migration-free (no new DB models), consistent with the existing clinical suite.

## Non-goals (YAGNI)

- No new Prisma models / migrations — all state in app-settings JSON.
- No backend cron initially. Triggers evaluate on capture-save (client), matching
  how sibling boards notify on write. A nightly sweep can be added later if a
  discrepancy must fire without a save.
- No per-domain configurable thresholds — fixed, tunable constants in the lib.
- No change to the periodic assessment instrument itself.

## Domain vocabulary

The 14 scored domains and their 0–4 anchors are **reused verbatim** from the
existing `apps/frontend/src/lib/lifecare/data/assessment_domains.json`
(`scored: true` entries; `NS-01` is non-scored and excluded). No new domain
definitions are introduced.

## Data model (migration-free)

Two new app-setting keys (JSON arrays), following the `adl_logs` pattern in
`ADLMonitoringBoard`:

### `domain_logs` — the per-shift scores (the trend + trigger source)

One row per `resident × date × shift` (upsert by that composite):

```ts
interface DomainLog {
  id: string;
  residentId: string;
  date: string;           // YYYY-MM-DD
  shift: "AM" | "PM" | "NOC";
  scores: Partial<Record<DomainCode, 0|1|2|3|4>>;  // AS-01 … AS-14
  by: string;             // clinician name
  at: string;             // ISO timestamp
}
```

Upsert (not append) per shift, so re-saving a shift edits in place.

### `domain_observations` — the monitoring cases (the escalation ladder)

One open case per `resident × domain`, opened on first discrepancy, closed on
resolve:

```ts
type CaseStatus = "OPEN" | "MANAGING" | "LOC_REVIEW_DUE" | "RESOLVED";

interface DomainCase {
  id: string;
  residentId: string;
  domain: DomainCode;
  status: CaseStatus;
  openedAt: string;              // ISO
  occurrences: {                 // the "series of observations"
    date: string; shift: string; score: number; reasons: TriggerReason[];
  }[];
  managementNotes: { at: string; by: string; note: string }[];
  escalatedAt?: string;
  locReviewDueAt?: string;       // when status flipped to LOC_REVIEW_DUE
  locReviewOpenedAt?: string;    // when the nurse launched the review
  resolvedAt?: string;
  resolvedBy?: string;
}
```

Fired-trigger dedupe: the notification / incident "already fired" markers live on
the `DomainLog` shift row (`notified?: boolean`, `incidentId?: string`) so
re-saving a shift does not re-notify.

## Shared library — `lib/lifecare/domainMonitoring.ts`

Single owner of the domain-monitoring domain logic (pure, unit-tested):

- `SCORED_DOMAINS: { code, name, anchors }[]` — derived from `assessment_domains.json`.
- `DOMAIN_LOGS_KEY = "domain_logs"`, `DOMAIN_CASES_KEY = "domain_observations"`.
- `parseDomainLogs` / `parseDomainCases` (defensive JSON parse, like `parseLogs`).
- `shiftNow()` / `today()` (reused pattern from ADLMonitoringBoard).
- `baselineFor(residentId, assessmentsV42): Partial<Record<DomainCode, number>>`
  — latest COMPLETED/VALIDATED assessment's `domains[code].score`. Same source
  `PrivateCaregiverBoard` / `CareAcuityBoard` already read.
- **`evaluateDomainTriggers(residentId, logs, baseline): DomainTrigger[]`** — the
  money function. For each domain, over the resident's recent logs:
  - **R1 worse-than-baseline:** any shift score ≥ `baseline[code] + 1`.
  - **R2 worsening-trend:** score rises and holds (+1 sustained across the last
    2–3 days vs the prior window).
  - **R3 high-absolute:** any shift score ≥ 3.
  - **R4 intra-day-swing:** same date, `max(shiftScores) − min(shiftScores) ≥ 2`.
  Returns `{ domain, reasons: TriggerReason[], latestScore, severity }`.
- **`advanceCase(existingCase, trigger, today): DomainCase`** — case lifecycle:
  - none + trigger → `OPEN` with first occurrence.
  - existing + new trigger day → append occurrence; `OPEN`→`MANAGING` once a
    management note exists.
  - **persistence gate → `LOC_REVIEW_DUE`** when occurrences span **≥3 distinct
    days** OR case age **≥5 days** while still tripping.
  - management note added → `MANAGING` (unless already `LOC_REVIEW_DUE`).
  - nurse resolve → `RESOLVED`.

Thresholds are exported constants (`WORSE_DELTA = 1`, `ABS_SEVERE = 3`,
`SWING = 2`, `PERSIST_DAYS = 3`, `PERSIST_AGE_DAYS = 5`, `INCIDENT_SCORE = 4`).

## Capture — new tab `domainmonitoring` (Nurse + Care Manager)

`DomainMonitoringBoard.tsx`, modeled on `ADLMonitoringBoard`:

- Resident picker → shift selector (defaults to `shiftNow()`).
- **14-domain 0–4 grid**, each row: domain name, a 0–4 segmented control,
  **pre-filled (carry-forward) from the last recorded score** for that resident,
  the assessment **baseline** shown for reference, and the anchor text as a
  tooltip/help for the selected score.
- Save → upsert `domain_logs`, then run `evaluateDomainTriggers` + `advanceCase`
  and fire actions (below).
- A compact **Monitoring Cases** panel lists this community's open cases with
  status chip, occurrence count, age, inline **Add management note / Escalate /
  Resolve**, and the **Call for LOC review →** CTA when `LOC_REVIEW_DUE`.

## Trends — added into the existing Vitals Trend tab

`VitalsTrendBoard.tsx` (additive only):

- New **"Domain Monitoring (14)"** section below the current cards.
- 14 trend cards reusing the existing dependency-free `LineChart` / `OtherTrendCard`
  shape, one per domain, 0–4 scale, **baseline drawn as the band** (at/below
  baseline = ok; above = out-of-range styling).
- Points are joined from `domain_logs` by `residentId` (+ date/shift), same
  join-by-resident approach as the existing domain cards.
- Each card shows the domain's **case state chip** when a case is open:
  `⚠ Discrepancy → Managing (n obs) → LOC review due`, with the reason text and,
  when `LOC_REVIEW_DUE`, the **Re-assess (LOC review) →** CTA deep-linking to
  `/{role}/careacuity?resident=…&reason=locreview` (same deep-link mechanism the
  PCG flow uses via `openAssessment`).

## Trigger actions (all four)

Fired from capture-save, deduped via markers on the `DomainLog` row / case:

1. **Notify Nurse + CM** — `createRecord("notifications", …)` naming resident +
   domain + what changed + case status. Once per shift row (`notified` marker).
2. **Flag trend card** — computed live in Vitals Trend from the same evaluator;
   no storage.
3. **Prompt LOC review** — gated behind the persistence ladder (only when the
   case is `LOC_REVIEW_DUE`); surfaced as the CTA above. This is the only path
   that opens the full re-assessment.
4. **Raise Incident** — acute safety-net only: a single shift score = 4 →
   `createRecord("incidents", …)`, one per resident/domain/day
   (`incidentId` marker), independent of the ladder.

## Escalation ladder (the core flow)

```
shift score saved
   └─ evaluateDomainTriggers → discrepancy?
        ├─ no  → nothing
        └─ yes → notify Nurse+CM · flag card · open/append case (OPEN)
                    └─ nurse manages (note / escalate) → MANAGING
                        └─ persists ≥3 days OR case ≥5 days still tripping
                              → LOC_REVIEW_DUE → "Call for LOC review →"
                                   → opens full assessment (all 14 domains)
                    └─ returns to baseline → nurse Resolves → RESOLVED
        └─ (parallel) single score = 4 → raise Incident (safety-net)
```

## Registration

- `roleConfig.ts`: `ROUTE_TO_TAB` entry `domainmonitoring` + Nurse & CM
  `sidebarLinks` (Resident Care group).
- `NursePortalContent.tsx` + `CareManagerPortalContent.tsx`: route
  `domainmonitoring` → `DomainMonitoringBoard`.
- Vitals Trend already registered; edits are additive.

## Files

| Action | File |
|--------|------|
| new | `src/lib/lifecare/domainMonitoring.ts` |
| new | `tests/domainMonitoring.test.ts` (evaluator + case lifecycle) |
| new | `src/components/portal/views/clinical/DomainMonitoringBoard.tsx` |
| edit | `src/components/portal/views/clinical/VitalsTrendBoard.tsx` |
| edit | `src/constants/roleConfig.ts` |
| edit | `src/components/portal/views/NursePortalContent.tsx` |
| edit | `src/components/portal/views/CareManagerPortalContent.tsx` |

## Testing

- `domainMonitoring.test.ts` asserts each of the 4 trigger rules independently
  (positive + negative), the baseline read, and the case lifecycle transitions
  including the persistence gate (≥3 days and ≥5-days-open both flip to
  `LOC_REVIEW_DUE`; management note → `MANAGING`; resolve → `RESOLVED`).
- Manual: capture a shift that trips each rule; verify notification, card flag,
  case progression across simulated days, LOC-review CTA opens the assessment,
  and severe (4) raises one incident.

## Risks / ceilings

- **Client-fired triggers**: a discrepancy only fires when a shift is saved. If a
  resident is simply not scored, nothing fires (correct — no data, no signal). A
  nightly cron sweep is the upgrade path if "should have been scored" alerting is
  needed.
- **Dedupe by shift row**: editing a shift's scores re-evaluates; markers prevent
  duplicate notifications/incidents for the same shift, but a genuinely new
  discrepancy on edit will (correctly) fire.
- **Thresholds are provisional** (baseline+1, ≥3 severe, swing≥2, 3-day/5-day
  persistence) — tune to the LifeCare SOP once confirmed.
