"use client";

/**
 * Routine Generator — read-only 24-hour routine per resident.
 *
 * Translates the resident's care plan (their assessment-domain Goals +
 * Interventions, with any in-progress builder edits from `care_plan_drafts`
 * overlaid) into the workbook's 24-Hour Routine: window care events across
 * Night / Morning / Afternoon. This is the same routine the task materializer
 * dispatches on plan release — here it's a preview, not an editor.
 */

import { useMemo, useState } from "react";
import { Clock, Loader2, Wand2, ShieldCheck, Undo2, Plus, FileDown } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord } from "@/lib/api";
import { createReport } from "@/lib/pdfReport";
import { adaptResident } from "@/lib/adapters";
import { SCORED_DOMAINS } from "@/lib/lifecare/dataset";
import { ASSESSMENTS_V42_KEY, authoritativeAssessmentFor, finalLevel, type AssessmentV42 } from "@/lib/lifecare/assessment";
import { CARE_PLAN_DRAFTS_KEY, parseCarePlanDrafts } from "@/lib/carePlanDraft";
import { type RoutineDomainInput } from "@/lib/lifecare/carePlanRoutine";
import { ASSISTANCE, ASSISTANCE_DISPLAY, ROLE, ROLE_ABBR } from "@/lib/lifecare/assistance";
import { careDayRank } from "@/lib/lifecare/careTask";
import { useToast, Toaster } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import SignatureModal from "@/components/portal/SignatureModal";
import ResidentDailyPerformance from "./ResidentDailyPerformance";
import CareTaskBoard from "./CareTaskBoard";
import RoutineDefinitionCard, { blockReasonFor } from "./RoutineDefinitionCard";
import { ClinicalButton, ClinicalCard, DataState, StatusPill, controlClass } from "./clinical-ui";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const s = (v: unknown) => (v == null ? "" : String(v));

// Care day runs Morning → Afternoon → Night (06:00 → 04:00); tolerate AM/PM/NOC too.
const SHIFT_ORDER = ["Morning", "Afternoon", "Night"];
const shiftLabel = (v: unknown): string => {
  const t = s(v).toLowerCase();
  if (t.startsWith("noc") || t.includes("night")) return "Night";
  if (t.startsWith("am") || t.includes("morning")) return "Morning";
  if (t.startsWith("pm") || t.includes("afternoon")) return "Afternoon";
  return "Anytime";
};
// Shift owner (AM/PM/NOC) for a 24-hour HH:MM — Night 22:00–06:00 / Morning 06–14 / Afternoon 14–22.
const ownerFromTime = (hhmm: string): string => {
  const h = Number(hhmm.split(":")[0]);
  if (!Number.isFinite(h)) return "";
  if (h >= 6 && h < 14) return "AM";
  if (h >= 14 && h < 22) return "PM";
  return "NOC";
};
const normHHMM = (raw: string): string | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
};
const schedTimeKey = (d: Row): string => {
  const sc = d.schedule;
  const obj = sc && typeof sc === "object" ? sc : (() => { try { return JSON.parse(s(sc) || "{}"); } catch { return {}; } })();
  return (Array.isArray(obj.times) && obj.times[0]) || obj.window || "99:99";
};

const parseAssessments = (raw: string | null | undefined): AssessmentV42[] => {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? (v as AssessmentV42[]) : []; } catch { return []; }
};

