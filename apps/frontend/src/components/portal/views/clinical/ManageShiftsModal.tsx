"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, X, Loader2 } from "lucide-react";
import { shiftMeta, type CaregiverSchedule, type ShiftDef } from "@/lib/caregiverSchedule";
import { PROTECTED_SHIFT_KEYS, newShiftKey, validateShiftDefs, parseHHMM } from "@/lib/shiftDefinitions";
import { ClinicalButton, ClinicalCard, MicroLabel, controlClass } from "./clinical-ui";

/**
 * Shift-table editor — re-time a shift, rename it, or add one of the facility's own.
 *
 * One table per community with no version history: saving re-times every roster row
 * keyed to that shift, past and future, because a row stores only the shift KEY. The
 * three tiling shifts (AM / PM / NOC) can be re-timed but never removed — task
 * routing and the routine's shift tags name them directly — and a shift still used by
 * an assignment can't be removed either, which would strand that assignment.
 */
export default function ManageShiftsModal({ defs, schedules, onClose, onSave }: {
  defs: ShiftDef[];
  schedules: CaregiverSchedule[];
  onClose: () => void;
  onSave: (next: ShiftDef[]) => Promise<void>;
}) {
  const [rows, setRows] = useState<ShiftDef[]>(() => defs.map((d) => ({ ...d })));
  const [saving, setSaving] = useState(false);
  const errors = useMemo(() => validateShiftDefs(rows), [rows]);

  /** Assignments per shift. Removing a shift that still has any would strand them,
   *  so the control is disabled and the count explains why. */
  const inUse = useMemo(() => {
    const m = new Map<string, number>();
    for (const sc of schedules) m.set(sc.shift, (m.get(sc.shift) ?? 0) + 1);
    return m;
  }, [schedules]);

  const setRow = (i: number, patch: Partial<ShiftDef>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const addRow = () => setRows((prev) => [
    ...prev,
    { key: newShiftKey("Shift", prev.map((r) => r.key)), label: "", start: "07:00", end: "15:00" },
  ]);

  const save = async () => {
    if (errors.length) return;
    setSaving(true);
    try {
      // A brand-new row gets its key from its final name, so the stored key reads
      // like the shift rather than the placeholder it was created with. An existing
      // key is never rewritten — roster rows point at it.
      const taken = new Set<string>();
      const next: ShiftDef[] = rows.map((r) => {
        const keep = r.builtin || inUse.has(r.key) || defs.some((d) => d.key === r.key);
        const key = keep ? r.key : newShiftKey(r.label, taken);
        taken.add(key);
        return { key, label: r.label.trim(), start: r.start, end: r.end, ...(r.builtin ? { builtin: true as const } : {}) };
      });
      await onSave(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Shift times"
        className="flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl shadow-2xl sm:max-h-[90vh] sm:max-w-xl sm:rounded-2xl"
        style={{ backgroundColor: "var(--clinical-ground)" }}
      >
        <div className="flex flex-none items-center justify-between px-5 py-4 text-white" style={{ backgroundColor: "var(--clinical-panel)" }}>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/75">Caregiver Schedule</p>
            <h2 className="text-lg font-bold">Shift times</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-2 hover:bg-white/10"><X className="h-5 w-5" /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
          <p className="text-xs text-[var(--clinical-muted)]">
            Resident routine times never move &mdash; caregivers are rostered around them. Changing a
            shift&apos;s hours re-times every assignment on that shift, including past days.
          </p>

          {rows.map((r, i) => {
            const meta = shiftMeta(r.key, rows);
            const used = inUse.get(r.key) ?? 0;
            const locked = PROTECTED_SHIFT_KEYS.has(r.key);
            const spans = (parseHHMM(r.end) ?? 0) <= (parseHHMM(r.start) ?? 0);
            const why = locked
              ? "Task routing and the routine shift tags refer to this shift"
              : used > 0
                ? `${used} assignment${used === 1 ? "" : "s"} still use this shift`
                : "Remove shift";
            return (
              <ClinicalCard key={`${r.key}-${i}`} top="none" className="p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[8rem] flex-1">
                    <MicroLabel>Name</MicroLabel>
                    <input
                      value={r.label}
                      onChange={(e) => setRow(i, { label: e.target.value })}
                      placeholder="e.g. Mid Shift"
                      className={controlClass}
                    />
                  </div>
                  <div>
                    <MicroLabel>Starts</MicroLabel>
                    <input type="time" value={r.start} onChange={(e) => setRow(i, { start: e.target.value })} className={controlClass} />
                  </div>
                  <div>
                    <MicroLabel>Ends</MicroLabel>
                    <input type="time" value={r.end} onChange={(e) => setRow(i, { end: e.target.value })} className={controlClass} />
                  </div>
                  <button
                    onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                    disabled={locked || used > 0}
                    title={why}
                    aria-label={`Remove ${r.label || r.key}`}
                    className="rounded p-2 text-[var(--clinical-coral)] hover:bg-[var(--clinical-surface-2)] disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-[var(--clinical-muted)]">
                  {meta.range} &middot; {Number.isInteger(meta.hours) ? meta.hours : meta.hours.toFixed(1)}h
                  {spans ? " · runs past midnight" : ""}
                  {used > 0 ? ` · ${used} assignment${used === 1 ? "" : "s"}` : ""}
                </p>
              </ClinicalCard>
            );
          })}

          <ClinicalButton variant="secondary" size="sm" onClick={addRow}><Plus className="h-3.5 w-3.5" /> Add shift</ClinicalButton>

          {errors.length > 0 && (
            <div
              className="rounded-lg border p-3"
              style={{ borderColor: "var(--clinical-coral)", backgroundColor: "color-mix(in srgb, var(--clinical-coral) 8%, transparent)" }}
            >
              {errors.map((e) => <p key={e} className="text-[11px] font-medium text-[var(--clinical-coral)]">{e}</p>)}
            </div>
          )}
        </div>

        <div className="flex flex-none items-center justify-end gap-2 border-t px-4 py-3 sm:px-5" style={{ borderColor: "var(--clinical-border)" }}>
          <ClinicalButton variant="secondary" onClick={onClose}>Cancel</ClinicalButton>
          <ClinicalButton onClick={save} disabled={saving || errors.length > 0}>
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving&hellip;</> : "Save shift times"}
          </ClinicalButton>
        </div>
      </div>
    </div>
  );
}
