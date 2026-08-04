"use client";

import RefreshButton from "@/components/portal/RefreshButton";

import { useMemo, useState, useEffect } from "react";
import {
  UtensilsCrossed, RefreshCw, Plus, X, Trash2, Search, Ban, CheckCircle2,
  Loader2, ClipboardList, ShieldAlert,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";
import { adaptResident } from "@/lib/adapters";
import { packMeals, parseMeals, hasMeals } from "@/lib/dietMeals";

/**
 * Nutritionist-facing per-resident Diet & Nutrition ordering board — live via
 * Supabase realtime + polling fallback. A nutritionist sets a diet order per
 * resident (diet type + restrictions + meal targeting); the kitchen reads the
 * active orders as a cook list (see KitchenCookList). DietOrder model, "diet-orders".
 */

type Row = Record<string, unknown>;

const DIET_TYPES = [
  "REGULAR", "LOW_SODIUM", "LOW_SUGAR", "DIABETIC", "SOFT", "PUREED",
  "HIGH_FIBER", "RENAL", "HIGH_PROTEIN",
] as const;
type DietType = (typeof DIET_TYPES)[number];

const MEAL_TYPES = ["ALL", "BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const;
type MealType = (typeof MEAL_TYPES)[number];

/** Color-coded pill classes per diet type (shared with KitchenCookList). */
const DIET_PILL: Record<string, string> = {
  REGULAR: "bg-gray-100 text-gray-700 border-gray-200",
  LOW_SODIUM: "bg-blue-100 text-blue-700 border-blue-200",
  LOW_SUGAR: "bg-amber-100 text-amber-700 border-amber-200",
  DIABETIC: "bg-red-100 text-red-700 border-red-200",
  SOFT: "bg-purple-100 text-purple-700 border-purple-200",
  PUREED: "bg-pink-100 text-pink-700 border-pink-200",
  HIGH_FIBER: "bg-green-100 text-green-700 border-green-200",
  RENAL: "bg-cyan-100 text-cyan-700 border-cyan-200",
  HIGH_PROTEIN: "bg-indigo-100 text-indigo-700 border-indigo-200",
};

const dietLabel = (d: string) => d.replace(/_/g, " ");
// REGULAR = a normal diet with no restrictions — spell it out in the dropdowns.
const dietOptionLabel = (d: string) => (d === "REGULAR" ? "Regular — No Restriction" : dietLabel(d));

const adaptOrder = (r: Row) => ({
  id: String(r.id ?? ""),
  residentId: String(r.residentId ?? ""),
  residentName: String(r.residentName ?? "—"),
  roomNumber: String(r.roomNumber ?? ""),
  dietType: String(r.dietType ?? "REGULAR") as DietType,
  restrictions: String(r.restrictions ?? ""),
  mealType: String(r.mealType ?? "ALL") as MealType,
  notes: String(r.notes ?? ""),
  active: r.active === undefined ? true : Boolean(r.active),
  orderedBy: String(r.orderedBy ?? ""),
  createdAt: String(r.createdAt ?? ""),
});
type DietOrder = ReturnType<typeof adaptOrder>;

const emptyForm = {
  residentId: "", dietType: "REGULAR" as DietType, mealType: "ALL" as MealType,
  restrictions: "", notes: "",
  breakfast: "", lunch: "", dinner: "",
};

export default function DietOrdersBoard() {
  const { data: rows, loading, error, refetch } = useLiveQuery<Row>(
    "diet-orders", { query: "take=300", tables: ["DietOrder"] }
  );
  const residentsQ = useLiveQuery<Row>("residents", { query: "take=300", tables: ["Resident"] });

  const orders = useMemo<DietOrder[]>(() => rows.map(adaptOrder), [rows]);
  const residents = useMemo(() => residentsQ.data.map(adaptResident), [residentsQ.data]);

  const [search, setSearch] = useState("");
  const [dietFilter, setDietFilter] = useState("all");
  const [mealFilter, setMealFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busyId, setBusyId] = useState<string | null>(null);
  // The ordering nutritionist is recorded automatically from the session.
  const [me, setMe] = useState<string>("");
  useEffect(() => {
    fetch("/api/auth/session").then(r => r.json()).then(d => { if (d?.authenticated) setMe(d.session?.name ?? "Nutritionist"); }).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter(o => {
      if (q && !o.residentName.toLowerCase().includes(q) && !o.roomNumber.toLowerCase().includes(q) && !o.restrictions.toLowerCase().includes(q)) return false;
      if (dietFilter !== "all" && o.dietType !== dietFilter) return false;
      if (mealFilter !== "all" && o.mealType !== mealFilter) return false;
      return true;
    });
  }, [orders, search, dietFilter, mealFilter]);

  const stats = useMemo(() => {
    const active = orders.filter(o => o.active);
    return {
      activeCount: active.length,
      restricted: active.filter(o => o.dietType !== "REGULAR").length,
    };
  }, [orders]);

  // Coverage — every resident should have a diet order. Surface who still needs one.
  const coverage = useMemo(() => {
    const covered = new Set(orders.filter(o => o.active).map(o => o.residentId));
    return { total: residents.length, covered: covered.size, uncovered: residents.filter(r => !covered.has(r.id)) };
  }, [orders, residents]);

  const openCreate = (residentId = "") => { setForm({ ...emptyForm, residentId }); setShowCreate(true); };

  const handleCreate = async () => {
    if (!form.residentId) {
      Swal.fire({ title: "Missing Fields", text: "Please select a resident.", icon: "warning" });
      return;
    }
    const resident = residents.find(r => r.id === form.residentId);
    try {
      await createRecord("diet-orders", {
        residentId: form.residentId,
        residentName: resident?.name || "—",
        roomNumber: resident?.room ? String(resident.room) : null,
        dietType: form.dietType,
        mealType: form.mealType,
        restrictions: form.restrictions || null,
        // Option B: per-resident meals are packed into notes alongside prep notes.
        notes: packMeals(form.notes, { breakfast: form.breakfast, lunch: form.lunch, dinner: form.dinner }) || null,
        active: true,
        orderedBy: me || null,
      });
      await refetch();
      setShowCreate(false);
      setForm(emptyForm);
      Swal.fire({ title: "Diet Order Set", text: `${dietLabel(form.dietType)} order created for ${resident?.name ?? "resident"}.`, icon: "success", timer: 1800, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Create Failed", text: err instanceof Error ? err.message : "Could not create diet order.", icon: "error" });
    }
  };

  const handleToggle = async (o: DietOrder) => {
    if (o.active) {
      const confirmed = await Swal.fire({
        title: "Discontinue Diet Order?",
        text: `Stop the ${dietLabel(o.dietType)} order for ${o.residentName}? It will drop off the kitchen cook list.`,
        icon: "warning", showCancelButton: true,
        confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Discontinue",
      });
      if (!confirmed.isConfirmed) return;
    }
    setBusyId(o.id);
    try {
      await updateRecord("diet-orders", o.id, { active: !o.active });
      await refetch();
    } catch (err) {
      Swal.fire({ title: "Update Failed", text: err instanceof Error ? err.message : "Could not update diet order.", icon: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (o: DietOrder) => {
    const confirmed = await Swal.fire({
      title: "Delete Diet Order?", text: `Remove the ${dietLabel(o.dietType)} order for ${o.residentName} permanently?`, icon: "warning",
      showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Delete",
    });
    if (!confirmed.isConfirmed) return;
    try {
      await deleteRecord("diet-orders", o.id);
      await refetch();
    } catch (err) {
      Swal.fire({ title: "Delete Failed", text: err instanceof Error ? err.message : "Could not delete diet order.", icon: "error" });
    }
  };

  const set = (field: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent mb-2">
            Diet &amp; Nutrition Orders
          </h1>
          <p className="text-gray-600">Nutritionist desk — set per-resident diet type, restrictions &amp; meal targeting. The kitchen cooks from the active orders.</p>
        </div>
        <div className="flex gap-2">
          <RefreshButton onRefresh={() => void refetch()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium" />
          <button onClick={() => openCreate()} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95">
            <Plus className="w-4 h-4" /> New Diet Order
          </button>
        </div>
      </div>

      {/* Stat Boxes */}
      <div className="grid grid-cols-3 gap-3 max-w-2xl">
        <StatBox label="Residents Covered" value={`${coverage.covered} / ${coverage.total}`} icon={CheckCircle2} color={coverage.uncovered.length ? "amber" : "emerald"} />
        <StatBox label="Active Orders" value={String(stats.activeCount)} icon={ClipboardList} color="emerald" />
        <StatBox label="Restricted Diets" value={String(stats.restricted)} icon={ShieldAlert} color="red" />
      </div>

      {/* Residents still needing a diet order — one tap to set each up. */}
      {coverage.uncovered.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="font-bold text-amber-900 text-sm mb-2 flex items-center gap-2">
            <UtensilsCrossed className="w-4 h-4" /> {coverage.uncovered.length} resident{coverage.uncovered.length === 1 ? "" : "s"} without a diet order — tap to set:
          </p>
          <div className="flex flex-wrap gap-2">
            {coverage.uncovered.map(r => (
              <button key={r.id} onClick={() => openCreate(r.id)} className="inline-flex items-center gap-1 rounded-full bg-white border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 transition">
                <Plus className="w-3 h-3" /> {r.name}{r.room ? ` · Rm ${r.room}` : ""}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search resident, room, or restriction…" value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-400 focus:border-transparent outline-none" />
        </div>
        <select value={dietFilter} onChange={e => setDietFilter(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-400 outline-none">
          <option value="all">All Diet Types</option>
          {DIET_TYPES.map(d => <option key={d} value={d}>{dietOptionLabel(d)}</option>)}
        </select>
        <select value={mealFilter} onChange={e => setMealFilter(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-400 outline-none">
          <option value="all">All Meals</option>
          {MEAL_TYPES.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {/* Orders table */}
      {loading && orders.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading diet orders...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">No diet orders match your filters.</div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Resident · Room</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Diet Type</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Meal</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Restrictions</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Ordered By</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(o => {
                const busy = busyId === o.id;
                return (
                  <tr key={o.id} className={`hover:bg-gray-50 transition ${o.active ? "" : "opacity-60"}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{o.residentName}</p>
                      <p className="text-xs text-gray-500">Room {o.roomNumber || "—"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${DIET_PILL[o.dietType] ?? DIET_PILL.REGULAR}`}>
                        {dietLabel(o.dietType)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{o.mealType}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs max-w-[240px]">
                      {(() => {
                        const { meals, notes } = parseMeals(o.notes);
                        return (
                          <>
                            <p className="truncate" title={o.restrictions}>{o.restrictions || "—"}</p>
                            {hasMeals(meals) && (
                              <p className="text-[11px] text-emerald-700 mt-0.5">
                                {meals.breakfast && <span title="Breakfast">🍳 {meals.breakfast} </span>}
                                {meals.lunch && <span title="Lunch">· 🍽 {meals.lunch} </span>}
                                {meals.dinner && <span title="Dinner">· 🌙 {meals.dinner}</span>}
                              </p>
                            )}
                            {notes && <p className="text-[11px] text-gray-400 truncate" title={notes}>{notes}</p>}
                          </>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{o.orderedBy || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${o.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {o.active ? "ACTIVE" : "DISCONTINUED"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        {busy ? (
                          <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                        ) : (
                          <>
                            <button onClick={() => handleToggle(o)} className={`p-1.5 rounded transition ${o.active ? "hover:bg-red-100 text-red-500" : "hover:bg-green-100 text-green-600"}`} title={o.active ? "Discontinue" : "Reactivate"}>
                              {o.active ? <Ban className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                            </button>
                            <button onClick={() => handleDelete(o)} className="p-1.5 rounded hover:bg-red-100 text-red-600 transition" title="Delete"><Trash2 className="w-4 h-4" /></button>
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

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-emerald-500 to-teal-600 text-black p-5 flex items-center justify-between z-10">
              <h2 className="text-xl font-bold">New Diet Order</h2>
              <button onClick={() => setShowCreate(false)} className="p-2 hover:bg-emerald-700/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Resident</label>
                  <select value={form.residentId} onChange={set("residentId")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-400 outline-none">
                    <option value="">Select resident…</option>
                    {residents.map(r => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Diet Type</label>
                  <select value={form.dietType} onChange={set("dietType")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-400 outline-none">
                    {DIET_TYPES.map(d => <option key={d} value={d}>{dietOptionLabel(d)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Meal</label>
                  <select value={form.mealType} onChange={set("mealType")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-400 outline-none">
                    {MEAL_TYPES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Restrictions</label>
                  <input type="text" value={form.restrictions} onChange={set("restrictions")} placeholder="e.g. No shellfish, thickened liquids only" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-400 outline-none" />
                </div>
                {/* Option B: specific meals for this resident (optional). */}
                <div className="col-span-2 rounded-lg border border-emerald-100 bg-emerald-50/40 p-3 space-y-2">
                  <p className="text-xs font-semibold text-emerald-800">Meals for this resident <span className="font-normal text-emerald-700/70">(optional — leave blank to just cook the facility menu to this diet)</span></p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input type="text" value={form.breakfast} onChange={set("breakfast")} placeholder="Breakfast" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-400 outline-none" />
                    <input type="text" value={form.lunch} onChange={set("lunch")} placeholder="Lunch" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-400 outline-none" />
                    <input type="text" value={form.dinner} onChange={set("dinner")} placeholder="Dinner" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-400 outline-none" />
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Notes</label>
                  <textarea value={form.notes} onChange={set("notes")} rows={2} placeholder="Preparation notes for the kitchen…" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-400 outline-none" />
                </div>
                <div className="col-span-2 text-xs text-gray-500">
                  Ordered by <span className="font-semibold text-gray-700">{me || "…"}</span> (recorded automatically)
                </div>
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setShowCreate(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Cancel</button>
              <button onClick={handleCreate} className="px-5 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">Set Diet Order</button>
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
    emerald: "text-emerald-600 bg-emerald-50 border-emerald-200",
    red: "text-red-600 bg-red-50 border-red-200",
    amber: "text-amber-600 bg-amber-50 border-amber-200",
  };
  const c = COLORS[color] || COLORS.emerald;
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
