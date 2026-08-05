"use client";

import RefreshButton from "@/components/portal/RefreshButton";

import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Users, Search, X, Heart, Droplets, Wind, Thermometer, AlertTriangle,
  Pill, Activity, Clock, RefreshCw, ListChecks, BarChart3, HeartPulse,
  Camera, ArrowUpRight, CheckCircle2, Phone, BellRing, QrCode,
  type LucideIcon,
} from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Legend, Tooltip, BarChart, Bar,
  XAxis, YAxis, CartesianGrid,
} from "recharts";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { updateRecord } from "@/lib/api";
import { adaptResident, humanize } from "@/lib/adapters";
import ResidentQRScanner from "@/components/ResidentQRScanner";
import ResidentQRModal from "@/components/ResidentQRModal";
import IntakeBodyCheckPanel from "@/components/portal/IntakeBodyCheckPanel";

/* ── Types ───────────────────────────────────────────────────────────── */

type CareLevel = "INDEPENDENT" | "ASSISTED" | "MEMORY" | "SKILLED";

interface VitalRow {
  id: string;
  type: string;
  value: string;
  unit: string;
  recordedAt: string | null;
  residentId: string | null;
  room: string | null;
}
interface MedVM { name: string; dosage: string; frequency: string; status: string }
interface IncidentVM { type: string; severity: string; date: string | null; resolved: boolean; description: string; location: string | null; immediateActions: string | null; witnesses: string | null; followUpRequired: boolean; followUpNotes: string | null }
interface CallBellVM { id: string; status: string; reason: string | null; notes: string | null; createdAt: string | null; respondedAt: string | null; resolvedAt: string | null }
interface ResidentVM {
  id: string;
  name: string;
  room: string;
  age: number | string;
  careLevel: CareLevel;
  alertsCount: number;
  allergies: string;
  conditions: string[];
  notes: string;
  meds: MedVM[];
  incidents: IncidentVM[];
  callBells: CallBellVM[];
  vitalsLatest: Record<string, { value: string; unit: string; recordedAt: string | null }>;
  vitalsAll: { type: string; value: string; unit: string; recordedAt: string | null }[];
  lastCheckIn: string | null;
}

/* ── Static metadata ─────────────────────────────────────────────────── */

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

/* ── Helpers ─────────────────────────────────────────────────────────── */

const asStr = (v: unknown): string => (v == null ? "" : String(v));
const severityTier = (s: string): "critical" | "high" | "medium" | "low" =>
  s === "CRITICAL" ? "critical" : s === "SEVERE" ? "high" : s === "MODERATE" ? "medium" : "low";

