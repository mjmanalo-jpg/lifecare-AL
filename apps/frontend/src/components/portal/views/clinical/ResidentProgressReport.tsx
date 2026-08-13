"use client";

/**
 * Resident Progress Report — a comprehensive, period-scoped clinical summary for
 * one resident, meant for family updates and care reviews. It is derived LIVE
 * from existing records (read-only aggregation, no schema changes):
 *   1. Vitals Average          — VitalsLog ("vitals"), one row per parameter
 *   2. Medication Compliance   — MedicationAdministration ("medication-administrations")
 *   3. New & Discontinued Meds — Medication ("medications") started/ended in period
 *   4. Therapy Sessions        — (no dedicated model) empty state
 *   5. Lab Results             — LabResult ("lab-results")
 *   6. Medical Referrals       — HospitalReferral ("hospital-referrals")
 *   7. Physician Orders        — (no dedicated model) empty state
 *   8. Diagnoses & Conditions  — Resident.diagnosis, split into conditions
 *   9. Shift Endorsements      — app-setting "shift_endorsements"
 *  10. Behavioral Concerns     — MoodRecord ("mood-records") mood observations
 *  11. Care Log Summaries      — the ten DailyRounds record models grouped into 7 domains
 *  12. Physician Communications — PhysicianCommunication ("physician-communications")
 *  13. Appointments            — Visit ("visits")
 *
 * DailyRounds records carry a `dailyRoundId` rather than a residentId, so every
 * care record is resolved to its resident + author + day via the DailyRound map.
 * "Print / Save PDF" is window.print(), matching the sibling boards. "Submit for
 * Approval" persists a lightweight approval marker in an app-setting map.
 */

import { useMemo, useState } from "react";
import {
  FileText, ShieldCheck, Printer, TrendingUp, Pill, Activity, FlaskConical, Send,
  ClipboardList, Stethoscope, MessageSquare, Brain, HeartPulse, Phone, CalendarDays,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { upsertRecord } from "@/lib/api";
import { useClinician, type ClinicianRole } from "./useClinician";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const s = (v: unknown) => (v == null ? "" : String(v));
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
const APPROVAL_KEY = "progress_report_approvals";
const ENDORSEMENT_KEY = "shift_endorsements";

const isoDay = (d: Date) => d.toISOString().split("T")[0];
const midnight = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const num = (v: unknown): number | null => { const n = parseFloat(s(v)); return isNaN(n) ? null : n; };
const avg = (arr: number[]): number | null => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const fmt1 = (n: number | null) => (n == null ? "—" : n.toFixed(1));
const dayOf = (v: unknown) => { const d = new Date(s(v)); return isNaN(d.getTime()) ? "" : isoDay(d); };
const fmtDT = (d: Date) => d.toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

// ── Reporting period ─────────────────────────────────────────────────────────
type PeriodKey = "week" | "lastweek" | "month" | "lastmonth" | "30d" | "90d";
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "week", label: "This Week" }, { key: "lastweek", label: "Last Week" },
  { key: "month", label: "This Month" }, { key: "lastmonth", label: "Last Month" },
  { key: "30d", label: "Last 30 Days" }, { key: "90d", label: "Last 90 Days" },
];
function rangeFor(key: PeriodKey): { start: Date; end: Date } {
  const today = midnight(new Date());
  const end = new Date(); end.setHours(23, 59, 59, 999);
  if (key === "week") { const d = new Date(today); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return { start: d, end }; }
  if (key === "lastweek") { const d = new Date(today); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7); const e = new Date(d); e.setDate(e.getDate() + 6); e.setHours(23, 59, 59, 999); return { start: d, end: e }; }
  if (key === "month") { const d = new Date(today.getFullYear(), today.getMonth(), 1); return { start: d, end }; }
  if (key === "lastmonth") { const d = new Date(today.getFullYear(), today.getMonth() - 1, 1); const e = new Date(today.getFullYear(), today.getMonth(), 0); e.setHours(23, 59, 59, 999); return { start: d, end: e }; }
  if (key === "30d") { const d = new Date(today); d.setDate(d.getDate() - 29); return { start: d, end }; }
  const d = new Date(today); d.setDate(d.getDate() - 89); return { start: d, end };
}

