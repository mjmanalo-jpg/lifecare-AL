"use client";

import { useMemo, useState, useEffect } from "react";
import {
  ClipboardList, Search, CheckCircle2, Clock, RefreshCw, Users, Pill,
  AlertTriangle, HeartPulse, Activity, ChevronRight, Stethoscope,
  FileText, type LucideIcon,
} from "lucide-react";
import Swal from "sweetalert2";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident, humanize } from "@/lib/adapters";
import { updateRecord } from "@/lib/api";

interface RoundPatient {
  id: string;
  name: string;
  room: string;
  careLevel: string;
  age: number | string;
  allergies: string;
  latestVitals: Record<string, { value: string; unit: string; recordedAt: string | null }>;
  activeMeds: number;
  openAlerts: number;
  roundCompleted: boolean;
  lastVisit: string | null;
  notes: string;
}

const CARD_VITALS = [
  { key: "HEART_RATE", label: "HR", color: "text-red-500" },
  { key: "BLOOD_PRESSURE", label: "BP", color: "text-blue-500" },
  { key: "TEMPERATURE", label: "Temp", color: "text-orange-500" },
  { key: "OXYGEN", label: "O₂", color: "text-green-500" },
];

const asStr = (v: unknown): string => (v == null ? "" : String(v));

function relTime(iso: string | null, nowTs: number): string {
  if (!iso || !nowTs) return "—";
  const m = Math.round((nowTs - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

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

export default function PhysicianRounds() {
  const { data: residentRows, loading, refetch } = useLiveQuery<Record<string, unknown>>(
    "residents", { query: "include=incidents,medications&take=300", tables: ["Resident", "Incident", "Medication"] }
  );
  const { data: vitalRows } = useLiveQuery<Record<string, unknown>>(
    "vitals", { query: "include=resident&take=500", tables: ["VitalsLog"] }
  );
  const { data: noteRows } = useLiveQuery<Record<string, unknown>>(
    "medical-notes", { query: "take=200", tables: ["MedicalNote"] }
  );
  const { data: staffRows } = useLiveQuery<Record<string, unknown>>(
    "staff", { query: "include=user", tables: ["Staff"] }
  );

  const physicianName = useMemo(() => {
    const physician = staffRows.find((s: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const pos = String(s.position || "").toUpperCase();
      return pos.includes("PHYSICIAN") || pos.includes("DOCTOR");
    });
    if (physician?.user) {
      const u = physician.user as Record<string, unknown>;
      return `${String(u.firstName || "")} ${String(u.lastName || "")}`.trim() || "Physician";
    }
    return "Physician";
  }, [staffRows]);

  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  const [search, setSearch] = useState("");
  const [filterPriority, setFilterPriority] = useState<"all" | "critical" | "attention" | "stable">("all");
  const [viewing, setViewing] = useState<RoundPatient | null>(null);
  const [roundNotes, setRoundNotes] = useState("");

  const vitalIndex = useMemo(() => {
    const byResident = new Map<string, Array<{ type: string; value: string; unit: string; recordedAt: string | null }>>();
    vitalRows.forEach((row) => {
      const rid = row.residentId ? String(row.residentId) : null;
      if (!rid) return;
      const v = { type: asStr(row.type), value: asStr(row.value), unit: asStr(row.unit), recordedAt: row.recordedAt ? String(row.recordedAt) : null };
      const arr = byResident.get(rid);
      if (arr) arr.push(v); else byResident.set(rid, [v]);
    });
    return byResident;
  }, [vitalRows]);

  const patients = useMemo<RoundPatient[]>(() => residentRows.map((row) => {
    const r = adaptResident(row);
    const raw = r.raw as Record<string, unknown>;
    const meds = (raw?.medications ?? []) as Array<Record<string, unknown>>;
    const activeMeds = meds.filter((m) => asStr(m.status) === "ACTIVE").length;
    const vitalsArr = vitalIndex.get(r.id) ?? [];
    const latestVitals: RoundPatient["latestVitals"] = {};
    vitalsArr.forEach((v) => {
      const cur = latestVitals[v.type];
      if (!cur || (v.recordedAt && (!cur.recordedAt || new Date(v.recordedAt).getTime() > new Date(cur.recordedAt).getTime()))) {
        latestVitals[v.type] = { value: v.value, unit: v.unit, recordedAt: v.recordedAt };
      }
    });
    const hasAbnormal = Object.entries(latestVitals).some(([k, v]) => isAbnormal(k, v.value));
    return {
      id: r.id, name: r.name, room: r.room, careLevel: r.careLevel, age: r.age ?? "—",
      allergies: r.allergies || "", latestVitals, activeMeds,
      openAlerts: hasAbnormal ? 1 : r.alertsCount, roundCompleted: false, lastVisit: null,
      notes: r.notes || "",
    };
  }), [residentRows, vitalIndex]);

  const sorted = useMemo(() => {
    return [...patients].sort((a, b) => b.openAlerts - a.openAlerts || a.room.localeCompare(b.room, undefined, { numeric: true }));
  }, [patients]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sorted.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q) && !p.room.toLowerCase().includes(q)) return false;
      if (filterPriority === "critical") return p.openAlerts > 0;
      if (filterPriority === "attention") return p.openAlerts > 0 || p.careLevel === "SKILLED" || p.careLevel === "MEMORY";
      if (filterPriority === "stable") return p.openAlerts === 0;
      return true;
    });
  }, [sorted, search, filterPriority]);

  const stats = useMemo(() => ({
    total: patients.length,
    critical: patients.filter((p) => p.openAlerts > 0).length,
    skilled: patients.filter((p) => p.careLevel === "SKILLED" || p.careLevel === "MEMORY").length,
    withMeds: patients.filter((p) => p.activeMeds > 0).length,
  }), [patients]);

  const handleCompleteRound = async (p: RoundPatient) => {
    const result = await Swal.fire({
      title: "Complete Round?",
      html: `<b>${p.name}</b> &middot; Room ${p.room}<br/>Mark this patient's round as completed?`,
      input: "textarea",
      inputLabel: "Round notes (optional)",
      inputPlaceholder: "Patient appears stable, continue current care plan...",
      showCancelButton: true,
      confirmButtonColor: "#10b981",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Complete Round",
    });
    if (!result.isConfirmed) return;
    try {
      if (result.value) {
        await updateRecord("medical-notes", `round-${p.id}-${Date.now()}`, {
          noteType: "ROUND_NOTE",
          title: `Round completed: ${p.name}`,
          content: `Dr. round completed.\n\n${result.value}`,
          authorName: physicianName,
          residentId: p.id,
        }).catch(() => {});
      }
      Swal.fire({ title: "Round Complete", text: `${p.name}'s round marked as done.`, icon: "success", timer: 1400, showConfirmButton: false });
      setViewing(null);
    } catch (err) {
      Swal.fire({ title: "Error", text: err instanceof Error ? err.message : "Could not complete round.", icon: "error" });
    }
  };

  const vitalVal = (p: RoundPatient, key: string) => {
    const v = p.latestVitals[key];
    return v ? `${v.value}${v.unit ? " " + v.unit : ""}` : "—";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent mb-1 flex items-center gap-2">
            <ClipboardList className="w-7 h-7 text-yellow-500 flex-shrink-0" /> Patient Rounds
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live</span>
            Daily rounding &mdash; prioritize patients by clinical acuity
          </p>
        </div>
        <button onClick={() => void refetch()} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Stat label="Total Patients" value={stats.total} icon={Users} tone="gray" />
        <Stat label="Need Attention" value={stats.critical} icon={AlertTriangle} tone="red" />
        <Stat label="Skilled / Memory" value={stats.skilled} icon={HeartPulse} tone="purple" />
        <Stat label="On Medications" value={stats.withMeds} icon={Activity} tone="blue" />
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
          <input type="text" placeholder="Search by name or room..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(["all", "critical", "attention", "stable"] as const).map((f) => (
            <button key={f} onClick={() => setFilterPriority(f)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${filterPriority === f ? "bg-yellow-400 text-black" : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"}`}>
              {f === "all" ? "All Patients" : f === "critical" ? "Needs Attention" : f === "attention" ? "Priority" : "Stable"}
            </button>
          ))}
          <span className="text-sm text-gray-500 ml-auto">{filtered.length} patients</span>
        </div>
      </div>

      {/* Patient Cards */}
      {loading && patients.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">Loading patient data...</div>
      ) : filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map((p) => (
            <div key={p.id} className={`bg-white rounded-lg border transition hover:shadow-md overflow-hidden ${p.openAlerts > 0 ? "border-red-200" : "border-gray-200"}`}>
              <div className={`px-4 py-3 flex items-center justify-between gap-4 ${p.openAlerts > 0 ? "bg-red-50" : "bg-gray-50"}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-500 flex items-center justify-center text-black font-bold flex-shrink-0">
                    {p.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-gray-900 truncate">{p.name}</h3>
                    <p className="text-sm text-gray-600">Room {p.room} &middot; {p.careLevel} &middot; Age {p.age}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {p.openAlerts > 0 && (
                    <span className="px-2 py-1 bg-red-500 text-white rounded-full text-xs font-bold animate-pulse">
                      {p.openAlerts} alert{p.openAlerts > 1 ? "s" : ""}
                    </span>
                  )}
                  {p.allergies && (
                    <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs font-semibold">Allergies</span>
                  )}
                </div>
              </div>
              <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {CARD_VITALS.map(({ key, label, color }) => {
                  const abnormal = isAbnormal(key, p.latestVitals[key]?.value ?? "");
                  return (
                    <div key={key} className={`p-2 rounded ${abnormal ? "bg-amber-50 border border-amber-200" : "bg-gray-50 border border-gray-100"}`}>
                      <p className="text-xs text-gray-500 font-semibold">{label}</p>
                      <p className={`font-bold text-sm ${abnormal ? "text-amber-700" : "text-gray-900"}`}>{vitalVal(p, key)}</p>
                    </div>
                  );
                })}
              </div>
              <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span className="flex items-center gap-1"><Pill className="w-3 h-3" /> {p.activeMeds} active meds</span>
                  {p.lastVisit && <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Last: {relTime(p.lastVisit, nowTs)}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => { setViewing(p); setRoundNotes(""); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-400 to-blue-500 text-white text-sm font-semibold rounded-lg hover:shadow transition active:scale-95">
                    <Stethoscope className="w-4 h-4" /> Round
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">No patients match your filters.</div>
      )}

      {/* Round Detail Modal */}
      {viewing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
            <div className={`sticky top-0 text-white p-5 sm:p-6 flex items-center justify-between z-10 ${viewing.openAlerts > 0 ? "bg-gradient-to-r from-red-500 to-red-600" : "bg-gradient-to-r from-blue-500 to-blue-600"}`}>
              <div>
                <h2 className="text-xl sm:text-2xl font-bold">{viewing.name}</h2>
                <p className="text-white/80 text-sm">Room {viewing.room} &middot; {viewing.careLevel} &middot; Age {viewing.age}</p>
              </div>
              <button onClick={() => setViewing(null)} className="p-2 hover:bg-white/20 rounded-lg transition"><ChevronRight className="w-6 h-6 rotate-45" /></button>
            </div>
            <div className="p-6 space-y-5">
              {viewing.allergies && (
                <div className="bg-red-50 border-l-4 border-red-400 p-3 rounded">
                  <p className="text-sm font-semibold text-red-700 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Allergies: {viewing.allergies}</p>
                </div>
              )}
              <div>
                <h3 className="font-bold text-gray-900 mb-3">Current Vital Signs</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {CARD_VITALS.map(({ key, label, color }) => {
                    const v = viewing.latestVitals[key];
                    const abnormal = isAbnormal(key, v?.value ?? "");
                    return (
                      <div key={key} className={`p-3 rounded border ${abnormal ? "bg-amber-50 border-amber-200" : "bg-gray-50 border-gray-200"}`}>
                        <p className="text-xs text-gray-600 font-semibold">{label}</p>
                        <p className={`text-lg font-bold mt-1 ${abnormal ? "text-amber-700" : "text-gray-900"}`}>{v ? v.value : "—"}</p>
                        <p className="text-xs text-gray-500">{v?.unit || ""} {v?.recordedAt ? `• ${relTime(v.recordedAt, nowTs)}` : ""}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Round Notes</label>
                <textarea value={roundNotes} onChange={(e) => setRoundNotes(e.target.value)} rows={4}
                  placeholder="Patient appears stable. Continue current care plan. No changes to medications..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none resize-y text-sm" />
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between gap-2">
              <button onClick={() => setViewing(null)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Cancel</button>
              <button onClick={() => void handleCompleteRound(viewing)}
                className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-green-400 to-green-500 text-white font-semibold rounded-lg hover:shadow-lg transition active:scale-95">
                <CheckCircle2 className="w-4 h-4" /> Complete Round
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const TONES: Record<string, { wrap: string; icon: string; value: string }> = {
  gray: { wrap: "bg-white border-gray-200", icon: "text-gray-500", value: "text-gray-900" },
  blue: { wrap: "bg-blue-50 border-blue-200", icon: "text-blue-500", value: "text-blue-600" },
  red: { wrap: "bg-red-50 border-red-200", icon: "text-red-500", value: "text-red-600" },
  purple: { wrap: "bg-purple-50 border-purple-200", icon: "text-purple-500", value: "text-purple-600" },
};

function Stat({ label, value, icon: Icon, tone }: { label: string; value: number; icon: LucideIcon; tone: keyof typeof TONES }) {
  const t = TONES[tone];
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
