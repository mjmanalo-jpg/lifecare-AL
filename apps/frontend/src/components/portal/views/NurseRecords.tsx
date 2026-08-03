"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Users, Search, X, AlertTriangle, Pill, HeartPulse, Activity, RefreshCw,
  ListChecks, BarChart3, Trash2, Pencil, Heart, Droplets, Wind, Thermometer,
  Camera, Clock, Phone, CheckCircle2, QrCode, type LucideIcon,
} from "lucide-react";
import Swal from "@/lib/swal";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Legend, Tooltip, BarChart, Bar,
  XAxis, YAxis, CartesianGrid,
} from "recharts";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident, humanize } from "@/lib/adapters";
import { updateRecord, deleteRecord } from "@/lib/api";
import ResidentQRScanner from "@/components/ResidentQRScanner";
import ResidentQRModal from "@/components/ResidentQRModal";

/* ── Types ───────────────────────────────────────────────────────────── */

type CareLevel = "INDEPENDENT" | "ASSISTED" | "MEMORY" | "SKILLED";

interface VitalRow { id: string; type: string; value: string; unit: string; recordedAt: string | null; residentId: string | null; room: string | null }
interface MedVM { name: string; dosage: string; frequency: string; status: string }
interface IncidentVM { type: string; severity: string; date: string | null; resolved: boolean; description: string }
interface CallBellVM { id: string; status: "PENDING" | "RESPONDED" | "RESOLVED" | "CANCELLED"; reason: string; createdAt: string; respondedAt?: string; resolvedAt?: string; notes?: string }
interface RecordVM {
  id: string;
  name: string;
  room: string;
  age: number | string;
  careLevel: CareLevel;
  alertsCount: number;
  allergies: string;
  medicalHistory: string;
  conditions: string[];
  notes: string;
  meds: MedVM[];
  incidents: IncidentVM[];
  callBells: CallBellVM[];
  vitalsLatest: Record<string, { value: string; unit: string; recordedAt: string | null }>;
  lastCheckIn: string | null;
}
interface EditForm { name: string; room: string; careLevel: CareLevel; allergies: string; medicalHistory: string; notes: string }

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

/* ── Component ───────────────────────────────────────────────────────── */

