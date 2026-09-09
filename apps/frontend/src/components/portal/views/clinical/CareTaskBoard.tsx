"use client";

// Care Task — the resident's standard-activities table (Time · Activity · Level
// of Assistance · Assisted By), seeded from the APPROVED 24-hour routine and then
// nurse-editable (add lifestyle rows like "Call with Family"). Once approved it's
// "what's sent to the CGs" and the source of the monthly Resident Daily
// Performance grid. Migration-free (app-setting `care_task_routine`).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, RotateCcw, ShieldCheck, CheckCircle2, Loader2, FileDown } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import { createReport } from "@/lib/pdfReport";
import { activityRows, type ActivityRow } from "@/lib/lifecare/monthlyPerformance";
import { careDay } from "@/lib/lifecare/routineCompletions";
import { ASSISTANCE_DISPLAY, ROLE_ABBR } from "@/lib/lifecare/assistance";
import {
  CARE_TASK_KEY, parseCareTask, upsertCareTask, mergeCareTaskRows, toTimeInput, careDayRank,
  type CareTaskRow, type CareTaskState,
} from "@/lib/lifecare/careTask";
import { ClinicalButton, StatusPill } from "./clinical-ui";
import { useToast, Toaster } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";

// Approved RoutineEventDefinition rows arrive as loose DB records; activityRows
// wants its DefLike shape. Cast at this single boundary.
type DefRow = Record<string, unknown>;
const asDefs = (rows: DefRow[]) => rows as unknown as Parameters<typeof activityRows>[0];

