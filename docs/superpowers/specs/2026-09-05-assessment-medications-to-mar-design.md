# Structured Medications: Assessment → Admission → MAR — Design

**Date:** 2026-09-05
**Status:** Approved design → ready for implementation
**Scope:** Structured medication capture in the Resident Assessment, shared with
Admission, auto-flowing into each resident's MAR.

## Goal

Today the Resident Assessment v4.2 captures **Current Medications** as a single
free-text box (`layer1.medications: string`). The client wants:

1. A **structured** medication list — name / dose / frequency (dropdown) + a
   **"Requires vitals before administration"** toggle, matching the Admission
   Medications editor.
2. Medications entered in the assessment **auto-reflect in the admission form**.
3. Those medications **auto-create real `Medication` records** so they appear in
   each resident's **MAR** — idempotently and safely (no duplicates, no
   unreviewed meds silently going live).

## Decisions (locked)

- **Frequency** is a dropdown reusing MAR's `FREQUENCIES` list.
- **Vitals-first** stored migration-free in the existing `med_vitals_required`
  app-setting — no schema change.
- **MAR safety gate:** `medicationListReviewed === "Yes"` → create **ACTIVE**
  (live in MAR); otherwise → **PENDING** (visible in MAR, nurse must approve).
- **Idempotency:** upsert by `residentId` + normalized name; a med removed from
  the list is set `DISCONTINUED` (never hard-deleted — preserves MAR history).
- **No Prisma migration** — reuse existing `Medication` model + `med_vitals_required` app-setting.

## What already exists (reused)

- `Medication` model: `name, dosage, frequency, route, status (ACTIVE|PENDING|…),
  residentId, startDate`. Created via `createRecord("medications", {...})`.
- MAR (`MARDailyBoard`) shows meds with status **ACTIVE or PENDING** and derives
  dose times from `frequency`. Vitals-first via `med_vitals_required` app-setting
  (`{ [medId]: boolean }`, `saveVitalsFlag`).
- `FREQUENCIES` const in `MARDailyBoard` (also drives dose-time derivation).
- Admission (`AdmissionsContent`) already parses `layer1.medications` into
  `MedRow[]` = {name, dose, frequency}.

## Design

### 1. Shared data shape

Add a structured field to `AssessmentLayer1` (keep the old string for back-compat):

```ts
export interface MedItem { name: string; dose?: string; frequency?: string; instructions?: string; requiresVitals?: boolean }
// AssessmentLayer1:
medicationList?: MedItem[];   // structured (new, authoritative)
medications?: string;         // legacy free-text — parsed into medicationList on read
```

Read helper `medItemsOf(layer1)`: returns `medicationList` if present, else parses
the legacy `medications` string into `MedItem[]`. Assessment and Admission both
read/write `medicationList`, so they auto-reflect through the same field.

### 2. Shared `<MedicationsEditor>` component

New `components/portal/views/clinical/MedicationsEditor.tsx`:
- Rows of: **name** (text) · **dose** (text) · **frequency** (`<select>` from the
  shared `FREQUENCIES`) · **Special Instructions** (text, e.g. "Take with food,
  monitor BP") · **Requires vitals before administration** (checkbox) · remove (trash).
- "+ Add medication" appends a blank row. `value: MedItem[]` / `onChange`.
- Extract `FREQUENCIES` to `lib/lifecare/medFrequencies.ts`; `MARDailyBoard` and
  the editor both import it (single source).

Used in:
- **Assessment Layer 1** (`ResidentAssessmentV42`) — replaces the free-text
  Current Medications box.
- **Admission** (`AdmissionsContent`) — replaces its inline meds rows, bound to
  the same `medicationList`.

### 3. Sync into MAR — `syncMedicationsToMar`

New `lib/lifecare/medSync.ts`:

```ts
async function syncMedicationsToMar(opts: {
  residentId: string; items: MedItem[]; reviewed: boolean;
  existing: MedicationRow[]; actorName?: string;
}): Promise<void>
```

Rules:
- A `Medication` needs a `residentId`, which a **pre-admission** assessment lacks.
  So sync runs only when the resident exists and the record is finalized:
  **on admission completion** and **on reassessment validate for an
  already-admitted resident**.
- For each `MedItem` (name non-empty): find an existing `Medication` for this
  resident with the same normalized name.
  - none → `createRecord("medications", { residentId, name, dosage: dose,
    frequency, route: "oral", sideEffects: instructions, status: reviewed ? "ACTIVE" : "PENDING",
    startDate: now })`, then `saveVitalsFlag(newId, requiresVitals)`. (Special
    Instructions map to `Medication.sideEffects` — the column MAR's Add-Medication
    modal already uses for its instructions field.)
  - exists → update `dosage/frequency/sideEffects` if changed; if it was
    `DISCONTINUED`, reactivate to the gate status; update its vitals flag.
- Existing ACTIVE/PENDING meds for this resident **not** in the current list →
  set `DISCONTINUED` (soft-remove; MAR history preserved).
- Idempotent: re-running with the same list is a no-op.

### 4. Wiring

- **ResidentAssessmentV42** — render `<MedicationsEditor>` for `medicationList`.
  On **validate**, if the assessment is linked to a real resident, call
  `syncMedicationsToMar` with `reviewed = medicationListReviewed === "Yes"`.
- **AdmissionsContent** — render `<MedicationsEditor>` bound to `medicationList`;
  on **admission completion** (resident created), call `syncMedicationsToMar`.

## Files touched

| File | Change |
|---|---|
| `lib/lifecare/medFrequencies.ts` | **new** — extract `FREQUENCIES` const |
| `components/portal/views/clinical/MedicationsEditor.tsx` | **new** — shared structured editor |
| `lib/lifecare/medSync.ts` | **new** — `syncMedicationsToMar` (idempotent upsert) |
| `lib/lifecare/assessment.ts` | add `MedItem` + `medicationList` to Layer 1; `medItemsOf` helper |
| `components/portal/views/clinical/ResidentAssessmentV42.tsx` | structured editor; sync on validate (if linked) |
| `components/portal/views/AdmissionsContent.tsx` | structured editor bound to `medicationList`; sync on completion |
| `components/portal/views/clinical/MARDailyBoard.tsx` | import `FREQUENCIES` from the shared module |

## Out of scope (YAGNI)

- Frequency → exact MAR clock-time customization (MAR already derives times).
- RxNorm lookup in this editor (MAR's Add-Medication keeps it).
- Physician e-prescribe / approval workflow changes beyond the ACTIVE/PENDING gate.
- Backfilling meds for residents assessed before this change (new/edited records only).

## Safety & correctness

- **No unreviewed med goes live:** unreviewed lists create `PENDING` meds, which
  MAR shows but cannot be administered until a nurse approves — the existing gate.
- **No duplicates:** upsert by residentId + normalized name; re-sync is a no-op.
- **No lost history:** removed meds are `DISCONTINUED`, not deleted.
- **No schema migration:** reuses `Medication` + `med_vitals_required`.

## Testing

- `medSync` unit self-check: create-new, update-changed, discontinue-removed,
  re-run-idempotent, reviewed→ACTIVE vs unreviewed→PENDING.
- Manual: enter meds in an assessment for an admitted resident, validate with
  "reviewed = Yes" → meds appear ACTIVE in that resident's MAR with the vitals
  flag; remove one → it discontinues; re-validate → no duplicates.
