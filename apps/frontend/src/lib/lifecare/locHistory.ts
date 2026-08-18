// Per-resident Level of Care (LOC) history — a durable, chronological record of
// every level a resident has been assigned, from pre-admission through each
// reassessment. Migration-free: a JSON array in the app-setting `loc_history`.
// Appended (never mutated) whenever a Final LOC is set/changed, so the full
// trail is preserved for audit and care-continuity.

import { createRecord } from "@/lib/api";

export const LOC_HISTORY_KEY = "loc_history";

export type LocSource = "PRE_ADMISSION" | "REASSESSMENT" | "ACUITY_APPROVAL" | "CLINICAL_OVERRIDE";

export const LOC_SOURCE_LABEL: Record<LocSource, string> = {
  PRE_ADMISSION: "Pre-Admission",
  REASSESSMENT: "Reassessment",
  ACUITY_APPROVAL: "Acuity Approval",
  CLINICAL_OVERRIDE: "Clinical Override",
};

export interface LocHistoryEntry {
  id: string;
  residentId?: string;      // resident record, when it exists
  admissionId?: string;     // link when captured pre-admission (no resident yet)
  residentName?: string;
  level: string;            // normalised "L1".."L5"
  previousLevel?: string;
  source: LocSource;
  assessmentId?: string;
  rawScore?: number;
  by?: string;
  role?: string;
  notes?: string;
  at: string;               // ISO timestamp
}

/** Normalise a level value ("3", 3, "L3", "Level 3") to "L1".."L5". */
export function normalizeLevel(v: unknown): string {
  const m = /([1-5])/.exec(String(v ?? ""));
  return m ? `L${m[1]}` : String(v ?? "");
}

export function parseLocHistory(raw?: string | null): LocHistoryEntry[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? (v as LocHistoryEntry[]) : []; } catch { return []; }
}

/** A resident's history (newest first), matched by residentId or linked admission. */
export function historyForResident(items: LocHistoryEntry[], residentId: string, admissionIds: string[] = []): LocHistoryEntry[] {
  return items
    .filter((e) => (e.residentId && e.residentId === residentId) || (e.admissionId && admissionIds.includes(e.admissionId)))
    .sort((a, b) => (b.at || "").localeCompare(a.at || ""));
}

export function latestEntry(items: LocHistoryEntry[], residentId: string, admissionIds: string[] = []): LocHistoryEntry | null {
  return historyForResident(items, residentId, admissionIds)[0] ?? null;
}

let seq = 0;
function newId(): string {
  seq += 1;
  return `loc-${Date.now().toString(36)}-${seq}`;
}

/**
 * Record a Level of Care change (client-side, best-effort). Reads the current
 * `loc_history`, appends a new entry ONLY when the level actually changed for
 * this resident/admission (deduped against the latest entry), and persists.
 * Returns true if an entry was appended. Never throws — LOC history must never
 * block the primary save.
 */
export async function recordLocChange(opts: {
  residentId?: string;
  admissionId?: string;
  residentName?: string;
  level: string;
  source: LocSource;
  assessmentId?: string;
  rawScore?: number;
  by?: string;
  role?: string;
  notes?: string;
  nowISO?: string;
}): Promise<boolean> {
  try {
    const level = normalizeLevel(opts.level);
    if (!level) return false;
    const key = opts.residentId || opts.admissionId;
    if (!key) return false;

    const res = await fetch(`/api/db/app-settings?f_key=${LOC_HISTORY_KEY}&take=1`, { credentials: "include" });
    const json = res.ok ? await res.json() : null;
    const row = (json?.data as Array<{ key?: string; value?: string }> | undefined)?.[0];
    const items = parseLocHistory(row?.value);

    const admissionIds = opts.admissionId ? [opts.admissionId] : [];
    const prior = latestEntry(items, opts.residentId ?? "", admissionIds);
    // No change → don't duplicate the record.
    if (prior && normalizeLevel(prior.level) === level && prior.source === opts.source) return false;

    const entry: LocHistoryEntry = {
      id: newId(),
      residentId: opts.residentId,
      admissionId: opts.admissionId,
      residentName: opts.residentName,
      level,
      previousLevel: prior ? normalizeLevel(prior.level) : undefined,
      source: opts.source,
      assessmentId: opts.assessmentId,
      rawScore: opts.rawScore,
      by: opts.by,
      role: opts.role,
      notes: opts.notes,
      at: opts.nowISO ?? new Date().toISOString(),
    };
    await createRecord("app-settings", { id: LOC_HISTORY_KEY, key: LOC_HISTORY_KEY, value: JSON.stringify([entry, ...items]) });
    return true;
  } catch {
    return false;
  }
}
