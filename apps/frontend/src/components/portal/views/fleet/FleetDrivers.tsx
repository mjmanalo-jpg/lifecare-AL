"use client";

import RefreshButton from "@/components/portal/RefreshButton";

import { useMemo, useState } from "react";
import {
  Users, Search, Plus, X, Edit, Trash2, RefreshCw, LayoutGrid, Table2, Eye,
  Calendar, Phone, Mail, IdCard, ShieldAlert, ShieldCheck, Clock, Award,
  UserCheck, UserX, Gauge, FileText,
  type LucideIcon,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";

/* ── Model adapter ── */

function adaptDriver(r: Record<string, unknown>) {
  return {
    id: String(r.id ?? ""),
    name: String(r.name ?? ""),
    phone: String(r.phone ?? ""),
    email: String(r.email ?? ""),
    licenseNumber: String(r.licenseNumber ?? ""),
    licenseClass: String(r.licenseClass ?? ""),
    licenseExpiry: r.licenseExpiry ? String(r.licenseExpiry) : "",
    certifications: String(r.certifications ?? ""),
    certificationExpiry: r.certificationExpiry ? String(r.certificationExpiry) : "",
    safetyScore: Number(r.safetyScore ?? 100),
    tripHours: Number(r.tripHours ?? 0),
    isActive: r.isActive !== false,
    avatarUrl: String(r.avatarUrl ?? ""),
    hireDate: r.hireDate ? String(r.hireDate) : "",
    notes: String(r.notes ?? ""),
    raw: r,
  };
}

type Driver = ReturnType<typeof adaptDriver>;

/* ── Helpers ── */

type ExpiryState = { state: "none" | "ok" | "expiring" | "expired"; days: number };

function expiryState(iso: string): ExpiryState {
  if (!iso) return { state: "none", days: 0 };
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (days < 0) return { state: "expired", days };
  if (days <= 30) return { state: "expiring", days };
  return { state: "ok", days };
}

function hasLicenseAlert(d: Driver) {
  const s = expiryState(d.licenseExpiry).state;
  return s === "expired" || s === "expiring";
}

function certList(d: Driver) {
  return d.certifications.split(",").map(c => c.trim()).filter(Boolean);
}

function safetyBand(score: number): { label: string; text: string; bar: string; hex: string } {
  if (score >= 90) return { label: "Excellent", text: "text-green-600", bar: "bg-green-500", hex: "#22c55e" };
  if (score >= 75) return { label: "Good", text: "text-amber-600", bar: "bg-amber-500", hex: "#f59e0b" };
  return { label: "Needs Review", text: "text-red-600", bar: "bg-red-500", hex: "#ef4444" };
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? "").join("") || "?";
}

const emptyForm = {
  name: "", phone: "", email: "", licenseNumber: "", licenseClass: "",
  licenseExpiry: "", certifications: "", certificationExpiry: "",
  safetyScore: "100", hireDate: "", notes: "",
};

