"use client";

import RefreshButton from "@/components/portal/RefreshButton";

import { useMemo, useState } from "react";
import {
  RefreshCw, Loader2, ArrowRight, ClipboardCheck, DoorOpen, Repeat,
  BadgeCheck, Sparkles, Search, CheckCircle2, Circle, ChevronLeft, ChevronRight, Eye, X,
} from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord } from "@/lib/api";
import { useToast, Toaster } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { UNIT_STATUS_META, UNIT_STATUS_ORDER } from "./pmsMeta";

/**
 * Apartment / Room Status Lifecycle — mobile staff tools (Phase 7 PMS). Live via
 * Supabase realtime + polling. Advances a unit through the housekeeping loop:
 * make ready → inspection → ready → occupied → turnover → move-out → deep clean
 * ↺. A turnover cycle (leaving OCCUPIED → back to READY) is logged in
 * RoomTurnover with start/ready timestamps that power the Unit Turnover Time KPI.
 */

type Row = Record<string, unknown>;
const nextStatus = (s: string) => {
  const i = UNIT_STATUS_ORDER.indexOf(s);
  return UNIT_STATUS_ORDER[(i + 1) % UNIT_STATUS_ORDER.length];
};

// Keep Room.status (occupancy) in sync with the housekeeping lifecycle.
const roomStatusFor = (hk: string) =>
  hk === "OCCUPIED" ? "OCCUPIED" : hk === "READY" ? "AVAILABLE" : "MAINTENANCE";

const adaptRoom = (r: Row) => ({
  id: String(r.id ?? ""),
  roomNumber: String(r.roomNumber ?? ""),
  wing: String(r.wing ?? ""),
  floor: Number(r.floor ?? 0),
  roomType: String(r.roomType ?? ""),
  status: String(r.status ?? "AVAILABLE"),
  housekeepingStatus: String(r.housekeepingStatus ?? "READY"),
});
type RoomCard = ReturnType<typeof adaptRoom>;

const adaptTurnover = (r: Row) => {
  let checklist: { item: string; ok: boolean }[] = [];
  try { checklist = r.checklist ? JSON.parse(String(r.checklist)) : []; } catch { checklist = []; }
  return {
    id: String(r.id ?? ""),
    roomNumber: String(r.roomNumber ?? ""),
    stage: String(r.stage ?? "MOVE_OUT"),
    status: String(r.status ?? "IN_PROGRESS"),
    assignedTo: String(r.assignedTo ?? ""),
    outgoingResident: String(r.outgoingResident ?? ""),
    incomingResident: String(r.incomingResident ?? ""),
    inspectionPassed: Boolean(r.inspectionPassed),
    checklist,
    startedAt: String(r.startedAt ?? ""),
    readyAt: r.readyAt ? String(r.readyAt) : "",
    notes: String(r.notes ?? ""),
  };
};
type Turnover = ReturnType<typeof adaptTurnover>;

