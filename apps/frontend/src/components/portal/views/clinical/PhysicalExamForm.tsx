"use client";

/**
 * Physical Exam — the on-admission "Clinical Assessment" body check. Documents
 * injuries (11 types from the paper form) against a body location with an
 * optional photo. Self-contained: reads/writes the migration-free
 * `physical_exams` app-setting. Once completed (all-clear or ≥1 finding) it is
 * stamped with examinedAt and surfaces on the resident's One Care · One Journey.
 * Printable on the LifeCare letterhead (body outlines + numbered findings).
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Camera, Loader2, ShieldCheck, Printer, Stethoscope, Save } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import { lifecareLetterhead, LIFECARE_BRAND_CSS } from "@/lib/lifecare/brand";
import {
  PHYSICAL_EXAMS_KEY, parsePhysicalExams, examForResident, emptyExam, newFinding,
  INJURY_TYPES, BODY_PARTS, BODY_SIDES, sideLabel,
  type PhysicalExam, type PhysicalExamFinding, type BodySide, type InjuryType,
} from "@/lib/physicalExam";

const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 bg-white";
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

// Simple humanoid silhouette used as the printed reference diagram (front/back/side).
const BODY_SVG = `<svg viewBox="0 0 120 260" width="78" height="169" fill="none" stroke="#1c7ed6" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"><circle cx="60" cy="26" r="18"/><path d="M42 44 C42 44 34 50 32 62 L24 108 C23 116 31 118 34 111 L40 74 L42 74 C40 120 40 150 44 152 L48 246 C48 253 58 253 58 246 L59 168 L61 168 L62 246 C62 253 72 253 72 246 L76 152 C80 150 80 120 78 74 L80 74 L86 111 C89 118 97 116 96 108 L88 62 C86 50 78 44 78 44 C72 48 66 50 60 50 C54 50 48 48 42 44 Z"/></svg>`;

export default function PhysicalExamForm({ residentId, residentName, room, canEdit = true, examinerName }: {
  residentId: string; residentName: string; room?: string; canEdit?: boolean; examinerName?: string;
}) {
  const { data: settingRows, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  const saved = useMemo(
    () => examForResident(parsePhysicalExams(settingRows.find((r) => (r.key || r.id) === PHYSICAL_EXAMS_KEY)?.value), residentId),
    [settingRows, residentId],
  );

  const [findings, setFindings] = useState<PhysicalExamFinding[]>([]);
  const [allClear, setAllClear] = useState(false);
  const [examinedBy, setExaminedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate once from the saved record when live data first arrives (don't clobber edits).
  useEffect(() => {
    if (hydrated || !saved) return;
    setFindings(saved.findings || []);
    setAllClear(saved.status === "NONE_APPARENT");
    setExaminedBy(saved.examinedBy || examinerName || "");
    setNotes(saved.generalNotes || "");
    setHydrated(true);
  }, [saved, hydrated, examinerName]);

  const touch = () => setDirty(true);
  const patch = (id: string, p: Partial<PhysicalExamFinding>) => { setFindings((fs) => fs.map((f) => (f.id === id ? { ...f, ...p } : f))); touch(); };
  const addFinding = () => { setAllClear(false); setFindings((fs) => [...fs, newFinding()]); touch(); };
  const removeFinding = (id: string) => { setFindings((fs) => fs.filter((f) => f.id !== id)); touch(); };
  const setNoInjuries = () => { setAllClear(true); setFindings([]); touch(); };

  const uploadPhoto = async (id: string, file: File) => {
    setUploadingId(id);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("folder", "resident-documents");
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (res.ok && json.url) patch(id, { photoUrl: String(json.url) });
    } catch { /* a finding can be saved without a photo */ }
    finally { setUploadingId(null); }
  };

  const status = allClear ? "NONE_APPARENT" : findings.length ? "FINDINGS" : "DRAFT";
  const completed = status !== "DRAFT";

  const save = async () => {
    setSaving(true);
    try {
      const all = parsePhysicalExams(settingRows.find((r) => (r.key || r.id) === PHYSICAL_EXAMS_KEY)?.value);
      const rec: PhysicalExam = {
        id: saved?.id || emptyExam(residentId).id,
        residentId, residentName, room,
        status,
        findings,
        examinedBy: examinedBy.trim() || undefined,
        generalNotes: notes.trim() || undefined,
        // Stamp completion time once the exam is actually done (kept stable after).
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
    const w = window.open("", "_blank", "width=880,height=1000");
    if (!w) return;
    const listHtml = allClear || !findings.length
      ? `<p class="clear">☑ None apparent — no injuries documented on examination.</p>`
      : `<ol class="findings">${findings.map((f) =>
          `<li><b>${esc(f.injury)}</b> — ${esc(f.bodyPart)}${f.side !== "NA" ? ` (${esc(sideLabel(f.side))})` : ""}${f.description ? `<div class="d">${esc(f.description)}</div>` : ""}</li>`,
        ).join("")}</ol>`;
    const diagram = ["Front", "Back", "Side"].map((lbl) => `<figure>${BODY_SVG}<figcaption>${lbl}</figcaption></figure>`).join("");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(residentName)} — Physical Exam</title>
<style>
  *{box-sizing:border-box}
  body{font-family:"Segoe UI",system-ui,-apple-system,Arial,sans-serif;color:#1f2933;line-height:1.55;max-width:800px;margin:0 auto;padding:36px 40px;font-size:13px}
  ${LIFECARE_BRAND_CSS}
  hr.rule{border:0;border-top:1.5px solid #ced4da;margin:10px 0 14px}
  .company{font-weight:800;font-size:16px;margin:0 0 1px}.title{font-weight:700;font-size:13px;color:#343a40;margin:0 0 10px}
  .id{margin:1px 0;font-size:12px}.id b{display:inline-block;min-width:110px}
  h2{font-size:14px;color:#212529;border-bottom:1.5px solid #dee2e6;padding-bottom:4px;margin:16px 0 8px}
  .grid{display:flex;gap:20px;align-items:flex-start}
  .diagrams{display:flex;gap:10px;flex:0 0 auto}.diagrams figure{margin:0;text-align:center}.diagrams figcaption{font-size:10px;color:#868e96;margin-top:2px}
  ol.findings{margin:0;padding-left:20px;flex:1}ol.findings li{margin:4px 0;page-break-inside:avoid}ol.findings .d{color:#495057;font-size:12px}
  .clear{color:#2f9e44;font-weight:600}
  .sign{margin-top:26px;display:flex;justify-content:space-between;gap:20px}.sign div{flex:1}.sign .l{font-size:11px;color:#495057}.sign .v{border-bottom:1px solid #495057;min-height:22px;font-weight:600}
  .foot{margin-top:22px;border-top:1px solid #e9ecef;padding-top:8px;color:#adb5bd;font-size:11px}
  @page{margin:0}@media print{body{padding:24px 30px}}
</style></head><body onload="window.focus();window.print()">
  ${lifecareLetterhead()}
  <hr class="rule">
  <p class="company">LifeCare Living Solutions, Inc.</p>
  <p class="title">Clinical Assessment · Physical Exam</p>
  <div class="id"><b>Resident:</b> ${esc(residentName)}</div>
  <div class="id"><b>Room No.:</b> ${esc(room || "—")}</div>
  <div class="id"><b>Examined:</b> ${esc(examinedBy || "—")}${saved?.examinedAt ? ` · ${esc(new Date(saved.examinedAt).toLocaleDateString())}` : ""}</div>
  <h2>Type of Injury &amp; Location</h2>
  <div class="grid"><div class="diagrams">${diagram}</div>${listHtml}</div>
  ${notes ? `<h2>Notes</h2><p>${esc(notes).replace(/\n/g, "<br>")}</p>` : ""}
  <div class="sign"><div><div class="l">Examined By:</div><div class="v">${esc(examinedBy)}</div></div><div><div class="l">Reviewed By:</div><div class="v"></div></div></div>
  <div class="foot">Generated ${esc(new Date().toLocaleString())} · Confidential — for authorized use only.</div>
</body></html>`);
    w.document.close();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <Stethoscope className="h-4 w-4 text-[var(--clinical-panel)]" />
          <span className="font-semibold text-[var(--clinical-ink)]">Physical Exam — On-Admission Body Check</span>
          {completed && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">Completed</span>}
        </div>
        <button type="button" onClick={printExam} className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"><Printer className="h-3.5 w-3.5" /> Print</button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!canEdit} onClick={setNoInjuries}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${allClear ? "border-green-600 bg-green-600 text-white" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}>
          <ShieldCheck className="h-4 w-4" /> None apparent / all clear
        </button>
        <button type="button" disabled={!canEdit} onClick={addFinding}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${findings.length ? "border-blue-600 bg-blue-600 text-white" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}>
          <Plus className="h-4 w-4" /> Document injury
        </button>
      </div>

      {findings.length > 0 && (
        <div className="space-y-3">
          {findings.map((f, i) => (
            <div key={f.id} className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wide text-gray-500">Injury {i + 1}</span>
                {canEdit && <button type="button" onClick={() => removeFinding(f.id)} className="rounded p-1 text-red-500 hover:bg-red-50" title="Remove"><Trash2 className="h-4 w-4" /></button>}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="text-xs font-medium text-gray-600">Type of injury
                  <select disabled={!canEdit} className={input + " mt-1"} value={f.injury} onChange={(e) => patch(f.id, { injury: e.target.value as InjuryType })}>
                    {INJURY_TYPES.filter((t) => t !== "None Apparent").map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label className="text-xs font-medium text-gray-600">Body part
                  <select disabled={!canEdit} className={input + " mt-1"} value={f.bodyPart} onChange={(e) => patch(f.id, { bodyPart: e.target.value })}>
                    {BODY_PARTS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </label>
                <label className="text-xs font-medium text-gray-600">Side / view
                  <select disabled={!canEdit} className={input + " mt-1"} value={f.side} onChange={(e) => patch(f.id, { side: e.target.value as BodySide })}>
                    {BODY_SIDES.map((sd) => <option key={sd.value} value={sd.value}>{sd.label}</option>)}
                  </select>
                </label>
              </div>
              <textarea disabled={!canEdit} className={input + " min-h-[52px]"} placeholder="Description — e.g. 2cm laceration, cleaned & dressed…" value={f.description} onChange={(e) => patch(f.id, { description: e.target.value })} />
              <div className="flex items-center gap-2">
                {f.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.photoUrl} alt="" className="h-12 w-12 rounded-md border border-gray-200 object-cover" />
                ) : null}
                {canEdit && (
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                    {uploadingId === f.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                    {f.photoUrl ? "Replace photo" : "Add photo"}
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadPhoto(f.id, file); e.target.value = ""; }} />
                  </label>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs font-medium text-gray-600">Examined by
          <input disabled={!canEdit} className={input + " mt-1"} value={examinedBy} onChange={(e) => { setExaminedBy(e.target.value); touch(); }} placeholder="Staff name" />
        </label>
        <label className="text-xs font-medium text-gray-600">General notes (optional)
          <input disabled={!canEdit} className={input + " mt-1"} value={notes} onChange={(e) => { setNotes(e.target.value); touch(); }} placeholder="Overall condition on arrival…" />
        </label>
      </div>

      {canEdit && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => void save()} disabled={saving || !completed || !dirty}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--clinical-panel)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {saved ? "Save exam" : "Complete exam"}
          </button>
          {!completed && <span className="text-[11px] text-[var(--clinical-muted)]">Mark “None apparent” or add an injury to complete the exam.</span>}
          {completed && !dirty && saved && <span className="text-[11px] text-[var(--clinical-muted)]">Saved — visible on the resident’s One Care · One Journey.</span>}
        </div>
      )}
    </div>
  );
}
