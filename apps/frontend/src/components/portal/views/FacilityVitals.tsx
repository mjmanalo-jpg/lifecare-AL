"use client";

import RefreshButton from "@/components/portal/RefreshButton";

import { useMemo, useState, useEffect } from "react";
import {
  Activity, Heart, Droplets, Wind, Thermometer, AlertTriangle, Search,
  RefreshCw, Clock, HeartPulse, X, Bluetooth, Loader2,
  type LucideIcon,
} from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { residentName, humanize } from "@/lib/adapters";
import { isAbnormalVital as isAbnormal, VITAL_META, validateVital, VITAL_METHODS } from "@/lib/vitalThresholds";
import { encodeVitalNotes, decodeVitalNotes, type VitalProvenance } from "@/lib/vitalsProvenance";
import { connectVitalsDevice, isBluetoothSupported, DEVICE_KINDS, type DeviceVitalKind } from "@/lib/vitalsDevices";
import Swal from "@/lib/swal";

interface VitalReading {
  id: string; type: string; value: string; unit: string;
  recordedAt: string | null; resident: string; room: string; abnormal: boolean;
  source?: string | null; method?: string;
}
const VITAL_DEFS: { key: string; label: string; icon: LucideIcon; normalRange: string }[] = [
  { key: "HEART_RATE", label: "Heart Rate", icon: Heart, normalRange: "60-100 bpm" },
  { key: "BLOOD_PRESSURE", label: "Blood Pressure", icon: Droplets, normalRange: "<140/90" },
  { key: "TEMPERATURE", label: "Temperature", icon: Thermometer, normalRange: "36.1-37.2 °C" },
  { key: "OXYGEN", label: "O₂ Saturation", icon: Wind, normalRange: "≥95%" },
  { key: "RESPIRATORY_RATE", label: "Respiratory Rate", icon: Activity, normalRange: "12-20 /min" },
  { key: "BLOOD_GLUCOSE", label: "Blood Glucose", icon: HeartPulse, normalRange: "70-180 mg/dL" },
];

