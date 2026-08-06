"use client";

import RefreshButton from "@/components/portal/RefreshButton";

import { useMemo, useState, useEffect } from "react";
import {
  Pill, Search, X, Plus, RefreshCw, ListChecks, BarChart3, Clock,
  CheckCircle2, AlertTriangle, Eye, Trash2, PauseCircle, PlayCircle,
  Ban, Syringe, Sun, Sunrise, Sunset, Moon, HelpCircle, CalendarClock,
  UserRound, Undo2, type LucideIcon,
} from "lucide-react";
import Swal from "@/lib/swal";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Legend, Tooltip, BarChart, Bar,
  XAxis, YAxis, CartesianGrid,
} from "recharts";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident, humanize } from "@/lib/adapters";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";

/* ── Types ───────────────────────────────────────────────────────────── */

type MedStatus = "ACTIVE" | "DISCONTINUED" | "PENDING" | "ON_HOLD";
type SlotKey = "MORNING" | "NOON" | "EVENING" | "NIGHT" | "PRN";
type ViewKey = "rounds" | "list" | "analytics";

interface MedVM {
  id: string;
  residentId: string;
  residentName: string;
  room: string;
  name: string;
  dosage: string;
  frequency: string;
  route: string;
  status: MedStatus;
  startDate: string | null;
  endDate: string | null;
  prescribedBy: string;
  reason: string;
  sideEffects: string;
  contraindications: string;
  slots: SlotKey[];
}

/** One administration record = one MedicalNote row keyed `MAR|medId|slot|date`. */
interface MarEntry {
  noteId: string;
  medId: string;
  slot: SlotKey;
  date: string; // yyyy-mm-dd
  at: string | null;
}

/* ── Static metadata ─────────────────────────────────────────────────── */

const MAR_NOTE_TYPE = "MEDICATION_ADMIN";

const SLOTS: Record<SlotKey, { label: string; time: string; hour: number; icon: LucideIcon; badge: string }> = {
  MORNING: { label: "Morning", time: "08:00", hour: 8, icon: Sunrise, badge: "bg-amber-100 text-amber-800 border-amber-300" },
  NOON: { label: "Noon", time: "12:00", hour: 12, icon: Sun, badge: "bg-orange-100 text-orange-800 border-orange-300" },
  EVENING: { label: "Evening", time: "18:00", hour: 18, icon: Sunset, badge: "bg-indigo-100 text-indigo-800 border-indigo-300" },
  NIGHT: { label: "Night", time: "22:00", hour: 22, icon: Moon, badge: "bg-purple-100 text-purple-800 border-purple-300" },
  PRN: { label: "PRN / As Needed", time: "Any time", hour: 24, icon: HelpCircle, badge: "bg-gray-100 text-gray-700 border-gray-300" },
};
const SLOT_ORDER: SlotKey[] = ["MORNING", "NOON", "EVENING", "NIGHT", "PRN"];

const STATUS_BADGE: Record<MedStatus, string> = {
  ACTIVE: "bg-green-100 text-green-800 border-green-300",
  PENDING: "bg-blue-100 text-blue-800 border-blue-300",
  ON_HOLD: "bg-amber-100 text-amber-800 border-amber-300",
  DISCONTINUED: "bg-gray-200 text-gray-600 border-gray-300",
};
const STATUS_ORDER: MedStatus[] = ["ACTIVE", "PENDING", "ON_HOLD", "DISCONTINUED"];
const STATUS_COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#9ca3af"];

const ROUTES = ["oral", "injection", "IV", "topical", "inhalation", "sublingual", "transdermal"];

const asStr = (v: unknown): string => (v == null ? "" : String(v));
const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Map free-text frequency ("Twice daily", "BID", "Every 6 hours", "PRN") to schedule slots. */
function parseSlots(frequency: string): SlotKey[] {
  const f = frequency.toLowerCase();
  if (/prn|as needed|as required/.test(f)) return ["PRN"];
  if (/four|qid|4x|every 6/.test(f)) return ["MORNING", "NOON", "EVENING", "NIGHT"];
  if (/three|tid|3x|every 8/.test(f)) return ["MORNING", "NOON", "EVENING"];
  if (/twice|bid|2x|every 12/.test(f)) return ["MORNING", "EVENING"];
  if (/night|bedtime|hs\b/.test(f)) return ["NIGHT"];
  return ["MORNING"];
}

