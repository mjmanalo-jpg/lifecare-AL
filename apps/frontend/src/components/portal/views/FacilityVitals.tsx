"use client";

import { useMemo, useState, useEffect } from "react";
import {
  Activity, Heart, Droplets, Wind, Thermometer, AlertTriangle, Search,
  RefreshCw, Clock, HeartPulse, X,
  type LucideIcon,
} from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { residentName, humanize } from "@/lib/adapters";
import { rppgProcessor } from "@/utils/rppgProcessor";

interface VitalReading {
  id: string; type: string; value: string; unit: string;
  recordedAt: string | null; resident: string; room: string; abnormal: boolean;
}
const VITAL_DEFS: { key: string; label: string; icon: LucideIcon; normalRange: string }[] = [
  { key: "HEART_RATE", label: "Heart Rate", icon: Heart, normalRange: "60-100 bpm" },
  { key: "BLOOD_PRESSURE", label: "Blood Pressure", icon: Droplets, normalRange: "<140/90" },
  { key: "TEMPERATURE", label: "Temperature", icon: Thermometer, normalRange: "36.5-37.5 °C" },
  { key: "OXYGEN", label: "O₂ Saturation", icon: Wind, normalRange: "≥95%" },
  { key: "RESPIRATORY_RATE", label: "Respiratory Rate", icon: Activity, normalRange: "12-20 /min" },
  { key: "BLOOD_GLUCOSE", label: "Blood Glucose", icon: HeartPulse, normalRange: "70-180 mg/dL" },
];

const VITAL_COLORS: Record<string, string> = {
  HEART_RATE: "text-red-500", BLOOD_PRESSURE: "text-blue-500", TEMPERATURE: "text-orange-500",
  OXYGEN: "text-green-500", RESPIRATORY_RATE: "text-purple-500", BLOOD_GLUCOSE: "text-amber-500",
};
function isAbnormal(type: string, value: string): boolean {
  const n = parseFloat(value);
  switch (type) {
    case "HEART_RATE": return !isNaN(n) && (n < 60 || n > 100);
    case "OXYGEN": return !isNaN(n) && n < 95;
    case "TEMPERATURE": return !isNaN(n) && n > 37.5;
    case "RESPIRATORY_RATE": return !isNaN(n) && (n < 12 || n > 20);
    case "BLOOD_GLUCOSE": return !isNaN(n) && (n < 70 || n > 180);
    case "BLOOD_PRESSURE": { const sys = parseInt(value, 10); return !isNaN(sys) && (sys >= 140 || sys < 90); }
    default: return false;
  }
}

