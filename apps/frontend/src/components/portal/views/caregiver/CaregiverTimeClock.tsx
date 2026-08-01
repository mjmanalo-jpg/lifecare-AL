"use client";

import { useMemo, useState, useEffect } from "react";
import {
  Timer, RefreshCw, BarChart3, Clock, Trash2, LogIn, LogOut,
  Coffee, Sun, Sunset, Moon, CheckCircle2, History, CalendarDays,
  type LucideIcon,
} from "lucide-react";
import Swal from "@/lib/swal";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Legend, Tooltip, BarChart, Bar,
  XAxis, YAxis, CartesianGrid,
} from "recharts";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { humanize } from "@/lib/adapters";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";

/* ── Types ───────────────────────────────────────────────────────────── */

type ShiftType = "MORNING" | "AFTERNOON" | "NIGHT" | "OVERNIGHT";
type AttendanceStatus = "PRESENT" | "ABSENT" | "LATE" | "EARLY_LEAVE";
type ViewKey = "clock" | "history" | "analytics";

interface EntryVM {
  id: string;
  staffId: string;
  staffName: string;
  shiftType: ShiftType;
  startTime: string | null;
  endTime: string | null;
  breakDuration: number;
  status: AttendanceStatus;
  notes: string;
}

interface StaffOption { id: string; name: string; position: string }

/* ── Static metadata ─────────────────────────────────────────────────── */

const SHIFTS: Record<ShiftType, { label: string; icon: LucideIcon; badge: string; startHour: number }> = {
  MORNING: { label: "Morning", icon: Sun, badge: "bg-amber-100 text-amber-800 border-amber-300", startHour: 6 },
  AFTERNOON: { label: "Afternoon", icon: Sunset, badge: "bg-orange-100 text-orange-800 border-orange-300", startHour: 14 },
  NIGHT: { label: "Night", icon: Moon, badge: "bg-indigo-100 text-indigo-800 border-indigo-300", startHour: 22 },
  OVERNIGHT: { label: "Overnight", icon: Moon, badge: "bg-purple-100 text-purple-800 border-purple-300", startHour: 22 },
};
const SHIFT_ORDER: ShiftType[] = ["MORNING", "AFTERNOON", "NIGHT", "OVERNIGHT"];
const SHIFT_COLORS = ["#f59e0b", "#f97316", "#6366f1", "#a855f7"];

const STATUS_BADGE: Record<AttendanceStatus, string> = {
  PRESENT: "bg-green-100 text-green-800 border-green-300",
  LATE: "bg-amber-100 text-amber-800 border-amber-300",
  EARLY_LEAVE: "bg-orange-100 text-orange-800 border-orange-300",
  ABSENT: "bg-red-100 text-red-700 border-red-300",
};
const STATUS_COLORS = ["#22c55e", "#f59e0b", "#f97316", "#ef4444"];

const asStr = (v: unknown): string => (v == null ? "" : String(v));
const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Suggest the shift type matching the current hour. */
const suggestShift = (nowTs: number): ShiftType => {
  const h = nowTs ? new Date(nowTs).getHours() : 8;
  if (h >= 6 && h < 14) return "MORNING";
  if (h >= 14 && h < 22) return "AFTERNOON";
  return "NIGHT";
};

function workedMs(e: EntryVM, nowTs: number): number {
  if (!e.startTime) return 0;
  const end = e.endTime ? new Date(e.endTime).getTime() : nowTs;
  return Math.max(0, end - new Date(e.startTime).getTime() - e.breakDuration * 60000);
}

