"use client";

import RefreshButton from "@/components/portal/RefreshButton";

import { useMemo, useState, useEffect } from "react";
import {
  AlertTriangle, Search, X, Eye, CheckCircle, Trash2, RefreshCw,
  Clock, User, MapPin, Shield, FileText, Flag, Calendar,
  LayoutGrid, Table2, Stethoscope, AlertCircle, Activity,
  type LucideIcon,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell,
} from "recharts";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptIncident } from "@/lib/adapters";
import { updateRecord, deleteRecord } from "@/lib/api";

type Incident = ReturnType<typeof adaptIncident>;
type Severity = "critical" | "high" | "medium" | "low";

const SEVERITY_META: Record<Severity, { label: string; badge: string; color: string; icon: LucideIcon }> = {
  critical: { label: "Critical", badge: "bg-red-100 text-red-700", color: "#ef4444", icon: AlertTriangle },
  high:     { label: "High",     badge: "bg-orange-100 text-orange-700", color: "#f97316", icon: Flag },
  medium:   { label: "Medium",   badge: "bg-yellow-100 text-yellow-700", color: "#eab308", icon: Shield },
  low:      { label: "Low",      badge: "bg-blue-100 text-blue-700", color: "#3b82f6", icon: FileText },
};

const INCIDENT_TYPES = ["FALL", "MEDICATION_ERROR", "BEHAVIORAL", "MEDICAL_EMERGENCY", "SAFETY_HAZARD", "INFECTION", "OTHER"];