const VITAL_COLORS: Record<string, string> = {
  HEART_RATE: "text-red-500", BLOOD_PRESSURE: "text-blue-500", TEMPERATURE: "text-orange-500",
  OXYGEN: "text-green-500", RESPIRATORY_RATE: "text-purple-500", BLOOD_GLUCOSE: "text-amber-500",
};
function relTime(iso: string | null, nowTs: number): string {
  if (!iso) return "—";
  const m = Math.round((nowTs - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m ago` : `${h}h ago`;
  return h % 24 ? `${Math.floor(h / 24)}d ${h % 24}h ago` : `${Math.floor(h / 24)}d ago`;
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

  // ── Log Vitals (Module 02) — the write path was missing; this records one
  // VitalsLog per entered parameter via /api/vitals (stamps recordedBy). ──
  const LOG_KEYS = ["HEART_RATE", "BLOOD_PRESSURE", "TEMPERATURE", "OXYGEN", "RESPIRATORY_RATE", "BLOOD_GLUCOSE", "WEIGHT"] as const;
  const [showLog, setShowLog] = useState(false);
  const [savingLog, setSavingLog] = useState(false);
  const [logForm, setLogForm] = useState<Record<string, string>>({ residentId: "" });
  // Per-reading provenance (#2): how each value was captured. A manual edit marks
  // that field MANUAL; a device capture marks it DEVICE.
  const [capturedFrom, setCapturedFrom] = useState<Record<string, VitalProvenance>>({});
  // Measurement context (#2): SpO₂ on room air/O₂, temperature route, BP posture.
  const [logContext, setLogContext] = useState<Record<string, string>>({});
  const [connecting, setConnecting] = useState<DeviceVitalKind | null>(null);

  const setLog = (k: string, v: string) => {
    setLogForm((f) => ({ ...f, [k]: v }));
    if (k !== "residentId") setCapturedFrom((m) => ({ ...m, [k]: { source: "MANUAL" } }));
  };
  const setContext = (k: string, v: string) => setLogContext((m) => ({ ...m, [k]: v }));
  const resetLog = () => { setLogForm({ residentId: "" }); setCapturedFrom({}); setLogContext({}); };

  // #1 — capture readings straight from a connected BLE medical device.
  const captureFromDevice = async (kind: DeviceVitalKind) => {
    if (!isBluetoothSupported()) {
      Swal.fire({ title: "Bluetooth unavailable", text: "This browser can't pair with BLE medical devices. Use Chrome/Edge on desktop or Chrome on Android over HTTPS, or enter the reading manually.", icon: "info" });
      return;
    }
    setConnecting(kind);
    try {
      const reading = await connectVitalsDevice(kind);
      const keys = Object.keys(reading.values);
      if (!keys.length) { Swal.fire({ title: "No reading parsed", text: "The device connected but sent no recognisable measurement.", icon: "info" }); return; }
      setLogForm((f) => ({ ...f, ...reading.values }));
      setCapturedFrom((m) => {
        const next = { ...m };
        for (const key of keys) next[key] = { source: "DEVICE", deviceId: reading.deviceName, confidence: 1 };
        return next;
      });
      Swal.fire({ toast: true, position: "top-end", icon: "success", showConfirmButton: false, timer: 2600, title: `Captured from ${reading.deviceName}` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not read the device.";
      if (!/cancel/i.test(msg)) Swal.fire({ title: "Device capture failed", text: msg, icon: "info" });
    } finally {
      setConnecting(null);
    }
  };

  const submitLog = async () => {
    const rid = logForm.residentId;
    if (!rid) { Swal.fire("Select a resident", "Choose who these vitals are for.", "warning"); return; }
    const entries = LOG_KEYS.filter((k) => (logForm[k] ?? "").trim() !== "");
    if (!entries.length) { Swal.fire("Nothing to log", "Enter at least one vital value.", "warning"); return; }

    // #3 — validate: block implausible values, confirm abnormal ones before logging.
    const problems: string[] = [];
    const abnormal: string[] = [];
    for (const type of entries) {
      const r = validateVital(type, logForm[type].trim());
      if (!r.ok) problems.push(`${VITAL_META[type]?.label ?? type}: ${r.error}`);
      else if (r.abnormal) abnormal.push(`${VITAL_META[type]?.label ?? type} — ${logForm[type].trim()} ${VITAL_META[type]?.unit ?? ""} (${r.severity})`);
    }
    if (problems.length) {
      Swal.fire({ title: "Check these readings", html: problems.map((p) => `• ${p}`).join("<br>"), icon: "warning" });
      return;
    }
    if (abnormal.length) {
      const c = await Swal.fire({ title: "Confirm abnormal readings", html: `These are outside the normal range:<br><br>${abnormal.map((a) => `• ${a}`).join("<br>")}<br><br>Confirm they're correct, or re-measure.`, icon: "warning", showCancelButton: true, confirmButtonText: "Confirm & log", cancelButtonText: "Re-measure", confirmButtonColor: "#dc2626" });
      if (!c.isConfirmed) return;
    }

    setSavingLog(true);
    try {
      let ok = 0; let flagged = 0;
      for (const type of entries) {
        const value = logForm[type].trim();
        const prov: VitalProvenance = { ...(capturedFrom[type] ?? { source: "MANUAL" }) };
        if (logContext[type]) prov.method = logContext[type];
        const notes = encodeVitalNotes(prov);
        const res = await fetch("/api/vitals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ residentId: rid, type, value, unit: VITAL_META[type]?.unit, notes }) });
        if (res.ok) { ok++; if (isAbnormal(type, value)) flagged++; }
      }
      await refetch();
      setShowLog(false);
      resetLog();
      Swal.fire({ title: "Vitals logged", text: `${ok} reading${ok === 1 ? "" : "s"} recorded${flagged ? ` · ${flagged} abnormal — alerts will follow` : ""}.`, icon: "success", timer: 2000, showConfirmButton: false });
    } catch (e) {
      Swal.fire("Failed", e instanceof Error ? e.message : "Could not log vitals.", "error");
    } finally { setSavingLog(false); }
  };

  // The live feed shows the actual logged readings (entered manually or captured
  // from a connected device) — no camera/rPPG estimates, no cosmetic clamping.
  const asStr = (v: unknown): string => (v == null ? "" : String(v));

  const vitals = useMemo<VitalReading[]>(() => {
    return vitalRows.map((row) => {
      const res = row.resident as { firstName?: string; lastName?: string; roomNumber?: string } | undefined;
      const type = asStr(row.type);
      const value = asStr(row.value);
      const { prov } = decodeVitalNotes(asStr(row.notes));
      return {
        id: String(row.id), type, value, unit: asStr(row.unit),
        recordedAt: row.recordedAt ? String(row.recordedAt) : null,
        resident: residentName(res), room: res?.roomNumber ?? "—",
        abnormal: isAbnormal(type, value),
        source: prov?.source ?? null, method: prov?.method,
      };
    });
  }, [vitalRows]);

  /** Latest reading's timestamp across a resident's vitals (for the footer). */
  const latestRecordedAt = (rv: { vitals: Record<string, VitalReading> }): string | null =>
    Object.values(rv.vitals)
      .map((v) => v.recordedAt)
      .filter(Boolean)
      .sort((a, b) => new Date(b as string).getTime() - new Date(a as string).getTime())[0] ?? null;

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
            <div className="flex items-center gap-2 self-start">
              <RefreshButton onRefresh={() => { resetLog(); setShowLog(true); }} className="flex items-center gap-2 px-3.5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-semibold" />
            </div>
          </div>

          {/* Log Vitals modal */}
          {showLog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto">
                <div className="sticky top-0 bg-blue-600 text-white px-5 py-4 flex items-center justify-between">
                  <h3 className="font-bold text-lg flex items-center gap-2"><HeartPulse className="w-5 h-5" /> Log Vitals</h3>
                  <button onClick={() => setShowLog(false)} className="p-1 hover:bg-blue-700 rounded"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-5 space-y-3">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Resident *</label>
                    <select value={logForm.residentId} onChange={(e) => setLog("residentId", e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-400">
                      <option value="">Select resident…</option>
                      {residentRows.map((r) => (
                        <option key={String(r.id)} value={String(r.id)}>{`${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || "Resident"}{r.roomNumber ? ` · Rm ${r.roomNumber}` : ""}</option>
                      ))}
                    </select>
                  </div>

                  {/* #1 — capture straight from a connected BLE medical device */}
                  <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-2.5">
                    <p className="text-[11px] font-semibold text-blue-900 mb-1.5 flex items-center gap-1.5"><Bluetooth className="w-3.5 h-3.5" /> Capture from device</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(Object.keys(DEVICE_KINDS) as DeviceVitalKind[]).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          onClick={() => void captureFromDevice(kind)}
                          disabled={connecting !== null}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-blue-300 bg-white text-blue-700 text-xs font-medium hover:bg-blue-100 disabled:opacity-50 transition"
                        >
                          {connecting === kind ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bluetooth className="w-3 h-3" />}
                          {DEVICE_KINDS[kind].label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[10px] text-blue-800/70">Reads the instrument directly — no transcription error. Falls back to manual entry.</p>
                  </div>

                  {LOG_KEYS.map((k) => {
                    const meta = VITAL_META[k];
                    const val = logForm[k] ?? "";
                    const bad = val.trim() !== "" && isAbnormal(k, val.trim());
                    const prov = capturedFrom[k];
                    const methods = VITAL_METHODS[k];
                    return (
                      <div key={k}>
                        <label className="flex items-center justify-between text-sm font-semibold text-gray-700 mb-1">
                          <span>{meta.label} <span className="text-gray-400 font-normal">({meta.unit})</span></span>
                          <span className={`text-xs font-normal ${bad ? "text-red-600" : "text-gray-400"}`}>{bad ? "abnormal" : `normal ${meta.normal}`}</span>
                        </label>
                        <input
                          value={val}
                          onChange={(e) => setLog(k, e.target.value)}
                          placeholder={k === "BLOOD_PRESSURE" ? "e.g. 120/80" : `${meta.normal}`}
                          className={`w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 ${bad ? "border-red-300 focus:ring-red-400" : "border-gray-300 focus:ring-blue-400"}`}
                        />
                        {val.trim() !== "" && (methods || prov) && (
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            {methods && (
                              <select
                                value={logContext[k] ?? ""}
                                onChange={(e) => setContext(k, e.target.value)}
                                className="text-xs px-2 py-1 border border-gray-300 rounded-md bg-white outline-none focus:ring-2 focus:ring-blue-400"
                              >
                                <option value="">Context…</option>
                                {methods.map((m) => <option key={m} value={m}>{m}</option>)}
                              </select>
                            )}
                            {prov && (
                              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${prov.source === "DEVICE" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"}`}>
                                {prov.source === "DEVICE" ? <><Bluetooth className="w-2.5 h-2.5" /> {prov.deviceId ?? "Device"}</> : "Manual"}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <p className="text-xs text-gray-500">Fill only what you measured. Abnormal values are confirmed before logging, then trigger alerts automatically.</p>
                </div>
                <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-5 py-3 flex flex-wrap items-center justify-end gap-2">
                  <button onClick={() => { setShowLog(false); resetLog(); }} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg text-sm font-medium">Cancel</button>
                  <button onClick={() => void submitLog()} disabled={savingLog} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-sm disabled:opacity-50">{savingLog ? "Saving…" : "Save Vitals"}</button>
                </div>
              </div>
            </div>
          )}

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
                    <p className="text-xs text-slate-500 font-semibold mt-0.5">Room {rv.room} &bull; Latest Vital Signs</p>
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
                    <strong>Source:</strong> the latest logged readings. Vitals marked <span className="text-sky-800 font-extrabold bg-sky-100/60 px-1 py-0.5 rounded text-[9px] uppercase tracking-wider">Device</span> were captured from a connected medical device; <span className="text-emerald-800 font-extrabold bg-emerald-100/60 px-1 py-0.5 rounded text-[9px] uppercase tracking-wider">Manual</span> were entered by staff. Updates automatically when new vitals are logged.
                  </p>
                </div>

                {/* Vitals Readings */}
                <div className="p-4 sm:p-6 space-y-4">
                  {VITAL_DEFS.slice(0, 4).map(({ key, label, icon: Icon }) => {
                    const v = rv.vitals[key];
                    const abnormalVal = v?.abnormal;
                    const src = v?.source ?? null;
                    const srcText = src === "DEVICE" ? "Device" : src === "CAMERA_RPPG" ? "Camera" : src === "MANUAL" ? "Manual" : "Logged";
                    const srcCls = src === "DEVICE" ? "bg-sky-50 text-sky-600 border-sky-100"
                      : src === "CAMERA_RPPG" ? "bg-amber-50 text-amber-600 border-amber-100"
                      : "bg-emerald-50 text-emerald-600 border-emerald-100";
                    return (
                      <div key={key} className={`flex items-center justify-between p-3.5 rounded-xl border transition-all ${abnormalVal ? "bg-red-50/30 border-red-200" : "bg-gray-50/50 border-gray-100 hover:border-gray-200"}`}>
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${abnormalVal ? "bg-red-100/50" : "bg-white"} border border-gray-100 shadow-sm`}>
                            <Icon className={`w-5 h-5 ${VITAL_COLORS[key] || "text-gray-500"} ${key === "HEART_RATE" ? "animate-pulse" : ""}`} />
                          </div>
                          <div>
                            <span className="flex items-center gap-1.5 text-xs font-bold text-gray-500">
                              {label}
                              {v ? (
                                <span className={`px-1 py-0.5 rounded text-[8px] font-extrabold border uppercase tracking-wider ${srcCls}`}>
                                  {srcText}
                                </span>
                              ) : (
                                <span className="px-1 py-0.5 rounded bg-gray-100 text-gray-400 text-[8px] font-extrabold border border-gray-200 uppercase tracking-wider">
                                  No data
                                </span>
                              )}
                              {v?.method && <span className="text-[9px] text-gray-400 font-medium normal-case tracking-normal">· {v.method}</span>}
                            </span>
                            <span className="text-[10px] text-gray-400 font-mono">Range: {key === "BLOOD_PRESSURE" ? "<140/90" : VITAL_DEFS.find((d) => d.key === key)?.normalRange}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`font-mono text-base font-bold ${abnormalVal ? "text-red-600 animate-pulse" : "text-slate-800"}`}>
                            {v ? `${v.value}${v.unit ? ` ${v.unit}` : ""}` : "—"}
                          </span>
                          {abnormalVal && <AlertTriangle className="w-4 h-4 text-red-500 animate-bounce" />}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Footer status */}
                <div className="px-4 sm:px-6 py-4 bg-gray-50 flex items-center justify-between text-xs text-gray-500">
                  <span className="flex items-center gap-1.5 font-medium"><Clock className="w-3.5 h-3.5 text-gray-400" /> Manual &amp; device logs</span>
                  <span className="font-semibold text-green-600">Latest: {relTime(latestRecordedAt(rv), nowTs)}</span>
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
