"use client";

import RefreshButton from "@/components/portal/RefreshButton";

import { useMemo, useState, useEffect } from "react";
import {
  Bell, BellRing, Search, X, Plus, RefreshCw, BarChart3,
  CheckCircle2, AlertTriangle, Clock, Trash2, UserRound, HandHelping,
  History, Ban, type LucideIcon,
} from "lucide-react";
import Swal from "@/lib/swal";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Legend, Tooltip, BarChart, Bar,
  XAxis, YAxis, CartesianGrid,
} from "recharts";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";
import { formatDurationHm } from "@/lib/utils";

/* ── Types ───────────────────────────────────────────────────────────── */

type BellStatus = "PENDING" | "RESPONDED" | "CANCELLED" | "RESOLVED";
type ViewKey = "queue" | "history" | "analytics";

interface BellVM {
  id: string;
  residentId: string;
  residentName: string;
  room: string;
  status: BellStatus;
  reason: string;
  notes: string;
  createdAt: string | null;
  respondedAt: string | null;
  resolvedAt: string | null;
}

/* ── Static metadata ─────────────────────────────────────────────────── */

const STATUS_META: Record<BellStatus, { label: string; badge: string }> = {
  PENDING: { label: "Pending", badge: "bg-red-100 text-red-700 border-red-300" },
  RESPONDED: { label: "Responding", badge: "bg-amber-100 text-amber-800 border-amber-300" },
  RESOLVED: { label: "Resolved", badge: "bg-green-100 text-green-700 border-green-300" },
  CANCELLED: { label: "Cancelled", badge: "bg-gray-200 text-gray-600 border-gray-300" },
};
const STATUS_ORDER: BellStatus[] = ["PENDING", "RESPONDED", "RESOLVED", "CANCELLED"];
const STATUS_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#9ca3af"];

const REASONS = [
  "Assistance requested", "Bathroom assistance", "Water / refreshment",
  "Pain or discomfort", "Repositioning help", "Fall — needs help", "Other",
];

