// SLMS v4.2 Care Event Result Fields (Foundations unit D).
// The 16 typed result schemas + validateResult() — the pure gate the caregiver
// completion button (#4) calls before an event can close. A blank required result
// cannot be completed; machine invariants (e.g. consumed <= offered) also block.
// Data source: data/result_schemas.json (extracted from SLMS_v4.2 (2).xlsx).

import schemasRaw from "./data/result_schemas.json" with { type: "json" };

export interface ResultSchema {
  eventType: string;
  quickChartCategory: string;
  requiredFields: string[];
  optionalFields: string[];
  completionButton: string;
  allowedExceptions: string[];
  autoEscalationExamples: string;
  units: string;
  countsCompleteWhen: string;
  developerValidation: string;
  sourceWorkbookVersion: string;
}

export const RESULT_SCHEMAS = schemasRaw as ResultSchema[];
const byType = new Map(RESULT_SCHEMAS.map((s) => [s.eventType, s]));
const byCategory = new Map(RESULT_SCHEMAS.map((s) => [s.quickChartCategory, s]));

export function schemaFor(eventType: string): ResultSchema {
  const s = byType.get(eventType) ?? byCategory.get(eventType);
  if (!s) throw new Error(`No result schema for event type: ${eventType}`);
  return s;
}

/** Normalize a field/key name for tolerant matching (camelCase, spaces, punctuation). */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function normMap(payload: Record<string, unknown>): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const [k, v] of Object.entries(payload)) m.set(norm(k), v);
  return m;
}
const asNum = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

// Machine validation rules keyed by eventType (logic, not data). Extend as needed.
type Rule = (m: Map<string, unknown>) => string | null;
const RULES: Record<string, Rule[]> = {
  Hydration: [
    (m) => {
      const o = asNum(m.get("amountoffered"));
      const c = asNum(m.get("amountconsumed"));
      return o != null && c != null && c > o ? "consumed amount cannot exceed offered amount" : null;
    },
  ],
  "Medication Support": [
    (m) => (!m.get("maroutcome") ? "medication requires a MAR outcome" : null),
  ],
};

export interface ValidationResult {
  ok: boolean;
  missing: string[];
  invalid: string[];
}

/** Presence of every required field (blank/null counts as missing) + machine rules. */
export function validateResult(eventType: string, payload: Record<string, unknown>): ValidationResult {
  const schema = schemaFor(eventType);
  const m = normMap(payload);
  const isBlank = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "");
  const missing = schema.requiredFields.filter((f) => {
    const key = norm(f);
    return !m.has(key) || isBlank(m.get(key));
  });
  const invalid: string[] = [];
  for (const rule of RULES[schema.eventType] ?? []) {
    const err = rule(m);
    if (err) invalid.push(err);
  }
  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid };
}
