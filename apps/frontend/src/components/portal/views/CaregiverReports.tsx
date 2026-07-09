"use client";

import { useMemo, useState, useEffect } from "react";
import {
  FileText, Plus, Download, Search, X, Eye, Trash2, PenLine,
  AlertTriangle, CheckCircle2, Clock, Sun, Sunset, Moon, RefreshCw,
  type LucideIcon,
} from "lucide-react";
import Swal from "sweetalert2";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";

/* ── Types ───────────────────────────────────────────────────────────── */

type ShiftType = "MORNING" | "AFTERNOON" | "NIGHT" | "OVERNIGHT";
type RangeKey = "all" | "today" | "7d" | "30d";

interface ShiftReport {
  id: string;
  shiftType: ShiftType | string;
  date: string | null;
  summary: string | null;
  residentUpdates: string | null;
  incidentsOccurred: boolean;
  incidentDetails: string | null;
  medicationsAdministered: string | null;
  taskCompleted: string | null;
  handoverNotes: string | null;
  signedAt: string | null;
  createdAt: string | null;
}

interface ReportForm {
  shiftType: ShiftType;
  date: string;
  summary: string;
  residentUpdates: string;
  incidentsOccurred: boolean;
  incidentDetails: string;
  medicationsAdministered: string;
  taskCompleted: string;
  handoverNotes: string;
}

/* ── Static metadata ─────────────────────────────────────────────────── */

const SHIFTS: Record<ShiftType, { label: string; icon: LucideIcon; badge: string }> = {
  MORNING: { label: "Morning", icon: Sun, badge: "bg-amber-100 text-amber-800 border-amber-300" },
  AFTERNOON: { label: "Afternoon", icon: Sunset, badge: "bg-orange-100 text-orange-800 border-orange-300" },
  NIGHT: { label: "Night", icon: Moon, badge: "bg-indigo-100 text-indigo-800 border-indigo-300" },
  OVERNIGHT: { label: "Overnight", icon: Moon, badge: "bg-purple-100 text-purple-800 border-purple-300" },
};