const asStr = (v: unknown): string => (v == null ? "" : String(v));
const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function elapsed(iso: string | null, nowTs: number): string {
  if (!iso || !nowTs) return "—";
  const s = Math.max(0, Math.round((nowTs - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function minutesBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
}

const isSameDay = (iso: string | null, nowTs: number) => {
  if (!iso || !nowTs) return false;
  const a = new Date(iso), b = new Date(nowTs);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
};

/* ── Component ───────────────────────────────────────────────────────── */

export default function CaregiverCallBells() {
  const { data: bellRows, loading, error, refetch } = useLiveQuery<Record<string, unknown>>(
    "call-bells", { query: "include=resident&take=300", tables: ["CallBell"] }
  );
  const { data: residentRows } = useLiveQuery<Record<string, unknown>>(
    "residents", { query: "take=300", tables: ["Resident"] }
  );

  // Active bells show a running timer — tick faster than the usual 60s views.
  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    tick();
    const t = setInterval(tick, 15_000);
    return () => clearInterval(t);
  }, []);

  const [view, setView] = useState<ViewKey>("queue");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | BellStatus>("all");
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const residents = useMemo(() => residentRows.map(adaptResident), [residentRows]);
  const residentById = useMemo(() => new Map(residents.map((r) => [r.id, r])), [residents]);

  const bells = useMemo<BellVM[]>(() => bellRows.map((row) => {
    const rel = row.resident as { firstName?: string; lastName?: string; roomNumber?: string } | undefined;
    const joined = residentById.get(String(row.residentId ?? ""));
    return {
      id: String(row.id),
      residentId: asStr(row.residentId),
      residentName: rel ? `${rel.firstName ?? ""} ${rel.lastName ?? ""}`.trim() : joined?.name ?? "Unknown resident",
      room: rel?.roomNumber ?? joined?.room ?? "—",
      status: (STATUS_ORDER.includes(row.status as BellStatus) ? row.status : "PENDING") as BellStatus,
      reason: asStr(row.reason) || "Assistance requested",
      notes: asStr(row.notes),
      createdAt: row.createdAt ? String(row.createdAt) : null,
      respondedAt: row.respondedAt ? String(row.respondedAt) : null,
      resolvedAt: row.resolvedAt ? String(row.resolvedAt) : null,
    };
  }), [bellRows, residentById]);

  /* Queue: active bells, oldest first (longest-waiting on top). */
  const queue = useMemo(() =>
    bells.filter((b) => b.status === "PENDING" || b.status === "RESPONDED")
      .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "")),
    [bells]);

  const stats = useMemo(() => {
    const responseTimes = bells
      .map((b) => minutesBetween(b.createdAt, b.respondedAt ?? b.resolvedAt))
      .filter((m): m is number => m != null);
    return {
      pending: bells.filter((b) => b.status === "PENDING").length,
      responding: bells.filter((b) => b.status === "RESPONDED").length,
      resolvedToday: bells.filter((b) => b.status === "RESOLVED" && isSameDay(b.resolvedAt, nowTs)).length,
      avgResponse: responseTimes.length
        ? Math.round(responseTimes.reduce((s, m) => s + m, 0) / responseTimes.length)
        : 0,
    };
  }, [bells, nowTs]);

  /* History: closed bells with search/filter/pagination. */
  const history = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bells.filter((b) => {
      if (b.status === "PENDING" || b.status === "RESPONDED") return false;
      if (statusFilter !== "all" && b.status !== statusFilter) return false;
      if (q && !b.residentName.toLowerCase().includes(q) && !b.room.toLowerCase().includes(q) && !b.reason.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }, [bells, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(history.length / perPage));
  const start = (page - 1) * perPage;
  const paginated = history.slice(start, start + perPage);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset paging on filter change
    setPage(1);
  }, [search, statusFilter, perPage]);

  /* ── Mutations ─────────────────────────────────────────────────────── */

  const handleRespond = async (b: BellVM) => {
    try {
      await updateRecord("call-bells", b.id, { status: "RESPONDED", respondedAt: new Date().toISOString() });
      await refetch();
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not update call bell.", icon: "error" });
    }
  };

  const handleResolve = async (b: BellVM) => {
    const result = await Swal.fire({
      title: "Resolve Call Bell",
      html: `<b>${b.residentName}</b> • Room ${b.room}<br/><span style="color:#6b7280">${b.reason}</span>`,
      input: "text",
      inputPlaceholder: "Resolution notes (optional)…",
      icon: "question",
      showCancelButton: true,
      confirmButtonColor: "#10b981",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Resolve",
    });
    if (!result.isConfirmed) return;
    try {
      await updateRecord("call-bells", b.id, {
        status: "RESOLVED",
        resolvedAt: new Date().toISOString(),
        ...(b.respondedAt ? {} : { respondedAt: new Date().toISOString() }),
        ...(result.value ? { notes: String(result.value) } : {}),
      });
      await refetch();
      Swal.fire({ title: "Resolved", icon: "success", timer: 1300, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not resolve call bell.", icon: "error" });
    }
  };

  const handleCancel = async (b: BellVM) => {
    const result = await Swal.fire({
      title: "Cancel Call Bell?",
      text: `${b.residentName} • Room ${b.room} — mark as cancelled (false alarm / no longer needed).`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#f59e0b",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Cancel Bell",
      cancelButtonText: "Keep",
    });
    if (!result.isConfirmed) return;
    try {
      await updateRecord("call-bells", b.id, { status: "CANCELLED", resolvedAt: new Date().toISOString() });
      await refetch();
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not cancel call bell.", icon: "error" });
    }
  };

  const handleDelete = async (b: BellVM) => {
    const result = await Swal.fire({
      title: "Delete Record?",
      text: "This call bell record will be permanently removed.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Delete",
    });
    if (!result.isConfirmed) return;
    try {
      await deleteRecord("call-bells", b.id);
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
            <BellRing className="w-7 h-7 text-yellow-500 flex-shrink-0" /> Call Bells
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-green-600">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live
            </span>
            Resident assistance requests — respond, resolve &amp; track
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
            {([["queue", Bell, "Queue"], ["history", History, "History"], ["analytics", BarChart3, "Analytics"]] as [ViewKey, LucideIcon, string][]).map(([key, Icon, label], i) => (
              <button key={key} onClick={() => setView(key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition ${i > 0 ? "border-l border-gray-300" : ""} ${view === key ? "bg-yellow-400 text-black" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
                <Icon className="w-4 h-4" /> {label}
                {key === "queue" && queue.length > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 bg-red-500 text-white rounded-full text-[10px] font-bold">{queue.length}</span>
                )}
              </button>
            ))}
          </div>
          <RefreshButton onRefresh={() => void refetch()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium" />
          <button onClick={() => setCreating(true)} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">
            <Plus className="w-4 h-4" /> New Call Bell
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Stat label="Pending" value={stats.pending} icon={AlertTriangle} tone="red" />
        <Stat label="Responding" value={stats.responding} icon={HandHelping} tone="amber" />
        <Stat label="Resolved Today" value={stats.resolvedToday} icon={CheckCircle2} tone="green" />
        <Stat label="Avg Response (min)" value={stats.avgResponse} icon={Clock} tone="blue" />
      </div>

      {/* ── Live queue ── */}
      {view === "queue" && (
        loading && bells.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">Loading call bells…</div>
        ) : error ? (
          <div className="bg-white rounded-lg border border-red-200 p-10 text-center text-red-600">Failed to load: {error}</div>
        ) : queue.length === 0 ? (
          <div className="bg-white rounded-lg border border-green-200 p-10 text-center">
            <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-2" />
            <p className="text-gray-700 font-semibold">All clear — no active call bells.</p>
            <p className="text-sm text-gray-500 mt-1">New requests appear here instantly.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {queue.map((b) => {
              const waitingMin = b.createdAt && nowTs ? (nowTs - new Date(b.createdAt).getTime()) / 60000 : 0;
              const urgent = b.status === "PENDING" && waitingMin >= 5;
              return (
                <div key={b.id} className={`p-4 rounded-lg border-2 transition ${
                  urgent ? "bg-red-50 border-red-400 animate-pulse" : b.status === "PENDING" ? "bg-red-50/60 border-red-200" : "bg-amber-50/60 border-amber-200"
                }`}>
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className={`p-2.5 rounded-full flex-shrink-0 ${b.status === "PENDING" ? "bg-red-100" : "bg-amber-100"}`}>
                      <BellRing className={`w-6 h-6 ${b.status === "PENDING" ? "text-red-500" : "text-amber-500"}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-gray-900">{b.residentName} <span className="font-normal text-gray-600">• Room {b.room}</span></p>
                      <p className="text-sm text-gray-700">{b.reason}</p>
                      <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Waiting {elapsed(b.createdAt, nowTs)}
                        {b.respondedAt && <span className="text-amber-600 font-medium">• responder on the way</span>}
                      </p>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-semibold border ${STATUS_META[b.status].badge}`}>{STATUS_META[b.status].label}</span>
                    <div className="flex items-center gap-2">
                      {b.status === "PENDING" && (
                        <button onClick={() => void handleRespond(b)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-400 to-amber-500 text-white text-sm font-semibold rounded-lg hover:shadow transition active:scale-95">
                          <HandHelping className="w-4 h-4" /> Respond
                        </button>
                      )}
                      <button onClick={() => void handleResolve(b)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-green-400 to-green-500 text-white text-sm font-semibold rounded-lg hover:shadow transition active:scale-95">
                        <CheckCircle2 className="w-4 h-4" /> Resolve
                      </button>
                      <button onClick={() => void handleCancel(b)} title="Cancel (false alarm)"
                        className="p-1.5 text-gray-500 hover:bg-gray-100 rounded transition">
                        <Ban className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── History ── */}
      {view === "history" && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="relative sm:col-span-1">
              <Search className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
              <input type="text" placeholder="Search resident, room, reason…" value={search} onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | BellStatus)} className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none">
              <option value="all">Resolved & Cancelled</option>
              <option value="RESOLVED">Resolved Only</option>
              <option value="CANCELLED">Cancelled Only</option>
            </select>
            <select value={perPage} onChange={(e) => setPerPage(parseInt(e.target.value))} className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none">
              <option value={10}>10 per page</option>
              <option value={25}>25 per page</option>
              <option value={50}>50 per page</option>
            </select>
          </div>

          {paginated.length > 0 ? (
            <div className="space-y-2">
              {paginated.map((b) => {
                const respMin = minutesBetween(b.createdAt, b.respondedAt ?? b.resolvedAt);
                return (
                  <div key={b.id} className="bg-white p-3 rounded-lg border border-gray-200 flex items-center gap-3 flex-wrap hover:border-yellow-300 transition">
                    <Bell className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900 truncate">{b.residentName} • Room {b.room} <span className="font-normal text-gray-600">— {b.reason}</span></p>
                      <p className="text-xs text-gray-500">
                        {b.createdAt ? new Date(b.createdAt).toLocaleString() : "—"}
                        {respMin != null && ` • responded in ${formatDurationHm(respMin)}`}
                        {b.notes && ` • 📝 ${b.notes}`}
                      </p>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-semibold border ${STATUS_META[b.status].badge}`}>{STATUS_META[b.status].label}</span>
                    <button onClick={() => void handleDelete(b)} className="p-1.5 text-red-500 hover:bg-red-50 rounded transition">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">No closed call bells match your filters.</div>
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
      {view === "analytics" && <BellsAnalytics bells={bells} nowTs={nowTs} />}

      {/* ── New bell modal ── */}
      {creating && (
        <NewBellModal
          residents={residents.map((r) => ({ id: r.id, name: r.name, room: r.room }))}
          onClose={() => setCreating(false)}
          onSaved={() => { void refetch(); setCreating(false); }}
        />
      )}
    </div>
  );
}

/* ── Analytics module ────────────────────────────────────────────────── */

function BellsAnalytics({ bells, nowTs }: { bells: BellVM[]; nowTs: number }) {
  const a = useMemo(() => {
    const anchor = new Date(nowTs || 0);
    const daily: { day: string; Bells: number; Resolved: number }[] = [];
    const idx = new Map<string, number>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(anchor);
      d.setDate(anchor.getDate() - i);
      idx.set(dateKey(d), daily.length);
      daily.push({ day: d.toLocaleDateString(undefined, { weekday: "short" }), Bells: 0, Resolved: 0 });
    }
    bells.forEach((b) => {
      if (!b.createdAt) return;
      const i = idx.get(dateKey(new Date(b.createdAt)));
      if (i != null) {
        daily[i].Bells += 1;
        if (b.status === "RESOLVED") daily[i].Resolved += 1;
      }
    });

    const byStatus = STATUS_ORDER
      .map((s) => ({ name: STATUS_META[s].label, value: bells.filter((b) => b.status === s).length }))
      .filter((d) => d.value > 0);

    const resMap = new Map<string, number>();
    bells.forEach((b) => resMap.set(`${b.residentName} (${b.room})`, (resMap.get(`${b.residentName} (${b.room})`) ?? 0) + 1));
    const topResidents = Array.from(resMap.entries())
      .map(([name, Bells]) => ({ name, Bells }))
      .sort((x, y) => y.Bells - x.Bells).slice(0, 8);

    return { daily, byStatus, topResidents };
  }, [bells, nowTs]);

  if (bells.length === 0) {
    return <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">No call bell data to analyze yet.</div>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartCard title="Call Bells — Last 7 Days" className="lg:col-span-2">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={a.daily} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="day" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={28} />
            <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <Legend />
            <Bar dataKey="Bells" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Resolved" fill="#22c55e" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="By Status">
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie data={a.byStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
              {a.byStatus.map((_, i) => <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />)}
            </Pie>
            <Tooltip /><Legend />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Most Frequent Callers">
        <ResponsiveContainer width="100%" height={Math.max(200, a.topResidents.length * 32)}>
          <BarChart data={a.topResidents} layout="vertical" margin={{ top: 8, right: 24, left: 24, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
            <XAxis type="number" allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" width={150} fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <Bar dataKey="Bells" fill="#3b82f6" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

/* ── New-bell modal ──────────────────────────────────────────────────── */

function NewBellModal({ residents, onClose, onSaved }: {
  residents: { id: string; name: string; room: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [residentId, setResidentId] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const [customReason, setCustomReason] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const finalReason = reason === "Other" ? customReason.trim() : reason;
  const valid = residentId && finalReason;
  const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none text-sm";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      await createRecord("call-bells", {
        residentId,
        status: "PENDING",
        reason: finalReason,
        notes: notes.trim() || null,
      });
      Swal.fire({ title: "Call Bell Raised", icon: "success", timer: 1300, showConfirmButton: false });
      onSaved();
    } catch (err) {
      setSaving(false);
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not create call bell.", icon: "error" });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
          <h2 className="text-xl font-bold flex items-center gap-2"><BellRing className="w-5 h-5" /> New Call Bell</h2>
          <button onClick={onClose} className="p-2 hover:bg-black/10 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Resident <span className="text-red-500">*</span></label>
              <select value={residentId} onChange={(e) => setResidentId(e.target.value)} className={inputCls}>
                <option value="">Select resident…</option>
                {residents.map((r) => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Reason <span className="text-red-500">*</span></label>
              <select value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls}>
                {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            {reason === "Other" && (
              <input type="text" value={customReason} onChange={(e) => setCustomReason(e.target.value)} placeholder="Describe the request…" className={inputCls} />
            )}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Extra context (optional)…" className={`${inputCls} resize-y`} />
            </div>
          </div>
          <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
            <button type="button" onClick={onClose} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Cancel</button>
            <button type="submit" disabled={!valid || saving}
              className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed">
              <UserRound className="w-4 h-4" /> {saving ? "Raising…" : "Raise Bell"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Presentational sub-components ───────────────────────────────────── */

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