const TYPE_LABEL: Record<string, string> = {
  FALL: "Fall", MEDICATION_ERROR: "Medication Error", BEHAVIORAL: "Behavioral",
  MEDICAL_EMERGENCY: "Medical Emergency", SAFETY_HAZARD: "Safety Hazard",
  INFECTION: "Infection", OTHER: "Other",
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

const SEV_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export default function PhysicianIncidents() {
  const { data: incidentRows, loading, error, refetch } = useLiveQuery<Record<string, unknown>>(
    "incidents", { query: "include=resident&take=500", tables: ["Incident"] }
  );

  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  const incidents = useMemo<Incident[]>(() => incidentRows.map(adaptIncident), [incidentRows]);

  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"list" | "table">("list");
  const [sortBy, setSortBy] = useState<"date" | "severity">("date");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [viewing, setViewing] = useState<Incident | null>(null);
  const [physicianNote, setPhysicianNote] = useState("");
  const [signOffFor, setSignOffFor] = useState<Incident | null>(null);
  const [signOffNotes, setSignOffNotes] = useState("");
  const [signOffBusy, setSignOffBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const result = incidents.filter((i) => {
      if (q && !i.type.toLowerCase().includes(q) && !i.resident.toLowerCase().includes(q) && !i.room.toLowerCase().includes(q) && !i.description.toLowerCase().includes(q)) return false;
      if (severityFilter !== "all" && i.severity !== severityFilter) return false;
      if (statusFilter === "open" && i.resolved) return false;
      if (statusFilter === "resolved" && !i.resolved) return false;
      if (typeFilter !== "all" && i.raw.incidentType !== typeFilter) return false;
      return true;
    });
    result.sort((a, b) => {
      if (sortBy === "severity") {
        const diff = (SEV_ORDER[a.severity] ?? 0) - (SEV_ORDER[b.severity] ?? 0);
        return sortAsc ? diff : -diff;
      }
      const dA = new Date(a.timestamp || 0).getTime();
      const dB = new Date(b.timestamp || 0).getTime();
      return sortAsc ? dA - dB : dB - dA;
    });
    return result;
  }, [incidents, search, severityFilter, statusFilter, typeFilter, sortBy, sortAsc]);

  const stats = useMemo(() => ({
    total: incidents.length,
    open: incidents.filter((i) => !i.resolved).length,
    critical: incidents.filter((i) => (i.severity === "critical" || i.severity === "high") && !i.resolved).length,
    resolved: incidents.filter((i) => i.resolved).length,
    followUp: incidents.filter((i) => i.raw.followUpRequired && !i.resolved).length,
  }), [incidents]);

  const severityDist = useMemo(() => {
    const order: Severity[] = ["critical", "high", "medium", "low"];
    return order.map((s) => ({
      name: SEVERITY_META[s].label,
      value: incidents.filter((i) => i.severity === s).length,
      color: SEVERITY_META[s].color,
    })).filter((d) => d.value > 0);
  }, [incidents]);

  const typeDist = useMemo(() => {
    return INCIDENT_TYPES.map((t) => ({
      name: TYPE_LABEL[t],
      value: incidents.filter((i) => i.raw.incidentType === t).length,
    })).filter((d) => d.value > 0);
  }, [incidents]);

  const dailyData = useMemo(() => {
    const map = new Map<string, { date: string; total: number; open: number; resolved: number }>();
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      map.set(key, { date: key, total: 0, open: 0, resolved: 0 });
    }
    incidents.forEach((i) => {
      const d = new Date(i.timestamp || 0);
      const key = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      if (map.has(key)) {
        const e = map.get(key)!;
        e.total++;
        i.resolved ? e.resolved++ : e.open++;
      }
    });
    return Array.from(map.values());
  }, [incidents]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const start = (page - 1) * perPage;
  const paginated = filtered.slice(start, start + perPage);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPage(1); }, [search, severityFilter, statusFilter, typeFilter, perPage]);

  const openSignOff = (inc: Incident) => {
    setSignOffFor(inc);
    setSignOffNotes(physicianNote.trim());
  };

  const submitSignOff = async () => {
    const inc = signOffFor;
    if (!inc) return;
    const notes = signOffNotes.trim();
    if (notes.length < 3) return;
    setSignOffBusy(true);
    try {
      await updateRecord("incidents", inc.id, {
        resolvedAt: new Date().toISOString(),
        followUpNotes: `Physician review (${new Date().toLocaleDateString()}): ${notes}`,
      });
      await refetch();
      setSignOffFor(null);
      setSignOffNotes("");
      setViewing(null);
      setPhysicianNote("");
      Swal.fire({ title: "Sign-off Recorded", text: "Incident resolved with physician review.", icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not sign off.", icon: "error" });
    } finally {
      setSignOffBusy(false);
    }
  };

  const handleReopen = async (id: string) => {
    const res = await Swal.fire({
      title: "Reopen Incident?", text: "This will mark the incident as open again.",
      icon: "question", showCancelButton: true,
      confirmButtonColor: "#f59e0b", cancelButtonColor: "#6b7280", confirmButtonText: "Reopen",
    });
    if (!res.isConfirmed) return;
    try {
      await updateRecord("incidents", id, { resolvedAt: null });
      await refetch();
      Swal.fire({ title: "Reopened", icon: "success", timer: 1200, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not reopen.", icon: "error" });
    }
  };

  const handleDelete = async (id: string) => {
    const res = await Swal.fire({
      title: "Delete Incident?", text: "This action cannot be undone.",
      icon: "warning", showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Delete",
    });
    if (!res.isConfirmed) return;
    try {
      await deleteRecord("incidents", id);
      await refetch();
      Swal.fire({ title: "Deleted", icon: "success", timer: 1200, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not delete.", icon: "error" });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-1 flex items-center gap-2">
            <Stethoscope className="w-7 h-7 text-yellow-500 flex-shrink-0" /> Incident Review
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live</span>
            Clinical review, sign-off, and follow-up tracking
          </p>
        </div>
        <RefreshButton onRefresh={() => void refetch()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium self-start" />
      </div>

      {/* Stat Boxes */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatBox label="Total" value={stats.total} icon={AlertTriangle} color="gray" />
        <StatBox label="Open" value={stats.open} icon={Clock} color="red" />
        <StatBox label="Critical / High" value={stats.critical} icon={Flag} color="orange" />
        <StatBox label="Follow-up" value={stats.followUp} icon={AlertCircle} color="purple" />
        <StatBox label="Resolved" value={stats.resolved} icon={CheckCircle} color="green" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Last 7 Days" icon={Calendar}>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={dailyData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="date" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} fontSize={10} tickLine={false} axisLine={false} width={20} />
              <Tooltip />
              <Bar dataKey="open" name="Open" fill="#ef4444" radius={[3, 3, 0, 0]} stackId="a" />
              <Bar dataKey="resolved" name="Resolved" fill="#22c55e" radius={[3, 3, 0, 0]} stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Severity Distribution" icon={Flag}>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={severityDist} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={70}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                {severityDist.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="By Type" icon={FileText}>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={typeDist} layout="vertical" margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
              <XAxis type="number" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis dataKey="name" type="category" fontSize={9} tickLine={false} axisLine={false} width={100} />
              <Tooltip />
              <Bar dataKey="value" fill="#f59e0b" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search type, resident, room, description…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
        </div>
        <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
          <option value="all">All Severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
          <option value="all">All Types</option>
          {INCIDENT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
        <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
          <option value={10}>10/page</option>
          <option value={25}>25/page</option>
          <option value={50}>50/page</option>
        </select>
        <div className="flex gap-1">
          <button onClick={() => { if (sortBy !== "date") setSortBy("date"); else setSortAsc(!sortAsc); }}
            className={`px-3 py-2.5 text-sm rounded-lg border transition flex items-center gap-1 ${sortBy === "date" ? "bg-yellow-400 text-black border-yellow-400 font-semibold" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
            <Calendar className="w-4 h-4" /> Date {sortBy === "date" && (sortAsc ? "↑" : "↓")}
          </button>
          <button onClick={() => { if (sortBy !== "severity") setSortBy("severity"); else setSortAsc(!sortAsc); }}
            className={`px-3 py-2.5 text-sm rounded-lg border transition flex items-center gap-1 ${sortBy === "severity" ? "bg-yellow-400 text-black border-yellow-400 font-semibold" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
            <Flag className="w-4 h-4" /> Severity {sortBy === "severity" && (sortAsc ? "↑" : "↓")}
          </button>
          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
            <button onClick={() => setViewMode("list")}
              className={`px-3 py-2.5 text-sm transition ${viewMode === "list" ? "bg-yellow-400 text-black font-semibold" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button onClick={() => setViewMode("table")}
              className={`px-3 py-2.5 text-sm transition ${viewMode === "table" ? "bg-yellow-400 text-black font-semibold" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
              <Table2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading && incidents.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">Loading incidents…</div>
      ) : error ? (
        <div className="bg-white rounded-lg border border-red-200 p-10 text-center text-red-600">Failed to load: {error}</div>
      ) : paginated.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">No incidents match your filters.</div>
      ) : viewMode === "list" ? (
        <div className="space-y-3">
          {paginated.map((i) => {
            const meta = SEVERITY_META[i.severity] || SEVERITY_META.low;
            return (
              <div key={i.id} className={`rounded-lg border transition ${i.resolved ? "bg-green-50/60 border-green-200" : "bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm"}`}>
                <div className="p-4 flex items-start gap-4">
                  <div className={`p-2.5 rounded-full flex-shrink-0 ${i.resolved ? "bg-green-100" : meta.badge.split(" ")[0] + " " + meta.badge.split(" ")[1]}`}>
                    <meta.icon className={`w-5 h-5 ${i.resolved ? "text-green-600" : meta.badge.split(" ")[1]}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 mb-1.5">
                      <div>
                        <h4 className={`text-base font-bold ${i.resolved ? "line-through text-gray-500" : "text-gray-900"}`}>{i.type}</h4>
                        <p className="text-sm text-gray-600 flex items-center gap-3 mt-0.5 flex-wrap">
                          <span className="inline-flex items-center gap-1"><User className="w-3 h-3" />{i.resident}</span>
                          <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />Room {i.room}</span>
                          <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{relTime(String(i.timestamp), nowTs)}</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${meta.badge}`}>{i.severity.toUpperCase()}</span>
                        <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${i.resolved ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{i.resolved ? "RESOLVED" : "OPEN"}</span>
                        {i.raw.followUpRequired && !i.resolved && (
                          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-purple-100 text-purple-700">FOLLOW-UP</span>
                        )}
                      </div>
                    </div>
                    <p className="text-sm text-gray-800 mb-2 line-clamp-2">{i.description}</p>
                    {i.notes && (
                      <p className="text-xs text-gray-600 p-2 bg-gray-100 rounded border-l-2 border-yellow-400 mb-2">{i.notes}</p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => setViewing(i)} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded transition">
                        <Eye className="w-3.5 h-3.5" /> View
                      </button>
                      {!i.resolved ? (
                        <button onClick={() => openSignOff(i)} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-green-600 bg-green-50 hover:bg-green-100 rounded transition">
                          <Stethoscope className="w-3.5 h-3.5" /> Sign Off
                        </button>
                      ) : (
                        <button onClick={() => void handleReopen(i.id)} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-600 bg-amber-50 hover:bg-amber-100 rounded transition">
                          <RefreshCw className="w-3.5 h-3.5" /> Reopen
                        </button>
                      )}
                      <button onClick={() => void handleDelete(i.id)} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded transition">
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Type</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Resident</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700 hidden sm:table-cell">Room</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Severity</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700 hidden md:table-cell">Date</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700 hidden lg:table-cell">Description</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginated.map((i) => {
                const meta = SEVERITY_META[i.severity] || SEVERITY_META.low;
                return (
                  <tr key={i.id} className={`hover:bg-gray-50 transition ${i.resolved ? "text-gray-500" : ""}`}>
                    <td className={`px-4 py-3 font-semibold ${i.resolved ? "text-gray-500" : "text-gray-900"}`}>{i.type}</td>
                    <td className="px-4 py-3">{i.resident}</td>
                    <td className="px-4 py-3 hidden sm:table-cell">{i.room}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-bold ${meta.badge}`}>{i.severity.toUpperCase()}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${i.resolved ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{i.resolved ? "RESOLVED" : "OPEN"}</span>
                        {i.raw.followUpRequired && !i.resolved && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700">FU</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs hidden md:table-cell">{i.timestamp ? new Date(i.timestamp).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-3 max-w-[200px] truncate text-xs hidden lg:table-cell">{i.description}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setViewing(i)} className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition" title="View"><Eye className="w-4 h-4" /></button>
                        {!i.resolved ? (
                          <button onClick={() => openSignOff(i)} className="p-1.5 rounded hover:bg-green-100 text-green-600 transition" title="Sign Off"><Stethoscope className="w-4 h-4" /></button>
                        ) : (
                          <button onClick={() => void handleReopen(i.id)} className="p-1.5 rounded hover:bg-amber-100 text-amber-600 transition" title="Reopen"><RefreshCw className="w-4 h-4" /></button>
                        )}
                        <button onClick={() => void handleDelete(i.id)} className="p-1.5 rounded hover:bg-red-100 text-red-600 transition" title="Delete"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
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

      {/* Detail Modal */}
      {viewing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
            <div className={`sticky top-0 text-white p-5 flex items-center justify-between z-10 ${
              viewing.severity === "critical" ? "bg-gradient-to-r from-red-500 to-red-600" :
              viewing.severity === "high" ? "bg-gradient-to-r from-orange-500 to-orange-600" :
              "bg-gradient-to-r from-blue-500 to-blue-600"
            }`}>
              <div>
                <h2 className="text-xl sm:text-2xl font-bold">{viewing.type}</h2>
                <p className="text-white/80">{viewing.resident} · Room {viewing.room}</p>
              </div>
              <button onClick={() => { setViewing(null); setPhysicianNote(""); }} className="p-2 hover:bg-white/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetaBox icon={Flag} label="Severity" value={viewing.severity.toUpperCase()} badge={SEVERITY_META[viewing.severity]?.badge || "bg-gray-100"} />
                <MetaBox icon={viewing.resolved ? CheckCircle : Clock} label="Status" value={viewing.resolved ? "Resolved" : "Open"} badge={viewing.resolved ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"} />
                <MetaBox icon={Calendar} label="Date" value={viewing.timestamp ? new Date(viewing.timestamp).toLocaleDateString() : "—"} />
                <MetaBox icon={Clock} label="Time" value={viewing.timestamp ? new Date(viewing.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"} />
              </div>

              {viewing.raw.location && (
                <div className="bg-gray-50 p-3 rounded border border-gray-200 flex items-center gap-2 text-sm">
                  <MapPin className="w-4 h-4 text-gray-500" />
                  <span className="text-gray-700">Location: <strong>{viewing.raw.location}</strong></span>
                </div>
              )}

              <div>
                <h3 className="font-bold text-gray-900 mb-2 flex items-center gap-1.5"><FileText className="w-4 h-4 text-gray-500" /> Description</h3>
                <p className="text-gray-700 p-3 bg-gray-50 rounded border border-gray-200 text-sm leading-relaxed">{viewing.description}</p>
              </div>

              {viewing.raw.immediateActions && (
                <div className="bg-blue-50 border-l-4 border-blue-400 p-3 rounded">
                  <h3 className="font-bold text-gray-900 mb-1 text-sm">Immediate Actions Taken</h3>
                  <p className="text-gray-900 text-sm">{viewing.raw.immediateActions}</p>
                </div>
              )}

              {viewing.raw.witnesses && (
                <div className="bg-purple-50 border-l-4 border-purple-400 p-3 rounded">
                  <h3 className="font-bold text-gray-900 mb-1 text-sm">Witnesses</h3>
                  <p className="text-gray-900 text-sm">{viewing.raw.witnesses}</p>
                </div>
              )}

              {viewing.raw.followUpRequired && (
                <div className="bg-amber-50 border-l-4 border-amber-400 p-3 rounded">
                  <h3 className="font-bold text-gray-900 mb-1 text-sm flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5 text-amber-600" /> Follow-up Required</h3>
                  <p className="text-gray-900 text-sm">{viewing.raw.followUpNotes || "No notes yet."}</p>
                </div>
              )}

              {viewing.notes && !viewing.raw.immediateActions && !viewing.raw.followUpNotes && (
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded">
                  <h3 className="font-bold text-gray-900 mb-1 text-sm">Notes</h3>
                  <p className="text-gray-900 text-sm">{viewing.notes}</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Physician Review Notes</label>
                <textarea value={physicianNote} onChange={(e) => setPhysicianNote(e.target.value)} rows={3}
                  placeholder="Enter your clinical assessment and review notes…"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none resize-y text-sm" />
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between gap-2 flex-wrap">
              <button onClick={() => { setViewing(null); setPhysicianNote(""); }}
                className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium">Close</button>
              <div className="flex flex-wrap gap-2">
                {!viewing.resolved ? (
                  <button onClick={() => openSignOff(viewing)}
                    className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-green-400 to-green-500 text-white font-semibold rounded-lg hover:shadow-lg transition text-sm active:scale-95">
                    <Stethoscope className="w-4 h-4" /> Physician Sign-off
                  </button>
                ) : (
                  <button onClick={() => { void handleReopen(viewing.id); setViewing(null); setPhysicianNote(""); }}
                    className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-amber-400 to-amber-500 text-white font-semibold rounded-lg hover:shadow-lg transition text-sm">
                    <RefreshCw className="w-4 h-4" /> Reopen
                  </button>
                )}
                <button onClick={() => { void handleDelete(viewing.id); setViewing(null); setPhysicianNote(""); }}
                  className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-red-400 to-red-500 text-white font-semibold rounded-lg hover:shadow-lg transition text-sm">
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Physician Sign-off ──────────────────────────────────────── */}
      {signOffFor && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget && !signOffBusy) setSignOffFor(null); }}>
          <div className="bg-white w-full max-w-lg max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden rounded-t-2xl sm:rounded-xl shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-gradient-to-r from-green-500 to-emerald-600 px-5 py-4 text-white">
              <h2 className="flex items-center gap-2 text-lg font-bold"><Stethoscope className="w-5 h-5" /> Physician Sign-off</h2>
              <button onClick={() => setSignOffFor(null)} disabled={signOffBusy} className="rounded-lg p-1.5 transition hover:bg-white/20 disabled:opacity-50"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <p className="flex items-center gap-2 font-semibold text-gray-900"><AlertTriangle className="w-4 h-4 text-red-500" />{signOffFor.type || "Incident"}{signOffFor.resident ? ` — ${signOffFor.resident}` : ""}{signOffFor.room ? ` · Room ${signOffFor.room}` : ""}</p>
                {signOffFor.description && <p className="mt-1 line-clamp-2 text-xs text-gray-500">{signOffFor.description}</p>}
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-gray-700">Clinical Notes <span className="font-normal text-red-500">*</span></label>
                <textarea autoFocus rows={5} value={signOffNotes} onChange={(e) => setSignOffNotes(e.target.value)}
                  placeholder="Reviewed and approved. No further action required..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none resize-y text-sm" />
                <p className="mt-1.5 text-[11px] text-gray-400">Signing off resolves the incident with your clinical review (at least 3 characters).</p>
              </div>
            </div>
            <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-4">
              <button onClick={() => setSignOffFor(null)} disabled={signOffBusy} className="rounded-lg px-5 py-2 text-sm text-gray-700 transition hover:bg-gray-100 disabled:opacity-50">Cancel</button>
              <button onClick={() => void submitSignOff()} disabled={signOffBusy || signOffNotes.trim().length < 3}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50 active:scale-95">
                {signOffBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} {signOffBusy ? "Signing…" : "Sign Off"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, icon: Icon, color }: { label: string; value: number; icon: LucideIcon; color: string }) {
  const C: Record<string, { text: string; bg: string; border: string }> = {
    gray:   { text: "text-gray-900",    bg: "bg-gray-50",   border: "border-gray-200" },
    red:    { text: "text-red-600",     bg: "bg-red-50",    border: "border-red-200" },
    orange: { text: "text-orange-600",  bg: "bg-orange-50", border: "border-orange-200" },
    green:  { text: "text-green-600",   bg: "bg-green-50",  border: "border-green-200" },
    purple: { text: "text-purple-600",  bg: "bg-purple-50", border: "border-purple-200" },
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

function ChartCard({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3.5 h-3.5 text-yellow-500" />
        <h3 className="font-semibold text-gray-900 text-sm">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function MetaBox({ icon: Icon, label, value, badge }: { icon: LucideIcon; label: string; value: string; badge?: string }) {
  return (
    <div className="bg-gray-50 p-3 rounded border border-gray-200">
      <p className="text-xs text-gray-600 font-semibold flex items-center gap-1 mb-1"><Icon className="w-3 h-3" />{label}</p>
      {badge ? (
        <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${badge}`}>{value}</span>
      ) : (
        <p className="text-sm font-semibold text-gray-900">{value}</p>
      )}
    </div>
  );
}
