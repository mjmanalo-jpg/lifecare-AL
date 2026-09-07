# High-Frequency Routine Occurrences — Design

**Date:** 2026-09-04
**Status:** Approved design → ready for implementation plan
**Scope:** SLMS v4.2 "High-Frequency Tasks" — Scope B, core clinical trio

## Goal

The SLMS v4.2 spec's **High-Frequency Tasks** sheet requires "one approved
intervention, multiple auditable occurrences": tasks like repositioning every
2 hours or toileting every 2 hours while awake must generate **many separate
timed occurrences** across the care day, each individually charted with its own
scheduled time and shift.

Today the app generates **one bundled checklist item per window** — a
high-frequency task appears once, not as N timed occurrences. This design adds
deterministic, migration-free occurrence generation for the three
clinically-important high-frequency domains, rendered inside the existing
Today's Care windows and gated per occurrence.

## Decisions (locked during brainstorming)

1. **Methods (v1):** the core clinical trio — `fixed_interval`, `while_awake`,
   `times_per_shift`. Defer completion-based, PRN/trigger, exact-times, temporary.
2. **Frequency source:** auto-seeded from spec domain defaults. No per-task UI in v1.
3. **Generation model:** deterministic **on-the-fly** (Approach ①). No schema
   change, no cron. Occurrences derived each render, exactly like `generateRoutine`.
4. **Activation:** by **score threshold** — a domain's high-frequency schedule
   activates only when its assessed score is high enough; below threshold it
   renders as today (single window item).

## Background — the three v1 methods (from the spec)

| Method | Example | Generation rule |
|---|---|---|
| `fixed_interval` | Reposition every 2h | Fixed clock times; late completion does NOT shift the next time. |
| `while_awake` | Toileting q2h while awake | Only within approved waking hours (e.g. 06:00–22:00); do not wake at night. |
| `times_per_shift` | Offer hydration 3× per shift | Generate N occurrences spread within each shift window. |

Shift windows (spec Shift Rules): **Night 22:00–06:00 · Morning 06:00–14:00 ·
Afternoon 14:00–22:00**. Care day is 00:00–23:59 local (Asia/Manila).

Audit invariants (spec): each occurrence retains scheduled + actual time,
result, exception, escalation; **no silent rollover** (a missed occurrence
stays a missed record; the next generates independently); a late completion
never moves the next scheduled time.

## Design

### 1. Frequency config (data)

New `apps/frontend/src/lib/lifecare/data/high_frequency.json`, one entry per
high-frequency domain, seeded from the Domain-Level Map / High-Frequency Tasks
worked example. Values are **provisional** — tune to clinical SOP.

```jsonc
{
  "AS-11": { "method": "fixed_interval",  "intervalHours": 2, "minScore": 3, "label": "Reposition / off-load" },
  "AS-10": { "method": "while_awake",     "intervalHours": 2, "wakeStart": 6, "wakeEnd": 22, "minScore": 3, "label": "Toileting" },
  "AS-08": { "method": "times_per_shift", "perShift": 3, "minScore": 3, "label": "Offer hydration" }
}
```

- `minScore` (provisional = 3, matching the map's "frequent / high-frequency"
  language at scores 3–4) is the activation threshold. Score < `minScore` →
  the domain keeps its normal single bundled item; score ≥ `minScore` → the
  high-frequency schedule replaces the bundled item for that domain.
- Kept as a JSON constant (migration-free), loaded like the other
  `lib/lifecare/data/*.json` rule tables.

### 2. Occurrence generator (pure)

New `apps/frontend/src/lib/lifecare/highFrequency.ts`:

```ts
export interface HFOccurrence { time: string; minutes: number; shift: RoutineShift; text: string; domainCode: string; occId: string; }
export function expandOccurrences(domainCode: string, freq: HFConfig, careDayISO: string): HFOccurrence[]
```

Rules (all deterministic from `careDayISO` — no `Date.now()`/random):

- **fixed_interval:** times at `00:00, +interval, …` across `[0, 24)`.
- **while_awake:** times at `wakeStart, +interval, …` while `< wakeEnd`.
- **times_per_shift:** for each of the 3 shift windows, place `perShift`
  occurrences evenly inside the window. Deterministic rule: for a window of
  length `L` minutes and `n` occurrences, occurrence `i` (1..n) is at
  `windowStart + round(L * i / (n + 1))` (interior points, never on the boundary).
  Night wraps midnight (22:00–06:00) — split handling documented in code.
- `occId = `${domainCode}@${time}`` — stable within a care day; used as the
  completion key and item id.

Self-check (assert-based `demo()` in the module): reposition q2h → 12
occurrences at even hours; toileting while-awake 06–22 q2h → 9 occurrences
(06,08,…,22); hydration 3×/shift → 9 total, 3 per shift, none on a boundary.

### 3. Integration into `generateRoutine` / the board

In `carePlanRoutine.ts` (or a thin wrapper the board calls):

- For each plan domain that is **high-frequency AND score ≥ minScore**:
  - **Remove** that domain from its normal bundled interventions (so it is not
    double-counted in the windows it used to join).
  - **Expand** its occurrences via `expandOccurrences`.
  - **Place** each occurrence into the existing routine window whose
    `[startMin, endMin)` contains `occurrence.minutes`. It renders as a
    `RoutineTaskItem` labelled `"<label> · HH:MM"` with a stable `occId`.