export default function FleetDrivers() {
  const { data: driverRows, loading, error, refetch } = useLiveQuery<Record<string, unknown>>(
    "drivers", { query: "take=300", tables: ["Driver"] }
  );
  const drivers = useMemo<Driver[]>(() => driverRows.map(adaptDriver), [driverRows]);

  const [search, setSearch] = useState("");
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  const [showAlertsOnly, setShowAlertsOnly] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [viewing, setViewing] = useState<Driver | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState(emptyForm);
  const [page, setPage] = useState(1);
  const perPage = 24;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return drivers.filter(d => {
      if (q && !d.name.toLowerCase().includes(q) && !d.phone.toLowerCase().includes(q) && !d.email.toLowerCase().includes(q) && !d.licenseNumber.toLowerCase().includes(q)) return false;
      if (showActiveOnly && !d.isActive) return false;
      if (showAlertsOnly && !hasLicenseAlert(d)) return false;
      return true;
    });
  }, [drivers, search, showActiveOnly, showAlertsOnly]);

  const stats = useMemo(() => {
    const avg = drivers.length ? drivers.reduce((s, d) => s + d.safetyScore, 0) / drivers.length : 0;
    return {
      total: drivers.length,
      active: drivers.filter(d => d.isActive).length,
      licenseAlerts: drivers.filter(hasLicenseAlert).length,
      avgSafety: avg.toFixed(1),
      totalTripHours: drivers.reduce((s, d) => s + d.tripHours, 0).toFixed(1),
    };
  }, [drivers]);

  const safetyChart = useMemo(() => {
    return [...drivers]
      .sort((a, b) => b.safetyScore - a.safetyScore)
      .slice(0, 10)
      .map(d => ({
        name: d.name.split(/\s+/)[0] || d.name,
        score: Math.round(d.safetyScore * 10) / 10,
        color: safetyBand(d.safetyScore).hex,
      }));
  }, [drivers]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const start = (page - 1) * perPage;
  const paginated = filtered.slice(start, start + perPage);

  const handleToggleActive = async (d: Driver) => {
    const confirmed = await Swal.fire({
      title: d.isActive ? "Deactivate Driver?" : "Activate Driver?",
      text: d.isActive ? `${d.name} will no longer be assignable to trips.` : `${d.name} will become assignable to trips.`,
      icon: "question", showCancelButton: true,
      confirmButtonColor: d.isActive ? "#ef4444" : "#22c55e",
      cancelButtonColor: "#6b7280",
      confirmButtonText: d.isActive ? "Deactivate" : "Activate",
    });
    if (!confirmed.isConfirmed) return;
    try {
      await updateRecord("drivers", d.id, { isActive: !d.isActive });
      await refetch();
      if (viewing && viewing.id === d.id) setViewing({ ...viewing, isActive: !d.isActive });
      Swal.fire({ title: d.isActive ? "Deactivated" : "Activated", text: `${d.name} is now ${d.isActive ? "inactive" : "active"}.`, icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Update Failed", text: err instanceof Error ? err.message : "Could not update driver.", icon: "error" });
    }
  };

  const buildPayload = (form: typeof emptyForm) => ({
    name: form.name, phone: form.phone, email: form.email,
    licenseNumber: form.licenseNumber, licenseClass: form.licenseClass,
    licenseExpiry: form.licenseExpiry ? new Date(form.licenseExpiry).toISOString() : null,
    certifications: form.certifications,
    certificationExpiry: form.certificationExpiry ? new Date(form.certificationExpiry).toISOString() : null,
    safetyScore: Math.max(0, Math.min(100, Number(form.safetyScore) || 0)),
    hireDate: form.hireDate ? new Date(form.hireDate).toISOString() : null,
    notes: form.notes,
  });

  const handleCreate = async () => {
    if (!createForm.name) {
      Swal.fire({ title: "Missing Fields", text: "Driver name is required.", icon: "warning" });
      return;
    }
    const confirmed = await Swal.fire({
      title: "Add Driver?", icon: "question", showCancelButton: true,
      confirmButtonColor: "#fbbf24", cancelButtonColor: "#6b7280", confirmButtonText: "Add",
    });
    if (!confirmed.isConfirmed) return;
    try {
      await createRecord("drivers", buildPayload(createForm));
      await refetch();
      setShowCreate(false);
      setCreateForm(emptyForm);
      Swal.fire({ title: "Added", text: `${createForm.name} added.`, icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Add Failed", text: err instanceof Error ? err.message : "Could not add driver.", icon: "error" });
    }
  };

  const startEditing = (d: Driver) => {
    setEditing(d);
    setEditForm({
      name: d.name, phone: d.phone, email: d.email,
      licenseNumber: d.licenseNumber, licenseClass: d.licenseClass,
      licenseExpiry: d.licenseExpiry ? d.licenseExpiry.split("T")[0] : "",
      certifications: d.certifications,
      certificationExpiry: d.certificationExpiry ? d.certificationExpiry.split("T")[0] : "",
      safetyScore: String(d.safetyScore),
      hireDate: d.hireDate ? d.hireDate.split("T")[0] : "",
      notes: d.notes,
    });
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    const confirmed = await Swal.fire({
      title: "Save Changes?", icon: "question", showCancelButton: true,
      confirmButtonColor: "#fbbf24", cancelButtonColor: "#6b7280", confirmButtonText: "Save",
    });
    if (!confirmed.isConfirmed) return;
    try {
      await updateRecord("drivers", editing.id, buildPayload(editForm));
      await refetch();
      setEditing(null);
      Swal.fire({ title: "Saved", text: `${editForm.name} updated.`, icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Save Failed", text: err instanceof Error ? err.message : "Could not update driver.", icon: "error" });
    }
  };

  const handleDelete = async (d: Driver) => {
    const confirmed = await Swal.fire({
      title: "Delete Driver?", text: `Remove "${d.name}"?`, icon: "warning",
      showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Delete",
    });
    if (!confirmed.isConfirmed) return;
    try {
      await deleteRecord("drivers", d.id);
      await refetch();
      Swal.fire({ title: "Deleted", text: `${d.name} removed.`, icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Delete Failed", text: err instanceof Error ? err.message : "Could not delete driver.", icon: "error" });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Driver Management
          </h1>
          <p className="text-gray-600">Track drivers, licenses, certifications, and safety performance</p>
        </div>
        <div className="flex gap-2">
          <RefreshButton onRefresh={() => void refetch()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium" />
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95">
            <Plus className="w-4 h-4" /> Add Driver
          </button>
        </div>
      </div>

      {/* Stat Boxes */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatBox label="Total Drivers" value={String(stats.total)} icon={Users} color="blue" />
        <StatBox label="Active" value={String(stats.active)} icon={UserCheck} color="green" />
        <StatBox label="License Alerts" value={String(stats.licenseAlerts)} icon={ShieldAlert} color="red" />
        <StatBox label="Avg Safety Score" value={stats.avgSafety} icon={Gauge} color="purple" />
        <StatBox label="Total Trip-Hours" value={stats.totalTripHours} icon={Clock} color="amber" />
      </div>

      {/* Chart */}
      {safetyChart.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Gauge className="w-4 h-4 text-yellow-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Safety Scores (Top 10)</h3>
          </div>
          <div className="h-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={safetyChart} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 100]} fontSize={10} tickLine={false} axisLine={false} width={28} />
                <Tooltip />
                <Bar dataKey="score" name="Safety Score" radius={[3, 3, 0, 0]}>
                  {safetyChart.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search name, phone, email, license #…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
        </div>
        <label className="flex items-center gap-2 px-3 py-2.5 bg-white border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition text-sm select-none">
          <input type="checkbox" checked={showActiveOnly} onChange={e => { setShowActiveOnly(e.target.checked); setPage(1); }} className="rounded" />
          <UserCheck className="w-4 h-4 text-green-500" /> Active only
        </label>
        <label className="flex items-center gap-2 px-3 py-2.5 bg-white border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition text-sm select-none">
          <input type="checkbox" checked={showAlertsOnly} onChange={e => { setShowAlertsOnly(e.target.checked); setPage(1); }} className="rounded" />
          <ShieldAlert className="w-4 h-4 text-red-500" /> License alerts only
        </label>
        <div className="flex rounded-lg border border-gray-300 overflow-hidden">
          <button onClick={() => { setViewMode("grid"); setPage(1); }}
            className={`px-3 py-2.5 text-sm transition ${viewMode === "grid" ? "bg-yellow-400 text-black font-semibold" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button onClick={() => { setViewMode("table"); setPage(1); }}
            className={`px-3 py-2.5 text-sm transition ${viewMode === "table" ? "bg-yellow-400 text-black font-semibold" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
            <Table2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {loading && drivers.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading drivers...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">No drivers match your filters.</div>
      ) : viewMode === "grid" ? (
        /* ── Grid View ── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {paginated.map(d => {
            const band = safetyBand(d.safetyScore);
            const certs = certList(d);
            return (
              <div key={d.id} className={`bg-white rounded-lg border overflow-hidden hover:shadow-md transition group ${hasLicenseAlert(d) ? "border-red-300 ring-1 ring-red-200" : "border-gray-200"} ${d.isActive ? "" : "opacity-70"}`}>
                <div className="p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      <Avatar name={d.name} />
                      <div className="min-w-0">
                        <h3 className="font-semibold text-gray-900 text-sm truncate">{d.name}</h3>
                        <p className="text-xs text-gray-500 truncate">{d.licenseClass ? `Class ${d.licenseClass} · ` : ""}{d.licenseNumber || "No license #"}</p>
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${d.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                      {d.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>

                  {/* License & certification check */}
                  <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                    <ExpiryBadge label="License" iso={d.licenseExpiry} />
                    <ExpiryBadge label="Certs" iso={d.certificationExpiry} />
                  </div>
                  {certs.length > 0 && (
                    <div className="flex items-center gap-1 mb-2 flex-wrap">
                      {certs.map((c, i) => (
                        <span key={i} className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-medium">{c}</span>
                      ))}
                    </div>
                  )}

                  {/* Safety score */}
                  <div className="mb-2">
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="text-gray-500 flex items-center gap-1"><Gauge className="w-3 h-3" /> Safety</span>
                      <span className={`font-semibold ${band.text}`}>{d.safetyScore.toFixed(0)} · {band.label}</span>
                    </div>
                    <SafetyBar score={d.safetyScore} />
                  </div>

                  <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {d.tripHours.toFixed(1)} h</span>
                    {d.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {d.phone}</span>}
                  </div>

                  <div className="flex gap-1.5">
                    <button onClick={() => setViewing(d)} className="flex-1 px-2 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded transition flex items-center justify-center gap-1">
                      <Eye className="w-3 h-3" /> View
                    </button>
                    <button onClick={() => startEditing(d)} className="flex-1 px-2 py-1.5 text-xs font-medium text-yellow-600 bg-yellow-50 hover:bg-yellow-100 rounded transition flex items-center justify-center gap-1">
                      <Edit className="w-3 h-3" /> Edit
                    </button>
                    <button onClick={() => handleToggleActive(d)} title={d.isActive ? "Deactivate" : "Activate"}
                      className={`px-2 py-1.5 text-xs font-medium rounded transition ${d.isActive ? "text-gray-600 bg-gray-50 hover:bg-gray-100" : "text-green-600 bg-green-50 hover:bg-green-100"}`}>
                      {d.isActive ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => handleDelete(d)} className="px-2 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded transition">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
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
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Driver</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Contact</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">License</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Certifications</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Safety</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Trip-Hours</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginated.map(d => {
                const band = safetyBand(d.safetyScore);
                const certs = certList(d);
                return (
                  <tr key={d.id} className={`hover:bg-gray-50 transition ${hasLicenseAlert(d) ? "bg-red-50/40" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Avatar name={d.name} small />
                        <span className="font-medium text-gray-900">{d.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {d.phone && <p>{d.phone}</p>}
                      {d.email && <p className="text-gray-500">{d.email}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-gray-700 font-mono">{d.licenseNumber || "—"}{d.licenseClass ? ` (${d.licenseClass})` : ""}</p>
                      <ExpiryBadge label="License" iso={d.licenseExpiry} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 flex-wrap max-w-[220px]">
                        {certs.length === 0 ? <span className="text-xs text-gray-400">—</span> : certs.map((c, i) => (
                          <span key={i} className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-medium">{c}</span>
                        ))}
                        <ExpiryBadge label="Certs" iso={d.certificationExpiry} />
                      </div>
                    </td>
                    <td className="px-4 py-3 min-w-[120px]">
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1"><SafetyBar score={d.safetyScore} /></div>
                        <span className={`text-xs font-semibold ${band.text}`}>{d.safetyScore.toFixed(0)}</span>
                      </div>
                      <p className={`text-[10px] font-medium ${band.text}`}>{band.label}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{d.tripHours.toFixed(1)} h</td>
                    <td className="px-4 py-3">
                      <button onClick={() => handleToggleActive(d)}
                        className={`px-2 py-1 rounded-full text-[10px] font-semibold transition ${d.isActive ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                        {d.isActive ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setViewing(d)} className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition" title="View"><Eye className="w-4 h-4" /></button>
                        <button onClick={() => startEditing(d)} className="p-1.5 rounded hover:bg-yellow-100 text-yellow-600 transition" title="Edit"><Edit className="w-4 h-4" /></button>
                        <button onClick={() => handleDelete(d)} className="p-1.5 rounded hover:bg-red-100 text-red-600 transition" title="Delete"><Trash2 className="w-4 h-4" /></button>
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
          <div className="text-sm text-gray-600">{filtered.length} drivers total</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">Previous</button>
            <span className="px-3 py-2 text-sm font-medium text-gray-700">Page {page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">Next</button>
          </div>
        </div>
      )}

      {/* View Modal */}
      {viewing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className={`sticky top-0 bg-gradient-to-r ${hasLicenseAlert(viewing) ? "from-red-400 to-red-500" : "from-blue-400 to-blue-500"} text-white p-5 flex items-center justify-between z-10`}>
              <div className="flex items-center gap-3">
                <Avatar name={viewing.name} />
                <div>
                  <h2 className="text-xl font-bold">{viewing.name}</h2>
                  <p className="text-sm text-white/80">{viewing.isActive ? "Active driver" : "Inactive driver"}</p>
                </div>
              </div>
              <button onClick={() => setViewing(null)} className="p-2 hover:bg-white/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              {/* Safety score */}
              <div>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-semibold text-gray-700 flex items-center gap-1"><Gauge className="w-4 h-4" /> Safety Score</span>
                  <span className={`font-bold ${safetyBand(viewing.safetyScore).text}`}>
                    {viewing.safetyScore.toFixed(1)} · {safetyBand(viewing.safetyScore).label}
                  </span>
                </div>
                <SafetyBar score={viewing.safetyScore} tall />
              </div>

              {/* License & Certification check */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold text-gray-600 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> License &amp; Certification Check</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <ExpiryBadge label="License" iso={viewing.licenseExpiry} />
                  <ExpiryBadge label="Certifications" iso={viewing.certificationExpiry} />
                </div>
                {certList(viewing).length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    {certList(viewing).map((c, i) => (
                      <span key={i} className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-medium flex items-center gap-1"><Award className="w-3 h-3" />{c}</span>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <DetailField icon={Phone} label="Phone" value={viewing.phone || "—"} />
                <DetailField icon={Mail} label="Email" value={viewing.email || "—"} />
                <DetailField icon={IdCard} label="License #" value={viewing.licenseNumber || "—"} />
                <DetailField icon={FileText} label="License Class" value={viewing.licenseClass || "—"} />
                <DetailField icon={Calendar} label="License Expiry" value={viewing.licenseExpiry ? new Date(viewing.licenseExpiry).toLocaleDateString() : "—"} />
                <DetailField icon={Calendar} label="Cert. Expiry" value={viewing.certificationExpiry ? new Date(viewing.certificationExpiry).toLocaleDateString() : "—"} />
                <DetailField icon={Clock} label="Trip-Hours" value={`${viewing.tripHours.toFixed(1)} h`} />
                <DetailField icon={Calendar} label="Hire Date" value={viewing.hireDate ? new Date(viewing.hireDate).toLocaleDateString() : "—"} />
              </div>

              {viewing.notes && (
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded">
                  <p className="text-xs font-semibold text-yellow-700 mb-1">Notes</p>
                  <p className="text-sm text-gray-900">{viewing.notes}</p>
                </div>
              )}
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setViewing(null)} className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium">Close</button>
              <div className="flex gap-2">
                <button onClick={() => handleToggleActive(viewing)}
                  className={`px-4 py-2 font-semibold rounded-lg transition text-sm ${viewing.isActive ? "bg-gray-500 hover:bg-gray-600 text-white" : "bg-green-500 hover:bg-green-600 text-white"}`}>
                  {viewing.isActive ? <><UserX className="w-4 h-4 inline mr-1" /> Deactivate</> : <><UserCheck className="w-4 h-4 inline mr-1" /> Activate</>}
                </button>
                <button onClick={() => { setViewing(null); startEditing(viewing); }} className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white font-semibold rounded-lg transition text-sm">
                  <Edit className="w-4 h-4 inline mr-1" /> Edit
                </button>
                <button onClick={() => { handleDelete(viewing); setViewing(null); }} className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg transition text-sm">
                  <Trash2 className="w-4 h-4 inline mr-1" /> Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && <DriverFormModal title="Add Driver" form={createForm} onChange={setCreateForm} onSave={handleCreate} onCancel={() => setShowCreate(false)} saveLabel="Add Driver" />}

      {/* Edit Modal */}
      {editing && <DriverFormModal title="Edit Driver" form={editForm} onChange={setEditForm} onSave={handleSaveEdit} onCancel={() => setEditing(null)} saveLabel="Save Changes" />}
    </div>
  );
}

/* ── Sub-components ── */

function StatBox({ label, value, icon: Icon, color }: { label: string; value: string; icon: LucideIcon; color: string }) {
  const COLORS: Record<string, string> = {
    blue: "text-blue-600 bg-blue-50 border-blue-200",
    green: "text-green-600 bg-green-50 border-green-200",
    red: "text-red-600 bg-red-50 border-red-200",
    purple: "text-purple-600 bg-purple-50 border-purple-200",
    amber: "text-amber-600 bg-amber-50 border-amber-200",
  };
  const c = COLORS[color] || COLORS.blue;
  return (
    <div className={`rounded-lg border p-4 ${c}`}>
      <div className="flex items-center justify-between mb-0.5">
        <p className="text-xs font-semibold text-gray-600">{label}</p>
        <Icon className={`w-4 h-4 ${c.split(" ")[0]}`} />
      </div>
      <p className={`text-2xl sm:text-3xl font-bold ${c.split(" ")[0]}`}>{value}</p>
    </div>
  );
}

function DetailField({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="bg-gray-50 p-3 rounded border border-gray-200">
      <p className="text-xs text-gray-600 font-semibold flex items-center gap-1 mb-0.5"><Icon className="w-3 h-3" />{label}</p>
      <p className="text-sm font-semibold text-gray-900 break-words">{value}</p>
    </div>
  );
}

function Avatar({ name, small }: { name: string; small?: boolean }) {
  return (
    <div className={`${small ? "w-7 h-7 text-[10px]" : "w-10 h-10 text-sm"} rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-black font-bold flex items-center justify-center flex-shrink-0`}>
      {initials(name)}
    </div>
  );
}

function SafetyBar({ score, tall }: { score: number; tall?: boolean }) {
  const pct = Math.max(0, Math.min(100, score));
  const band = safetyBand(score);
  return (
    <div className={`${tall ? "h-3" : "h-1.5"} bg-gray-100 rounded-full overflow-hidden`}>
      <div className={`h-full rounded-full transition-all duration-500 ${band.bar}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function ExpiryBadge({ label, iso }: { label: string; iso: string }) {
  const { state, days } = expiryState(iso);
  if (state === "none") {
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-500">{label}: —</span>;
  }
  if (state === "expired") {
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700">{label}: Expired</span>;
  }
  if (state === "expiring") {
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700">{label}: Expires in {days}d</span>;
  }
  return <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-700">{label}: Valid</span>;
}

function DriverFormModal({ title, form, onChange, onSave, onCancel, saveLabel }: {
  title: string;
  form: typeof emptyForm;
  onChange: (f: typeof emptyForm) => void;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
}) {
  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onChange({ ...form, [field]: e.target.value });
  const input = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 mb-1";

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onCancel} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className={lbl}>Full Name</label>
              <input type="text" value={form.name} onChange={set("name")} className={input} placeholder="Juan Dela Cruz" />
            </div>
            <div>
              <label className={lbl}>Phone</label>
              <input type="tel" value={form.phone} onChange={set("phone")} className={input} placeholder="+63 9xx xxx xxxx" />
            </div>
            <div>
              <label className={lbl}>Email</label>
              <input type="email" value={form.email} onChange={set("email")} className={input} placeholder="driver@example.com" />
            </div>
            <div>
              <label className={lbl}>License Number</label>
              <input type="text" value={form.licenseNumber} onChange={set("licenseNumber")} className={input} />
            </div>
            <div>
              <label className={lbl}>License Class</label>
              <input type="text" value={form.licenseClass} onChange={set("licenseClass")} className={input} placeholder="B, C, D…" />
            </div>
            <div>
              <label className={lbl}>License Expiry</label>
              <input type="date" value={form.licenseExpiry} onChange={set("licenseExpiry")} className={input} />
            </div>
            <div>
              <label className={lbl}>Certification Expiry</label>
              <input type="date" value={form.certificationExpiry} onChange={set("certificationExpiry")} className={input} />
            </div>
            <div className="sm:col-span-2">
              <label className={lbl}>Certifications (comma-separated)</label>
              <input type="text" value={form.certifications} onChange={set("certifications")} className={input} placeholder="Wheelchair Transport, First Aid, BLS" />
            </div>
            <div>
              <label className={lbl}>Safety Score (0–100)</label>
              <input type="number" min="0" max="100" step="0.1" value={form.safetyScore} onChange={set("safetyScore")} className={input} />
            </div>
            <div>
              <label className={lbl}>Hire Date</label>
              <input type="date" value={form.hireDate} onChange={set("hireDate")} className={input} />
            </div>
            <div className="sm:col-span-2">
              <label className={lbl}>Notes</label>
              <textarea value={form.notes} onChange={set("notes")} rows={2} className={input} />
            </div>
          </div>
        </div>
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
          <button onClick={onCancel} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Cancel</button>
          <button onClick={onSave} className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">{saveLabel}</button>
        </div>
      </div>
    </div>
  );
}
