"use client";

/**
 * Vitals Trend — per-resident vital-sign trends over time.
 * Primary source: VitalSigns (systolic/diastolic/heartRate/temperature/respRate/
 * spo2/weight, timestamp `time`, FK `dailyRoundId`). Resident + "Logged by" are
 * resolved by joining each reading's dailyRoundId to its DailyRound
 * (residentId + caregiverName). Weight also merges the migration-free
 * `weight_logs` app-setting (weekly Sunday weights) so the Weight card has data
 * even when vitals rows carry no weight.
 *
 * Numeric "Other Trends" (Pain score, Sleep hours) are derived from the same
 * DailyRounds domain models (pain-records `score`, round-sleep-records
 * `totalHours`) joined the same way — rendered only when ≥2 points fall in range.
 *
 * All charts are dependency-free inline SVG (strict CSP — no chart library).
 * Read-only board; no writes.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Activity, Heart, Thermometer, Droplets, Wind, Scale, Zap, Moon,
  Utensils, Footprints, Smile, AlertTriangle, CircleDot, Waves,
  FileDown, type LucideIcon,
} from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { levelOf } from "./CareLogsBoard";
import type { ClinicianRole } from "./useClinician";
import { ClinicalPage, ClinicalHeader, ClinicalButton, StatCard, DataState, controlClass, SERIF } from "./clinical-ui";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const s = (v: unknown) => (v == null ? "" : String(v));
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
const num = (v: unknown): number | null => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const RANGES = [7, 14, 30, 90] as const;
type RangeDays = (typeof RANGES)[number];

// Normal ranges (per the quick-log hints + spec).
const NORMAL = {
  systolic: [90, 139] as const,
  diastolic: [60, 89] as const,
  heartRate: [60, 100] as const,
  temperature: [36.1, 37.2] as const,
  spo2: [95, 100] as const,
  respRate: [12, 20] as const,
};

const inRange = (v: number | null, lo: number, hi: number) => v != null && v >= lo && v <= hi;

// Ordinal maps for the categorical DailyRounds domains → a numeric trend line, with
// a formatter that restores the real label in the tooltip + the latest value.
const EDEMA_LABEL = ["None", "Trace", "Mild", "Moderate", "Severe", "Deep"];
const EDEMA_ORD: Record<string, number> = { NONE: 0, TRACE: 1, MILD: 2, MODERATE: 3, SEVERE: 4, DEEP: 5 };
const MOOD_ORDER = ["AGGRESSIVE", "AGITATED", "ANXIOUS", "CONFUSED", "SAD", "WITHDRAWN", "APATHETIC", "COOPERATIVE", "CALM", "HAPPY"];
const MOOD_ORD: Record<string, number> = Object.fromEntries(MOOD_ORDER.map((m, i) => [m, i]));
const MOOD_LABEL = MOOD_ORDER.map((m) => m.charAt(0) + m.slice(1).toLowerCase());
const CONCERN_LABEL = ["—", "Low", "Medium", "High", "Critical"];
const CONCERN_ORD: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
const fmtEdema = (v: number) => EDEMA_LABEL[Math.round(v)] ?? String(v);
const fmtMood = (v: number) => MOOD_LABEL[Math.round(v)] ?? String(v);
const fmtConcern = (v: number) => CONCERN_LABEL[Math.round(v)] ?? String(v);
const fmtBristol = (v: number) => `Type ${Math.round(v)}`;
const parsePct = (x: unknown): number | null => { const n = parseInt(String(x ?? "").replace(/[^0-9]/g, ""), 10); return Number.isFinite(n) ? n : null; };

// One normalized reading for a resident.
interface Reading {
  at: string; // ISO timestamp
  systolic: number | null;
  diastolic: number | null;
  heartRate: number | null;
  temperature: number | null;
  spo2: number | null;
  respRate: number | null;
  weight: number | null;
  by: string;
}

const fmtDay = (iso: string) => {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}`;
};
const fmtFullDate = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const fmtNum = (v: number | null, digits = 0) => (v == null ? "—" : v.toFixed(digits).replace(/\.0$/, ""));

// A reading is Abnormal if any measured vital falls outside its normal range.
const isAbnormal = (r: Reading): boolean => {
  if (r.systolic != null && !inRange(r.systolic, ...NORMAL.systolic)) return true;
  if (r.diastolic != null && !inRange(r.diastolic, ...NORMAL.diastolic)) return true;
  if (r.heartRate != null && !inRange(r.heartRate, ...NORMAL.heartRate)) return true;
  if (r.temperature != null && !inRange(r.temperature, ...NORMAL.temperature)) return true;
  if (r.spo2 != null && !inRange(r.spo2, ...NORMAL.spo2)) return true;
  if (r.respRate != null && !inRange(r.respRate, ...NORMAL.respRate)) return true;
  return false;
};

// ── Inline SVG line chart (module-level, dependency-free) ────────────────────
interface Series { label: string; color: string; values: (number | null)[]; fmt?: (v: number) => string }
interface ChartPoint { at: string }

function niceExtent(min: number, max: number, band?: readonly [number, number]): [number, number] {
  let lo = min, hi = max;
  if (band) { lo = Math.min(lo, band[0]); hi = Math.max(hi, band[1]); }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12;
  return [lo - pad, hi + pad];
}

function LineChart({ points, series, band, height = 160, yDigits = 0, area = false, idBase = "c" }: {
  points: ChartPoint[]; series: Series[]; band?: readonly [number, number]; height?: number; yDigits?: number; area?: boolean; idBase?: string;
}) {
  const W = 660, H = height, padL = 36, padR = 14, padT = 16, padB = 24;
  const all: number[] = [];
  series.forEach((se) => se.values.forEach((v) => { if (v != null) all.push(v); }));
  const [lo, hi] = niceExtent(all.length ? Math.min(...all) : 0, all.length ? Math.max(...all) : 1, band);
  const span = hi - lo || 1;
  const n = points.length;
  const x = (i: number) => padL + (i * (W - padL - padR)) / Math.max(1, n - 1);
  const y = (v: number) => H - padB - ((v - lo) / span) * (H - padT - padB);
  const y0 = H - padB;

  // Y-axis ticks (4 evenly spaced) double as gridlines.
  const yTicks = [0, 1, 2, 3].map((k) => lo + (span * k) / 3);
  // X-axis ticks — up to ~7 evenly spaced labels.
  const step = Math.max(1, Math.ceil(n / 7));
  const xTickIdx: number[] = [];
  for (let i = 0; i < n; i += step) xTickIdx.push(i);
  if (n > 0 && xTickIdx[xTickIdx.length - 1] !== n - 1) xTickIdx.push(n - 1);

  const linePath = (values: (number | null)[]) => {
    let d = "", started = false;
    values.forEach((v, i) => {
      if (v == null) { started = false; return; }
      d += `${started ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      started = true;
    });
    return d.trim();
  };
  const areaPath = (values: (number | null)[]) => {
    const pts = values.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v != null);
    if (pts.length < 2) return "";
    return `M ${x(pts[0].i).toFixed(1)},${y0.toFixed(1)} ` + pts.map((p) => `L ${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ") + ` L ${x(pts[pts.length - 1].i).toFixed(1)},${y0.toFixed(1)} Z`;
  };

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 320 }} preserveAspectRatio="none">
        <defs>
          {area && series.map((se, si) => (
            <linearGradient key={si} id={`${idBase}-${si}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={se.color} stopOpacity={0.24} />
              <stop offset="100%" stopColor={se.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {/* horizontal gridlines */}
        {yTicks.map((t, i) => (
          <line key={`g${i}`} x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--clinical-line)" strokeWidth={1} />
        ))}
        {/* normal-range band */}
        {band && (
          <>
            <rect x={padL} y={y(band[1])} width={W - padL - padR} height={Math.max(0, y(band[0]) - y(band[1]))} fill="#22c55e" opacity={0.07} />
            <line x1={padL} x2={W - padR} y1={y(band[0])} y2={y(band[0])} stroke="#f87171" strokeWidth={1} strokeDasharray="4 4" opacity={0.55} />
            <line x1={padL} x2={W - padR} y1={y(band[1])} y2={y(band[1])} stroke="#f87171" strokeWidth={1} strokeDasharray="4 4" opacity={0.55} />
          </>
        )}
        {/* area fills */}
        {area && series.map((se, si) => se.values.some((v) => v != null) ? <path key={`a${si}`} d={areaPath(se.values)} fill={`url(#${idBase}-${si})`} /> : null)}
        {/* y labels */}
        {yTicks.map((t, i) => (
          <text key={`y${i}`} x={padL - 5} y={y(t) + 3} fontSize={9} fill="var(--clinical-muted)" textAnchor="end">{fmtNum(t, yDigits)}</text>
        ))}
        {/* series lines + points */}
        {series.map((se) => (
          <g key={se.label}>
            <path d={linePath(se.values)} fill="none" stroke={se.color} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
            {se.values.map((v, i) => v == null ? null : (
              <circle key={i} cx={x(i)} cy={y(v)} r={2.4} fill="#fff" stroke={se.color} strokeWidth={1.5}>
                <title>{`${fmtDay(points[i].at)} · ${se.fmt ? se.fmt(v) : fmtNum(v, yDigits)}`}</title>
              </circle>
            ))}
          </g>
        ))}
        {/* x labels */}
        {xTickIdx.map((i) => (
          <text key={`x${i}`} x={x(i)} y={H - 6} fontSize={9} fill="var(--clinical-muted)" textAnchor="middle">{fmtDay(points[i].at)}</text>
        ))}
      </svg>
    </div>
  );
}