export default function RoutineGeneratorBoard({ residentId: residentIdProp, view = "timeline", approvedOnly = false }: { residentId?: string; view?: "timeline" | "caretask" | "performance"; approvedOnly?: boolean } = {}) {
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const { data: settingRows } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const [resId, setResId] = useState(residentIdProp || "");
  const [generating, setGenerating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [showSuppressed, setShowSuppressed] = useState(false);
  const { toasts, toast, dismiss } = useToast();
  const { confirm, confirmDialog } = useConfirm();

  // Draft→Review→Approve definitions (sub-project #3). Fetch by resident only and
  // filter status client-side: the generic /api/db f_ filter is exact-equals, so
  // f_status=DRAFT,RETURNED would match nothing.
  // ponytail: client-side status filter; move to the dedicated route's f_status handling if row counts grow.
  const defsQ = useLiveQuery<Row>("routine-definitions", { tables: ["RoutineEventDefinition"], query: resId ? `f_residentId=${resId}&take=500` : "take=1", enabled: !!resId });
  const modelMissing = /unknown model|not found/i.test(s(defsQ.error));
  const reviewDefs = useMemo(() => (defsQ.data || []).filter((d) => ["DRAFT", "RETURNED"].includes(s(d.status))), [defsQ.data]);
  const suppressedDefs = useMemo(() => (defsQ.data || []).filter((d) => s(d.status) === "CANCELLED"), [defsQ.data]);
  const blockedCount = useMemo(() => reviewDefs.filter((d) => !!blockReasonFor(d)).length, [reviewDefs]);
  const groupedDefs = useMemo(() => {
    const groups = new Map<string, Row[]>();
    for (const d of reviewDefs) { const g = shiftLabel(d.shiftOwner); (groups.get(g) ?? groups.set(g, []).get(g)!).push(d); }
    for (const arr of groups.values()) arr.sort((a, b) => careDayRank(schedTimeKey(a)) - careDayRank(schedTimeKey(b)));
    return [...SHIFT_ORDER, "Anytime"].filter((k) => groups.has(k)).map((k) => [k, groups.get(k)!] as const);
  }, [reviewDefs]);

  // The live APPROVED routine — shown read-only so the nurse can view what's active
  // after approval (editing a live event creates a new version via the card).
  const approvedDefs = useMemo(() => (defsQ.data || []).filter((d) => s(d.status) === "APPROVED"), [defsQ.data]);
  const groupedApproved = useMemo(() => {
    const groups = new Map<string, Row[]>();
    for (const d of approvedDefs) { const g = shiftLabel(d.shiftOwner); (groups.get(g) ?? groups.set(g, []).get(g)!).push(d); }
    for (const arr of groups.values()) arr.sort((a, b) => careDayRank(schedTimeKey(a)) - careDayRank(schedTimeKey(b)));
    return [...SHIFT_ORDER, "Anytime"].filter((k) => groups.has(k)).map((k) => [k, groups.get(k)!] as const);
  }, [approvedDefs]);

  const assessments = useMemo(() => parseAssessments(settingRows.find((r) => (r.key || r.id) === ASSESSMENTS_V42_KEY)?.value), [settingRows]);
  const drafts = useMemo(() => parseCarePlanDrafts(settingRows.find((r) => (r.key || r.id) === CARE_PLAN_DRAFTS_KEY)?.value), [settingRows]);

  const resident = residents.find((r: Row) => s(r.id) === resId);
  // Authoritative assessment for this resident — matched by residentId, linked
  // admission, OR name token-set (not just an exact residentId match). Fixes the
  // "No Final LOC" block on residents whose validated assessment is keyed by
  // admission/name (e.g. captured pre-admission) rather than the live resident id.
  const latestAssessment = useMemo(
    () => authoritativeAssessmentFor(assessments, { residentId: resId, residentName: s(resident?.name) }),
    [assessments, resId, resident],
  );
  const finalLoc = useMemo(() => {
    const lvl = s((latestAssessment ? finalLevel(latestAssessment) : "") ?? "").match(/(\d)/)?.[1];
    return lvl ? `LOC ${lvl}` : "";
  }, [latestAssessment]);

  // Per-domain care from that same assessment; in-progress builder edits (draft.domainPlan) win.
  const domainInputs = useMemo<RoutineDomainInput[]>(() => {
    if (!resId) return [];
    const dm = latestAssessment?.domains || {};
    const saved = new Map((drafts[resId]?.domainPlan || []).map((d) => [d.code, d]));
    const out: RoutineDomainInput[] = [];
    for (const d of SCORED_DOMAINS) {
      const entry = dm[d.code];
      if (!entry || typeof entry.score !== "number") continue;
      const sv = saved.get(d.code);
      if (sv && sv.included === false) continue; // dropped in the builder
      const score = Math.max(0, Math.min(4, entry.score ?? 0));
      out.push({
        code: d.code,
        name: d.name,
        goal: sv?.goal ?? (entry.goalNote?.trim() || d.goalDefaults?.[score] || ""),
        interventions: sv?.interventions ?? (d.interventionDefaults?.[score] || []).map((x) => x.trim()).filter(Boolean),
      });
    }
    return out;
  }, [latestAssessment, drafts, resId]);

  // Per-domain score, to seed the Resident Daily Performance table's assistance column.
  const scoreByCode = useMemo(() => {
    const dm = latestAssessment?.domains || {};
    const o: Record<string, number> = {};
    for (const d of SCORED_DOMAINS) { const e = dm[d.code]; if (e && typeof e.score === "number") o[d.code] = Math.max(0, Math.min(4, e.score)); }
    return o;
  }, [latestAssessment]);
  // ── Draft→Review→Approve (sub-project #3) ────────────────────────────────────
  const post = async (path: string, body: unknown) => {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || res.statusText);
    return json;
  };

  const generateDraft = async () => {
    if (!resId || generating) return;
    if (!finalLoc) { toast("error", "No Final LOC", "Complete and validate the resident's assessment first (Final LOC is required to generate a routine)."); return; }
    if (reviewDefs.length && !(await confirm({ title: "Regenerate draft?", description: "This replaces the current unapproved draft. Approved events are untouched.", confirmText: "Regenerate", destructive: true }))) return;
    setGenerating(true);
    try {
      // v1: send Final LOC + the resident's validated domains (score-only). The
      // route's assembleRoutine fills the rest. ponytail: minimal domains payload; enrich if the engine needs more context.
      const domains = Object.fromEntries((domainInputs).map((d) => [d.code, { score: scoreByCode[d.code] ?? 0 }]));
      const r = await post("/api/routine/generate-draft", { residentId: resId, finalLoc, assessmentVersion: s(latestAssessment?.updatedAt), domains, activeConditions: [], memoryIntensity: null, orders: [], preferences: {}, effectiveDate: null });
      await defsQ.refetch?.();
      toast("success", "Draft generated", `${r?.count ?? 0} event${r?.count === 1 ? "" : "s"} drafted for review.`);
    } catch (e) { toast("error", "Couldn't generate", e instanceof Error ? e.message : "Please try again."); }
    finally { setGenerating(false); }
  };

  const approve = async () => {
    setApproving(true);
    try {
      const r = await post("/api/routine/approve", { residentId: resId });
      await defsQ.refetch?.();
      toast("success", "Routine approved", `${r?.approved ?? 0} event${r?.approved === 1 ? "" : "s"} approved.${r?.blocked ? ` ${r.blocked} still blocked.` : ""}`);
    } catch (e) { toast("error", "Couldn't approve", e instanceof Error ? e.message : "Please try again."); }
    finally { setApproving(false); }
  };

  const returnForRevision = async () => {
    const reason = window.prompt("Reason for returning this draft for revision:");
    if (!reason) return;
    try {
      // Return every review row (whole-draft return); the route accepts a single id.
      await Promise.all(reviewDefs.map((d) => post("/api/routine/return", { id: s(d.id), reason })));
      await defsQ.refetch?.();
      toast("success", "Returned for revision", reason);
    } catch (e) { toast("error", "Couldn't return", e instanceof Error ? e.message : "Please try again."); }
  };

  const suppress = async (d: Row) => {
    const reason = window.prompt(`Suppress "${s(d.name)}"? Reason:`);
    if (!reason) return;
    try { await updateRecord("routine-definitions", s(d.id), { status: "CANCELLED", revisionReason: reason }); await defsQ.refetch?.(); toast("success", "Event suppressed", s(d.name)); }
    catch (e) { toast("error", "Couldn't suppress", e instanceof Error ? e.message : "Please try again."); }
  };

  // Add a custom care event via a small form (name · time · assistance · assisted-by).
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ activity: "", time: "", assistance: "Setup/Cueing", assistedBy: "Caregiver" });
  const openAddEvent = () => {
    if (!resId) { toast("error", "No resident", "Select a resident first."); return; }
    setAddForm({ activity: "", time: "", assistance: "Setup/Cueing", assistedBy: "Caregiver" });
    setShowAdd(true);
  };
  const submitAddEvent = async () => {
    const name = addForm.activity.trim();
    if (!name) { toast("error", "Activity required", "Enter an activity name."); return; }
    const hhmm = addForm.time ? normHHMM(addForm.time) : null;
    if (addForm.time && !hhmm) { toast("error", "Invalid time", "Pick a valid time."); return; }
    try {
      await createRecord("routine-definitions", {
        residentId: resId, status: "DRAFT", version: 1, name, instructions: "",
        sourceLocBundleId: null,
        frequencyMethod: hhmm ? "exact_time" : "defined_window",
        schedule: hhmm ? { times: [hhmm] } : {},
        shiftOwner: hhmm ? ownerFromTime(hhmm) : null,
        criticality: "Routine", assistanceLevel: addForm.assistance,
        responsibleRole: addForm.assistedBy.replace(/ /g, "_"),
        resultSchemaKey: "General Observation", exceptionSet: [], orderRequired: false,
      });
      await defsQ.refetch?.();
      setShowAdd(false);
      toast("success", "Event added", name);
    } catch (e) { toast("error", "Couldn't add event", e instanceof Error ? e.message : "Please try again."); }
  };

  // Structured, self-contained PDF of the APPROVED routine, grouped by shift.
  const timeText = (d: Row) => { const t = schedTimeKey(d); return t === "99:99" ? "Anytime" : t; };
  const downloadRoutinePdf = () => {
    if (!resident) return;
    const rep = createReport();
    rep.header("24-Hour Routine", "Senior Living Management System", [
      s(resident.name),
      `${finalLoc ? finalLoc + " · " : ""}Room ${s(resident.room)}`,
      `Approved routine · ${approvedDefs.length} event${approvedDefs.length === 1 ? "" : "s"} · Generated ${new Date().toLocaleString()}`,
    ]);
    if (!approvedDefs.length) rep.text("No approved routine yet.", { size: 9, color: 140 });
    else groupedApproved.forEach(([shift, defs]) => {
      rep.heading(`${shift} (${defs.length})`);
      rep.table([40, 110, 330, 440], ["Time", "Activity", "Assistance", "Assisted By"], defs.map((d) => {
        const role = s(d.responsibleRole).replace(/_/g, " ");
        return [timeText(d), s(d.name), ASSISTANCE_DISPLAY[d.assistanceLevel as keyof typeof ASSISTANCE_DISPLAY] ?? s(d.assistanceLevel), ROLE_ABBR[role as keyof typeof ROLE_ABBR] ?? role];
      }));
    });
    rep.save(`routine-${s(resident.name).toLowerCase().replace(/\s+/g, "-")}.pdf`);
  };

  return (
    <div className="space-y-4">
      {!residentIdProp && (
        <ClinicalCard className="p-4 sm:p-5">
          <label htmlFor="rg-res" className="mb-1.5 block text-sm font-semibold text-[var(--clinical-ink)]">Select Resident</label>
          <select id="rg-res" value={resId} onChange={(e) => setResId(e.target.value)} className={`${controlClass} max-w-md`}>
            <option value="">Choose a resident…</option>
            {residents.map((r: Row) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — Rm {s(r.room)}</option>)}
          </select>
          <p className="mt-2 text-[11px] text-[var(--clinical-muted)]">The 24-hour routine is generated from the resident&apos;s care plan and is what caregivers receive each shift once the plan is approved.</p>
        </ClinicalCard>
      )}

      {/* ── Draft → Review → Approve (sub-project #3) ── timeline view only ── */}
      {resId && view === "timeline" && (
        <ClinicalCard top="teal" className="p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-[var(--clinical-panel)]" />
              <h2 className="text-sm font-bold text-[var(--clinical-ink)]">{s(resident?.name)} · {approvedOnly ? "24-Hour Routine" : "Routine Review"}</h2>
              <span className="text-[11px] font-medium text-[var(--clinical-muted)]">{approvedOnly ? `${approvedDefs.length} event${approvedDefs.length === 1 ? "" : "s"}` : `${reviewDefs.length} draft event${reviewDefs.length === 1 ? "" : "s"}`}{finalLoc ? ` · ${finalLoc}` : ""}</span>
              {!approvedOnly && blockedCount > 0 && <StatusPill status="CRITICAL">{blockedCount} blocked</StatusPill>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!approvedOnly && (
                <>
                  <ClinicalButton variant="secondary" size="sm" onClick={generateDraft} disabled={generating || defsQ.loading}>
                    {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} Generate draft
                  </ClinicalButton>
                  {reviewDefs.length > 0 && <ClinicalButton variant="secondary" size="sm" onClick={openAddEvent}><Plus className="h-4 w-4" /> Add event</ClinicalButton>}
                  {reviewDefs.length > 0 && <ClinicalButton variant="ghost" size="sm" onClick={returnForRevision}><Undo2 className="h-4 w-4" /> Return</ClinicalButton>}
                  {reviewDefs.length > 0 && (
                    <ClinicalButton variant="primary" size="sm" onClick={() => setShowPin(true)} disabled={approving || blockedCount > 0}
                      title={blockedCount > 0 ? "Resolve all blocked events before approving (Rule 21)" : "PIN-sign to approve this routine"}>
                      {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Approve routine
                    </ClinicalButton>
                  )}
                </>
              )}
              {approvedDefs.length > 0 && <ClinicalButton variant="secondary" size="sm" onClick={downloadRoutinePdf}><FileDown className="h-4 w-4" /> Export PDF</ClinicalButton>}
            </div>
          </div>
          {!approvedOnly && (
            <>
              {blockedCount > 0 && (
                <div className="mb-3 rounded-lg px-3 py-2 text-[11px] font-semibold text-white" style={{ backgroundColor: "var(--clinical-coral)" }}>
                  {blockedCount} event{blockedCount === 1 ? "" : "s"} blocked — attach the required order(s) or resolve the assistance conflict before approving.
                </div>
              )}
              <DataState
                loading={defsQ.loading && !defsQ.data.length}
                empty={reviewDefs.length === 0}
                emptyTitle={modelMissing ? "Routine tables not ready" : "No draft routine yet"}
                emptyHint={modelMissing ? "The routine definition tables aren't set up yet. Once the database is migrated, generate a draft here." : "Generate a draft from the resident's approved Final LOC to review and approve their 24-hour routine."}
                emptyAction={!modelMissing && <ClinicalButton variant="primary" size="sm" onClick={generateDraft} disabled={generating}><Wand2 className="h-4 w-4" /> Generate draft</ClinicalButton>}
              >
                <div className="space-y-4">
                  {groupedDefs.map(([shift, defs]) => (
                    <div key={shift}>
                      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--clinical-muted)]">{shift} <span className="font-medium normal-case">· {defs.length} event{defs.length === 1 ? "" : "s"}</span></p>
                      <div className="space-y-2">
                        {defs.map((d) => (
                          <div key={s(d.id)}>
                            <RoutineDefinitionCard def={d} onChanged={() => defsQ.refetch?.()} />
                            <button onClick={() => suppress(d)} className="mt-1 text-[11px] font-semibold text-[var(--clinical-coral)]">Suppress</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </DataState>
            </>
          )}
          {approvedDefs.length > 0 && (
            <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--clinical-line)" }}>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--clinical-green)" }}>
                Approved routine · {approvedDefs.length} event{approvedDefs.length === 1 ? "" : "s"}
                <span className="font-medium normal-case text-[var(--clinical-muted)]"> — live; caregivers receive this each shift. Editing a live event creates a new version.</span>
              </p>
              <div className="space-y-4">
                {groupedApproved.map(([shift, defs]) => (
                  <div key={shift}>
                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--clinical-muted)]">{shift} <span className="font-medium normal-case">· {defs.length} event{defs.length === 1 ? "" : "s"}</span></p>
                    <div className="space-y-2">
                      {defs.map((d) => <RoutineDefinitionCard key={s(d.id)} def={d} onChanged={() => defsQ.refetch?.()} readOnly />)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!approvedOnly && suppressedDefs.length > 0 && (
            <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--clinical-line)" }}>
              <button onClick={() => setShowSuppressed((v) => !v)} className="text-[11px] font-semibold text-[var(--clinical-muted)]">
                {showSuppressed ? "Hide" : "Show"} suppressed ({suppressedDefs.length})
              </button>
              {showSuppressed && (
                <div className="mt-2 space-y-1.5">
                  {suppressedDefs.map((d) => (
                    <div key={s(d.id)} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-[11px] text-[var(--clinical-muted)] line-through" style={{ borderColor: "var(--clinical-line)" }}>
                      <span>{s(d.name)} · {ROLE_ABBR[(s(d.responsibleRole).replace(/_/g, " ") as keyof typeof ROLE_ABBR)] ?? "CGs"}</span>
                      <span className="no-underline">{s(d.revisionReason)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </ClinicalCard>
      )}

      {/* Care Task + Resident Daily Performance draw from the APPROVED routine
          definitions (approvedDefs), not the assessment-derived preview. */}
      {resId && (view === "caretask" || view === "performance") && (
        <ClinicalCard className="p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-[var(--clinical-panel)]" />
            <h2 className="text-sm font-bold text-[var(--clinical-ink)]">{s(resident?.name)} · {view === "caretask" ? "Care Task" : "Resident Daily Performance"}</h2>
          </div>
          {approvedDefs.length === 0 ? (
            <p className="text-sm text-[var(--clinical-muted)]">No approved 24-hour routine yet. Approve the resident&apos;s routine in <b>24-Hour Routine</b> first{view === "caretask" ? " to seed the Care Task" : " to populate the monthly grid"}.</p>
          ) : view === "caretask" ? (
            <CareTaskBoard key={resId} residentId={resId} approvedDefs={approvedDefs} residentName={s(resident?.name)} readOnly={approvedOnly} />
          ) : (
            <ResidentDailyPerformance key={resId} residentId={resId} approvedDefs={approvedDefs} residentName={s(resident?.name)} />
          )}
        </ClinicalCard>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowAdd(false)}>
          <div className="w-full max-w-md rounded-xl border p-5 shadow-xl" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)" }} onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-sm font-bold text-[var(--clinical-ink)]">Add care event</h3>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--clinical-muted)]">Activity</span>
                <input autoFocus value={addForm.activity} onChange={(e) => setAddForm((f) => ({ ...f, activity: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") void submitAddEvent(); }}
                  placeholder="e.g. Physiotherapy" className={controlClass} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--clinical-muted)]">Time</span>
                  <input type="time" lang="en-US" value={addForm.time} onChange={(e) => setAddForm((f) => ({ ...f, time: e.target.value }))} className={controlClass} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--clinical-muted)]">Level of assistance</span>
                  <select value={addForm.assistance} onChange={(e) => setAddForm((f) => ({ ...f, assistance: e.target.value }))} className={controlClass}>
                    {ASSISTANCE.map((a) => <option key={a} value={a}>{ASSISTANCE_DISPLAY[a]}</option>)}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--clinical-muted)]">Assisted by</span>
                <select value={addForm.assistedBy} onChange={(e) => setAddForm((f) => ({ ...f, assistedBy: e.target.value }))} className={controlClass}>
                  {ROLE.map((r) => <option key={r} value={r}>{ROLE_ABBR[r]} — {r}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <ClinicalButton variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Cancel</ClinicalButton>
              <ClinicalButton variant="primary" size="sm" onClick={submitAddEvent}><Plus className="h-4 w-4" /> Add event</ClinicalButton>
            </div>
          </div>
        </div>
      )}

      <SignatureModal open={showPin} onClose={() => setShowPin(false)} onSigned={approve} mode="sign"
        title="Approve 24-hour routine" description={`Enter your 4-digit signing PIN to approve ${s(resident?.name) || "this resident"}'s routine. Approved events become active on their effective date.`} />
      {confirmDialog}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
