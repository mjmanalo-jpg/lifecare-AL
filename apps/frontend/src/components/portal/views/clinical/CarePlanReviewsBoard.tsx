"use client";

/**
 * Care Plan Reviews — review resident indicators, evaluate triggers (ICP / ISP /
 * LOC), and record a Nurse/Admin care-plan decision. Tabs: New Review, Reviews
 * Due, History. Recent indicators + triggers derive from the resident's incidents
 * (last 30 days). Migration-free: reviews are a JSON array in the app-setting
 * `care_plan_reviews`.
 */

import { useMemo, useState } from "react";
import { ClipboardList, ListChecks, Loader2 } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import { generateCarePlanForResident } from "@/lib/carePlanGen";
import { adaptResident } from "@/lib/adapters";
import { useClinician, type ClinicianRole } from "./useClinician";
import { levelOf } from "./CareLogsBoard";
import { ClinicalButton, ClinicalCard, StatCard, DataState, FieldLabel, controlClass, StatusPill, SERIF } from "./clinical-ui";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const REVIEW_KEY = "care_plan_reviews";
const s = (v: unknown) => (v == null ? "" : String(v));
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
const newId = () => globalThis.crypto?.randomUUID?.() ?? `rev-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const isoDate = (d: Date) => d.toISOString().split("T")[0];
const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
const fmt = (isoStr: string) => (isoStr ? new Date(isoStr + (isoStr.length <= 10 ? "T00:00:00" : "")).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");
const periodOf = (d: Date) => `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;

const DECISIONS = ["Continue Current Plan", "Update Care Plan", "Escalate Level of Care", "De-escalate Level of Care", "Refer to Physician", "Schedule Family Conference"];
const PLAN_STATUS = ["No Change", "Updated", "Under Review", "Escalated", "De-escalated"];

interface Review {
  id: string; residentId: string; reviewDate: string; reviewPeriod: string; levelAtReview: number;
  nextReviewDate?: string; carePlanStatus: string; familyUpdate: boolean; physicianFollowup: boolean;
  decision: string; reason?: string; actionPlan?: string; responsible?: string; targetDate?: string;
  reviewedBy?: string; createdAt: string;
}
const parseReviews = (raw: string | null | undefined): Review[] => { if (!raw) return []; try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((r) => r && typeof r.id === "string") : []; } catch { return []; } };