// ── Vital trend card (module-level) ──────────────────────────────────────────
interface CardSpec {
  key: string;
  title: string;
  icon: LucideIcon;
  tint: string;
  unit: string;
  digits: number;
  band?: readonly [number, number];
  normalCaption: string;
  color: string;
  get: (r: Reading) => number | null;
}

function trendDelta(values: (number | null)[]): number | null {
  const nn = values.filter((v): v is number => v != null);
  if (nn.length < 2) return null;
  const first = nn[0], last = nn[nn.length - 1];
  if (first === 0) return null;
  return ((last - first) / Math.abs(first)) * 100;
}

function DeltaChip({ delta }: { delta: number | null }) {
  if (delta == null) return null;
  const up = delta > 0, down = delta < 0;
  const color = up ? "var(--clinical-coral)" : down ? "var(--clinical-green)" : "var(--clinical-muted)";
  return <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ color, backgroundColor: "var(--clinical-surface-2)" }}>{up ? "▲" : down ? "▼" : "•"} {Math.abs(delta).toFixed(0)}%</span>;
}

function VitalCard({ spec, points }: { spec: CardSpec; points: { at: string; v: number | null }[] }) {
  const values = points.map((p) => p.v);
  const nn = values.filter((v): v is number => v != null);
  const hasData = nn.length >= 1;
  const latest = hasData ? nn[nn.length - 1] : null;
  const ok = spec.band ? inRange(latest, spec.band[0], spec.band[1]) : true;
  const delta = trendDelta(values);
  const Icon = spec.icon;
  return (
    <div className="rounded-xl border p-4 shadow-sm shadow-black/[0.03]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${spec.tint}`} style={{ backgroundColor: "var(--clinical-surface-2)" }}><Icon className="h-4 w-4" /></span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-[var(--clinical-ink)]">{spec.title}</h3>
            <p className="truncate text-[11px] text-[var(--clinical-muted)]">{spec.normalCaption}</p>
          </div>
        </div>
        <DeltaChip delta={delta} />
      </div>
      <div className="mt-2.5 flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tracking-tight" style={{ color: hasData ? (ok ? "var(--clinical-ink)" : "var(--clinical-coral)") : "var(--clinical-muted)" }}>{hasData ? fmtNum(latest, spec.digits) : "—"}</span>
        <span className="text-xs font-medium text-[var(--clinical-muted)]">{spec.unit}</span>
        {hasData && spec.band && <span className="ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: ok ? "var(--clinical-green)" : "var(--clinical-coral)" }}>{ok ? "Normal" : "Out of range"}</span>}
      </div>
      <div className="mt-1.5">
        {hasData ? (
          <LineChart points={points} series={[{ label: spec.title, color: spec.color, values }]} band={spec.band} height={150} yDigits={spec.digits} area idBase={`vc-${spec.key}`} />
        ) : (
          <div className="flex h-[150px] items-center justify-center text-sm text-[var(--clinical-muted)]">No data in range</div>
        )}
      </div>
    </div>
  );
}

// ── Blood Pressure card (two series) ─────────────────────────────────────────
function BloodPressureCard({ points }: { points: Reading[] }) {
  const sys = points.map((p) => p.systolic);
  const dia = points.map((p) => p.diastolic);
  const hasData = sys.some((v) => v != null) || dia.some((v) => v != null);
  const latest = [...points].reverse().find((p) => p.systolic != null || p.diastolic != null);
  const latestOk = latest ? inRange(latest.systolic, ...NORMAL.systolic) && inRange(latest.diastolic, ...NORMAL.diastolic) : false;
  // Band spans the full BP normal window (diastolic low → systolic high).
  const band: [number, number] = [NORMAL.diastolic[0], NORMAL.systolic[1]];
  return (
    <div className="rounded-xl border p-5 shadow-sm shadow-black/[0.03]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
      <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg text-rose-500" style={{ backgroundColor: "var(--clinical-surface-2)" }}><Activity className="h-5 w-5" /></span>
          <div>
            <h3 className="font-bold text-[var(--clinical-ink)]">Blood Pressure</h3>
            <p className="text-[11px] text-[var(--clinical-muted)]">Normal: Systolic 90–139 · Diastolic 60–89 mmHg</p>
          </div>
        </div>
        {hasData && (
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-bold tracking-tight" style={{ color: latestOk ? "var(--clinical-ink)" : "var(--clinical-coral)" }}>{fmtNum(latest?.systolic ?? null)}/{fmtNum(latest?.diastolic ?? null)}</span>
            <span className="text-xs font-medium text-[var(--clinical-muted)]">mmHg</span>
            <span className="ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: latestOk ? "var(--clinical-green)" : "var(--clinical-coral)" }}>{latestOk ? "Normal" : "Out of range"}</span>
          </div>
        )}
      </div>
      {hasData ? (<>
        <LineChart
          points={points}
          series={[
            { label: "Systolic", color: "#e11d48", values: sys },
            { label: "Diastolic", color: "#f59e0b", values: dia },
          ]}
          band={band}
          height={150}
        />
        <div className="mt-2 flex items-center justify-center gap-5">
          <span className="inline-flex items-center gap-1.5 text-xs text-[var(--clinical-ink-soft)]"><span className="h-2.5 w-2.5 rounded-full bg-rose-600" /> Systolic</span>
          <span className="inline-flex items-center gap-1.5 text-xs text-[var(--clinical-ink-soft)]"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Diastolic</span>
        </div>
      </>) : (
        <div className="flex h-[150px] items-center justify-center text-sm text-[var(--clinical-muted)]">No data in range</div>
      )}
    </div>
  );
}

// ── Other-domain mini trend (module-level) ───────────────────────────────────
function OtherTrendCard({ title, icon: Icon, tint, color, unit, points, digits, idBase, band, fmt, caption }: {
  title: string; icon: LucideIcon; tint: string; color: string; unit: string; points: { at: string; v: number | null }[]; digits: number; idBase: string; band?: readonly [number, number]; fmt?: (v: number) => string; caption?: string;
}) {
  const values = points.map((p) => p.v);
  const hasData = values.some((v) => v != null);
  const latest = [...values].reverse().find((v): v is number => v != null) ?? null;
  const delta = trendDelta(values);
  const ok = band && latest != null ? inRange(latest, band[0], band[1]) : true;
  const latestText = latest == null ? "—" : fmt ? fmt(latest) : fmtNum(latest, digits);
  return (
    <div className="rounded-xl border p-4 shadow-sm shadow-black/[0.03]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tint}`} style={{ backgroundColor: "var(--clinical-surface-2)" }}><Icon className="h-4 w-4" /></span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-[var(--clinical-ink)]">{title}</h3>
            {caption && <p className="truncate text-[11px] text-[var(--clinical-muted)]">{caption}</p>}
          </div>
        </div>
        <DeltaChip delta={delta} />
      </div>
      <div className="mt-2.5 flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tracking-tight" style={{ color: latest != null && band ? (ok ? "var(--clinical-ink)" : "var(--clinical-coral)") : "var(--clinical-ink)" }}>{latestText}</span>
        <span className="text-xs font-medium text-[var(--clinical-muted)]">{unit}</span>
        {latest != null && band && <span className="ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: ok ? "var(--clinical-green)" : "var(--clinical-coral)" }}>{ok ? "Normal" : "Out of range"}</span>}
      </div>
      <div className="mt-1.5">
        {hasData ? (
          <LineChart points={points} series={[{ label: title, color, values, fmt }]} band={band} height={150} yDigits={digits} area idBase={idBase} />
        ) : (
          <div className="flex h-[150px] items-center justify-center text-sm text-[var(--clinical-muted)]">No data in range</div>
        )}
      </div>
    </div>
  );
}

// ── Board ────────────────────────────────────────────────────────────────────
const WEIGHT_KEY = "weight_logs";

const parseWeightLogs = (raw: string | null | undefined): Row[] => {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
};

export default function VitalsTrendBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  void clinicianRole; // read-only board; role reserved for parity with sibling boards
  // Capture "now" once on mount — the fork's react-hooks/purity rule forbids
  // Date.now()/argless new Date() in the render body (incl. useMemo initializers),
  // and set-state-in-effect forbids a synchronous setState in the effect body, so
  // defer it to a timer callback (matches the tick pattern in sibling boards).
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => { const t = setTimeout(() => setNowMs(Date.now()), 0); return () => clearTimeout(t); }, []);

  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const roundQ = useLiveQuery<Row>("daily-rounds", { query: "take=2000", tables: ["DailyRound"] });
  const vitQ = useLiveQuery<Row>("vital-signs", { query: "take=2000", tables: ["VitalSigns"] });
  const painQ = useLiveQuery<Row>("pain-records", { query: "take=2000", tables: ["PainRecord"] });
  const sleepQ = useLiveQuery<Row>("round-sleep-records", { query: "take=2000", tables: ["SleepRecord"] });
  const bowelQ = useLiveQuery<Row>("bowel-records", { query: "take=2000", tables: ["BowelRecord"] });
  const urineQ = useLiveQuery<Row>("urine-records", { query: "take=2000", tables: ["UrineRecord"] });
  const edemaQ = useLiveQuery<Row>("edema-records", { query: "take=2000", tables: ["EdemaRecord"] });
  const concernQ = useLiveQuery<Row>("concern-records", { query: "take=2000", tables: ["ConcernRecord"] });
  const moodQ = useLiveQuery<Row>("mood-records", { query: "take=2000", tables: ["MoodRecord"] });
  const mobQ = useLiveQuery<Row>("mobility-records", { query: "take=2000", tables: ["MobilityRecord"] });
  const mealQ = useLiveQuery<Row>("meal-records", { query: "take=2000", tables: ["MealRecord"] });
  const { data: settingRows } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);

  const [residentId, setResidentId] = useState("");
  const [range, setRange] = useState<RangeDays>(14);

  // roundId → { residentId, caregiverName, roundDate } across ALL dates.
  const roundInfo = useMemo(() => {
    const m = new Map<string, { resId: string; by: string; date: string }>();
    (roundQ.data || []).forEach((r) => {
      m.set(s(r.id), { resId: s(r.residentId), by: s(r.caregiverName), date: s(r.roundDate) });
    });
    return m;
  }, [roundQ.data]);

  const weightLogs = useMemo(() => parseWeightLogs(settingRows.find((r) => (r.key || r.id) === WEIGHT_KEY)?.value), [settingRows]);

  const rangeStart = useMemo(() => nowMs - range * 86_400_000, [nowMs, range]);

  const selected = useMemo(() => residents.find((r: Row) => s(r.id) === residentId) || null, [residents, residentId]);

  // All normalized readings for the selected resident, in range, ascending by time.
  const readings = useMemo<Reading[]>(() => {
    if (!residentId) return [];
    const out: Reading[] = [];
    (vitQ.data || []).forEach((v) => {
      const info = roundInfo.get(s(v.dailyRoundId));
      if (!info || info.resId !== residentId) return;
      const at = s(v.time) || info.date;
      const t = new Date(at).getTime();
      if (!Number.isFinite(t) || t < rangeStart || t > nowMs) return;
      out.push({
        at,
        systolic: num(v.systolic),
        diastolic: num(v.diastolic),
        heartRate: num(v.heartRate),
        temperature: num(v.temperature),
        spo2: num(v.spo2),
        respRate: num(v.respRate),
        weight: num(v.weight),
        by: info.by || "—",
      });
    });
    // Merge weight-only readings from the weekly weight_logs app-setting.
    weightLogs.forEach((w) => {
      if (s(w.residentId) !== residentId) return;
      const wk = num(w.weightKg);
      if (wk == null) return;
      const at = s(w.date) || s(w.at);
      const t = new Date(at).getTime();
      if (!Number.isFinite(t) || t < rangeStart || t > nowMs) return;
      out.push({ at, systolic: null, diastolic: null, heartRate: null, temperature: null, spo2: null, respRate: null, weight: wk, by: s(w.by) || "—" });
    });
    return out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [residentId, vitQ.data, roundInfo, weightLogs, rangeStart, nowMs]);

  const abnormalCount = useMemo(() => readings.filter(isAbnormal).length, [readings]);

  // Domain numeric series (pain, sleep) joined the same way.
  const painPoints = useMemo(() => {
    if (!residentId) return [];
    const pts: { at: string; v: number | null }[] = [];
    (painQ.data || []).forEach((p) => {
      const info = roundInfo.get(s(p.dailyRoundId));
      if (!info || info.resId !== residentId) return;
      const v = num(p.score);
      if (v == null) return;
      const at = s(p.time) || info.date;
      const t = new Date(at).getTime();
      if (!Number.isFinite(t) || t < rangeStart || t > nowMs) return;
      pts.push({ at, v });
    });
    return pts.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [residentId, painQ.data, roundInfo, rangeStart, nowMs]);

  const sleepPoints = useMemo(() => {
    if (!residentId) return [];
    const pts: { at: string; v: number | null }[] = [];
    (sleepQ.data || []).forEach((sr) => {
      const info = roundInfo.get(s(sr.dailyRoundId));
      if (!info || info.resId !== residentId) return;
      const v = num(sr.totalHours);
      if (v == null) return;
      const at = s(sr.time) || info.date;
      const t = new Date(at).getTime();
      if (!Number.isFinite(t) || t < rangeStart || t > nowMs) return;
      pts.push({ at, v });
    });
    return pts.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [residentId, sleepQ.data, roundInfo, rangeStart, nowMs]);

  // The other DailyRounds domains, joined the same way (dailyRoundId → resident).
  // Categorical domains (edema/mood/concern) are mapped to an ordinal via the maps
  // above; their card formatter restores the real label.
  const domain = useMemo(() => {
    const mk = (rows: Row[] | undefined, getVal: (r: Row) => number | null) => {
      if (!residentId) return [] as { at: string; v: number | null }[];
      const pts: { at: string; v: number | null }[] = [];
      (rows || []).forEach((rec) => {
        const info = roundInfo.get(s(rec.dailyRoundId));
        if (!info || info.resId !== residentId) return;
        const v = getVal(rec);
        if (v == null) return;
        const at = s(rec.time) || info.date;
        const t = new Date(at).getTime();
        if (!Number.isFinite(t) || t < rangeStart || t > nowMs) return;
        pts.push({ at, v });
      });
      return pts.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    };
    return {
      urine: mk(urineQ.data, (r) => num(r.outputMl) ?? num(r.estimatedMl)),
      meal: mk(mealQ.data, (r) => parsePct(r.intakeLevel)),
      mobility: mk(mobQ.data, (r) => num(r.durationMinutes)),
      bowel: mk(bowelQ.data, (r) => num(r.bristolType)),
      edema: mk(edemaQ.data, (r) => EDEMA_ORD[s(r.severity)] ?? null),
      mood: mk(moodQ.data, (r) => MOOD_ORD[s(r.mood)] ?? null),
      concern: mk(concernQ.data, (r) => CONCERN_ORD[s(r.severity)] ?? null),
    };
  }, [residentId, roundInfo, rangeStart, nowMs, urineQ.data, mealQ.data, mobQ.data, bowelQ.data, edemaQ.data, moodQ.data, concernQ.data]);

  const startLabel = useMemo(() => new Date(rangeStart).toISOString().slice(0, 10), [rangeStart]);
  const endLabel = useMemo(() => new Date(nowMs).toISOString().slice(0, 10), [nowMs]);

  // Small-card specs.
  const smallCards: CardSpec[] = [
    { key: "heartRate", title: "Heart Rate", icon: Heart, tint: "text-pink-500", unit: "bpm", digits: 0, band: NORMAL.heartRate, normalCaption: "Normal: 60–100 bpm", color: "#ec4899", get: (r) => r.heartRate },
    { key: "temperature", title: "Temperature", icon: Thermometer, tint: "text-amber-500", unit: "°C", digits: 1, band: NORMAL.temperature, normalCaption: "Normal: 36.1–37.2 °C", color: "#f59e0b", get: (r) => r.temperature },
    { key: "spo2", title: "SpO₂", icon: Droplets, tint: "text-sky-500", unit: "%", digits: 0, band: NORMAL.spo2, normalCaption: "Normal: 95–100 %", color: "#0ea5e9", get: (r) => r.spo2 },
    { key: "respRate", title: "Resp. Rate", icon: Wind, tint: "text-indigo-500", unit: "/min", digits: 0, band: NORMAL.respRate, normalCaption: "Normal: 12–20 /min", color: "#6366f1", get: (r) => r.respRate },
    { key: "weight", title: "Weight", icon: Scale, tint: "text-slate-500", unit: "kg", digits: 1, band: undefined, normalCaption: "Trend vs. baseline", color: "#64748b", get: (r) => r.weight },
  ];

  const lvl = selected ? levelOf(selected) : null;

  const anyLoading = resQ.loading || roundQ.loading || vitQ.loading;
  const anyError = resQ.error || roundQ.error || vitQ.error;

  return (
    <ClinicalPage className="print:bg-white">
      <ClinicalHeader
        title="Vitals Trend"
        subtitle="Track vital sign trends over time per resident"
        right={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <select value={residentId} onChange={(e) => setResidentId(e.target.value)} aria-label="Select resident" className={`${controlClass} w-full sm:w-64`}>
              <option value="">Select resident…</option>
              {residents.map((r: Row) => <option key={s(r.id)} value={s(r.id)}>Rm {s(r.room)} — {s(r.name)}</option>)}
            </select>
            <div className="inline-flex overflow-hidden rounded-lg border" style={{ borderColor: "var(--clinical-line-strong)" }}>
              {RANGES.map((d) => (
                <button key={d} onClick={() => setRange(d)} className={`px-3 py-2 text-sm font-semibold ${range === d ? "bg-[var(--clinical-panel)] text-white" : "text-[var(--clinical-ink-soft)] hover:bg-[var(--clinical-surface-2)]"}`}>{d} days</button>
              ))}
            </div>
            {selected && (
              <ClinicalButton variant="secondary" onClick={() => window.print()}><FileDown className="h-4 w-4" /> Export PDF</ClinicalButton>
            )}
          </div>
        }
      />

      <div className="mt-5">
        {!selected && !anyLoading && !anyError && (
          <div className="@container">
            <div className="mb-4">
              <p className="text-base font-bold text-[var(--clinical-ink)]">Select a resident to view vitals trends</p>
              <p className="text-sm text-[var(--clinical-muted)]">Tap a resident to see their vital sign history</p>
            </div>
            {residents.length === 0 ? (
              <p className="text-sm text-[var(--clinical-muted)]">No residents found.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 @lg:grid-cols-3 @3xl:grid-cols-4 @5xl:grid-cols-5">
                {residents.map((r: Row, i: number) => (
                  <button key={s(r.id)} onClick={() => setResidentId(s(r.id))}
                    className="group flex flex-col items-center gap-2.5 rounded-xl border p-4 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md animate-in fade-in slide-in-from-bottom-2 duration-300"
                    style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)", animationDelay: `${i * 40}ms`, animationFillMode: "backwards" }}>
                    <span className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold" style={{ backgroundColor: "var(--clinical-surface-2)", color: "var(--clinical-panel)" }}>{initials(s(r.name))}</span>
                    <span className="block w-full min-w-0">
                      <span className="block truncate text-sm font-semibold text-[var(--clinical-ink)]">{s(r.name)}</span>
                      <span className="block text-xs text-[var(--clinical-muted)]">Room {s(r.room)}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <DataState loading={anyLoading} error={anyError} empty={false}>
          {selected && (
            <div className="space-y-5">
              {/* Summary card */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl leading-none" style={{ backgroundColor: "var(--clinical-surface-2)" }}><span className="text-[9px] font-semibold text-[var(--clinical-muted)]">Rm</span><span className="text-sm font-bold text-[var(--clinical-panel)]">{s(selected.room)}</span></div>
                  <div className="min-w-0">
                    <p className="truncate font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>{s(selected.name)}</p>
                    <p className="text-xs text-[var(--clinical-muted)]">Care Level {lvl?.n} · {startLabel} to {endLabel}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <StatCard value={readings.length} label="Readings" accent="ink" />
                  <StatCard value={abnormalCount} label="Abnormal" accent={abnormalCount > 0 ? "coral" : "ink"} />
                </div>
              </div>

              {/* 2-column analytics grid — 6 graphs paired: BP|HR, Temp|SpO₂, RR|Weight */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <BloodPressureCard points={readings} />
                {smallCards.map((spec) => (
                  <VitalCard key={spec.key} spec={spec} points={readings.map((r) => ({ at: r.at, v: spec.get(r) }))} />
                ))}
                <OtherTrendCard title="Pain Score" icon={Zap} tint="text-orange-500" color="#f97316" unit="/10" points={painPoints} digits={0} band={[0, 3]} caption="Normal: 0–3 /10" idBase="ot-pain" />
                <OtherTrendCard title="Sleep Hours" icon={Moon} tint="text-indigo-500" color="#6366f1" unit="h" points={sleepPoints} digits={1} band={[6, 8]} caption="Normal: 6–8 h/night" idBase="ot-sleep" />
                <OtherTrendCard title="Urine Output" icon={Droplets} tint="text-cyan-500" color="#06b6d4" unit="mL" points={domain.urine} digits={0} caption="Output per void" idBase="ot-urine" />
                <OtherTrendCard title="Meal Intake" icon={Utensils} tint="text-green-600" color="#16a34a" unit="%" points={domain.meal} digits={0} band={[50, 100]} caption="Normal: ≥ 50% intake" idBase="ot-meal" />
                <OtherTrendCard title="Mobility Duration" icon={Footprints} tint="text-teal-600" color="#0d9488" unit="min" points={domain.mobility} digits={0} caption="Active minutes per session" idBase="ot-mobility" />
                <OtherTrendCard title="Bowel (Bristol)" icon={CircleDot} tint="text-amber-600" color="#d97706" unit="" points={domain.bowel} digits={0} band={[3, 5]} fmt={fmtBristol} caption="Normal: Type 3–5" idBase="ot-bowel" />
                <OtherTrendCard title="Edema Severity" icon={Waves} tint="text-blue-500" color="#3b82f6" unit="" points={domain.edema} digits={0} band={[0, 1]} fmt={fmtEdema} caption="None → Deep (0–5)" idBase="ot-edema" />
                <OtherTrendCard title="Mood" icon={Smile} tint="text-purple-500" color="#a855f7" unit="" points={domain.mood} digits={0} fmt={fmtMood} caption="Wellbeing (worst → best)" idBase="ot-mood" />
                <OtherTrendCard title="Concerns" icon={AlertTriangle} tint="text-red-500" color="#ef4444" unit="" points={domain.concern} digits={0} band={[0, 1]} fmt={fmtConcern} caption="Severity: Low → Critical" idBase="ot-concern" />
              </div>

              {/* Raw readings table */}
              <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                <h2 className="mb-3 font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>Raw Readings</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[var(--clinical-muted)]" style={{ backgroundColor: "var(--clinical-surface-2)" }}>
                        <th className="rounded-l-lg px-3 py-2 font-semibold">Date</th>
                        <th className="px-3 py-2 font-semibold">BP (mmHg)</th>
                        <th className="px-3 py-2 font-semibold">HR (bpm)</th>
                        <th className="px-3 py-2 font-semibold">Temp (°C)</th>
                        <th className="px-3 py-2 font-semibold">SpO₂ (%)</th>
                        <th className="px-3 py-2 font-semibold">RR (/min)</th>
                        <th className="px-3 py-2 font-semibold">Wt (kg)</th>
                        <th className="rounded-r-lg px-3 py-2 font-semibold">Logged by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {readings.length === 0 ? (
                        <tr><td colSpan={8} className="px-3 py-8 text-center text-[var(--clinical-muted)]">No readings in range.</td></tr>
                      ) : (
                        [...readings].reverse().map((r, i) => {
                          const bp = r.systolic != null || r.diastolic != null ? `${fmtNum(r.systolic)}/${fmtNum(r.diastolic)}` : "—";
                          return (
                            <tr key={i} className="border-b last:border-0" style={{ borderColor: "var(--clinical-line)" }}>
                              <td className="px-3 py-2 font-medium text-[var(--clinical-ink)]">{fmtFullDate(r.at)}</td>
                              <td className="px-3 py-2 text-[var(--clinical-ink-soft)]">{bp}</td>
                              <td className="px-3 py-2 text-[var(--clinical-ink-soft)]">{fmtNum(r.heartRate)}</td>
                              <td className="px-3 py-2 text-[var(--clinical-ink-soft)]">{fmtNum(r.temperature, 1)}</td>
                              <td className="px-3 py-2 text-[var(--clinical-ink-soft)]">{fmtNum(r.spo2)}</td>
                              <td className="px-3 py-2 text-[var(--clinical-ink-soft)]">{fmtNum(r.respRate)}</td>
                              <td className="px-3 py-2 text-[var(--clinical-ink-soft)]">{r.weight != null ? fmtNum(r.weight, 1) : "—"}</td>
                              <td className="px-3 py-2 text-[var(--clinical-muted)]">{r.by}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </DataState>
      </div>
    </ClinicalPage>
  );
}