function relTime(iso: string | null, nowTs: number): string {
  if (!iso || !nowTs) return "—";
  const m = Math.round((nowTs - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m ago` : `${h}h ago`;
  return h % 24 ? `${Math.floor(h / 24)}d ${h % 24}h ago` : `${Math.floor(h / 24)}d ago`;
}
const newer = (a: string | null, b: string | null) =>
  !b ? true : !a ? false : new Date(a).getTime() > new Date(b).getTime();

/* ── Component ───────────────────────────────────────────────────────── */

export default function CaregiverResidents() {
  const { data: residentRows, loading, error, refetch } = useLiveQuery<Record<string, unknown>>(
    "residents",
    { query: "include=incidents,medications&take=300", tables: ["Resident", "Incident", "Medication"] }
  );
  const { data: vitalRows, refetch: refetchVitals } = useLiveQuery<Record<string, unknown>>(
    "vitals",
    { query: "include=resident&take=500", tables: ["VitalsLog"] }
  );
  const { data: callBellRows, refetch: refetchCallBells } = useLiveQuery<Record<string, unknown>>(
    "call-bells",
    { query: "include=resident&take=300", tables: ["CallBell"] }
  );

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
  const [perPage, setPerPage] = useState(25);
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState<ResidentVM | null>(null);
  const [bellsViewing, setBellsViewing] = useState<ResidentVM | null>(null);
  const [qrResident, setQrResident] = useState<{ id: string; name: string; room: string } | null>(null);

  // Index EAV vitals by residentId AND room (demo links by room, DB by id).
  const vitalIndex = useMemo(() => {
    const byId = new Map<string, VitalRow[]>();
    const byRoom = new Map<string, VitalRow[]>();
    const push = (m: Map<string, VitalRow[]>, k: string, v: VitalRow) => {
      const arr = m.get(k); if (arr) arr.push(v); else m.set(k, [v]);
    };
    vitalRows.forEach((row) => {
      const res = row.resident as { roomNumber?: string } | undefined;
      const v: VitalRow = {
        id: String(row.id),
        type: asStr(row.type),
        value: asStr(row.value),
        unit: asStr(row.unit),
        recordedAt: row.recordedAt ? String(row.recordedAt) : null,
        residentId: row.residentId ? String(row.residentId) : null,
        room: res?.roomNumber ?? null,
      };
      if (v.residentId) push(byId, v.residentId, v);
      if (v.room) push(byRoom, v.room, v);
    });
    return { byId, byRoom };
  }, [vitalRows]);

  const callBellIndex = useMemo(() => {
    const byId = new Map<string, CallBellVM[]>();
    callBellRows.forEach((row) => {
      const rid = row.residentId ? String(row.residentId) : null;
      if (!rid) return;
      const bell: CallBellVM = {
        id: String(row.id),
        status: asStr(row.status),
        reason: row.reason ? String(row.reason) : null,
        notes: row.notes ? String(row.notes) : null,
        createdAt: row.createdAt ? String(row.createdAt) : null,
        respondedAt: row.respondedAt ? String(row.respondedAt) : null,
        resolvedAt: row.resolvedAt ? String(row.resolvedAt) : null,
      };
      const arr = byId.get(rid);
      if (arr) arr.push(bell); else byId.set(rid, [bell]);
    });
    return byId;
  }, [callBellRows]);

  const residents = useMemo<ResidentVM[]>(() => {
    return residentRows.map((row) => {
      const r = adaptResident(row);
      const rawMeds = (r.raw?.medications ?? []) as Array<Record<string, unknown>>;
      const rawIncidents = (r.raw?.incidents ?? []) as Array<Record<string, unknown>>;

      // Merge this resident's vitals from both indexes, de-duplicated by id.
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
        id: r.id,
        name: r.name,
        room: r.room,
        age: r.age ?? "—",
        careLevel: r.careLevel,
        alertsCount: r.alertsCount,
        allergies: r.allergies || "",
        conditions: r.medicalHistory ? r.medicalHistory.split(",").map((c) => c.trim()).filter(Boolean) : [],
        notes: r.notes || "",
        meds: rawMeds.map((m) => ({
          name: asStr(m.name), dosage: asStr(m.dosage), frequency: asStr(m.frequency), status: asStr(m.status) || "ACTIVE",
        })),
        incidents: rawIncidents.map((i) => ({
          type: humanize(asStr(i.incidentType)) || "Incident",
          severity: severityTier(asStr(i.severity)),
          date: i.incidentDate ? String(i.incidentDate) : null,
          resolved: Boolean(i.resolvedAt),
          description: asStr(i.description),
          location: i.location ? String(i.location) : null,
          immediateActions: i.immediateActions ? String(i.immediateActions) : null,
          witnesses: i.witnesses ? String(i.witnesses) : null,
          followUpRequired: Boolean(i.followUpRequired),
          followUpNotes: i.followUpNotes ? String(i.followUpNotes) : null,
        })),
        callBells: callBellIndex.get(r.id) ?? [],
        vitalsLatest,
        vitalsAll: vrows
          .filter((v) => v.recordedAt)
          .sort((a, b) => new Date(b.recordedAt as string).getTime() - new Date(a.recordedAt as string).getTime())
          .map((v) => ({ type: v.type, value: v.value, unit: v.unit, recordedAt: v.recordedAt })),
        lastCheckIn,
      };
    });
  }, [residentRows, vitalIndex, callBellIndex]);

  const stats = useMemo(() => {
    const withAlerts = residents.filter((r) => r.alertsCount > 0).length;
    const onMeds = residents.filter((r) => r.meds.some((m) => m.status === "ACTIVE")).length;
    const ages = residents.map((r) => (typeof r.age === "number" ? r.age : NaN)).filter((n) => !isNaN(n));
    const avgAge = ages.length ? Math.round(ages.reduce((s, n) => s + n, 0) / ages.length) : 0;
    const checkedToday = residents.filter((r) => r.lastCheckIn && nowTs && (nowTs - new Date(r.lastCheckIn).getTime() < 86_400_000)).length;
    return { total: residents.length, withAlerts, onMeds, avgAge, checkedToday };
  }, [residents, nowTs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = residents.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q) && !r.room.toLowerCase().includes(q)) return false;
      if (careFilter !== "all" && r.careLevel !== careFilter) return false;
      if (alertsOnly && r.alertsCount === 0) return false;
      return true;
    });
    return list.sort((a, b) =>
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

  const refreshAll = () => { void refetch(); void refetchVitals(); };
  const vital = (r: ResidentVM, key: string) => {
    const v = r.vitalsLatest[key];
    return v ? `${v.value}${v.unit ? ` ${v.unit}` : ""}` : "—";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-1 flex items-center gap-2">
            <Users className="w-7 h-7 text-yellow-500 flex-shrink-0" /> Resident Status
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-green-600">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live
            </span>
            Health status &amp; care monitoring
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
            <button onClick={() => setView("list")} className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition ${view === "list" ? "bg-yellow-400 text-black" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
              <ListChecks className="w-4 h-4" /> Residents
            </button>
            <button onClick={() => setView("analytics")} className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition border-l border-gray-300 ${view === "analytics" ? "bg-yellow-400 text-black" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
              <BarChart3 className="w-4 h-4" /> Analytics
            </button>
          </div>
          <ResidentQRScanner />
          <RefreshButton onRefresh={refreshAll} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium" />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        <Stat label="Total Residents" value={stats.total} icon={Users} tone="gray" />
        <Stat label="With Alerts" value={stats.withAlerts} icon={AlertTriangle} tone="red" />
        <Stat label="On Medications" value={stats.onMeds} icon={Pill} tone="blue" />
        <Stat label="Checked (24h)" value={stats.checkedToday} icon={HeartPulse} tone="green" />
        <Stat label="Avg Age" value={stats.avgAge} icon={Activity} tone="amber" />
      </div>

      {view === "analytics" && <ResidentsAnalytics residents={residents} />}

      {view === "list" && (
        <>
          {/* Filters */}
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
            <div className="bg-white rounded-lg border border-red-200 p-10 text-center text-red-600">Failed to load residents: {error}</div>
          ) : paginated.length > 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[900px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-4 py-3 text-left font-semibold text-gray-600">Resident</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600">Room</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600">Age</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600">Care Level</th>
                      <th className="px-4 py-3 text-center font-semibold text-gray-600">HR</th>
                      <th className="px-4 py-3 text-center font-semibold text-gray-600">BP</th>
                      <th className="px-4 py-3 text-center font-semibold text-gray-600">Temp</th>
                      <th className="px-4 py-3 text-center font-semibold text-gray-600">O₂</th>
                      <th className="px-4 py-3 text-center font-semibold text-gray-600">Alerts</th>
                      <th className="px-4 py-3 text-center font-semibold text-gray-600">Meds</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600">Last Check-in</th>
                      <th className="px-4 py-3 text-right font-semibold text-gray-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {paginated.map((r) => (
                      <tr key={r.id} className={`hover:bg-gray-50 transition ${r.alertsCount > 0 ? "bg-red-50/50" : ""}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {r.alertsCount > 0 && <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />}
                            <span className="font-medium text-gray-900 truncate">{r.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{r.room}</td>
                        <td className="px-4 py-3 text-gray-700">{r.age}</td>
                        <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-semibold ${CARE_BADGE[r.careLevel]}`}>{humanize(r.careLevel)}</span></td>
                        <td className="px-4 py-3 text-center text-gray-700">{vital(r, "HEART_RATE")}</td>
                        <td className="px-4 py-3 text-center text-gray-700">{vital(r, "BLOOD_PRESSURE")}</td>
                        <td className="px-4 py-3 text-center text-gray-700">{vital(r, "TEMPERATURE")}</td>
                        <td className="px-4 py-3 text-center text-gray-700">{vital(r, "OXYGEN")}</td>
                        <td className="px-4 py-3 text-center">
                          {r.alertsCount > 0 ? <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-bold">{r.alertsCount}</span> : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center text-gray-700">{r.meds.length}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{relTime(r.lastCheckIn, nowTs)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {(() => {
                              const active = r.callBells.filter((cb) => cb.status !== "RESOLVED" && cb.status !== "CANCELLED").length;
                              return r.callBells.length > 0 ? (
                                <button
                                  onClick={() => setBellsViewing(r)}
                                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition ${active > 0 ? "bg-orange-500 text-white hover:bg-orange-600" : "bg-orange-50 text-orange-700 hover:bg-orange-100 border border-orange-200"}`}
                                  title="Call bells"
                                >
                                  <BellRing className="w-3.5 h-3.5" /> Bells{active > 0 ? ` (${active})` : ""}
                                </button>
                              ) : null;
                            })()}
                            <button onClick={() => setViewing(r)} className="px-3 py-1 bg-blue-500 text-white rounded-lg text-xs font-semibold hover:bg-blue-600 transition">View</button>
                            <button onClick={() => setQrResident({ id: r.id, name: r.name, room: r.room })} title="Show QR care card" className="px-2 py-1 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 transition inline-flex items-center gap-1"><QrCode className="w-3.5 h-3.5" /> QR</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">No residents match your filters.</div>
          )}

          {/* Pagination */}
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

      {/* Detail modal */}
      {viewing && <ResidentModal r={viewing} nowTs={nowTs} onClose={() => setViewing(null)} />}

      {/* Call Bells modal */}
      {bellsViewing && <CallBellsModal r={bellsViewing} onClose={() => setBellsViewing(null)} refetchCallBells={refetchCallBells} />}
      <ResidentQRModal open={!!qrResident} onClose={() => setQrResident(null)} residentId={qrResident?.id ?? ""} name={qrResident?.name ?? ""} room={qrResident?.room} />
    </div>
  );
}

