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
import { Clock, Send, Loader2, CheckCircle2, Wand2, ShieldCheck, Undo2, Plus } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord } from "@/lib/api";
import { adaptResident } from "@/lib/adapters";
import { SCORED_DOMAINS } from "@/lib/lifecare/dataset";
import { ASSESSMENTS_V42_KEY, type AssessmentV42, type DomainEntry } from "@/lib/lifecare/assessment";
import { CARE_PLAN_DRAFTS_KEY, parseCarePlanDrafts } from "@/lib/carePlanDraft";
import { generateRoutine, type RoutineDomainInput } from "@/lib/lifecare/carePlanRoutine";
import { dispatchResidentRoutine } from "@/lib/carePlanGen";
import { bundlesForLoc } from "@/lib/lifecare/locBundles";
import { defaultRole, ROLE_ABBR } from "@/lib/lifecare/assistance";
import { schemaFor } from "@/lib/lifecare/resultSchema";
import { useToast, Toaster } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import SignatureModal from "@/components/portal/SignatureModal";
import RoutineTimeline from "./RoutineTimeline";
import ResidentDailyPerformance from "./ResidentDailyPerformance";
import RoutineDefinitionCard, { blockReasonFor } from "./RoutineDefinitionCard";
import { ClinicalButton, ClinicalCard, DataState, StatusPill, controlClass } from "./clinical-ui";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const s = (v: unknown) => (v == null ? "" : String(v));