const newId = () => globalThis.crypto?.randomUUID?.() ?? `ct-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const cell = "w-full rounded-md border bg-[var(--clinical-surface)] px-2 py-1.5 text-sm text-[var(--clinical-ink)] outline-none focus:border-[var(--clinical-panel)]";

// Dropdown options: facility display labels + the "Assisted By" abbreviations.
const ASSISTANCE_OPTS = Object.values(ASSISTANCE_DISPLAY);
const ASSISTED_BY_OPTS = [...Object.values(ROLE_ABBR), "Family", "Self"];

const seedRow = (a: ActivityRow): CareTaskRow => ({
  id: a.key, time: a.time, activity: a.activity, assistance: a.assistance, assistedBy: a.assistedBy,
});

export default function CareTaskBoard({ residentId, approvedDefs, residentName, approverName, readOnly = false }: {
  residentId: string;
  approvedDefs: DefRow[];
  residentName?: string;
  approverName?: string;
  readOnly?: boolean;
}) {
  const { data: settingRows, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  const savedMap = useMemo(() => parseCareTask(settingRows.find((r) => (r.key || r.id) === CARE_TASK_KEY)?.value), [settingRows]);
  const saved = savedMap[residentId];
  const seed = useMemo(() => activityRows(asDefs(approvedDefs), careDay()).map(seedRow), [approvedDefs]);

  // The table shown = the live approved-routine seed MERGED with the persisted table:
  // clinical rows always follow the current 24-hour routine (so (re)generating it
  // flows through here — fresh times/activities), while nurse-added lifestyle rows
  // (non-seed ids, no "@") and per-row edits are preserved. An APPROVED Care Task is
  // frozen — it's what CGs receive — until the nurse re-seeds or edits it.
  const merged = useMemo<CareTaskRow[]>(() => mergeCareTaskRows(saved, seed), [seed, saved]);

  const [rows, setRows] = useState<CareTaskRow[]>(merged);
  const [approved, setApproved] = useState<boolean>(!!saved?.approved);
  const [approvedAt, setApprovedAt] = useState<string | undefined>(saved?.approvedAt);
  const [edited, setEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toasts, toast, dismiss } = useToast();
  const { confirm, confirmDialog } = useConfirm();

  // Reflect the merged view when the routine/persisted table changes — a
  // render-phase adjustment (React's "storing info from previous renders"),
  // skipped while the nurse is mid-edit so in-progress changes aren't clobbered.
  const [syncedMerged, setSyncedMerged] = useState(merged);
  if (merged !== syncedMerged && !edited) {
    setSyncedMerged(merged);
    setRows(merged);
    setApproved(!!saved?.approved);
    setApprovedAt(saved?.approvedAt);
  }

  const settingRef = useRef(settingRows);
  useEffect(() => { settingRef.current = settingRows; }, [settingRows]);
  const persist = useCallback(async (next: CareTaskState) => {
    const cur = parseCareTask(settingRef.current.find((r) => (r.key || r.id) === CARE_TASK_KEY)?.value);
    const map = upsertCareTask(cur, residentId, next);
    await upsertRecord("app-settings", CARE_TASK_KEY, { key: CARE_TASK_KEY, value: JSON.stringify(map) });
    await refetch();
  }, [residentId, refetch]);

  // Debounced auto-save of edits. Editing after approval reverts to Draft (the
  // CGs' source of truth must be re-approved).
  useEffect(() => {
    if (!edited) return;
    const t = setTimeout(() => void persist({ rows, approved: false, updatedAt: new Date().toISOString() }), 700);
    return () => clearTimeout(t);
  }, [rows, persist, edited]);

  const mark = () => { if (approved) setApproved(false); setEdited(true); };
  const setCell = (id: string, patch: Partial<CareTaskRow>) => { mark(); setRows((a) => a.map((r) => (r.id === id ? { ...r, ...patch } : r))); };
  const addRow = () => { mark(); setRows((a) => [...a, { id: newId(), time: "", activity: "", assistance: "Supervision", assistedBy: "CGs" }]); };
  const removeRow = (id: string) => { mark(); setRows((a) => a.filter((r) => r.id !== id)); };

  const reseed = async () => {
    if (seed.length === 0) return;
    if (!(await confirm({ title: "Re-seed from routine?", description: "Replaces this table with a fresh copy from the current approved 24-hour routine. Manual edits and lifestyle rows will be lost.", confirmText: "Re-seed", destructive: true }))) return;
    mark(); setRows(seed);
  };

  const approve = async () => {
    if (!rows.length || saving) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      await persist({ rows, approved: true, approvedAt: now, approvedBy: approverName || "Clinician", updatedAt: now });
      setApproved(true); setApprovedAt(now); setEdited(false);
      // Send the approved Care Task to every caregiver covering the resident today.
      const res = await fetch("/api/routine/dispatch-care-task", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ residentId }) });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        const cgs = Number(j?.caregivers) || 0;
        toast("success", "Care Task approved & sent",
          `${Number(j?.created) || 0} task${j?.created === 1 ? "" : "s"} sent to ${cgs || "the unassigned"} caregiver${cgs === 1 ? "" : "s"}${cgs ? " covering this resident today" : " pool (no caregiver rostered today)"}.`);
      } else {
        toast("error", "Approved, but not sent", j?.error || "Couldn't send the tasks to caregivers.");
      }
    } catch (e) { toast("error", "Couldn't approve", e instanceof Error ? e.message : "Please try again."); }
    finally { setSaving(false); }
  };

  // Structured, self-contained PDF of the Care Task table.
  const downloadPdf = () => {
    const rep = createReport();
    rep.header("Care Task", "Senior Living Management System", [
      residentName || "Resident",
      approved ? `Approved${approvedAt ? " · " + new Date(approvedAt).toLocaleDateString() : ""}` : "Draft",
      `${rows.length} task${rows.length === 1 ? "" : "s"} · Generated ${new Date().toLocaleString()}`,
    ]);
    const sorted = [...rows].sort((a, b) => careDayRank(a.time) - careDayRank(b.time));
    rep.table([40, 120, 340, 460], ["Time", "Activity", "Level of Assistance", "Assisted By"],
      sorted.map((r) => [r.time || "—", r.activity || "—", r.assistance || "—", r.assistedBy || "—"]));
    rep.save(`care-task-${(residentName || "resident").toLowerCase().replace(/\s+/g, "-")}.pdf`);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {approved
            ? <StatusPill status="APPROVED">Approved{approvedAt ? ` · ${new Date(approvedAt).toLocaleDateString()}` : ""}</StatusPill>
            : <span className="rounded-full bg-[var(--clinical-surface-2)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-[var(--clinical-muted)]">Draft</span>}
          <p className="text-[11px] text-[var(--clinical-muted)]">{readOnly ? "The approved Care Task sent to caregivers, seeded from the 24-hour routine." : "Seeded from the approved 24-hour routine. Edit or add lifestyle rows; approve to send to caregivers."}</p>
        </div>
        <div className="flex items-center gap-2">
          <ClinicalButton variant="secondary" size="sm" onClick={downloadPdf} disabled={rows.length === 0}><FileDown className="h-3.5 w-3.5" /> Export PDF</ClinicalButton>
          {!readOnly && (
            <>
              <button type="button" onClick={() => void reseed()} disabled={seed.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold text-[var(--clinical-panel)] transition hover:bg-[var(--clinical-surface-2)] disabled:opacity-50"
                style={{ borderColor: "var(--clinical-line-strong)" }}>
                <RotateCcw className="h-3.5 w-3.5" /> {rows.length ? "Re-seed" : "Seed from routine"}
              </button>
              <ClinicalButton variant="primary" size="sm" onClick={() => void approve()} disabled={saving || approved || rows.length === 0}
                title={rows.length === 0 ? "Add or seed rows first" : "Approve this Care Task"}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : approved ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />} {approved ? "Approved" : "Approve Care Task"}
              </ClinicalButton>
            </>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--clinical-line)" }}>
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--clinical-muted)]" style={{ backgroundColor: "var(--clinical-surface-2)" }}>
              <th className="px-3 py-2 font-bold">Time</th>
              <th className="px-3 py-2 font-bold">Activity</th>
              <th className="px-3 py-2 font-bold">Level of Assistance</th>
              <th className="px-3 py-2 font-bold">Assisted By</th>
              <th className="px-2 py-2" aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {[...rows].sort((a, b) => careDayRank(a.time) - careDayRank(b.time)).map((r) => (
              <tr key={r.id} className="border-t" style={{ borderColor: "var(--clinical-line)" }}>
                <td className="px-2 py-1.5 align-top" style={{ width: 132 }}>
                  <input type="time" lang="en-US" value={toTimeInput(r.time)} onChange={(e) => setCell(r.id, { time: e.target.value })} disabled={readOnly} className={`${cell} text-center disabled:opacity-100`} style={{ borderColor: "var(--clinical-line)" }} aria-label="Time" />
                </td>
                <td className="px-2 py-1.5 align-top">
                  <input value={r.activity} onChange={(e) => setCell(r.id, { activity: e.target.value })} disabled={readOnly} placeholder="Activity…" className={`${cell} disabled:opacity-100`} style={{ borderColor: "var(--clinical-line)" }} aria-label="Activity" />
                </td>
                <td className="px-2 py-1.5 align-top" style={{ width: 168 }}>
                  <select value={r.assistance} onChange={(e) => setCell(r.id, { assistance: e.target.value })} disabled={readOnly} className={`${cell} disabled:opacity-100`} style={{ borderColor: "var(--clinical-line)" }} aria-label="Level of assistance">
                    {ASSISTANCE_OPTS.includes(r.assistance) ? null : <option value={r.assistance}>{r.assistance || "—"}</option>}
                    {ASSISTANCE_OPTS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1.5 align-top" style={{ width: 118 }}>
                  <select value={r.assistedBy} onChange={(e) => setCell(r.id, { assistedBy: e.target.value })} disabled={readOnly} className={`${cell} disabled:opacity-100`} style={{ borderColor: "var(--clinical-line)" }} aria-label="Assisted by">
                    {ASSISTED_BY_OPTS.includes(r.assistedBy) ? null : <option value={r.assistedBy}>{r.assistedBy || "—"}</option>}
                    {ASSISTED_BY_OPTS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1.5 align-top">
                  {!readOnly && (
                    <button type="button" onClick={() => removeRow(r.id)} aria-label="Remove row"
                      className="mt-1 rounded-md p-1.5 text-[var(--clinical-muted)] transition hover:bg-[var(--clinical-surface-2)] hover:text-[var(--clinical-coral)]">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-[var(--clinical-muted)]">No Care Task rows yet. Seed from the approved 24-hour routine, or add rows manually.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div className="mt-3">
          <ClinicalButton variant="secondary" size="sm" onClick={addRow}><Plus className="h-3.5 w-3.5" /> Add row</ClinicalButton>
        </div>
      )}
      {residentName && <p className="mt-2 text-[11px] text-[var(--clinical-muted)]">Care Task for {residentName}.</p>}
      {confirmDialog}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
