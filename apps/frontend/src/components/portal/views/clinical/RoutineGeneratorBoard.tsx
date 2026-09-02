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
import { Clock, Send, Loader2, CheckCircle2 } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { SCORED_DOMAINS } from "@/lib/lifecare/dataset";
import { ASSESSMENTS_V42_KEY, type AssessmentV42, type DomainEntry } from "@/lib/lifecare/assessment";
import { CARE_PLAN_DRAFTS_KEY, parseCarePlanDrafts } from "@/lib/carePlanDraft";
import { generateRoutine, type RoutineDomainInput } from "@/lib/lifecare/carePlanRoutine";
import { dispatchResidentRoutine } from "@/lib/carePlanGen";
import RoutineTimeline from "./RoutineTimeline";
import { ClinicalButton, ClinicalCard, DataState, StatusPill, controlClass } from "./clinical-ui";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const s = (v: unknown) => (v == null ? "" : String(v));

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

export default function RoutineGeneratorBoard({ residentId: residentIdProp }: { residentId?: string } = {}) {
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const { data: settingRows, loading, error } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  const cpQ = useLiveQuery<Row>("care-plans", { query: "take=300", tables: ["CarePlan"] });
  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const [resId, setResId] = useState(residentIdProp || "");
  const [sending, setSending] = useState(false);

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
  const resident = residents.find((r: Row) => s(r.id) === resId);
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

      <DataState loading={loading || resQ.loading} error={error ? String(error) : undefined} empty={false}>
        {!resId ? (
          <p className="px-1 text-sm text-[var(--clinical-muted)]">Choose a resident to generate their 24-hour routine.</p>
        ) : routine.length === 0 ? (
          <ClinicalCard className="p-4 text-sm text-[var(--clinical-muted)]">
            No routine yet for {s(resident?.name) || "this resident"}. Complete their <b>Resident Assessment</b> and build a care plan in the <b>Care Plan Generator</b> first.
          </ClinicalCard>
        ) : (
          <ClinicalCard className="p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-[var(--clinical-panel)]" />
                <h2 className="text-sm font-bold text-[var(--clinical-ink)]">{s(resident?.name)} · 24-Hour Routine</h2>
                <span className="text-[11px] font-medium text-[var(--clinical-muted)]">{routine.length} care event{routine.length === 1 ? "" : "s"}</span>
              </div>
              <div className="flex items-center gap-2">
                {activePlan ? <StatusPill status="ACTIVE" /> : <span className="rounded-full bg-[var(--clinical-surface-2)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-[var(--clinical-muted)]">Plan not approved</span>}
                <ClinicalButton variant="primary" size="sm" onClick={sendRoutine} disabled={sending || !activePlan}
                  title={activePlan ? "Dispatch today's routine to the rostered caregivers" : "Approve the care plan in Care Plan Generator to enable sending"}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send Routine to Caregivers
                </ClinicalButton>
              </div>
            </div>
            {!activePlan && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] text-[var(--clinical-muted)]" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface-2)" }}>
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--clinical-muted)]" />
                <span>This is a preview. Approve the resident&apos;s care plan in <b>Care Plan Generator</b> to send the routine to caregivers.</span>
              </div>
            )}
            <RoutineTimeline events={routine} />
          </ClinicalCard>
        )}
      </DataState>
    </div>
  );
}
