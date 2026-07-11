"use client";

import { useMemo, useState, useEffect } from "react";
import {
  BookOpen, Search, X, AlertTriangle, Pill, HeartPulse, Activity, RefreshCw,
  LayoutGrid, Table2, Trash2, Heart, Droplets, Wind, Thermometer,
  Clock, FileText, Users, Stethoscope, AlertCircle, TrendingUp,
  type LucideIcon,
} from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar,
  XAxis, YAxis, CartesianGrid,
} from "recharts";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident, humanize } from "@/lib/adapters";

type CareLevel = "INDEPENDENT" | "ASSISTED" | "MEMORY" | "SKILLED";
interface VitalRow { id: string; type: string; value: string; unit: string; recordedAt: string | null; residentId: string | null }
interface MedVM { name: string; dosage: string; frequency: string; status: string; prescribedBy: string; route: string; reason: string; sideEffects: string }
interface IncidentVM { type: string; severity: string; date: string | null; resolved: boolean; description: string }
interface NoteVM { id: string; title: string; content: string; authorName: string; createdAt: string | null; noteType: string; isConfidential: boolean }
interface RecordVM {
  id: string; name: string; room: string; age: number | string; gender: string | null;
  careLevel: CareLevel; alertsCount: number; allergies: string; medicalHistory: string;
  conditions: string[]; notes: string; admissionDate: string | null;
  emergencyContact: string; emergencyContactPhone: string;
  meds: MedVM[]; incidents: IncidentVM[]; clinicalNotes: NoteVM[];
  vitalsLatest: Record<string, { value: string; unit: string; recordedAt: string | null }>;
  lastCheckIn: string | null;
}

const CARE_ORDER: CareLevel[] = ["INDEPENDENT", "ASSISTED", "MEMORY", "SKILLED"];
const CARE_BADGE: Record<CareLevel, string> = {
  INDEPENDENT: "bg-green-100 text-green-800", ASSISTED: "bg-blue-100 text-blue-800",
  MEMORY: "bg-purple-100 text-purple-800", SKILLED: "bg-red-100 text-red-800",
};
const CARE_COLORS = ["#22c55e", "#3b82f6", "#a855f7", "#ef4444"];

const CARD_VITALS: { key: string; label: string; icon: LucideIcon; color: string }[] = [
  { key: "HEART_RATE", label: "HR", icon: Heart, color: "text-red-500" },
  { key: "BLOOD_PRESSURE", label: "BP", icon: Droplets, color: "text-blue-500" },
  { key: "TEMPERATURE", label: "Temp", icon: Thermometer, color: "text-orange-500" },
  { key: "OXYGEN", label: "O₂", icon: Wind, color: "text-green-500" },
  { key: "BLOOD_GLUCOSE", label: "Glucose", icon: Activity, color: "text-yellow-500" },
  { key: "RESPIRATORY_RATE", label: "RR", icon: Stethoscope, color: "text-teal-500" },
];

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700",
  medium: "bg-yellow-100 text-yellow-700", low: "bg-blue-100 text-blue-700",
};

const asStr = (v: unknown): string => (v == null ? "" : String(v));
const severityTier = (s: string): "critical" | "high" | "medium" | "low" =>
  s === "CRITICAL" ? "critical" : s === "SEVERE" ? "high" : s === "MODERATE" ? "medium" : "low";