- Domains below threshold, and all non-HF domains, are unchanged.

Result: no new UI surface — occurrences appear as timed checklist rows inside
the same `EncounterCard`s, mixed with the window's other tasks.

### 4. Per-occurrence gating

The time-window gate shipped in `TodaysCareBoard` locks/unlocks by **window**
time. High-frequency items need finer control keyed to the **occurrence's**
scheduled time:

- `locked` until `scheduledTime − 5 min` (same lead as windows).
- chartable from then through `scheduledTime + grace`.
- `late` after `scheduledTime + grace` (grace provisional = 30 min; the spec's
  "criticality and grace period" — tune later).

An item carries an optional `scheduledMinutes`; when present, the gate uses it
instead of the window bounds. Non-HF items keep window-level gating unchanged.
This satisfies "late doesn't move the next time" and "no silent rollover" for
free — times are derived per care day, so a missed 02:00 stays 02:00 and 04:00
is generated independently.

### 5. Charting, audit & counting

- Charting is **unchanged**: each occurrence charts its own `CareEvent` via the
  existing `/api/care-events` route; completion persists in the existing
  `routine_completions` app-setting keyed by `careDay|resident|occId`.
- Late completions reuse the existing late flag (keyed to the occurrence time).
- Window `doneCount/total` counts include the occurrences placed in that window.

### 6. Caregiver "Open Routine" display (Today's Care)

The CG opens a resident's routine (`CaregiverShiftBoard` → `TodaysCareBoard`,
`role="CAREGIVER"`, embedded). Every care task must be shown with its **Shift ·
Time Window · Care Event** context. This is done at the **care-event group**
level (one header per event, tasks listed under it), matching the spreadsheet —
which times at the care-event row level, not per individual task.

```
CAREGIVER QUEUE
┌───────────────────────────────────────────────┐
│ Wake-up, orientation, hygiene and dressing  0/6│ ← Care Event (+ done/total)
│ Morning · 06:00–08:00 · Caregiver              │ ← Shift · Time Window · Role
│   • Provide approved setup / cueing   [Complete]│ ← task (inherits header time)
│   • Use effective communication…      [Complete]│
│   • Observe skin, pain and function   [Complete]│
└───────────────────────────────────────────────┘
┌───────────────────────────────────────────────┐
│ Repositioning / comfort                     0/1│
│ Night · 02:00–04:00 · Caregiver                │
│   • Reposition / off-load · 02:00     [Complete]│ ← HF occurrence: exact time on row
└───────────────────────────────────────────────┘
```

Rules:

- **Every care task appears under a care-event card whose header shows
  `Shift · Time Window · Event`.** So the caregiver always sees which shift,
  time window and care event a task belongs to — via its group header.
- The header time is shown **once per event group**, not repeated on each task
  row (matches the spreadsheet's care-event-level timing).
- **High-frequency occurrences** additionally carry their **exact clock time on
  the task row** (`<label> · HH:MM`), because each is a discrete scheduled
  occurrence with its own per-occurrence gate (§4).
- This is the existing `EncounterCard` layout — no structural change; HF adds
  timed rows and the row-level time label.

**Deferred alternative (offered, not selected):** repeating the full
`Shift · time · event` string inline on every individual task row instead of
the group header. Not chosen for v1 — redundant with the grouped header and
divergent from the spreadsheet's care-event-level timing. Revisit only if
caregivers ask for per-row repetition.

## Files touched

| File | Change |
|---|---|
| `lib/lifecare/data/high_frequency.json` | **new** — frequency config per HF domain |
| `lib/lifecare/highFrequency.ts` | **new** — `expandOccurrences` + config loader + `demo()` self-check |
| `lib/lifecare/carePlanRoutine.ts` | expand HF domains into timed occurrences; remove them from bundled interventions |
| `components/portal/views/clinical/TodaysCareBoard.tsx` | per-occurrence gating (use `scheduledMinutes` when present); timed item label |

No schema change. No API change. No cron.

## Out of scope (YAGNI)

- Completion-based interval, trigger/PRN, exact-scheduled-times, temporary
  (stop-date) methods.
- Per-intervention frequency editor in the Care Plan Builder.
- Persisted occurrence rows / server-side overdue dashboards (occurrences are
  derivable; graduate to a `CareEvent.scheduledTime` column later if needed).
- Score-scaled intervals (score → interval table) — v1 uses one interval per
  domain above threshold.

## Testing

- `highFrequency.ts` ships an assert-based `demo()` self-check (counts + no
  boundary placement + while-awake night exclusion).
- Manual: a resident scored AS-11=3 shows reposition occurrences every 2h in
  the correct windows on Today's Care; each gates by its own time and charts
  independently; a low-score resident is unchanged.

## Risks / provisional values

- **Intervals and `minScore` are provisional** (grounded in the Domain-Level
  Map's "frequent/high-frequency" language but not exact clock values in the
  map). Kept in one JSON file for easy SOP tuning.
- **Grace period** (30 min) is provisional per the spec's criticality note.
- **Night `times_per_shift` wrap** (22:00–06:00 crosses midnight) needs careful
  minute math; covered by the self-check.
