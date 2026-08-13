"use client";

/**
 * Medication Compliance Report — Given / Refused / Held / Missed dose breakdown
 * over a date range, from real MedicationAdministration rows (each row = one dose
 * occurrence). Two views: Facility Overview (per-resident table) and Per-Resident
 * Detail (per-medication table). Read-only; no schema changes.
 */

import { useMemo, useState } from "react";
import { Pill, TrendingUp, CheckCircle2, AlertCircle, Printer, Users, BarChart3, ChevronUp, ChevronDown } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const s = (v: unknown) => (v == null ? "" : String(v));
const iso = (d: Date) => d.toISOString().split("T")[0];
const midnight = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

type RangeKey = "week" | "lastweek" | "30d" | "month";
const rangeFor = (key: RangeKey): { start: Date; end: Date } => {
  const today = midnight(new Date());
  const end = new Date(); end.setHours(23, 59, 59, 999);
  if (key === "week") { const d = new Date(today); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return { start: d, end }; }
  if (key === "lastweek") { const d = new Date(today); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7); const e = new Date(d); e.setDate(e.getDate() + 6); e.setHours(23, 59, 59, 999); return { start: d, end: e }; }
  if (key === "30d") { const d = new Date(today); d.setDate(d.getDate() - 29); return { start: d, end }; }
  const d = new Date(today.getFullYear(), today.getMonth(), 1); return { start: d, end };
};

