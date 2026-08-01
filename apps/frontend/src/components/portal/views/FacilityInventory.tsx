"use client";

import { useMemo, useState } from "react";
import {
  Package, Search, AlertTriangle, Plus, X, Edit, Trash2, RefreshCw,
  LayoutGrid, Table2, Minus, Plus as PlusIcon, Eye, Building2,
  Calendar, Hash, MapPin,
  type LucideIcon,
} from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptInventoryItem } from "@/lib/adapters";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";
import { StatusPill, MicroLabel, ClinicalHeader, ClinicalCard } from "./clinical/clinical-ui";

type InventoryItem = ReturnType<typeof adaptInventoryItem>;

const CATEGORIES = [
  "MEDICAL_SUPPLIES", "PERSONAL_CARE", "LINEN", "FOOD", "CLEANING",
  "OFFICE", "FURNITURE", "EQUIPMENT", "PPE", "OTHER",
];

const CATEGORY_COLORS: Record<string, string> = {
  MEDICAL_SUPPLIES: "#3b82f6", PERSONAL_CARE: "#ec4899", LINEN: "#8b5cf6",
  FOOD: "#22c55e", CLEANING: "#06b6d4", OFFICE: "#f59e0b",
  FURNITURE: "#a855f7", EQUIPMENT: "#ef4444", PPE: "#10b981", OTHER: "#6b7280",
};

const emptyForm = {
  itemName: "", category: "OTHER", quantity: "0", unit: "pcs",
  minimumStock: "5", location: "", supplier: "", expiryDate: "", notes: "",
};

