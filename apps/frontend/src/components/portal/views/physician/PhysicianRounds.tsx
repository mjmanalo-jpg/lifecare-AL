"use client";

import { useMemo, useState, useEffect } from "react";
import {
  ClipboardList, Search, CheckCircle2, Clock, RefreshCw, Users, Pill,
  AlertTriangle, HeartPulse, Activity, ChevronRight, Stethoscope,
  FileText, X, ChevronLeft, Camera, type LucideIcon,
} from "lucide-react";
import Swal from "sweetalert2";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { updateRecord } from "@/lib/api";
import { useClinician, type ClinicianRole } from "@/components/portal/views/clinical/useClinician";

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
  monitoringCount: number;
  hasFallAlert: boolean;
}

const CARD_VITALS = [
  { key: "HEART_RATE", label: "HR", color: "text-red-500" },
  { key: "BLOOD_PRESSURE", label: "BP", color: "text-blue-500" },
  { key: "TEMPERATURE", label: "Temp", color: "text-orange-500" },
  { key: "OXYGEN", label: "O\u2082", color: "text-green-500" },
  { key: "RESPIRATORY_RATE", label: "RR", color: "text-purple-500" },
  { key: "BLOOD_GLUCOSE", label: "Glucose", color: "text-pink-500" },
];

const CARE_LEVEL_BADGES: Record<string, string> = {
  SKILLED: "bg-red-100 text-red-700 border-red-300",
  MEMORY: "bg-purple-100 text-purple-700 border-purple-300",
  ASSISTED: "bg-blue-100 text-blue-700 border-blue-300",
  INDEPENDENT: "bg-green-100 text-green-700 border-green-300",
};

const asStr = (v: unknown): string => (v == null ? "" : String(v));

