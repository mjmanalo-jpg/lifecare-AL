"use client";

import { useMemo, useState, useEffect } from "react";
import {
  FileText, Plus, Download, Search, X, Eye, Trash2, PenLine,
  AlertTriangle, CheckCircle2, Clock, Sun, Sunset, Moon, RefreshCw,
  ListChecks, BarChart3, TrendingUp, Sparkles,
  type LucideIcon,
} from "lucide-react";
import Swal from "@/lib/swal";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";
import ShiftContinuityPanel from "./ShiftContinuityPanel";

/* ── Types ───────────────────────────────────────────────────────────── */

type ShiftType = "MORNING" | "AFTERNOON" | "NIGHT" | "OVERNIGHT";
type RangeKey = "all" | "today" | "7d" | "30d";

interface ShiftReport {
  id: string;
  userId: string | null;
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
  aiSummary: string | null;
  acknowledgedByName: string | null;
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
    userId: asStr(row.userId),
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
    aiSummary: asStr(row.aiSummary),
    acknowledgedByName: asStr(row.acknowledgedByName),
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

  const [view, setView] = useState<"list" | "analytics">("list");
  const [search, setSearch] = useState("");
  const [shiftFilter, setShiftFilter] = useState<"all" | ShiftType>("all");
  const [range, setRange] = useState<RangeKey>("all");
  const [incidentsOnly, setIncidentsOnly] = useState(false);
  const [perPage, setPerPage] = useState(9);
  const [page, setPage] = useState(1);

  const [viewing, setViewing] = useState<ShiftReport | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ReportForm>(EMPTY_FORM);
  const [me, setMe] = useState<{ userId: string | null; staffId: string | null; name: string }>({ userId: null, staffId: null, name: "Incoming nurse" });
  useEffect(() => { fetch("/api/auth/session").then((r) => r.json()).then((d) => { if (d?.authenticated) setMe({ userId: d.session?.userId ?? null, staffId: d.session?.staffId ?? null, name: d.session?.name ?? "Incoming nurse" }); }).catch(() => {}); }, []);
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
  const [generating, setGenerating] = useState(false);
  const [recapping, setRecapping] = useState(false);

  // Auto-fill the whole report from what actually happened this shift — the meds
  // you logged, incidents you filed, escalations you raised, tasks you completed,
  // plus the unit's open carry-over — then let the AI draft the narrative. The
  // nurse reviews & edits before submitting; nothing is auto-submitted.
  const recapFromShift = async () => {
    setRecapping(true);
    try {
      const res = await fetch("/api/ai-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "shift-recap", shiftType: form.shiftType, date: form.date }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        Swal.fire({ title: "Couldn't pull your shift", text: data?.error || "Fill the report manually or try again.", icon: "info" });
        return;
      }
      const f = (data.fields ?? {}) as Partial<ReportForm>;
      setForm((prev) => ({
        ...prev,
        summary: data.summary ? String(data.summary) : prev.summary,
        residentUpdates: f.residentUpdates || prev.residentUpdates,
        incidentsOccurred: Boolean(f.incidentsOccurred) || prev.incidentsOccurred,
        incidentDetails: f.incidentDetails || prev.incidentDetails,
        medicationsAdministered: f.medicationsAdministered || prev.medicationsAdministered,
        taskCompleted: f.taskCompleted || prev.taskCompleted,
        handoverNotes: f.handoverNotes || prev.handoverNotes,
      }));
      Swal.fire({
        toast: true, position: "top-end", icon: data.empty ? "info" : "success", showConfirmButton: false, timer: 3600, timerProgressBar: true,
        title: data.empty
          ? "No logged activity found for this shift window — fill in anything manual."
          : "Pulled your shift activity — review and edit before saving.",
      });
    } catch {
      Swal.fire({ title: "Couldn't pull your shift", text: "Network error — fill the report manually.", icon: "info" });
    } finally {
      setRecapping(false);
    }
  };

