"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";

/* ── Live data hooks shared across family modules ─────────────────────── */

export type Row = Record<string, unknown>;

/** The family's linked resident with incidents + medications included. */
export function useRelative() {
  const { data: residentRows, loading } = useLiveQuery("residents", {
    query: "include=incidents,medications&take=1",
    tables: ["Resident", "Incident", "Medication"],
  });
  const relative = useMemo(
    () => (residentRows.length ? adaptResident(residentRows[0]) : null),
    [residentRows]
  );
  return {
    relative,
    loading,
    displayName: relative?.name ?? "your relative",
  };
}

/** Current time in state — reading the clock during render is impure. */
export function useNowTs(intervalMs = 60_000) {
  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    tick();
    const t = setInterval(tick, intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return nowTs;
}

/** Vitals rows scoped to the linked relative (by residentId or room). */
export function relVitalsOf(
  vitalsRows: Row[],
  relative: { id: string; room: string } | null
): Row[] {
  if (!relative) return vitalsRows;
  return vitalsRows.filter((v) => {
    const res = v.resident as { roomNumber?: string } | undefined;
    return v.residentId === relative.id || res?.roomNumber === relative.room;
  });
}

/** Latest reading of a vital type from a scoped rows list. */
export function latestVitalOf(rows: Row[], type: string): Row | undefined {
  let best: Row | undefined;
  for (const v of rows) {
    if (v.type !== type) continue;
    if (!best || new Date(String(v.recordedAt)) > new Date(String(best.recordedAt))) best = v;
  }
  return best;
}

/** Relative "5m ago" formatter. */
export function relTime(ts: number, nowTs: number): string {
  if (!ts || !nowTs) return "";
  const m = Math.round((nowTs - ts) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

/* ── Presentation primitives ──────────────────────────────────────────── */

/** Small inline loading indicator shown while a tab's query is fetching. */
export function TabLoading({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-10 text-gray-500">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-3" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

/** Friendly empty state for tabs with no rows. */
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
      {message}
    </div>
  );
}

/** Pulsing "Live" indicator used in every module header. */
export function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-green-600">
      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live
    </span>
  );
}

/** Form field wrapper. */
export function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

/** Dashboard panel wrapper. */
export function Panel({ title, icon: Icon, count, children }: { title: string; icon: typeof ChevronRight; count?: number; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Icon className="w-4 h-4 text-blue-500" /> {title}</h3>
        {typeof count === "number" && count > 0 && <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full text-xs font-bold">{count}</span>}
      </div>
      {children}
    </div>
  );
}

/* ── Stat cards ───────────────────────────────────────────────────────── */

const REPORT_TONES: Record<string, { wrap: string; icon: string; value: string }> = {
  gray: { wrap: "bg-white border-gray-200", icon: "text-gray-500", value: "text-gray-900" },
  blue: { wrap: "bg-blue-50 border-blue-200", icon: "text-blue-500", value: "text-blue-600" },
  red: { wrap: "bg-red-50 border-red-200", icon: "text-red-500", value: "text-red-600" },
  green: { wrap: "bg-green-50 border-green-200", icon: "text-green-500", value: "text-green-600" },
  rose: { wrap: "bg-rose-50 border-rose-200", icon: "text-rose-500", value: "text-rose-600" },
  purple: { wrap: "bg-purple-50 border-purple-200", icon: "text-purple-500", value: "text-purple-600" },
};

export function ReportStat({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof ChevronRight; tone: keyof typeof REPORT_TONES }) {
  const t = REPORT_TONES[tone] ?? REPORT_TONES.gray;
  return (
    <div className={`p-4 rounded-lg border ${t.wrap}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs sm:text-sm text-gray-600 font-semibold">{label}</p>
        <Icon className={`w-4 h-4 ${t.icon}`} />
      </div>
      <p className={`text-2xl sm:text-3xl font-bold mt-1 ${t.value}`}>{value}</p>
    </div>
  );
}

export function MoneyStat({ label, value, icon: Icon, tone, sub }: { label: string; value: string; icon: typeof ChevronRight; tone: "gray" | "green" | "amber" | "red"; sub?: string }) {
  const T = {
    gray: { wrap: "bg-white border-gray-200", icon: "text-gray-500", value: "text-gray-900" },
    green: { wrap: "bg-green-50 border-green-200", icon: "text-green-500", value: "text-green-600" },
    amber: { wrap: "bg-amber-50 border-amber-200", icon: "text-amber-500", value: "text-amber-600" },
    red: { wrap: "bg-red-50 border-red-200", icon: "text-red-500", value: "text-red-600" },
  }[tone];
  return (
    <div className={`p-4 rounded-lg border ${T.wrap}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs sm:text-sm text-gray-600 font-semibold">{label}</p>
        <Icon className={`w-4 h-4 ${T.icon}`} />
      </div>
      <p className={`text-xl sm:text-2xl font-bold mt-1 ${T.value}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

/** Fallback chart data used when the database has no vitals yet. */
export const MOCK_VITALS_TREND = [
  { name: "Mon", value: 74 },
  { name: "Tue", value: 76 },
  { name: "Wed", value: 75 },
  { name: "Thu", value: 77 },
  { name: "Fri", value: 75 },
  { name: "Sat", value: 73 },
];