export default function FacilityInventory() {
  const { data: itemRows, loading, error, refetch } = useLiveQuery<Record<string, unknown>>(
    "inventory", { query: "take=300", tables: ["InventoryItem"] }
  );
  const items = useMemo<InventoryItem[]>(() => itemRows.map(adaptInventoryItem), [itemRows]);

  // Open purchase requests — used to avoid queuing a duplicate auto-reorder for an item.
  const { data: prRows } = useLiveQuery<Record<string, unknown>>(
    "purchase-requests", { query: "take=400", tables: ["PurchaseRequest"] }
  );
  const openPrItemIds = useMemo(
    () => new Set(prRows.filter((r) => ["REQUESTED", "APPROVED", "ORDERED"].includes(String(r.status))).map((r) => String(r.inventoryItemId))),
    [prRows],
  );

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [showLowStock, setShowLowStock] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [viewing, setViewing] = useState<InventoryItem | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState(emptyForm);
  const [page, setPage] = useState(1);
  const perPage = 24;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(item => {
      if (q && !item.itemName.toLowerCase().includes(q) && !item.category.toLowerCase().includes(q) && !item.location.toLowerCase().includes(q) && !item.supplier.toLowerCase().includes(q)) return false;
      if (categoryFilter !== "all" && item.raw.category !== categoryFilter) return false;
      if (locationFilter !== "all" && item.raw.location !== locationFilter) return false;
      if (showLowStock && !item.lowStock) return false;
      return true;
    });
  }, [items, search, categoryFilter, locationFilter, showLowStock]);

  const stats = useMemo(() => ({
    total: items.length,
    lowStock: items.filter(i => i.lowStock).length,
    totalQty: items.reduce((s, i) => s + i.quantity, 0),
    categories: new Set(items.map(i => i.raw.category)).size,
    inStock: items.filter(i => !i.lowStock).length,
    locations: new Set(items.map(i => i.raw.location).filter(Boolean)).size,
  }), [items]);

  const categoryDist = useMemo(() => {
    return CATEGORIES.map(c => ({
      name: c.replace(/_/g, " "),
      value: items.filter(i => i.raw.category === c).length,
      color: CATEGORY_COLORS[c] || "#6b7280",
    })).filter(d => d.value > 0);
  }, [items]);

  const locations = useMemo(() => {
    const s = new Set(items.map(i => i.raw.location).filter(Boolean));
    return Array.from(s).sort() as string[];
  }, [items]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const start = (page - 1) * perPage;
  const paginated = filtered.slice(start, start + perPage);

  const handleQuickAdjust = async (item: InventoryItem, delta: number) => {
    const newQty = Math.max(0, item.quantity + delta);
    try {
      await updateRecord("inventory", item.id, { quantity: newQty });

      // ⚡ Auto purchase request — when a decrease drops stock to/below the reorder
      // threshold and no request is already open, queue one for admin approval.
      const raw = item.raw as { reorderPoint?: number | null; unitCost?: number | null };
      const threshold = raw?.reorderPoint ?? item.minimumStock;
      if (delta < 0 && threshold > 0 && newQty <= threshold && !openPrItemIds.has(item.id)) {
        const restockQty = Math.max((raw?.reorderPoint ?? item.minimumStock) * 2 - newQty, item.minimumStock);
        await createRecord("purchase-requests", {
          inventoryItemId: item.id,
          itemName: item.itemName,
          category: item.category,
          quantity: restockQty,
          unit: item.unit,
          estimatedUnitCost: raw?.unitCost ?? null,
          supplier: item.supplier && item.supplier !== "—" ? item.supplier : null,
          reason: `Auto-reorder: stock fell to ${newQty} (reorder at ${threshold}).`,
          priority: newQty === 0 ? "URGENT" : "HIGH",
          status: "REQUESTED",
          requestedByName: "Auto Reorder",
          autoGenerated: true,
        });
        Swal.fire({ title: "Reorder queued", text: `${item.itemName} fell below its reorder point — a purchase request was auto-created for approval.`, icon: "info", timer: 2800, showConfirmButton: false });
      }
      await refetch();
    } catch (err) {
      Swal.fire({ title: "Update Failed", text: err instanceof Error ? err.message : "Could not update quantity.", icon: "error" });
    }
  };

  const handleCreate = async () => {
    if (!createForm.itemName) {
      Swal.fire({ title: "Missing Fields", text: "Item name is required.", icon: "warning" });
      return;
    }
    const confirmed = await Swal.fire({
      title: "Add Item?", icon: "question", showCancelButton: true,
      confirmButtonColor: "#fbbf24", cancelButtonColor: "#6b7280", confirmButtonText: "Add",
    });
    if (!confirmed.isConfirmed) return;
    try {
      await createRecord("inventory", {
        itemName: createForm.itemName, category: createForm.category,
        quantity: Number(createForm.quantity) || 0, unit: createForm.unit,
        minimumStock: Number(createForm.minimumStock) || 5,
        location: createForm.location, supplier: createForm.supplier,
        expiryDate: createForm.expiryDate ? new Date(createForm.expiryDate).toISOString() : null,
        notes: createForm.notes,
      });
      await refetch();
      setShowCreate(false);
      setCreateForm(emptyForm);
      Swal.fire({ title: "Added", text: `${createForm.itemName} added.`, icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Add Failed", text: err instanceof Error ? err.message : "Could not add item.", icon: "error" });
    }
  };

  const startEditing = (item: InventoryItem) => {
    setEditing(item);
    setEditForm({
      itemName: item.itemName, category: item.raw.category,
      quantity: String(item.quantity), unit: item.unit,
      minimumStock: String(item.minimumStock), location: item.location,
      supplier: item.supplier,
      expiryDate: item.expiryDate ? item.expiryDate.split("T")[0] : "",
      notes: item.notes,
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
      await updateRecord("inventory", editing.id, {
        itemName: editForm.itemName, category: editForm.category,
        quantity: Number(editForm.quantity) || 0, unit: editForm.unit,
        minimumStock: Number(editForm.minimumStock) || 5,
        location: editForm.location, supplier: editForm.supplier,
        expiryDate: editForm.expiryDate ? new Date(editForm.expiryDate).toISOString() : null,
        notes: editForm.notes,
      });
      await refetch();
      setEditing(null);
      Swal.fire({ title: "Saved", text: `${editForm.itemName} updated.`, icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Save Failed", text: err instanceof Error ? err.message : "Could not update item.", icon: "error" });
    }
  };

  const handleDelete = async (item: InventoryItem) => {
    const confirmed = await Swal.fire({
      title: "Delete Item?", text: `Remove "${item.itemName}"?`, icon: "warning",
      showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Delete",
    });
    if (!confirmed.isConfirmed) return;
    try {
      await deleteRecord("inventory", item.id);
      await refetch();
      Swal.fire({ title: "Deleted", text: `${item.itemName} removed.`, icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Delete Failed", text: err instanceof Error ? err.message : "Could not delete item.", icon: "error" });
    }
  };

  const activeFilterCount =
    (categoryFilter !== "all" ? 1 : 0) +
    (locationFilter !== "all" ? 1 : 0) +
    (showLowStock ? 1 : 0) +
    (search.trim() ? 1 : 0);

  const clearFilters = () => {
    setSearch("");
    setCategoryFilter("all");
    setLocationFilter("all");
    setShowLowStock(false);
    setPage(1);
  };

  return (
    <div className="-m-4 sm:-m-6 p-4 sm:p-6 min-h-full space-y-5" style={{ background: "#FFFFFF" }}>
      {/* Header */}
      <ClinicalHeader
        eyebrow="Inventory Stock List"
        title="Inventory Management"
        subtitle="Track supplies, equipment, and stock levels across the facility"
        right={
          <div className="flex gap-2">
            <button onClick={() => void refetch()} className="flex items-center gap-2 px-3 py-2 border border-[#D6D8CD] bg-white rounded-lg text-[#2B2B27] hover:bg-[#F5F6F1] transition text-sm font-medium">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-[#2E4A48] hover:bg-[#25403D] text-white font-semibold rounded-lg transition active:scale-95">
              <Plus className="w-4 h-4" /> Add Item
            </button>
          </div>
        }
      />

      {/* Stat Boxes */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatBox label="Total Items" value={String(stats.total)} icon={Package} tone="teal" />
        <StatBox label="In Stock" value={String(stats.inStock)} icon={Package} tone="green" />
        <StatBox label="Low Stock" value={String(stats.lowStock)} icon={AlertTriangle} tone="coral" />
        <StatBox label="Total Qty" value={String(stats.totalQty)} icon={Hash} tone="teal" />
        <StatBox label="Categories" value={String(stats.categories)} icon={Building2} tone="amber" />
        <StatBox label="Locations" value={String(stats.locations)} icon={MapPin} tone="teal" />
      </div>

      {/* Chart */}
      {categoryDist.length > 0 && (
        <ClinicalCard top="teal" className="p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Building2 className="w-4 h-4 text-[#2E4A48]" />
            <h3 className="font-semibold text-[#2B2B27] text-sm">Category Distribution</h3>
          </div>
          <div className="h-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryDist} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EBEDE4" />
                <XAxis dataKey="name" fontSize={9} tickLine={false} axisLine={false} angle={-20} textAnchor="end" height={40} />
                <YAxis allowDecimals={false} fontSize={10} tickLine={false} axisLine={false} width={20} />
                <Tooltip />
                <Bar dataKey="value" name="Items" radius={[3, 3, 0, 0]}>
                  {categoryDist.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ClinicalCard>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-3 w-4 h-4 text-[#8A8D82]" />
          <input type="text" placeholder="Search name, category, location, supplier…" value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-[#D6D8CD] bg-white rounded-lg text-sm focus:ring-2 focus:ring-[#2E4A48]/30 focus:border-[#2E4A48] outline-none" />
        </div>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
          className="px-3 py-2.5 border border-[#D6D8CD] rounded-lg text-sm bg-white focus:ring-2 focus:ring-[#2E4A48]/30 focus:border-[#2E4A48] outline-none">
          <option value="all">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
        </select>
        <select value={locationFilter} onChange={e => setLocationFilter(e.target.value)}
          className="px-3 py-2.5 border border-[#D6D8CD] rounded-lg text-sm bg-white focus:ring-2 focus:ring-[#2E4A48]/30 focus:border-[#2E4A48] outline-none">
          <option value="all">All Locations</option>
          {locations.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <button
          type="button"
          onClick={() => { setShowLowStock(v => !v); setPage(1); }}
          className={`flex items-center gap-2 px-3 py-2.5 rounded-lg transition text-sm font-medium select-none border ${showLowStock ? "bg-[#2E4A48] text-white border-[#2E4A48]" : "bg-white text-[#2B2B27] border-[#D6D8CD] hover:bg-[#F5F6F1]"}`}
        >
          <AlertTriangle className="w-4 h-4" /> Low stock only
        </button>
        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-semibold text-[#C0573F] border border-[#C0573F]/40 hover:bg-[#C0573F]/10 transition"
          >
            <X className="w-3.5 h-3.5" /> Clear ({activeFilterCount})
          </button>
        )}
        <div className="flex rounded-lg border border-[#D6D8CD] overflow-hidden">
          <button onClick={() => { setViewMode("grid"); setPage(1); }}
            className={`px-3 py-2.5 text-sm transition ${viewMode === "grid" ? "bg-[#2E4A48] text-white font-semibold" : "bg-white text-[#8A8D82] hover:bg-[#F5F6F1]"}`}>
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button onClick={() => { setViewMode("table"); setPage(1); }}
            className={`px-3 py-2.5 text-sm transition ${viewMode === "table" ? "bg-[#2E4A48] text-white font-semibold" : "bg-white text-[#8A8D82] hover:bg-[#F5F6F1]"}`}>
            <Table2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && <div className="bg-[#C0573F]/10 border border-[#C0573F]/30 text-[#C0573F] rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {loading && items.length === 0 ? (
        <div className="bg-white rounded-lg border border-[#E1E3D9] p-12 text-center text-[#8A8D82]">Loading inventory...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-[#E1E3D9] p-12 text-center text-[#8A8D82]">No items match your filters.</div>
      ) : viewMode === "grid" ? (
        /* ── Grid View ── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {paginated.map(item => (
            <div key={item.id} className={`bg-white rounded-lg border overflow-hidden hover:shadow-md transition group ${item.lowStock ? "border-[#C0573F]/40 ring-1 ring-[#C0573F]/20" : "border-[#E1E3D9]"}`}>
              {/* Stock bar */}
              <div className="h-1.5 bg-[#EBEDE4]">
                <div
                  className={`h-full transition-all duration-500 ${item.lowStock ? "bg-[#C0573F]" : "bg-[#7E9B6F]"}`}
                  style={{ width: `${Math.min(100, (item.quantity / Math.max(item.minimumStock, 1)) * 100)}%` }}
                />
              </div>
              <div className="p-3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="font-semibold text-[#2B2B27] text-sm truncate flex-1">{item.itemName}</h3>
                  <StatusPill status={item.lowStock ? "LOW" : "NORMAL"} />
                </div>
                <div className="flex items-center gap-2 text-xs mb-2">
                  <span className="text-[#C0573F] font-medium">{item.category.replace(/_/g, " ")}</span>
                  {item.location !== "—" && <span className="text-[#2E4A48]">{item.location}</span>}
                </div>

                {/* Qty display */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleQuickAdjust(item, -1)} className="p-1 rounded hover:bg-[#C0573F]/10 text-[#C0573F] transition" title="Decrease"><Minus className="w-3.5 h-3.5" /></button>
                    <span className={`text-lg font-bold min-w-[3ch] text-center tabular-nums ${item.lowStock ? "text-[#C0573F]" : "text-[#2B2B27]"}`}>{item.quantity}</span>
                    <button onClick={() => handleQuickAdjust(item, 1)} className="p-1 rounded hover:bg-[#7E9B6F]/15 text-[#7E9B6F] transition" title="Increase"><PlusIcon className="w-3.5 h-3.5" /></button>
                  </div>
                  <span className="text-xs text-[#8A8D82]">{item.unit} &middot; Min: {item.minimumStock}</span>
                </div>

                <div className="flex gap-1.5">
                  <button onClick={() => setViewing(item)} className="flex-1 px-2 py-1.5 text-xs font-medium text-[#2E4A48] bg-[#2E4A48]/10 hover:bg-[#2E4A48]/20 rounded transition flex items-center justify-center gap-1">
                    <Eye className="w-3 h-3" /> View
                  </button>
                  <button onClick={() => startEditing(item)} className="flex-1 px-2 py-1.5 text-xs font-medium text-[#C39A3E] bg-[#C39A3E]/10 hover:bg-[#C39A3E]/20 rounded transition flex items-center justify-center gap-1">
                    <Edit className="w-3 h-3" /> Edit
                  </button>
                  <button onClick={() => handleDelete(item)} className="px-2 py-1.5 text-xs font-medium text-[#C0573F] bg-[#C0573F]/10 hover:bg-[#C0573F]/20 rounded transition">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* ── Table View ── */
        <div className="bg-white rounded-lg border border-[#E1E3D9] overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#2E4A48]">
              <tr>
                <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#C9D2CB]">Item</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#C9D2CB]">Current Qty</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#C9D2CB]">Stock Level</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#C9D2CB]">Expiry</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#C9D2CB]">Location</th>
                <th className="text-center px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#C9D2CB]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EBEDE4]">
              {paginated.map(item => (
                <tr key={item.id} className="hover:bg-[#F5F6F1] transition">
                  <td className="px-4 py-4">
                    <div className="font-bold text-[#2B2B27]">{item.itemName}</div>
                    <div className="text-xs text-[#C0573F] mt-0.5">
                      {item.category.replace(/_/g, " ")}
                      {item.supplier !== "—" && <span> &middot; {item.supplier}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => handleQuickAdjust(item, -1)} className="p-0.5 rounded hover:bg-[#C0573F]/10 text-[#C0573F] transition" title="Decrease"><Minus className="w-3 h-3" /></button>
                      <div className="text-center">
                        <div className={`text-xl font-bold tabular-nums leading-none ${item.lowStock ? "text-[#C0573F]" : "text-[#2B2B27]"}`}>{item.quantity}</div>
                        <div className="text-[10px] text-[#8A8D82] mt-0.5">{item.unit}</div>
                      </div>
                      <button onClick={() => handleQuickAdjust(item, 1)} className="p-0.5 rounded hover:bg-[#7E9B6F]/15 text-[#7E9B6F] transition" title="Increase"><PlusIcon className="w-3 h-3" /></button>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <StatusPill status={item.lowStock ? "LOW" : "NORMAL"} />
                    <div className="text-[10px] text-[#8A8D82] mt-1">Min {item.minimumStock}</div>
                  </td>
                  <td className="px-4 py-4">
                    {item.expiryDate ? (
                      <ExpiryCell iso={item.expiryDate} />
                    ) : (
                      <span className="text-xs text-[#8A8D82]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    {item.location !== "—" ? (
                      <span className="text-sm font-medium text-[#2E4A48]">{item.location}</span>
                    ) : (
                      <span className="text-xs text-[#8A8D82]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => setViewing(item)} className="p-1.5 rounded hover:bg-[#2E4A48]/10 text-[#2E4A48] transition" title="View"><Eye className="w-4 h-4" /></button>
                      <button onClick={() => startEditing(item)} className="p-1.5 rounded hover:bg-[#C39A3E]/15 text-[#C39A3E] transition" title="Edit"><Edit className="w-4 h-4" /></button>
                      <button onClick={() => handleDelete(item)} className="p-1.5 rounded hover:bg-[#C0573F]/10 text-[#C0573F] transition" title="Delete"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {filtered.length > perPage && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="text-sm text-[#6B6E63]">{filtered.length} items total</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-4 py-2 border border-[#D6D8CD] bg-white rounded-lg text-[#2B2B27] hover:bg-[#F5F6F1] disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">Previous</button>
            <span className="px-3 py-2 text-sm font-medium text-[#2B2B27]">Page {page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-4 py-2 border border-[#D6D8CD] bg-white rounded-lg text-[#2B2B27] hover:bg-[#F5F6F1] disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">Next</button>
          </div>
        </div>
      )}

      {/* View Modal */}
      {viewing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-[#2E4A48] text-white p-5 flex items-center justify-between z-10">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#C39A3E]">Inventory Item</p>
                <h2 className="text-xl font-bold">{viewing.itemName}</h2>
              </div>
              <button onClick={() => setViewing(null)} className="p-2 hover:bg-white/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              {/* Stock level bar */}
              <div>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-semibold text-[#2B2B27]">Stock Level</span>
                  <span className={`font-bold ${viewing.lowStock ? "text-[#C0573F]" : "text-[#7E9B6F]"}`}>
                    {viewing.quantity} / {viewing.minimumStock} min
                  </span>
                </div>
                <div className="h-3 bg-[#EBEDE4] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${viewing.lowStock ? "bg-[#C0573F]" : "bg-[#7E9B6F]"}`}
                    style={{ width: `${Math.min(100, (viewing.quantity / Math.max(viewing.minimumStock, 1)) * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-[#8A8D82] mt-1">{viewing.unit}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <DetailField icon={Building2} label="Category" value={viewing.category} />
                <DetailField icon={Hash} label="Quantity" value={`${viewing.quantity} ${viewing.unit}`} />
                <DetailField icon={AlertTriangle} label="Min Stock" value={String(viewing.minimumStock)} />
                <DetailField icon={MapPin} label="Location" value={viewing.location !== "—" ? viewing.location : "—"} />
                <DetailField icon={Package} label="Supplier" value={viewing.supplier !== "—" ? viewing.supplier : "—"} />
                <DetailField icon={Calendar} label="Expiry" value={viewing.expiryDate ? new Date(viewing.expiryDate).toLocaleDateString() : "—"} />
              </div>

              {viewing.notes && (
                <div className="bg-[#C39A3E]/10 border-l-4 border-[#C39A3E] p-3 rounded">
                  <p className="text-xs font-semibold text-[#C39A3E] mb-1">Notes</p>
                  <p className="text-sm text-[#2B2B27]">{viewing.notes}</p>
                </div>
              )}
            </div>
            <div className="sticky bottom-0 bg-[#F5F6F1] border-t border-[#E1E3D9] px-6 py-4 flex items-center justify-between">
              <button onClick={() => setViewing(null)} className="px-6 py-2 text-[#2B2B27] hover:bg-[#EBEDE4] rounded-lg transition font-medium">Close</button>
              <div className="flex gap-2">
                <button onClick={() => { setViewing(null); startEditing(viewing); }} className="px-4 py-2 bg-[#C39A3E] hover:bg-[#AD892F] text-white font-semibold rounded-lg transition text-sm">
                  <Edit className="w-4 h-4 inline mr-1" /> Edit
                </button>
                <button onClick={() => { handleDelete(viewing); setViewing(null); }} className="px-4 py-2 bg-[#C0573F] hover:bg-[#A8482F] text-white font-semibold rounded-lg transition text-sm">
                  <Trash2 className="w-4 h-4 inline mr-1" /> Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && <ItemFormModal title="Add Inventory Item" form={createForm} onChange={setCreateForm} onSave={handleCreate} onCancel={() => setShowCreate(false)} saveLabel="Add Item" />}

      {/* Edit Modal */}
      {editing && <ItemFormModal title="Edit Item" form={editForm} onChange={setEditForm} onSave={handleSaveEdit} onCancel={() => setEditing(null)} saveLabel="Save Changes" />}
    </div>
  );
}

/* ── Sub-components ── */

function StatBox({ label, value, icon: Icon, tone }: { label: string; value: string; icon: LucideIcon; tone: "teal" | "coral" | "amber" | "green" }) {
  const HEX: Record<string, string> = { teal: "#2E4A48", coral: "#C0573F", amber: "#C39A3E", green: "#7E9B6F" };
  const hex = HEX[tone];
  return (
    <ClinicalCard top={tone} className="p-4">
      <div className="flex items-center justify-between mb-0.5">
        <MicroLabel>{label}</MicroLabel>
        <Icon className="w-4 h-4" style={{ color: hex }} />
      </div>
      <p className="text-2xl sm:text-3xl font-bold tabular-nums" style={{ color: hex }}>{value}</p>
    </ClinicalCard>
  );
}

/** Expiry date with a colour-coded sub-badge (Expired / Expiring in N days / N months away). */
function ExpiryCell({ iso }: { iso: string }) {
  const date = new Date(iso);
  const days = Math.round((date.getTime() - Date.now()) / 86_400_000);
  let sub: React.ReactNode;
  if (days < 0) {
    sub = <span className="text-[10px] font-semibold text-[#C0573F]">Expired</span>;
  } else if (days <= 30) {
    sub = <span className="text-[10px] font-semibold text-[#C39A3E]">Expiring in {days} day{days === 1 ? "" : "s"}</span>;
  } else {
    const months = Math.round(days / 30);
    sub = <span className="text-[10px] font-medium text-[#7E9B6F]">{months} month{months === 1 ? "" : "s"} away</span>;
  }
  return (
    <div>
      <div className="text-sm text-[#2B2B27] tabular-nums">{date.toLocaleDateString()}</div>
      <div className="mt-0.5">{sub}</div>
    </div>
  );
}

function DetailField({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="bg-[#F5F6F1] p-3 rounded border border-[#E1E3D9]">
      <p className="text-[10px] text-[#8A8D82] font-semibold uppercase tracking-[0.08em] flex items-center gap-1 mb-0.5"><Icon className="w-3 h-3" />{label}</p>
      <p className="text-sm font-semibold text-[#2B2B27]">{value}</p>
    </div>
  );
}

function ItemFormModal({ title, form, onChange, onSave, onCancel, saveLabel }: {
  title: string;
  form: typeof emptyForm;
  onChange: (f: typeof emptyForm) => void;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
}) {
  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onChange({ ...form, [field]: e.target.value });

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[#2E4A48] text-white p-5 flex items-center justify-between z-10">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onCancel} className="p-2 hover:bg-white/20 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-semibold text-[#2B2B27] mb-1">Item Name</label>
              <input type="text" value={form.itemName} onChange={set("itemName")} className="w-full px-3 py-2 border border-[#D6D8CD] rounded-lg text-sm focus:ring-2 focus:ring-[#2E4A48]/30 focus:border-[#2E4A48] outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#2B2B27] mb-1">Category</label>
              <select value={form.category} onChange={set("category")} className="w-full px-3 py-2 border border-[#D6D8CD] rounded-lg text-sm bg-white focus:ring-2 focus:ring-[#2E4A48]/30 focus:border-[#2E4A48] outline-none">
                {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#2B2B27] mb-1">Unit</label>
              <input type="text" value={form.unit} onChange={set("unit")} className="w-full px-3 py-2 border border-[#D6D8CD] rounded-lg text-sm focus:ring-2 focus:ring-[#2E4A48]/30 focus:border-[#2E4A48] outline-none" placeholder="pcs, boxes..." />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#2B2B27] mb-1">Quantity</label>
              <input type="number" min="0" value={form.quantity} onChange={set("quantity")} className="w-full px-3 py-2 border border-[#D6D8CD] rounded-lg text-sm focus:ring-2 focus:ring-[#2E4A48]/30 focus:border-[#2E4A48] outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#2B2B27] mb-1">Minimum Stock</label>
              <input type="number" min="0" value={form.minimumStock} onChange={set("minimumStock")} className="w-full px-3 py-2 border border-[#D6D8CD] rounded-lg text-sm focus:ring-2 focus:ring-[#2E4A48]/30 focus:border-[#2E4A48] outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#2B2B27] mb-1">Location</label>
              <input type="text" value={form.location} onChange={set("location")} className="w-full px-3 py-2 border border-[#D6D8CD] rounded-lg text-sm focus:ring-2 focus:ring-[#2E4A48]/30 focus:border-[#2E4A48] outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#2B2B27] mb-1">Supplier</label>
              <input type="text" value={form.supplier} onChange={set("supplier")} className="w-full px-3 py-2 border border-[#D6D8CD] rounded-lg text-sm focus:ring-2 focus:ring-[#2E4A48]/30 focus:border-[#2E4A48] outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#2B2B27] mb-1">Expiry Date</label>
              <input type="date" value={form.expiryDate} onChange={set("expiryDate")} className="w-full px-3 py-2 border border-[#D6D8CD] rounded-lg text-sm focus:ring-2 focus:ring-[#2E4A48]/30 focus:border-[#2E4A48] outline-none" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-semibold text-[#2B2B27] mb-1">Notes</label>
              <textarea value={form.notes} onChange={set("notes")} rows={2} className="w-full px-3 py-2 border border-[#D6D8CD] rounded-lg text-sm focus:ring-2 focus:ring-[#2E4A48]/30 focus:border-[#2E4A48] outline-none" />
            </div>
          </div>
        </div>
        <div className="sticky bottom-0 bg-[#F5F6F1] border-t border-[#E1E3D9] px-6 py-4 flex items-center justify-between">
          <button onClick={onCancel} className="px-5 py-2 text-[#2B2B27] hover:bg-[#EBEDE4] rounded-lg transition font-medium text-sm">Cancel</button>
          <button onClick={onSave} className="px-5 py-2 bg-[#2E4A48] hover:bg-[#25403D] text-white font-semibold rounded-lg transition active:scale-95 text-sm">{saveLabel}</button>
        </div>
      </div>
    </div>
  );
}