export default function CarePlanReviewsBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const { name: clinicianName } = useClinician(clinicianRole);
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const incQ = useLiveQuery<Row>("incidents", { query: "take=400", tables: ["Incident"] });
  const { data: settingRows, loading, error, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  const cpQ = useLiveQuery<Row>("care-plans", { query: "take=300", tables: ["CarePlan"] });
  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const reviews = useMemo(() => parseReviews(settingRows.find((r) => (r.key || r.id) === REVIEW_KEY)?.value), [settingRows]);
  const residentsWithPlan = useMemo(() => new Set((cpQ.data || []).filter((p) => s(p.status) !== "DISCONTINUED").map((p) => s(p.residentId))), [cpQ.data]);

  const [tab, setTab] = useState<"new" | "due" | "history">("new");
  const [resId, setResId] = useState("");
  const [genBusy, setGenBusy] = useState(false);

  const today = new Date();
  const resident = residents.find((r: Row) => s(r.id) === resId) || null;

  const latestReview = (rid: string) => reviews.filter((r) => r.residentId === rid).sort((a, b) => (b.reviewDate || "").localeCompare(a.reviewDate || ""))[0];

  // Recent incidents (last 30 days) for the selected resident → indicators + triggers.
  const recentInc = useMemo(() => {
    if (!resId) return [];
    const cutoff = addMonths(today, 0); cutoff.setDate(cutoff.getDate() - 30);
    return (incQ.data || []).filter((i) => s(i.residentId) === resId && new Date(s(i.incidentDate || i.createdAt)) >= cutoff);
  }, [incQ.data, resId]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = async (next: Review[]) => { await upsertRecord("app-settings", REVIEW_KEY, { key: REVIEW_KEY, value: JSON.stringify(next) }); await refetch(); };

  // Manual fallback for the Stage 8/9 handoff — build a care plan + caregiver tasks
  // from the resident's current Level of Care (for residents approved before the
  // auto-generation, or missing a plan).
  const genPlan = async () => {
    if (!resident || genBusy) return;
    const n = levelOf(resident).n;
    const already = residentsWithPlan.has(s(resident.id));
    const c = await Swal.fire({
      title: "Generate care plan & tasks?",
      html: `Create a <b>Level ${n}</b> care plan for <b>${s(resident.name)}</b> and generate caregiver tasks from its interventions.${already ? "<br/><br/><span style='color:#b45309'>This resident already has a care plan — this creates another.</span>" : ""}`,
      icon: "question", showCancelButton: true, confirmButtonColor: "#4F46E5", confirmButtonText: "Generate",
    });
    if (!c.isConfirmed) return;
    setGenBusy(true);
    try {
      const raw = (resident.raw || {}) as Row;
      const { taskCount } = await generateCarePlanForResident({ residentId: s(resident.id), level: n, communityId: s(raw.communityId) || undefined, createdByName: clinicianName });
      await cpQ.refetch?.();
      Swal.fire({ icon: "success", title: "Care plan created", text: `${taskCount} caregiver task${taskCount === 1 ? "" : "s"} generated from the plan.`, timer: 2400, showConfirmButton: false });
    } catch (e) { Swal.fire("Couldn't generate", e instanceof Error ? e.message : "Please try again.", "error"); }
    finally { setGenBusy(false); }
  };

  // Reviews Due: residents whose next review has passed, or who've never been reviewed.
  const dueList = useMemo(() => residents.map((r: Row) => {
    const last = latestReview(s(r.id));
    const due = !last || (last.nextReviewDate ? last.nextReviewDate <= isoDate(today) : false);
    return { r, last, due };
  }).filter((x) => x.due), [residents, reviews]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="-m-4 sm:-m-6 p-4 sm:p-6 min-h-full space-y-5" style={{ background: "#F7F8FA" }}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.75rem]">Care Plan Reviews</h1>
        <p className="mt-1 text-sm text-slate-500">Review resident indicators, evaluate triggers, and make care plan decisions</p>
      </div>

      <div className="flex items-center gap-2" role="tablist" aria-label="Care plan reviews view">
        {([["new", "New Review"], ["due", "Reviews Due"], ["history", "History"]] as const).map(([v, label]) => (
          <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)} className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${tab === v ? "bg-[#4F46E5] text-white shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{label}{v === "due" && dueList.length ? ` (${dueList.length})` : ""}</button>
        ))}
      </div>

      {tab === "new" && (
        <div className="space-y-4">
          <ClinicalCard className="p-5">
            <FieldLabel htmlFor="cpr-res">Select Resident</FieldLabel>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <select id="cpr-res" value={resId} onChange={(e) => setResId(e.target.value)} className={`${controlClass} max-w-md`}>
                <option value="">Choose a resident…</option>
                {residents.map((r: Row) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — Rm {s(r.room)} (Level {levelOf(r).n})</option>)}
              </select>
              {resident && (
                <ClinicalButton variant="secondary" onClick={genPlan} disabled={genBusy} className="shrink-0">
                  {genBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
                  {residentsWithPlan.has(resId) ? "Regenerate care plan & tasks" : "Generate care plan & tasks"}
                </ClinicalButton>
              )}
            </div>
            {resident && <p className="mt-2 text-xs text-[var(--clinical-muted)]">Builds a Level {levelOf(resident).n} plan from the approved level of care and spins its interventions into caregiver tasks. Auto-runs on Care Acuity approval — use this for residents approved earlier.</p>}
          </ClinicalCard>

          {!resident && (
            <div className="@container">
              <p className="mb-3 text-sm text-[var(--clinical-muted)]">Or tap a resident to start their care plan review</p>
              {residents.length === 0 ? (
                <p className="text-sm text-[var(--clinical-muted)]">No residents found.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 @lg:grid-cols-3 @3xl:grid-cols-4 @5xl:grid-cols-5">
                  {residents.map((r: Row, i: number) => { const lv = levelOf(r); return (
                    <button key={s(r.id)} onClick={() => setResId(s(r.id))}
                      className="group flex flex-col items-center gap-2.5 rounded-xl border p-4 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md animate-in fade-in slide-in-from-bottom-2 duration-300"
                      style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)", animationDelay: `${i * 40}ms`, animationFillMode: "backwards" }}>
                      <span className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold" style={{ backgroundColor: "var(--clinical-surface-2)", color: "var(--clinical-panel)" }}>{initials(s(r.name))}</span>
                      <span className="block w-full min-w-0">
                        <span className="block truncate text-sm font-semibold text-[var(--clinical-ink)]">{s(r.name)}</span>
                        <span className="block text-xs text-[var(--clinical-muted)]">Room {s(r.room)} · Level {lv.n}</span>
                      </span>
                    </button>
                  ); })}
                </div>
              )}
            </div>
          )}

          {resident && <ReviewForm resident={resident} recentInc={recentInc} last={latestReview(resId)} reviewedBy={clinicianName} onSubmit={async (rec) => { await persist([{ ...rec, id: newId(), createdAt: new Date().toISOString() }, ...reviews]); setResId(""); setTab("history"); Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Care plan review submitted", showConfirmButton: false, timer: 1800 }); }} />}
        </div>
      )}

      {tab === "due" && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard value={residents.length} label="Residents" accent="ink" />
            <StatCard value={dueList.length} label="Reviews Due" accent="amber" />
            <StatCard value={dueList.filter((x) => !x.last).length} label="Never Reviewed" accent="coral" />
            <StatCard value={reviews.length} label="Total Reviews" accent="teal" />
          </div>
          <ClinicalCard className="p-5">
            <p className="mb-3 font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>Residents Needing Review</p>
            <DataState
              loading={loading && reviews.length === 0}
              error={error}
              empty={dueList.length === 0}
              emptyTitle="No reviews due"
              emptyHint="All care plans are up to date."
              onRetry={() => void refetch()}
              skeletonRows={3}
            >
              <div className="space-y-2">
                {dueList.map(({ r, last }) => {
                  const lastReview = last ? fmt(last.reviewDate) : "Never";
                  const overdue = !last?.nextReviewDate || last.nextReviewDate <= isoDate(today);
                  const nextDue = last?.nextReviewDate && last.nextReviewDate > isoDate(today) ? fmt(last.nextReviewDate) : "Overdue";
                  return (
                    <div key={s(r.id)} className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-[var(--clinical-ink)]">{s(r.name)} — Rm {s(r.room)}</p>
                          {overdue && <StatusPill status="OVERDUE" />}
                        </div>
                        <p className="text-xs text-[var(--clinical-muted)]">Level {levelOf(r).n} • Last review: {lastReview} • Next due: {nextDue}</p>
                      </div>
                      <ClinicalButton variant="primary" size="sm" className="shrink-0" onClick={() => { setResId(s(r.id)); setTab("new"); }}>Start Review</ClinicalButton>
                    </div>
                  );
                })}
              </div>
            </DataState>
          </ClinicalCard>
        </>
      )}

      {tab === "history" && (
        <DataState
          loading={loading && reviews.length === 0}
          error={error}
          empty={reviews.length === 0}
          emptyTitle="No care plan reviews yet"
          emptyHint="Submitted reviews will appear here."
          onRetry={() => void refetch()}
          skeletonRows={4}
        >
          <div className="overflow-x-auto rounded-xl border" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="border-b text-left text-[var(--clinical-muted)]" style={{ borderColor: "var(--clinical-line)" }}><th className="px-4 py-2.5 font-semibold">Resident</th><th className="px-4 py-2.5 font-semibold">Date</th><th className="px-4 py-2.5 font-semibold">Level</th><th className="px-4 py-2.5 font-semibold">Decision</th><th className="px-4 py-2.5 font-semibold">Status</th><th className="px-4 py-2.5 font-semibold">By</th></tr></thead>
              <tbody>
                {[...reviews].sort((a, b) => (b.reviewDate || "").localeCompare(a.reviewDate || "")).map((rv) => { const r = residents.find((x: Row) => s(x.id) === rv.residentId); return (
                  <tr key={rv.id} className="border-b last:border-0" style={{ borderColor: "var(--clinical-line)" }}>
                    <td className="px-4 py-2.5"><span className="font-semibold text-[var(--clinical-ink)]">{s(r?.name) || "Resident"}</span> <span className="text-xs text-[var(--clinical-muted)]">Rm {s(r?.room)}</span></td>
                    <td className="px-4 py-2.5 text-[var(--clinical-ink-soft)]">{fmt(rv.reviewDate)} <span className="text-[var(--clinical-muted)]">· {rv.reviewPeriod}</span></td>
                    <td className="px-4 py-2.5 font-semibold text-[var(--clinical-ink-soft)]">Level {rv.levelAtReview}</td>
                    <td className="px-4 py-2.5 text-[var(--clinical-ink-soft)]">{rv.decision}</td>
                    <td className="px-4 py-2.5"><StatusPill status={rv.carePlanStatus} /></td>
                    <td className="px-4 py-2.5 text-[var(--clinical-ink-soft)]">{rv.reviewedBy || "—"}</td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
        </DataState>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) { return <div><p className="text-[11px] uppercase tracking-[0.08em] text-[var(--clinical-muted)]">{label}</p><p className="text-sm font-semibold text-[var(--clinical-ink)]">{value || "—"}</p></div>; }
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <ClinicalCard className="p-5"><p className="mb-3 font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>{title}</p>{children}</ClinicalCard>; }
function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return <button type="button" role="switch" aria-checked={on} onClick={onClick} className="inline-flex items-center gap-2.5 text-sm text-[var(--clinical-ink-soft)]"><span className="relative h-5 w-10 rounded-full transition" style={{ backgroundColor: on ? "var(--clinical-panel)" : "var(--clinical-line-strong)" }}><span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: on ? "22px" : "2px" }} /></span>{label}</button>;
}

// Trigger chip — dot + label, coral when a trigger fired, muted when clear.
function TriggerLine({ label, trig }: { label: string; trig: string }) {
  return (
    <div className="border-b pb-3 last:border-0 last:pb-0" style={{ borderColor: "var(--clinical-line)" }}>
      <p className="text-sm font-bold text-[var(--clinical-ink)]">{label}</p>
      <p className="mt-0.5 inline-flex items-center gap-1.5 text-sm" style={{ color: trig ? "var(--clinical-coral)" : "var(--clinical-muted)" }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: trig ? "var(--clinical-coral)" : "var(--clinical-line-strong)" }} />
        {trig || "No triggers identified."}
      </p>
    </div>
  );
}

function ReviewForm({ resident, recentInc, last, reviewedBy, onSubmit }: {
  resident: Row; recentInc: Row[]; last?: Review; reviewedBy: string;
  onSubmit: (rec: Omit<Review, "id" | "createdAt">) => Promise<void>;
}) {
  const today = new Date();
  const lvl = levelOf(resident).n;
  const [nextReviewDate, setNextReviewDate] = useState(isoDate(addMonths(today, 3)));
  const [carePlanStatus, setCarePlanStatus] = useState("No Change");
  const [familyUpdate, setFamilyUpdate] = useState(false);
  const [physicianFollowup, setPhysicianFollowup] = useState(false);
  const [decision, setDecision] = useState("");
  const [reason, setReason] = useState("");
  const [actionPlan, setActionPlan] = useState("");
  const [responsible, setResponsible] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [saving, setSaving] = useState(false);

  // Derive triggers from recent incidents.
  const has = (types: string[]) => recentInc.filter((i) => types.includes(s(i.incidentType).toUpperCase()));
  const icp = has(["BEHAVIORAL"]).length ? "Behavioral event in last 30 days — update the individual care plan." : "";
  const isp = has(["MED_ERROR", "MEDICATION"]).length ? "Medication event in last 30 days — review the service plan." : "";
  const loc = recentInc.filter((i) => ["FALL", "CRITICAL"].includes(s(i.incidentType).toUpperCase()) || s(i.severity).toUpperCase() === "CRITICAL").length ? "Fall or critical event in last 30 days — evaluate level of care." : "";

  const submit = async () => {
    if (!decision) { Swal.fire({ title: "Select a decision", text: "Choose a decision before submitting the review.", icon: "warning" }); return; }
    setSaving(true);
    try {
      await onSubmit({ residentId: s(resident.id), reviewDate: isoDate(today), reviewPeriod: periodOf(today), levelAtReview: lvl, nextReviewDate, carePlanStatus, familyUpdate, physicianFollowup, decision, reason: reason || undefined, actionPlan: actionPlan || undefined, responsible: responsible || undefined, targetDate: targetDate || undefined, reviewedBy });
    } finally { setSaving(false); }
  };

  return (
    <>
      <Section title="Review Header">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Field label="Resident" value={s(resident.name)} />
          <Field label="Room" value={s(resident.room)} />
          <Field label="Current Level of Care" value={`Level ${lvl}`} />
          <Field label="Review Period" value={periodOf(today)} />
          <Field label="Review Date" value={isoDate(today)} />
          <Field label="Reviewed By" value={reviewedBy || "Staff"} />
          <Field label="Last Review" value={last ? fmt(last.reviewDate) : "Never"} />
          <div><FieldLabel htmlFor="cpr-next">Next Review Date</FieldLabel><input id="cpr-next" type="date" value={nextReviewDate} onChange={(e) => setNextReviewDate(e.target.value)} className={controlClass} /></div>
        </div>
        <div className="mt-4 grid grid-cols-1 items-center gap-4 lg:grid-cols-3">
          <div><FieldLabel htmlFor="cpr-status">Care Plan Status</FieldLabel><select id="cpr-status" value={carePlanStatus} onChange={(e) => setCarePlanStatus(e.target.value)} className={controlClass}>{PLAN_STATUS.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
          <Toggle label="Family Update Needed" on={familyUpdate} onClick={() => setFamilyUpdate((v) => !v)} />
          <Toggle label="Physician Follow-up Needed" on={physicianFollowup} onClick={() => setPhysicianFollowup((v) => !v)} />
        </div>
      </Section>

      <Section title="Recent Indicators (Last 30 Days)">
        {recentInc.length === 0 ? <p className="text-[var(--clinical-muted)]">No indicator data available.</p>
          : <div className="space-y-1.5">{recentInc.map((i) => <div key={s(i.id)} className="flex items-center gap-2 text-sm"><StatusPill status={s(i.incidentType).replace(/_/g, " ")}>{s(i.incidentType).replace(/_/g, " ")}</StatusPill><span className="text-[var(--clinical-ink-soft)]">{s(i.title) || s(i.description).slice(0, 80)}</span><span className="ml-auto text-xs text-[var(--clinical-muted)]">{fmt(s(i.incidentDate || i.createdAt).slice(0, 10))}</span></div>)}</div>}
      </Section>

      <Section title="Trigger Evaluation">
        <div className="space-y-3">
          <TriggerLine label="Individual Care Plan (ICP) Triggers" trig={icp} />
          <TriggerLine label="Individual Service Plan (ISP) Triggers" trig={isp} />
          <TriggerLine label="Level of Care (LOC) Review Triggers" trig={loc} />
        </div>
      </Section>

      <Section title="Nurse/Admin Decision">
        <div className="space-y-4">
          <div><FieldLabel required htmlFor="cpr-decision">Decision</FieldLabel><select id="cpr-decision" value={decision} onChange={(e) => setDecision(e.target.value)} className={`${controlClass} max-w-xs`}><option value="">Select a decision…</option>{DECISIONS.map((d) => <option key={d} value={d}>{d}</option>)}</select></div>
          <div><FieldLabel htmlFor="cpr-reason">Reason for Decision / Notes</FieldLabel><textarea id="cpr-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain the rationale…" className={controlClass} /></div>
          <div><FieldLabel htmlFor="cpr-action">Action Plan</FieldLabel><textarea id="cpr-action" rows={2} value={actionPlan} onChange={(e) => setActionPlan(e.target.value)} placeholder="Steps to be taken…" className={controlClass} /></div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><FieldLabel htmlFor="cpr-resp">Responsible Person</FieldLabel><input id="cpr-resp" value={responsible} onChange={(e) => setResponsible(e.target.value)} placeholder="Name or role" className={controlClass} /></div>
            <div><FieldLabel htmlFor="cpr-target">Target Completion Date</FieldLabel><input id="cpr-target" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className={controlClass} /></div>
          </div>
          <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[#4F46E5] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#4338CA] disabled:opacity-60"><ClipboardList className="h-4 w-4" /> {saving ? "Submitting…" : "Submit Care Plan Review"}</button>
        </div>
      </Section>
    </>
  );
}