function relTime(iso: string | null, nowTs: number): string {
  if (!iso || !nowTs) return "\u2014";
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

export default function PhysicianRounds({ clinicianRole = "PHYSICIAN" }: { clinicianRole?: ClinicianRole }) {
  const { data: residentRows, loading, refetch } = useLiveQuery<Record<string, unknown>>(
    "residents", { query: "include=incidents,medications&take=300", tables: ["Resident", "Incident", "Medication"] }
  );
  const { data: vitalRows } = useLiveQuery<Record<string, unknown>>(
    "vitals", { query: "include=resident&take=500", tables: ["VitalsLog"] }
  );
  const { data: noteRows } = useLiveQuery<Record<string, unknown>>(
    "medical-notes", { query: "take=200", tables: ["MedicalNote"] }
  );
  const { data: monitoringRows } = useLiveQuery<Record<string, unknown>>(
    "camera-monitoring-logs", { query: "take=200", tables: ["CameraMonitoringLog"] }
  );
  const { name: clinicianName } = useClinician(clinicianRole);

  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  const [search, setSearch] = useState("");
  const [filterPriority, setFilterPriority] = useState<"all" | "critical" | "attention" | "stable">("all");
  const [filterCareLevel, setFilterCareLevel] = useState<string>("all");
  const [viewing, setViewing] = useState<RoundPatient | null>(null);
  const [roundNotes, setRoundNotes] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  useEffect(() => { setPage(1); }, [search, filterPriority, filterCareLevel, perPage]);

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

  const medIndex = useMemo(() => {
    const byResident = new Map<string, Array<Record<string, unknown>>>();
    residentRows.forEach((row) => {
      const rid = String(row.id);
      const meds = (row.medications ?? []) as Array<Record<string, unknown>>;
      byResident.set(rid, meds);
    });
    return byResident;
  }, [residentRows]);

  const noteIndex = useMemo(() => {
    const byResident = new Map<string, Array<Record<string, unknown>>>();
    noteRows.forEach((row) => {
      const rid = row.residentId ? String(row.residentId) : null;
      if (!rid) return;
      const arr = byResident.get(rid) || [];
      arr.push(row);
      byResident.set(rid, arr);
    });
    return byResident;
  }, [noteRows]);

  const monitoringIndex = useMemo(() => {
    const byResident = new Map<string, Array<Record<string, unknown>>>();
    monitoringRows.forEach((row) => {
      const rid = row.residentId ? String(row.residentId) : null;
      if (!rid) return;
      const arr = byResident.get(rid) || [];
      arr.push(row);
      byResident.set(rid, arr);
    });
    return byResident;
  }, [monitoringRows]);

  const patients = useMemo<RoundPatient[]>(() => residentRows.map((row) => {
    const r = adaptResident(row);
    const raw = r.raw as Record<string, unknown>;
    const meds = medIndex.get(r.id) ?? [];
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
    const notesArr = noteIndex.get(r.id) ?? [];
    const lastNote = notesArr.length > 0
      ? notesArr.sort((a, b) => new Date(String(b.createdAt ?? 0)).getTime() - new Date(String(a.createdAt ?? 0)).getTime())[0]
      : null;
    return {
      id: r.id, name: r.name, room: r.room, careLevel: r.careLevel, age: r.age ?? "\u2014",
      allergies: r.allergies || "", latestVitals, activeMeds,
      openAlerts: hasAbnormal ? 1 : r.alertsCount, roundCompleted: false,
      lastVisit: lastNote?.createdAt ? String(lastNote.createdAt) : null,
      notes: r.notes || "",
      monitoringCount: (monitoringIndex.get(r.id) ?? []).length,
      hasFallAlert: (monitoringIndex.get(r.id) ?? []).some((l) => asStr(l.logType) === "FALL_DETECTION"),
    };
  }), [residentRows, vitalIndex, medIndex, noteIndex, monitoringIndex]);

  const sorted = useMemo(() => {
    return [...patients].sort((a, b) => b.openAlerts - a.openAlerts || a.room.localeCompare(b.room, undefined, { numeric: true }));
  }, [patients]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sorted.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q) && !p.room.toLowerCase().includes(q) && !p.careLevel.toLowerCase().includes(q)) return false;
      if (filterPriority === "critical") return p.openAlerts > 0;
      if (filterPriority === "attention") return p.openAlerts > 0 || p.careLevel === "SKILLED" || p.careLevel === "MEMORY";
      if (filterPriority === "stable") return p.openAlerts === 0;
      if (filterCareLevel !== "all" && p.careLevel !== filterCareLevel) return false;
      return true;
    });
  }, [sorted, search, filterPriority, filterCareLevel]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const start = (page - 1) * perPage;
  const paginated = filtered.slice(start, start + perPage);

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
          content: `Round completed.\n\n${result.value}`,
          authorName: clinicianName,
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
    return v ? `${v.value}${v.unit ? " " + v.unit : ""}` : "\u2014";
  };

  const viewingNotes = useMemo(() => {
    if (!viewing) return [];
    return (noteIndex.get(viewing.id) ?? [])
      .sort((a, b) => new Date(String(b.createdAt ?? 0)).getTime() - new Date(String(a.createdAt ?? 0)).getTime())
      .slice(0, 10);
  }, [viewing, noteIndex]);

  const viewingMeds = useMemo(() => {
    if (!viewing) return [];
    return (medIndex.get(viewing.id) ?? []).filter((m) => asStr(m.status) === "ACTIVE");
  }, [viewing, medIndex]);

  const viewingMonitoringLogs = useMemo(() => {
    if (!viewing) return [];
    return (monitoringIndex.get(viewing.id) ?? [])
      .sort((a, b) => new Date(String(b.createdAt ?? 0)).getTime() - new Date(String(a.createdAt ?? 0)).getTime())
      .slice(0, 10);
  }, [viewing, monitoringIndex]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-1 flex items-center gap-2">
            <ClipboardList className="w-7 h-7 text-yellow-500 flex-shrink-0" /> Patient Rounds
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live</span>
            Daily rounding &mdash; prioritize patients by clinical acuity
          </p>
        </div>
        <button onClick={() => void refetch()} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium self-start">
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
          <input type="text" placeholder="Search by name, room, or care level..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(["all", "critical", "attention", "stable"] as const).map((f) => (
            <button key={f} onClick={() => setFilterPriority(f)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${filterPriority === f ? "bg-yellow-400 text-black" : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"}`}>
              {f === "all" ? "All Patients" : f === "critical" ? "Needs Attention" : f === "attention" ? "Priority" : "Stable"}
            </button>
          ))}
          <select value={filterCareLevel} onChange={(e) => setFilterCareLevel(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none text-sm">
            <option value="all">All Care Levels</option>
            <option value="SKILLED">Skilled</option>
            <option value="MEMORY">Memory</option>
            <option value="ASSISTED">Assisted</option>
            <option value="INDEPENDENT">Independent</option>
          </select>
          <span className="text-sm text-gray-500 ml-auto">{filtered.length} patient{filtered.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* Patient Cards */}
      {loading && patients.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">Loading patient data...</div>
      ) : paginated.length > 0 ? (
        <div className="space-y-3">
          {paginated.map((p) => (
            <div key={p.id} className={`bg-white rounded-lg border transition hover:shadow-md overflow-hidden ${p.openAlerts > 0 ? "border-red-200" : "border-gray-200"}`}>
              <div className={`px-4 py-3 flex items-center justify-between gap-4 ${p.openAlerts > 0 ? "bg-red-50" : "bg-gray-50"}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-black font-bold flex-shrink-0">
                    {p.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-gray-900 truncate">{p.name}</h3>
                    <p className="text-sm text-gray-600">Room {p.room} &middot; <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold border ${CARE_LEVEL_BADGES[p.careLevel] || "bg-gray-100 text-gray-700"}`}>{p.careLevel}</span> &middot; Age {p.age}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {p.openAlerts > 0 && (
                    <span className="px-2 py-1 bg-red-500 text-white rounded-full text-xs font-bold animate-pulse">
                      {p.openAlerts} alert{p.openAlerts > 1 ? "s" : ""}
                    </span>
                  )}
                  {p.allergies && (
                    <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs font-semibold hidden sm:inline-flex">Allergies</span>
                  )}
                  {p.hasFallAlert && (
                    <span className="px-2 py-1 bg-red-600 text-white rounded text-xs font-bold animate-pulse hidden sm:inline-flex">Fall</span>
                  )}
                  {p.monitoringCount > 0 && !p.hasFallAlert && (
                    <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-semibold hidden sm:inline-flex">Camera</span>
                  )}
                </div>
              </div>
              <div className="px-4 py-3 grid grid-cols-3 sm:grid-cols-6 gap-2">
                {CARD_VITALS.map(({ key, label }) => {
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

      {/* Pagination */}
      {filtered.length > perPage && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="text-sm text-gray-600">Showing {start + 1}\u2013{Math.min(start + perPage, filtered.length)} of {filtered.length}</div>
            <select value={perPage} onChange={(e) => setPerPage(parseInt(e.target.value))}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none">
              <option value={5}>5 / page</option>
              <option value={10}>10 / page</option>
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium flex items-center gap-1">
              <ChevronLeft className="w-4 h-4" /> Prev
            </button>
            <span className="px-3 py-2 text-sm font-medium text-gray-700">Page {page} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium flex items-center gap-1">
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── View Modal ──────────────────────────────────────────────── */}
      {viewing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setViewing(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className={`sticky top-0 text-white p-5 sm:p-6 flex items-center justify-between z-10 ${viewing.openAlerts > 0 ? "bg-gradient-to-r from-red-500 to-red-600" : "bg-gradient-to-r from-blue-500 to-blue-600"}`}>
              <div>
                <h2 className="text-xl sm:text-2xl font-bold">{viewing.name}</h2>
                <p className="text-white/80 text-sm">Room {viewing.room} &middot; <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold bg-white/20">{viewing.careLevel}</span> &middot; Age {viewing.age}</p>
              </div>
              <button onClick={() => setViewing(null)} className="p-2 hover:bg-white/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>

            <div className="p-5 sm:p-6 space-y-5">
              {/* Allergies Alert */}
              {viewing.allergies && (
                <div className="bg-red-50 border-l-4 border-red-400 p-3 rounded">
                  <p className="text-sm font-semibold text-red-700 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Allergies: {viewing.allergies}</p>
                </div>
              )}

              {/* Vital Signs Grid */}
              <div>
                <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2"><HeartPulse className="w-4 h-4 text-yellow-500" /> Current Vital Signs</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {CARD_VITALS.map(({ key, label }) => {
                    const v = viewing.latestVitals[key];
                    const abnormal = isAbnormal(key, v?.value ?? "");
                    return (
                      <div key={key} className={`p-3 rounded-lg border ${abnormal ? "bg-amber-50 border-amber-200" : "bg-gray-50 border-gray-200"}`}>
                        <p className="text-xs text-gray-600 font-semibold">{label}</p>
                        <p className={`text-lg font-bold mt-1 ${abnormal ? "text-amber-700" : "text-gray-900"}`}>{v ? v.value : "\u2014"}</p>
                        <p className="text-xs text-gray-500">{v?.unit || ""} {v?.recordedAt ? `\u00b7 ${relTime(v.recordedAt, nowTs)}` : ""}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Active Medications */}
              {viewingMeds.length > 0 && (
                <div>
                  <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2"><Pill className="w-4 h-4 text-yellow-500" /> Active Medications ({viewingMeds.length})</h3>
                  <div className="space-y-2">
                    {viewingMeds.map((m, i) => (
                      <div key={i} className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900 text-sm">{asStr(m.name) || "Unknown"}</p>
                          <p className="text-xs text-gray-600">{asStr(m.dosage)} {asStr(m.route)} &middot; {asStr(m.frequency)}</p>
                        </div>
                        {m.prescribedBy && <span className="text-xs text-gray-500 flex-shrink-0">Dr. {asStr(m.prescribedBy)}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent Notes */}
              {viewingNotes.length > 0 && (
                <div>
                  <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2"><FileText className="w-4 h-4 text-yellow-500" /> Recent Notes ({viewingNotes.length})</h3>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {viewingNotes.map((n, i) => (
                      <div key={i} className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-xs font-semibold text-gray-700">{asStr(n.noteType).replace(/_/g, " ")}</span>
                          <span className="text-xs text-gray-500">{n.createdAt ? relTime(String(n.createdAt), nowTs) : ""}</span>
                        </div>
                        {n.title && <p className="text-sm font-medium text-gray-900">{asStr(n.title)}</p>}
                        {n.content && <p className="text-xs text-gray-600 mt-1 line-clamp-3">{asStr(n.content)}</p>}
                        {n.authorName && <p className="text-xs text-gray-500 mt-1">By {asStr(n.authorName)}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Camera Monitoring History */}
              {viewingMonitoringLogs.length > 0 && (
                <div>
                  <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2"><Camera className="w-4 h-4 text-yellow-500" /> Camera Monitoring ({viewingMonitoringLogs.length})</h3>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {viewingMonitoringLogs.map((log, i) => {
                      const isFall = asStr(log.logType) === "FALL_DETECTION";
                      return (
                        <div key={i} className={`p-3 rounded-lg border ${isFall ? "bg-red-50 border-red-200" : "bg-blue-50 border-blue-200"}`}>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded ${isFall ? "bg-red-200 text-red-800" : "bg-blue-200 text-blue-800"}`}>
                                {asStr(log.logType).replace(/_/g, " ")}
                              </span>
                              {log.emotion && <span className="text-xs text-gray-600">{asStr(log.emotion)}</span>}
                            </div>
                            <span className="text-xs text-gray-500">{log.createdAt ? relTime(String(log.createdAt), nowTs) : ""}</span>
                          </div>
                          {log.summary && <p className="text-xs text-gray-700 mt-1 line-clamp-2">{asStr(log.summary)}</p>}
                          <div className="flex items-center gap-3 text-[11px] text-gray-500 mt-1">
                            {log.behavior && <span>Behavior: {asStr(log.behavior)}</span>}
                            {log.posture && <span>Posture: {asStr(log.posture)}</span>}
                            {log.heartRate && <span>HR: {String(log.heartRate)}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Round Notes */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Round Notes</label>
                <textarea value={roundNotes} onChange={(e) => setRoundNotes(e.target.value)} rows={4}
                  placeholder="Patient appears stable. Continue current care plan. No changes to medications..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none resize-y text-sm" />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-5 sm:px-6 py-4 flex items-center justify-between gap-2">
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

/* ── Sub-components ──────────────────────────────────────────────────── */

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