  // Offline fallback — the original templated summary from the entered fields.
  const templateSummary = () => {
    const parts: string[] = [`${shiftMeta(form.shiftType).label} shift handover.`];
    if (form.residentUpdates.trim()) parts.push(`Resident updates: ${form.residentUpdates.trim()}.`);
    parts.push(form.incidentsOccurred ? `Incident(s): ${form.incidentDetails.trim() || "see incident log"}.` : "No incidents reported this shift.");
    if (form.medicationsAdministered.trim()) parts.push(`Medications: ${form.medicationsAdministered.trim()}.`);
    if (form.taskCompleted.trim()) parts.push(`Tasks completed: ${form.taskCompleted.trim()}.`);
    if (form.handoverNotes.trim()) parts.push(`Carry-over: ${form.handoverNotes.trim()}.`);
    return parts.join(" ");
  };

  // AI endorsement via Gemini, drafted from the shift fields; falls back offline.
  const generateSummary = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/ai-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "endorsement",
          shift: shiftMeta(form.shiftType).label,
          residentUpdates: form.residentUpdates.trim(),
          incidentsOccurred: form.incidentsOccurred,
          incidentDetails: form.incidentDetails.trim(),
          medications: form.medicationsAdministered.trim(),
          tasks: form.taskCompleted.trim(),
          handoverNotes: form.handoverNotes.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.summary) {
        setField("summary", String(data.summary).trim());
      } else {
        // AI unavailable (plan without the ai_assistant entitlement, no key, or a
        // provider error) — insert the offline template but say so, so it doesn't
        // look like the AI silently produced boilerplate.
        setField("summary", templateSummary());
        Swal.fire({
          toast: true, position: "top-end", icon: "info", showConfirmButton: false, timer: 3400, timerProgressBar: true,
          title: res.status === 403
            ? "AI endorsement isn't enabled on your plan — used a template you can edit."
            : "AI endorsement unavailable right now — used a template you can edit.",
        });
      }
    } catch {
      setField("summary", templateSummary());
      Swal.fire({ toast: true, position: "top-end", icon: "info", showConfirmButton: false, timer: 3400, title: "AI endorsement unavailable right now — used a template you can edit." });
    } finally {
      setGenerating(false);
    }
  };

  const handleAck = async (r: ShiftReport) => {
    try {
      await updateRecord("shift-reports", r.id, { acknowledgedByName: me.name || "Incoming nurse", acknowledgedAt: new Date().toISOString() });
      await refetch();
      Swal.fire({ title: "Acknowledged", text: "Handover receipt recorded.", icon: "success", timer: 1300, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not acknowledge.", icon: "error" });
    }
  };

  const handleCreate = async () => {
    if (!form.summary.trim()) {
      Swal.fire({ title: "Summary required", text: "Add a shift summary before saving.", icon: "warning" });
      return;
    }
    // staffId + userId are required, non-null relations on ShiftReport; without
    // a resolved staff identity the create would 400. Block early with a clear
    // message rather than letting the generic API reject the write.
    if (!me.staffId || !me.userId) {
      Swal.fire({ title: "Can't save yet", text: "Your staff profile isn't loaded. Refresh and try again, or contact an admin if your account has no staff record.", icon: "warning" });
      return;
    }
    setSaving(true);
    try {
      await createRecord("shift-reports", {
        staffId: me.staffId,
        userId: me.userId,
        shiftType: form.shiftType,
        date: new Date(form.date).toISOString(),
        summary: form.summary.trim(),
        residentUpdates: form.residentUpdates.trim() || null,
        incidentsOccurred: form.incidentsOccurred,
        incidentDetails: form.incidentsOccurred ? form.incidentDetails.trim() || null : null,
        medicationsAdministered: form.medicationsAdministered.trim() || null,
        taskCompleted: form.taskCompleted.trim() || null,
        handoverNotes: form.handoverNotes.trim() || null,
        aiSummary: form.summary.trim() || null,
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

  // The outgoing author signs their own report; the incoming shift (a DIFFERENT
  // person) acknowledges receipt. Everyone else is view-only.
  const isAuthor = (r: ShiftReport) => Boolean(me.userId && r.userId && r.userId === me.userId);

  /* ── Render ────────────────────────────────────────────────────────── */
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-1 flex items-center gap-2">
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
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
            <button
              onClick={() => setView("list")}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition ${
                view === "list" ? "bg-yellow-400 text-black" : "bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              <ListChecks className="w-4 h-4" /> Reports
            </button>
            <button
              onClick={() => setView("analytics")}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition border-l border-gray-300 ${
                view === "analytics" ? "bg-yellow-400 text-black" : "bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              <BarChart3 className="w-4 h-4" /> Analytics
            </button>
          </div>
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
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm"
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

      {view === "list" && <ShiftContinuityPanel />}

      {view === "analytics" && <ReportsAnalytics reports={reports} nowTs={nowTs} />}

      {view === "list" && (
        <>
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
                  {/* Only the author signs off their own report. */}
                  {!r.signedAt && isAuthor(r) && (
                    <button
                      onClick={() => void handleSign(r)}
                      className="flex items-center gap-1 px-2.5 py-1 text-green-600 hover:bg-green-50 rounded text-sm font-medium transition"
                    >
                      <PenLine className="w-4 h-4" /> Sign
                    </button>
                  )}
                  {/* The incoming shift (not the author) acknowledges receipt once signed. */}
                  {r.signedAt && !r.acknowledgedByName && !isAuthor(r) && (
                    <button
                      onClick={() => void handleAck(r)}
                      className="flex items-center gap-1 px-2.5 py-1 text-indigo-600 hover:bg-indigo-50 rounded text-sm font-medium transition"
                    >
                      <CheckCircle2 className="w-4 h-4" /> Acknowledge
                    </button>
                  )}
                  {r.acknowledgedByName && <span className="self-center text-xs text-gray-400">✓ Ack: {r.acknowledgedByName}</span>}
                  {!r.signedAt && !isAuthor(r) && <span className="self-center text-xs text-amber-600">Awaiting author sign-off</span>}
                  {/* Only the author can remove their own report (protects the audit chain). */}
                  {isAuthor(r) && (
                    <button
                      onClick={() => void handleDelete(r)}
                      className="flex items-center gap-1 px-2.5 py-1 text-red-600 hover:bg-red-50 rounded text-sm font-medium transition ml-auto"
                    >
                      <Trash2 className="w-4 h-4" /> Delete
                    </button>
                  )}
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
        </>
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
              {!viewing.signedAt && isAuthor(viewing) && (
                <button
                  onClick={() => void handleSign(viewing)}
                  className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-green-400 to-green-500 text-white font-semibold rounded-lg hover:shadow-lg transition"
                >
                  <PenLine className="w-4 h-4" /> Sign Off
                </button>
              )}
              {viewing.signedAt && !viewing.acknowledgedByName && !isAuthor(viewing) && (
                <button
                  onClick={() => { void handleAck(viewing); setViewing((v) => (v ? { ...v, acknowledgedByName: me.name } : v)); }}
                  className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white font-semibold rounded-lg hover:shadow-lg transition"
                >
                  <CheckCircle2 className="w-4 h-4" /> Acknowledge Receipt
                </button>
              )}
              {!viewing.signedAt && !isAuthor(viewing) && (
                <span className="self-center text-sm text-amber-600 font-medium">Awaiting the author&apos;s sign-off</span>
              )}
              {isAuthor(viewing) && (
                <button
                  onClick={() => void handleDelete(viewing)}
                  className="flex items-center gap-2 px-5 py-2 bg-red-50 text-red-600 border border-red-200 font-semibold rounded-lg hover:bg-red-100 transition"
                >
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              )}
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

            {/* Auto-fill the whole report from real shift activity, then let the nurse edit. */}
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 space-y-1.5">
              <button type="button" onClick={() => void recapFromShift()} disabled={recapping} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-sm font-semibold hover:shadow-md transition active:scale-[0.99] disabled:opacity-60">
                {recapping ? <><RefreshCw className="w-4 h-4 animate-spin" /> Pulling your shift activity…</> : <><Sparkles className="w-4 h-4" /> Auto-fill from my shift activity</>}
              </button>
              <p className="text-[11px] text-emerald-800/80 text-center">Pulls the meds you gave, incidents you filed, escalations you raised, tasks you completed &amp; open carry-over for this shift — then drafts the summary. Review before saving.</p>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-gray-700">Summary <span className="text-red-500">*</span></label>
              <button type="button" onClick={() => void generateSummary()} disabled={generating} className="text-xs font-semibold text-indigo-600 hover:underline flex items-center gap-1 disabled:opacity-60">
                {generating ? <><RefreshCw className="w-3 h-3 animate-spin" /> Generating…</> : <>⚡ Re-draft summary from fields</>}
              </button>
            </div>
            <TextArea label="" value={form.summary} onChange={(v) => setField("summary", v)} placeholder="Overall shift summary — or use ⚡ to draft from the fields above…" />
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
              className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-60"
            >
              <Plus className="w-4 h-4" /> {saving ? "Saving…" : "Save Report"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ── Analytics module ────────────────────────────────────────────────── */

const SHIFT_ORDER: ShiftType[] = ["MORNING", "AFTERNOON", "NIGHT", "OVERNIGHT"];
const SHIFT_COLORS = ["#f59e0b", "#f97316", "#6366f1", "#a855f7"];
const SIGN_COLORS = ["#22c55e", "#f59e0b"];

function ReportsAnalytics({ reports, nowTs }: { reports: ShiftReport[]; nowTs: number }) {
  const a = useMemo(() => {
    const total = reports.length;
    const signed = reports.filter((r) => r.signedAt).length;
    const incidents = reports.filter((r) => r.incidentsOccurred).length;

    // Last 7 calendar days, oldest → newest.
    const anchor = new Date(nowTs);
    const daily: { day: string; Reports: number; Incidents: number }[] = [];
    const idx = new Map<string, number>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(anchor);
      d.setDate(anchor.getDate() - i);
      idx.set(d.toISOString().slice(0, 10), daily.length);
      daily.push({ day: d.toLocaleDateString(undefined, { weekday: "short" }), Reports: 0, Incidents: 0 });
    }
    let last7 = 0;
    reports.forEach((r) => {
      if (!r.date) return;
      const i = idx.get(new Date(r.date).toISOString().slice(0, 10));
      if (i != null) {
        daily[i].Reports += 1;
        if (r.incidentsOccurred) daily[i].Incidents += 1;
        last7 += 1;
      }
    });

    const byShift = SHIFT_ORDER
      .map((s) => ({ name: SHIFTS[s].label, value: reports.filter((r) => r.shiftType === s).length }))
      .filter((d) => d.value > 0);

    return {
      total, signed, incidents,
      signedRate: total ? Math.round((signed / total) * 100) : 0,
      incidentRate: total ? Math.round((incidents / total) * 100) : 0,
      avgPerDay: Math.round((last7 / 7) * 10) / 10,
      daily, byShift,
      signSplit: [
        { name: "Signed", value: signed },
        { name: "Unsigned", value: total - signed },
      ],
    };
  }, [reports, nowTs]);

  if (a.total === 0) {
    return <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">No report data to analyze yet.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <SummaryCard label="Sign-off Rate" value={a.signedRate} suffix="%" icon={CheckCircle2} tone="gray" />
        <SummaryCard label="Incident Rate" value={a.incidentRate} suffix="%" icon={AlertTriangle} tone="red" />
        <SummaryCard label="Avg Reports / Day" value={a.avgPerDay} icon={TrendingUp} tone="blue" />
        <SummaryCard label="Total Reports" value={a.total} icon={FileText} tone="amber" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Reports & Incidents — Last 7 Days" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={a.daily} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="day" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={28} />
              <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
              <Legend />
              <Bar dataKey="Reports" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Incidents" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Distribution by Shift">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={a.byShift} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                {a.byShift.map((_, i) => <Cell key={i} fill={SHIFT_COLORS[i % SHIFT_COLORS.length]} />)}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Sign-off Status">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={a.signSplit} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={80} label>
                {a.signSplit.map((_, i) => <Cell key={i} fill={SIGN_COLORS[i]} />)}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

function ChartCard({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`bg-white rounded-lg border border-gray-200 p-4 ${className ?? ""}`}>
      <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-yellow-500" /> {title}
      </h3>
      {children}
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

function SummaryCard({ label, value, icon: Icon, tone, suffix = "" }: { label: string; value: number; icon: LucideIcon; tone: keyof typeof TONES; suffix?: string }) {
  const t = TONES[tone];
  return (
    <div className={`p-4 rounded-lg border ${t.wrap}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs sm:text-sm text-gray-600 font-semibold">{label}</p>
        <Icon className={`w-4 h-4 ${t.icon}`} />
      </div>
      <p className={`text-2xl sm:text-3xl font-bold mt-1 ${t.value}`}>{value}{suffix}</p>
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
        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 sm:p-6 flex items-center justify-between z-10">
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
