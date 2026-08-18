"use client";

import { useMemo, useState } from "react";
import {
  Activity, AlertTriangle, Pill, Save, ShieldCheck,
  TrendingUp, Loader2, BarChart3, HeartPulse, NotebookPen, Accessibility,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord } from "@/lib/api";
import { computeQuality, periodFor, type QualityPeriod } from "@/lib/quality";
import { useCareLogData } from "./CareLogsBoard";
import { type ClinicianRole } from "./useClinician";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const fmt = (v: number | null, unit = "") => (v == null ? "—" : `${v}${unit}`);

// The care-log workflow documents the 14 LifeCare v4.2 assessment domains per
// resident; coverage is measured against that total.
const CARE_DOMAINS_TOTAL = 14;

/** 0–100 score → colour band (higher is better). */
function scoreTone(v: number | null): { text: string; bar: string; bg: string } {
  if (v == null) return { text: "text-gray-400", bar: "bg-gray-300", bg: "bg-gray-50" };
  if (v >= 90) return { text: "text-emerald-600", bar: "bg-emerald-500", bg: "bg-emerald-50" };
  if (v >= 75) return { text: "text-amber-600", bar: "bg-amber-500", bg: "bg-amber-50" };
  return { text: "text-red-600", bar: "bg-red-500", bg: "bg-red-50" };
}

