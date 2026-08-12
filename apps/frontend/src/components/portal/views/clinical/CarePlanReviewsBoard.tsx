"use client";

/**
 * Care Plan Reviews — review resident indicators, evaluate triggers (ICP / ISP /
 * LOC), and record a Nurse/Admin care-plan decision. Tabs: New Review, Reviews
 * Due, History. Recent indicators + triggers derive from the resident's incidents
 * (last 30 days). Migration-free: reviews are a JSON array in the app-setting
 * `care_plan_reviews`.
 */

import { useMemo, useState } from "react";
import { ClipboardList, CheckCircle2 } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import { adaptResident } from "@/lib/adapters";
import { useClinician, type ClinicianRole } from "./useClinician";
import { levelOf } from "./CareLogsBoard";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const REVIEW_KEY = "care_plan_reviews";
const s = (v: unknown) => (v == null ? "" : String(v));
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
  const { data: settingRows, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const reviews = useMemo(() => parseReviews(settingRows.find((r) => (r.key || r.id) === REVIEW_KEY)?.value), [settingRows]);

  const [tab, setTab] = useState<"new" | "due" | "history">("new");
  const [resId, setResId] = useState("");

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

  // Reviews Due: residents whose next review has passed, or who've never been reviewed.
  const dueList = useMemo(() => residents.map((r: Row) => {
    const last = latestReview(s(r.id));
    const due = !last || (last.nextReviewDate ? last.nextReviewDate <= isoDate(today) : false);
    return { r, last, due };
  }).filter((x) => x.due), [residents, reviews]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-full bg-[#F7F8FA] -m-4 sm:-m-6 p-4 sm:p-6">
      <div className="mb-4">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Care Plan Reviews</h1>
        <p className="text-sm text-slate-500 mt-1">Review resident indicators, evaluate triggers, and make care plan decisions</p>
      </div>

      <div className="inline-flex gap-1 bg-slate-100 rounded-xl p-1 mb-5">
        {([["new", "New Review"], ["due", "Reviews Due"], ["history", "History"]] as const).map(([v, label]) => (
          <button key={v} onClick={() => setTab(v)} className={`px-3.5 py-1.5 rounded-lg text-sm font-medium ${tab === v ? "bg-white shadow-sm text-slate-800" : "text-slate-500"}`}>{label}{v === "due" && dueList.length ? ` (${dueList.length})` : ""}</button>
        ))}
      </div>

      {tab === "new" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="font-bold text-slate-900 mb-2">Select Resident</p>
            <select value={resId} onChange={(e) => setResId(e.target.value)} className="w-full max-w-md px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40">
              <option value="">Choose a resident…</option>
              {residents.map((r: Row) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — Rm {s(r.room)} (Level {levelOf(r).n})</option>)}
            </select>
          </div>

          {resident && <ReviewForm resident={resident} recentInc={recentInc} last={latestReview(resId)} reviewedBy={clinicianName} onSubmit={async (rec) => { await persist([{ ...rec, id: newId(), createdAt: new Date().toISOString() }, ...reviews]); setResId(""); setTab("history"); Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Care plan review submitted", showConfirmButton: false, timer: 1800 }); }} />}
        </div>
      )}

      {tab === "due" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="font-bold text-slate-900 mb-3">Residents Needing Review</p>
          {dueList.length === 0 ? <div className="py-6 text-center"><CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-2" /><p className="text-slate-500">No reviews due — all care plans are up to date.</p></div>
            : <div className="space-y-2">
                {dueList.map(({ r, last }) => {
                  const lastReview = last ? fmt(last.reviewDate) : "Never";
                  const nextDue = last?.nextReviewDate && last.nextReviewDate > isoDate(today) ? fmt(last.nextReviewDate) : "Overdue";
                  return (
                    <div key={s(r.id)} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
                      <div>
                        <p className="font-bold text-slate-900">{s(r.name)} — Rm {s(r.room)}</p>
                        <p className="text-xs text-slate-500">Level {levelOf(r).n} • Last review: {lastReview} • Next due: {nextDue}</p>
                      </div>
                      <button onClick={() => { setResId(s(r.id)); setTab("new"); }} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 shrink-0">Start Review</button>
                    </div>
                  );
                })}
              </div>}
        </div>
      )}

      {tab === "history" && (
        reviews.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-400">No care plan reviews yet.</div>
          : <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead><tr className="text-left text-slate-400 border-b border-slate-100"><th className="font-semibold px-4 py-2.5">Resident</th><th className="font-semibold px-4 py-2.5">Date</th><th className="font-semibold px-4 py-2.5">Level</th><th className="font-semibold px-4 py-2.5">Decision</th><th className="font-semibold px-4 py-2.5">Status</th><th className="font-semibold px-4 py-2.5">By</th></tr></thead>
                <tbody>
                  {[...reviews].sort((a, b) => (b.reviewDate || "").localeCompare(a.reviewDate || "")).map((rv) => { const r = residents.find((x: Row) => s(x.id) === rv.residentId); return (
                    <tr key={rv.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2.5"><span className="font-semibold text-slate-800">{s(r?.name) || "Resident"}</span> <span className="text-slate-400 text-xs">Rm {s(r?.room)}</span></td>
                      <td className="px-4 py-2.5 text-slate-600">{fmt(rv.reviewDate)} <span className="text-slate-400">· {rv.reviewPeriod}</span></td>
                      <td className="px-4 py-2.5 text-slate-700 font-semibold">Level {rv.levelAtReview}</td>
                      <td className="px-4 py-2.5 text-slate-700">{rv.decision}</td>
                      <td className="px-4 py-2.5"><span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{rv.carePlanStatus}</span></td>
                      <td className="px-4 py-2.5 text-slate-600">{rv.reviewedBy || "—"}</td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) { return <div><p className="text-[11px] text-slate-400">{label}</p><p className="text-sm font-semibold text-slate-800">{value || "—"}</p></div>; }
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <div className="rounded-2xl border border-slate-200 bg-white p-5"><p className="font-bold text-slate-900 mb-3">{title}</p>{children}</div>; }
function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex items-center gap-2.5 text-sm text-slate-700"><span className={`w-10 h-5 rounded-full relative transition ${on ? "bg-blue-600" : "bg-slate-200"}`}><span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all" style={{ left: on ? "22px" : "2px" }} /></span>{label}</button>;
}
const input = "w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40";

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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Field label="Resident" value={s(resident.name)} />
          <Field label="Room" value={s(resident.room)} />
          <Field label="Current Level of Care" value={`Level ${lvl}`} />
          <Field label="Review Period" value={periodOf(today)} />
          <Field label="Review Date" value={isoDate(today)} />
          <Field label="Reviewed By" value={reviewedBy || "Staff"} />
          <Field label="Last Review" value={last ? fmt(last.reviewDate) : "Never"} />
          <div><p className="text-[11px] text-slate-400 mb-1">Next Review Date</p><input type="date" value={nextReviewDate} onChange={(e) => setNextReviewDate(e.target.value)} className={input} /></div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4 items-center">
          <div><p className="text-[11px] text-slate-400 mb-1">Care Plan Status</p><select value={carePlanStatus} onChange={(e) => setCarePlanStatus(e.target.value)} className={input}>{PLAN_STATUS.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
          <Toggle label="Family Update Needed" on={familyUpdate} onClick={() => setFamilyUpdate((v) => !v)} />
          <Toggle label="Physician Follow-up Needed" on={physicianFollowup} onClick={() => setPhysicianFollowup((v) => !v)} />
        </div>
      </Section>

      <Section title="Recent Indicators (Last 30 Days)">
        {recentInc.length === 0 ? <p className="text-slate-400">No indicator data available.</p>
          : <div className="space-y-1.5">{recentInc.map((i) => <div key={s(i.id)} className="flex items-center gap-2 text-sm"><span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">{s(i.incidentType).replace(/_/g, " ")}</span><span className="text-slate-600">{s(i.title) || s(i.description).slice(0, 80)}</span><span className="text-slate-400 text-xs ml-auto">{fmt(s(i.incidentDate || i.createdAt).slice(0, 10))}</span></div>)}</div>}
      </Section>

      <Section title="Trigger Evaluation">
        <div className="space-y-3">
          {[["Individual Care Plan (ICP) Triggers", icp], ["Individual Service Plan (ISP) Triggers", isp], ["Level of Care (LOC) Review Triggers", loc]].map(([label, trig]) => (
            <div key={label} className="border-b border-slate-100 last:border-0 pb-3 last:pb-0">
              <p className="text-sm font-bold text-slate-800">{label}</p>
              <p className={`text-sm mt-0.5 ${trig ? "text-red-600" : "text-slate-400"}`}>{trig || "No triggers identified."}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Nurse/Admin Decision">
        <div className="space-y-4">
          <div><p className="text-sm font-bold text-slate-700 mb-1.5">Decision <span className="text-red-500">*</span></p><select value={decision} onChange={(e) => setDecision(e.target.value)} className="w-full max-w-xs px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40"><option value="">Select a decision…</option>{DECISIONS.map((d) => <option key={d} value={d}>{d}</option>)}</select></div>
          <div><p className="text-sm font-bold text-slate-700 mb-1.5">Reason for Decision / Notes</p><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain the rationale…" className={input} /></div>
          <div><p className="text-sm font-bold text-slate-700 mb-1.5">Action Plan</p><textarea rows={2} value={actionPlan} onChange={(e) => setActionPlan(e.target.value)} placeholder="Steps to be taken…" className={input} /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><p className="text-sm font-bold text-slate-700 mb-1.5">Responsible Person</p><input value={responsible} onChange={(e) => setResponsible(e.target.value)} placeholder="Name or role" className={input} /></div>
            <div><p className="text-sm font-bold text-slate-700 mb-1.5">Target Completion Date</p><input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className={input} /></div>
          </div>
          <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"><ClipboardList className="w-4 h-4" /> {saving ? "Submitting…" : "Submit Care Plan Review"}</button>
        </div>
      </Section>
    </>
  );
}
