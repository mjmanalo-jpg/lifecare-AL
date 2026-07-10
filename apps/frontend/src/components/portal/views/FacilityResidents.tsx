"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Users, Search, X, Heart, Droplets, Wind, Thermometer, AlertTriangle,
  Pill, Activity, Clock, RefreshCw, ListChecks, BarChart3, HeartPulse,
  Camera, UserPlus, Loader2, CheckCircle2, type LucideIcon,
} from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Legend, Tooltip, BarChart, Bar,
  XAxis, YAxis, CartesianGrid,
} from "recharts";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident, humanize } from "@/lib/adapters";
import { createRecord } from "@/lib/api";

type CareLevel = "INDEPENDENT" | "ASSISTED" | "MEMORY" | "SKILLED";

interface VitalRow {
  id: string; type: string; value: string; unit: string;
  recordedAt: string | null; residentId: string | null; room: string | null;
}
interface MedVM { name: string; dosage: string; frequency: string; status: string }
interface IncidentVM { type: string; severity: string; date: string | null; resolved: boolean; description: string }
interface ResidentVM {
  id: string; name: string; room: string; age: number | string;
  careLevel: CareLevel; alertsCount: number;
  allergies: string; conditions: string[]; notes: string;
  meds: MedVM[]; incidents: IncidentVM[];
  vitalsLatest: Record<string, { value: string; unit: string; recordedAt: string | null }>;
  vitalsAll: { type: string; value: string; unit: string; recordedAt: string | null }[];
  lastCheckIn: string | null;
}

const CARE_ORDER: CareLevel[] = ["INDEPENDENT", "ASSISTED", "MEMORY", "SKILLED"];
const CARE_BADGE: Record<CareLevel, string> = {
  INDEPENDENT: "bg-green-100 text-green-800",
  ASSISTED: "bg-blue-100 text-blue-800",
  MEMORY: "bg-purple-100 text-purple-800",
  SKILLED: "bg-red-100 text-red-800",
};
const CARE_COLORS = ["#22c55e", "#3b82f6", "#a855f7", "#ef4444"];
const CARD_VITALS: { key: string; label: string; icon: LucideIcon; color: string }[] = [
  { key: "HEART_RATE", label: "HR", icon: Heart, color: "text-red-500" },
  { key: "BLOOD_PRESSURE", label: "BP", icon: Droplets, color: "text-blue-500" },
  { key: "TEMPERATURE", label: "Temp", icon: Thermometer, color: "text-orange-500" },
  { key: "OXYGEN", label: "O₂", icon: Wind, color: "text-green-500" },
];
const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700",
  medium: "bg-yellow-100 text-yellow-700", low: "bg-blue-100 text-blue-700",
};

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
const newer = (a: string | null, b: string | null) =>
  !b ? true : !a ? false : new Date(a).getTime() > new Date(b).getTime();

