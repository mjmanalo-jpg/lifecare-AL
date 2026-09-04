"use client";

/**
 * Physical Exam — the on-admission CLINICAL ASSESSMENT body check, laid out to
 * match the paper form: the 11 injury types (a fill-in beside each) and the
 * front / back / side body diagrams. The whole form is visible on screen and
 * prints in the same layout (on the LifeCare letterhead). Self-contained: reads
 * and writes the migration-free `physical_exams` app-setting.
 */

import { useEffect, useMemo, useState } from "react";
import { Printer, Loader2, Save } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import { lifecareLetterhead, LIFECARE_BRAND_CSS } from "@/lib/lifecare/brand";
import {
  PHYSICAL_EXAMS_KEY, parsePhysicalExams, examForResident, emptyExam, hasAnyMark,
  INJURY_TYPES, type PhysicalExam, type InjuryType,
} from "@/lib/physicalExam";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

// Body silhouettes (front reused for front + back, plus a side profile), drawn
// to echo the paper form's diagrams. Rendered on screen and in the printout.
const BODY_FRONT = `<svg viewBox="0 0 120 300" width="72" height="180" fill="none" stroke="#2b5ca8" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><circle cx="60" cy="30" r="22"/><path d="M60 52 C48 52 44 60 44 70 C44 79 31 83 25 93 C18 106 16 141 14 169 C13 179 23 181 25 170 C29 148 35 120 40 104 C40 131 38 177 40 209 C41 237 44 269 46 287 C47 297 57 297 57 287 L59 215 L61 215 L63 287 C63 297 73 297 74 287 C76 269 79 237 80 209 C82 177 80 131 80 104 C85 120 91 148 95 170 C97 181 107 179 106 169 C104 141 102 106 95 93 C89 83 76 79 76 70 C76 60 72 52 60 52 Z"/></svg>`;
const BODY_SIDE = `<svg viewBox="0 0 100 300" width="58" height="180" fill="none" stroke="#2b5ca8" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M44 10 C58 10 66 21 66 34 C66 45 60 49 55 53 L57 63 C68 67 74 76 74 88 C74 103 69 123 67 143 C66 156 69 170 69 184 L73 254 C74 262 66 264 64 255 L58 192 C51 190 45 190 41 194 L45 254 C46 262 38 264 36 255 L33 150 C32 128 33 100 35 85 C36 71 40 60 45 54 C41 50 37 44 37 34 C37 21 30 10 44 10 Z"/></svg>`;

const cell = "rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 bg-white";