/* ── Call Bells modal — respond / resolve, mirrors the nurse Residents view ── */

function CallBellsModal({ r, onClose, refetchCallBells }: { r: ResidentVM; onClose: () => void; refetchCallBells: () => void }) {
  const handleRespond = async (bellId: string) => {
    try {
      await updateRecord("call-bells", bellId, { status: "RESPONDED", respondedAt: new Date().toISOString() });
      refetchCallBells();
      Swal.fire({ title: "Responded", text: "Call bell marked as responded", icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Error", text: err instanceof Error ? err.message : "Failed to respond", icon: "error" });
    }
  };

  const handleResolve = async (bellId: string) => {
    const result = await Swal.fire({
      title: "Resolve Call Bell?",
      input: "textarea",
      inputLabel: "Resolution notes",
      inputPlaceholder: "What was done...",
      showCancelButton: true,
      confirmButtonColor: "#10b981",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Resolve",
    });
    if (result.isConfirmed) {
      try {
        await updateRecord("call-bells", bellId, { status: "RESOLVED", resolvedAt: new Date().toISOString(), notes: result.value || "Resolved" });
        refetchCallBells();
        Swal.fire({ title: "Resolved", text: "Call bell marked as resolved", icon: "success", timer: 1500, showConfirmButton: false });
      } catch (err) {
        Swal.fire({ title: "Error", text: err instanceof Error ? err.message : "Failed to resolve", icon: "error" });
      }
    }
  };

  const bellStyle = (s: string) => (s === "PENDING" ? "bg-red-50 border-red-200" : s === "RESPONDED" ? "bg-yellow-50 border-yellow-200" : "bg-green-50 border-green-200");
  const pillStyle = (s: string) => (s === "PENDING" ? "bg-red-200 text-red-800" : s === "RESPONDED" ? "bg-yellow-200 text-yellow-800" : "bg-green-200 text-green-800");

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-orange-400 to-orange-500 text-white p-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Call Bells</h2>
            <p className="text-orange-100">{r.name} • Room {r.room}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-orange-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>

        <div className="p-6 space-y-4">
          {r.callBells.length > 0 ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <div className="bg-red-50 border border-red-200 rounded-lg p-4"><p className="text-xs text-red-700 font-semibold">PENDING</p><p className="text-2xl font-bold text-red-600 mt-1">{r.callBells.filter((cb) => cb.status === "PENDING").length}</p></div>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4"><p className="text-xs text-yellow-700 font-semibold">RESPONDING</p><p className="text-2xl font-bold text-yellow-600 mt-1">{r.callBells.filter((cb) => cb.status === "RESPONDED").length}</p></div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-4"><p className="text-xs text-green-700 font-semibold">RESOLVED</p><p className="text-2xl font-bold text-green-600 mt-1">{r.callBells.filter((cb) => cb.status === "RESOLVED").length}</p></div>
              </div>
              <div className="space-y-3">
                {r.callBells.map((bell) => (
                  <div key={bell.id} className={`p-4 rounded-lg border ${bellStyle(bell.status)}`}>
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <h3 className="font-bold text-gray-900">{bell.reason || "Call bell"}</h3>
                        {bell.createdAt && (
                          // eslint-disable-next-line react-hooks/purity
                          <p className="text-xs text-gray-600 mt-1">{relTime(bell.createdAt, Date.now())}</p>
                        )}
                      </div>
                      <span className={`px-2 py-1 rounded text-xs font-semibold whitespace-nowrap ${pillStyle(bell.status)}`}>{bell.status}</span>
                    </div>
                    {bell.notes && <p className="text-xs text-gray-700 p-2 bg-white/50 rounded border border-gray-200 mb-3">📝 {bell.notes}</p>}
                    {bell.status !== "RESOLVED" && bell.status !== "CANCELLED" && (
                      <div className="flex gap-2 mt-3">
                        {bell.status === "PENDING" && (
                          <button onClick={() => void handleRespond(bell.id)} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold rounded text-sm transition"><Clock className="w-4 h-4" /> Respond</button>
                        )}
                        <button onClick={() => void handleResolve(bell.id)} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-green-500 hover:bg-green-600 text-white font-semibold rounded text-sm transition"><CheckCircle2 className="w-4 h-4" /> Resolve</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <Phone className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-lg font-medium">No call bells</p>
              <p className="text-sm">This resident has no active call bells</p>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end">
          <button onClick={onClose} className="px-6 py-2 bg-gray-700 hover:bg-gray-800 text-white font-semibold rounded-lg transition">Close</button>
        </div>
      </div>
    </div>
  );
}

/* ── Detail modal ────────────────────────────────────────────────────── */

function ResidentModal({ r, nowTs, onClose }: { r: ResidentVM; nowTs: number; onClose: () => void }) {
  const router = useRouter();

  // Only surface open incidents in the profile — resolved ones drop off.
  const openIncidents = r.incidents.filter((i) => !i.resolved);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-blue-400 to-blue-500 text-white p-5 sm:p-6 flex items-center justify-between z-10">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold">{r.name}</h2>
            <p className="text-blue-100 text-sm">Room {r.room} • Age {r.age} • {humanize(r.careLevel)}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-blue-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>

        <div className="p-6 sm:p-8 space-y-6">
          {/* Patient ID + intake / move-in body-check record */}
          <IntakeBodyCheckPanel residentId={r.id} />

          {r.allergies && (
            <div className="bg-red-50 border-l-4 border-red-400 p-3 rounded">
              <p className="text-sm font-semibold text-red-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Allergies</p>
              <p className="text-gray-900 text-sm mt-1">{r.allergies}</p>
            </div>
          )}

          <div>
            <h3 className="font-bold text-gray-900 mb-3">Latest Vital Signs</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {CARD_VITALS.map(({ key, label, icon: Icon, color }) => {
                const v = r.vitalsLatest[key];
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

          {r.vitalsAll.length > 0 && (
            <div>
              <h3 className="font-bold text-gray-900 mb-2">Recent Readings</h3>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {r.vitalsAll.slice(0, 8).map((v, i) => (
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
              <h3 className="font-bold text-gray-900 mb-3">Medications ({r.meds.length})</h3>
              <div className="space-y-2">
                {r.meds.length ? r.meds.map((m, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 p-2 bg-blue-50 rounded border border-blue-200">
                    <span className="text-gray-900 text-sm">{m.name} <span className="text-gray-500">{m.dosage}</span></span>
                    <span className="text-xs text-gray-600">{m.frequency}</span>
                  </div>
                )) : <p className="text-sm text-gray-500">No active medications.</p>}
              </div>
            </div>
            <div>
              <h3 className="font-bold text-gray-900 mb-3">Conditions</h3>
              <div className="space-y-2">
                {r.conditions.length ? r.conditions.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 bg-purple-50 rounded border border-purple-200">
                    <span className="text-purple-600">*</span><span className="text-gray-900 text-sm">{c}</span>
                  </div>
                )) : <p className="text-sm text-gray-500">None recorded.</p>}
              </div>
            </div>
          </div>

          {openIncidents.length > 0 && (
            <div>
              <h3 className="font-bold text-gray-900 mb-3">Recent Incidents</h3>
              <div className="space-y-2">
                {openIncidents.slice(0, 5).map((i, idx) => (
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

          {r.notes && (
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded">
              <h3 className="font-bold text-gray-900 mb-1">Care Notes</h3>
              <p className="text-gray-900 text-sm">{r.notes}</p>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 sm:px-8 py-4 flex items-center justify-between">
          <button
            onClick={() => {
              onClose();
              router.push(`/caregiver/monitoring?resident=${encodeURIComponent(r.name)}&room=${encodeURIComponent(r.room)}&residentId=${encodeURIComponent(r.id)}`);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-semibold rounded-lg hover:shadow-lg transition active:scale-95"
          >
            <Camera className="w-4 h-4" /> Camera Monitoring
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
          <button onClick={onClose} className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Close</button>
        </div>
      </div>
    </div>
  );
}

/* ── Analytics ───────────────────────────────────────────────────────── */

function ResidentsAnalytics({ residents }: { residents: ResidentVM[] }) {
  const a = useMemo(() => {
    const byCare = CARE_ORDER.map((c) => ({ name: humanize(c), value: residents.filter((r) => r.careLevel === c).length })).filter((d) => d.value > 0);
    const alertsByCare = CARE_ORDER.map((c) => ({
      name: humanize(c),
      Alerts: residents.filter((r) => r.careLevel === c).reduce((s, r) => s + r.alertsCount, 0),
    }));
    const vitalsCoverage = CARD_VITALS.map((cv) => ({
      name: cv.label,
      Residents: residents.filter((r) => r.vitalsLatest[cv.key]).length,
    }));
    return { byCare, alertsByCare, vitalsCoverage };
  }, [residents]);

  if (residents.length === 0) {
    return <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">No resident data to analyze.</div>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartCard title="Care Level Distribution">
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={a.byCare} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
              {a.byCare.map((_, i) => <Cell key={i} fill={CARE_COLORS[i % CARE_COLORS.length]} />)}
            </Pie>
            <Tooltip /><Legend />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Open Alerts by Care Level">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={a.alertsByCare} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={28} />
            <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <Bar dataKey="Alerts" fill="#ef4444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Vitals Recorded — Coverage" className="lg:col-span-2">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={a.vitalsCoverage} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={28} />
            <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <Bar dataKey="Residents" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────────────── */

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
