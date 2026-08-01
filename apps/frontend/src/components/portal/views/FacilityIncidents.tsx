"use client";

import { useMemo, useState, useEffect } from "react";
import {
  AlertTriangle, Search, X, Eye, CheckCircle, Trash2, RefreshCw,
  ArrowUpDown, Filter, LayoutGrid, Table2, Clock, User, MapPin,
  Shield, FileText, Flag, Calendar, ChevronDown, ChevronRight, Printer,
  Plus, Upload, Loader2,
  type LucideIcon,
} from "lucide-react";

// Print a single incident report as a standalone document (regulatory submission).
function printIncident(v: { type: string; resident: string; room: string; severity: string; timestamp: string | null; description: string; raw: Record<string, unknown> }) {
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  const row = (l: string, val: unknown) => val ? `<div class="row"><div class="l">${l}</div><div class="v">${esc(val)}</div></div>` : "";
  const w = window.open("", "_blank", "width=720,height=900");
  if (!w) return;
  w.document.write(`<html><head><title>Incident — ${esc(v.resident)}</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;padding:36px;color:#111;line-height:1.5}h1{font-size:20px;margin:0 0 4px}.meta{color:#555;font-size:13px;margin-bottom:18px}.row{margin:12px 0}.l{font-weight:700;color:#b91c1c;font-size:12px;text-transform:uppercase;letter-spacing:.04em}.v{white-space:pre-wrap}img{max-width:100%;margin-top:10px;border:1px solid #ddd;border-radius:8px}</style></head><body><h1>Incident Report — ${esc(v.type)}</h1><div class="meta">${esc(v.resident)} · Room ${esc(v.room)} · Severity ${esc(v.severity).toUpperCase()} · ${v.timestamp ? new Date(v.timestamp).toLocaleString() : "—"}</div>${row("Description", v.description)}${row("Location", v.raw.location)}${row("Immediate actions", v.raw.immediateActions)}${row("Witnesses", v.raw.witnesses)}${row("Follow-up", v.raw.followUpNotes)}${row("Review notes", v.raw.reviewNotes)}${v.raw.photoUrl ? `<img src="${esc(v.raw.photoUrl)}" alt="incident photo" />` : ""}</body></html>`);
  w.document.close(); w.focus(); w.print();
}
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptIncident } from "@/lib/adapters";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";

type Incident = ReturnType<typeof adaptIncident>;
type Severity = "critical" | "high" | "medium" | "low";

const SEVERITY_META: Record<Severity, { label: string; badge: string; color: string; icon: LucideIcon }> = {
  critical: { label: "Critical", badge: "bg-red-100 text-red-700", color: "#ef4444", icon: AlertTriangle },
  high: { label: "High", badge: "bg-orange-100 text-orange-700", color: "#f97316", icon: Flag },
  medium: { label: "Medium", badge: "bg-yellow-100 text-yellow-700", color: "#eab308", icon: Shield },
  low: { label: "Low", badge: "bg-blue-100 text-blue-700", color: "#3b82f6", icon: FileText },
};

const INCIDENT_TYPES = ["FALL", "MEDICATION_ERROR", "BEHAVIORAL", "MEDICAL_EMERGENCY", "SAFETY_HAZARD", "INFECTION", "OTHER"];
const typeLabel = (t: string) => t === "MEDICAL_EMERGENCY" ? "Medical Emergency" : t === "MEDICATION_ERROR" ? "Medication Error" : t === "SAFETY_HAZARD" ? "Safety Hazard" : t.charAt(0) + t.slice(1).toLowerCase();
const incInp = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none bg-white";

