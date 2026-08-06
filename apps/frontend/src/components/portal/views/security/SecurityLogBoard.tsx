"use client";

import RefreshButton from "@/components/portal/RefreshButton";

import { useMemo, useState, useEffect } from "react";
import {
  Shield, Plus, X, Trash2, Search, CheckCircle2, Loader2,
  MapPin, ClipboardList, AlertTriangle, DoorOpen, Camera, Upload, FileWarning,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";

/**
 * Guard/Security log desk — live via Supabase realtime + polling fallback.
 * Guards record patrols, incidents, gate events, visitor sign-ins and hazards,
 * then resolve them. Tenant scope is injected server-side.
 */

type Row = Record<string, unknown>;

const adaptLog = (r: Row) => ({
  id: String(r.id ?? ""),
  logType: String(r.logType ?? "PATROL"),
  title: String(r.title ?? ""),
  description: String(r.description ?? ""),
  location: String(r.location ?? ""),
  severity: String(r.severity ?? "MINOR"),
  residentName: String(r.residentName ?? ""),
  guardName: String(r.guardName ?? ""),
  status: String(r.status ?? "OPEN"),
  occurredAt: r.occurredAt ? String(r.occurredAt) : "",
  createdAt: String(r.createdAt ?? ""),
});
type SecurityLog = ReturnType<typeof adaptLog>;

const LOG_TYPES = ["PATROL", "INCIDENT", "GATE_EVENT", "VISITOR", "HAZARD"] as const;
const SEVERITIES = ["MINOR", "MODERATE", "SEVERE", "CRITICAL"] as const;
const STATUSES = ["OPEN", "RESOLVED"] as const;

const TYPE_LABEL: Record<string, string> = {
  PATROL: "Patrol",
  INCIDENT: "Incident",
  GATE_EVENT: "Gate Event",
  VISITOR: "Visitor",
  HAZARD: "Hazard",
};

const TYPE_PILL: Record<string, string> = {
  PATROL: "bg-blue-100 text-blue-800 border-blue-200",
  INCIDENT: "bg-red-100 text-red-800 border-red-200",
  GATE_EVENT: "bg-indigo-100 text-indigo-800 border-indigo-200",
  VISITOR: "bg-emerald-100 text-emerald-800 border-emerald-200",
  HAZARD: "bg-orange-100 text-orange-800 border-orange-200",
};

const SEVERITY_PILL: Record<string, string> = {
  MINOR: "bg-gray-100 text-gray-700",
  MODERATE: "bg-yellow-100 text-yellow-800",
  SEVERE: "bg-orange-100 text-orange-800",
  CRITICAL: "bg-red-100 text-red-700",
};

const STATUS_PILL: Record<string, string> = {
  OPEN: "bg-amber-100 text-amber-800",
  RESOLVED: "bg-green-100 text-green-800",
};

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time (no timezone suffix).
const nowLocalInput = () => {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
};

const emptyForm = {
  logType: "PATROL",
  title: "",
  description: "",
  location: "",
  severity: "MINOR",
  residentId: "",
  guardName: "",
  photoUrl: "",
  occurredAt: nowLocalInput(),
};

// Log types that are filed as an Incident Report visible to the care team.
const INCIDENT_TYPES = new Set(["INCIDENT", "HAZARD"]);

export default function SecurityLogBoard() {
  const { data: rows, loading, error, refetch } = useLiveQuery<Row>(
    "security-logs", { query: "take=300", tables: ["SecurityLog"] }
  );
  // Residents — so an incident/hazard log can be linked to the resident involved
  // and cross-posted to the care team's Incident Report feed.
  const { data: residentRows } = useLiveQuery<Row>(
    "residents", { query: "take=300", tables: ["Resident"] }
  );
  const residentOpts = useMemo(
    () => residentRows
      .map((r) => ({ id: String(r.id), name: `${String(r.firstName ?? "")} ${String(r.lastName ?? "")}`.trim() || "Resident", room: String(r.roomNumber ?? "") }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [residentRows]
  );

  const logs = useMemo<SecurityLog[]>(() => rows.map(adaptLog), [rows]);

  // The signed-in guard — auto-fills their name on new logs and links the
  // cross-posted incident's reporter (Staff) when available.
  const [me, setMe] = useState<{ name: string; staffId: string | null }>({ name: "", staffId: null });
  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((b) => { if (active) setMe({ name: String(b?.session?.name ?? ""), staffId: b?.session?.staffId ? String(b.session.staffId) : null }); })
      .catch(() => { /* non-fatal */ });
    return () => { active = false; };
  }, []);

  // Downscale + read the scene photo to a data URI (no external storage needed);
  // stored on the cross-posted Incident, which carries the photoUrl column.
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
        if (!ctx) { setForm((f) => ({ ...f, photoUrl: String(reader.result) })); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setForm((f) => ({ ...f, photoUrl: canvas.toDataURL("image/jpeg", 0.7) }));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const openCreate = () => { setForm({ ...emptyForm, guardName: me.name, occurredAt: nowLocalInput() }); setShowCreate(true); };

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const perPage = 12;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter(l => {
      if (q &&
        !l.title.toLowerCase().includes(q) &&
        !l.description.toLowerCase().includes(q) &&
        !l.location.toLowerCase().includes(q) &&
        !l.residentName.toLowerCase().includes(q) &&
        !l.guardName.toLowerCase().includes(q)) return false;
      if (typeFilter !== "all" && l.logType !== typeFilter) return false;
      if (severityFilter !== "all" && l.severity !== severityFilter) return false;
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      return true;
    });
  }, [logs, search, typeFilter, severityFilter, statusFilter]);

  const stats = useMemo(() => ({
    total: logs.length,
    open: logs.filter(l => l.status === "OPEN").length,
    incidents: logs.filter(l => l.logType === "INCIDENT").length,
    gateEvents: logs.filter(l => l.logType === "GATE_EVENT").length,
  }), [logs]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  /* ── Actions ── */

  const handleCreate = async () => {
    if (!form.title.trim()) {
      Swal.fire({ title: "Missing Fields", text: "A log title is required.", icon: "warning" });
      return;
    }
    const isIncident = INCIDENT_TYPES.has(form.logType);
    const resident = residentOpts.find((r) => r.id === form.residentId);
    const guard = form.guardName.trim() || me.name || "Security";
    const occurredIso = form.occurredAt ? new Date(form.occurredAt).toISOString() : new Date().toISOString();
    try {
      await createRecord("security-logs", {
        logType: form.logType,
        title: form.title.trim(),
        description: form.description || null,
        location: form.location || null,
        severity: form.severity,
        residentId: form.residentId || null,
        residentName: resident?.name || null,
        guardName: guard,
        guardStaffId: me.staffId || null,
        status: "OPEN",
        occurredAt: occurredIso,
      });

      // Cross-post incident/hazard logs to the shared Incident feed so the Care
      // Manager, Nurse & Caregiver see them in their Incident Reports. The
      // Incident model requires a resident, so it only cross-posts when one is
      // selected; the guard's name + submitted time are recorded in the body
      // (there is no reporter-name column) and the photo rides on the Incident.
      let crossPosted = false;
      if (isIncident && form.residentId) {
        const stamp = `Filed by Security: ${guard} — logged ${new Date().toLocaleString()}.`;
        const body = form.description.trim() ? `${stamp}\n\n${form.description.trim()}` : stamp;
        await createRecord("incidents", {
          residentId: form.residentId,
          incidentType: form.logType === "HAZARD" ? "SAFETY_HAZARD" : "OTHER",
          severity: form.severity,
          title: form.title.trim(),
          description: body,
          location: form.location || null,
          photoUrl: form.photoUrl || null,
          reportedById: me.staffId || null,
          incidentDate: occurredIso,
        });
        crossPosted = true;
      }

      await refetch();
      setShowCreate(false);
      setForm({ ...emptyForm, occurredAt: nowLocalInput() });
      if (crossPosted) {
        Swal.fire({ title: "Incident Reported", text: "Security log saved and filed as an incident report — visible to the Care Manager, Nurse & Caregiver.", icon: "success", timer: 2400, showConfirmButton: false });
      } else if (isIncident && !form.residentId) {
        Swal.fire({ title: "Log Recorded", text: "Saved as a security log. Tip: select the resident involved to also file it as an incident report (with the photo) for the care team.", icon: "info" });
      } else {
        Swal.fire({ title: "Log Recorded", text: `${TYPE_LABEL[form.logType]} entry saved.`, icon: "success", timer: 1600, showConfirmButton: false });
      }
    } catch (err) {
      Swal.fire({ title: "Save Failed", text: err instanceof Error ? err.message : "Could not record log.", icon: "error" });
    }
  };

  const handleResolve = async (l: SecurityLog) => {
    setBusyId(l.id);
    try {
      await updateRecord("security-logs", l.id, { status: "RESOLVED" });
      await refetch();
    } catch (err) {
      Swal.fire({ title: "Update Failed", text: err instanceof Error ? err.message : "Could not resolve log.", icon: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (l: SecurityLog) => {
    const confirmed = await Swal.fire({
      title: "Delete Log?", text: "Remove this security log permanently?", icon: "warning",
      showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Delete",
    });
    if (!confirmed.isConfirmed) return;
    try {
      await deleteRecord("security-logs", l.id);
      await refetch();
    } catch (err) {
      Swal.fire({ title: "Delete Failed", text: err instanceof Error ? err.message : "Could not delete log.", icon: "error" });
    }
  };

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const value = e.target.value;
    setForm(f => ({ ...f, [field]: value }));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-slate-700 to-slate-900 bg-clip-text text-transparent mb-2">
            Security Log
          </h1>
          <p className="text-gray-600">Guard patrols · incidents · gate events · visitor sign-ins · hazards</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <RefreshButton onRefresh={() => void refetch()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium" />
          <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-slate-700 to-slate-900 text-white font-semibold rounded-lg hover:shadow-lg transition active:scale-95">
            <Plus className="w-4 h-4" /> New Log
          </button>
        </div>
      </div>

      {/* Stat Boxes */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatBox label="Total Logs" value={String(stats.total)} icon={ClipboardList} color="blue" />
        <StatBox label="Open" value={String(stats.open)} icon={Shield} color="amber" />
        <StatBox label="Incidents" value={String(stats.incidents)} icon={AlertTriangle} color="red" />
        <StatBox label="Gate Events" value={String(stats.gateEvents)} icon={DoorOpen} color="indigo" />
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          {["all", ...LOG_TYPES].map(t => (
            <button key={t} onClick={() => { setTypeFilter(t); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition border ${
                typeFilter === t
                  ? "bg-slate-800 text-white border-slate-800"
                  : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
              }`}>
              {t === "all" ? "All Types" : TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Search title, location, guard, resident…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 focus:border-transparent outline-none" />
          </div>
          <select value={severityFilter} onChange={e => { setSeverityFilter(e.target.value); setPage(1); }}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-slate-400 outline-none">
            <option value="all">All Severities</option>
            {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-slate-400 outline-none">
            <option value="all">All Status</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {/* Log table */}
      {loading && logs.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading security logs...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">No security logs match your filters.</div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Log</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Type</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Severity</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Location</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Time</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginated.map(l => {
                const busy = busyId === l.id;
                return (
                  <tr key={l.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{l.title}</p>
                      {l.description && <p className="text-xs text-gray-500 max-w-[260px] truncate" title={l.description}>{l.description}</p>}
                      {(l.residentName || l.guardName) && (
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {l.residentName && <span>Resident: {l.residentName}</span>}
                          {l.residentName && l.guardName && " · "}
                          {l.guardName && <span>Guard: {l.guardName}</span>}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${TYPE_PILL[l.logType] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}>
                        {TYPE_LABEL[l.logType] ?? l.logType}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${SEVERITY_PILL[l.severity] ?? SEVERITY_PILL.MINOR}`}>{l.severity}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      {l.location ? (
                        <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> {l.location}</span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">
                      {l.occurredAt ? new Date(l.occurredAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_PILL[l.status] ?? "bg-gray-100 text-gray-700"}`}>{l.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1 flex-wrap">
                        {busy ? (
                          <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                        ) : (
                          <>
                            {l.status === "OPEN" && (
                              <button onClick={() => handleResolve(l)} className="p-1.5 rounded hover:bg-green-100 text-green-600 transition" title="Mark Resolved"><CheckCircle2 className="w-4 h-4" /></button>
                            )}
                            <button onClick={() => handleDelete(l)} className="p-1.5 rounded hover:bg-red-100 text-red-600 transition" title="Delete"><Trash2 className="w-4 h-4" /></button>
                          </>
                        )}
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
          <div className="text-sm text-gray-600">{filtered.length} logs total</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">Previous</button>
            <span className="px-3 py-2 text-sm font-medium text-gray-700">Page {page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">Next</button>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-slate-700 to-slate-900 text-white p-5 flex items-center justify-between z-10">
              <h2 className="text-xl font-bold">New Security Log</h2>
              <button onClick={() => setShowCreate(false)} className="p-2 hover:bg-white/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Log Type</label>
                  <select value={form.logType} onChange={set("logType")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-slate-400 outline-none">
                    {LOG_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Severity</label>
                  <select value={form.severity} onChange={set("severity")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-slate-400 outline-none">
                    {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Title</label>
                  <input type="text" value={form.title} onChange={set("title")} placeholder="e.g. Perimeter patrol — north gate" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 outline-none" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Description</label>
                  <textarea value={form.description} onChange={set("description")} rows={3} placeholder="What happened / observations…" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Location</label>
                  <input type="text" value={form.location} onChange={set("location")} placeholder="e.g. Main lobby" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Occurred At</label>
                  <input type="datetime-local" value={form.occurredAt} onChange={set("occurredAt")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Resident {INCIDENT_TYPES.has(form.logType) ? <span className="text-slate-500 font-normal">(needed to file as incident)</span> : <span className="text-gray-400 font-normal">(optional)</span>}</label>
                  <select value={form.residentId} onChange={set("residentId")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-slate-400 outline-none">
                    <option value="">Not resident-related…</option>
                    {residentOpts.map((r) => <option key={r.id} value={r.id}>{r.name}{r.room ? ` — Room ${r.room}` : ""}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Guard <span className="text-gray-400 font-normal">(reporting)</span></label>
                  <input type="text" value={form.guardName} onChange={set("guardName")} placeholder="Reporting guard" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 outline-none" />
                </div>
              </div>

              {/* Incident report — photo + cross-post notice (incident/hazard logs only) */}
              {INCIDENT_TYPES.has(form.logType) && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
                  <p className="flex items-start gap-2 text-xs text-slate-600">
                    <FileWarning className="w-4 h-4 flex-shrink-0 mt-0.5 text-slate-500" />
                    Filed as an <strong>Incident Report</strong> — visible to the Care Manager, Nurse &amp; Caregiver, stamped with your name and the submit time. Select the resident involved to include it.
                  </p>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Photo <span className="text-gray-400 font-normal">(optional)</span></label>
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* capture="environment" opens the rear camera on a phone. */}
                      <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700 text-white text-sm font-semibold hover:bg-slate-800 cursor-pointer">
                        <Camera className="w-4 h-4" /> Take Photo
                        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} />
                      </label>
                      <label className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-100 cursor-pointer">
                        <Upload className="w-4 h-4" /> Upload
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} />
                      </label>
                      {form.photoUrl && (
                        <div className="flex items-center gap-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={form.photoUrl} alt="incident" className="h-12 w-12 object-cover rounded border border-gray-200" />
                          <button type="button" onClick={() => setForm((f) => ({ ...f, photoUrl: "" }))} className="text-xs text-red-600 hover:underline">Remove</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex flex-wrap items-center justify-between gap-2">
              <button onClick={() => setShowCreate(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Cancel</button>
              <button onClick={handleCreate} className="px-5 py-2 bg-gradient-to-r from-slate-700 to-slate-900 text-white font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">Record Log</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ── */

function StatBox({ label, value, icon: Icon, color }: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; color: string }) {
  const COLORS: Record<string, string> = {
    blue: "text-blue-600 bg-blue-50 border-blue-200",
    green: "text-green-600 bg-green-50 border-green-200",
    red: "text-red-600 bg-red-50 border-red-200",
    indigo: "text-indigo-600 bg-indigo-50 border-indigo-200",
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