const RANGE_MS: Record<Exclude<RangeKey, "all" | "today">, number> = {
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const EMPTY_FORM = (): ReportForm => ({
  shiftType: "MORNING",
  date: new Date().toISOString().slice(0, 16),
  summary: "",
  residentUpdates: "",
  incidentsOccurred: false,
  incidentDetails: "",
  medicationsAdministered: "",
  taskCompleted: "",
  handoverNotes: "",
});

/* ── Helpers ─────────────────────────────────────────────────────────── */

const asStr = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

function toReport(row: Record<string, unknown>): ShiftReport {
  return {
    id: String(row.id),
    shiftType: row.shiftType ? String(row.shiftType) : "MORNING",
    date: asStr(row.date),
    summary: asStr(row.summary),
    residentUpdates: asStr(row.residentUpdates),
    incidentsOccurred: Boolean(row.incidentsOccurred),
    incidentDetails: asStr(row.incidentDetails),
    medicationsAdministered: asStr(row.medicationsAdministered),
    taskCompleted: asStr(row.taskCompleted),
    handoverNotes: asStr(row.handoverNotes),
    signedAt: asStr(row.signedAt),
    createdAt: asStr(row.createdAt),
  };
}

const shiftMeta = (t: string) => SHIFTS[t as ShiftType] ?? SHIFTS.MORNING;
const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function exportCsv(rows: ShiftReport[]): void {
  const headers = [
    "Date", "Shift", "Summary", "Resident Updates", "Incident", "Incident Details",
    "Medications", "Tasks Completed", "Handover Notes", "Signed",
  ];
  const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  rows.forEach((r) =>
    lines.push(
      [
        r.date ? new Date(r.date).toLocaleString() : "",
        shiftMeta(String(r.shiftType)).label,
        r.summary, r.residentUpdates,
        r.incidentsOccurred ? "Yes" : "No", r.incidentDetails,
        r.medicationsAdministered, r.taskCompleted, r.handoverNotes,
        r.signedAt ? "Signed" : "Unsigned",
      ].map(esc).join(",")
    )
  );
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `shift-reports-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Component ───────────────────────────────────────────────────────── */

export default function CaregiverReports() {
  const { data: rows, loading, error, refetch } = useLiveQuery<Record<string, unknown>>(
    "shift-reports",
    { tables: ["ShiftReport"] }
  );
  const reports = useMemo<ShiftReport[]>(() => rows.map(toReport), [rows]);

  const [search, setSearch] = useState("");
  const [shiftFilter, setShiftFilter] = useState<"all" | ShiftType>("all");
  const [range, setRange] = useState<RangeKey>("all");
  const [incidentsOnly, setIncidentsOnly] = useState(false);
  const [perPage, setPerPage] = useState(9);
  const [page, setPage] = useState(1);

  const [viewing, setViewing] = useState<ShiftReport | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ReportForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Current time held in state (reading the clock during render is impure).
  // Ticks on mount + hourly so date-range filters stay fresh without churn.
  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  /* Derived summary (realtime — recomputes on every live refetch) */
  const summary = useMemo(() => {
    const now = new Date(nowTs);
    return {
      total: reports.length,
      today: reports.filter((r) => r.date && isSameDay(new Date(r.date), now)).length,
      incidents: reports.filter((r) => r.incidentsOccurred).length,
      unsigned: reports.filter((r) => !r.signedAt).length,
    };
  }, [reports, nowTs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = nowTs;
    return reports.filter((r) => {
      const haystack = [r.summary, r.handoverNotes, r.residentUpdates, r.incidentDetails, r.taskCompleted]
        .filter(Boolean).join(" ").toLowerCase();
      if (q && !haystack.includes(q)) return false;
      if (shiftFilter !== "all" && r.shiftType !== shiftFilter) return false;
      if (incidentsOnly && !r.incidentsOccurred) return false;
      if (range !== "all" && r.date) {
        const t = new Date(r.date).getTime();
        if (range === "today") {
          if (!isSameDay(new Date(r.date), new Date(nowTs))) return false;
        } else if (now - t > RANGE_MS[range]) return false;
      }
      return true;
    });
  }, [reports, search, shiftFilter, incidentsOnly, range, nowTs]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const start = (page - 1) * perPage;
  const paginated = filtered.slice(start, start + perPage);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset paging when filters change
    setPage(1);
  }, [search, shiftFilter, range, incidentsOnly, perPage]);

  /* Mutations */
  const handleCreate = async () => {
    if (!form.summary.trim()) {
      Swal.fire({ title: "Summary required", text: "Add a shift summary before saving.", icon: "warning" });
      return;
    }
    setSaving(true);
    try {
      await createRecord("shift-reports", {
        shiftType: form.shiftType,
        date: new Date(form.date).toISOString(),
        summary: form.summary.trim(),
        residentUpdates: form.residentUpdates.trim() || null,
        incidentsOccurred: form.incidentsOccurred,
        incidentDetails: form.incidentsOccurred ? form.incidentDetails.trim() || null : null,
        medicationsAdministered: form.medicationsAdministered.trim() || null,
        taskCompleted: form.taskCompleted.trim() || null,
        handoverNotes: form.handoverNotes.trim() || null,
      });
      await refetch();
      setCreating(false);
      setForm(EMPTY_FORM());
      Swal.fire({ title: "Report Saved", icon: "success", timer: 1400, showConfirmButton: false });
    } catch (err) {
      Swal.fire({
        title: "Save Failed",
        text: err instanceof Error ? err.message : "Could not save report.",
        icon: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSign = async (r: ShiftReport) => {
    try {
      await updateRecord("shift-reports", r.id, { signedAt: new Date().toISOString() });
      await refetch();
      setViewing((v) => (v && v.id === r.id ? { ...v, signedAt: new Date().toISOString() } : v));
    } catch (err) {
      Swal.fire({
        title: "Sign Failed",
        text: err instanceof Error ? err.message : "Could not sign report.",
        icon: "error",
      });
    }
  };

  const handleDelete = async (r: ShiftReport) => {
    const result = await Swal.fire({
      title: "Delete Report?",
      text: "This shift report will be permanently removed.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Delete",
    });
    if (!result.isConfirmed) return;
    try {
      await deleteRecord("shift-reports", r.id);
      await refetch();
      setViewing((v) => (v && v.id === r.id ? null : v));
      Swal.fire({ title: "Deleted", icon: "success", timer: 1300, showConfirmButton: false });
    } catch (err) {
      Swal.fire({
        title: "Delete Failed",
        text: err instanceof Error ? err.message : "Could not delete report.",
        icon: "error",
      });
    }
  };

  const setField = <K extends keyof ReportForm>(key: K, value: ReportForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  /* ── Render ────────────────────────────────────────────────────────── */
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent mb-1 flex items-center gap-2">
            <FileText className="w-7 h-7 text-yellow-500 flex-shrink-0" />
            Shift Reports
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-green-600">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live
            </span>
            Handovers, incidents & shift summaries
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => void refetch()}
            className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium"
            title="Refresh now"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button
            onClick={() => exportCsv(filtered)}
            disabled={filtered.length === 0}
            className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" /> Export
          </button>
          <button
            onClick={() => { setForm(EMPTY_FORM()); setCreating(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm"
          >
            <Plus className="w-4 h-4" /> New Report
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <SummaryCard label="Total Reports" value={summary.total} icon={FileText} tone="gray" />
        <SummaryCard label="Today" value={summary.today} icon={Clock} tone="blue" />
        <SummaryCard label="Incidents Flagged" value={summary.incidents} icon={AlertTriangle} tone="red" />
        <SummaryCard label="Awaiting Sign-off" value={summary.unsigned} icon={PenLine} tone="amber" />
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search summaries, handovers, updates, incidents…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <select
            value={shiftFilter}
            onChange={(e) => setShiftFilter(e.target.value as "all" | ShiftType)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none"
          >
            <option value="all">All Shifts</option>
            <option value="MORNING">Morning</option>
            <option value="AFTERNOON">Afternoon</option>
            <option value="NIGHT">Night</option>
            <option value="OVERNIGHT">Overnight</option>
          </select>
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as RangeKey)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none"
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </select>
          <select
            value={perPage}
            onChange={(e) => setPerPage(parseInt(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none"
          >
            <option value={9}>9 per page</option>
            <option value={18}>18 per page</option>
            <option value={36}>36 per page</option>
          </select>
          <label className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 select-none">
            <input
              type="checkbox"
              checked={incidentsOnly}
              onChange={(e) => setIncidentsOnly(e.target.checked)}
              className="w-4 h-4 rounded"
            />
            <span className="text-sm text-gray-700 font-medium">Incidents only</span>
          </label>
        </div>
      </div>

      {/* List */}
      {loading && reports.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">Loading reports…</div>
      ) : error ? (
        <div className="bg-white rounded-lg border border-red-200 p-10 text-center text-red-600">Failed to load reports: {error}</div>
      ) : paginated.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {paginated.map((r) => {
            const meta = shiftMeta(String(r.shiftType));
            const ShiftIcon = meta.icon;
            return (
              <div
                key={r.id}
                className={`bg-white rounded-lg border p-4 flex flex-col hover:shadow-md transition ${
                  r.incidentsOccurred ? "border-red-200" : "border-gray-200 hover:border-yellow-300"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold border ${meta.badge}`}>
                    <ShiftIcon className="w-3.5 h-3.5" /> {meta.label}
                  </span>
                  <span className="text-xs text-gray-500">
                    {r.date ? new Date(r.date).toLocaleDateString() : "—"}
                  </span>
                </div>

                <p className="text-gray-900 font-medium line-clamp-2 mb-2">{r.summary ?? "No summary provided"}</p>

                <div className="flex flex-wrap gap-1.5 mb-3">
                  {r.incidentsOccurred && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-semibold">
                      <AlertTriangle className="w-3 h-3" /> Incident
                    </span>
                  )}
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${
                      r.signedAt ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {r.signedAt ? <CheckCircle2 className="w-3 h-3" /> : <PenLine className="w-3 h-3" />}
                    {r.signedAt ? "Signed" : "Unsigned"}
                  </span>
                </div>

                {r.handoverNotes && (
                  <p className="text-sm text-gray-600 p-2 bg-gray-50 rounded border-l-2 border-yellow-400 line-clamp-2 mb-3">
                    📝 {r.handoverNotes}
                  </p>
                )}

                <div className="mt-auto flex items-center gap-1 pt-2 border-t border-gray-100">
                  <button
                    onClick={() => setViewing(r)}
                    className="flex items-center gap-1 px-2.5 py-1 text-blue-600 hover:bg-blue-50 rounded text-sm font-medium transition"
                  >
                    <Eye className="w-4 h-4" /> View
                  </button>
                  {!r.signedAt && (
                    <button
                      onClick={() => void handleSign(r)}
                      className="flex items-center gap-1 px-2.5 py-1 text-green-600 hover:bg-green-50 rounded text-sm font-medium transition"
                    >
                      <PenLine className="w-4 h-4" /> Sign
                    </button>
                  )}
                  <button
                    onClick={() => void handleDelete(r)}
                    className="flex items-center gap-1 px-2.5 py-1 text-red-600 hover:bg-red-50 rounded text-sm font-medium transition ml-auto"
                  >
                    <Trash2 className="w-4 h-4" /> Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">
          {reports.length === 0 ? "No shift reports yet. Create the first one." : "No reports match your filters."}
        </div>
      )}

      {/* Pagination */}
      {filtered.length > perPage && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="text-sm text-gray-600">
            Showing {start + 1}-{Math.min(start + perPage, filtered.length)} of {filtered.length} reports
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
            >
              Previous
            </button>
            <span className="px-3 py-2 text-sm font-medium text-gray-700">Page {page} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* View modal */}
      {viewing && (
        <Modal title="Shift Report" onClose={() => setViewing(null)}>
          <div className="p-6 sm:p-8 space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-bold border ${shiftMeta(String(viewing.shiftType)).badge}`}>
                {shiftMeta(String(viewing.shiftType)).label}
              </span>
              <span className="text-sm text-gray-600">
                {viewing.date ? new Date(viewing.date).toLocaleString() : "—"}
              </span>
              <span
                className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-bold ml-auto ${
                  viewing.signedAt ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
                }`}
              >
                {viewing.signedAt ? "Signed" : "Unsigned"}
              </span>
            </div>

            <Field label="Summary">{viewing.summary ?? "—"}</Field>
            <Field label="Resident Updates">{viewing.residentUpdates ?? "—"}</Field>
            <div className={`p-3 rounded-lg border ${viewing.incidentsOccurred ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-200"}`}>
              <p className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
                <AlertTriangle className={`w-4 h-4 ${viewing.incidentsOccurred ? "text-red-500" : "text-gray-400"}`} />
                Incidents: {viewing.incidentsOccurred ? "Yes" : "None"}
              </p>
              {viewing.incidentsOccurred && <p className="text-gray-900 text-sm">{viewing.incidentDetails ?? "No details recorded."}</p>}
            </div>
            <Field label="Medications Administered">{viewing.medicationsAdministered ?? "—"}</Field>
            <Field label="Tasks Completed">{viewing.taskCompleted ?? "—"}</Field>
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded">
              <p className="text-sm font-semibold text-gray-700 mb-1">Handover Notes</p>
              <p className="text-gray-900 text-sm">{viewing.handoverNotes ?? "—"}</p>
            </div>
          </div>
          <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 sm:px-8 py-4 flex items-center justify-between gap-2">
            <button onClick={() => setViewing(null)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Close</button>
            <div className="flex gap-2">
              {!viewing.signedAt && (
                <button
                  onClick={() => void handleSign(viewing)}
                  className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-green-400 to-green-500 text-white font-semibold rounded-lg hover:shadow-lg transition"
                >
                  <PenLine className="w-4 h-4" /> Sign Off
                </button>
              )}
              <button
                onClick={() => void handleDelete(viewing)}
                className="flex items-center gap-2 px-5 py-2 bg-red-50 text-red-600 border border-red-200 font-semibold rounded-lg hover:bg-red-100 transition"
              >
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Create modal */}
      {creating && (
        <Modal title="New Shift Report" onClose={() => setCreating(false)}>
          <div className="p-6 sm:p-8 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Shift Type</label>
                <select
                  value={form.shiftType}
                  onChange={(e) => setField("shiftType", e.target.value as ShiftType)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none"
                >
                  <option value="MORNING">Morning</option>
                  <option value="AFTERNOON">Afternoon</option>
                  <option value="NIGHT">Night</option>
                  <option value="OVERNIGHT">Overnight</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Shift Date &amp; Time</label>
                <input
                  type="datetime-local"
                  value={form.date}
                  onChange={(e) => setField("date", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none"
                />
              </div>
            </div>

            <TextArea label="Summary *" value={form.summary} onChange={(v) => setField("summary", v)} placeholder="Overall shift summary…" />
            <TextArea label="Resident Updates" value={form.residentUpdates} onChange={(v) => setField("residentUpdates", v)} placeholder="Per-resident notes…" />

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.incidentsOccurred}
                onChange={(e) => setField("incidentsOccurred", e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <span className="text-sm font-semibold text-gray-700">Incident(s) occurred this shift</span>
            </label>
            {form.incidentsOccurred && (
              <TextArea label="Incident Details" value={form.incidentDetails} onChange={(v) => setField("incidentDetails", v)} placeholder="What happened, actions taken…" />
            )}

            <TextArea label="Medications Administered" value={form.medicationsAdministered} onChange={(v) => setField("medicationsAdministered", v)} placeholder="Meds given, times, doses…" />
            <TextArea label="Tasks Completed" value={form.taskCompleted} onChange={(v) => setField("taskCompleted", v)} placeholder="Tasks finished during shift…" />
            <TextArea label="Handover Notes" value={form.handoverNotes} onChange={(v) => setField("handoverNotes", v)} placeholder="For the next shift…" />
          </div>
          <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 sm:px-8 py-4 flex items-center justify-between gap-2">
            <button onClick={() => setCreating(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Cancel</button>
            <button
              onClick={() => void handleCreate()}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-60"
            >
              <Plus className="w-4 h-4" /> {saving ? "Saving…" : "Save Report"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ── Presentational sub-components ───────────────────────────────────── */

const TONES: Record<string, { wrap: string; icon: string; value: string }> = {
  gray: { wrap: "bg-white border-gray-200", icon: "text-gray-500", value: "text-gray-900" },
  blue: { wrap: "bg-blue-50 border-blue-200", icon: "text-blue-500", value: "text-blue-600" },
  red: { wrap: "bg-red-50 border-red-200", icon: "text-red-500", value: "text-red-600" },
  amber: { wrap: "bg-amber-50 border-amber-200", icon: "text-amber-500", value: "text-amber-600" },
};

function SummaryCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: LucideIcon; tone: keyof typeof TONES }) {
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm font-semibold text-gray-600 mb-1">{label}</p>
      <p className="text-gray-900 text-sm whitespace-pre-wrap">{children}</p>
    </div>
  );
}

function TextArea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none resize-y"
      />
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black p-5 sm:p-6 flex items-center justify-between z-10">
          <h2 className="text-xl sm:text-2xl font-bold">{title}</h2>
          <button onClick={onClose} className="p-2 hover:bg-black/10 rounded-lg transition">
            <X className="w-6 h-6" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