// shiftOwner (Night/Morning/Afternoon) grouping order; tolerate the engine's AM/PM/NOC too.
const SHIFT_ORDER = ["Night", "Morning", "Afternoon"];
const shiftLabel = (v: unknown): string => {
  const t = s(v).toLowerCase();
  if (t.startsWith("noc") || t.includes("night")) return "Night";
  if (t.startsWith("am") || t.includes("morning")) return "Morning";
  if (t.startsWith("pm") || t.includes("afternoon")) return "Afternoon";
  return "Anytime";
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
const STATUS_RANK: Record<string, number> = { VALIDATED: 3, COMPLETED: 2, DRAFT: 1, SUPERSEDED: 0 };
const latestDomains = (all: AssessmentV42[], residentId: string): Partial<Record<string, DomainEntry>> | null => {
  const mine = all.filter((a) => s(a.layer1?.residentId) === residentId && a.domains && Object.keys(a.domains).length);
  if (!mine.length) return null;
  mine.sort((a, b) => (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0) || s(b.updatedAt).localeCompare(s(a.updatedAt)));
  return mine[0].domains;
};

export default function RoutineGeneratorBoard({ residentId: residentIdProp, view = "timeline" }: { residentId?: string; view?: "timeline" | "performance" } = {}) {
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const { data: settingRows, loading, error } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  const cpQ = useLiveQuery<Row>("care-plans", { query: "take=300", tables: ["CarePlan"] });
  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const [resId, setResId] = useState(residentIdProp || "");
  const [sending, setSending] = useState(false);
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
    for (const arr of groups.values()) arr.sort((a, b) => schedTimeKey(a).localeCompare(schedTimeKey(b)));
    return [...SHIFT_ORDER, "Anytime"].filter((k) => groups.has(k)).map((k) => [k, groups.get(k)!] as const);
  }, [reviewDefs]);

  // The live APPROVED routine — shown read-only so the nurse can view what's active
  // after approval (editing a live event creates a new version via the card).
  const approvedDefs = useMemo(() => (defsQ.data || []).filter((d) => s(d.status) === "APPROVED"), [defsQ.data]);
  const groupedApproved = useMemo(() => {
    const groups = new Map<string, Row[]>();
    for (const d of approvedDefs) { const g = shiftLabel(d.shiftOwner); (groups.get(g) ?? groups.set(g, []).get(g)!).push(d); }
    for (const arr of groups.values()) arr.sort((a, b) => schedTimeKey(a).localeCompare(schedTimeKey(b)));
    return [...SHIFT_ORDER, "Anytime"].filter((k) => groups.has(k)).map((k) => [k, groups.get(k)!] as const);
  }, [approvedDefs]);

  const assessments = useMemo(() => parseAssessments(settingRows.find((r) => (r.key || r.id) === ASSESSMENTS_V42_KEY)?.value), [settingRows]);
  const drafts = useMemo(() => parseCarePlanDrafts(settingRows.find((r) => (r.key || r.id) === CARE_PLAN_DRAFTS_KEY)?.value), [settingRows]);

  // Resolve the resident's per-domain care: assessment scores seed Goal +
  // Interventions; any in-progress builder edits (draft.domainPlan) win.
  const domainInputs = useMemo<RoutineDomainInput[]>(() => {
    if (!resId) return [];
    const dm = latestDomains(assessments, resId) || {};
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
  }, [assessments, drafts, resId]);

  const routine = useMemo(() => generateRoutine(domainInputs), [domainInputs]);
  // Per-domain score, to seed the Resident Daily Performance table's assistance column.
  const scoreByCode = useMemo(() => {
    const dm = resId ? latestDomains(assessments, resId) || {} : {};
    const o: Record<string, number> = {};
    for (const d of SCORED_DOMAINS) { const e = dm[d.code]; if (e && typeof e.score === "number") o[d.code] = Math.max(0, Math.min(4, e.score)); }
    return o;
  }, [assessments, resId]);
  const resident = residents.find((r: Row) => s(r.id) === resId);
  // Latest assessment for this resident → Final LOC ("Level 3" → "LOC 3") for generate-draft.
  const latestAssessment = useMemo(() => {
    const mine = assessments.filter((a) => s(a.layer1?.residentId) === resId);
    mine.sort((a, b) => (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0) || s(b.updatedAt).localeCompare(s(a.updatedAt)));
    return mine[0];
  }, [assessments, resId]);
  const finalLoc = useMemo(() => {
    const lvl = s(latestAssessment?.layer3?.finalLevel).match(/(\d)/)?.[1];
    return lvl ? `LOC ${lvl}` : "";
  }, [latestAssessment]);
  // Governance: the routine may only be SENT once the resident's care plan is
  // approved/released (ACTIVE). Dispatch materializes from that active plan.
  const activePlan = useMemo(() => (cpQ.data || []).find((p) => s(p.residentId) === resId && s(p.status) === "ACTIVE"), [cpQ.data, resId]);

  const sendRoutine = async () => {
    if (!resId || sending) return;
    const name = s(resident?.name) || "this resident";
    const ok = await Swal.fire({
      icon: "question", title: "Send routine to caregivers?",
      html: `Today's 24-hour routine for <b>${name}</b> will be dispatched to the rostered caregivers for each shift.`,
      showCancelButton: true, confirmButtonText: "Send routine", cancelButtonText: "Cancel",
    });
    if (!ok.isConfirmed) return;
    setSending(true);
    try {
      const created = await dispatchResidentRoutine(resId);
      await cpQ.refetch?.();
      Swal.fire({
        icon: "success", title: created > 0 ? "Routine sent" : "Routine up to date",
        html: created > 0
          ? `<b>${created}</b> task${created === 1 ? "" : "s"} dispatched to today's scheduled caregivers.`
          : "No new tasks — today's routine is already on the caregivers' lists (or no caregiver is scheduled yet).",
        timer: 3200, showConfirmButton: false,
      });
    } catch (e) {
      Swal.fire("Couldn't send", e instanceof Error ? e.message : "Please try again.", "error");
    } finally { setSending(false); }
  };

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

  const addEvent = async () => {
    if (!finalLoc) { toast("error", "No Final LOC", "Set the resident's Final LOC first."); return; }
    const bundles = bundlesForLoc(finalLoc);
    const choices = bundles.map((b, i) => `${i + 1}. ${b.careEvent}`).join("\n");
    const pick = window.prompt(`Add an event for ${finalLoc}.\nEnter a number, or type a custom event name:\n\n${choices}`);
    if (!pick) return;
    const idx = Number(pick) - 1;
    const b = Number.isInteger(idx) && bundles[idx] ? bundles[idx] : undefined;
    const name = b ? b.careEvent : pick.trim();
    const resultSchemaKey = b?.resultSchemaKey || "Care Note";
    try {
      let schemaOk = resultSchemaKey;
      try { schemaFor(schemaOk); } catch { schemaOk = "Care Note"; }
      await createRecord("routine-definitions", {
        residentId: resId, status: "DRAFT", version: 1, name, instructions: b?.purpose || "",
        sourceLocBundleId: b?.bundleEventId || null, frequencyMethod: b?.frequencyMethod || "defined_window",
        schedule: b?.defaultTimeShift ? { window: b.defaultTimeShift } : {}, shiftOwner: null,
        criticality: b?.criticality || "Routine", responsibleRole: (defaultRole(b?.category || "", !!b?.orderRequired)).replace(/ /g, "_"),
        resultSchemaKey: schemaOk, exceptionSet: [], orderRequired: !!b?.orderRequired,
      });
      await defsQ.refetch?.();
      toast("success", "Event added", name);
    } catch (e) { toast("error", "Couldn't add event", e instanceof Error ? e.message : "Please try again."); }
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
              <h2 className="text-sm font-bold text-[var(--clinical-ink)]">{s(resident?.name)} · Routine Review</h2>
              <span className="text-[11px] font-medium text-[var(--clinical-muted)]">{reviewDefs.length} draft event{reviewDefs.length === 1 ? "" : "s"}{finalLoc ? ` · ${finalLoc}` : ""}</span>
              {blockedCount > 0 && <StatusPill status="CRITICAL">{blockedCount} blocked</StatusPill>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ClinicalButton variant="secondary" size="sm" onClick={generateDraft} disabled={generating || defsQ.loading}>
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} Generate draft
              </ClinicalButton>
              {reviewDefs.length > 0 && <ClinicalButton variant="secondary" size="sm" onClick={addEvent}><Plus className="h-4 w-4" /> Add event</ClinicalButton>}
              {reviewDefs.length > 0 && <ClinicalButton variant="ghost" size="sm" onClick={returnForRevision}><Undo2 className="h-4 w-4" /> Return</ClinicalButton>}
              {reviewDefs.length > 0 && (
                <ClinicalButton variant="primary" size="sm" onClick={() => setShowPin(true)} disabled={approving || blockedCount > 0}
                  title={blockedCount > 0 ? "Resolve all blocked events before approving (Rule 21)" : "PIN-sign to approve this routine"}>
                  {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Approve routine
                </ClinicalButton>
              )}
            </div>
          </div>
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
          {suppressedDefs.length > 0 && (
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

      <DataState loading={loading || resQ.loading} error={error ? String(error) : undefined} empty={false}>
        {!resId ? (
          <p className="px-1 text-sm text-[var(--clinical-muted)]">Choose a resident to generate their 24-hour routine.</p>
        ) : routine.length === 0 ? (
          view === "performance" ? (
            <ClinicalCard className="p-4 text-sm text-[var(--clinical-muted)]">
              No routine yet for {s(resident?.name) || "this resident"}. Complete their <b>Resident Assessment</b> and build a care plan in the <b>Care Plan Generator</b> first.
            </ClinicalCard>
          ) : null
        ) : (
          <ClinicalCard className="p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-[var(--clinical-panel)]" />
                <h2 className="text-sm font-bold text-[var(--clinical-ink)]">{s(resident?.name)} · {view === "performance" ? "Resident Daily Performance" : "24-Hour Routine (care-plan preview)"}</h2>
                <span className="text-[11px] font-medium text-[var(--clinical-muted)]">{routine.length} care event{routine.length === 1 ? "" : "s"}</span>
              </div>
              {view === "timeline" && (
                <div className="flex items-center gap-2">
                  {activePlan ? <StatusPill status="ACTIVE" /> : <span className="rounded-full bg-[var(--clinical-surface-2)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-[var(--clinical-muted)]">Plan not approved</span>}
                  <ClinicalButton variant="primary" size="sm" onClick={sendRoutine} disabled={sending || !activePlan}
                    title={activePlan ? "Dispatch today's routine to the rostered caregivers" : "Approve the care plan in Care Plan Generator to enable sending"}>
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Send Routine to Caregivers
                  </ClinicalButton>
                </div>
              )}
            </div>
            {view === "timeline" && !activePlan && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] text-[var(--clinical-muted)]" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface-2)" }}>
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--clinical-muted)]" />
                <span>This is a preview. Approve the resident&apos;s care plan in <b>Care Plan Generator</b> to send the routine to caregivers.</span>
              </div>
            )}
            {view === "performance"
              ? <ResidentDailyPerformance key={resId} residentId={resId} routine={routine} scoreByCode={scoreByCode} />
              : <RoutineTimeline events={routine} />}
          </ClinicalCard>
        )}
      </DataState>

      <SignatureModal open={showPin} onClose={() => setShowPin(false)} onSigned={approve} mode="sign"
        title="Approve 24-hour routine" description={`Enter your 4-digit signing PIN to approve ${s(resident?.name) || "this resident"}'s routine. Approved events become active on their effective date.`} />
      {confirmDialog}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
