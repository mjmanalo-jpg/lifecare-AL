"use client";

/**
 * Physical Exam — the on-admission CLINICAL ASSESSMENT body check, laid out to
 * match the paper form (11 injury types + front/back/side body diagram).
 *
 * Lifecycle: a resident accumulates many exams. The Move-in controller
 * (`PhysicalExamForm`) edits a DRAFT; once **submitted** the exam is locked
 * (read-only) and a "New Exam" button starts a fresh one. Submitted exams show
 * on One Care · One Journey via `PhysicalExamHistory`, newest first. All read /
 * write the migration-free `physical_exams` app-setting.
 */

import { useEffect, useMemo, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { Printer, Loader2, Save, Plus, Lock, Send } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import { lifecareLetterhead, LIFECARE_BRAND_CSS } from "@/lib/lifecare/brand";
import {
  PHYSICAL_EXAMS_KEY, parsePhysicalExams, examsForResident, latestExamFor, emptyExam, hasAnyMark,
  INJURY_TYPES, type PhysicalExam, type InjuryType, type BodyMark,
} from "@/lib/physicalExam";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const BODY_IMG = "/physical-exam-body.png";
const bodyImgUrl = () => (typeof window !== "undefined" ? window.location.origin : "") + BODY_IMG;
const cell = "rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 bg-white disabled:bg-gray-50 disabled:text-gray-600";
// What a ticked injury line stores (and prints on the paper form's fill-in line).
const INJURY_MARK = "✓";

// Open the exam on the LifeCare letterhead and trigger the browser print dialog.
function printExam(exam: PhysicalExam, residentName: string, room?: string) {
  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) return;
  const injuries = exam.injuries || {};
  const rows = (from: number, to: number) => INJURY_TYPES.slice(from, to).map((t, i) =>
    `<tr><td class="ln">${esc(injuries[t] || "")}</td><td class="n">${from + i + 1}.</td><td class="t">${esc(t)}</td></tr>`).join("");
  const marks = (exam.bodyMarks || []).map((m) =>
    `<span class="mk" style="left:${m.x}%;top:${m.y}%">${m.n}</span>`).join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Clinical Assessment — ${esc(residentName)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:"Segoe UI",system-ui,-apple-system,Arial,sans-serif;color:#1f2933;margin:0 auto;max-width:800px;padding:34px 40px;font-size:13px}
  ${LIFECARE_BRAND_CSS}
  hr.rule{border:0;border-top:1.5px solid #ced4da;margin:8px 0 16px}
  h1{text-align:center;font-size:18px;font-weight:800;letter-spacing:.02em;margin:0 0 18px}
  .id{margin:3px 0;font-size:14px;font-weight:700}.id b{font-weight:800}
  .section{font-size:13px;letter-spacing:.04em;margin:20px 0 8px;color:#343a40}
  table.inj{width:100%;border-collapse:collapse}table.inj td{padding:3px 4px;vertical-align:bottom}
  table.inj td.ln{width:120px;border-bottom:1px solid #333;text-align:center;font-weight:700}
  table.inj td.n{width:22px;text-align:right;color:#333}table.inj td.t{white-space:nowrap}
  .cols{display:flex;gap:40px}.cols>div{flex:1}
  .bodies{margin-top:22px}.bodies .wrap{position:relative;display:inline-block}.bodies img{max-width:100%;height:auto;max-height:300px;display:block}
  .mk{position:absolute;transform:translate(-50%,-50%);width:18px;height:18px;border-radius:50%;background:#1d4ed8;color:#fff;font-size:11px;font-weight:800;line-height:18px;text-align:center;border:1.5px solid #fff;box-shadow:0 0 0 1px #1d4ed8}
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
  <div class="cols"><div><table class="inj">${rows(0, 5)}</table></div><div><table class="inj">${rows(5, 11)}</table></div></div>
  <div class="bodies"><div class="wrap"><img src="${bodyImgUrl()}" alt="Body diagram — front, back, side">${marks}</div></div>
  ${exam.bodyNotes ? `<div class="notes"><span class="l">Notes:</span> ${esc(exam.bodyNotes).replace(/\n/g, "<br>")}</div>` : ""}
  <div class="sign"><div><div class="l">Examined By:</div><div class="v">${esc(exam.examinedBy || "")}</div></div><div><div class="l">Reviewed By:</div><div class="v"></div></div></div>
</body></html>`);
  w.document.close();
}

// ── Clickable body diagram: drop numbered pins where an injury is ───────────
function BodyDiagram({ marks, editable, onChange }: {
  marks: BodyMark[]; editable: boolean; onChange?: (next: BodyMark[]) => void;
}) {
  const [pen, setPen] = useState(1); // the injury number the next click drops

  const drop = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!editable) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    const id = globalThis.crypto?.randomUUID?.() ?? `mk-${Date.now()}-${marks.length}`;
    onChange?.([...marks, { id, n: pen, x, y }]);
  };

  return (
    <div>
      {editable && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold text-gray-500">Marking pen:</span>
          {INJURY_TYPES.map((t, i) => (
            <button key={t} type="button" onClick={() => setPen(i + 1)} title={t}
              style={{ width: 28, height: 28, minWidth: 0, minHeight: 0, padding: 0, borderRadius: "50%" }}
              className={`inline-flex items-center justify-center text-xs font-bold tabular-nums transition ${pen === i + 1 ? "bg-blue-600 text-white ring-2 ring-blue-300" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
              {i + 1}
            </button>
          ))}
          <span className="ml-1 text-[11px] text-gray-400">Click the body to place <b className="text-gray-600">{pen}. {INJURY_TYPES[pen - 1]}</b> · click a pin to remove</span>
        </div>
      )}
      <div className="relative inline-block" onClick={drop} style={{ cursor: editable ? "crosshair" : "default" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={BODY_IMG} alt="Body diagram — front, back, side" className="block max-w-full" style={{ maxHeight: 300 }} />
        {marks.map((m) => (
          <button key={m.id} type="button" title={`${m.n}. ${INJURY_TYPES[m.n - 1] ?? ""}`}
            onClick={(e) => { e.stopPropagation(); if (editable) onChange?.(marks.filter((x) => x.id !== m.id)); }}
            style={{ left: `${m.x}%`, top: `${m.y}%`, width: 20, height: 20, minWidth: 0, minHeight: 0, padding: 0, borderRadius: "50%" }}
            className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center border-[1.5px] border-white bg-blue-700 text-[11px] font-extrabold leading-none text-white shadow ring-1 ring-blue-700 tabular-nums hover:bg-red-600 hover:ring-red-600">
            {m.n}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Presentation of ONE exam (editable or read-only) ────────────────────────
export function PhysicalExamCard({ exam, residentName, room, editable, onChange, actions }: {
  exam: PhysicalExam; residentName: string; room?: string; editable: boolean;
  onChange?: (next: PhysicalExam) => void; actions?: ReactNode;
}) {
  const injuries = exam.injuries || {};
  const setInjury = (t: InjuryType, v: string) => onChange?.({ ...exam, injuries: { ...injuries, [t]: v } });
  const submitted = exam.status === "SUBMITTED";

  // Each injury line is a tick. Stored as the mark string the paper form / print
  // expects, so older free-text entries still read as ticked (shown beside it).
  const injuryRow = (t: InjuryType, n: number) => {
    const v = (injuries[t] || "").trim();
    return (
      <label key={t} className={`flex items-center gap-2 py-1.5 text-sm text-gray-800 ${editable ? "cursor-pointer" : ""}`}>
        <input type="checkbox" disabled={!editable} checked={v !== ""} onChange={(e) => setInjury(t, e.target.checked ? INJURY_MARK : "")}
          className="h-4 w-4 shrink-0 rounded border-gray-300 accent-[#2E4A48] disabled:opacity-60" />
        <span><span className="tabular-nums text-gray-500">{n}.</span> {t}</span>
        {v && v !== INJURY_MARK && <span className="truncate text-xs text-gray-500">· {v}</span>}
      </label>
    );
  };

  return (
    <div className="rounded-xl border bg-white p-5 sm:p-6" style={{ borderColor: "var(--clinical-line)" }}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-black tracking-wide text-gray-900 sm:text-xl">CLINICAL ASSESSMENT</h2>
            {submitted && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700"><Lock className="h-3 w-3" /> Submitted{exam.submittedAt ? ` · ${new Date(exam.submittedAt).toLocaleDateString()}` : ""}</span>}
          </div>
          <p className="mt-0.5 text-[11px] text-gray-400">Physical Exam · on-admission body check</p>
        </div>
        <button type="button" onClick={() => printExam(exam, residentName, room)} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"><Printer className="h-3.5 w-3.5" /> Print</button>
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

      <div className="mt-5">
        <BodyDiagram marks={exam.bodyMarks || []} editable={editable}
          onChange={(next) => onChange?.({ ...exam, bodyMarks: next })} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-gray-600">Examined by
          <input disabled={!editable} value={exam.examinedBy || ""} onChange={(e) => onChange?.({ ...exam, examinedBy: e.target.value })} placeholder="Staff name" className={`${cell} mt-1 w-full`} />
        </label>
        <label className="text-xs font-medium text-gray-600">Notes / body diagram observations
          <input disabled={!editable} value={exam.bodyNotes || ""} onChange={(e) => onChange?.({ ...exam, bodyNotes: e.target.value })} placeholder="e.g. 2cm laceration, left forearm (front)…" className={`${cell} mt-1 w-full`} />
        </label>
      </div>

      {actions && <div className="mt-4 flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}

// ── Move-in editing controller (draft → submit → lock → new) ────────────────
export default function PhysicalExamForm({ residentId, residentName, room, canEdit = true }: {
  residentId: string; residentName: string; room?: string; canEdit?: boolean;
}) {
  const { data: settingRows, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  const all = useMemo(() => parsePhysicalExams(settingRows.find((r) => (r.key || r.id) === PHYSICAL_EXAMS_KEY)?.value), [settingRows]);
  const latest = useMemo(() => latestExamFor(all, residentId), [all, residentId]);

  const [draft, setDraft] = useState<PhysicalExam | null>(null);
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Resume an unsubmitted draft on first load; otherwise show the latest locked.
  useEffect(() => {
    if (hydrated) return;
    if (latest && latest.status === "DRAFT") setDraft(latest);
    setHydrated(true);
  }, [latest, hydrated]);

  const showing = draft ?? latest;
  const editable = canEdit && !!showing && showing.status === "DRAFT";

  const persist = async (exam: PhysicalExam) => {
    const next = [...all.filter((e) => e.id !== exam.id), exam];
    await upsertRecord("app-settings", PHYSICAL_EXAMS_KEY, { key: PHYSICAL_EXAMS_KEY, value: JSON.stringify(next) });
    await refetch?.();
  };
  const now = () => new Date().toISOString();
  const onChange = (next: PhysicalExam) => setDraft({ ...next, residentName, room, updatedAt: now() });
  const saveDraft = async () => {
    if (!draft) return; setSaving(true);
    try { await persist({ ...draft, status: "DRAFT", createdAt: draft.createdAt || now(), updatedAt: now() }); }
    finally { setSaving(false); }
  };
  const submit = async () => {
    if (!draft || !hasAnyMark(draft)) return; setSaving(true);
    try { const t = now(); await persist({ ...draft, status: "SUBMITTED", submittedAt: t, createdAt: draft.createdAt || t, updatedAt: t }); setDraft(null); }
    finally { setSaving(false); }
  };
  const newExam = () => setDraft({ ...emptyExam(residentId), residentName, room, examinedBy: latest?.examinedBy || "", createdAt: now(), updatedAt: now() });

  if (!showing) {
    return (
      <div className="rounded-xl border bg-white p-8 text-center" style={{ borderColor: "var(--clinical-line)" }}>
        <p className="text-sm text-[var(--clinical-muted)]">No physical exam recorded for this resident yet.</p>
        {canEdit && <button type="button" onClick={newExam} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[var(--clinical-panel)] px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> New Physical Exam</button>}
      </div>
    );
  }

  return (
    <PhysicalExamCard
      exam={showing} residentName={residentName} room={room} editable={editable}
      onChange={editable ? onChange : undefined}
      actions={
        editable ? (
          <>
            <button type="button" onClick={() => void saveDraft()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save draft</button>
            <button type="button" onClick={() => void submit()} disabled={saving || !hasAnyMark(showing)} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--clinical-panel)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Send className="h-4 w-4" /> Submit exam</button>
            <span className="text-[11px] text-[var(--clinical-muted)]">Once submitted the exam is locked. Mark at least one injury (or “None Apparent”) to submit.</span>
          </>
        ) : canEdit ? (
          <>
            <span className="text-[11px] text-[var(--clinical-muted)]">This exam is submitted and locked.</span>
            <button type="button" onClick={newExam} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--clinical-panel)] px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> New Exam</button>
          </>
        ) : null
      }
    />
  );
}

// ── One Care · One Journey — submitted exam history, newest first ───────────
export function PhysicalExamHistory({ residentId, residentName, room }: { residentId: string; residentName: string; room?: string }) {
  const { data: settingRows } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  const exams = useMemo(
    () => examsForResident(parsePhysicalExams(settingRows.find((r) => (r.key || r.id) === PHYSICAL_EXAMS_KEY)?.value), residentId).filter((e) => e.status === "SUBMITTED"),
    [settingRows, residentId],
  );
  if (!exams.length) {
    return <div className="rounded-xl border bg-white p-8 text-center text-sm text-[var(--clinical-muted)]" style={{ borderColor: "var(--clinical-line)" }}>No submitted physical exams yet. Completed exams from Move-in appear here, newest first.</div>;
  }
  return (
    <div className="space-y-5">
      {exams.map((e) => <PhysicalExamCard key={e.id} exam={e} residentName={e.residentName || residentName} room={e.room || room} editable={false} />)}
    </div>
  );
}