function relTime(iso: string | null, nowTs: number): string {
  if (!iso) return "—";
  const m = Math.round((nowTs - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function FacilityIncidents({ readOnly = false }: { readOnly?: boolean } = {}) {
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
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"list" | "table">("list");
  const [viewing, setViewing] = useState<Incident | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [sortBy, setSortBy] = useState<"date" | "severity">("date");
  const [sortAsc, setSortAsc] = useState(false);

  // ── Report a new incident (available to reporting staff, incl. read-only roles) ──
  const { data: residentRows } = useLiveQuery<Record<string, unknown>>("residents", { query: "take=300", tables: ["Resident"] });
  const residentOpts = useMemo(
    () => residentRows.map((r) => ({ id: String(r.id), name: `${String(r.firstName ?? "")} ${String(r.lastName ?? "")}`.trim() || "—", room: String(r.roomNumber ?? "—") })).sort((a, b) => a.name.localeCompare(b.name)),
    [residentRows]
  );
  const emptyForm = { residentId: "", incidentType: "FALL", severity: "MINOR", incidentDate: new Date().toISOString().slice(0, 16), description: "", location: "", immediateActions: "", witnesses: "", photoUrl: "", followUpRequired: false, followUpNotes: "" };
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const setF = (k: keyof typeof emptyForm, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  // Downscale + read the wound/scene photo to a data URI stored in photoUrl (no external storage needed).
  const onPhoto = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const maxW = 1200;
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) { setF("photoUrl", String(reader.result)); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setF("photoUrl", canvas.toDataURL("image/jpeg", 0.7));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleCreate = async () => {
    if (!form.residentId || !form.description.trim()) { Swal.fire("Missing fields", "Resident and description are required.", "warning"); return; }
    setSaving(true);
    try {
      await createRecord("incidents", {
        residentId: form.residentId, incidentType: form.incidentType, severity: form.severity,
        description: form.description.trim(), location: form.location.trim() || null,
        immediateActions: form.immediateActions.trim() || null, witnesses: form.witnesses.trim() || null,
        photoUrl: form.photoUrl || null, followUpRequired: form.followUpRequired,
        followUpNotes: form.followUpRequired ? (form.followUpNotes.trim() || null) : null,
        incidentDate: new Date(form.incidentDate).toISOString(),
      });
      await refetch();
      setCreating(false);
      setForm(emptyForm);
      Swal.fire({ title: "Incident reported", text: "Severe & critical incidents auto-alert the Care Manager.", icon: "success", timer: 1800, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not save the incident.", icon: "error" });
    } finally { setSaving(false); }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const result = incidents.filter(i => {
      if (q && !i.type.toLowerCase().includes(q) && !i.resident.toLowerCase().includes(q) && !i.room.toLowerCase().includes(q) && !i.description.toLowerCase().includes(q)) return false;
      if (severityFilter !== "all" && i.severity !== severityFilter) return false;
      if (statusFilter === "open" && i.resolved) return false;
      if (statusFilter === "resolved" && !i.resolved) return false;
      if (typeFilter !== "all" && i.raw.incidentType !== typeFilter) return false;
      return true;
    });
    result.sort((a, b) => {
      const dateA = new Date(a.timestamp || 0).getTime();
      const dateB = new Date(b.timestamp || 0).getTime();
      if (sortBy === "severity") {
        const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        const diff = (sevOrder[a.severity] ?? 0) - (sevOrder[b.severity] ?? 0);
        return sortAsc ? diff : -diff;
      }
      return sortAsc ? dateA - dateB : dateB - dateA;
    });
    return result;
  }, [incidents, search, severityFilter, statusFilter, typeFilter, sortBy, sortAsc]);

  const stats = useMemo(() => ({
    total: incidents.length,
    open: incidents.filter(i => !i.resolved).length,
    critical: incidents.filter(i => (i.severity === "critical" || i.severity === "high") && !i.resolved).length,
    resolved: incidents.filter(i => i.resolved).length,
  }), [incidents]);

  const severityDist = useMemo(() => {
    const order: Severity[] = ["critical", "high", "medium", "low"];
    return order.map(s => ({
      name: SEVERITY_META[s].label,
      value: incidents.filter(i => i.severity === s).length,
      color: SEVERITY_META[s].color,
    })).filter(d => d.value > 0);
  }, [incidents]);

  const typeDist = useMemo(() => {
    return INCIDENT_TYPES.map(t => ({
      name: t === "MEDICAL_EMERGENCY" ? "Medical Emergency" : t === "MEDICATION_ERROR" ? "Medication Error" : t === "SAFETY_HAZARD" ? "Safety Hazard" : t.charAt(0) + t.slice(1).toLowerCase(),
      value: incidents.filter(i => i.raw.incidentType === t).length,
    })).filter(d => d.value > 0);
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
    incidents.forEach(i => {
      const d = new Date(i.timestamp || 0);
      const key = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      if (map.has(key)) {
        const entry = map.get(key)!;
        entry.total++;
        i.resolved ? entry.resolved++ : entry.open++;
      }
    });
    return Array.from(map.values());
  }, [incidents]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const start = (page - 1) * perPage;
  const paginated = filtered.slice(start, start + perPage);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPage(1); }, [search, severityFilter, statusFilter, typeFilter, perPage]);

  // Care Manager review-and-close: capture sign-off notes, then close the incident.
  const handleResolve = async (id: string) => {
    const res = await Swal.fire({
      title: "Review & close incident",
      input: "textarea",
      inputLabel: "Review notes (Care Manager sign-off)",
      inputPlaceholder: "Findings, corrective actions verified, outcome…",
      showCancelButton: true, confirmButtonColor: "#10b981", cancelButtonColor: "#6b7280", confirmButtonText: "Close incident",
    });
    if (!res.isConfirmed) return;
    try {
      await updateRecord("incidents", id, { resolvedAt: new Date().toISOString(), reviewNotes: res.value || null });
      await refetch();
      Swal.fire({ title: "Reviewed & closed", icon: "success", timer: 1300, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not close.", icon: "error" });
    }
  };

  const handleReopen = async (id: string) => {
    const res = await Swal.fire({
      title: "Reopen Incident?", icon: "question", showCancelButton: true,
      confirmButtonColor: "#f59e0b", cancelButtonColor: "#6b7280", confirmButtonText: "Yes, reopen",
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
      title: "Delete Incident?", text: "This cannot be undone.", icon: "warning",
      showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Delete",
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
            <AlertTriangle className="w-7 h-7 text-yellow-500 flex-shrink-0" /> Incident Log
          </h1>
          <p className="text-gray-600 text-sm">Facility-wide incident tracking, management, and analytics</p>
        </div>
        <div className="flex items-center gap-2 self-start">
          <button onClick={() => void refetch()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button onClick={() => { setForm(emptyForm); setCreating(true); }} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition text-sm font-semibold shadow">
            <Plus className="w-4 h-4" /> Report Incident
          </button>
        </div>
      </div>

      {/* Stat Boxes */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <StatBox label="Total Incidents" value={stats.total} icon={AlertTriangle} color="gray" />
        <StatBox label="Open" value={stats.open} icon={Clock} color="red" />
        <StatBox label="Critical / High" value={stats.critical} icon={Flag} color="orange" />
        <StatBox label="Resolved" value={stats.resolved} icon={CheckCircle} color="green" />
      </div>

      {/* Charts Row */}
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
              <Pie data={severityDist} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={70} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
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
              <YAxis dataKey="name" type="category" fontSize={9} tickLine={false} axisLine={false} width={80} />
              <Tooltip />
              <Bar dataKey="value" fill="#f59e0b" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search type, resident, room, description…" value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
        </div>
        <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
          <option value="all">All Severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
          <option value="all">All Types</option>
          {INCIDENT_TYPES.map(t => (
            <option key={t} value={t}>{t === "MEDICAL_EMERGENCY" ? "Medical Emergency" : t === "MEDICATION_ERROR" ? "Medication Error" : t === "SAFETY_HAZARD" ? "Safety Hazard" : t.charAt(0) + t.slice(1).toLowerCase()}</option>
          ))}
        </select>
        <select value={perPage} onChange={e => setPerPage(parseInt(e.target.value))}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
          <option value={10}>10/page</option>
          <option value={25}>25/page</option>
          <option value={50}>50/page</option>
        </select>

        {/* Sort + View toggle */}
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
        /* ── List View ── */
        <div className="space-y-3">
          {paginated.map(i => {
            const meta = SEVERITY_META[i.severity] || SEVERITY_META.low;
            return (
              <div key={i.id} className={`rounded-lg border transition ${i.resolved ? "bg-green-50/60 border-green-200" : "bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm"}`}>
                <div className="p-4 flex items-start gap-4">
                  {/* Severity icon */}
                  <div className={`p-2.5 rounded-full flex-shrink-0 ${i.resolved ? "bg-green-100" : meta.badge.split(" ")[0] + " " + meta.badge.split(" ")[1]}`}>
                    <meta.icon className={`w-5 h-5 ${i.resolved ? "text-green-600" : meta.badge.split(" ")[1]}`} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 mb-1.5">
                      <div>
                        <h4 className={`text-base font-bold ${i.resolved ? "line-through text-gray-500" : "text-gray-900"}`}>{i.type}</h4>
                        <p className="text-sm text-gray-600 flex items-center gap-3 mt-0.5">
                          <span><User className="w-3 h-3 inline mr-0.5" />{i.resident}</span>
                          <span><MapPin className="w-3 h-3 inline mr-0.5" />Room {i.room}</span>
                          <span><Clock className="w-3 h-3 inline mr-0.5" />{relTime(String(i.timestamp), nowTs)}</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${meta.badge}`}>{i.severity.toUpperCase()}</span>
                        <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${i.resolved ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                          {i.resolved ? "RESOLVED" : "OPEN"}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-800 mb-2 line-clamp-2">{i.description}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => setViewing(i)} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded transition">
                        <Eye className="w-3.5 h-3.5" /> View
                      </button>
                      <button onClick={() => printIncident(i)} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded transition">
                        <Printer className="w-3.5 h-3.5" /> Print PDF
                      </button>
                      {!readOnly && (!i.resolved ? (
                        <button onClick={() => void handleResolve(i.id)} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-green-600 bg-green-50 hover:bg-green-100 rounded transition">
                          <CheckCircle className="w-3.5 h-3.5" /> Review &amp; Close
                        </button>
                      ) : (
                        <button onClick={() => void handleReopen(i.id)} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-600 bg-amber-50 hover:bg-amber-100 rounded transition">
                          <RefreshCw className="w-3.5 h-3.5" /> Reopen
                        </button>
                      ))}
                      {!readOnly && (
                        <button onClick={() => void handleDelete(i.id)} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded transition">
                          <Trash2 className="w-3.5 h-3.5" /> Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ── Table View ── */
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Type</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Resident</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Room</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Severity</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Date</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Description</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginated.map(i => {
                const meta = SEVERITY_META[i.severity] || SEVERITY_META.low;
                return (
                  <tr key={i.id} className={`hover:bg-gray-50 transition ${i.resolved ? "text-gray-500" : ""}`}>
                    <td className={`px-4 py-3 font-semibold ${i.resolved ? "text-gray-500" : "text-gray-900"}`}>{i.type}</td>
                    <td className="px-4 py-3">{i.resident}</td>
                    <td className="px-4 py-3">{i.room}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-bold ${meta.badge}`}>{i.severity.toUpperCase()}</span></td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-bold ${i.resolved ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{i.resolved ? "RESOLVED" : "OPEN"}</span></td>
                    <td className="px-4 py-3 text-xs">{i.timestamp ? new Date(i.timestamp).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-3 max-w-[200px] truncate text-xs">{i.description}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setViewing(i)} className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition" title="View"><Eye className="w-4 h-4" /></button>
                        <button onClick={() => printIncident(i)} className="p-1.5 rounded hover:bg-gray-100 text-gray-600 transition" title="Print PDF"><Printer className="w-4 h-4" /></button>
                        {!readOnly && (!i.resolved ? (
                          <button onClick={() => void handleResolve(i.id)} className="p-1.5 rounded hover:bg-green-100 text-green-600 transition" title="Review & Close"><CheckCircle className="w-4 h-4" /></button>
                        ) : (
                          <button onClick={() => void handleReopen(i.id)} className="p-1.5 rounded hover:bg-amber-100 text-amber-600 transition" title="Reopen"><RefreshCw className="w-4 h-4" /></button>
                        ))}
                        {!readOnly && <button onClick={() => void handleDelete(i.id)} className="p-1.5 rounded hover:bg-red-100 text-red-600 transition" title="Delete"><Trash2 className="w-4 h-4" /></button>}
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
          <div className="text-sm text-gray-600">Showing {start + 1}-{Math.min(start + perPage, filtered.length)} of {filtered.length} incidents</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">
              Previous
            </button>
            <span className="px-3 py-2 text-sm font-medium text-gray-700">Page {page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">
              Next
            </button>
          </div>
        </div>
      )}

      {/* View Modal */}
      {viewing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className={`sticky top-0 bg-gradient-to-r ${
              viewing.severity === "critical" ? "from-red-400 to-red-500" : viewing.severity === "high" ? "from-orange-400 to-orange-500" : "from-blue-400 to-blue-500"
            } text-white p-5 flex items-center justify-between z-10`}>
              <div>
                <h2 className="text-xl font-bold">{viewing.type}</h2>
                <p className="text-white/90">{viewing.resident} &middot; Room {viewing.room}</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => printIncident(viewing)} className="p-2 hover:bg-white/20 rounded-lg transition" title="Print report"><Printer className="w-5 h-5" /></button>
                <button onClick={() => setViewing(null)} className="p-2 hover:bg-white/20 rounded-lg transition"><X className="w-6 h-6" /></button>
              </div>
            </div>
            <div className="p-6 space-y-5">
              {/* Meta grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetaBox icon={Flag} label="Severity" value={viewing.severity.toUpperCase()} badge={SEVERITY_META[viewing.severity]?.badge || "bg-gray-100"} />
                <MetaBox icon={viewing.resolved ? CheckCircle : Clock} label="Status" value={viewing.resolved ? "Resolved" : "Open"} badge={viewing.resolved ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"} />
                <MetaBox icon={Calendar} label="Date" value={viewing.timestamp ? new Date(viewing.timestamp).toLocaleDateString() : "—"} />
                <MetaBox icon={Clock} label="Time" value={viewing.timestamp ? new Date(viewing.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"} />
              </div>

              {/* Location + witnesses from raw data */}
              {viewing.raw.location && (
                <div className="bg-gray-50 p-3 rounded border border-gray-200 flex items-center gap-2 text-sm">
                  <MapPin className="w-4 h-4 text-gray-500" />
                  <span className="text-gray-700">Location: <strong>{viewing.raw.location}</strong></span>
                </div>
              )}

              {/* Description */}
              <div>
                <h3 className="font-bold text-gray-900 mb-2 flex items-center gap-1.5"><FileText className="w-4 h-4 text-gray-500" /> Description</h3>
                <p className="text-gray-700 p-3 bg-gray-50 rounded border border-gray-200 text-sm leading-relaxed">{viewing.description}</p>
                {typeof viewing.raw.photoUrl === "string" && viewing.raw.photoUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={viewing.raw.photoUrl} alt="Incident documentation" className="mt-3 max-w-full max-h-72 rounded-lg border border-gray-200 object-contain" />
                )}
              </div>

              {/* Immediate Actions */}
              {viewing.raw.immediateActions && (
                <div className="bg-blue-50 border-l-4 border-blue-400 p-3 rounded">
                  <h3 className="font-bold text-gray-900 mb-1 text-sm">Immediate Actions Taken</h3>
                  <p className="text-gray-900 text-sm">{viewing.raw.immediateActions}</p>
                </div>
              )}

              {/* Witnesses */}
              {viewing.raw.witnesses && (
                <div className="bg-purple-50 border-l-4 border-purple-400 p-3 rounded">
                  <h3 className="font-bold text-gray-900 mb-1 text-sm">Witnesses</h3>
                  <p className="text-gray-900 text-sm">{viewing.raw.witnesses}</p>
                </div>
              )}

              {/* Follow-up */}
              {viewing.raw.followUpRequired && viewing.raw.followUpNotes && (
                <div className="bg-amber-50 border-l-4 border-amber-400 p-3 rounded">
                  <h3 className="font-bold text-gray-900 mb-1 text-sm">Follow-up Notes</h3>
                  <p className="text-gray-900 text-sm">{viewing.raw.followUpNotes}</p>
                </div>
              )}

              {/* Care Manager review */}
              {typeof viewing.raw.reviewNotes === "string" && viewing.raw.reviewNotes && (
                <div className="bg-green-50 border-l-4 border-green-400 p-3 rounded">
                  <h3 className="font-bold text-gray-900 mb-1 text-sm flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-green-600" /> Care Manager Review</h3>
                  <p className="text-gray-900 text-sm">{viewing.raw.reviewNotes}</p>
                </div>
              )}

              {/* Notes fallback */}
              {viewing.notes && !viewing.raw.immediateActions && !viewing.raw.followUpNotes && (
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded">
                  <h3 className="font-bold text-gray-900 mb-1 text-sm">Notes</h3>
                  <p className="text-gray-900 text-sm">{viewing.notes}</p>
                </div>
              )}
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setViewing(null)} className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium">Close</button>
              {!readOnly && (
                <div className="flex gap-2">
                  {!viewing.resolved ? (
                    <button onClick={() => { void handleResolve(viewing.id); setViewing(null); }} className="px-5 py-2 bg-gradient-to-r from-green-400 to-green-500 text-white font-semibold rounded-lg hover:shadow-lg transition text-sm">
                      <CheckCircle className="w-4 h-4 inline mr-1" /> Review &amp; Close
                    </button>
                  ) : (
                    <button onClick={() => { void handleReopen(viewing.id); setViewing(null); }} className="px-5 py-2 bg-gradient-to-r from-amber-400 to-amber-500 text-white font-semibold rounded-lg hover:shadow-lg transition text-sm">
                      <RefreshCw className="w-4 h-4 inline mr-1" /> Reopen
                    </button>
                  )}
                  <button onClick={() => { void handleDelete(viewing.id); setViewing(null); }} className="px-5 py-2 bg-gradient-to-r from-red-400 to-red-500 text-white font-semibold rounded-lg hover:shadow-lg transition text-sm">
                    <Trash2 className="w-4 h-4 inline mr-1" /> Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Report Incident modal */}
      {creating && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-red-500 to-red-600 text-white p-5 flex items-center justify-between z-10">
              <h2 className="text-xl font-bold flex items-center gap-2"><AlertTriangle className="w-6 h-6" /> Report Incident</h2>
              <button onClick={() => setCreating(false)} className="p-2 hover:bg-white/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Resident <span className="text-red-500">*</span></label>
                  <select value={form.residentId} onChange={e => setF("residentId", e.target.value)} className={incInp}>
                    <option value="">Select resident…</option>
                    {residentOpts.map(r => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Incident Type <span className="text-red-500">*</span></label>
                  <select value={form.incidentType} onChange={e => setF("incidentType", e.target.value)} className={incInp}>
                    {INCIDENT_TYPES.map(t => <option key={t} value={t}>{typeLabel(t)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Severity <span className="text-red-500">*</span></label>
                  <select value={form.severity} onChange={e => setF("severity", e.target.value)} className={incInp}>
                    {["MINOR", "MODERATE", "SEVERE", "CRITICAL"].map(sv => <option key={sv} value={sv}>{sv.charAt(0) + sv.slice(1).toLowerCase()}</option>)}
                  </select>
                  <p className="text-[11px] text-gray-500 mt-1">Severe &amp; Critical auto-alert the Care Manager.</p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Date &amp; Time</label>
                  <input type="datetime-local" value={form.incidentDate} onChange={e => setF("incidentDate", e.target.value)} className={incInp} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Description <span className="text-red-500">*</span></label>
                <textarea value={form.description} onChange={e => setF("description", e.target.value)} rows={3} placeholder="What happened?" className={incInp} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Location</label>
                  <input value={form.location} onChange={e => setF("location", e.target.value)} placeholder="e.g. Room 204 bathroom" className={incInp} />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Witnesses</label>
                  <input value={form.witnesses} onChange={e => setF("witnesses", e.target.value)} placeholder="Names of any witnesses" className={incInp} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Immediate Actions Taken</label>
                <textarea value={form.immediateActions} onChange={e => setF("immediateActions", e.target.value)} rows={2} placeholder="Actions taken right away…" className={incInp} />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Wound / Scene Photo</label>
                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
                    <Upload className="w-4 h-4" /> Upload photo
                    <input type="file" accept="image/*" className="hidden" onChange={e => onPhoto(e.target.files?.[0])} />
                  </label>
                  {form.photoUrl && (
                    <div className="flex items-center gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={form.photoUrl} alt="incident" className="h-12 w-12 object-cover rounded border border-gray-200" />
                      <button type="button" onClick={() => setF("photoUrl", "")} className="text-xs text-red-600 hover:underline">Remove</button>
                    </div>
                  )}
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={form.followUpRequired} onChange={e => setF("followUpRequired", e.target.checked)} className="w-4 h-4 rounded" />
                <span className="text-sm font-semibold text-gray-700">Follow-up required</span>
              </label>
              {form.followUpRequired && <textarea value={form.followUpNotes} onChange={e => setF("followUpNotes", e.target.value)} rows={2} placeholder="Follow-up notes…" className={incInp} />}
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setCreating(false)} disabled={saving} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition text-sm disabled:opacity-50">Cancel</button>
              <button onClick={() => void handleCreate()} disabled={saving} className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white font-semibold rounded-lg hover:shadow-lg transition text-sm disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {saving ? "Saving…" : "Submit Report"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ── */

function StatBox({ label, value, icon: Icon, color }: { label: string; value: number; icon: LucideIcon; color: string }) {
  const COLORS: Record<string, { text: string; bg: string; border: string }> = {
    gray: { text: "text-gray-900", bg: "bg-gray-50", border: "border-gray-200" },
    red: { text: "text-red-600", bg: "bg-red-50", border: "border-red-200" },
    orange: { text: "text-orange-600", bg: "bg-orange-50", border: "border-orange-200" },
    green: { text: "text-green-600", bg: "bg-green-50", border: "border-green-200" },
  };
  const c = COLORS[color] || COLORS.gray;
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