export default function FacilityResidents() {
  const { data: residentRows, loading, error, refetch } = useLiveQuery<Record<string, unknown>>(
    "residents", { query: "include=incidents,medications&take=300", tables: ["Resident", "Incident", "Medication"] }
  );
  const { data: vitalRows, refetch: refetchVitals } = useLiveQuery<Record<string, unknown>>(
    "vitals", { query: "include=resident&take=500", tables: ["VitalsLog"] }
  );

  const router = useRouter();
  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  const [view, setView] = useState<"list" | "analytics">("list");
  const [search, setSearch] = useState("");
  const [careFilter, setCareFilter] = useState<"all" | CareLevel>("all");
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [sort, setSort] = useState<"name" | "room" | "alerts">("name");
  const [perPage, setPerPage] = useState(9);
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState<ResidentVM | null>(null);
  const [admitting, setAdmitting] = useState(false);

  const vitalIndex = useMemo(() => {
    const byId = new Map<string, VitalRow[]>();
    const byRoom = new Map<string, VitalRow[]>();
    vitalRows.forEach((row) => {
      const res = row.resident as { roomNumber?: string } | undefined;
      const v: VitalRow = {
        id: String(row.id), type: asStr(row.type), value: asStr(row.value),
        unit: asStr(row.unit), recordedAt: row.recordedAt ? String(row.recordedAt) : null,
        residentId: row.residentId ? String(row.residentId) : null,
        room: res?.roomNumber ?? null,
      };
      if (v.residentId) {
        const arr = byId.get(v.residentId); if (arr) arr.push(v); else byId.set(v.residentId, [v]);
      }
      if (v.room) {
        const arr = byRoom.get(v.room); if (arr) arr.push(v); else byRoom.set(v.room, [v]);
      }
    });
    return { byId, byRoom };
  }, [vitalRows]);

  const residents = useMemo<ResidentVM[]>(() => {
    return residentRows.map((row) => {
      const r = adaptResident(row);
      const rawMeds = (r.raw?.medications ?? []) as Array<Record<string, unknown>>;
      const rawIncidents = (r.raw?.incidents ?? []) as Array<Record<string, unknown>>;

      const merged = new Map<string, VitalRow>();
      [...(vitalIndex.byId.get(r.id) ?? []), ...(vitalIndex.byRoom.get(r.room) ?? [])]
        .forEach((v) => merged.set(v.id, v));
      const vrows = Array.from(merged.values());

      const vitalsLatest: ResidentVM["vitalsLatest"] = {};
      let lastCheckIn: string | null = null;
      vrows.forEach((v) => {
        const cur = vitalsLatest[v.type];
        if (!cur || newer(v.recordedAt, cur.recordedAt)) {
          vitalsLatest[v.type] = { value: v.value, unit: v.unit, recordedAt: v.recordedAt };
        }
        if (newer(v.recordedAt, lastCheckIn)) lastCheckIn = v.recordedAt;
      });

      return {
        id: r.id, name: r.name, room: r.room, age: r.age ?? "—",
        careLevel: r.careLevel, alertsCount: r.alertsCount,
        allergies: r.allergies || "",
        conditions: r.medicalHistory ? r.medicalHistory.split(",").map((c) => c.trim()).filter(Boolean) : [],
        notes: r.notes || "",
        meds: rawMeds.map((m) => ({
          name: asStr(m.name), dosage: asStr(m.dosage), frequency: asStr(m.frequency), status: asStr(m.status) || "ACTIVE",
        })),
        incidents: rawIncidents.map((i) => ({
          type: humanize(asStr(i.incidentType)) || "Incident",
          severity: i.severity === "CRITICAL" ? "critical" : i.severity === "SEVERE" ? "high" : i.severity === "MODERATE" ? "medium" : "low",
          date: i.incidentDate ? String(i.incidentDate) : null,
          resolved: Boolean(i.resolvedAt),
          description: asStr(i.description),
        })),
        vitalsLatest,
        vitalsAll: vrows.filter((v) => v.recordedAt)
          .sort((a, b) => new Date(b.recordedAt as string).getTime() - new Date(a.recordedAt as string).getTime())
          .map((v) => ({ type: v.type, value: v.value, unit: v.unit, recordedAt: v.recordedAt })),
        lastCheckIn,
      };
    });
  }, [residentRows, vitalIndex]);

  const stats = useMemo(() => ({
    total: residents.length,
    withAlerts: residents.filter((r) => r.alertsCount > 0).length,
    onMeds: residents.filter((r) => r.meds.some((m) => m.status === "ACTIVE")).length,
    checkedToday: residents.filter((r) => r.lastCheckIn && nowTs && (nowTs - new Date(r.lastCheckIn).getTime() < 86_400_000)).length,
    avgAge: (() => {
      const ages = residents.map((r) => (typeof r.age === "number" ? r.age : NaN)).filter((n) => !isNaN(n));
      return ages.length ? Math.round(ages.reduce((s, n) => s + n, 0) / ages.length) : 0;
    })(),
  }), [residents, nowTs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return residents.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q) && !r.room.toLowerCase().includes(q)) return false;
      if (careFilter !== "all" && r.careLevel !== careFilter) return false;
      if (alertsOnly && r.alertsCount === 0) return false;
      return true;
    }).sort((a, b) =>
      sort === "alerts" ? b.alertsCount - a.alertsCount
        : sort === "room" ? a.room.localeCompare(b.room, undefined, { numeric: true })
          : a.name.localeCompare(b.name)
    );
  }, [residents, search, careFilter, alertsOnly, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const start = (page - 1) * perPage;
  const paginated = filtered.slice(start, start + perPage);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset paging on filter change
    setPage(1);
  }, [search, careFilter, alertsOnly, sort, perPage]);

  const vital = (r: ResidentVM, key: string) => {
    const v = r.vitalsLatest[key];
    return v ? `${v.value}${v.unit ? ` ${v.unit}` : ""}` : "—";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent mb-1 flex items-center gap-2">
            <Users className="w-7 h-7 text-yellow-500 flex-shrink-0" /> Resident Directory
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-green-600">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live
            </span>
            Full resident roster &amp; health status
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
            <button onClick={() => setView("list")} className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition ${view === "list" ? "bg-yellow-400 text-black" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
              <ListChecks className="w-4 h-4" /> Directory
            </button>
            <button onClick={() => setView("analytics")} className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition border-l border-gray-300 ${view === "analytics" ? "bg-yellow-400 text-black" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
              <BarChart3 className="w-4 h-4" /> Analytics
            </button>
          </div>
          <button onClick={() => { void refetch(); void refetchVitals(); }} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button onClick={() => setAdmitting(true)} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">
            <UserPlus className="w-4 h-4" /> Admit Resident
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        <Stat label="Total Residents" value={stats.total} icon={Users} tone="gray" />
        <Stat label="With Alerts" value={stats.withAlerts} icon={AlertTriangle} tone="red" />
        <Stat label="On Medications" value={stats.onMeds} icon={Pill} tone="blue" />
        <Stat label="Checked (24h)" value={stats.checkedToday} icon={HeartPulse} tone="green" />
        <Stat label="Avg Age" value={stats.avgAge} icon={Activity} tone="amber" />
      </div>

      {view === "analytics" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Care Level Distribution">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={CARE_ORDER.map((c) => ({ name: humanize(c), value: residents.filter((r) => r.careLevel === c).length })).filter((d) => d.value > 0)} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                  {CARE_ORDER.map((_, i) => <Cell key={i} fill={CARE_COLORS[i % CARE_COLORS.length]} />)}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Open Alerts by Care Level">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={CARE_ORDER.map((c) => ({ name: humanize(c), Alerts: residents.filter((r) => r.careLevel === c).reduce((s, r) => s + r.alertsCount, 0) }))} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={28} />
                <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                <Bar dataKey="Alerts" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Vitals Coverage" className="lg:col-span-2">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={CARD_VITALS.map((cv) => ({ name: cv.label, Residents: residents.filter((r) => r.vitalsLatest[cv.key]).length }))} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={28} />
                <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                <Bar dataKey="Residents" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}

      {view === "list" && (
        <>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
              <input type="text" placeholder="Search by name or room…" value={search} onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <select value={careFilter} onChange={(e) => setCareFilter(e.target.value as "all" | CareLevel)} className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none">
                <option value="all">All Care Levels</option>
                {CARE_ORDER.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
              </select>
              <select value={sort} onChange={(e) => setSort(e.target.value as "name" | "room" | "alerts")} className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none">
                <option value="name">Sort: Name</option>
                <option value="room">Sort: Room</option>
                <option value="alerts">Sort: Most Alerts</option>
              </select>
              <select value={perPage} onChange={(e) => setPerPage(parseInt(e.target.value))} className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none">
                <option value={9}>9 per page</option>
                <option value={18}>18 per page</option>
                <option value={36}>36 per page</option>
              </select>
              <label className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 select-none">
                <input type="checkbox" checked={alertsOnly} onChange={(e) => setAlertsOnly(e.target.checked)} className="w-4 h-4 rounded" />
                <span className="text-sm text-gray-700 font-medium">Alerts only</span>
              </label>
            </div>
          </div>

          {loading && residents.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">Loading residents…</div>
          ) : error ? (
            <div className="bg-white rounded-lg border border-red-200 p-10 text-center text-red-600">Failed to load: {error}</div>
          ) : paginated.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {paginated.map((r) => (
                <div key={r.id} className="bg-white rounded-lg border border-gray-200 hover:border-yellow-300 hover:shadow-lg transition overflow-hidden flex flex-col">
                  <div className={`p-4 ${r.alertsCount > 0 ? "bg-red-50 border-b-2 border-red-300" : "bg-gray-50 border-b border-gray-200"}`}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <h3 className="text-lg font-bold text-gray-900 truncate">{r.name}</h3>
                        <p className="text-sm text-gray-600">Room {r.room} • Age {r.age}</p>
                      </div>
                      {r.alertsCount > 0 && <span className="px-2 py-1 bg-red-500 text-white rounded-full text-xs font-bold flex-shrink-0">🚨 {r.alertsCount}</span>}
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${CARE_BADGE[r.careLevel]}`}>{humanize(r.careLevel)}</span>
                  </div>
                  <div className="p-4 border-b border-gray-200">
                    <p className="text-xs font-semibold text-gray-600 mb-3">LATEST VITALS</p>
                    <div className="grid grid-cols-2 gap-2">
                      {CARD_VITALS.map(({ key, label, icon: Icon, color }) => (
                        <div key={key} className="flex items-center gap-2 bg-gray-50 p-2 rounded">
                          <Icon className={`w-4 h-4 ${color}`} />
                          <div className="min-w-0">
                            <p className="text-xs text-gray-600">{label}</p>
                            <p className="font-bold text-gray-900 text-sm truncate">{vital(r, key)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="px-4 py-3 bg-blue-50 border-b border-blue-200 flex items-center justify-between">
                    <p className="text-xs text-blue-700 font-semibold flex items-center gap-1"><Clock className="w-3 h-3" /> {relTime(r.lastCheckIn, nowTs)}</p>
                    <p className="text-xs text-gray-600 flex items-center gap-1"><Pill className="w-3 h-3" /> {r.meds.length} meds</p>
                  </div>
                  <div className="p-4 mt-auto">
                    <button onClick={() => setViewing(r)} className="w-full px-4 py-2 bg-gradient-to-r from-blue-400 to-blue-500 text-white font-semibold rounded-lg hover:shadow-lg transition active:scale-95">
                      View Details
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">No residents match your filters.</div>
          )}

          {filtered.length > perPage && (
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="text-sm text-gray-600">Showing {start + 1}-{Math.min(start + perPage, filtered.length)} of {filtered.length} residents</div>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium">Previous</button>
                <span className="px-3 py-2 text-sm font-medium text-gray-700">Page {page} / {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium">Next</button>
              </div>
            </div>
          )}
        </>
      )}

      {admitting && (
        <AdmitResidentModal
          takenRooms={residents.map((r) => r.room)}
          onClose={() => setAdmitting(false)}
          onAdmitted={() => { void refetch(); }}
        />
      )}

      {viewing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-400 to-blue-500 text-white p-5 sm:p-6 flex items-center justify-between z-10">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold">{viewing.name}</h2>
                <p className="text-blue-100 text-sm">Room {viewing.room} • Age {viewing.age} • {humanize(viewing.careLevel)}</p>
              </div>
              <button onClick={() => setViewing(null)} className="p-2 hover:bg-blue-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 sm:p-8 space-y-6">
              {viewing.allergies && (
                <div className="bg-red-50 border-l-4 border-red-400 p-3 rounded">
                  <p className="text-sm font-semibold text-red-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Allergies</p>
                  <p className="text-gray-900 text-sm mt-1">{viewing.allergies}</p>
                </div>
              )}
              <div>
                <h3 className="font-bold text-gray-900 mb-3">Latest Vital Signs</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {CARD_VITALS.map(({ key, label, icon: Icon, color }) => {
                    const v = viewing.vitalsLatest[key];
                    return (
                      <div key={key} className="bg-gray-50 p-3 rounded border border-gray-200">
                        <p className="text-xs text-gray-600 font-semibold flex items-center gap-1"><Icon className={`w-3 h-3 ${color}`} />{label}</p>
                        <p className="text-xl font-bold text-gray-900 mt-1">{v ? v.value : "—"}</p>
                        <p className="text-xs text-gray-500">{v?.unit || ""} {v?.recordedAt ? `• ${relTime(v.recordedAt, nowTs)}` : ""}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
              {viewing.vitalsAll.length > 0 && (
                <div>
                  <h3 className="font-bold text-gray-900 mb-2">Recent Readings</h3>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {viewing.vitalsAll.slice(0, 8).map((v, i) => (
                      <div key={i} className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded">
                        <span className="text-gray-700">{humanize(v.type)}</span>
                        <span className="font-semibold text-gray-900">{v.value} {v.unit}</span>
                        <span className="text-xs text-gray-500">{relTime(v.recordedAt, nowTs)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-bold text-gray-900 mb-3">Medications ({viewing.meds.length})</h3>
                  <div className="space-y-2">
                    {viewing.meds.length ? viewing.meds.map((m, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 p-2 bg-blue-50 rounded border border-blue-200">
                        <span className="text-gray-900 text-sm">💊 {m.name} <span className="text-gray-500">{m.dosage}</span></span>
                        <span className="text-xs text-gray-600">{m.frequency}</span>
                      </div>
                    )) : <p className="text-sm text-gray-500">No active medications.</p>}
                  </div>
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 mb-3">Conditions</h3>
                  <div className="space-y-2">
                    {viewing.conditions.length ? viewing.conditions.map((c, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 bg-purple-50 rounded border border-purple-200">
                        <span className="text-purple-600">📋</span><span className="text-gray-900 text-sm">{c}</span>
                      </div>
                    )) : <p className="text-sm text-gray-500">None recorded.</p>}
                  </div>
                </div>
              </div>
              {viewing.incidents.length > 0 && (
                <div>
                  <h3 className="font-bold text-gray-900 mb-3">Recent Incidents</h3>
                  <div className="space-y-2">
                    {viewing.incidents.slice(0, 5).map((i, idx) => (
                      <div key={idx} className={`p-3 rounded-lg border ${i.resolved ? "bg-gray-50 border-gray-200" : "bg-red-50 border-red-200"}`}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-medium text-gray-900 text-sm">{i.type}</span>
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${SEVERITY_BADGE[i.severity]}`}>{i.severity.toUpperCase()}</span>
                        </div>
                        <p className="text-xs text-gray-600">{i.description}</p>
                        <p className="text-xs text-gray-400 mt-1">{i.date ? new Date(i.date).toLocaleString() : "—"} • {i.resolved ? "Resolved" : "Open"}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {viewing.notes && (
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded">
                  <h3 className="font-bold text-gray-900 mb-1">Care Notes</h3>
                  <p className="text-gray-900 text-sm">{viewing.notes}</p>
                </div>
              )}
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 sm:px-8 py-4 flex items-center justify-between">
              <button
                onClick={() => {
                  router.push(`/facility_admin/monitoring?resident=${encodeURIComponent(viewing.name)}&room=${encodeURIComponent(viewing.room)}`);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-400 to-blue-500 text-white font-semibold rounded-lg hover:shadow-lg transition active:scale-95"
              >
                <Camera className="w-4 h-4" /> View Monitoring
              </button>
              <button onClick={() => setViewing(null)} className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface AdmissionForm {
  firstName: string; lastName: string; dateOfBirth: string; gender: string;
  phone: string; email: string; roomNumber: string; careLevel: CareLevel;
  admissionDate: string; emergencyContact: string; emergencyContactPhone: string;
  medicalHistory: string; allergies: string; notes: string;
}

const EMPTY_FORM: AdmissionForm = {
  firstName: "", lastName: "", dateOfBirth: "", gender: "",
  phone: "", email: "", roomNumber: "", careLevel: "INDEPENDENT",
  admissionDate: new Date().toISOString().slice(0, 10),
  emergencyContact: "", emergencyContactPhone: "",
  medicalHistory: "", allergies: "", notes: "",
};

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none text-sm";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

function AdmitResidentModal({ takenRooms, onClose, onAdmitted }: {
  takenRooms: string[];
  onClose: () => void;
  onAdmitted: () => void;
}) {
  const [form, setForm] = useState<AdmissionForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof AdmissionForm) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const roomTaken = form.roomNumber.trim() !== "" &&
    takenRooms.some((r) => r.toLowerCase() === form.roomNumber.trim().toLowerCase());

  const valid = form.firstName.trim() && form.lastName.trim() &&
    form.roomNumber.trim() && form.admissionDate && !roomTaken;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await createRecord("residents", {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        dateOfBirth: form.dateOfBirth ? new Date(form.dateOfBirth).toISOString() : null,
        gender: form.gender || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        roomNumber: form.roomNumber.trim(),
        careLevel: form.careLevel,
        admissionDate: new Date(form.admissionDate).toISOString(),
        emergencyContact: form.emergencyContact.trim() || null,
        emergencyContactPhone: form.emergencyContactPhone.trim() || null,
        medicalHistory: form.medicalHistory.trim() || null,
        allergies: form.allergies.trim() || null,
        notes: form.notes.trim() || null,
      });
      setSaved(true);
      onAdmitted();
      setTimeout(onClose, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to admit resident");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black p-5 sm:p-6 flex items-center justify-between z-10">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
              <UserPlus className="w-6 h-6" /> Admit New Resident
            </h2>
            <p className="text-yellow-900/70 text-sm">Fill in the admission details below</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>

        {saved ? (
          <div className="p-10 flex flex-col items-center gap-3 text-center">
            <CheckCircle2 className="w-14 h-14 text-green-500" />
            <p className="text-lg font-bold text-gray-900">Resident admitted!</p>
            <p className="text-sm text-gray-600">{form.firstName} {form.lastName} has been added to Room {form.roomNumber}.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="p-6 sm:p-8 space-y-6">
            {error && (
              <div className="bg-red-50 border-l-4 border-red-400 p-3 rounded text-sm text-red-700 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
              </div>
            )}

            <div>
              <h3 className="font-bold text-gray-900 mb-3 text-sm uppercase tracking-wide">Personal Information</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="First Name" required>
                  <input type="text" value={form.firstName} onChange={set("firstName")} placeholder="Maria" className={inputCls} autoFocus />
                </Field>
                <Field label="Last Name" required>
                  <input type="text" value={form.lastName} onChange={set("lastName")} placeholder="Santos" className={inputCls} />
                </Field>
                <Field label="Date of Birth">
                  <input type="date" value={form.dateOfBirth} onChange={set("dateOfBirth")} max={new Date().toISOString().slice(0, 10)} className={inputCls} />
                </Field>
                <Field label="Gender">
                  <select value={form.gender} onChange={set("gender")} className={inputCls}>
                    <option value="">Not specified</option>
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Other">Other</option>
                  </select>
                </Field>
                <Field label="Phone">
                  <input type="tel" value={form.phone} onChange={set("phone")} placeholder="+63 917 000 0000" className={inputCls} />
                </Field>
                <Field label="Email">
                  <input type="email" value={form.email} onChange={set("email")} placeholder="resident@email.com" className={inputCls} />
                </Field>
              </div>
            </div>

            <div>
              <h3 className="font-bold text-gray-900 mb-3 text-sm uppercase tracking-wide">Admission Details</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Room Number" required>
                  <input type="text" value={form.roomNumber} onChange={set("roomNumber")} placeholder="204" className={`${inputCls} ${roomTaken ? "border-red-400 focus:ring-red-400" : ""}`} />
                  {roomTaken && <p className="text-xs text-red-600 mt-1">Room {form.roomNumber.trim()} is already occupied.</p>}
                </Field>
                <Field label="Care Level" required>
                  <select value={form.careLevel} onChange={set("careLevel")} className={inputCls}>
                    {CARE_ORDER.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
                  </select>
                </Field>
                <Field label="Admission Date" required>
                  <input type="date" value={form.admissionDate} onChange={set("admissionDate")} className={inputCls} />
                </Field>
              </div>
            </div>

            <div>
              <h3 className="font-bold text-gray-900 mb-3 text-sm uppercase tracking-wide">Emergency Contact</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Contact Name">
                  <input type="text" value={form.emergencyContact} onChange={set("emergencyContact")} placeholder="Juan Santos (Son)" className={inputCls} />
                </Field>
                <Field label="Contact Phone">
                  <input type="tel" value={form.emergencyContactPhone} onChange={set("emergencyContactPhone")} placeholder="+63 917 000 0000" className={inputCls} />
                </Field>
              </div>
            </div>

            <div>
              <h3 className="font-bold text-gray-900 mb-3 text-sm uppercase tracking-wide">Medical Information</h3>
              <div className="space-y-3">
                <Field label="Medical Conditions (comma-separated)">
                  <input type="text" value={form.medicalHistory} onChange={set("medicalHistory")} placeholder="Hypertension, Diabetes Type 2" className={inputCls} />
                </Field>
                <Field label="Allergies">
                  <input type="text" value={form.allergies} onChange={set("allergies")} placeholder="Penicillin, Shellfish" className={inputCls} />
                </Field>
                <Field label="Care Notes">
                  <textarea value={form.notes} onChange={set("notes")} rows={3} placeholder="Special care instructions, preferences, mobility needs…" className={`${inputCls} resize-none`} />
                </Field>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-200">
              <button type="button" onClick={onClose} className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium">Cancel</button>
              <button type="submit" disabled={!valid || saving} className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                {saving ? "Admitting…" : "Admit Resident"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const TONES: Record<string, { wrap: string; icon: string; value: string }> = {
  gray: { wrap: "bg-white border-gray-200", icon: "text-gray-500", value: "text-gray-900" },
  blue: { wrap: "bg-blue-50 border-blue-200", icon: "text-blue-500", value: "text-blue-600" },
  red: { wrap: "bg-red-50 border-red-200", icon: "text-red-500", value: "text-red-600" },
  green: { wrap: "bg-green-50 border-green-200", icon: "text-green-500", value: "text-green-600" },
  amber: { wrap: "bg-amber-50 border-amber-200", icon: "text-amber-500", value: "text-amber-600" },
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

function ChartCard({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`bg-white rounded-lg border border-gray-200 p-4 ${className ?? ""}`}>
      <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-yellow-500" /> {title}</h3>
      {children}
    </div>
  );
}
