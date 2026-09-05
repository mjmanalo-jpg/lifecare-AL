// Sync structured assessment/admission medications into a resident's MAR.
// Reuses the real Medication model + the med_vitals_required app-setting — no
// schema change. Idempotent: re-running with the same list is a no-op. See
// docs/superpowers/specs/2026-09-05-assessment-medications-to-mar-design.md.

import { createRecord, updateRecord, upsertRecord } from "@/lib/api";
import { VITALS_KEY } from "./medConstants.ts";
import type { MedItem } from "./assessment.ts";

/** The subset of a Medication row this sync reads (from useLiveQuery("medications")). */
export interface MedRow {
  id: string;
  name?: string;
  dosage?: string;
  frequency?: string;
  sideEffects?: string | null;
  status?: string;
}

const norm = (v?: string | null) => (v || "").trim().toLowerCase();

export interface MedSyncPlan {
  creates: MedItem[];
  updates: { id: string; item: MedItem }[];
  discontinues: string[]; // medication ids no longer in the list
}

/**
 * PURE diff — what to create / update / discontinue so the resident's live
 * Medication rows match `items`. Matched by normalized name. A change in
 * dose / frequency / instructions, or a previously DISCONTINUED med reappearing,
 * counts as an update. Live meds (ACTIVE/PENDING) absent from the list are
 * discontinued. No I/O — unit-testable.
 */
export function planMedSync(items: MedItem[], existing: MedRow[]): MedSyncPlan {
  const want = (items || []).filter((m) => (m?.name || "").trim());
  const byName = new Map<string, MedRow>();
  for (const e of existing || []) { const k = norm(e.name); if (k && !byName.has(k)) byName.set(k, e); }
  const wantNames = new Set(want.map((m) => norm(m.name)));

  const creates: MedItem[] = [];
  const updates: { id: string; item: MedItem }[] = [];
  for (const m of want) {
    const e = byName.get(norm(m.name));
    if (!e) { creates.push(m); continue; }
    const changed =
      norm(e.dosage) !== norm(m.dose) ||
      norm(e.frequency) !== norm(m.frequency) ||
      norm(e.sideEffects) !== norm(m.instructions) ||
      e.status === "DISCONTINUED";
    if (changed) updates.push({ id: e.id, item: m });
  }
  const discontinues = (existing || [])
    .filter((e) => (e.status === "ACTIVE" || e.status === "PENDING") && !wantNames.has(norm(e.name)))
    .map((e) => e.id);

  return { creates, updates, discontinues };
}

/**
 * Execute the plan against the DB and the vitals-required app-setting.
 * `reviewed` = medication list confirmed → new/updated meds go ACTIVE, else PENDING.
 * Requires a real `residentId` (a pre-admission assessment has none yet, so the
 * caller only invokes this once the resident exists).
 */
export async function syncMedicationsToMar(opts: {
  residentId: string;
  items: MedItem[];
  reviewed: boolean;
  existing: MedRow[];
  vitalsMap: Record<string, boolean>;
  actorName?: string;
}): Promise<{ created: number; updated: number; discontinued: number }> {
  const { residentId, items, reviewed, existing, vitalsMap, actorName } = opts;
  if (!residentId) return { created: 0, updated: 0, discontinued: 0 };

  const plan = planMedSync(items, existing);
  const status = reviewed ? "ACTIVE" : "PENDING";
  const nowIso = new Date().toISOString();
  const nextVitals: Record<string, boolean> = { ...(vitalsMap || {}) };
  let vitalsTouched = false;

  for (const m of plan.creates) {
    const res = await createRecord("medications", {
      residentId,
      name: (m.name || "").trim(),
      dosage: (m.dose || "").trim(),
      frequency: (m.frequency || "").trim(),
      route: "oral",
      sideEffects: (m.instructions || "").trim() || null,
      status,
      startDate: nowIso,
      submittedByName: actorName || undefined,
    });
    const id = String((res as { data?: { id?: string }; id?: string })?.data?.id ?? (res as { id?: string })?.id ?? "");
    if (id && m.requiresVitals) { nextVitals[id] = true; vitalsTouched = true; }
  }

  for (const u of plan.updates) {
    await updateRecord("medications", u.id, {
      dosage: (u.item.dose || "").trim(),
      frequency: (u.item.frequency || "").trim(),
      sideEffects: (u.item.instructions || "").trim() || null,
      status,
    });
    const want = !!u.item.requiresVitals;
    if (want !== !!nextVitals[u.id]) { nextVitals[u.id] = want; vitalsTouched = true; }
  }

  for (const id of plan.discontinues) {
    await updateRecord("medications", id, { status: "DISCONTINUED" });
  }

  // Persist the vitals-required map once (merged), only if it changed.
  if (vitalsTouched) {
    await upsertRecord("app-settings", VITALS_KEY, { key: VITALS_KEY, value: JSON.stringify(nextVitals) });
  }

  return { created: plan.creates.length, updated: plan.updates.length, discontinued: plan.discontinues.length };
}

// ── Self-check ────────────────────────────────────────────────────────────────
// Runnable assertion of the PURE planner. Not imported by the app.
export function demo(): void {
  const assert = (c: boolean, m: string) => { if (!c) throw new Error(`medSync demo: ${m}`); };
  const existing: MedRow[] = [
    { id: "1", name: "Metformin", dosage: "500mg", frequency: "Twice daily (BID)", status: "ACTIVE" },
    { id: "2", name: "Aspirin", dosage: "81mg", frequency: "Once daily (OD)", status: "ACTIVE" },
  ];

  // New med + a changed dose (case-insensitive name match), nothing removed.
  let p = planMedSync([
    { name: "Metformin", dose: "500mg", frequency: "Twice daily (BID)" },
    { name: "aspirin", dose: "100mg", frequency: "Once daily (OD)" },
    { name: "Lisinopril", dose: "10mg", frequency: "Once daily (OD)" },
  ], existing);
  assert(p.creates.length === 1 && p.creates[0].name === "Lisinopril", "creates new only");
  assert(p.updates.length === 1 && p.updates[0].id === "2", "updates changed dose");
  assert(p.discontinues.length === 0, "nothing removed");

  // Idempotent: identical list → no-op.
  p = planMedSync([
    { name: "Metformin", dose: "500mg", frequency: "Twice daily (BID)" },
    { name: "Aspirin", dose: "81mg", frequency: "Once daily (OD)" },
  ], existing);
  assert(p.creates.length === 0 && p.updates.length === 0 && p.discontinues.length === 0, "idempotent no-op");

  // Remove Aspirin → discontinue id 2.
  p = planMedSync([{ name: "Metformin", dose: "500mg", frequency: "Twice daily (BID)" }], existing);
  assert(p.discontinues.length === 1 && p.discontinues[0] === "2", "discontinue removed");

  // Reappearing (previously discontinued) med → update (reactivate).
  p = planMedSync(
    [{ name: "Vitamin D", dose: "1000IU", frequency: "Once daily (OD)" }],
    [{ id: "9", name: "Vitamin D", dosage: "1000IU", frequency: "Once daily (OD)", status: "DISCONTINUED" }],
  );
  assert(p.updates.length === 1 && p.updates[0].id === "9" && p.discontinues.length === 0, "reactivate discontinued");

  // Instructions change is detected.
  p = planMedSync([{ name: "Aspirin", dose: "81mg", frequency: "Once daily (OD)", instructions: "with food" }], existing);
  assert(p.updates.length === 1 && p.updates[0].id === "2", "instructions change detected");
}
