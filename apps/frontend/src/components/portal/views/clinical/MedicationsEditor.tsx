"use client";

// Shared structured medications editor — used by the Resident Assessment (Layer 1)
// and the Admission form. Each row: name · dose · frequency (dropdown) · special
// instructions · "requires vitals before administration". Entered meds flow into
// the resident's MAR via medSync. See the 2026-09-05 design spec.

import { Plus, Trash2, Activity } from "lucide-react";
import { FREQUENCIES } from "@/lib/lifecare/medConstants";
import type { MedItem } from "@/lib/lifecare/assessment";

const inputCls =
  "w-full rounded-lg border border-[var(--clinical-line-strong,#cbd5e1)] bg-[var(--clinical-surface,#fff)] px-3 py-2 text-sm text-[var(--clinical-ink,#0f172a)] outline-none transition placeholder:text-[var(--clinical-muted,#94a3b8)] focus:border-[var(--clinical-panel,#6366f1)] focus:ring-2 focus:ring-[var(--clinical-panel,#6366f1)]/20";

export default function MedicationsEditor({
  value,
  onChange,
  disabled,
}: {
  value?: MedItem[];
  onChange: (next: MedItem[]) => void;
  disabled?: boolean;
}) {
  const rows = value ?? [];
  const patch = (i: number, p: Partial<MedItem>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const add = () => onChange([...rows, { name: "" }]);
  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i));

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold text-[var(--clinical-ink,#0f172a)]">Medications</span>
        <button
          type="button"
          onClick={add}
          disabled={disabled}
          className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--clinical-panel,#6366f1)] hover:underline disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Add medication
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--clinical-line-strong,#cbd5e1)] bg-[var(--clinical-surface,#f8fafc)] p-6 text-center">
          <p className="text-xs text-[var(--clinical-muted,#94a3b8)]">No medications added yet. Click <strong>&quot;Add medication&quot;</strong> above to get started.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((m, i) => (
            <div key={i} className="group rounded-xl border border-[var(--clinical-line,#e2e8f0)] bg-[var(--clinical-surface,#fff)] transition hover:shadow-sm">
              {/* Card header — index badge + delete */}
              <div className="flex items-center justify-between border-b border-[var(--clinical-line,#e2e8f0)] bg-[var(--clinical-surface,#f8fafc)] rounded-t-xl px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--clinical-panel,#6366f1)]/10 text-[11px] font-bold text-[var(--clinical-panel,#6366f1)]">
                    {i + 1}
                  </span>
                  <span className="text-sm font-semibold text-[var(--clinical-ink,#0f172a)] truncate max-w-[200px]">
                    {m.name || "New medication"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  disabled={disabled}
                  aria-label={`Remove ${m.name || "medication"}`}
                  className="rounded-lg p-1.5 text-[var(--clinical-muted,#94a3b8)] transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                  title="Delete medication"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {/* Card body */}
              <div className="p-4 space-y-3">
                {/* Row 1: Name + Dose */}
                <div className="grid grid-cols-[1fr_8rem] gap-2">
                  <input
                    className={`${inputCls}`}
                    placeholder="Medication name"
                    value={m.name}
                    onChange={(e) => patch(i, { name: e.target.value })}
                    disabled={disabled}
                  />
                  <input
                    className={`${inputCls}`}
                    placeholder="Dose"
                    value={m.dose ?? ""}
                    onChange={(e) => patch(i, { dose: e.target.value })}
                    disabled={disabled}
                  />
                </div>

                {/* Row 2: Frequency */}
                <select
                  className={`${inputCls}`}
                  value={m.frequency ?? ""}
                  onChange={(e) => patch(i, { frequency: e.target.value })}
                  disabled={disabled}
                >
                  <option value="">Select frequency</option>
                  {FREQUENCIES.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>

                {/* Row 3: Special instructions */}
                <input
                  className={`${inputCls}`}
                  placeholder="Special instructions (e.g., Take with food, monitor BP)"
                  value={m.instructions ?? ""}
                  onChange={(e) => patch(i, { instructions: e.target.value })}
                  disabled={disabled}
                />

                {/* Row 4: Vitals checkbox — compact inline */}
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 dark:border-amber-500/40 dark:bg-amber-500/10">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-amber-600"
                    checked={!!m.requiresVitals}
                    onChange={(e) => patch(i, { requiresVitals: e.target.checked })}
                    disabled={disabled}
                  />
                  <span className="flex items-center gap-1.5 text-xs">
                    <Activity className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                    <span className="font-semibold text-amber-800 dark:text-amber-300">Requires vitals before administration</span>
                  </span>
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
