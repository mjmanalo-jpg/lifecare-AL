"use client";

import { useMemo, useState, useEffect } from "react";
import { ChefHat, RefreshCw, Search, Utensils, CalendarDays } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";

/**
 * Kitchen-facing read-only cook list — the today's-service view of the
 * nutritionist's active DietOrders. Grouped by meal so kitchen staff see at a
 * glance what to cook per resident, with color-coded diet-type badges and a
 * per-diet-type count summary. Live via Supabase realtime + polling fallback.
 */

type Row = Record<string, unknown>;

const MEAL_GROUPS = ["BREAKFAST", "LUNCH", "DINNER", "SNACK", "ALL"] as const;
type MealType = (typeof MEAL_GROUPS)[number];

const MEAL_LABEL: Record<MealType, string> = {
  BREAKFAST: "Breakfast",
  LUNCH: "Lunch",
  DINNER: "Dinner",
  SNACK: "Snack",
  ALL: "All-Day / Every Meal",
};

const DIET_TYPES = [
  "REGULAR", "LOW_SODIUM", "LOW_SUGAR", "DIABETIC", "SOFT", "PUREED",
  "HIGH_FIBER", "RENAL", "HIGH_PROTEIN",
] as const;

/** Color-coded pill classes per diet type (mirrors DietOrdersBoard). */
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

const adaptOrder = (r: Row) => ({
  id: String(r.id ?? ""),
  residentName: String(r.residentName ?? "—"),
  roomNumber: String(r.roomNumber ?? ""),
  dietType: String(r.dietType ?? "REGULAR"),
  restrictions: String(r.restrictions ?? ""),
  mealType: String(r.mealType ?? "ALL") as MealType,
  notes: String(r.notes ?? ""),
  active: r.active === undefined ? true : Boolean(r.active),
});
type CookItem = ReturnType<typeof adaptOrder>;

export default function KitchenCookList() {
  const { data: rows, loading, error, refetch } = useLiveQuery<Row>(
    "diet-orders", { query: "take=300", tables: ["DietOrder"] }
  );

  const [search, setSearch] = useState("");
  const [mealFilter, setMealFilter] = useState("all");
  const [today, setToday] = useState("");
  useEffect(() => { setToday(new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })); }, []);

  // Kitchen only ever sees ACTIVE orders.
  const active = useMemo<CookItem[]>(
    () => rows.map(adaptOrder).filter(o => o.active),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return active.filter(o => {
      if (q && !o.residentName.toLowerCase().includes(q) && !o.roomNumber.toLowerCase().includes(q) && !o.restrictions.toLowerCase().includes(q)) return false;
      if (mealFilter !== "all" && o.mealType !== mealFilter) return false;
      return true;
    });
  }, [active, search, mealFilter]);

  // Per-diet-type count summary, e.g. "3 low sodium, 2 diabetic".
  const dietSummary = useMemo(() => {
    return DIET_TYPES.map(d => ({
      dietType: d,
      count: filtered.filter(o => o.dietType === d).length,
    })).filter(s => s.count > 0);
  }, [filtered]);

  const grouped = useMemo(() =>
    MEAL_GROUPS.map(meal => ({
      meal,
      items: filtered.filter(o => o.mealType === meal),
    })).filter(g => g.items.length > 0),
  [filtered]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent mb-2 flex items-center gap-2">
            <ChefHat className="w-8 h-8 text-orange-500" /> Kitchen — Today&apos;s Cook List
          </h1>
          <p className="text-gray-600">Active diet orders straight from the nutritionist, grouped by meal. Cook to each resident&apos;s diet type &amp; restrictions.</p>
          {today && <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-orange-700"><CalendarDays className="w-4 h-4" /> {today} · updates live as the nutritionist changes orders</p>}
        </div>
        <button onClick={() => void refetch()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Diet-type count summary */}
      {dietSummary.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Prep Summary ({filtered.length} residents)</p>
          <div className="flex flex-wrap gap-2">
            {dietSummary.map(s => (
              <span key={s.dietType} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${DIET_PILL[s.dietType] ?? DIET_PILL.REGULAR}`}>
                <span className="font-bold">{s.count}</span> {dietLabel(s.dietType).toLowerCase()}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search resident, room, or restriction…" value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-400 focus:border-transparent outline-none" />
        </div>
        <select value={mealFilter} onChange={e => setMealFilter(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-orange-400 outline-none">
          <option value="all">All Meals</option>
          {MEAL_GROUPS.map(m => <option key={m} value={m}>{MEAL_LABEL[m]}</option>)}
        </select>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {/* Grouped cook list */}
      {loading && active.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading cook list...</div>
      ) : grouped.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">No active diet orders to cook.</div>
      ) : (
        <div className="space-y-6">
          {grouped.map(({ meal, items }) => (
            <div key={meal} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="bg-gradient-to-r from-orange-50 to-red-50 border-b border-gray-200 px-4 py-3 flex items-center gap-2">
                <Utensils className="w-4 h-4 text-orange-500" />
                <h2 className="font-bold text-gray-900">{MEAL_LABEL[meal]}</h2>
                <span className="ml-auto text-xs font-semibold text-gray-500">{items.length} resident{items.length === 1 ? "" : "s"}</span>
              </div>
              <ul className="divide-y divide-gray-100">
                {items.map(o => (
                  <li key={o.id} className="px-4 py-3 flex items-start gap-3 hover:bg-gray-50 transition">
                    <div className="min-w-[160px]">
                      <p className="font-medium text-gray-900">{o.residentName}</p>
                      <p className="text-xs text-gray-500">Room {o.roomNumber || "—"}</p>
                    </div>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border shrink-0 ${DIET_PILL[o.dietType] ?? DIET_PILL.REGULAR}`}>
                      {dietLabel(o.dietType)}
                    </span>
                    <div className="flex-1 text-xs text-gray-600">
                      {o.restrictions && <p><span className="font-semibold text-gray-700">Restrictions:</span> {o.restrictions}</p>}
                      {o.notes && <p className="text-gray-400">{o.notes}</p>}
                      {!o.restrictions && !o.notes && <span className="text-gray-300">—</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