// ── Care Log domain grouping (10 DailyRounds models → 7 report domains) ───────
type Rec = { id: string; resId: string; day: string; author: string; note: string; sortKey: number };
const CARE_RESOURCES: { resource: string; table: string; group: string }[] = [
  { resource: "vital-signs", table: "VitalSigns", group: "Vitals" },
  { resource: "meal-records", table: "MealRecord", group: "Meals & Nutrition" },
  { resource: "bowel-records", table: "BowelRecord", group: "Elimination" },
  { resource: "urine-records", table: "UrineRecord", group: "Elimination" },
  { resource: "edema-records", table: "EdemaRecord", group: "Mobility & Activity" },
  { resource: "concern-records", table: "ConcernRecord", group: "Mood & Behavior" },
  { resource: "mood-records", table: "MoodRecord", group: "Mood & Behavior" },
  { resource: "pain-records", table: "PainRecord", group: "Pain Management" },
  { resource: "mobility-records", table: "MobilityRecord", group: "Mobility & Activity" },
  { resource: "round-sleep-records", table: "SleepRecord", group: "Sleep & Rest" },
];
const CARE_GROUP_ORDER = ["Vitals", "Meals & Nutrition", "Elimination", "Mood & Behavior", "Pain Management", "Mobility & Activity", "Sleep & Rest"];