export default function NurseRecords() {
  const { data: residentRows, loading, error, refetch } = useLiveQuery<Record<string, unknown>>(
    "residents", { query: "include=incidents,medications&take=300", tables: ["Resident", "Incident", "Medication"] }
  );
  const { data: vitalRows, refetch: refetchVitals } = useLiveQuery<Record<string, unknown>>(
    "vitals", { query: "include=resident&take=500", tables: ["VitalsLog"] }
  );
  const { data: callBellRows, refetch: refetchCallBells } = useLiveQuery<Record<string, unknown>>(
    "call-bells", { query: "take=300", tables: ["CallBell"] }
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
  const [sort, setSort] = useState<"name" | "room" | "alerts">("name");
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [perPage, setPerPage] = useState(25);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<RecordVM | null>(null);
  const [editing, setEditing] = useState<RecordVM | null>(null);
  const [bellsViewing, setBellsViewing] = useState<RecordVM | null>(null);
  const [qrResident, setQrResident] = useState<{ id: string; name: string; room: string } | null>(null);
  const [form, setForm] = useState<EditForm>({ name: "", room: "", careLevel: "INDEPENDENT", allergies: "", medicalHistory: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const vitalIndex = useMemo(() => {
    const byId = new Map<string, VitalRow[]>();
    const byRoom = new Map<string, VitalRow[]>();
    const push = (m: Map<string, VitalRow[]>, k: string, v: VitalRow) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
    vitalRows.forEach((row) => {
      const res = row.resident as { roomNumber?: string } | undefined;
      const v: VitalRow = {
        id: String(row.id), type: asStr(row.type), value: asStr(row.value), unit: asStr(row.unit),
        recordedAt: row.recordedAt ? String(row.recordedAt) : null,
        residentId: row.residentId ? String(row.residentId) : null, room: res?.roomNumber ?? null,
      };
      if (v.residentId) push(byId, v.residentId, v);
      if (v.room) push(byRoom, v.room, v);
    });
    return { byId, byRoom };
  }, [vitalRows]);

  const records = useMemo<RecordVM[]>(() => residentRows.map((row) => {
    const r = adaptResident(row);
    const rawMeds = (r.raw?.medications ?? []) as Array<Record<string, unknown>>;
    const rawIncidents = (r.raw?.incidents ?? []) as Array<Record<string, unknown>>;
    const merged = new Map<string, VitalRow>();
    [...(vitalIndex.byId.get(r.id) ?? []), ...(vitalIndex.byRoom.get(r.room) ?? [])].forEach((v) => merged.set(v.id, v));
    const vitalsLatest: RecordVM["vitalsLatest"] = {};
    let lastCheckIn: string | null = null;
    merged.forEach((v) => {
      const cur = vitalsLatest[v.type];
      if (!cur || newer(v.recordedAt, cur.recordedAt)) vitalsLatest[v.type] = { value: v.value, unit: v.unit, recordedAt: v.recordedAt };
      if (newer(v.recordedAt, lastCheckIn)) lastCheckIn = v.recordedAt;
    });
    const residentCallBells = callBellRows.filter((cb: Record<string, unknown>) => cb.residentId === r.id);
    const callBells: CallBellVM[] = residentCallBells.map((cb) => ({
      id: String(cb.id),
      status: String(cb.status) as CallBellVM["status"],
      reason: String(cb.reason || ""),
      createdAt: String(cb.createdAt || ""),
      respondedAt: cb.respondedAt ? String(cb.respondedAt) : undefined,
      resolvedAt: cb.resolvedAt ? String(cb.resolvedAt) : undefined,
      notes: cb.notes ? String(cb.notes) : undefined,
    }));
    return {
      id: r.id, name: r.name, room: r.room, age: r.age ?? "—", careLevel: r.careLevel, alertsCount: r.alertsCount,
      allergies: r.allergies || "", medicalHistory: r.medicalHistory || "",
      conditions: r.medicalHistory ? r.medicalHistory.split(",").map((c) => c.trim()).filter(Boolean) : [],
      notes: r.notes || "",
      meds: rawMeds.map((m) => ({ name: asStr(m.name), dosage: asStr(m.dosage), frequency: asStr(m.frequency), status: asStr(m.status) || "ACTIVE" })),
      incidents: rawIncidents.map((i) => ({
        type: humanize(asStr(i.incidentType)) || "Incident", severity: severityTier(asStr(i.severity)),
        date: i.incidentDate ? String(i.incidentDate) : null, resolved: Boolean(i.resolvedAt), description: asStr(i.description),
      })),
      callBells,
      vitalsLatest, lastCheckIn,
    };
  }), [residentRows, vitalIndex, callBellRows]);

  const stats = useMemo(() => ({
    total: records.length,
    withAlerts: records.filter((r) => r.alertsCount > 0).length,
    onMeds: records.filter((r) => r.meds.some((m) => m.status === "ACTIVE")).length,
    skilled: records.filter((r) => r.careLevel === "SKILLED" || r.careLevel === "MEMORY").length,
    checked: records.filter((r) => r.lastCheckIn && nowTs && nowTs - new Date(r.lastCheckIn).getTime() < 86_400_000).length,
  }), [records, nowTs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q) && !r.room.toLowerCase().includes(q)) return false;
      if (careFilter !== "all" && r.careLevel !== careFilter) return false;
      if (alertsOnly && r.alertsCount === 0) return false;
      return true;
    }).sort((a, b) =>
      sort === "alerts" ? b.alertsCount - a.alertsCount
        : sort === "room" ? a.room.localeCompare(b.room, undefined, { numeric: true })
          : a.name.localeCompare(b.name)
    );
  }, [records, search, careFilter, alertsOnly, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const start = (page - 1) * perPage;
  const paginated = filtered.slice(start, start + perPage);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset paging on filter change
    setPage(1);
  }, [search, careFilter, alertsOnly, sort, perPage]);

  const vital = (r: RecordVM, key: string) => {
    const v = r.vitalsLatest[key];
    return v ? `${v.value}${v.unit ? ` ${v.unit}` : ""}` : "—";
  };

  const pageAllSelected = paginated.length > 0 && paginated.every((r) => selected.has(r.id));
  const toggleAll = () => {
    const next = new Set(selected);
    if (pageAllSelected) paginated.forEach((r) => next.delete(r.id));
    else paginated.forEach((r) => next.add(r.id));
    setSelected(next);
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    const res = await Swal.fire({
      title: "Delete Selected Records?", text: `Permanently delete ${selected.size} resident record(s)?`,
      icon: "warning", showCancelButton: true, confirmButtonColor: "#dc2626", cancelButtonColor: "#6b7280", confirmButtonText: "Delete",
    });
    if (!res.isConfirmed) return;
    const ids = Array.from(selected);
    try {
      await Promise.all(ids.map((id) => deleteRecord("residents", id)));
      setSelected(new Set());
      await refetch();
      Swal.fire({ title: "Deleted", text: `${ids.length} record(s) removed.`, icon: "success", timer: 1400, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Delete Failed", text: err instanceof Error ? err.message : "Could not delete records.", icon: "error" });
    }
  };

  const openEdit = (r: RecordVM) => {
    setForm({ name: r.name, room: r.room, careLevel: r.careLevel, allergies: r.allergies, medicalHistory: r.medicalHistory, notes: r.notes });
    setEditing(r);
    setViewing(null);
  };
  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    const trimmed = form.name.trim();
    const sp = trimmed.indexOf(" ");
    try {
      await updateRecord("residents", editing.id, {
        firstName: sp === -1 ? trimmed : trimmed.slice(0, sp),
        lastName: sp === -1 ? "" : trimmed.slice(sp + 1),
        roomNumber: form.room,
        careLevel: form.careLevel,
        allergies: form.allergies,
        medicalHistory: form.medicalHistory,
        notes: form.notes,
      });
      await refetch();
      setEditing(null);
      Swal.fire({ title: "Saved", icon: "success", timer: 1300, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Update Failed", text: err instanceof Error ? err.message : "Could not update record.", icon: "error" });
    } finally {
      setSaving(false);
    }
  };

  const refreshAll = () => { void refetch(); void refetchVitals(); void refetchCallBells(); };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-1 flex items-center gap-2">
            <Users className="w-7 h-7 text-yellow-500 flex-shrink-0" /> Resident Records
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live</span>
            Full clinical records &amp; management
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selected.size > 0 && (
            <button onClick={() => void bulkDelete()} className="flex items-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition text-sm font-medium">
              <Trash2 className="w-4 h-4" /> Delete ({selected.size})
            </button>
          )}
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden bg-white">
            <button onClick={() => setView("list")} className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition ${view === "list" ? "bg-yellow-400 text-black" : "text-gray-700 hover:bg-gray-50"}`}><ListChecks className="w-4 h-4" /> Records</button>
            <button onClick={() => setView("analytics")} className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition border-l border-gray-300 ${view === "analytics" ? "bg-yellow-400 text-black" : "text-gray-700 hover:bg-gray-50"}`}><BarChart3 className="w-4 h-4" /> Analytics</button>
          </div>
          <ResidentQRScanner />
          <button onClick={refreshAll} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        <Stat label="Total Records" value={stats.total} icon={Users} tone="gray" />
        <Stat label="With Alerts" value={stats.withAlerts} icon={AlertTriangle} tone="red" />
        <Stat label="On Medications" value={stats.onMeds} icon={Pill} tone="blue" />
        <Stat label="Checked (24h)" value={stats.checked} icon={HeartPulse} tone="green" />
        <Stat label="Skilled / Memory" value={stats.skilled} icon={Activity} tone="purple" />
      </div>

      {view === "analytics" && <RecordsAnalytics records={records} />}

      {view === "list" && (
        <>
          {/* Filters */}
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
              <input type="text" placeholder="Search by name or room…" value={search} onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none bg-white text-gray-900" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <select value={careFilter} onChange={(e) => setCareFilter(e.target.value as "all" | CareLevel)} className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-yellow-400 outline-none">
                <option value="all">All Care Levels</option>
                {CARE_ORDER.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
              </select>
              <select value={sort} onChange={(e) => setSort(e.target.value as "name" | "room" | "alerts")} className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-yellow-400 outline-none">
                <option value="name">Sort: Name</option>
                <option value="room">Sort: Room</option>
                <option value="alerts">Sort: Most Alerts</option>
              </select>
              <select value={perPage} onChange={(e) => setPerPage(parseInt(e.target.value))} className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-yellow-400 outline-none">
                <option value={9}>9 per page</option>
                <option value={18}>18 per page</option>
                <option value={36}>36 per page</option>
              </select>
              <label className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 bg-white select-none">
                <input type="checkbox" checked={alertsOnly} onChange={(e) => setAlertsOnly(e.target.checked)} className="w-4 h-4 rounded cursor-pointer" />
                <span className="text-sm text-gray-700 font-medium">Alerts only</span>
              </label>
            </div>
          </div>

          {/* Table */}
          {loading && records.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">Loading records…</div>
          ) : error ? (
            <div className="bg-white rounded-lg border border-red-200 p-10 text-center text-red-600">Failed to load: {error}</div>
          ) : paginated.length > 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[1000px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-4 py-3 text-left font-semibold text-gray-600 w-10">
                        <input type="checkbox" checked={pageAllSelected} onChange={toggleAll} className="w-4 h-4 rounded cursor-pointer" />
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600">Resident</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600">Room</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600">Care Level</th>
                      <th className="px-4 py-3 text-center font-semibold text-gray-600">HR</th>
                      <th className="px-4 py-3 text-center font-semibold text-gray-600">BP</th>
                      <th className="px-4 py-3 text-center font-semibold text-gray-600">Temp</th>
                      <th className="px-4 py-3 text-center font-semibold text-gray-600">O₂</th>
                      <th className="px-4 py-3 text-center font-semibold text-gray-600">Alerts</th>
                      <th className="px-4 py-3 text-center font-semibold text-gray-600">Call Bells</th>
                      <th className="px-4 py-3 text-center font-semibold text-gray-600">Meds</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600">Last Check-in</th>
                      <th className="px-4 py-3 text-right font-semibold text-gray-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {paginated.map((r) => {
                      const hasPendingBell = r.callBells.some(cb => cb.status === "PENDING");
                      return (
                        <tr key={r.id} className={`hover:bg-gray-50 transition ${r.alertsCount > 0 || hasPendingBell ? "bg-red-50/50" : ""}`}>
                          <td className="px-4 py-3">
                            <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} className="w-4 h-4 rounded cursor-pointer" />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {(r.alertsCount > 0 || hasPendingBell) && <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />}
                              <span className="font-medium text-gray-900 truncate">{r.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-700">{r.room}</td>
                          <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-semibold ${CARE_BADGE[r.careLevel]}`}>{humanize(r.careLevel)}</span></td>
                          <td className="px-4 py-3 text-center text-gray-700">{vital(r, "HEART_RATE")}</td>
                          <td className="px-4 py-3 text-center text-gray-700">{vital(r, "BLOOD_PRESSURE")}</td>
                          <td className="px-4 py-3 text-center text-gray-700">{vital(r, "TEMPERATURE")}</td>
                          <td className="px-4 py-3 text-center text-gray-700">{vital(r, "OXYGEN")}</td>
                          <td className="px-4 py-3 text-center">
                            {r.alertsCount > 0 ? <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-bold">{r.alertsCount}</span> : <span className="text-gray-400">—</span>}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {hasPendingBell ? <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-xs font-bold">{r.callBells.filter(cb => cb.status === "PENDING").length}</span> : <span className="text-gray-400">—</span>}
                          </td>
                          <td className="px-4 py-3 text-center text-gray-700">{r.meds.length}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{relTime(r.lastCheckIn, nowTs)}</td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {r.callBells.length > 0 && <button onClick={() => setBellsViewing(r)} className="px-2 py-1 bg-orange-500 text-white rounded text-xs font-semibold hover:bg-orange-600 transition">Bells</button>}
                              <button onClick={() => setViewing(r)} className="px-3 py-1 bg-blue-500 text-white rounded-lg text-xs font-semibold hover:bg-blue-600 transition">View</button>
                              <button onClick={() => setQrResident({ id: r.id, name: r.name, room: r.room })} title="Show QR care card" className="px-2 py-1 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 transition inline-flex items-center gap-1"><QrCode className="w-3.5 h-3.5" /> QR</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">No records match your filters.</div>
          )}

          {/* Pagination */}
          <div className="flex items-center justify-between gap-4 flex-wrap mt-6">
            <div className="text-sm text-gray-600">
              Showing {filtered.length ? start + 1 : 0}-{Math.min(start + perPage, filtered.length)} of {filtered.length}
              {selected.size > 0 && ` • ${selected.size} selected`}
            </div>
            {filtered.length > perPage && (
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium">Previous</button>
                <span className="px-3 py-2 text-sm font-medium text-gray-700">Page {page} / {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium">Next</button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Call Bells modal */}
      {bellsViewing && <CallBellsModal r={bellsViewing} onClose={() => setBellsViewing(null)} refetchCallBells={() => void refetchCallBells()} />}
      <ResidentQRModal open={!!qrResident} onClose={() => setQrResident(null)} residentId={qrResident?.id ?? ""} name={qrResident?.name ?? ""} room={qrResident?.room} />

      {/* View modal */}
      {viewing && <RecordModal r={viewing} nowTs={nowTs} onClose={() => setViewing(null)} onEdit={() => openEdit(viewing)} />}

      {/* Edit modal */}
      {editing && (
        <Modal title="Edit Record" onClose={() => setEditing(null)}>
          <div className="p-6 sm:p-8 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Full Name" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
              <Input label="Room Number" value={form.room} onChange={(v) => setForm((f) => ({ ...f, room: v }))} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Care Level</label>
              <select value={form.careLevel} onChange={(e) => setForm((f) => ({ ...f, careLevel: e.target.value as CareLevel }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-yellow-400 outline-none">
                {CARE_ORDER.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
              </select>
            </div>
            <Textarea label="Allergies" value={form.allergies} onChange={(v) => setForm((f) => ({ ...f, allergies: v }))} />
            <Textarea label="Chronic Conditions (comma-separated)" value={form.medicalHistory} onChange={(v) => setForm((f) => ({ ...f, medicalHistory: v }))} />
            <Textarea label="Care Notes" value={form.notes} onChange={(v) => setForm((f) => ({ ...f, notes: v }))} />
            <p className="text-xs text-gray-500">Medications are managed as separate clinical records and are not edited here.</p>
          </div>
          <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 sm:px-8 py-4 flex items-center justify-between">
            <button onClick={() => setEditing(null)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Cancel</button>
            <button onClick={() => void saveEdit()} disabled={saving} className="px-6 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-60">{saving ? "Saving…" : "Save Changes"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ── Call Bells modal ────────────────────────────────────────────────── */

function CallBellsModal({ r, onClose, refetchCallBells }: { r: RecordVM; onClose: () => void; refetchCallBells: () => void }) {
  const handleRespond = async (bellId: string) => {
    try {
      await updateRecord("call-bells", bellId, {
        status: "RESPONDED",
        respondedAt: new Date().toISOString(),
      });
      refetchCallBells();
      Swal.fire({
        title: "Responded",
        text: "Call bell marked as responded",
        icon: "success",
        timer: 1500,
        showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire({
        title: "Error",
        text: err instanceof Error ? err.message : "Failed to respond",
        icon: "error",
      });
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
        await updateRecord("call-bells", bellId, {
          status: "RESOLVED",
          resolvedAt: new Date().toISOString(),
          notes: result.value || "Resolved",
        });
        refetchCallBells();
        Swal.fire({
          title: "Resolved",
          text: "Call bell marked as resolved",
          icon: "success",
          timer: 1500,
          showConfirmButton: false,
        });
      } catch (err) {
        Swal.fire({
          title: "Error",
          text: err instanceof Error ? err.message : "Failed to resolve",
          icon: "error",
        });
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-orange-400 to-orange-500 text-white p-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Call Bells</h2>
            <p className="text-orange-100">{r.name} • Room {r.room}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-orange-600/20 rounded-lg transition">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {r.callBells.length > 0 ? (
            <>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-xs text-red-700 font-semibold">PENDING</p>
                  <p className="text-2xl font-bold text-red-600 mt-1">
                    {r.callBells.filter(cb => cb.status === "PENDING").length}
                  </p>
                </div>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <p className="text-xs text-yellow-700 font-semibold">RESPONDING</p>
                  <p className="text-2xl font-bold text-yellow-600 mt-1">
                    {r.callBells.filter(cb => cb.status === "RESPONDED").length}
                  </p>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-xs text-green-700 font-semibold">RESOLVED</p>
                  <p className="text-2xl font-bold text-green-600 mt-1">
                    {r.callBells.filter(cb => cb.status === "RESOLVED").length}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {r.callBells.map((bell) => (
                  <div
                    key={bell.id}
                    className={`p-4 rounded-lg border ${
                      bell.status === "PENDING"
                        ? "bg-red-50 border-red-200"
                        : bell.status === "RESPONDED"
                        ? "bg-yellow-50 border-yellow-200"
                        : "bg-green-50 border-green-200"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <h3 className="font-bold text-gray-900">{bell.reason}</h3>
                        <p className="text-xs text-gray-600 mt-1">
                          {/* eslint-disable-next-line react-hooks/purity */}
                          {Math.round((Date.now() - new Date(bell.createdAt).getTime()) / 60000)} min ago
                        </p>
                      </div>
                      <span
                        className={`px-2 py-1 rounded text-xs font-semibold whitespace-nowrap ${
                          bell.status === "PENDING"
                            ? "bg-red-200 text-red-800"
                            : bell.status === "RESPONDED"
                            ? "bg-yellow-200 text-yellow-800"
                            : "bg-green-200 text-green-800"
                        }`}
                      >
                        {bell.status}
                      </span>
                    </div>

                    {bell.notes && (
                      <p className="text-xs text-gray-700 p-2 bg-white/50 rounded border border-gray-200 mb-3">
                        📝 {bell.notes}
                      </p>
                    )}

                    {bell.status !== "RESOLVED" && bell.status !== "CANCELLED" && (
                      <div className="flex gap-2 mt-3">
                        {bell.status === "PENDING" && (
                          <button
                            onClick={() => void handleRespond(bell.id)}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold rounded text-sm transition"
                          >
                            <Clock className="w-4 h-4" /> Respond
                          </button>
                        )}
                        <button
                          onClick={() => void handleResolve(bell.id)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-green-500 hover:bg-green-600 text-white font-semibold rounded text-sm transition"
                        >
                          <CheckCircle2 className="w-4 h-4" /> Resolve
                        </button>
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
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-700 hover:bg-gray-800 text-white font-semibold rounded-lg transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Detail modal ────────────────────────────────────────────────────── */

function RecordModal({ r, nowTs, onClose, onEdit }: { r: RecordVM; nowTs: number; onClose: () => void; onEdit: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const basePrefix = pathname.split("/")[1] || "nurse";
  const [selectedBell, setSelectedBell] = useState<CallBellVM | null>(null);
  const [bellModalMode, setBellModalMode] = useState<"respond" | "resolve">("respond");

  const handleBellRespond = async (bellId: string) => {
    try {
      await updateRecord("call-bells", bellId, {
        status: "RESPONDED",
        respondedAt: new Date().toISOString(),
      });
      setSelectedBell(null);
      Swal.fire({
        title: "Responded",
        text: `Responded to call bell`,
        icon: "success",
        timer: 1500,
        showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire({
        title: "Error",
        text: err instanceof Error ? err.message : "Failed to respond",
        icon: "error",
      });
    }
  };

  const handleBellResolve = async (bellId: string, notes: string) => {
    try {
      await updateRecord("call-bells", bellId, {
        status: "RESOLVED",
        resolvedAt: new Date().toISOString(),
        notes: notes || "Resolved",
      });
      setSelectedBell(null);
      Swal.fire({
        title: "Resolved",
        text: `Call bell marked as resolved`,
        icon: "success",
        timer: 1500,
        showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire({
        title: "Error",
        text: err instanceof Error ? err.message : "Failed to resolve",
        icon: "error",
      });
    }
  };

  // Resident profile only surfaces what still needs attention: active call bells
  // (not resolved/cancelled) and open incidents. Once a bell is resolved or an
  // incident is closed it drops off this view.
  const activeBells = r.callBells.filter((cb) => cb.status !== "RESOLVED" && cb.status !== "CANCELLED");
  const openIncidents = r.incidents.filter((i) => !i.resolved);

  return (
    <>
    <Modal title={r.name} subtitle={`Room ${r.room} • Age ${r.age} • ${humanize(r.careLevel)}`} onClose={onClose}>
      <div className="p-6 sm:p-8 space-y-6">
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-bold text-gray-900 mb-3">Medications ({r.meds.length})</h3>
            <div className="space-y-2">
              {r.meds.length ? r.meds.map((m, i) => (
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
              {r.conditions.length ? r.conditions.map((c, i) => (
                <div key={i} className="flex items-center gap-2 p-2 bg-purple-50 rounded border border-purple-200"><span className="text-purple-600">📋</span><span className="text-gray-900 text-sm">{c}</span></div>
              )) : <p className="text-sm text-gray-500">None recorded.</p>}
            </div>
          </div>
        </div>
        {activeBells.length > 0 && (
          <div>
            <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2"><Phone className="w-4 h-4 text-orange-600" /> Call Bells ({activeBells.length})</h3>
            <div className="space-y-2">
              {activeBells.map((cb, idx) => (
                <div key={idx} className={`p-3 rounded-lg border ${cb.status === "PENDING" ? "bg-red-50 border-red-200" : cb.status === "RESPONDED" ? "bg-yellow-50 border-yellow-200" : "bg-green-50 border-green-200"}`}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="font-medium text-gray-900 text-sm">{cb.reason}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${cb.status === "PENDING" ? "bg-red-200 text-red-800" : cb.status === "RESPONDED" ? "bg-yellow-200 text-yellow-800" : "bg-green-200 text-green-800"}`}>{cb.status}</span>
                  </div>
                  {/* eslint-disable-next-line react-hooks/purity */}
                  <p className="text-xs text-gray-600 mb-2">{Math.round((Date.now() - new Date(cb.createdAt).getTime()) / 60000)} min ago</p>
                  {cb.notes && <p className="text-xs text-gray-700 mb-2">📝 {cb.notes}</p>}
                  {cb.status !== "RESOLVED" && cb.status !== "CANCELLED" && (
                    <div className="flex gap-2 mt-2">
                      {cb.status === "PENDING" && (
                        <button
                          onClick={() => {
                            setSelectedBell(cb);
                            setBellModalMode("respond");
                          }}
                          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold rounded text-xs transition"
                        >
                          <Clock className="w-3 h-3" /> Respond
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setSelectedBell(cb);
                          setBellModalMode("resolve");
                        }}
                        className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-green-500 hover:bg-green-600 text-white font-semibold rounded text-xs transition"
                      >
                        <CheckCircle2 className="w-3 h-3" /> Resolve
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
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
        <div className="flex gap-2">
          <button onClick={onClose} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Close</button>
          <button
            onClick={() => {
              router.push(`/${basePrefix}/monitoring?resident=${encodeURIComponent(r.name)}&room=${encodeURIComponent(r.room)}&residentId=${encodeURIComponent(r.id)}`);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-400 to-blue-500 text-white font-semibold rounded-lg hover:shadow-lg transition active:scale-95"
          >
            <Camera className="w-4 h-4" /> View Monitoring
          </button>
        </div>
        <button onClick={onEdit} className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition"><Pencil className="w-4 h-4" /> Edit Record</button>
      </div>
    </Modal>

    {/* Call Bell Action Modal */}
    {selectedBell && bellModalMode === "respond" && (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
          <div className="bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-6 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold">Respond to Call Bell</h2>
              <p className="text-sm text-gray-900">{r.name} • Room {r.room}</p>
            </div>
            <button onClick={() => setSelectedBell(null)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Reason</label>
              <p className="text-gray-900 font-medium">{selectedBell.reason}</p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Time Waiting</label>
              {/* eslint-disable-next-line react-hooks/purity */}
              <p className="text-gray-900 font-medium">{Math.round((Date.now() - new Date(selectedBell.createdAt).getTime()) / 60000)} minutes</p>
            </div>
          </div>
          <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 flex gap-3">
            <button
              onClick={() => setSelectedBell(null)}
              className="flex-1 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                void handleBellRespond(selectedBell.id);
              }}
              className="flex-1 px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold rounded-lg transition"
            >
              Mark Responded
            </button>
          </div>
        </div>
      </div>
    )}

    {selectedBell && bellModalMode === "resolve" && (
      <CallBellResolveModal
        bell={selectedBell}
        resident={r}
        onClose={() => setSelectedBell(null)}
        onResolve={(notes) => void handleBellResolve(selectedBell.id, notes)}
      />
    )}
    </>
  );
}

/* ── Analytics ───────────────────────────────────────────────────────── */

function RecordsAnalytics({ records }: { records: RecordVM[] }) {
  const a = useMemo(() => ({
    byCare: CARE_ORDER.map((c) => ({ name: humanize(c), value: records.filter((r) => r.careLevel === c).length })).filter((d) => d.value > 0),
    alertsByCare: CARE_ORDER.map((c) => ({ name: humanize(c), Alerts: records.filter((r) => r.careLevel === c).reduce((s, r) => s + r.alertsCount, 0) })),
    medsByCare: CARE_ORDER.map((c) => ({ name: humanize(c), Meds: records.filter((r) => r.careLevel === c).reduce((s, r) => s + r.meds.length, 0) })),
  }), [records]);

  if (records.length === 0) return <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">No record data to analyze.</div>;

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
      <ChartCard title="Medications by Care Level" className="lg:col-span-2">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={a.medsByCare} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={28} />
            <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <Bar dataKey="Meds" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

/* ── Call Bell Resolve Modal ─────────────────────────────────────────── */

function CallBellResolveModal({
  bell,
  resident,
  onClose,
  onResolve,
}: {
  bell: CallBellVM;
  resident: RecordVM;
  onClose: () => void;
  onResolve: (notes: string) => void;
}) {
  const [notes, setNotes] = useState("");

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="bg-gradient-to-r from-green-400 to-green-500 text-white p-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">Resolve Call Bell</h2>
            <p className="text-sm text-green-100">{resident.name} • Room {resident.room}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-green-600/20 rounded-lg transition">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Reason</label>
            <p className="text-gray-900 font-medium">{bell.reason}</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Time Waiting</label>
            {/* eslint-disable-next-line react-hooks/purity */}
            <p className="text-gray-900 font-medium">{Math.round((Date.now() - new Date(bell.createdAt).getTime()) / 60000)} minutes</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Resolution Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What was done to resolve this call..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-400 focus:border-transparent outline-none text-sm"
              rows={3}
            />
          </div>
        </div>
        <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium"
          >
            Cancel
          </button>
          <button
            onClick={() => onResolve(notes)}
            className="flex-1 px-4 py-2 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-lg transition"
          >
            Mark Resolved
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────────────── */

const TONES: Record<string, { wrap: string; icon: string; value: string }> = {
  gray: { wrap: "bg-white border-gray-200", icon: "text-gray-500", value: "text-gray-900" },
  blue: { wrap: "bg-blue-50 border-blue-200", icon: "text-blue-500", value: "text-blue-600" },
  red: { wrap: "bg-red-50 border-red-200", icon: "text-red-500", value: "text-red-600" },
  green: { wrap: "bg-green-50 border-green-200", icon: "text-green-500", value: "text-green-600" },
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

function ChartCard({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`bg-white rounded-lg border border-gray-200 p-4 ${className ?? ""}`}>
      <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-yellow-500" /> {title}</h3>
      {children}
    </div>
  );
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-gray-900 to-black text-white p-5 sm:p-6 flex items-center justify-between z-10 border-b border-yellow-300">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold">{title}</h2>
            {subtitle && <p className="text-gray-300 text-sm">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1">{label}</label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
    </div>
  );
}

function Textarea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1">{label}</label>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none resize-y" />
    </div>
  );
}