const newer = (a: string | null, b: string | null) => (!b ? true : !a ? false : new Date(a).getTime() > new Date(b).getTime());
function relTime(iso: string | null, nowTs: number): string {
  if (!iso || !nowTs) return "—";
  const m = Math.round((nowTs - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function PhysicianRecords() {
  const { data: residentRows, loading, error, refetch } = useLiveQuery<Record<string, unknown>>(
    "residents", { query: "include=incidents,medications&take=300", tables: ["Resident", "Incident", "Medication"] }
  );
  const { data: vitalRows, refetch: refetchVitals } = useLiveQuery<Record<string, unknown>>(
    "vitals", { query: "include=resident&take=500", tables: ["VitalsLog"] }
  );
  const { data: noteRows } = useLiveQuery<Record<string, unknown>>(
    "medical-notes", { query: "take=500", tables: ["MedicalNote"] }
  );

  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  const [search, setSearch] = useState("");
  const [careFilter, setCareFilter] = useState<"all" | CareLevel>("all");
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [perPage, setPerPage] = useState(12);
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState<RecordVM | null>(null);
  const [viewTab, setViewTab] = useState<"records" | "analytics">("records");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [sortBy, setSortBy] = useState<"name" | "room" | "care" | "alerts">("name");
  const [sortAsc, setSortAsc] = useState(true);

  const vitalIndex = useMemo(() => {
    const byId = new Map<string, VitalRow[]>();
    vitalRows.forEach((row) => {
      const rid = row.residentId ? String(row.residentId) : null;
      if (!rid) return;
      const v: VitalRow = {
        id: String(row.id), type: asStr(row.type), value: asStr(row.value), unit: asStr(row.unit),
        recordedAt: row.recordedAt ? String(row.recordedAt) : null, residentId: rid,
      };
      const arr = byId.get(rid);
      if (arr) arr.push(v); else byId.set(rid, [v]);
    });
    return byId;
  }, [vitalRows]);

  const notesIndex = useMemo(() => {
    const byResident = new Map<string, NoteVM[]>();
    noteRows.forEach((row) => {
      const rid = asStr(row.residentId);
      if (!rid) return;
      const note: NoteVM = {
        id: String(row.id), title: asStr(row.title), content: asStr(row.content),
        authorName: asStr(row.authorName), createdAt: row.createdAt ? String(row.createdAt) : null,
        noteType: asStr(row.noteType), isConfidential: Boolean(row.isConfidential),
      };
      const arr = byResident.get(rid);
      if (arr) arr.push(note); else byResident.set(rid, [note]);
    });
    return byResident;
  }, [noteRows]);

  const records = useMemo<RecordVM[]>(() => residentRows.map((row) => {
    const r = adaptResident(row);
    const raw = r.raw as Record<string, unknown>;
    const rawMeds = (raw?.medications ?? []) as Array<Record<string, unknown>>;
    const rawIncidents = (raw?.incidents ?? []) as Array<Record<string, unknown>>;
    const vitalsArr = vitalIndex.get(r.id) ?? [];
    const vitalsLatest: RecordVM["vitalsLatest"] = {};
    let lastCheckIn: string | null = null;
    vitalsArr.forEach((v) => {
      const cur = vitalsLatest[v.type];
      if (!cur || newer(v.recordedAt, cur.recordedAt)) vitalsLatest[v.type] = { value: v.value, unit: v.unit, recordedAt: v.recordedAt };
      if (newer(v.recordedAt, lastCheckIn)) lastCheckIn = v.recordedAt;
    });
    return {
      id: r.id, name: r.name, room: r.room, age: r.age ?? "—",
      gender: asStr(raw.gender) || null,
      careLevel: r.careLevel, alertsCount: r.alertsCount,
      allergies: r.allergies || "", medicalHistory: r.medicalHistory || "",
      conditions: r.medicalHistory ? r.medicalHistory.split(",").map((c) => c.trim()).filter(Boolean) : [],
      notes: r.notes || "",
      admissionDate: raw.admissionDate ? String(raw.admissionDate) : null,
      emergencyContact: asStr(raw.emergencyContact),
      emergencyContactPhone: asStr(raw.emergencyContactPhone),
      meds: rawMeds.map((m) => ({
        name: asStr(m.name), dosage: asStr(m.dosage), frequency: asStr(m.frequency),
        status: asStr(m.status) || "ACTIVE", prescribedBy: asStr(m.prescribedBy),
        route: asStr(m.route), reason: asStr(m.reason), sideEffects: asStr(m.sideEffects),
      })),
      incidents: rawIncidents.map((i) => ({
        type: humanize(asStr(i.incidentType)) || "Incident", severity: severityTier(asStr(i.severity)),
        date: i.incidentDate ? String(i.incidentDate) : null, resolved: Boolean(i.resolvedAt), description: asStr(i.description),
      })),
      clinicalNotes: notesIndex.get(r.id) ?? [],
      vitalsLatest, lastCheckIn,
    };
  }), [residentRows, vitalIndex, notesIndex]);

  const stats = useMemo(() => ({
    total: records.length,
    withAlerts: records.filter((r) => r.alertsCount > 0).length,
    onMeds: records.filter((r) => r.meds.some((m) => m.status === "ACTIVE")).length,
    skilled: records.filter((r) => r.careLevel === "SKILLED" || r.careLevel === "MEMORY").length,
    withNotes: records.filter((r) => r.clinicalNotes.length > 0).length,
  }), [records]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = records.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q) && !r.room.toLowerCase().includes(q) && !r.allergies.toLowerCase().includes(q)) return false;
      if (careFilter !== "all" && r.careLevel !== careFilter) return false;
      if (alertsOnly && r.alertsCount === 0) return false;
      return true;
    });
    result.sort((a, b) => {
      if (sortBy === "room") return sortAsc ? a.room.localeCompare(b.room) : b.room.localeCompare(a.room);
      if (sortBy === "care") {
        const diff = CARE_ORDER.indexOf(a.careLevel) - CARE_ORDER.indexOf(b.careLevel);
        return sortAsc ? diff : -diff;
      }
      if (sortBy === "alerts") return sortAsc ? a.alertsCount - b.alertsCount : b.alertsCount - a.alertsCount;
      return sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
    });
    return result;
  }, [records, search, careFilter, alertsOnly, sortBy, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const start = (page - 1) * perPage;
  const paginated = filtered.slice(start, start + perPage);

  useEffect(() => { setPage(1); }, [search, careFilter, alertsOnly, perPage, sortBy, sortAsc]);

  const vital = (r: RecordVM, key: string) => {
    const v = r.vitalsLatest[key];
    return v ? `${v.value}${v.unit ? " " + v.unit : ""}` : "—";
  };
  const vitalTime = (r: RecordVM, key: string) => {
    const v = r.vitalsLatest[key];
    return v?.recordedAt ? relTime(v.recordedAt, nowTs) : "";
  };
  const refreshAll = () => { void refetch(); void refetchVitals(); };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent mb-1 flex items-center gap-2">
            <BookOpen className="w-7 h-7 text-yellow-500 flex-shrink-0" /> Medical Records
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live</span>
            Clinical records, vitals, medications &amp; history
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden bg-white">
            <button onClick={() => setViewTab("records")} className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition ${viewTab === "records" ? "bg-yellow-400 text-black" : "text-gray-700 hover:bg-gray-50"}`}><BookOpen className="w-4 h-4" /> Records</button>
            <button onClick={() => setViewTab("analytics")} className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition border-l border-gray-300 ${viewTab === "analytics" ? "bg-yellow-400 text-black" : "text-gray-700 hover:bg-gray-50"}`}><TrendingUp className="w-4 h-4" /> Analytics</button>
          </div>
          <button onClick={refreshAll} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatBox label="Total" value={stats.total} icon={Users} color="gray" />
        <StatBox label="With Alerts" value={stats.withAlerts} icon={AlertTriangle} color="red" />
        <StatBox label="On Meds" value={stats.onMeds} icon={Pill} color="blue" />
        <StatBox label="Skilled/Memory" value={stats.skilled} icon={Stethoscope} color="purple" />
        <StatBox label="Has Notes" value={stats.withNotes} icon={FileText} color="green" />
      </div>

      {viewTab === "analytics" && <RecordsAnalytics records={records} />}

      {viewTab === "records" && (
        <>
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
              <input type="text" placeholder="Search name, room, allergies…" value={search} onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none bg-white" />
            </div>
            <select value={careFilter} onChange={(e) => setCareFilter(e.target.value as "all" | CareLevel)}
              className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
              <option value="all">All Care Levels</option>
              {CARE_ORDER.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
            </select>
            <label className="flex items-center gap-2 px-3 py-2.5 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 bg-white select-none text-sm">
              <input type="checkbox" checked={alertsOnly} onChange={(e) => setAlertsOnly(e.target.checked)} className="w-4 h-4 rounded" />
              <span className="text-gray-700 font-medium">Alerts only</span>
            </label>
            <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))}
              className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
              <option value={12}>12/page</option>
              <option value={24}>24/page</option>
              <option value={48}>48/page</option>
            </select>
            <div className="flex gap-1">
              {(["name", "room", "care", "alerts"] as const).map((s) => (
                <button key={s} onClick={() => { if (sortBy !== s) setSortBy(s); else setSortAsc(!sortAsc); }}
                  className={`px-2.5 py-2 text-xs rounded-lg border transition font-medium ${sortBy === s ? "bg-yellow-400 text-black border-yellow-400" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
                  {s === "alerts" ? "Alerts" : s === "care" ? "Care" : s === "room" ? "Room" : "Name"}{sortBy === s && (sortAsc ? " ↑" : " ↓")}
                </button>
              ))}
              <div className="flex rounded-lg border border-gray-300 overflow-hidden">
                <button onClick={() => setViewMode("grid")} className={`px-2.5 py-2 text-sm transition ${viewMode === "grid" ? "bg-yellow-400 text-black font-semibold" : "bg-white text-gray-600 hover:bg-gray-50"}`}><LayoutGrid className="w-4 h-4" /></button>
                <button onClick={() => setViewMode("table")} className={`px-2.5 py-2 text-sm transition border-l border-gray-300 ${viewMode === "table" ? "bg-yellow-400 text-black font-semibold" : "bg-white text-gray-600 hover:bg-gray-50"}`}><Table2 className="w-4 h-4" /></button>
              </div>
            </div>
          </div>

          {/* Content */}
          {loading && records.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">Loading records…</div>
          ) : error ? (
            <div className="bg-white rounded-lg border border-red-200 p-10 text-center text-red-600">Failed to load: {error}</div>
          ) : paginated.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">No records match your filters.</div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {paginated.map((r) => (
                <div key={r.id} className="bg-white rounded-lg border border-gray-200 hover:border-yellow-300 hover:shadow-lg transition overflow-hidden flex flex-col">
                  <div className={`p-4 ${r.alertsCount > 0 ? "bg-red-50 border-b-2 border-red-300" : "bg-gray-50 border-b border-gray-200"}`}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <h3 className="text-lg font-bold text-gray-900 truncate">{r.name}</h3>
                        <p className="text-sm text-gray-600">Room {r.room} · Age {r.age}{r.gender ? ` · ${r.gender}` : ""}</p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {r.alertsCount > 0 && <span className="px-2 py-1 bg-red-500 text-white rounded-full text-xs font-bold">{r.alertsCount}</span>}
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${CARE_BADGE[r.careLevel]}`}>{humanize(r.careLevel)}</span>
                      </div>
                    </div>
                    {r.lastCheckIn && <p className="text-xs text-gray-500 flex items-center gap-1"><Clock className="w-3 h-3" /> Last vitals: {relTime(r.lastCheckIn, nowTs)}</p>}
                  </div>
                  <div className="p-4 border-b border-gray-200">
                    <p className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wider">Vitals</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {CARD_VITALS.map(({ key, label, icon: Icon, color }) => (
                        <div key={key} className="flex items-center gap-1.5 bg-gray-50 p-1.5 rounded text-xs">
                          <Icon className={`w-3 h-3 ${color} flex-shrink-0`} />
                          <div className="min-w-0">
                            <p className="text-gray-500 leading-none">{label}</p>
                            <p className="font-bold text-gray-900 truncate">{vital(r, key)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="px-4 py-2.5 bg-blue-50 border-b border-blue-200 flex items-center gap-4 text-xs">
                    <span className="text-blue-700 font-semibold flex items-center gap-1"><Pill className="w-3 h-3" /> {r.meds.filter((m) => m.status === "ACTIVE").length} active meds</span>
                    <span className="text-gray-600 flex items-center gap-1"><FileText className="w-3 h-3" /> {r.clinicalNotes.length} notes</span>
                    <span className="text-gray-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {r.incidents.length} incidents</span>
                  </div>
                  {r.allergies && (
                    <div className="px-4 py-2 bg-red-50 border-b border-red-200">
                      <p className="text-xs text-red-700 font-semibold truncate"><AlertCircle className="w-3 h-3 inline mr-1" />Allergies: {r.allergies}</p>
                    </div>
                  )}
                  <div className="p-4 mt-auto">
                    <button onClick={() => setViewing(r)} className="w-full px-4 py-2 bg-gradient-to-r from-blue-400 to-blue-500 text-white font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">
                      View Full Record
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Patient</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 hidden sm:table-cell">Room</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 hidden md:table-cell">Care</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Vitals</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-700">Meds</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-700 hidden sm:table-cell">Notes</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-700">Alerts</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-700">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paginated.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50 transition">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-900">{r.name}</div>
                        <div className="text-xs text-gray-500">Age {r.age}{r.gender ? ` · ${r.gender}` : ""}</div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">{r.room}</td>
                      <td className="px-4 py-3 hidden md:table-cell"><span className={`px-2 py-0.5 rounded text-xs font-bold ${CARE_BADGE[r.careLevel]}`}>{humanize(r.careLevel)}</span></td>
                      <td className="px-4 py-3 text-xs">{vital(r, "HEART_RATE")}</td>
                      <td className="px-4 py-3 text-center">{r.meds.filter((m) => m.status === "ACTIVE").length}</td>
                      <td className="px-4 py-3 text-center hidden sm:table-cell">{r.clinicalNotes.length}</td>
                      <td className="px-4 py-3 text-center">
                        {r.alertsCount > 0 ? <span className="px-2 py-0.5 bg-red-500 text-white rounded-full text-xs font-bold">{r.alertsCount}</span> : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => setViewing(r)} className="px-3 py-1 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded transition">View</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {filtered.length > perPage && (
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="text-sm text-gray-600">Showing {start + 1}–{Math.min(start + perPage, filtered.length)} of {filtered.length}</div>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">Previous</button>
                <span className="px-3 py-2 text-sm font-medium text-gray-700">Page {page} / {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">Next</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Detail Modal */}
      {viewing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black p-5 flex items-center justify-between z-10">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold">{viewing.name}</h2>
                <p className="text-yellow-900/70 text-sm">Room {viewing.room} · Age {viewing.age}{viewing.gender ? ` · ${viewing.gender}` : ""} · {humanize(viewing.careLevel)}</p>
              </div>
              <button onClick={() => setViewing(null)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-5">
              {/* Allergies */}
              {viewing.allergies && (
                <div className="bg-red-50 border-l-4 border-red-400 p-3 rounded flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-red-700">Allergies</p>
                    <p className="text-gray-900 text-sm">{viewing.allergies}</p>
                  </div>
                </div>
              )}

              {/* Quick Info Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <InfoBox label="Room" value={viewing.room} />
                <InfoBox label="Age" value={String(viewing.age)} />
                <InfoBox label="Care Level" value={humanize(viewing.careLevel)} />
                <InfoBox label="Admission" value={viewing.admissionDate ? new Date(viewing.admissionDate).toLocaleDateString() : "—"} />
              </div>

              {/* Emergency Contact */}
              {viewing.emergencyContact && (
                <div className="bg-blue-50 border-l-4 border-blue-400 p-3 rounded">
                  <p className="text-sm font-bold text-gray-900 mb-1">Emergency Contact</p>
                  <p className="text-gray-700 text-sm">{viewing.emergencyContact}{viewing.emergencyContactPhone ? ` · ${viewing.emergencyContactPhone}` : ""}</p>
                </div>
              )}

              {/* Vital Signs */}
              <div>
                <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-1.5"><HeartPulse className="w-4 h-4 text-red-500" /> Latest Vitals</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {CARD_VITALS.map(({ key, label, icon: Icon, color }) => {
                    const v = viewing.vitalsLatest[key];
                    return (
                      <div key={key} className="bg-gray-50 p-3 rounded border border-gray-200">
                        <p className="text-xs text-gray-600 font-semibold flex items-center gap-1"><Icon className={`w-3 h-3 ${color}`} />{label}</p>
                        <p className="text-lg font-bold text-gray-900 mt-1">{v ? v.value : "—"}</p>
                        <p className="text-xs text-gray-500">{v?.unit || ""}{v?.recordedAt ? ` · ${relTime(v.recordedAt, nowTs)}` : ""}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Medications */}
              <div>
                <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-1.5"><Pill className="w-4 h-4 text-blue-500" /> Medications ({viewing.meds.length})</h3>
                <div className="space-y-2 max-h-52 overflow-y-auto">
                  {viewing.meds.length ? viewing.meds.map((m, i) => (
                    <div key={i} className={`p-3 rounded border ${m.status === "ACTIVE" ? "bg-blue-50 border-blue-200" : m.status === "ON_HOLD" ? "bg-amber-50 border-amber-200" : "bg-gray-50 border-gray-200"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-gray-900 text-sm">{m.name}</span>
                            <span className="text-gray-600 text-sm">{m.dosage}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${m.status === "ACTIVE" ? "bg-green-100 text-green-700" : m.status === "ON_HOLD" ? "bg-amber-100 text-amber-700" : "bg-gray-200 text-gray-600"}`}>{m.status}</span>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">{m.frequency} · {m.route}{m.prescribedBy ? ` · Rx: ${m.prescribedBy}` : ""}</p>
                          {m.reason && <p className="text-xs text-gray-600 mt-1">Reason: {m.reason}</p>}
                          {m.sideEffects && <p className="text-xs text-amber-600 mt-0.5">Side effects: {m.sideEffects}</p>}
                        </div>
                      </div>
                    </div>
                  )) : <p className="text-sm text-gray-500">No medications on record.</p>}
                </div>
              </div>

              {/* Conditions */}
              {viewing.conditions.length > 0 && (
                <div>
                  <h3 className="font-bold text-gray-900 mb-2 flex items-center gap-1.5"><Stethoscope className="w-4 h-4 text-purple-500" /> Conditions</h3>
                  <div className="flex flex-wrap gap-2">
                    {viewing.conditions.map((c, i) => (
                      <span key={i} className="px-2.5 py-1 bg-purple-50 border border-purple-200 rounded-full text-xs font-medium text-purple-800">{c}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Clinical Notes */}
              {viewing.clinicalNotes.length > 0 && (
                <div>
                  <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-1.5"><FileText className="w-4 h-4 text-green-500" /> Clinical Notes ({viewing.clinicalNotes.length})</h3>
                  <div className="space-y-2 max-h-52 overflow-y-auto">
                    {viewing.clinicalNotes.slice(0, 10).map((n) => (
                      <div key={n.id} className={`p-3 rounded border ${n.isConfidential ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-gray-900 text-sm">{n.title || "Note"}</span>
                          <div className="flex items-center gap-1.5">
                            {n.noteType && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-200 text-gray-700">{n.noteType}</span>}
                            {n.isConfidential && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-200 text-red-700">CONFIDENTIAL</span>}
                          </div>
                        </div>
                        <p className="text-xs text-gray-600 mt-0.5">{n.authorName || "Unknown"} · {relTime(n.createdAt, nowTs)}</p>
                        {n.content && <p className="text-xs text-gray-700 mt-1 line-clamp-3 whitespace-pre-wrap">{n.content}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Incidents */}
              {viewing.incidents.length > 0 && (
                <div>
                  <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-orange-500" /> Incidents ({viewing.incidents.length})</h3>
                  <div className="space-y-2 max-h-52 overflow-y-auto">
                    {viewing.incidents.slice(0, 8).map((i, idx) => (
                      <div key={idx} className={`p-3 rounded border ${i.resolved ? "bg-gray-50 border-gray-200" : "bg-red-50 border-red-200"}`}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-medium text-gray-900 text-sm">{i.type}</span>
                          <div className="flex items-center gap-1.5">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${SEVERITY_BADGE[i.severity]}`}>{i.severity.toUpperCase()}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${i.resolved ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{i.resolved ? "RESOLVED" : "OPEN"}</span>
                          </div>
                        </div>
                        <p className="text-xs text-gray-600 line-clamp-2">{i.description}</p>
                        {i.date && <p className="text-xs text-gray-500 mt-1">{new Date(i.date).toLocaleDateString()}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Care Notes */}
              {viewing.notes && (
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded">
                  <h3 className="font-bold text-gray-900 mb-1 text-sm">Care Notes</h3>
                  <p className="text-gray-900 text-sm whitespace-pre-wrap">{viewing.notes}</p>
                </div>
              )}
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end">
              <button onClick={() => setViewing(null)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RecordsAnalytics({ records }: { records: RecordVM[] }) {
  const a = useMemo(() => ({
    byCare: CARE_ORDER.map((c) => ({ name: humanize(c), value: records.filter((r) => r.careLevel === c).length })).filter((d) => d.value > 0),
    alertsByCare: CARE_ORDER.map((c) => ({ name: humanize(c), Alerts: records.filter((r) => r.careLevel === c).reduce((s, r) => s + r.alertsCount, 0) })),
    medsByStatus: ["ACTIVE", "ON_HOLD", "DISCONTINUED", "PENDING"].map((s) => ({
      name: s, value: records.reduce((sum, r) => sum + r.meds.filter((m) => m.status === s).length, 0),
    })).filter((d) => d.value > 0),
    notesByResident: records.filter((r) => r.clinicalNotes.length > 0)
      .sort((a, b) => b.clinicalNotes.length - a.clinicalNotes.length)
      .slice(0, 8)
      .map((r) => ({ name: r.name.split(" ")[0], Notes: r.clinicalNotes.length })),
  }), [records]);

  if (records.length === 0) return <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">No data to analyze.</div>;

  const MED_COLORS = ["#22c55e", "#f59e0b", "#ef4444", "#3b82f6"];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartCard title="Care Level Distribution">
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie data={a.byCare} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
              {a.byCare.map((_, i) => <Cell key={i} fill={CARE_COLORS[i % CARE_COLORS.length]} />)}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Open Alerts by Care Level">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={a.alertsByCare} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={28} />
            <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <Bar dataKey="Alerts" fill="#ef4444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Medications by Status">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={a.medsByStatus} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={28} />
            <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <Bar dataKey="value" name="Meds" radius={[4, 4, 0, 0]}>
              {a.medsByStatus.map((_, i) => <Cell key={i} fill={MED_COLORS[i % MED_COLORS.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Top Patients by Notes">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={a.notesByResident} layout="vertical" margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
            <XAxis type="number" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis dataKey="name" type="category" fontSize={11} tickLine={false} axisLine={false} width={70} />
            <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <Bar dataKey="Notes" fill="#22c55e" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function StatBox({ label, value, icon: Icon, color }: { label: string; value: number; icon: LucideIcon; color: string }) {
  const C: Record<string, { text: string; bg: string; border: string }> = {
    gray:   { text: "text-gray-900",   bg: "bg-gray-50",   border: "border-gray-200" },
    red:    { text: "text-red-600",    bg: "bg-red-50",    border: "border-red-200" },
    blue:   { text: "text-blue-600",   bg: "bg-blue-50",   border: "border-blue-200" },
    green:  { text: "text-green-600",  bg: "bg-green-50",  border: "border-green-200" },
    purple: { text: "text-purple-600", bg: "bg-purple-50", border: "border-purple-200" },
  };
  const c = C[color] || C.gray;
  return (
    <div className={`rounded-lg border p-4 ${c.bg} ${c.border}`}>
      <div className="flex items-center justify-between mb-0.5">
        <p className="text-xs font-semibold text-gray-600">{label}</p>
        <Icon className={`w-4 h-4 ${c.text}`} />
      </div>
      <p className={`text-2xl sm:text-3xl font-bold ${c.text}`}>{value}</p>
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 p-3 rounded border border-gray-200">
      <p className="text-xs text-gray-500 font-semibold">{label}</p>
      <p className="text-sm font-bold text-gray-900 mt-0.5">{value}</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5 text-yellow-500" /> {title}</h3>
      {children}
    </div>
  );
}