/* ── Component ───────────────────────────────────────────────────────── */

export default function NurseMedications() {
  const { data: medRows, loading, error, refetch } = useLiveQuery<Record<string, unknown>>(
    "medications", { query: "include=resident&take=500", tables: ["Medication"] }
  );
  const { data: residentRows, refetch: refetchResidents } = useLiveQuery<Record<string, unknown>>(
    "residents", { query: "take=300", tables: ["Resident"] }
  );
  // Administration log lives in MedicalNote rows (noteType=MEDICATION_ADMIN) so the
  // MAR is DB-backed and realtime across every open portal.
  const { data: marRows, refetch: refetchMar } = useLiveQuery<Record<string, unknown>>(
    "medical-notes", { query: `f_noteType=${MAR_NOTE_TYPE}&take=500`, tables: ["MedicalNote"] }
  );
  // Structured allergy records feed the prescribing safety check alongside the
  // resident's free-text allergies summary.
  const { data: allergyRows } = useLiveQuery<Record<string, unknown>>(
    "allergies", { query: "take=500", tables: ["Allergy"] }
  );

  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  const [view, setView] = useState<ViewKey>("rounds");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | MedStatus>("all");
  const [routeFilter, setRouteFilter] = useState<string>("all");
  const [perPage, setPerPage] = useState(9);
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState<MedVM | null>(null);
  const [adding, setAdding] = useState(false);
  // Demo mode never persists MAR notes server-side; keep session-local copies merged in.
  const [localMar, setLocalMar] = useState<MarEntry[]>([]);

  const residents = useMemo(() => residentRows.map(adaptResident), [residentRows]);
  const residentById = useMemo(() => new Map(residents.map((r) => [r.id, r])), [residents]);
  // Merge structured allergens per resident so the add-medication check screens
  // against both the free-text summary and the discrete Allergy records.
  const allergensByResident = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of allergyRows) {
      const rid = String(a.residentId ?? "");
      const allergen = String(a.allergen ?? "").trim();
      if (!rid || !allergen) continue;
      const arr = m.get(rid) ?? [];
      arr.push(allergen);
      m.set(rid, arr);
    }
    return m;
  }, [allergyRows]);

  const meds = useMemo<MedVM[]>(() => medRows.map((row) => {
    const rel = row.resident as { firstName?: string; lastName?: string; roomNumber?: string } | undefined;
    const joined = residentById.get(String(row.residentId ?? ""));
    return {
      id: String(row.id),
      residentId: asStr(row.residentId),
      residentName: rel ? `${rel.firstName ?? ""} ${rel.lastName ?? ""}`.trim() : joined?.name ?? "Unknown resident",
      room: rel?.roomNumber ?? joined?.room ?? "—",
      name: asStr(row.name),
      dosage: asStr(row.dosage),
      frequency: asStr(row.frequency) || "Daily",
      route: asStr(row.route) || "oral",
      status: (STATUS_ORDER.includes(row.status as MedStatus) ? row.status : "ACTIVE") as MedStatus,
      startDate: row.startDate ? String(row.startDate) : null,
      endDate: row.endDate ? String(row.endDate) : null,
      prescribedBy: asStr(row.prescribedBy),
      reason: asStr(row.reason),
      sideEffects: asStr(row.sideEffects),
      contraindications: asStr(row.contraindications),
      slots: parseSlots(asStr(row.frequency) || "Daily"),
    };
  }), [medRows, residentById]);

  /* MAR entries: DB notes + session-local optimistic entries, deduped by key. */
  const marEntries = useMemo<MarEntry[]>(() => {
    const parsed: MarEntry[] = [];
    marRows.forEach((row) => {
      const firstLine = asStr(row.content).split("\n")[0];
      const [tag, medId, slot, date] = firstLine.split("|");
      if (tag === "MAR" && medId && slot && date) {
        parsed.push({
          noteId: String(row.id), medId, slot: slot as SlotKey, date,
          at: row.createdAt ? String(row.createdAt) : null,
        });
      }
    });
    const seen = new Set(parsed.map((e) => `${e.medId}|${e.slot}|${e.date}`));
    return [...parsed, ...localMar.filter((e) => !seen.has(`${e.medId}|${e.slot}|${e.date}`))];
  }, [marRows, localMar]);

  const today = nowTs ? dateKey(new Date(nowTs)) : "";
  const givenToday = useMemo(() => {
    const map = new Map<string, MarEntry>();
    marEntries.forEach((e) => { if (e.date === today) map.set(`${e.medId}|${e.slot}`, e); });
    return map;
  }, [marEntries, today]);

  /* Today's rounds board: every scheduled slot of every ACTIVE med. */
  const rounds = useMemo(() => {
    const active = meds.filter((m) => m.status === "ACTIVE");
    const hourNow = nowTs ? new Date(nowTs).getHours() : 0;
    return SLOT_ORDER.map((slot) => {
      const doses = active
        .filter((m) => m.slots.includes(slot))
        .map((m) => {
          const given = givenToday.get(`${m.id}|${slot}`);
          const state: "given" | "due" | "upcoming" = given
            ? "given"
            : slot === "PRN" ? "upcoming" : hourNow >= SLOTS[slot].hour ? "due" : "upcoming";
          return { med: m, given, state };
        })
        .sort((a, b) => a.med.room.localeCompare(b.med.room, undefined, { numeric: true }));
      return { slot, doses };
    }).filter((g) => g.doses.length > 0);
  }, [meds, givenToday, nowTs]);

  const stats = useMemo(() => {
    const scheduled = rounds.filter((g) => g.slot !== "PRN").reduce((s, g) => s + g.doses.length, 0);
    const given = rounds.filter((g) => g.slot !== "PRN").reduce((s, g) => s + g.doses.filter((d) => d.state === "given").length, 0);
    const overdue = rounds.reduce((s, g) => s + g.doses.filter((d) => d.state === "due").length, 0);
    return {
      active: meds.filter((m) => m.status === "ACTIVE").length,
      scheduled,
      given,
      overdue,
      onHold: meds.filter((m) => m.status === "ON_HOLD" || m.status === "PENDING").length,
    };
  }, [meds, rounds]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return meds.filter((m) => {
      if (q && !m.name.toLowerCase().includes(q) && !m.residentName.toLowerCase().includes(q) && !m.room.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && m.status !== statusFilter) return false;
      if (routeFilter !== "all" && m.route.toLowerCase() !== routeFilter) return false;
      return true;
    }).sort((a, b) => a.residentName.localeCompare(b.residentName) || a.name.localeCompare(b.name));
  }, [meds, search, statusFilter, routeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const start = (page - 1) * perPage;
  const paginated = filtered.slice(start, start + perPage);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset paging on filter change
    setPage(1);
  }, [search, statusFilter, routeFilter, perPage]);

  const refreshAll = () => { void refetch(); void refetchResidents(); void refetchMar(); };

  /* ── Mutations ─────────────────────────────────────────────────────── */

  const handleAdminister = async (m: MedVM, slot: SlotKey) => {
    const result = await Swal.fire({
      title: "Administer Medication?",
      html: `<b>${m.name} ${m.dosage}</b> (${m.route})<br/>${m.residentName} • Room ${m.room}<br/><span style="color:#6b7280">${SLOTS[slot].label} dose</span>`,
      icon: "question",
      showCancelButton: true,
      confirmButtonColor: "#10b981",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Administer",
    });
    if (!result.isConfirmed) return;
    const key = `MAR|${m.id}|${slot}|${today}`;
    try {
      const res = await createRecord("medical-notes", {
        residentId: m.residentId,
        noteType: MAR_NOTE_TYPE,
        title: `Administered: ${m.name} ${m.dosage} (${SLOTS[slot].label})`,
        content: `${key}\n${m.name} ${m.dosage} given via ${m.route} — ${SLOTS[slot].label} dose.`,
        authorName: "Nurse on duty",
      }) as { data?: { id?: string } };
      setLocalMar((prev) => [...prev, {
        noteId: String(res?.data?.id ?? `local-${key}`), medId: m.id, slot, date: today,
        at: new Date().toISOString(),
      }]);
      await refetchMar();
      Swal.fire({ title: "Recorded", text: `${m.name} marked administered.`, icon: "success", timer: 1400, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not record administration.", icon: "error" });
    }
  };

  const handleUndo = async (m: MedVM, entry: MarEntry) => {
    try {
      if (!entry.noteId.startsWith("local-")) await deleteRecord("medical-notes", entry.noteId);
      setLocalMar((prev) => prev.filter((e) => !(e.medId === entry.medId && e.slot === entry.slot && e.date === entry.date)));
      await refetchMar();
    } catch (err) {
      Swal.fire({ title: "Undo Failed", text: err instanceof Error ? err.message : "Could not undo.", icon: "error" });
    }
  };

  const handleStatus = async (m: MedVM, status: MedStatus, verb: string) => {
    const result = await Swal.fire({
      title: `${verb} Medication?`,
      text: `${m.name} ${m.dosage} for ${m.residentName}`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: status === "DISCONTINUED" ? "#ef4444" : "#f59e0b",
      cancelButtonColor: "#6b7280",
      confirmButtonText: verb,
    });
    if (!result.isConfirmed) return;
    try {
      await updateRecord("medications", m.id, {
        status,
        ...(status === "DISCONTINUED" ? { endDate: new Date().toISOString() } : {}),
      });
      await refetch();
      setViewing((v) => (v && v.id === m.id ? { ...v, status } : v));
      Swal.fire({ title: "Updated", icon: "success", timer: 1300, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Update Failed", text: err instanceof Error ? err.message : "Could not update.", icon: "error" });
    }
  };

  const handleDelete = async (m: MedVM) => {
    const result = await Swal.fire({
      title: "Delete Medication?",
      text: `${m.name} ${m.dosage} will be permanently removed from ${m.residentName}'s record.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Delete",
    });
    if (!result.isConfirmed) return;
    try {
      await deleteRecord("medications", m.id);
      await refetch();
      setViewing((v) => (v && v.id === m.id ? null : v));
      Swal.fire({ title: "Deleted", icon: "success", timer: 1300, showConfirmButton: false });
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
            <Pill className="w-7 h-7 text-yellow-500 flex-shrink-0" /> Medication Rounds
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-green-600">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live
            </span>
            eMAR — today&apos;s schedule, administrations &amp; full formulary
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
            {([["rounds", CalendarClock, "Rounds"], ["list", ListChecks, "All Medications"], ["analytics", BarChart3, "Analytics"]] as [ViewKey, LucideIcon, string][]).map(([key, Icon, label], i) => (
              <button key={key} onClick={() => setView(key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition ${i > 0 ? "border-l border-gray-300" : ""} ${view === key ? "bg-yellow-400 text-black" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
                <Icon className="w-4 h-4" /> {label}
              </button>
            ))}
          </div>
          <RefreshButton onRefresh={refreshAll} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium" />
          <button onClick={() => setAdding(true)} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">
            <Plus className="w-4 h-4" /> Add Medication
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        <Stat label="Active Medications" value={stats.active} icon={Pill} tone="gray" />
        <Stat label="Doses Today" value={stats.scheduled} icon={CalendarClock} tone="blue" />
        <Stat label="Administered" value={stats.given} icon={CheckCircle2} tone="green" />
        <Stat label="Due Now" value={stats.overdue} icon={AlertTriangle} tone="red" />
        <Stat label="On Hold / Pending" value={stats.onHold} icon={PauseCircle} tone="amber" />
      </div>

      {/* ── Rounds board ── */}
      {view === "rounds" && (
        loading && meds.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">Loading medication schedule…</div>
        ) : error ? (
          <div className="bg-white rounded-lg border border-red-200 p-10 text-center text-red-600">Failed to load: {error}</div>
        ) : rounds.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">No active medications scheduled. Add one to start the round.</div>
        ) : (
          <div className="space-y-4">
            {rounds.map(({ slot, doses }) => {
              const meta = SLOTS[slot];
              const SlotIcon = meta.icon;
              const done = doses.filter((d) => d.state === "given").length;
              return (
                <div key={slot} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between gap-2 flex-wrap">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-sm font-semibold border ${meta.badge}`}>
                      <SlotIcon className="w-4 h-4" /> {meta.label} <span className="font-normal opacity-70">• {meta.time}</span>
                    </span>
                    <span className="text-xs font-semibold text-gray-600">{done}/{doses.length} given</span>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {doses.map(({ med: m, given, state }) => (
                      <div key={`${m.id}-${slot}`} className={`px-4 py-3 flex items-center gap-3 flex-wrap ${state === "due" ? "bg-red-50/60" : state === "given" ? "bg-green-50/40" : ""}`}>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-gray-900 text-sm truncate">💊 {m.name} <span className="text-gray-500 font-normal">{m.dosage}</span></p>
                          <p className="text-xs text-gray-600 flex items-center gap-1"><UserRound className="w-3 h-3" /> {m.residentName} • Room {m.room} • {m.route}</p>
                        </div>
                        {state === "given" && given ? (
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-semibold">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Given {given.at ? new Date(given.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                            </span>
                            <button onClick={() => void handleUndo(m, given)} title="Undo" className="p-1.5 text-gray-500 hover:bg-gray-100 rounded transition">
                              <Undo2 className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            {state === "due" && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-semibold">
                                <AlertTriangle className="w-3.5 h-3.5" /> Due
                              </span>
                            )}
                            {state === "upcoming" && slot !== "PRN" && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-semibold">
                                <Clock className="w-3.5 h-3.5" /> Upcoming
                              </span>
                            )}
                            <button onClick={() => void handleAdminister(m, slot)}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-green-400 to-green-500 text-white text-sm font-semibold rounded-lg hover:shadow transition active:scale-95">
                              <Syringe className="w-4 h-4" /> Administer
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── Formulary list ── */}
      {view === "list" && (
        <>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
              <input type="text" placeholder="Search by medication, resident, or room…" value={search} onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | MedStatus)} className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none">
                <option value="all">All Statuses</option>
                {STATUS_ORDER.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
              </select>
              <select value={routeFilter} onChange={(e) => setRouteFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none">
                <option value="all">All Routes</option>
                {ROUTES.map((r) => <option key={r} value={r.toLowerCase()}>{r}</option>)}
              </select>
              <select value={perPage} onChange={(e) => setPerPage(parseInt(e.target.value))} className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none">
                <option value={9}>9 per page</option>
                <option value={18}>18 per page</option>
                <option value={36}>36 per page</option>
              </select>
            </div>
          </div>

          {loading && meds.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">Loading medications…</div>
          ) : error ? (
            <div className="bg-white rounded-lg border border-red-200 p-10 text-center text-red-600">Failed to load: {error}</div>
          ) : paginated.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {paginated.map((m) => (
                <div key={m.id} className="bg-white rounded-lg border border-gray-200 hover:border-yellow-300 hover:shadow-md transition p-4 flex flex-col">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <h3 className="font-bold text-gray-900 truncate">💊 {m.name}</h3>
                      <p className="text-sm text-gray-600">{m.dosage} • {m.frequency}</p>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-semibold border flex-shrink-0 ${STATUS_BADGE[m.status]}`}>{humanize(m.status)}</span>
                  </div>
                  <p className="text-sm text-gray-700 flex items-center gap-1 mb-1"><UserRound className="w-3.5 h-3.5 text-gray-400" /> {m.residentName} • Room {m.room}</p>
                  <p className="text-xs text-gray-500 mb-3 capitalize">Route: {m.route}{m.prescribedBy ? ` • Rx: ${m.prescribedBy}` : ""}</p>
                  <div className="flex flex-wrap gap-1 mb-3">
                    {m.slots.map((s) => (
                      <span key={s} className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${SLOTS[s].badge}`}>{SLOTS[s].label}</span>
                    ))}
                  </div>
                  <div className="mt-auto flex items-center gap-1 pt-2 border-t border-gray-100 flex-wrap">
                    <button onClick={() => setViewing(m)} className="flex items-center gap-1 px-2.5 py-1 text-blue-600 hover:bg-blue-50 rounded text-sm font-medium transition">
                      <Eye className="w-4 h-4" /> View
                    </button>
                    {m.status === "ACTIVE" && (
                      <button onClick={() => void handleStatus(m, "ON_HOLD", "Hold")} className="flex items-center gap-1 px-2.5 py-1 text-amber-600 hover:bg-amber-50 rounded text-sm font-medium transition">
                        <PauseCircle className="w-4 h-4" /> Hold
                      </button>
                    )}
                    {(m.status === "ON_HOLD" || m.status === "PENDING") && (
                      <button onClick={() => void handleStatus(m, "ACTIVE", "Resume")} className="flex items-center gap-1 px-2.5 py-1 text-green-600 hover:bg-green-50 rounded text-sm font-medium transition">
                        <PlayCircle className="w-4 h-4" /> Resume
                      </button>
                    )}
                    {m.status !== "DISCONTINUED" && (
                      <button onClick={() => void handleStatus(m, "DISCONTINUED", "Discontinue")} className="flex items-center gap-1 px-2.5 py-1 text-gray-600 hover:bg-gray-100 rounded text-sm font-medium transition">
                        <Ban className="w-4 h-4" /> Stop
                      </button>
                    )}
                    <button onClick={() => void handleDelete(m)} className="flex items-center gap-1 px-2.5 py-1 text-red-600 hover:bg-red-50 rounded text-sm font-medium transition ml-auto">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">
              {meds.length === 0 ? "No medications on file yet. Add the first one." : "No medications match your filters."}
            </div>
          )}

          {filtered.length > perPage && (
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="text-sm text-gray-600">Showing {start + 1}-{Math.min(start + perPage, filtered.length)} of {filtered.length} medications</div>
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
      {view === "analytics" && <MedsAnalytics meds={meds} marEntries={marEntries} nowTs={nowTs} />}

      {/* ── Detail modal ── */}
      {viewing && (
        <Modal title={`💊 ${viewing.name} ${viewing.dosage}`} subtitle={`${viewing.residentName} • Room ${viewing.room}`} onClose={() => setViewing(null)}>
          <div className="p-6 sm:p-8 space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`px-3 py-1 rounded-full text-sm font-bold border ${STATUS_BADGE[viewing.status]}`}>{humanize(viewing.status)}</span>
              <span className="px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-700 capitalize">{viewing.route}</span>
              <span className="px-3 py-1 rounded-full text-sm font-medium bg-blue-50 text-blue-700">{viewing.frequency}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Detail label="Start Date">{viewing.startDate ? new Date(viewing.startDate).toLocaleDateString() : "—"}</Detail>
              <Detail label="End Date">{viewing.endDate ? new Date(viewing.endDate).toLocaleDateString() : "Ongoing"}</Detail>
              <Detail label="Prescribed By">{viewing.prescribedBy || "—"}</Detail>
              <Detail label="Reason">{viewing.reason || "—"}</Detail>
            </div>
            {viewing.sideEffects && (
              <div className="bg-amber-50 border-l-4 border-amber-400 p-3 rounded">
                <p className="text-sm font-semibold text-amber-800 mb-1">Side Effects</p>
                <p className="text-gray-900 text-sm">{viewing.sideEffects}</p>
              </div>
            )}
            {viewing.contraindications && (
              <div className="bg-red-50 border-l-4 border-red-400 p-3 rounded">
                <p className="text-sm font-semibold text-red-700 mb-1 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Contraindications</p>
                <p className="text-gray-900 text-sm">{viewing.contraindications}</p>
              </div>
            )}
            <div>
              <h3 className="font-bold text-gray-900 mb-2">Administration History</h3>
              <div className="space-y-1.5 max-h-44 overflow-y-auto">
                {(() => {
                  const history = marEntries.filter((e) => e.medId === viewing.id)
                    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
                  return history.length ? history.slice(0, 12).map((e, i) => (
                    <div key={i} className="flex items-center justify-between text-sm p-2 bg-green-50 rounded border border-green-100">
                      <span className="text-gray-700 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> {SLOTS[e.slot]?.label ?? e.slot} dose</span>
                      <span className="text-xs text-gray-500">{e.at ? new Date(e.at).toLocaleString() : e.date}</span>
                    </div>
                  )) : <p className="text-sm text-gray-500">No administrations recorded yet.</p>;
                })()}
              </div>
            </div>
          </div>
          <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-2">
            <button onClick={() => setViewing(null)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Close</button>
            {viewing.status !== "DISCONTINUED" && (
              <button onClick={() => void handleStatus(viewing, "DISCONTINUED", "Discontinue")}
                className="flex items-center gap-2 px-5 py-2 bg-red-50 text-red-600 border border-red-200 font-semibold rounded-lg hover:bg-red-100 transition">
                <Ban className="w-4 h-4" /> Discontinue
              </button>
            )}
          </div>
        </Modal>
      )}

      {/* ── Add medication modal ── */}
      {adding && (
        <AddMedicationModal
          residents={residents.map((r) => ({ id: r.id, name: r.name, room: r.room, allergies: [r.allergies, ...(allergensByResident.get(r.id) ?? [])].filter(Boolean).join(", ") }))}
          onClose={() => setAdding(false)}
          onSaved={() => { void refetch(); setAdding(false); }}
        />
      )}
    </div>
  );
}

/* ── Analytics module ────────────────────────────────────────────────── */

const ROUTE_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ef4444", "#06b6d4", "#f97316"];

function MedsAnalytics({ meds, marEntries, nowTs }: { meds: MedVM[]; marEntries: MarEntry[]; nowTs: number }) {
  const a = useMemo(() => {
    const byStatus = STATUS_ORDER
      .map((s) => ({ name: humanize(s), value: meds.filter((m) => m.status === s).length }))
      .filter((d) => d.value > 0);

    const routeMap = new Map<string, number>();
    meds.forEach((m) => routeMap.set(m.route.toLowerCase(), (routeMap.get(m.route.toLowerCase()) ?? 0) + 1));
    const byRoute = Array.from(routeMap.entries()).map(([name, Medications]) => ({ name, Medications }));

    const resMap = new Map<string, number>();
    meds.filter((m) => m.status === "ACTIVE").forEach((m) => resMap.set(m.residentName, (resMap.get(m.residentName) ?? 0) + 1));
    const topResidents = Array.from(resMap.entries())
      .map(([name, Active]) => ({ name, Active }))
      .sort((x, y) => y.Active - x.Active).slice(0, 8);

    const anchor = new Date(nowTs || 0);
    const daily: { day: string; Administered: number }[] = [];
    const idx = new Map<string, number>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(anchor);
      d.setDate(anchor.getDate() - i);
      idx.set(dateKey(d), daily.length);
      daily.push({ day: d.toLocaleDateString(undefined, { weekday: "short" }), Administered: 0 });
    }
    marEntries.forEach((e) => {
      const i = idx.get(e.date);
      if (i != null) daily[i].Administered += 1;
    });

    return { byStatus, byRoute, topResidents, daily };
  }, [meds, marEntries, nowTs]);

  if (meds.length === 0) {
    return <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">No medication data to analyze yet.</div>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartCard title="Administrations — Last 7 Days" className="lg:col-span-2">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={a.daily} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="day" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={28} />
            <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <Bar dataKey="Administered" fill="#22c55e" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Medications by Status">
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie data={a.byStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
              {a.byStatus.map((_, i) => <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />)}
            </Pie>
            <Tooltip /><Legend />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Medications by Route">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={a.byRoute} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={28} />
            <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <Bar dataKey="Medications" radius={[4, 4, 0, 0]}>
              {a.byRoute.map((_, i) => <Cell key={i} fill={ROUTE_COLORS[i % ROUTE_COLORS.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Active Medications per Resident" className="lg:col-span-2">
        <ResponsiveContainer width="100%" height={Math.max(200, a.topResidents.length * 36)}>
          <BarChart data={a.topResidents} layout="vertical" margin={{ top: 8, right: 24, left: 24, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
            <XAxis type="number" allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" width={140} fontSize={12} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <Bar dataKey="Active" fill="#3b82f6" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

/* ── Add-medication modal ────────────────────────────────────────────── */

interface MedForm {
  residentId: string; name: string; dosage: string; frequency: string;
  route: string; status: MedStatus; startDate: string; endDate: string;
  prescribedBy: string; reason: string; sideEffects: string; contraindications: string;
}

const FREQUENCIES = ["Daily", "Twice daily", "Three times daily", "Four times daily", "Every 12 hours", "At bedtime", "PRN (as needed)"];

// Name-based allergy screen: flags when a new medication's name matches (or is
// matched by) a documented allergen. A heuristic safety net — not a full
// drug-class interaction database — surfaced as a confirm before prescribing.
function allergyConflicts(medName: string, allergies: string | undefined): string[] {
  const med = medName.trim().toLowerCase();
  if (!med || !allergies) return [];
  const skip = new Set(["none", "nkda", "no known allergies", "n/a", "na", "nil"]);
  const tokens = allergies.toLowerCase().split(/[,;/\n]|\band\b/).map((t) => t.trim()).filter((t) => t.length >= 3 && !skip.has(t));
  const hits = new Set<string>();
  for (const t of tokens) if (med.includes(t) || t.includes(med)) hits.add(t);
  return [...hits];
}

function AddMedicationModal({ residents, onClose, onSaved }: {
  residents: { id: string; name: string; room: string; allergies?: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<MedForm>({
    residentId: "", name: "", dosage: "", frequency: "Daily",
    route: "oral", status: "ACTIVE", startDate: new Date().toISOString().slice(0, 10), endDate: "",
    prescribedBy: "", reason: "", sideEffects: "", contraindications: "",
  });
  const [saving, setSaving] = useState(false);

  const set = (key: keyof MedForm) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const valid = form.residentId && form.name.trim() && form.dosage.trim() && form.frequency && form.startDate;
  const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none text-sm";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    // Allergy safety check: warn if the medication matches a documented allergy.
    const selected = residents.find((r) => r.id === form.residentId);
    const conflicts = allergyConflicts(form.name, selected?.allergies);
    if (conflicts.length) {
      const proceed = await Swal.fire({
        title: "Allergy alert",
        html: `<b>${selected?.name ?? "This resident"}</b> has a documented allergy to <b>${conflicts.join(", ")}</b>, which may conflict with <b>${form.name.trim()}</b>.<br/><br/>Prescribe anyway?`,
        icon: "warning", showCancelButton: true, confirmButtonColor: "#dc2626",
        confirmButtonText: "Prescribe anyway", cancelButtonText: "Cancel",
      });
      if (!proceed.isConfirmed) return;
    }
    setSaving(true);
    try {
      await createRecord("medications", {
        residentId: form.residentId,
        name: form.name.trim(),
        dosage: form.dosage.trim(),
        frequency: form.frequency,
        route: form.route,
        status: "PENDING", // new prescriptions require Care Manager approval before activating
        submittedByName: form.prescribedBy.trim() || null,
        startDate: new Date(form.startDate).toISOString(),
        endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
        prescribedBy: form.prescribedBy.trim() || null,
        reason: form.reason.trim() || null,
        sideEffects: form.sideEffects.trim() || null,
        contraindications: form.contraindications.trim() || null,
      });
      Swal.fire({ title: "Medication Added", icon: "success", timer: 1400, showConfirmButton: false });
      onSaved();
    } catch (err) {
      setSaving(false);
      Swal.fire({ title: "Save Failed", text: err instanceof Error ? err.message : "Could not add medication.", icon: "error" });
    }
  };

  return (
    <Modal title="Add Medication" subtitle="New prescription entry for the eMAR" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="p-6 sm:p-8 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Resident <span className="text-red-500">*</span></label>
            <select value={form.residentId} onChange={set("residentId")} className={inputCls}>
              <option value="">Select resident…</option>
              {residents.map((r) => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Medication Name <span className="text-red-500">*</span></label>
              <input type="text" value={form.name} onChange={set("name")} placeholder="Lisinopril" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Dosage <span className="text-red-500">*</span></label>
              <input type="text" value={form.dosage} onChange={set("dosage")} placeholder="10mg" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Frequency <span className="text-red-500">*</span></label>
              <select value={form.frequency} onChange={set("frequency")} className={inputCls}>
                {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Route</label>
              <select value={form.route} onChange={set("route")} className={inputCls}>
                {ROUTES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Status</label>
              <select value={form.status} onChange={set("status")} className={inputCls}>
                {STATUS_ORDER.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Prescribed By</label>
              <input type="text" value={form.prescribedBy} onChange={set("prescribedBy")} placeholder="Prescribing physician" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Start Date <span className="text-red-500">*</span></label>
              <input type="date" value={form.startDate} onChange={set("startDate")} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">End Date (optional)</label>
              <input type="date" value={form.endDate} onChange={set("endDate")} min={form.startDate} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Reason / Indication</label>
            <input type="text" value={form.reason} onChange={set("reason")} placeholder="Hypertension management" className={inputCls} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Side Effects</label>
              <textarea value={form.sideEffects} onChange={set("sideEffects")} rows={2} placeholder="Dizziness, dry cough…" className={`${inputCls} resize-y`} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Contraindications</label>
              <textarea value={form.contraindications} onChange={set("contraindications")} rows={2} placeholder="Avoid with NSAIDs…" className={`${inputCls} resize-y`} />
            </div>
          </div>
        </div>
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={onClose} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Cancel</button>
          <button type="submit" disabled={!valid || saving}
            className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed">
            <Plus className="w-4 h-4" /> {saving ? "Saving…" : "Add Medication"}
          </button>
        </div>
      </form>
    </Modal>
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

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm font-semibold text-gray-600 mb-1">{label}</p>
      <p className="text-gray-900 text-sm">{children}</p>
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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 sm:p-6 flex items-center justify-between z-10">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold">{title}</h2>
            {subtitle && <p className="text-yellow-900/70 text-sm">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-2 hover:bg-black/10 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
