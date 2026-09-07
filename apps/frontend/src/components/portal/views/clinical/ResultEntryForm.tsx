"use client";

// SLMS v4.2 Record & Complete — the caregiver result-entry form (sub-project #4, §4).
// Renders schemaFor(resultSchemaKey)'s required + optional fields (with the schema's
// unit label), validates the payload client-side via validateResult (the SAME pure
// gate the server re-runs), highlights missing/invalid on failure, and only then
// posts to /api/routine/complete with the results. Blank required field → cannot
// complete. Machine invariants (e.g. consumed <= offered) surface as invalid.

import { useMemo, useState } from "react";
import { ClinicalButton, FieldLabel, MicroLabel, controlClass } from "./clinical-ui";
import { schemaFor, validateResult } from "@/lib/lifecare/resultSchema";

/** Normalize a schema field name → a stable payload key (matches resultSchema's tolerant norm). */
const fieldKey = (f: string) => f.toLowerCase().replace(/[^a-z0-9]/g, "");

export interface ResultEntryFormProps {
  resultSchemaKey: string;
  /** Preset outcome (default "Completed as planned"). */
  outcome?: string;
  busy?: boolean;
  onSubmit: (payload: { results: Record<string, unknown>; outcome: string }) => void | Promise<void>;
  onCancel: () => void;
}

export default function ResultEntryForm({ resultSchemaKey, outcome = "Completed as planned", busy, onSubmit, onCancel }: ResultEntryFormProps) {
  const schema = useMemo(() => {
    try { return schemaFor(resultSchemaKey); } catch { return null; }
  }, [resultSchemaKey]);

  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);

  const set = (f: string, v: string) => setValues((prev) => ({ ...prev, [fieldKey(f)]: v }));

  const payload = useMemo<Record<string, unknown>>(() => {
    const p: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) if (v.trim() !== "") p[k] = v.trim();
    return p;
  }, [values]);

  const validation = useMemo(
    () => (schema ? validateResult(resultSchemaKey, payload) : { ok: false, missing: [], invalid: [] }),
    [schema, resultSchemaKey, payload],
  );

  if (!schema) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[var(--clinical-coral)]">No result schema found for &quot;{resultSchemaKey}&quot;.</p>
        <div className="flex justify-end"><ClinicalButton variant="secondary" onClick={onCancel}>Close</ClinicalButton></div>
      </div>
    );
  }

  const missingSet = new Set(validation.missing.map(fieldKey));

  const submit = async () => {
    setTouched(true);
    if (!validation.ok) return;
    await onSubmit({ results: payload, outcome });
  };

  const renderField = (f: string, required: boolean) => {
    const k = fieldKey(f);
    const highlight = touched && required && missingSet.has(k);
    return (
      <div key={k}>
        <FieldLabel htmlFor={`rf-${k}`} required={required}>{f}</FieldLabel>
        <input
          id={`rf-${k}`}
          value={values[k] ?? ""}
          onChange={(e) => set(f, e.target.value)}
          className={`${controlClass} ${highlight ? "border-[var(--clinical-coral)] ring-2 ring-[var(--clinical-coral)]/25" : ""}`}
          placeholder={schema.units || undefined}
          aria-invalid={highlight || undefined}
        />
        {highlight && <p className="mt-1 text-xs text-[var(--clinical-coral)]">Required.</p>}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {schema.units && (
        <p className="text-xs text-[var(--clinical-muted)]">Units: {schema.units}</p>
      )}
      <div className="space-y-3">
        {schema.requiredFields.map((f) => renderField(f, true))}
      </div>
      {schema.optionalFields.length > 0 && (
        <div className="space-y-3">
          <MicroLabel>Optional</MicroLabel>
          {schema.optionalFields.map((f) => renderField(f, false))}
        </div>
      )}
      {touched && validation.invalid.length > 0 && (
        <ul className="rounded-lg border border-[var(--clinical-coral)] bg-[color-mix(in_srgb,var(--clinical-coral)_10%,transparent)] p-3 text-xs text-[var(--clinical-coral)]">
          {validation.invalid.map((msg, i) => <li key={i}>{msg}</li>)}
        </ul>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <ClinicalButton variant="secondary" onClick={onCancel} disabled={busy}>Cancel</ClinicalButton>
        <ClinicalButton variant="primary" onClick={submit} disabled={busy || (touched && !validation.ok)}>
          {busy ? "Recording…" : "Record & Complete"}
        </ClinicalButton>
      </div>
    </div>
  );
}