export default function UnitTurnoverBoard() {
  const roomsQ = useLiveQuery<Row>("rooms", { query: "take=500", tables: ["Room"], pollMs: 12000 });
  const turnoversQ = useLiveQuery<Row>("room-turnovers", { query: "take=300", tables: ["RoomTurnover"], pollMs: 12000 });

  const rooms = useMemo<RoomCard[]>(
    () => roomsQ.data.map(adaptRoom).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true })),
    [roomsQ.data]
  );
  const turnovers = useMemo<Turnover[]>(() => turnoversQ.data.map(adaptTurnover), [turnoversQ.data]);
  const activeTurnovers = useMemo(() => turnovers.filter(t => t.status === "IN_PROGRESS"), [turnovers]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewingRoom, setViewingRoom] = useState<RoomCard | null>(null);
  const [viewingChecklists, setViewingChecklists] = useState(false);
  const [page, setPage] = useState(1);

  // shadcn feedback: toasts (success/error) + promise-based confirm dialog.
  const { toasts, toast, dismiss } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const perPage = 12;

  const refreshAll = async () => { await roomsQ.refetch(); await turnoversQ.refetch(); };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rooms.filter(r => {
      if (q && !r.roomNumber.toLowerCase().includes(q) && !r.wing.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && r.housekeepingStatus !== statusFilter) return false;
      return true;
    });
  }, [rooms, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const stats = useMemo(() => {
    const done = turnovers.filter(t => t.status === "COMPLETED" && t.readyAt && t.startedAt);
    const avgH = done.length
      ? done.reduce((s, t) => s + (new Date(t.readyAt).getTime() - new Date(t.startedAt).getTime()) / 3600000, 0) / done.length
      : 0;
    return {
      occupied: rooms.filter(r => r.housekeepingStatus === "OCCUPIED").length,
      inTurnover: rooms.filter(r => ["TURNOVER", "MOVE_OUT", "DEEP_CLEAN", "MAKE_READY", "INSPECTION"].includes(r.housekeepingStatus)).length,
      ready: rooms.filter(r => r.housekeepingStatus === "READY").length,
      avgTurnover: avgH,
    };
  }, [rooms, turnovers]);

  const advance = async (room: RoomCard) => {
    const from = room.housekeepingStatus;
    const to = nextStatus(from);
    if (!(await confirm({
      title: `Advance Room ${room.roomNumber}?`,
      description: `${UNIT_STATUS_META[from].label} → ${UNIT_STATUS_META[to].label}`,
      confirmText: "Advance",
    }))) return;
    setBusyId(room.id);
    try {
      await updateRecord("rooms", room.id, { housekeepingStatus: to, status: roomStatusFor(to) });
      const active = activeTurnovers.find(t => t.roomNumber === room.roomNumber);

      if (to === "TURNOVER" && !active) {
        // A resident is leaving — open a new turnover cycle for the KPI clock.
        await createRecord("room-turnovers", {
          roomNumber: room.roomNumber, stage: "TURNOVER", status: "IN_PROGRESS",
          startedAt: new Date().toISOString(),
        });
      } else if (to === "READY" && active) {
        // Cycle complete — stamp readyAt so Unit Turnover Time can be measured.
        await updateRecord("room-turnovers", active.id, {
          stage: "READY", status: "COMPLETED", inspectionPassed: true, readyAt: new Date().toISOString(),
        });
      } else if (active) {
        await updateRecord("room-turnovers", active.id, { stage: to });
      }
      await refreshAll();
    } catch (err) {
      toast("error", "Failed", err instanceof Error ? err.message : "Could not advance the unit.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Unit Turnover
          </h1>
          <p className="text-gray-600">Apartment lifecycle — make ready · inspection · occupied · turnover · move-out · deep clean ↺</p>
        </div>
        <RefreshButton onRefresh={() => void refreshAll()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Occupied" value={String(stats.occupied)} icon={DoorOpen} color="indigo" />
        <Stat label="In Turnover" value={String(stats.inTurnover)} icon={Repeat} color="amber" />
        <Stat label="Ready" value={String(stats.ready)} icon={BadgeCheck} color="green" />
        <Stat label="Avg Turnover Time" value={stats.avgTurnover ? `${stats.avgTurnover.toFixed(1)}h` : "—"} icon={ClipboardCheck} color="purple" />
      </div>

      {/* Lifecycle legend */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 flex flex-wrap items-center gap-2">
        {UNIT_STATUS_ORDER.map((s, i) => {
          const m = UNIT_STATUS_META[s];
          const Icon = m.icon;
          return (
            <span key={s} className="inline-flex items-center gap-1">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${m.cls}`}>
                <Icon className="w-3 h-3" /> {m.label}
              </span>
              {i < UNIT_STATUS_ORDER.length - 1 && <ArrowRight className="w-3 h-3 text-gray-300" />}
            </span>
          );
        })}
        <span className="text-[11px] text-gray-400 ml-1">↺ loops</span>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-center">
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setStatusFilter("all")}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition border ${statusFilter === "all" ? "bg-yellow-400 text-black border-yellow-400" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>All</button>
          {UNIT_STATUS_ORDER.map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition border ${statusFilter === s ? "bg-yellow-400 text-black border-yellow-400" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
              {UNIT_STATUS_META[s].label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search room or wing…" value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
        </div>
      </div>

      {(roomsQ.error || turnoversQ.error) && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {roomsQ.error || turnoversQ.error}</div>}

      {/* Room lifecycle cards (mobile-friendly) */}
      {roomsQ.loading && rooms.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading units...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">No units match your filters.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {paginated.map(room => {
            const m = UNIT_STATUS_META[room.housekeepingStatus] ?? UNIT_STATUS_META.READY;
            const Icon = m.icon;
            const busy = busyId === room.id;
            return (
              <div key={room.id} className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-lg font-bold text-gray-900">Room {room.roomNumber}</p>
                    <p className="text-xs text-gray-500">{room.wing ? `${room.wing} Wing · ` : ""}{room.roomType.replace(/_/g, " ")}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${m.cls}`}>
                    <Icon className="w-3 h-3" /> {m.label}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <button onClick={() => setViewingRoom(room)} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-xs font-medium">
                    <Eye className="w-3.5 h-3.5" /> View Details
                  </button>
                  <button onClick={() => advance(room)} disabled={busy}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-md transition active:scale-95 disabled:opacity-60 text-xs">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><ArrowRight className="w-3.5 h-3.5" /> Advance</>}
                  </button>
                </div>
              </div>
            );
          })}
          </div>
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-gray-500">{filtered.length} rooms total</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm"><ChevronLeft className="w-4 h-4" /></button>
                <span className="text-sm font-medium text-gray-700">Page {page} of {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
          )}
        </>
      )}

      {/* View Modal */}
      {viewingRoom && <TurnoverViewModal room={viewingRoom} turnover={activeTurnovers.find(t => t.roomNumber === viewingRoom.roomNumber) ?? null} onClose={() => setViewingRoom(null)} />}

      {/* Active turnover checklists — view modal */}
      {activeTurnovers.length > 0 && (
        <button onClick={() => setViewingChecklists(true)}
          className="w-full bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between hover:bg-gray-50 transition text-left">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-yellow-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Active Turnover Checklists</h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">{activeTurnovers.length}</span>
          </div>
          <Eye className="w-4 h-4 text-gray-400" />
        </button>
      )}
      {viewingChecklists && <ChecklistsModal turnovers={activeTurnovers} onClose={() => setViewingChecklists(false)} toast={toast} />}

      {confirmDialog}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

/* ── Sub-components ── */

function Stat({ label, value, icon: Icon, color }: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; color: string }) {
  const COLORS: Record<string, string> = {
    indigo: "text-indigo-600 bg-indigo-50 border-indigo-200",
    green: "text-green-600 bg-green-50 border-green-200",
    amber: "text-amber-600 bg-amber-50 border-amber-200",
    purple: "text-purple-600 bg-purple-50 border-purple-200",
  };
  const c = COLORS[color] || COLORS.indigo;
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

function TurnoverViewModal({ room, turnover, onClose }: { room: RoomCard; turnover: Turnover | null; onClose: () => void }) {
  const m = UNIT_STATUS_META[room.housekeepingStatus] ?? UNIT_STATUS_META.READY;

  const fields: [string, string][] = [
    ["Room", room.roomNumber],
    ["Wing", room.wing || "—"],
    ["Floor", String(room.floor || "—")],
    ["Room Type", room.roomType.replace(/_/g, " ")],
    ["Housekeeping Status", m.label],
    ["Occupancy Status", room.status],
  ];

  if (turnover) {
    const tm = UNIT_STATUS_META[turnover.stage] ?? UNIT_STATUS_META.TURNOVER;
    fields.push(
      ["Turnover Stage", tm.label],
      ["Turnover Status", turnover.status.replace(/_/g, " ")],
      ["Outgoing Resident", turnover.outgoingResident || "—"],
      ["Incoming Resident", turnover.incomingResident || "—"],
      ["Started", turnover.startedAt ? new Date(turnover.startedAt).toLocaleString() : "—"],
      ["Ready At", turnover.readyAt ? new Date(turnover.readyAt).toLocaleString() : "—"],
      ["Inspection Passed", turnover.inspectionPassed ? "Yes" : "No"],
      ["Assigned To", turnover.assignedTo || "—"],
      ["Notes", turnover.notes || "—"],
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
          <h2 className="text-xl font-bold">Room {room.roomNumber}</h2>
          <button onClick={onClose} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-6 space-y-4">
          {fields.map(([label, value]) => (
            <div key={label} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
              <p className="text-sm font-medium text-gray-900 mt-0.5 whitespace-pre-wrap">{value}</p>
            </div>
          ))}
          {turnover && turnover.checklist.length > 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Checklist</p>
              <div className="space-y-1">
                {turnover.checklist.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    {c.ok ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Circle className="w-4 h-4 text-gray-300" />}
                    <span className={c.ok ? "line-through text-gray-400" : "text-gray-700"}>{c.item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end">
          <button onClick={onClose} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Close</button>
        </div>
      </div>
    </div>
  );
}

function ChecklistsModal({ turnovers, onClose, toast }: {
  turnovers: Turnover[];
  onClose: () => void;
  toast: (variant: "success" | "error", title: string, description?: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const toggleChecklistItem = async (t: Turnover, idx: number) => {
    setBusyId(t.id);
    try {
      const checklist = t.checklist.map((c, i) => (i === idx ? { ...c, ok: !c.ok } : c));
      await updateRecord("room-turnovers", t.id, { checklist: JSON.stringify(checklist) });
    } catch (err) {
      toast("error", "Failed", err instanceof Error ? err.message : "Could not update checklist.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            <h2 className="text-xl font-bold">Active Turnover Checklists</h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-600/20 font-semibold">{turnovers.length}</span>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-6 space-y-4">
          {turnovers.map(t => {
            const m = UNIT_STATUS_META[t.stage] ?? UNIT_STATUS_META.TURNOVER;
            const done = t.checklist.filter(c => c.ok).length;
            const total = t.checklist.length;
            return (
              <div key={t.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-bold text-gray-900">Room {t.roomNumber}</p>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${m.cls}`}>{m.label}</span>
                </div>
                {(t.outgoingResident || t.incomingResident) && (
                  <p className="text-[11px] text-gray-500 mb-2">
                    {t.outgoingResident && `Out: ${t.outgoingResident}`}
                    {t.outgoingResident && t.incomingResident && " · "}
                    {t.incomingResident && `In: ${t.incomingResident}`}
                  </p>
                )}
                {t.assignedTo && <p className="text-[11px] text-gray-400 mb-2">Assigned: {t.assignedTo}</p>}
                {total > 0 ? (
                  <>
                    <p className="text-[11px] text-gray-500 mb-2">{done}/{total} completed</p>
                    <div className="space-y-1">
                      {t.checklist.map((c, i) => (
                        <button key={i} onClick={() => toggleChecklistItem(t, i)} disabled={busyId === t.id}
                          className="w-full flex items-center gap-2 text-left text-xs text-gray-700 hover:bg-gray-50 rounded px-1.5 py-1 transition disabled:opacity-60">
                          {c.ok ? <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" /> : <Circle className="w-4 h-4 text-gray-300 flex-shrink-0" />}
                          <span className={c.ok ? "line-through text-gray-400" : ""}>{c.item}</span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-[11px] text-gray-400">No checklist items.</p>
                )}
              </div>
            );
          })}
        </div>
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end">
          <button onClick={onClose} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Close</button>
        </div>
      </div>
    </div>
  );
}