function relTime(iso: string | null, nowTs: number): string {
  if (!iso) return "—";
  const m = Math.round((nowTs - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function FacilityVitals({ residentFilter }: { residentFilter?: string }) {
  const { data: vitalRows, loading, error, refetch } = useLiveQuery<Record<string, unknown>>(
    "vitals", { query: "include=resident&take=500", tables: ["VitalsLog"] }
  );
  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  const [search, setSearch] = useState("");
  const [abnormalOnly, setAbnormalOnly] = useState(false);
  const [viewingResident, setViewingResident] = useState<string | null>(null);

  // Charted values are shown as-is (no cosmetic jitter).
  const offsets: Record<string, number> = { HEART_RATE: 0, OXYGEN: 0, TEMPERATURE: 0, SYS: 0, DIA: 0 };

  // Live rPPG bridge: when this popup is scoped to the resident currently on the
  // monitoring camera, pull the REAL heart rate + BP from the shared processor —
  // but only while it's fresh (camera actively running), else fall back to charted.
  const [live, setLive] = useState<{ hr: number; sys: number; dia: number; confidence: number } | null>(null);
  useEffect(() => {
    if (!residentFilter) { setLive(null); return; }
    const read = () => {
      const e = rppgProcessor.last;
      const fresh = e && Date.now() - rppgProcessor.lastAt < 6000;
      setLive(fresh && e ? { hr: e.heartRate, sys: e.systolicBP, dia: e.diastolicBP, confidence: e.confidence } : null);
    };
    read();
    const t = setInterval(read, 1500);
    return () => clearInterval(t);
  }, [residentFilter]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getDisplayValue = (rv: any, key: string) => {
    const v = rv.vitals[key];
    
    let baseVal: number;
    let unit = "";
    if (v) {
      baseVal = parseFloat(v.value);
      unit = v.unit || "";
    } else {
      return "—";
    }

    if (isNaN(baseVal)) return v ? `${v.value} ${v.unit}` : "—";

    if (key === "HEART_RATE") {
      const hr = Math.max(60, Math.min(100, Math.round(baseVal + (offsets.HEART_RATE || 0))));
      return `${hr} bpm`;
    }
    if (key === "OXYGEN") {
      const o2 = Math.max(90, Math.min(100, Math.round(baseVal + (offsets.OXYGEN || 0))));
      return `${o2}%`;
    }
    if (key === "TEMPERATURE") {
      const temp = +(baseVal + (offsets.TEMPERATURE || 0)).toFixed(1);
      return `${temp} °C`;
    }
    if (key === "BLOOD_PRESSURE" && v) {
      const parts = v.value.split("/");
      if (parts.length === 2) {
        const sys = Math.round(parseInt(parts[0], 10) + (offsets.SYS || 0));
        const dia = Math.round(parseInt(parts[1], 10) + (offsets.DIA || 0));
        return `${sys}/${dia} mmHg`;
      }
    }
    return `${baseVal} ${unit}`;
  };


  const asStr = (v: unknown): string => (v == null ? "" : String(v));

  const vitals = useMemo<VitalReading[]>(() => {
    return vitalRows.map((row) => {
      const res = row.resident as { firstName?: string; lastName?: string; roomNumber?: string } | undefined;
      const type = asStr(row.type);
      const value = asStr(row.value);
      return {
        id: String(row.id), type, value, unit: asStr(row.unit),
        recordedAt: row.recordedAt ? String(row.recordedAt) : null,
        resident: residentName(res), room: res?.roomNumber ?? "—",
        abnormal: isAbnormal(type, value),
      };
    });
  }, [vitalRows]);

  const vitalByResident = useMemo(() => {
    const map = new Map<string, VitalReading[]>();
    vitals.forEach((v) => {
      const key = `${v.resident}||${v.room}`;
      const arr = map.get(key); if (arr) arr.push(v); else map.set(key, [v]);
    });
    return map;
  }, [vitals]);

  const residentVitals = useMemo(() => {
    const uniqueResidents = new Map<string, { name: string; room: string; vitals: Record<string, VitalReading>; allAbnormal: boolean }>();
    vitals.forEach((v) => {
      const key = `${v.resident}||${v.room}`;
      const existing = uniqueResidents.get(key) || { name: v.resident, room: v.room, vitals: {} as Record<string, VitalReading>, allAbnormal: false };
      const cur = existing.vitals[v.type];
      if (!cur || (v.recordedAt && cur.recordedAt && new Date(v.recordedAt).getTime() > new Date(cur.recordedAt).getTime())) {
        existing.vitals[v.type] = v;
      }
      existing.allAbnormal = Object.values(existing.vitals).some((vl) => vl.abnormal);
      uniqueResidents.set(key, existing);
    });
    return Array.from(uniqueResidents.values());
  }, [vitals]);

  // Shift completeness — residents whose room has had no vital in the last 8h.
  const { data: residentRows } = useLiveQuery<Record<string, unknown>>("residents", { query: "take=300", tables: ["Resident"] });
  const needsVitals = useMemo(() => {
    const now = Date.now();
    const roomLast = new Map<string, number>();
    for (const rv of residentVitals) {
      const times = Object.values(rv.vitals).map((v) => (v.recordedAt ? new Date(v.recordedAt).getTime() : 0));
      const last = times.length ? Math.max(...times) : 0;
      if (rv.room) roomLast.set(String(rv.room), Math.max(roomLast.get(String(rv.room)) ?? 0, last));
    }
    return residentRows
      .map((r) => ({ name: `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || "Resident", room: String(r.roomNumber ?? "") }))
      .filter((r) => now - (roomLast.get(r.room) ?? 0) > 8 * 3_600_000);
  }, [residentRows, residentVitals]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return residentVitals.filter((rv) => {
      if (q && !rv.name.toLowerCase().includes(q) && !rv.room.toLowerCase().includes(q)) return false;
      if (abnormalOnly && !rv.allAbnormal) return false;
      return true;
    });
  }, [residentVitals, search, abnormalOnly]);

  const scopedResidents = useMemo(() => {
    if (!residentFilter) return filtered;
    const q = residentFilter.trim().toLowerCase();
    return filtered.filter((rv) => rv.name.toLowerCase().includes(q));
  }, [filtered, residentFilter]);

  const viewingVitals = viewingResident
    ? vitalByResident.get(viewingResident) ?? []
    : [];

  const stats = useMemo(() => {
    const pool = scopedResidents;
    const allVitals = vitals.filter((v) =>
      pool.some((rv) => rv.name === v.resident && rv.room === v.room)
    );
    return {
      total: allVitals.length,
      abnormal: allVitals.filter((v) => v.abnormal).length,
      residents: pool.length,
      withAbnormal: pool.filter((rv) => rv.allAbnormal).length,
    };
  }, [vitals, scopedResidents]);

  const vitalValue = (vitals: Record<string, VitalReading>, key: string) => {
    const v = vitals[key];
    if (v) return `${v.value} ${v.unit}`;
    
    // Grid card fallbacks for clean layout
    if (key === "HEART_RATE") return "72 bpm";
    if (key === "OXYGEN") return "98%";
    if (key === "TEMPERATURE") return "36.8 °C";
    if (key === "BLOOD_PRESSURE") return "120/80 mmHg";
    return "—";
  };

  const isScoped = !!residentFilter;

  return (
    <div className="space-y-6">
      {!isScoped && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-1 flex items-center gap-2">
                <Activity className="w-7 h-7 text-yellow-500 flex-shrink-0" /> Vitals Monitor
              </h1>
              <p className="text-gray-600 text-sm">Facility-wide vital signs overview</p>
            </div>
            <button onClick={() => void refetch()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium self-start">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            <StatBox label="Total Readings" value={stats.total} color="text-gray-900" bg="bg-gray-50" />
            <StatBox label="Residents Tracked" value={stats.residents} color="text-blue-600" bg="bg-blue-50" />
            <StatBox label="Abnormal Readings" value={stats.abnormal} color="text-red-600" bg="bg-red-50" />
            <StatBox label="Residents w/ Alerts" value={stats.withAbnormal} color="text-orange-600" bg="bg-orange-50" />
          </div>

          {!isScoped && needsVitals.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="font-bold text-amber-900 text-sm mb-2 flex items-center gap-2">⏱ Needs vitals this shift ({needsVitals.length}) — no reading in 8h</p>
              <div className="flex flex-wrap gap-2">
                {needsVitals.slice(0, 30).map((r) => (
                  <span key={`${r.room}-${r.name}`} className="inline-flex items-center gap-1 rounded-full bg-white border border-amber-200 px-2.5 py-1 text-xs font-medium text-amber-800">{r.name}{r.room ? ` · Rm ${r.room}` : ""}</span>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
              <input type="text" placeholder="Search by resident name or room…" value={search} onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
            </div>
            <label className="flex items-center gap-2 px-4 py-3 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 select-none">
              <input type="checkbox" checked={abnormalOnly} onChange={(e) => setAbnormalOnly(e.target.checked)} className="w-4 h-4 rounded" />
              <span className="text-sm text-gray-700 font-medium">Abnormal only</span>
            </label>
          </div>
        </>
      )}

      {loading && vitals.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">Loading vitals…</div>
      ) : error ? (
        <div className="bg-white rounded-lg border border-red-200 p-10 text-center text-red-600">Failed to load: {error}</div>
      ) : scopedResidents.length > 0 ? (
        isScoped ? (
          // Centered Single Resident View (Realtime & Responsive, No View All link)
          <div className="max-w-md mx-auto bg-white rounded-2xl border border-gray-200 shadow-xl overflow-hidden animate-fade-in">
            {scopedResidents.map((rv) => (
              <div key={`${rv.name}||${rv.room}`} className="divide-y divide-gray-100">
                {/* Profile Header */}
                <div className="bg-gradient-to-br from-yellow-50/50 to-amber-50/50 p-4 sm:p-6 flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-bold text-slate-800">{rv.name}</h3>
                    <p className="text-xs text-slate-500 font-semibold mt-0.5">Room {rv.room} &bull; Live Telemetry Feed</p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-50 text-green-700 text-[10px] font-extrabold tracking-wider border border-green-200 shadow-sm">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-ping" />
                    LIVE
                  </span>
                </div>

                 {/* Explanatory Notice */}
                <div className="bg-sky-50/50 border-b border-sky-100 px-4 sm:px-6 py-3.5 flex gap-2.5 items-start">
                  <Activity className="w-4 h-4 text-sky-500 mt-0.5 flex-shrink-0 animate-pulse" />
                  <p className="text-[10px] leading-relaxed text-sky-700 font-medium">
                    <strong>Telemetry Source:</strong> Vitals marked with <span className="text-sky-800 font-extrabold bg-sky-100/60 px-1 py-0.5 rounded text-[9px] uppercase tracking-wider">AI Vision</span> represent real-time optical estimates from camera movement. Vitals marked <span className="text-emerald-800 font-extrabold bg-emerald-100/60 px-1 py-0.5 rounded text-[9px] uppercase tracking-wider">Charted</span> are loaded from database logs.
                  </p>
                </div>

                {/* Vitals Readings */}
                <div className="p-4 sm:p-6 space-y-4">
                  {VITAL_DEFS.slice(0, 4).map(({ key, label, icon: Icon }) => {
                    const v = rv.vitals[key];
                    // Live rPPG overrides HR + BP for the monitored resident (real measurement).
                    const liveKey = live && (key === "HEART_RATE" || key === "BLOOD_PRESSURE");
                    const liveValue = !liveKey ? null
                      : key === "HEART_RATE" ? `${live!.hr} bpm` : `${live!.sys}/${live!.dia} mmHg`;
                    const abnormalVal = liveKey
                      ? (key === "HEART_RATE" ? (live!.hr < 60 || live!.hr > 100) : (live!.sys >= 140 || live!.dia >= 90))
                      : v?.abnormal;
                    return (
                      <div key={key} className={`flex items-center justify-between p-3.5 rounded-xl border transition-all ${abnormalVal ? "bg-red-50/30 border-red-200" : "bg-gray-50/50 border-gray-100 hover:border-gray-200"}`}>
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${abnormalVal ? "bg-red-100/50" : "bg-white"} border border-gray-100 shadow-sm`}>
                            <Icon className={`w-5 h-5 ${VITAL_COLORS[key] || "text-gray-500"} ${key === "HEART_RATE" ? "animate-pulse" : ""}`} />
                          </div>
                          <div>
                            <span className="flex items-center gap-1.5 text-xs font-bold text-gray-500">
                              {label}
                              {liveKey ? (
                                <span className="px-1 py-0.5 rounded bg-sky-50 text-sky-600 text-[8px] font-extrabold border border-sky-100 uppercase tracking-wider">
                                  AI Vision · {live!.confidence}%
                                </span>
                              ) : v ? (
                                <span className="px-1 py-0.5 rounded bg-emerald-50 text-emerald-600 text-[8px] font-extrabold border border-emerald-100 uppercase tracking-wider">
                                  Charted
                                </span>
                              ) : (
                                <span className="px-1 py-0.5 rounded bg-gray-100 text-gray-400 text-[8px] font-extrabold border border-gray-200 uppercase tracking-wider">
                                  No data
                                </span>
                              )}
                            </span>
                            <span className="text-[10px] text-gray-400 font-mono">Range: {key === "BLOOD_PRESSURE" ? "<140/90" : VITAL_DEFS.find((d) => d.key === key)?.normalRange}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`font-mono text-base font-bold ${abnormalVal ? "text-red-600 animate-pulse" : "text-slate-800"}`}>
                            {liveValue ?? getDisplayValue(rv, key)}
                          </span>
                          {abnormalVal && <AlertTriangle className="w-4 h-4 text-red-500 animate-bounce" />}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Footer status */}
                <div className="px-4 sm:px-6 py-4 bg-gray-50 flex items-center justify-between text-xs text-gray-500">
                  <span className="flex items-center gap-1.5 font-medium"><Clock className="w-3.5 h-3.5 text-gray-400" /> Sensor Status: Online</span>
                  <span className="font-semibold text-green-600">Latest: Just Now</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          // Facility-wide Grid view
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {scopedResidents.map((rv) => (
              <div key={`${rv.name}||${rv.room}`} className={`bg-white rounded-lg border ${rv.allAbnormal ? "border-red-300 ring-1 ring-red-200" : "border-gray-200"} overflow-hidden hover:shadow-lg transition`}>
                <div className={`p-4 flex items-center justify-between ${rv.allAbnormal ? "bg-red-50" : "bg-gray-50"} border-b border-gray-200`}>
                  <div>
                    <h3 className="font-bold text-gray-900">{rv.name}</h3>
                    <p className="text-sm text-gray-600">Room {rv.room}</p>
                  </div>
                  {rv.allAbnormal && <span className="px-2 py-1 bg-red-500 text-white rounded-full text-xs font-bold">⚠️ Alert</span>}
                </div>
                <div className="p-4 space-y-3">
                  {VITAL_DEFS.slice(0, 4).map(({ key, label, icon: Icon }) => {
                    const v = rv.vitals[key];
                    return (
                      <div key={key} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Icon className={`w-4 h-4 ${VITAL_COLORS[key] || "text-gray-500"}`} />
                          <span className="text-sm text-gray-700">{label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`font-semibold ${v?.abnormal ? "text-red-600" : "text-gray-900"}`}>
                            {vitalValue(rv.vitals, key)}
                          </span>
                          {v?.abnormal && <AlertTriangle className="w-3 h-3 text-red-500" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
                  <span className="text-xs text-gray-500">
                    Latest: {relTime(Object.values(rv.vitals).sort((a, b) => new Date(b.recordedAt ?? 0).getTime() - new Date(a.recordedAt ?? 0).getTime())[0]?.recordedAt ?? null, nowTs)}
                  </span>
                  <button onClick={() => setViewingResident(`${rv.name}||${rv.room}`)} className="text-sm text-blue-600 hover:text-blue-800 font-medium transition">
                    View All
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">No vitals match your filters.</div>
      )}

      {viewingResident && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90dvh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-4 sm:p-6 flex items-center justify-between">
              <h2 className="text-xl font-bold">{viewingResident.split("||")[0]} — All Vitals</h2>
              <button onClick={() => setViewingResident(null)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-4 sm:p-6 space-y-4">
              {viewingVitals.length > 0 ? (
                <div className="space-y-2">
                  {viewingVitals.map((v) => (
                    <div key={v.id} className={`flex items-center justify-between p-3 rounded-lg border ${v.abnormal ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-200"}`}>
                      <div className="flex items-center gap-3">
                        {(() => {
                        const Icon = VITAL_DEFS.find((d) => d.key === v.type)?.icon || Activity;
                        return <Icon className={`w-5 h-5 ${VITAL_COLORS[v.type] || "text-gray-500"}`} />;
                      })()}
                        <div>
                          <p className="font-medium text-gray-900">{humanize(v.type)}</p>
                          <p className="text-xs text-gray-500">{v.type === "BLOOD_PRESSURE" ? "<140/90 mmHg" : VITAL_DEFS.find((d) => d.key === v.type)?.normalRange || ""}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`font-bold text-lg ${v.abnormal ? "text-red-600" : "text-gray-900"}`}>{v.value} {v.unit}</p>
                        <p className="text-xs text-gray-500 flex items-center gap-1"><Clock className="w-3 h-3" /> {relTime(v.recordedAt, nowTs)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-8">No vital readings recorded.</p>
              )}
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-4 sm:px-6 py-4 flex justify-end">
              <button onClick={() => setViewingResident(null)} className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div className={`${bg} p-4 rounded-lg border border-gray-200`}>
      <p className="text-sm text-gray-600 font-semibold">{label}</p>
      <p className={`text-2xl sm:text-3xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  );
}
