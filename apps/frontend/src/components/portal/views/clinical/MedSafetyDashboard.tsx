"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, XCircle, RefreshCcw, ShieldAlert, ClipboardX, Loader2 } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { classifyMedication, isPrn } from "@/lib/medSafety";

/* eslint-disable @typescript-eslint/no-explicit-any */
const str = (v: unknown, d = "") => (typeof v === "string" ? v : v == null ? d : String(v));
const LATE_GRACE_MIN = 60; // minutes past the scheduled time before a dose counts as "late"

/**
 * Real-time medication-safety dashboard — the operational metrics from the eMAR
 * concept: overdue doses, refusals, late administrations, PRN follow-ups,
 * controlled-substance administrations (for count reconciliation), and
 * medication errors. Computed live from the administration record + incidents.
 */
export default function MedSafetyDashboard() {
  const { data: marRows, loading } = useLiveQuery<any>("medication-administrations", { query: "take=1000", tables: ["MedicationAdministration"] });
  const { data: medRows } = useLiveQuery<any>("medications", { query: "take=500", tables: ["Medication"] });
  const { data: incRows } = useLiveQuery<any>("incidents", { query: "take=500", tables: ["Incident"] });
  const { data: resRows } = useLiveQuery<any>("residents", { query: "take=500", tables: ["Resident"] });

  const medMap = useMemo(() => new Map((medRows || []).map((m: any) => [m.id, m])), [medRows]);
  const resMap = useMemo(() => new Map((resRows || []).map(adaptResident).map((r) => [r.id, r])), [resRows]);
  const nameOf = (mar: any) => resMap.get(str(mar.residentId))?.name || "Unknown";
  const medOf = (mar: any) => medMap.get(str(mar.medicationId));

  // Reading the clock during render is impure; hold "now" in state, refreshed
  // each minute so the time-relative metrics stay live.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const t0 = setTimeout(() => setNow(Date.now()), 0); // async initial set (not synchronous-in-effect)
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => { clearTimeout(t0); clearInterval(t); };
  }, []);
  const dayAgo = now - 24 * 3_600_000;
  const weekAgo = now - 7 * 86_400_000;

  const m = useMemo(() => {
    const rows = (marRows || []) as any[];
    const t = (v: any) => (v ? new Date(v).getTime() : 0);

    const overdue = rows.filter((r) => r.status === "SCHEDULED" && r.scheduledTime && t(r.scheduledTime) < now)
      .sort((a, b) => t(a.scheduledTime) - t(b.scheduledTime));
    const refusals = rows.filter((r) => r.status === "REFUSED" && t(r.actualTime || r.scheduledTime) >= weekAgo);
    const late = rows.filter((r) => r.status === "GIVEN" && r.scheduledTime && r.actualTime && (t(r.actualTime) - t(r.scheduledTime)) > LATE_GRACE_MIN * 60_000);
    const prnFollowUps = rows.filter((r) => r.status === "GIVEN" && t(r.actualTime) >= dayAgo && isPrn(medOf(r)?.frequency));
    const controlled = rows.filter((r) => r.status === "GIVEN" && t(r.actualTime) >= weekAgo && classifyMedication(medOf(r)?.name).controlled);
    const medErrors = ((incRows || []) as any[]).filter((i) => String(i.incidentType) === "MEDICATION_ERROR");
    return { overdue, refusals, late, prnFollowUps, controlled, medErrors };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marRows, incRows, medMap, now]);

  const cards = [
    { key: "overdue", label: "Overdue doses", value: m.overdue.length, icon: Clock, tone: "text-red-600 bg-red-50 border-red-200" },
    { key: "late", label: "Late (7d)", value: m.late.length, icon: AlertTriangle, tone: "text-amber-600 bg-amber-50 border-amber-200" },
    { key: "refusals", label: "Refusals (7d)", value: m.refusals.length, icon: XCircle, tone: "text-orange-600 bg-orange-50 border-orange-200" },
    { key: "prn", label: "PRN follow-ups (24h)", value: m.prnFollowUps.length, icon: RefreshCcw, tone: "text-blue-600 bg-blue-50 border-blue-200" },
    { key: "controlled", label: "Controlled given (7d)", value: m.controlled.length, icon: ShieldAlert, tone: "text-purple-600 bg-purple-50 border-purple-200" },
    { key: "errors", label: "Medication errors", value: m.medErrors.length, icon: ClipboardX, tone: "text-red-700 bg-red-50 border-red-300" },
  ];

  if (loading && !(marRows || []).length) {
    return <div className="bg-white rounded-xl border p-10 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-gray-800 flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-purple-600" /> Medication Safety</h3>
        <p className="text-xs text-gray-500">Live oversight — overdue, late, refusals, PRN follow-ups, controlled-substance counts, and errors.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map((c) => { const Icon = c.icon; return (
          <div key={c.key} className={`rounded-xl border p-3 ${c.tone}`}>
            <Icon className="w-5 h-5 mb-1" />
            <p className="text-2xl font-black leading-none">{c.value}</p>
            <p className="text-[11px] font-semibold mt-1 leading-tight">{c.label}</p>
          </div>
        ); })}
      </div>

      <ListPanel title="Overdue doses" icon={Clock} rows={m.overdue} empty="No overdue doses — all scheduled meds are current."
        render={(r) => `${nameOf(r)} · ${medOf(r)?.name ?? "—"} · scheduled ${new Date(r.scheduledTime).toLocaleString()}`} />
      <ListPanel title="Late administrations (last 7 days)" icon={AlertTriangle} rows={m.late} empty="No late administrations."
        render={(r) => `${nameOf(r)} · ${medOf(r)?.name ?? "—"} · ${Math.round((new Date(r.actualTime).getTime() - new Date(r.scheduledTime).getTime()) / 60000)} min late`} />
      <ListPanel title="Refusals (last 7 days)" icon={XCircle} rows={m.refusals} empty="No refusals."
        render={(r) => `${nameOf(r)} · ${medOf(r)?.name ?? "—"}${r.reasonForRefusal ? ` — ${r.reasonForRefusal}` : ""}`} />
      <ListPanel title="Controlled substances given (last 7 days)" icon={ShieldAlert} rows={m.controlled} empty="No controlled-substance administrations."
        render={(r) => `${nameOf(r)} · ${medOf(r)?.name ?? "—"} · witnessed by ${r.witnessName || "—"} · ${r.actualTime ? new Date(r.actualTime).toLocaleString() : ""}`} />
    </div>
  );
}

function ListPanel({ title, icon: Icon, rows, empty, render }: { title: string; icon: any; rows: any[]; empty: string; render: (r: any) => string }) {
  return (
    <div className="bg-white rounded-xl border p-4">
      <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5 mb-2"><Icon className="w-4 h-4 text-gray-500" /> {title} <span className="text-xs text-gray-400">({rows.length})</span></h4>
      {rows.length === 0 ? <p className="text-sm text-gray-400">{empty}</p> : (
        <ul className="space-y-1 max-h-56 overflow-y-auto">
          {rows.slice(0, 30).map((r, i) => <li key={r.id ?? i} className="text-sm text-gray-700 border-b border-gray-50 py-1">{render(r)}</li>)}
          {rows.length > 30 && <li className="text-xs text-gray-400 pt-1">…and {rows.length - 30} more</li>}
        </ul>
      )}
    </div>
  );
}