function fmtDuration(ms: number): string {
  const m = Math.floor(ms / 60000);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

const hours1dp = (ms: number) => Math.round((ms / 3_600_000) * 10) / 10;

/* ── Component ───────────────────────────────────────────────────────── */

export default function CaregiverTimeClock() {
  const { data: entryRows, loading, error, refetch } = useLiveQuery<Record<string, unknown>>(
    "time-tracking", { query: "include=staff&take=300", tables: ["TimeTracking"] }
  );
  const { data: staffRows } = useLiveQuery<Record<string, unknown>>(
    "staff", { query: "include=user&take=100", tables: ["Staff"] }
  );

  // Live elapsed timers on active shifts — tick every 30s.
  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);

  const [view, setView] = useState<ViewKey>("clock");
  const [shiftFilter, setShiftFilter] = useState<"all" | ShiftType>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | AttendanceStatus>("all");
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(1);
  // Break-in-progress start timestamps, keyed by entry id (session-local).
  const [breakStart, setBreakStart] = useState<Record<string, number>>({});

  // Clock-in form
  const [staffId, setStaffId] = useState("");
  const [shiftType, setShiftType] = useState<ShiftType | "">("");
  const [clockNotes, setClockNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const staffOptions = useMemo<StaffOption[]>(() => staffRows
    .filter((s) => s.isActive !== false)
    .map((s) => {
      const user = s.user as { name?: string } | undefined;
      return { id: String(s.id), name: user?.name ?? "Staff member", position: asStr(s.position) };
    }), [staffRows]);
  const staffById = useMemo(() => new Map(staffOptions.map((s) => [s.id, s])), [staffOptions]);

  const entries = useMemo<EntryVM[]>(() => entryRows.map((row) => {
    const rel = row.staff as { user?: { name?: string } } | undefined;
    return {
      id: String(row.id),
      staffId: asStr(row.staffId),
      staffName: rel?.user?.name ?? staffById.get(asStr(row.staffId))?.name ?? "Staff member",
      shiftType: (SHIFT_ORDER.includes(row.shiftType as ShiftType) ? row.shiftType : "MORNING") as ShiftType,
      startTime: row.startTime ? String(row.startTime) : null,
      endTime: row.endTime ? String(row.endTime) : null,
      breakDuration: Number(row.breakDuration ?? 0) || 0,
      status: (["PRESENT", "ABSENT", "LATE", "EARLY_LEAVE"].includes(String(row.status)) ? row.status : "PRESENT") as AttendanceStatus,
      notes: asStr(row.notes),
    };
  }), [entryRows, staffById]);

  const active = useMemo(() =>
    entries.filter((e) => e.startTime && !e.endTime)
      .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? "")),
    [entries]);

  const stats = useMemo(() => {
    const now = new Date(nowTs || 0);
    const weekAgo = nowTs - 7 * 86_400_000;
    const monthAgo = nowTs - 30 * 86_400_000;
    let todayMs = 0, weekMs = 0, monthShifts = 0;
    entries.forEach((e) => {
      if (!e.startTime) return;
      const t = new Date(e.startTime);
      const ms = workedMs(e, nowTs);
      if (dateKey(t) === dateKey(now)) todayMs += ms;
      if (t.getTime() >= weekAgo) weekMs += ms;
      if (t.getTime() >= monthAgo) monthShifts += 1;
    });
    return { onClock: active.length, todayH: hours1dp(todayMs), weekH: hours1dp(weekMs), monthShifts };
  }, [entries, active, nowTs]);

  const history = useMemo(() =>
    entries.filter((e) => {
      if (!e.endTime) return false;
      if (shiftFilter !== "all" && e.shiftType !== shiftFilter) return false;
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      return true;
    }).sort((a, b) => (b.startTime ?? "").localeCompare(a.startTime ?? "")),
    [entries, shiftFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(history.length / perPage));
  const start = (page - 1) * perPage;
  const paginated = history.slice(start, start + perPage);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset paging on filter change
    setPage(1);
  }, [shiftFilter, statusFilter, perPage]);

  const effectiveShift: ShiftType = shiftType || suggestShift(nowTs);

  /* ── Mutations ─────────────────────────────────────────────────────── */

  const handleClockIn = async () => {
    if (!staffId || saving) return;
    if (active.some((e) => e.staffId === staffId)) {
      Swal.fire({ title: "Already Clocked In", text: "This staff member has an open shift. Clock out first.", icon: "warning" });
      return;
    }
    setSaving(true);
    const nowIso = new Date().toISOString();
    // Late = more than 15 minutes past the shift's scheduled start.
    const minutesLate = (new Date().getHours() - SHIFTS[effectiveShift].startHour) * 60 + new Date().getMinutes();
    try {
      await createRecord("time-tracking", {
        staffId,
        shiftType: effectiveShift,
        startTime: nowIso,
        status: minutesLate > 15 ? "LATE" : "PRESENT",
        notes: clockNotes.trim() || null,
      });
      await refetch();
      setClockNotes("");
      Swal.fire({ title: "Clocked In", text: `${staffById.get(staffId)?.name ?? "Staff"} — ${SHIFTS[effectiveShift].label} shift started.`, icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Clock-in Failed", text: err instanceof Error ? err.message : "Could not clock in.", icon: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleBreak = async (e: EntryVM) => {
    const started = breakStart[e.id];
    if (!started) {
      setBreakStart((prev) => ({ ...prev, [e.id]: Date.now() }));
      return;
    }
    const mins = Math.max(1, Math.round((nowTs - started) / 60000));
    try {
      await updateRecord("time-tracking", e.id, { breakDuration: e.breakDuration + mins });
      setBreakStart((prev) => {
        const next = { ...prev };
        delete next[e.id];
        return next;
      });
      await refetch();
    } catch (err) {
      Swal.fire({ title: "Break Update Failed", text: err instanceof Error ? err.message : "Could not record break.", icon: "error" });
    }
  };

  const handleClockOut = async (e: EntryVM) => {
    const worked = fmtDuration(workedMs(e, nowTs));
    const result = await Swal.fire({
      title: "Clock Out?",
      html: `<b>${e.staffName}</b> — ${SHIFTS[e.shiftType].label} shift<br/><span style="color:#6b7280">Worked ${worked} (breaks excluded)</span>`,
      input: "text",
      inputPlaceholder: "End-of-shift notes (optional)…",
      icon: "question",
      showCancelButton: true,
      confirmButtonColor: "#10b981",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Clock Out",
    });
    if (!result.isConfirmed) return;
    // Fold an unfinished break into the total before closing the entry.
    const started = breakStart[e.id];
    const extraBreak = started ? Math.max(1, Math.round((Date.now() - started) / 60000)) : 0;
    const workedHours = workedMs(e, Date.now()) / 3_600_000;
    try {
      await updateRecord("time-tracking", e.id, {
        endTime: new Date().toISOString(),
        breakDuration: e.breakDuration + extraBreak,
        ...(workedHours < 6 && e.status === "PRESENT" ? { status: "EARLY_LEAVE" } : {}),
        ...(result.value ? { notes: [e.notes, String(result.value)].filter(Boolean).join(" | ") } : {}),
      });
      setBreakStart((prev) => {
        const next = { ...prev };
        delete next[e.id];
        return next;
      });
      await refetch();
      Swal.fire({ title: "Clocked Out", text: `Shift closed — ${worked} worked.`, icon: "success", timer: 1600, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Clock-out Failed", text: err instanceof Error ? err.message : "Could not clock out.", icon: "error" });
    }
  };

  const handleDelete = async (e: EntryVM) => {
    const result = await Swal.fire({
      title: "Delete Entry?",
      text: "This time record will be permanently removed.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Delete",
    });
    if (!result.isConfirmed) return;
    try {
      await deleteRecord("time-tracking", e.id);
      await refetch();
    } catch (err) {
      Swal.fire({ title: "Delete Failed", text: err instanceof Error ? err.message : "Could not delete.", icon: "error" });
    }
  };

  /* ── Render ────────────────────────────────────────────────────────── */

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-1 flex items-center gap-2">
            <Timer className="w-7 h-7 text-yellow-500 flex-shrink-0" /> Time Clock
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-green-600">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live
            </span>
            Clock in &amp; out, breaks, attendance &amp; hours
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
            {([["clock", Timer, "Clock"], ["history", History, "History"], ["analytics", BarChart3, "Analytics"]] as [ViewKey, LucideIcon, string][]).map(([key, Icon, label], i) => (
              <button key={key} onClick={() => setView(key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition ${i > 0 ? "border-l border-gray-300" : ""} ${view === key ? "bg-yellow-400 text-black" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
                <Icon className="w-4 h-4" /> {label}
              </button>
            ))}
          </div>
          <button onClick={() => void refetch()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Stat label="On the Clock" value={stats.onClock} icon={Timer} tone="green" />
        <Stat label="Hours Today" value={stats.todayH} icon={Clock} tone="blue" />
        <Stat label="Hours (7 Days)" value={stats.weekH} icon={CalendarDays} tone="amber" />
        <Stat label="Shifts (30 Days)" value={stats.monthShifts} icon={CheckCircle2} tone="gray" />
      </div>

      {/* ── Clock view ── */}
      {view === "clock" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Clock-in card */}
          <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
            <h3 className="font-bold text-gray-900 flex items-center gap-2"><LogIn className="w-5 h-5 text-green-500" /> Clock In</h3>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Staff Member <span className="text-red-500">*</span></label>
              <select value={staffId} onChange={(e) => setStaffId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none text-sm">
                <option value="">Select staff…</option>
                {staffOptions.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.position}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Shift</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {SHIFT_ORDER.map((s) => {
                  const meta = SHIFTS[s];
                  const ShiftIcon = meta.icon;
                  const selected = effectiveShift === s;
                  return (
                    <button key={s} type="button" onClick={() => setShiftType(s)}
                      className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-xs font-semibold transition ${
                        selected ? "border-yellow-400 bg-yellow-50 text-gray-900" : "border-gray-200 text-gray-600 hover:bg-gray-50"
                      }`}>
                      <ShiftIcon className="w-4 h-4" /> {meta.label}
                    </button>
                  );
                })}
              </div>
              {!shiftType && <p className="text-xs text-gray-500 mt-1">Suggested for this hour: {SHIFTS[suggestShift(nowTs)].label}</p>}
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Notes</label>
              <input type="text" value={clockNotes} onChange={(e) => setClockNotes(e.target.value)} placeholder="Optional…"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none text-sm" />
            </div>
            <button onClick={() => void handleClockIn()} disabled={!staffId || saving}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-green-400 to-green-500 text-white font-semibold rounded-lg hover:shadow-lg transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
              <LogIn className="w-4 h-4" /> {saving ? "Clocking In…" : `Clock In — ${SHIFTS[effectiveShift].label} Shift`}
            </button>
          </div>

          {/* Active shifts */}
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-4">
              <Clock className="w-5 h-5 text-blue-500" /> Active Shifts
              {active.length > 0 && <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-bold">{active.length}</span>}
            </h3>
            {loading && entries.length === 0 ? (
              <p className="text-gray-500 text-sm py-6 text-center">Loading time records…</p>
            ) : error ? (
              <p className="text-red-600 text-sm py-6 text-center">Failed to load: {error}</p>
            ) : active.length === 0 ? (
              <p className="text-gray-500 text-sm py-6 text-center">No one is clocked in right now.</p>
            ) : (
              <div className="space-y-3">
                {active.map((e) => {
                  const meta = SHIFTS[e.shiftType];
                  const ShiftIcon = meta.icon;
                  const onBreak = Boolean(breakStart[e.id]);
                  return (
                    <div key={e.id} className={`p-3 rounded-lg border ${onBreak ? "bg-amber-50 border-amber-200" : "bg-green-50/60 border-green-200"}`}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900 text-sm">{e.staffName}</p>
                          <p className="text-xs text-gray-600 flex items-center gap-1.5 flex-wrap">
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-semibold ${meta.badge}`}>
                              <ShiftIcon className="w-3 h-3" /> {meta.label}
                            </span>
                            In {e.startTime ? new Date(e.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                            • <span className="font-semibold text-gray-800">{fmtDuration(workedMs(e, nowTs))}</span> worked
                            {e.breakDuration > 0 && ` • ${e.breakDuration}m break`}
                            {onBreak && <span className="text-amber-700 font-semibold">• on break</span>}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => void handleBreak(e)}
                            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                              onBreak ? "bg-amber-500 text-white hover:bg-amber-600" : "border border-gray-300 text-gray-700 hover:bg-gray-50"
                            }`}>
                            <Coffee className="w-3.5 h-3.5" /> {onBreak ? "End Break" : "Break"}
                          </button>
                          <button onClick={() => void handleClockOut(e)}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-gradient-to-r from-red-400 to-red-500 text-white rounded-lg text-xs font-semibold hover:shadow transition active:scale-95">
                            <LogOut className="w-3.5 h-3.5" /> Clock Out
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── History ── */}
      {view === "history" && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <select value={shiftFilter} onChange={(e) => setShiftFilter(e.target.value as "all" | ShiftType)} className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none">
              <option value="all">All Shifts</option>
              {SHIFT_ORDER.map((s) => <option key={s} value={s}>{SHIFTS[s].label}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | AttendanceStatus)} className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none">
              <option value="all">All Attendance</option>
              {(["PRESENT", "LATE", "EARLY_LEAVE", "ABSENT"] as AttendanceStatus[]).map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </select>
            <select value={perPage} onChange={(e) => setPerPage(parseInt(e.target.value))} className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none">
              <option value={10}>10 per page</option>
              <option value={25}>25 per page</option>
              <option value={50}>50 per page</option>
            </select>
          </div>

          {paginated.length > 0 ? (
            <div className="space-y-2">
              {paginated.map((e) => {
                const meta = SHIFTS[e.shiftType];
                const ShiftIcon = meta.icon;
                return (
                  <div key={e.id} className="bg-white p-3 rounded-lg border border-gray-200 flex items-center gap-3 flex-wrap hover:border-yellow-300 transition">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-xs font-semibold flex-shrink-0 ${meta.badge}`}>
                      <ShiftIcon className="w-3.5 h-3.5" /> {meta.label}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900 truncate">{e.staffName}</p>
                      <p className="text-xs text-gray-500">
                        {e.startTime ? new Date(e.startTime).toLocaleString() : "—"}
                        {e.endTime && ` → ${new Date(e.endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                        {" • "}<span className="font-semibold text-gray-700">{fmtDuration(workedMs(e, nowTs))}</span>
                        {e.breakDuration > 0 && ` • ${e.breakDuration}m break`}
                        {e.notes && ` • 📝 ${e.notes}`}
                      </p>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-semibold border ${STATUS_BADGE[e.status]}`}>{humanize(e.status)}</span>
                    <button onClick={() => void handleDelete(e)} className="p-1.5 text-red-500 hover:bg-red-50 rounded transition">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">
              {entries.length === 0 ? "No time records yet. Clock in to start tracking." : "No completed shifts match your filters."}
            </div>
          )}

          {history.length > perPage && (
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="text-sm text-gray-600">Showing {start + 1}-{Math.min(start + perPage, history.length)} of {history.length} records</div>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium">Previous</button>
                <span className="px-3 py-2 text-sm font-medium text-gray-700">Page {page} / {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium">Next</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Analytics ── */}
      {view === "analytics" && <TimeAnalytics entries={entries} nowTs={nowTs} />}
    </div>
  );
}

/* ── Analytics module ────────────────────────────────────────────────── */

function TimeAnalytics({ entries, nowTs }: { entries: EntryVM[]; nowTs: number }) {
  const a = useMemo(() => {
    const anchor = new Date(nowTs || 0);
    const daily: { day: string; Hours: number }[] = [];
    const idx = new Map<string, number>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(anchor);
      d.setDate(anchor.getDate() - i);
      idx.set(dateKey(d), daily.length);
      daily.push({ day: d.toLocaleDateString(undefined, { weekday: "short" }), Hours: 0 });
    }
    entries.forEach((e) => {
      if (!e.startTime) return;
      const i = idx.get(dateKey(new Date(e.startTime)));
      if (i != null) daily[i].Hours += hours1dp(workedMs(e, nowTs));
    });
    daily.forEach((d) => { d.Hours = Math.round(d.Hours * 10) / 10; });

    const byShift = SHIFT_ORDER
      .map((s) => ({ name: SHIFTS[s].label, value: entries.filter((e) => e.shiftType === s).length }))
      .filter((d) => d.value > 0);

    const byStatus = (["PRESENT", "LATE", "EARLY_LEAVE", "ABSENT"] as AttendanceStatus[])
      .map((s) => ({ name: humanize(s), value: entries.filter((e) => e.status === s).length }))
      .filter((d) => d.value > 0);

    const staffMap = new Map<string, number>();
    entries.forEach((e) => staffMap.set(e.staffName, (staffMap.get(e.staffName) ?? 0) + workedMs(e, nowTs)));
    const topStaff = Array.from(staffMap.entries())
      .map(([name, ms]) => ({ name, Hours: hours1dp(ms) }))
      .sort((x, y) => y.Hours - x.Hours).slice(0, 8);

    return { daily, byShift, byStatus, topStaff };
  }, [entries, nowTs]);

  if (entries.length === 0) {
    return <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">No time-tracking data to analyze yet.</div>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartCard title="Hours Worked — Last 7 Days" className="lg:col-span-2">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={a.daily} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="day" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis fontSize={12} tickLine={false} axisLine={false} width={28} />
            <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <Bar dataKey="Hours" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Shifts by Type">
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie data={a.byShift} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
              {a.byShift.map((_, i) => <Cell key={i} fill={SHIFT_COLORS[i % SHIFT_COLORS.length]} />)}
            </Pie>
            <Tooltip /><Legend />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Attendance Status">
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie data={a.byStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={80} label>
              {a.byStatus.map((_, i) => <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />)}
            </Pie>
            <Tooltip /><Legend />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Hours by Staff Member" className="lg:col-span-2">
        <ResponsiveContainer width="100%" height={Math.max(200, a.topStaff.length * 32)}>
          <BarChart data={a.topStaff} layout="vertical" margin={{ top: 8, right: 24, left: 24, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
            <XAxis type="number" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" width={140} fontSize={12} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <Bar dataKey="Hours" fill="#f59e0b" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

/* ── Presentational sub-components ───────────────────────────────────── */

const TONES: Record<string, { wrap: string; icon: string; value: string }> = {
  gray: { wrap: "bg-white border-gray-200", icon: "text-gray-500", value: "text-gray-900" },
  blue: { wrap: "bg-blue-50 border-blue-200", icon: "text-blue-500", value: "text-blue-600" },
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