export default function QualityMonitoringBoard({ clinicianRole = "FACILITY_ADMIN" }: { clinicianRole?: ClinicianRole }) {
  const [days, setDays] = useState(30);
  const period = useMemo<QualityPeriod>(() => periodFor(days), [days]);

  const resQ = useLiveQuery<Row>("residents", { query: "take=300", tables: ["Resident"] });
  const medQ = useLiveQuery<Row>("medication-administrations", { query: "take=1000", tables: ["MedicationAdministration"] });
  const incQ = useLiveQuery<Row>("incidents", { query: "take=500", tables: ["Incident"] });
  const bellQ = useLiveQuery<Row>("call-bells", { query: "take=500", tables: ["CallBell"] });
  const planQ = useLiveQuery<Row>("care-plans", { query: "take=300", tables: ["CarePlan"] });
  const setQ = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  // Care logs (DailyRounds domains) — the new resident-care documentation source.
  const { allEntries, loading: careLoading } = useCareLogData(clinicianRole);

  const loading = resQ.loading || medQ.loading || careLoading;

  // Per-resident care-log domain coverage inside the window (distinct domains logged).
  const careByRes = useMemo(() => {
    const byRes: Record<string, Set<string>> = {};
    allEntries.forEach((e) => {
      const t = new Date(e.at).getTime();
      if (!isNaN(t) && t >= period.start && t <= period.end) (byRes[e.resId] ??= new Set()).add(e.domain);
    });
    const out: Record<string, { logged: number; total: number }> = {};
    Object.entries(byRes).forEach(([id, set]) => { out[id] = { logged: set.size, total: CARE_DOMAINS_TOTAL }; });
    return out;
  }, [allEntries, period]);

  // Per-resident ADL monitoring in the window (adl_logs app-setting): entries + declines.
  const adlByRes = useMemo(() => {
    const raw = (setQ.data || []).find((r) => (r.key || r.id) === "adl_logs")?.value;
    let logs: Array<{ residentId?: string; date?: string; change?: string }> = [];
    try { const v = JSON.parse(raw || "[]"); if (Array.isArray(v)) logs = v; } catch { /* ignore malformed */ }
    const out: Record<string, { entries: number; declines: number }> = {};
    logs.forEach((l) => {
      const t = new Date(String(l.date)).getTime();
      if (isNaN(t) || t < period.start || t > period.end) return;
      const id = String(l.residentId || "");
      if (!id) return;
      const o = (out[id] ??= { entries: 0, declines: 0 });
      o.entries++;
      if (l.change === "Declined" || l.change === "Significant Decline") o.declines++;
    });
    return out;
  }, [setQ.data, period]);

  const { community, residents } = useMemo(
    () => computeQuality(
      {
        residents: resQ.data || [], meds: medQ.data || [],
        incidents: incQ.data || [], callBells: bellQ.data || [], carePlans: planQ.data || [],
        careByRes, adlByRes,
      },
      period,
    ),
    [resQ.data, medQ.data, incQ.data, bellQ.data, planQ.data, careByRes, adlByRes, period],
  );

  const [saving, setSaving] = useState(false);
  // Persist the current computation as a point-in-time snapshot so trends
  // accumulate in ResidentQualityScore + CommunityQualityDashboard.
  const saveSnapshot = async () => {
    const communityId = s((resQ.data || [])[0]?.communityId);
    if (!communityId) { Swal.fire("No community", "No residents found to snapshot.", "warning"); return; }
    const confirm = await Swal.fire({
      title: "Save quality snapshot?",
      text: `Store this ${period.label.toLowerCase()} snapshot for the community + ${residents.length} resident(s).`,
      icon: "question", showCancelButton: true, confirmButtonColor: "#059669", confirmButtonText: "Save snapshot",
    });
    if (!confirm.isConfirmed) return;
    setSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const startIso = new Date(period.start).toISOString();
      await createRecord("community-quality-dashboards", {
        communityId, snapshotDate: nowIso,
        taskCompletionRate: community.taskCompletionRate,
        carePlanReviewCompliance: community.carePlanReviewCompliance,
        incidentRate: community.incidentRate,
        fallRate: community.fallRate,
        medicationErrorRate: community.medicationErrorRate,
        callBellResponseTime: community.callBellResponseTime,
        averageResidentQualityScore: community.averageResidentQualityScore,
      });
      for (const r of residents) {
        await createRecord("resident-quality-scores", {
          residentId: r.residentId, communityId,
          periodStart: startIso, periodEnd: nowIso, periodType: period.periodType,
          careCompletionScore: r.careCompletionScore,
          medicationComplianceScore: r.medicationComplianceScore,
          riskManagementScore: r.riskManagementScore,
          overallScore: r.overallScore,
          tasksScheduled: r.tasksScheduled, tasksCompleted: r.tasksCompleted,
          medsScheduled: r.medsScheduled, medsTaken: r.medsTaken,
          incidentsCount: r.incidentsCount,
        });
      }
      Swal.fire({ title: "Snapshot saved", text: `Stored for ${residents.length} resident(s).`, icon: "success", timer: 2000, showConfirmButton: false });
    } catch (e) {
      Swal.fire("Save failed", e instanceof Error ? e.message : String(e), "error");
    } finally { setSaving(false); }
  };

  const avgTone = scoreTone(community.averageResidentQualityScore);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-emerald-600" /> Quality Monitoring
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">Care-quality indicators from care logs, ADL monitoring, medication passes, incidents &amp; care plans.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-emerald-400">
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button onClick={saveSnapshot} disabled={saving || loading} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save snapshot
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border p-12 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
      ) : (
        <>
          {/* Community KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <Kpi label="Avg Resident Quality" value={fmt(community.averageResidentQualityScore, "%")} icon={TrendingUp} tone={avgTone.text} bg={avgTone.bg} />
            <Kpi label="Care Documentation" value={fmt(community.taskCompletionRate, "%")} icon={NotebookPen} tone={scoreTone(community.taskCompletionRate).text} bg={scoreTone(community.taskCompletionRate).bg} />
            <Kpi label="Med Compliance" value={fmt(community.medicationComplianceRate, "%")} icon={Pill} tone={scoreTone(community.medicationComplianceRate).text} bg={scoreTone(community.medicationComplianceRate).bg} />
            <Kpi label="Care-Plan Review" value={fmt(community.carePlanReviewCompliance, "%")} icon={ShieldCheck} tone={scoreTone(community.carePlanReviewCompliance).text} bg={scoreTone(community.carePlanReviewCompliance).bg} />
            <Kpi label="Med Error Rate" value={fmt(community.medicationErrorRate, "%")} icon={AlertTriangle} tone="text-red-600" bg="bg-red-50" />
            <Kpi label="Incidents / Resident" value={fmt(community.incidentRate)} sub={`${community.totalIncidents} total`} icon={Activity} tone="text-gray-800" bg="bg-gray-50" />
            <Kpi label="Falls / Resident" value={fmt(community.fallRate)} sub={`${community.totalFalls} total`} icon={HeartPulse} tone="text-red-600" bg="bg-red-50" />
            <Kpi label="ADL Declines" value={String(community.totalAdlDeclines)} sub="flagged this window" icon={Accessibility} tone={community.totalAdlDeclines > 0 ? "text-red-600" : "text-gray-800"} bg={community.totalAdlDeclines > 0 ? "bg-red-50" : "bg-gray-50"} />
          </div>

          {/* Per-resident report cards */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-800 text-sm">Resident Quality Scores <span className="text-gray-400 font-normal">· worst first</span></h3>
              <span className="text-xs text-gray-500">{residents.length} residents · {period.label}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold">Resident</th>
                    <th className="text-left px-4 py-2 font-semibold">Acuity</th>
                    <th className="text-left px-4 py-2 font-semibold">Care Logs</th>
                    <th className="text-left px-4 py-2 font-semibold">ADL</th>
                    <th className="text-left px-4 py-2 font-semibold">Meds</th>
                    <th className="text-center px-4 py-2 font-semibold">Incidents</th>
                    <th className="text-left px-4 py-2 font-semibold min-w-[160px]">Overall</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {residents.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No residents to score.</td></tr>
                  ) : residents.map((r) => {
                    const t = scoreTone(r.overallScore);
                    return (
                      <tr key={r.residentId} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-gray-900">{r.name}</div>
                          <div className="text-xs text-gray-400">Room {r.room}</div>
                        </td>
                        <td className="px-4 py-2.5"><span className="text-xs font-semibold text-gray-600">{r.acuity}</span></td>
                        <td className="px-4 py-2.5 tabular-nums">{fmt(r.careCompletionScore, "%")} <span className="text-[10px] text-gray-400">({r.tasksCompleted}/{r.tasksScheduled})</span></td>
                        <td className="px-4 py-2.5">
                          {r.adlDeclines > 0
                            ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-xs font-semibold">{r.adlDeclines} decline{r.adlDeclines === 1 ? "" : "s"}</span>
                            : r.adlEntries > 0
                              ? <span className="text-xs text-emerald-600 font-medium">{r.adlEntries} logged</span>
                              : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums">{fmt(r.medicationComplianceScore, "%")} <span className="text-[10px] text-gray-400">({r.medsTaken}/{r.medsScheduled})</span></td>
                        <td className="px-4 py-2.5 text-center">
                          {r.incidentsCount > 0 ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-xs font-semibold">{r.incidentsCount}</span> : <span className="text-gray-300">0</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                              <div className={`h-full ${t.bar}`} style={{ width: `${Math.min(100, r.overallScore)}%` }} />
                            </div>
                            <span className={`text-xs font-bold tabular-nums ${t.text}`}>{r.overallScore}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[11px] text-gray-400">
            Scores are computed live from care logs, ADL monitoring, medication passes, incidents &amp; care plans for the selected window. Use <b>Save snapshot</b> to store a point-in-time record for trend history.
          </p>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, icon: Icon, tone, bg }: { label: string; value: string; sub?: string; icon: typeof Activity; tone: string; bg: string }) {
  return (
    <div className={`p-4 rounded-xl border border-gray-200 ${bg}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500">{label}</p>
        <Icon className={`w-4 h-4 ${tone}`} />
      </div>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}