export default function PhysicalExamForm({ residentId, residentName, room, canEdit = true }: {
  residentId: string; residentName: string; room?: string; canEdit?: boolean;
}) {
  const { data: settingRows, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  const saved = useMemo(
    () => examForResident(parsePhysicalExams(settingRows.find((r) => (r.key || r.id) === PHYSICAL_EXAMS_KEY)?.value), residentId),
    [settingRows, residentId],
  );

  const [injuries, setInjuries] = useState<Partial<Record<InjuryType, string>>>({});
  const [bodyNotes, setBodyNotes] = useState("");
  const [examinedBy, setExaminedBy] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (hydrated || !saved) return;
    setInjuries(saved.injuries || {});
    setBodyNotes(saved.bodyNotes || "");
    setExaminedBy(saved.examinedBy || "");
    setHydrated(true);
  }, [saved, hydrated]);

  const setInjury = (t: InjuryType, v: string) => { setInjuries((p) => ({ ...p, [t]: v })); setDirty(true); };
  const completed = hasAnyMark({ injuries });

  const save = async () => {
    setSaving(true);
    try {
      const all = parsePhysicalExams(settingRows.find((r) => (r.key || r.id) === PHYSICAL_EXAMS_KEY)?.value);
      const rec: PhysicalExam = {
        id: saved?.id || emptyExam(residentId).id,
        residentId, residentName, room,
        injuries,
        bodyNotes: bodyNotes.trim() || undefined,
        examinedBy: examinedBy.trim() || undefined,
        status: completed ? "COMPLETE" : "DRAFT",
        examinedAt: completed ? (saved?.examinedAt || new Date().toISOString()) : undefined,
        updatedAt: new Date().toISOString(),
      };
      const next = [...all.filter((e) => e.residentId !== residentId), rec];
      await upsertRecord("app-settings", PHYSICAL_EXAMS_KEY, { key: PHYSICAL_EXAMS_KEY, value: JSON.stringify(next) });
      await refetch?.();
      setDirty(false);
    } finally { setSaving(false); }
  };

  const printExam = () => {
    const w = window.open("", "_blank", "width=900,height=1100");
    if (!w) return;
    const rows = (from: number, to: number) => INJURY_TYPES.slice(from, to).map((t, i) =>
      `<tr><td class="ln">${esc(injuries[t] || "")}</td><td class="n">${from + i + 1}.</td><td class="t">${esc(t)}</td></tr>`).join("");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Clinical Assessment — ${esc(residentName)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:"Segoe UI",system-ui,-apple-system,Arial,sans-serif;color:#1f2933;margin:0 auto;max-width:800px;padding:34px 40px;font-size:13px}
  ${LIFECARE_BRAND_CSS}
  hr.rule{border:0;border-top:1.5px solid #ced4da;margin:8px 0 16px}
  h1{text-align:center;font-size:18px;font-weight:800;letter-spacing:.02em;margin:0 0 18px}
  .id{margin:3px 0;font-size:14px;font-weight:700}.id b{font-weight:800}
  .section{font-size:13px;letter-spacing:.04em;margin:20px 0 8px;color:#343a40}
  table.inj{width:100%;border-collapse:collapse}
  table.inj td{padding:3px 4px;vertical-align:bottom}
  table.inj td.ln{width:120px;border-bottom:1px solid #333;text-align:center;font-weight:700}
  table.inj td.n{width:22px;text-align:right;color:#333}table.inj td.t{white-space:nowrap}
  .cols{display:flex;gap:40px}.cols>div{flex:1}
  .bodies{display:flex;gap:18px;justify-content:flex-start;margin-top:22px}
  .bodies figure{margin:0;text-align:center}.bodies figcaption{font-size:10px;color:#868e96;margin-top:2px}
  .notes{margin-top:16px}.notes .l{font-weight:700}
  .sign{margin-top:28px;display:flex;justify-content:space-between;gap:24px}.sign div{flex:1}.sign .l{font-size:11px;color:#495057}.sign .v{border-bottom:1px solid #495057;min-height:22px;font-weight:600}
  @page{margin:0}@media print{body{padding:22px 30px}}
</style></head><body onload="window.focus();window.print()">
  ${lifecareLetterhead()}
  <hr class="rule">
  <h1>CLINICAL ASSESSMENT</h1>
  <div class="id"><b>Name of Resident:</b> ${esc(residentName)}</div>
  <div class="id"><b>Room No.:</b> ${esc(room || "")}</div>
  <div class="section">TYPE OF INJURY</div>
  <div class="cols">
    <div><table class="inj">${rows(0, 5)}</table></div>
    <div><table class="inj">${rows(5, 11)}</table></div>
  </div>
  <div class="bodies">
    <figure>${BODY_FRONT}<figcaption>Front</figcaption></figure>
    <figure>${BODY_FRONT}<figcaption>Back</figcaption></figure>
    <figure>${BODY_SIDE}<figcaption>Side</figcaption></figure>
  </div>
  ${bodyNotes ? `<div class="notes"><span class="l">Notes:</span> ${esc(bodyNotes).replace(/\n/g, "<br>")}</div>` : ""}
  <div class="sign"><div><div class="l">Examined By:</div><div class="v">${esc(examinedBy)}</div></div><div><div class="l">Reviewed By:</div><div class="v"></div></div></div>
</body></html>`);
    w.document.close();
  };

  const injuryRow = (t: InjuryType, n: number) => (
    <div key={t} className="flex items-center gap-2 py-1">
      <input disabled={!canEdit} value={injuries[t] || ""} onChange={(e) => setInjury(t, e.target.value)}
        placeholder="—" className={`${cell} w-24 text-center`} title={`Mark / count for ${t}`} />
      <span className="text-sm text-gray-800"><span className="tabular-nums text-gray-500">{n}.</span> {t}</span>
    </div>
  );

  return (
    <div className="rounded-xl border bg-white p-5 sm:p-6" style={{ borderColor: "var(--clinical-line)" }}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-center text-lg font-black tracking-wide text-gray-900 sm:text-xl">CLINICAL ASSESSMENT</h2>
          <p className="mt-0.5 text-center text-[11px] text-gray-400">Physical Exam · on-admission body check</p>
        </div>
        <button type="button" onClick={printExam} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"><Printer className="h-3.5 w-3.5" /> Print</button>
      </div>

      <div className="space-y-1 border-b border-gray-200 pb-4 text-sm">
        <div><span className="font-bold">Name of Resident:</span> {residentName || "—"}</div>
        <div><span className="font-bold">Room No.:</span> {room || "—"}</div>
      </div>

      <p className="mt-4 text-xs font-bold uppercase tracking-[0.08em] text-gray-500">Type of Injury</p>
      <div className="mt-1 grid grid-cols-1 gap-x-10 sm:grid-cols-2">
        <div>{INJURY_TYPES.slice(0, 5).map((t, i) => injuryRow(t, i + 1))}</div>
        <div>{INJURY_TYPES.slice(5, 11).map((t, i) => injuryRow(t, i + 6))}</div>
      </div>

      <div className="mt-5 flex flex-wrap gap-5">
        {[["Front", BODY_FRONT], ["Back", BODY_FRONT], ["Side", BODY_SIDE]].map(([lbl, svg], i) => (
          <figure key={i} className="m-0 text-center">
            <span dangerouslySetInnerHTML={{ __html: svg }} />
            <figcaption className="text-[10px] text-gray-400">{lbl}</figcaption>
          </figure>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-gray-600">Examined by
          <input disabled={!canEdit} value={examinedBy} onChange={(e) => { setExaminedBy(e.target.value); setDirty(true); }} placeholder="Staff name" className={`${cell} mt-1 w-full`} />
        </label>
        <label className="text-xs font-medium text-gray-600">Notes / body diagram observations
          <input disabled={!canEdit} value={bodyNotes} onChange={(e) => { setBodyNotes(e.target.value); setDirty(true); }} placeholder="e.g. 2cm laceration, left forearm (front)…" className={`${cell} mt-1 w-full`} />
        </label>
      </div>

      {canEdit && (
        <div className="mt-4 flex items-center gap-3">
          <button type="button" onClick={() => void save()} disabled={saving || !dirty}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--clinical-panel)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save exam
          </button>
          {saved && !dirty && <span className="text-[11px] text-[var(--clinical-muted)]">Saved{saved.examinedAt ? ` · ${new Date(saved.examinedAt).toLocaleDateString()}` : ""}.</span>}
        </div>
      )}
    </div>
  );
}