export default function ResidentProgressReport({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const { name: clinicianName } = useClinician(clinicianRole);

  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const vitQ = useLiveQuery<Row>("vitals", { query: "take=3000", tables: ["VitalsLog"] });
  const medQ = useLiveQuery<Row>("medications", { query: "take=1000", tables: ["Medication"] });
  const marQ = useLiveQuery<Row>("medication-administrations", { query: "take=4000", tables: ["MedicationAdministration"] });
  const labQ = useLiveQuery<Row>("lab-results", { query: "take=800", tables: ["LabResult"] });
  const refQ = useLiveQuery<Row>("hospital-referrals", { query: "take=400", tables: ["HospitalReferral"] });
  const commQ = useLiveQuery<Row>("physician-communications", { query: "take=400", tables: ["PhysicianCommunication"] });
  const visitQ = useLiveQuery<Row>("visits", { query: "take=600", tables: ["Visit"] });
  const roundQ = useLiveQuery<Row>("daily-rounds", { query: "take=2000", tables: ["DailyRound"] });
  const setQ = useLiveQuery<Row>("app-settings", { tables: ["AppSetting"] });

  // Each care-record resource, keyed by resource id (all fetched up-front).
  const c0 = useLiveQuery<Row>("vital-signs", { query: "take=3000", tables: ["VitalSigns"] });
  const c1 = useLiveQuery<Row>("meal-records", { query: "take=3000", tables: ["MealRecord"] });
  const c2 = useLiveQuery<Row>("bowel-records", { query: "take=3000", tables: ["BowelRecord"] });
  const c3 = useLiveQuery<Row>("urine-records", { query: "take=3000", tables: ["UrineRecord"] });
  const c4 = useLiveQuery<Row>("edema-records", { query: "take=3000", tables: ["EdemaRecord"] });
  const c5 = useLiveQuery<Row>("concern-records", { query: "take=3000", tables: ["ConcernRecord"] });
  const c6 = useLiveQuery<Row>("mood-records", { query: "take=3000", tables: ["MoodRecord"] });
  const c7 = useLiveQuery<Row>("pain-records", { query: "take=3000", tables: ["PainRecord"] });
  const c8 = useLiveQuery<Row>("mobility-records", { query: "take=3000", tables: ["MobilityRecord"] });
  const c9 = useLiveQuery<Row>("round-sleep-records", { query: "take=3000", tables: ["SleepRecord"] });
  const careData = useMemo(() => [c0.data, c1.data, c2.data, c3.data, c4.data, c5.data, c6.data, c7.data, c8.data, c9.data],
    [c0.data, c1.data, c2.data, c3.data, c4.data, c5.data, c6.data, c7.data, c8.data, c9.data]);

  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const [residentId, setResidentId] = useState("");
  const [period, setPeriod] = useState<PeriodKey>("month");
  const resident = useMemo(() => residents.find((r: Row) => s(r.id) === residentId) || null, [residents, residentId]);
  const { start, end } = useMemo(() => rangeFor(period), [period]);
  const periodLabel = PERIODS.find((p) => p.key === period)?.label || "";
  const inRange = (v: unknown) => { const t = new Date(s(v)).getTime(); return !isNaN(t) && t >= start.getTime() && t <= end.getTime(); };

  // DailyRound id → { residentId, author, day } across the whole period.
  const roundMap = useMemo(() => {
    const m = new Map<string, { resId: string; author: string; day: string; ms: number }>();
    (roundQ.data || []).forEach((r) => {
      const day = new Date(s(r.roundDate));
      m.set(s(r.id), { resId: s(r.residentId), author: s(r.caregiverName) || "Care staff", day: dayOf(r.roundDate), ms: isNaN(day.getTime()) ? 0 : day.getTime() });
    });
    return m;
  }, [roundQ.data]);

  // ── 1. Vitals average (VitalsLog rows: one per parameter, string value) ──────
  const vitalsSummary = useMemo(() => {
    const rows = (vitQ.data || []).filter((v) => s(v.residentId) === residentId && inRange(v.recordedAt || v.createdAt));
    const sys: number[] = [], dia: number[] = [], hr: number[] = [], temp: number[] = [], spo2: number[] = [];
    rows.forEach((v) => {
      const type = s(v.type).toUpperCase(); const val = s(v.value);
      if (type === "BLOOD_PRESSURE" || val.includes("/")) { const [a, b] = val.split("/"); const na = num(a), nb = num(b); if (na != null) sys.push(na); if (nb != null) dia.push(nb); }
      else if (type === "HEART_RATE" || type === "PULSE") { const n = num(val); if (n != null) hr.push(n); }
      else if (type === "TEMPERATURE") { const n = num(val); if (n != null) temp.push(n); }
      else if (type === "OXYGEN" || type === "OXYGEN_SATURATION" || type === "SPO2") { const n = num(val); if (n != null) spo2.push(n); }
    });
    return { sys: avg(sys), dia: avg(dia), hr: avg(hr), temp: avg(temp), spo2: avg(spo2), total: rows.length };
  }, [vitQ.data, residentId, start, end]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 2. Medication compliance (MedicationAdministration in range) ─────────────
  const marSummary = useMemo(() => {
    const rows = (marQ.data || []).filter((r) => s(r.residentId) === residentId && inRange(r.actualTime || r.scheduledTime || r.createdAt));
    let given = 0, missed = 0, refused = 0, held = 0;
    rows.forEach((r) => { const st = s(r.status).toUpperCase(); if (st === "GIVEN") given++; else if (st === "REFUSED") refused++; else if (st === "HELD") held++; else missed++; });
    const rate = rows.length ? Math.round((given / rows.length) * 100) : null;
    return { total: rows.length, given, missed, refused, held, rate };
  }, [marQ.data, residentId, start, end]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 3. New & discontinued medications ────────────────────────────────────────
  const medChanges = useMemo(() => {
    const mine = (medQ.data || []).filter((m) => s(m.residentId) === residentId);
    const started = mine.filter((m) => inRange(m.startDate)).map((m) => ({ id: s(m.id), name: s(m.name), when: dayOf(m.startDate), kind: "new" as const }));
    const stopped = mine.filter((m) => (s(m.status) === "DISCONTINUED" || m.endDate) && inRange(m.endDate)).map((m) => ({ id: s(m.id), name: s(m.name), when: dayOf(m.endDate), kind: "discontinued" as const }));
    return [...started, ...stopped].sort((a, b) => b.when.localeCompare(a.when));
  }, [medQ.data, residentId, start, end]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 5. Lab results ───────────────────────────────────────────────────────────
  const labs = useMemo(() => (labQ.data || [])
    .filter((l) => s(l.residentId) === residentId && inRange(l.resultedAt || l.collectedAt || l.createdAt))
    .sort((a, b) => s(b.resultedAt || b.createdAt).localeCompare(s(a.resultedAt || a.createdAt))),
    [labQ.data, residentId, start, end]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 6. Medical referrals ─────────────────────────────────────────────────────
  const referrals = useMemo(() => (refQ.data || [])
    .filter((r) => s(r.residentId) === residentId && inRange(r.scheduledDate || r.createdAt))
    .sort((a, b) => s(b.createdAt).localeCompare(s(a.createdAt))),
    [refQ.data, residentId, start, end]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 8. Diagnoses & conditions (from Resident.diagnosis / medicalHistory) ─────
  const diagnoses = useMemo(() => {
    const raw = `${s(resident?.diagnosis)} ${s(resident?.raw?.medicalHistory)}`.trim();
    return raw ? raw.split(/[,;\n]+/).map((d) => d.trim()).filter(Boolean) : [];
  }, [resident]);

  // ── 9. Shift endorsements (app-setting JSON) referencing this resident ───────
  const endorsements = useMemo(() => {
    let all: Row[] = [];
    try { const v = JSON.parse(s((setQ.data || []).find((r) => s(r.key || r.id) === ENDORSEMENT_KEY)?.value) || "[]"); all = Array.isArray(v) ? v : []; } catch { all = []; }
    return all
      .filter((e) => inRange(e.date || e.createdAt) && (e.residents || []).some((er: Row) => s(er.residentId) === residentId))
      .map((e) => {
        const mine = (e.residents || []).find((er: Row) => s(er.residentId) === residentId) as Row | undefined;
        const secText = mine ? Object.values(mine.sections || {}).map((x) => s(x)).filter(Boolean).join(" · ") : "";
        return { id: s(e.id), shift: s(e.shiftLabel).toLowerCase(), date: dayOf(e.date || e.createdAt), from: s(e.outgoingBy), to: s(e.incomingBy) || "(pending)", note: secText || s(e.generalNotes) };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [setQ.data, residentId, start, end]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 10 + 11. Care records resolved to this resident via the round map ────────
  const recsByGroup = useMemo(() => {
    const groups = new Map<string, Rec[]>();
    CARE_RESOURCES.forEach((meta, i) => {
      (careData[i] || []).forEach((r) => {
        const round = roundMap.get(s(r.dailyRoundId));
        if (!round || round.resId !== residentId) return;
        if (!inRange(round.day + "T00:00:00")) return;
        const rec: Rec = { id: s(r.id), resId: round.resId, day: round.day, author: round.author, note: s(r.behaviorNotes || r.notes || r.observation || r.description || ""), sortKey: round.ms };
        const arr = groups.get(meta.group); if (arr) arr.push(rec); else groups.set(meta.group, [rec]);
      });
    });
    groups.forEach((arr) => arr.sort((a, b) => b.day.localeCompare(a.day) || b.sortKey - a.sortKey));
    return groups;
  }, [careData, roundMap, residentId, start, end]); // eslint-disable-line react-hooks/exhaustive-deps
  const careTotal = useMemo(() => [...recsByGroup.values()].reduce((n, a) => n + a.length, 0), [recsByGroup]);

  // Mood observations (behavioral concerns) — the MoodRecord subset.
  const moodObs = useMemo(() => {
    const out: Rec[] = [];
    (careData[6] || []).forEach((r) => {
      const round = roundMap.get(s(r.dailyRoundId));
      if (!round || round.resId !== residentId || !inRange(round.day + "T00:00:00")) return;
      out.push({ id: s(r.id), resId: round.resId, day: round.day, author: round.author, note: s(r.behaviorNotes || r.mood || ""), sortKey: round.ms });
    });
    return out.sort((a, b) => b.day.localeCompare(a.day) || b.sortKey - a.sortKey);
  }, [careData, roundMap, residentId, start, end]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 12. Physician communications ─────────────────────────────────────────────
  const comms = useMemo(() => (commQ.data || [])
    .filter((c) => s(c.residentId) === residentId && inRange(c.occurredAt || c.createdAt))
    .sort((a, b) => s(b.occurredAt || b.createdAt).localeCompare(s(a.occurredAt || a.createdAt))),
    [commQ.data, residentId, start, end]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 13. Appointments (Visit rows) ────────────────────────────────────────────
  const appointments = useMemo(() => (visitQ.data || [])
    .filter((v) => s(v.residentId) === residentId && inRange(v.checkInTime || v.createdAt))
    .sort((a, b) => s(b.checkInTime || b.createdAt).localeCompare(s(a.checkInTime || a.createdAt))),
    [visitQ.data, residentId, start, end]); // eslint-disable-line react-hooks/exhaustive-deps

  const generatedAt = useMemo(() => new Date(), [residentId, period]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitForApproval = async () => {
    if (!resident) return;
    const c = await Swal.fire({ title: "Submit for approval?", html: `Submit <b>${s(resident.name)}</b>'s ${periodLabel} progress report for care-team review?`, icon: "question", showCancelButton: true, confirmButtonText: "Submit", confirmButtonColor: "#2563eb" });
    if (!c.isConfirmed) return;
    let map: Record<string, Row> = {};
    try { map = JSON.parse(s((setQ.data || []).find((r) => s(r.key || r.id) === APPROVAL_KEY)?.value) || "{}") || {}; } catch { map = {}; }
    map[`${residentId}:${period}`] = { residentId, period, status: "SUBMITTED", submittedBy: clinicianName, submittedAt: new Date().toISOString() };
    await upsertRecord("app-settings", APPROVAL_KEY, { key: APPROVAL_KEY, value: JSON.stringify(map) });
    await setQ.refetch();
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Submitted for approval", showConfirmButton: false, timer: 1600 });
  };

  const selCls = "px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40";

  return (
    <div className="min-h-full bg-[#F7F8FA] -m-4 sm:-m-6 p-4 sm:p-6">
      {/* Header + controls */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Resident Progress Report</h1>
          <p className="text-sm text-slate-500 mt-1">Comprehensive clinical summary for family updates and care reviews</p>
        </div>
        {resident && (
          <div className="flex items-center gap-2">
            <button onClick={submitForApproval} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"><ShieldCheck className="w-4 h-4" /> Submit for Approval</button>
            <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600"><Printer className="w-4 h-4" /> Print / Save PDF</button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-5">
        <label className="flex items-center gap-2 text-sm"><span className="font-bold text-slate-700">Resident:</span>
          <select value={residentId} onChange={(e) => setResidentId(e.target.value)} className={selCls}>
            <option value="">Select a resident…</option>
            {residents.map((r: Row) => <option key={s(r.id)} value={s(r.id)}>Rm {s(r.room)} — {s(r.name)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm"><span className="font-bold text-slate-700">Period:</span>
          <select value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)} className={selCls}>
            {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
      </div>

      {!resident ? (
        <div className="@container">
          <div className="mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-slate-400" />
            <div>
              <p className="text-base font-bold text-slate-800">Select a resident to generate their progress report</p>
              <p className="text-sm text-slate-500">Tap a resident to build their period summary</p>
            </div>
          </div>
          {residents.length === 0 ? (
            <p className="text-sm text-slate-400">No residents found.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 @lg:grid-cols-3 @3xl:grid-cols-4 @5xl:grid-cols-5">
              {residents.map((r: Row, i: number) => (
                <button key={s(r.id)} onClick={() => setResidentId(s(r.id))}
                  className="group flex flex-col items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md animate-in fade-in slide-in-from-bottom-2 duration-300"
                  style={{ animationDelay: `${i * 40}ms`, animationFillMode: "backwards" }}>
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600">{initials(s(r.name))}</span>
                  <span className="block w-full min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-800">{s(r.name)}</span>
                    <span className="block text-xs text-slate-400">Room {s(r.room)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-8">
          {/* Report header */}
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-5 mb-5">
            <div>
              <h2 className="text-xl font-bold text-slate-900">{s(resident.name)}</h2>
              <p className="text-sm text-slate-500">Room {s(resident.room)} · Care Level {s(resident.raw?.careLevel) || s(resident.careLevel)}{resident.age != null ? ` · Age ${resident.age}` : ""}</p>
            </div>
            <div className="text-right text-sm">
              <p className="font-bold text-slate-900">{periodLabel}</p>
              <p className="text-slate-500">{isoDay(start)} to {isoDay(end)}</p>
              <p className="text-slate-400 text-xs">Generated {fmtDT(generatedAt)}</p>
            </div>
          </div>

          {/* 1. Vitals Average */}
          <Section n={1} title="Vitals Average" icon={TrendingUp}>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <Metric label="Avg Systolic" value={fmt1(vitalsSummary.sys)} unit="mmHg" />
              <Metric label="Avg Diastolic" value={fmt1(vitalsSummary.dia)} unit="mmHg" />
              <Metric label="Avg Heart Rate" value={fmt1(vitalsSummary.hr)} unit="bpm" />
              <Metric label="Avg Temp" value={fmt1(vitalsSummary.temp)} unit="°C" />
              <Metric label="Avg SpO₂" value={fmt1(vitalsSummary.spo2)} unit="%" />
              <Metric label="Total Readings" value={String(vitalsSummary.total)} />
            </div>
          </Section>

          {/* 2. Medication Compliance */}
          <Section n={2} title="Medication Compliance (MAR)" icon={Pill}>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <Metric label="Compliance Rate" value={marSummary.rate == null ? "—" : `${marSummary.rate.toFixed(1)}%`} valueClass="text-green-600" />
              <Metric label="Doses Given" value={String(marSummary.given)} />
              <Metric label="Missed" value={String(marSummary.missed)} />
              <Metric label="Refused" value={String(marSummary.refused)} />
              <Metric label="Held" value={String(marSummary.held)} />
            </div>
          </Section>

          {/* 3. New and Discontinued Medications */}
          <Section n={3} title="New and Discontinued Medications" icon={Pill} count={medChanges.length}>
            {medChanges.length === 0 ? <Empty text="No medication changes recorded in this period." /> : (
              <div className="space-y-2">
                {medChanges.map((m) => (
                  <div key={`${m.kind}-${m.id}`} className="flex items-center justify-between gap-3 border-b border-slate-50 last:border-0 pb-2">
                    <p className="text-sm font-semibold text-slate-800">{m.name}</p>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${m.kind === "new" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>{m.kind === "new" ? "New" : "Discontinued"} · {m.when}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* 4. Therapy Sessions */}
          <Section n={4} title="Therapy Sessions" icon={Activity} count={0}>
            <Empty text="No therapy sessions recorded in this period." />
          </Section>

          {/* 5. Lab Results */}
          <Section n={5} title="Lab Results" icon={FlaskConical} count={labs.length}>
            {labs.length === 0 ? <Empty text="No lab results recorded in this period." /> : (
              <div className="space-y-3">
                {labs.map((l) => (
                  <div key={s(l.id)}>
                    <p className="text-sm font-bold text-slate-800 flex items-center gap-2">{s(l.testName)}<span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 lowercase">{s(l.status) || "resulted"}</span></p>
                    <p className="text-xs text-slate-500">{dayOf(l.resultedAt || l.collectedAt || l.createdAt)}{s(l.orderingProvider) ? ` · ${s(l.orderingProvider)}` : ""}{s(l.category) ? ` · ${s(l.category)}` : ""}</p>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* 6. Medical Referrals */}
          <Section n={6} title="Medical Referrals" icon={Send} count={referrals.length}>
            {referrals.length === 0 ? <Empty text="No referrals recorded in this period." /> : (
              <div className="space-y-3">
                {referrals.map((r) => (
                  <div key={s(r.id)}>
                    <p className="text-sm font-bold text-slate-800">{s(r.specialist) || s(r.facilityName) || "Referral"}</p>
                    <p className="text-xs text-slate-500">{dayOf(r.scheduledDate || r.createdAt)}{s(r.reason) ? ` · ${s(r.reason)}` : ""} · {s(r.status).toLowerCase()}</p>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* 7. Physician Orders */}
          <Section n={7} title="Physician Orders" icon={ClipboardList} count={0}>
            <Empty text="No physician orders recorded in this period." />
          </Section>

          {/* 8. List of Diagnoses and Conditions */}
          <Section n={8} title="List of Diagnoses and Conditions" icon={Stethoscope} count={diagnoses.length}>
            {diagnoses.length === 0 ? <Empty text="No diagnoses recorded in this period." /> : (
              <div className="flex flex-wrap gap-2">
                {diagnoses.map((d, i) => <span key={i} className="text-sm text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1">{d}</span>)}
              </div>
            )}
          </Section>

          {/* 9. Important Shift Endorsements */}
          <Section n={9} title="Important Shift Endorsements" icon={MessageSquare} count={endorsements.length}>
            {endorsements.length === 0 ? <Empty text="No shift endorsements recorded in this period." /> : (
              <div className="space-y-3">
                {endorsements.slice(0, 15).map((e) => (
                  <div key={e.id} className="border-b border-slate-50 last:border-0 pb-2">
                    <p className="text-sm text-slate-700"><span className="text-[11px] font-semibold border border-slate-200 rounded px-1.5 py-0.5 mr-2 capitalize">{e.shift || "shift"} · {e.date}</span><span className="text-slate-600">{e.from || "—"} → {e.to}</span></p>
                    {e.note && <p className="text-xs text-slate-400 mt-0.5">{e.note}</p>}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* 10. Behavioral Concerns */}
          <Section n={10} title="Behavioral Concerns" icon={Brain} count={moodObs.length}>
            {moodObs.length === 0 ? <Empty text="No behavioral observations recorded in this period." /> : (
              <div>
                <p className="text-xs font-semibold text-slate-500 mb-2">Mood Observations ({moodObs.length})</p>
                <ul className="space-y-1">
                  {moodObs.slice(0, 10).map((o) => (
                    <li key={o.id} className="text-sm text-slate-700">{o.day} — {o.author}{o.note ? `: ${o.note}` : ""}</li>
                  ))}
                </ul>
                {moodObs.length > 10 && <p className="text-xs italic text-slate-400 mt-1">+{moodObs.length - 10} more entries</p>}
              </div>
            )}
          </Section>

          {/* 11. Care Log Summaries (7 Domains) */}
          <Section n={11} title="Care Log Summaries (7 Domains)" icon={HeartPulse} count={careTotal}>
            {careTotal === 0 ? <Empty text="No care logs recorded in this period." /> : (
              <div className="space-y-4">
                {CARE_GROUP_ORDER.map((g) => { const arr = recsByGroup.get(g) || []; if (arr.length === 0) return null; return (
                  <div key={g}>
                    <p className="text-sm font-bold text-slate-800">{g} ({arr.length})</p>
                    <ul className="mt-1 space-y-1">
                      {arr.slice(0, 5).map((r) => <li key={r.id} className="text-sm text-slate-700 flex gap-2"><span className="text-slate-300">—</span><span>{r.day} — {r.author}{r.note ? `: ${r.note}` : ""}</span></li>)}
                    </ul>
                    {arr.length > 5 && <p className="text-xs italic text-slate-400 mt-1">+{arr.length - 5} more</p>}
                  </div>
                ); })}
              </div>
            )}
          </Section>

          {/* 12. Physician Communications */}
          <Section n={12} title="Physician Communications" icon={Phone} count={comms.length}>
            {comms.length === 0 ? <Empty text="No physician communications recorded in this period." /> : (
              <div className="space-y-3">
                {comms.map((c) => (
                  <div key={s(c.id)}>
                    <p className="text-sm font-bold text-slate-800">{s(c.physicianName) || "Physician"}<span className="text-xs font-normal text-slate-400"> · {s(c.method).toLowerCase().replace("_", " ")}</span></p>
                    <p className="text-xs text-slate-500">{dayOf(c.occurredAt || c.createdAt)}{s(c.reason) ? ` · ${s(c.reason)}` : ""}</p>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* 13. Appointments */}
          <Section n={13} title="Appointments" icon={CalendarDays} count={appointments.length} last>
            {appointments.length === 0 ? <Empty text="No appointments recorded in this period." /> : (
              <div className="space-y-3">
                {appointments.map((v) => { const purpose = s(v.purpose).replace(/^\[[A-Z_]+\]\s*/, ""); return (
                  <div key={s(v.id)}>
                    <p className="text-sm font-bold text-slate-800">{purpose || "Appointment"}</p>
                    <p className="text-xs text-slate-500">{dayOf(v.checkInTime || v.createdAt)}{s(v.visitorName) ? ` · ${s(v.visitorName)}` : ""}</p>
                  </div>
                ); })}
              </div>
            )}
          </Section>

          <div className="border-t border-slate-100 mt-6 pt-5 text-center text-xs text-slate-400">
            LifeCare Living Solutions — Confidential Clinical Record · Generated {fmtDT(generatedAt)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Presentational helpers ───────────────────────────────────────────────────
function Section({ n, title, icon: Icon, count, last, children }: { n: number; title: string; icon: typeof FileText; count?: number; last?: boolean; children: React.ReactNode }) {
  return (
    <div className={last ? "" : "mb-7"}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><Icon className="w-4 h-4 text-blue-500" /> {n}. {title}</h3>
        {count != null && <span className="text-xs font-semibold text-slate-500 border border-slate-200 rounded-full min-w-[1.75rem] text-center px-2 py-0.5">{count}</span>}
      </div>
      {children}
    </div>
  );
}

function Metric({ label, value, unit, valueClass }: { label: string; value: string; unit?: string; valueClass?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-lg font-bold ${valueClass || "text-slate-800"}`}>{value}{unit && <span className="text-xs font-normal text-slate-400"> {unit}</span>}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm italic text-slate-400">{text}</p>;
}