interface Tally { doses: number; given: number; refused: number; held: number; missed: number; }
const emptyTally = (): Tally => ({ doses: 0, given: 0, refused: 0, held: 0, missed: 0 });
const compliancePct = (t: Tally) => (t.doses ? Math.round((t.given / t.doses) * 100) : null);
const pctTone = (p: number | null) => (p == null ? "#94a3b8" : p >= 80 ? "#16a34a" : p >= 60 ? "#d97706" : "#dc2626");
const pctBadge = (p: number | null) => (p == null ? "bg-slate-100 text-slate-400" : p >= 80 ? "bg-green-100 text-green-700" : p >= 60 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700");

export default function MedicationComplianceBoard() {
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const marQ = useLiveQuery<Row>("medication-administrations", { query: "take=4000", tables: ["MedicationAdministration"] });
  const medQ = useLiveQuery<Row>("medications", { query: "take=1000", tables: ["Medication"] });

  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const [range, setRange] = useState<RangeKey>("week");
  const [view, setView] = useState<"facility" | "resident">("facility");
  const [sortKey, setSortKey] = useState<keyof Tally>("given");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [detailRes, setDetailRes] = useState("");

  const { start, end } = useMemo(() => rangeFor(range), [range]);
  const inRange = (r: Row) => { const t = new Date(s(r.actualTime || r.scheduledTime || r.createdAt)).getTime(); return t >= start.getTime() && t <= end.getTime(); };
  const marsInRange = useMemo(() => (marQ.data || []).filter(inRange), [marQ.data, start, end]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (t: Tally, status: string) => { t.doses++; const st = status.toUpperCase(); if (st === "GIVEN") t.given++; else if (st === "REFUSED") t.refused++; else if (st === "HELD") t.held++; else if (st === "MISSED" || st === "SCHEDULED") t.missed++; };

  // Per-resident tallies.
  const byResident = useMemo(() => {
    const m = new Map<string, Tally>();
    marsInRange.forEach((r) => { const id = s(r.residentId); const t = m.get(id) || emptyTally(); add(t, s(r.status)); m.set(id, t); });
    return m;
  }, [marsInRange]);

  const facility = useMemo(() => { const t = emptyTally(); marsInRange.forEach((r) => add(t, s(r.status))); return t; }, [marsInRange]);
  const residentsWithMissed = useMemo(() => [...byResident.values()].filter((t) => t.missed > 0).length, [byResident]);

  const sortedResidents = useMemo(() => {
    const arr = residents.map((r: Row) => ({ r, t: byResident.get(s(r.id)) || emptyTally() }));
    arr.sort((a, b) => { const av = a.t[sortKey], bv = b.t[sortKey]; return sortDir === "asc" ? av - bv : bv - av; });
    return arr;
  }, [residents, byResident, sortKey, sortDir]);

  const toggleSort = (k: keyof Tally) => { if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc")); else { setSortKey(k); setSortDir("desc"); } };
  const dash = (n: number) => (n === 0 ? "—" : String(n));
  const rangeLabel = `${iso(start)} – ${iso(end)}`;

  return (
    <div className="min-h-full bg-[#F7F8FA] -m-4 sm:-m-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 flex items-center gap-2.5"><span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 shrink-0"><Pill className="h-5 w-5 text-blue-500" /></span> Medication Compliance Report</h1>
          <p className="text-sm text-slate-500 mt-1">Given, Refused, Held, and Missed dose breakdown</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"><Printer className="w-4 h-4" /> Export PDF</button>
          <div className="inline-flex rounded-xl border border-slate-200 bg-white overflow-hidden text-sm">
            {([["week", "This week"], ["lastweek", "Last week"], ["30d", "Last 30 days"], ["month", "This month"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setRange(v)} className={`px-3 py-2 font-medium ${range === v ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard icon={TrendingUp} tint="#16a34a" bg="bg-green-50" value={compliancePct(facility) == null ? "—" : `${compliancePct(facility)}%`} label="Facility Compliance" sub={rangeLabel} />
        <StatCard icon={Pill} tint="#2563eb" bg="bg-blue-50" value={String(facility.doses)} label="Total Doses Scheduled" />
        <StatCard icon={CheckCircle2} tint="#16a34a" bg="bg-green-50" value={String(facility.given)} label="Doses Given" />
        <StatCard icon={AlertCircle} tint="#dc2626" bg="bg-red-50" value={String(residentsWithMissed)} label="Residents with Missed Doses" sub="pending / not administered" />
      </div>

      <div className="inline-flex gap-1 bg-slate-100 rounded-xl p-1 mb-5">
        {([["facility", "Facility Overview", Users], ["resident", "Per-Resident Detail", BarChart3]] as const).map(([v, label, Icon]) => (
          <button key={v} onClick={() => setView(v)} className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium ${view === v ? "bg-white shadow-sm text-slate-800" : "text-slate-500"}`}><Icon className="w-4 h-4" /> {label}</button>
        ))}
      </div>

      {view === "facility" ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <p className="font-bold text-slate-900">All Residents — Dose Compliance</p>
          <p className="text-xs text-slate-400 mb-3">{rangeLabel} · Click column headers to sort</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead><tr className="text-left border-b border-slate-100">
                <th className="font-semibold text-slate-500 px-3 py-2.5">Resident</th>
                <th className="font-semibold text-slate-500 px-3 py-2.5 text-center">Doses</th>
                {([["given", "Given", "text-green-600"], ["refused", "Refused", "text-amber-600"], ["held", "Held", "text-blue-600"], ["missed", "Missed", "text-red-600"]] as const).map(([k, label, cls]) => (
                  <th key={k} onClick={() => toggleSort(k)} className={`font-semibold px-3 py-2.5 text-center cursor-pointer select-none ${cls}`}>
                    <span className="inline-flex items-center gap-1">{label}{sortKey === k ? (sortDir === "asc" ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />) : null}</span>
                  </th>
                ))}
              </tr></thead>
              <tbody>
                {sortedResidents.map(({ r, t }) => (
                  <tr key={s(r.id)} className="border-b border-slate-50 last:border-0">
                    <td className="px-3 py-2.5"><span className="inline-flex items-center gap-2"><span className="w-7 h-7 rounded-full bg-blue-50 text-blue-600 text-[10px] font-bold flex items-center justify-center">{s(r.room)}</span><span className="font-semibold text-slate-800">{s(r.name)}</span></span></td>
                    <td className="px-3 py-2.5 text-center text-slate-700">{t.doses}</td>
                    <td className="px-3 py-2.5 text-center font-semibold text-green-600">{dash(t.given)}</td>
                    <td className="px-3 py-2.5 text-center text-amber-600">{dash(t.refused)}</td>
                    <td className="px-3 py-2.5 text-center text-blue-600">{dash(t.held)}</td>
                    <td className="px-3 py-2.5 text-center text-red-600">{dash(t.missed)}</td>
                  </tr>
                ))}
                {residents.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">No residents.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-4 mt-4 text-xs text-slate-500">
            <span className="font-semibold text-slate-600">Compliance key:</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500" /> ≥80% Good</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> 60–79% Needs attention</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> &lt;60% Critical</span>
            <span className="text-slate-400">· Missed = doses still pending (not administered)</span>
          </div>
        </div>
      ) : (
        <ResidentDetail residents={residents} meds={medQ.data || []} marsInRange={marsInRange} add={add} rangeLabel={rangeLabel} end={end} detailRes={detailRes} setDetailRes={setDetailRes} />
      )}
    </div>
  );
}

function StatCard({ icon: Icon, tint, bg, value, label, sub }: { icon: typeof Pill; tint: string; bg: string; value: string; label: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 flex items-start gap-3">
      <span className={`w-10 h-10 rounded-full ${bg} flex items-center justify-center shrink-0`}><Icon className="w-5 h-5" style={{ color: tint }} /></span>
      <div><p className="text-2xl font-bold" style={{ color: value === "—" ? "#94a3b8" : tint }}>{value}</p><p className="text-sm text-slate-600">{label}</p>{sub && <p className="text-[11px] text-slate-400">{sub}</p>}</div>
    </div>
  );
}

function ResidentDetail({ residents, meds, marsInRange, add, rangeLabel, end, detailRes, setDetailRes }: {
  residents: Row[]; meds: Row[]; marsInRange: Row[]; add: (t: Tally, status: string) => void; rangeLabel: string; end: Date; detailRes: string; setDetailRes: (v: string) => void;
}) {
  const resId = detailRes || (residents[0] ? s(residents[0].id) : "");
  const resident = residents.find((r: Row) => s(r.id) === resId);
  const resMeds = useMemo(() => meds.filter((m) => s(m.residentId) === resId && new Date(s(m.startDate)).getTime() <= end.getTime() && s(m.status) !== "DISCONTINUED"), [meds, resId, end]);
  const marsFor = useMemo(() => marsInRange.filter((r) => s(r.residentId) === resId), [marsInRange, resId]);
  const perMed = useMemo(() => {
    const m = new Map<string, Tally>();
    marsFor.forEach((r) => { const id = s(r.medicationId); const t = m.get(id) || emptyTally(); add(t, s(r.status)); m.set(id, t); });
    return m;
  }, [marsFor]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = useMemo(() => { const t = emptyTally(); marsFor.forEach((r) => add(t, s(r.status))); return t; }, [marsFor]); // eslint-disable-line react-hooks/exhaustive-deps
  const dash = (n: number) => (n === 0 ? "—" : String(n));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select value={resId} onChange={(e) => setDetailRes(e.target.value)} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40">
          {residents.map((r) => <option key={s(r.id)} value={s(r.id)}>Rm {s(r.room)} — {s(r.name)}</option>)}
        </select>
        <span className="text-xs text-slate-400">{rangeLabel}</span>
      </div>

      {resident && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3"><span className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 text-xs font-bold flex flex-col items-center justify-center leading-none"><span className="text-[9px]">Rm</span>{s(resident.room)}</span><div><p className="font-bold text-slate-900">{s(resident.name)}</p><p className="text-xs text-slate-500">{resMeds.length} medication{resMeds.length === 1 ? "" : "s"} in period</p></div></div>
          <div className="flex items-center gap-6 text-center">
            <div><p className="text-lg font-bold" style={{ color: pctTone(compliancePct(total)) }}>{compliancePct(total) == null ? "—" : `${compliancePct(total)}%`}</p><p className="text-[11px] text-slate-400">Overall</p></div>
            <div><p className="text-lg font-bold text-slate-800">{total.doses}</p><p className="text-[11px] text-slate-400">Total doses</p></div>
            <div><p className="text-lg font-bold text-green-600">{total.given}</p><p className="text-[11px] text-slate-400">Given</p></div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead><tr className="text-left border-b border-slate-100">
            <th className="font-semibold text-slate-500 px-3 py-2.5">Medication</th>
            <th className="font-semibold text-slate-500 px-3 py-2.5">Dose / Route</th>
            <th className="font-semibold text-slate-500 px-3 py-2.5 text-center">Total</th>
            <th className="font-semibold text-green-600 px-3 py-2.5 text-center">Given</th>
            <th className="font-semibold text-amber-600 px-3 py-2.5 text-center">Refused</th>
            <th className="font-semibold text-blue-600 px-3 py-2.5 text-center">Held</th>
            <th className="font-semibold text-red-600 px-3 py-2.5 text-center">Missed</th>
            <th className="font-semibold text-slate-500 px-3 py-2.5 text-center">Compliance</th>
          </tr></thead>
          <tbody>
            {resMeds.length === 0 ? <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">No medications in this period.</td></tr>
              : resMeds.map((m) => { const t = perMed.get(s(m.id)) || emptyTally(); const p = compliancePct(t); const nm = s(m.name); const paren = nm.match(/^(.*?)\s*\((.*)\)\s*$/); return (
                <tr key={s(m.id)} className="border-b border-slate-50 last:border-0">
                  <td className="px-3 py-2.5"><p className="font-semibold text-slate-800">{paren ? paren[1] : nm}</p>{(paren ? paren[2] : s(m.reason)) && <p className="text-xs text-slate-400">{paren ? paren[2] : ""}</p>}</td>
                  <td className="px-3 py-2.5 text-slate-600">{s(m.dosage) || "NA"}<span className="block text-xs text-slate-400">{s(m.route) || "oral"} · {s(m.frequency)}</span></td>
                  <td className="px-3 py-2.5 text-center text-slate-700">{t.doses}</td>
                  <td className="px-3 py-2.5 text-center text-green-600 font-semibold">{t.given}<span className="block text-[10px] text-slate-400">{p == null ? "0%" : `${p}%`}</span></td>
                  <td className="px-3 py-2.5 text-center text-amber-600">{dash(t.refused)}</td>
                  <td className="px-3 py-2.5 text-center text-blue-600">{dash(t.held)}</td>
                  <td className="px-3 py-2.5 text-center text-red-600">{dash(t.missed)}</td>
                  <td className="px-3 py-2.5 text-center"><span className={`text-xs font-bold px-2 py-0.5 rounded-full ${pctBadge(p)}`}>{p == null ? "0%" : `${p}%`}</span></td>
                </tr>
              ); })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
