"use client";

import RefreshButton from "@/components/portal/RefreshButton";

import { useMemo, useState, useEffect } from "react";
import {
  Package, Search, AlertTriangle, Plus, X, Edit, Trash2, RefreshCw,
  LayoutGrid, Table2, Minus, Plus as PlusIcon, Eye, Building2,
  Calendar, Hash, MapPin, Printer, SlidersHorizontal, ShoppingCart,
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
import InventoryOpsPanel from "./InventoryOpsPanel";
import PurchaseRequests from "./PurchaseRequests";
import Barcode from "@/components/portal/Barcode";
import BarcodeLabelSheet, { type BarcodeLabel } from "@/components/portal/BarcodeLabelSheet";
import InventoryBarcodeScanner from "@/components/portal/InventoryBarcodeScanner";
import { generateBarcode } from "@/lib/inventoryOps";

type InventoryItem = ReturnType<typeof adaptInventoryItem>;

const CATEGORIES = [
  "MEDICATION", "MEDICAL_SUPPLIES", "PERSONAL_CARE", "LINEN", "FOOD", "CLEANING",
  "OFFICE", "FURNITURE", "EQUIPMENT", "PPE", "OTHER",
];

const CATEGORY_COLORS: Record<string, string> = {
  MEDICATION: "#14b8a6",
  MEDICAL_SUPPLIES: "#3b82f6", PERSONAL_CARE: "#ec4899", LINEN: "#8b5cf6",
  FOOD: "#22c55e", CLEANING: "#06b6d4", OFFICE: "#f59e0b",
  FURNITURE: "#a855f7", EQUIPMENT: "#ef4444", PPE: "#10b981", OTHER: "#6b7280",
};

const emptyForm = {
  itemName: "", category: "OTHER", quantity: "0", unit: "pcs",
  minimumStock: "5", location: "", supplier: "", batchNumber: "", expiryDate: "", notes: "",
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

  const [tab, setTab] = useState<"inventory" | "purchase">("inventory");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState<"all" | "OUT_OF_STOCK" | "CRITICAL" | "LOW">("all");
  const [expiryFilter, setExpiryFilter] = useState<"all" | "expired" | "7" | "30">("all");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [viewing, setViewing] = useState<InventoryItem | null>(null);
  const [adjusting, setAdjusting] = useState<InventoryItem | null>(null);
  const [adjustMode, setAdjustMode] = useState<"add" | "subtract">("add");
  const [showCreate, setShowCreate] = useState(false);
  const [opsOpen, setOpsOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState(emptyForm);
  const [page, setPage] = useState(1);
  const [printLabels, setPrintLabels] = useState<BarcodeLabel[] | null>(null);
  const perPage = 24;

  // Build printable barcode labels from inventory items (skips items with no code).
  const toLabels = (list: InventoryItem[]): BarcodeLabel[] =>
    list
      .map((i) => {
        const code = String((i.raw as { batchNumber?: string | number | null }).batchNumber ?? "").trim();
        if (!code) return null;
        return {
          code,
          itemName: i.itemName,
          category: i.category,
          location: i.location !== "—" ? i.location : undefined,
          sub: `Min ${i.minimumStock} · ${i.quantity} ${i.unit}`,
        } as BarcodeLabel;
      })
      .filter(Boolean) as BarcodeLabel[];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();
    return items.filter(item => {
      if (q && !item.itemName.toLowerCase().includes(q) && !item.category.toLowerCase().includes(q) && !item.location.toLowerCase().includes(q) && !item.supplier.toLowerCase().includes(q)) return false;
      if (categoryFilter !== "all" && item.raw.category !== categoryFilter) return false;
      if (locationFilter !== "all" && item.raw.location !== locationFilter) return false;
      if (stockFilter !== "all" && item.stockStatus !== stockFilter) return false;
      if (expiryFilter !== "all") {
        const days = item.expiryDate ? Math.floor((new Date(item.expiryDate).getTime() - now) / 86_400_000) : null;
        if (days === null) return false;
        if (expiryFilter === "expired" && days >= 0) return false;
        if (expiryFilter === "7" && !(days >= 0 && days <= 7)) return false;
        if (expiryFilter === "30" && !(days >= 0 && days <= 30)) return false;
      }
      return true;
    });
  }, [items, search, categoryFilter, locationFilter, stockFilter, expiryFilter]);

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

  // Live view of the item open in the detail modal, so quick-adjust reflects
  // the latest quantity after refetch (the captured `viewing` snapshot is stale).
  const viewingLive = viewing ? (items.find((i) => i.id === viewing.id) ?? viewing) : null;

  // ⚡ Auto purchase request — when a decrease drops stock to/below the reorder
  // threshold and no request is already open, queue one for admin approval.
  const maybeAutoReorder = async (item: InventoryItem, newQty: number, delta: number) => {
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
  };

  // The −/+ buttons no longer mutate quantity directly — they open the Adjust
  // Stock dialog (pre-set to subtract/add) so every change carries a reason note.
  const openAdjust = (item: InventoryItem, mode: "add" | "subtract" = "add") => {
    setAdjustMode(mode);
    setAdjusting(item);
  };

  // Adjust stock by an arbitrary amount with a reason note — the reason is
  // appended to the item's notes as a dated audit line.
  const handleAdjustWithReason = async (item: InventoryItem, delta: number, reason: string) => {
    const newQty = Math.max(0, item.quantity + delta);
    const stamp = new Date().toISOString().slice(0, 10);
    const line = `[${stamp}] ${delta >= 0 ? "+" : ""}${delta} → ${newQty}${reason ? ` — ${reason}` : ""}`;
    const nextNotes = item.notes ? `${item.notes}\n${line}` : line;
    try {
      await updateRecord("inventory", item.id, {
        quantity: newQty,
        notes: nextNotes,
        ...(delta > 0 ? { lastRestocked: new Date().toISOString() } : {}),
      });
      await maybeAutoReorder(item, newQty, delta);
      await refetch();
      setAdjusting(null);
      Swal.fire({ title: "Stock adjusted", text: `${item.itemName}: ${item.quantity} → ${newQty} ${item.unit}.`, icon: "success", timer: 1800, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Adjustment Failed", text: err instanceof Error ? err.message : "Could not adjust stock.", icon: "error" });
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
        batchNumber: createForm.batchNumber || generateBarcode(),
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
      batchNumber: item.raw.batchNumber ? String(item.raw.batchNumber) : "",
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
        batchNumber: editForm.batchNumber || generateBarcode(),
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
    (stockFilter !== "all" ? 1 : 0) +
    (expiryFilter !== "all" ? 1 : 0) +
    (search.trim() ? 1 : 0);

  const clearFilters = () => {
    setSearch("");
    setCategoryFilter("all");
    setLocationFilter("all");
    setStockFilter("all");
    setExpiryFilter("all");
    setPage(1);
  };

  return (
    <div className="-m-4 sm:-m-6 p-4 sm:p-6 min-h-full space-y-5" style={{ background: "#FFFFFF" }}>
      {/* Tabs — Inventory stock list + embedded Purchase Requests workflow */}
      <div className="flex gap-1 border-b border-[#E1E3D9]">
        {([["inventory", "Inventory", Package], ["purchase", "Purchase Requests", ShoppingCart]] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition ${tab === key ? "border-[#2E4A48] text-[#2E4A48]" : "border-transparent text-[#8A8D82] hover:text-[#2B2B27]"}`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "purchase" ? (
        <PurchaseRequests />
      ) : (
      <div className="space-y-5">
      {/* Header */}
      <ClinicalHeader
        title="Inventory Management"
        subtitle="Track supplies, equipment, and stock levels across the facility"
        right={
          <div className="flex flex-wrap gap-2">
            <RefreshButton onRefresh={() => void refetch()} className="flex items-center gap-2 px-3 py-2 border border-[#D6D8CD] bg-white rounded-lg text-[#2B2B27] hover:bg-[#F5F6F1] transition text-sm font-medium" />
            <button onClick={() => setOpsOpen(true)} className="flex items-center gap-2 px-3 py-2 border border-[#D6D8CD] bg-white rounded-lg text-[#2B2B27] hover:bg-[#F5F6F1] transition text-sm font-medium">
              <Package className="w-4 h-4" /> Operations
            </button>
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-[#2E4A48] hover:bg-[#25403D] text-white font-semibold rounded-lg transition active:scale-95">
              <Plus className="w-4 h-4" /> Add Item
            </button>
          </div>
        }
      />

      {opsOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-[#F3F4EE] rounded-xl shadow-2xl w-full max-w-5xl my-4">
            <div className="sticky top-0 bg-[#2E4A48] text-white px-5 py-4 flex items-center justify-between rounded-t-xl z-10">
              <h2 className="font-bold text-base sm:text-lg flex items-center gap-2"><Package className="w-5 h-5" /> Materials Operations — Scan · FEFO · Vendors · Maintenance</h2>
              <button onClick={() => setOpsOpen(false)} className="p-1.5 hover:bg-white/15 rounded"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 sm:p-5"><InventoryOpsPanel /></div>
          </div>
        </div>
      )}

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
        <select value={stockFilter} onChange={e => { setStockFilter(e.target.value as typeof stockFilter); setPage(1); }}
          className="px-3 py-2.5 border border-[#D6D8CD] rounded-lg text-sm bg-white focus:ring-2 focus:ring-[#2E4A48]/30 focus:border-[#2E4A48] outline-none">
          <option value="all">All Stock Levels</option>
          <option value="OUT_OF_STOCK">Out of Stock</option>
          <option value="CRITICAL">Critical</option>
          <option value="LOW">Low</option>
        </select>
        <select value={expiryFilter} onChange={e => { setExpiryFilter(e.target.value as typeof expiryFilter); setPage(1); }}
          className="px-3 py-2.5 border border-[#D6D8CD] rounded-lg text-sm bg-white focus:ring-2 focus:ring-[#2E4A48]/30 focus:border-[#2E4A48] outline-none">
          <option value="all">Any Expiry</option>
          <option value="expired">Expired</option>
          <option value="7">Expiring ≤ 7 days</option>
          <option value="30">Expiring ≤ 30 days</option>
        </select>
        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-semibold text-[#C0573F] border border-[#C0573F]/40 hover:bg-[#C0573F]/10 transition"
          >
            <X className="w-3.5 h-3.5" /> Clear ({activeFilterCount})
          </button>
        )}
        <InventoryBarcodeScanner items={items} onFound={(item) => setViewing(item)} />
        <button
          type="button"
          onClick={() => setPrintLabels(toLabels(filtered))}
          disabled={filtered.length === 0}
          title="Print barcode labels for the items in view"
          className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium border border-[#D6D8CD] bg-white text-[#2B2B27] hover:bg-[#F5F6F1] transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Printer className="w-4 h-4" /> Print labels
        </button>
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
                  <StatusPill status={item.stockStatus} />
                </div>
                <div className="flex items-center gap-2 text-xs mb-2">
                  <span className="text-[#C0573F] font-medium">{item.category.replace(/_/g, " ")}</span>
                  {item.location !== "—" && <span className="text-[#2E4A48]">{item.location}</span>}
                </div>

                {/* Qty display */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1">
                    <button onClick={() => openAdjust(item, "subtract")} className="p-1 rounded hover:bg-[#C0573F]/10 text-[#C0573F] transition" title="Adjust stock — subtract"><Minus className="w-3.5 h-3.5" /></button>
                    <span className={`text-lg font-bold min-w-[3ch] text-center tabular-nums ${item.lowStock ? "text-[#C0573F]" : "text-[#2B2B27]"}`}>{item.quantity}</span>
                    <button onClick={() => openAdjust(item, "add")} className="p-1 rounded hover:bg-[#7E9B6F]/15 text-[#7E9B6F] transition" title="Adjust stock — add"><PlusIcon className="w-3.5 h-3.5" /></button>
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
                  <button onClick={() => setAdjusting(item)} title="Adjust stock" className="px-2 py-1.5 text-xs font-medium text-[#2E4A48] bg-[#2E4A48]/10 hover:bg-[#2E4A48]/20 rounded transition">
                    <SlidersHorizontal className="w-3.5 h-3.5" />
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
            <thead className="inventory-table-head bg-[#2E4A48]">
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
                      <button onClick={() => openAdjust(item, "subtract")} className="p-0.5 rounded hover:bg-[#C0573F]/10 text-[#C0573F] transition" title="Adjust stock — subtract"><Minus className="w-3 h-3" /></button>
                      <div className="text-center">
                        <div className={`text-xl font-bold tabular-nums leading-none ${item.lowStock ? "text-[#C0573F]" : "text-[#2B2B27]"}`}>{item.quantity}</div>
                        <div className="text-[10px] text-[#8A8D82] mt-0.5">{item.unit}</div>
                      </div>
                      <button onClick={() => openAdjust(item, "add")} className="p-0.5 rounded hover:bg-[#7E9B6F]/15 text-[#7E9B6F] transition" title="Adjust stock — add"><PlusIcon className="w-3 h-3" /></button>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <StatusPill status={item.stockStatus} />
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
                      <button onClick={() => setAdjusting(item)} className="p-1.5 rounded hover:bg-[#2E4A48]/10 text-[#2E4A48] transition" title="Adjust stock"><SlidersHorizontal className="w-4 h-4" /></button>
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
      </div>
      )}

      {/* View Modal */}
      {viewingLive && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-[#2E4A48] text-white p-5 flex items-center justify-between z-10">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#C39A3E]">Inventory Item</p>
                <h2 className="text-xl font-bold">{viewingLive.itemName}</h2>
              </div>
              <button onClick={() => setViewing(null)} className="p-2 hover:bg-white/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              {/* Stock level bar + quick adjust */}
              <div>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-semibold text-[#2B2B27]">Stock Level</span>
                  <span className={`font-bold ${viewingLive.outOfStock ? "text-[#9E3B2A]" : viewingLive.lowStock ? "text-[#C0573F]" : "text-[#7E9B6F]"}`}>
                    {viewingLive.quantity} / {viewingLive.minimumStock} min
                  </span>
                </div>
                <div className="h-3 bg-[#EBEDE4] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${viewingLive.lowStock ? "bg-[#C0573F]" : "bg-[#7E9B6F]"}`}
                    style={{ width: `${Math.min(100, (viewingLive.quantity / Math.max(viewingLive.minimumStock, 1)) * 100)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between mt-2">
                  <p className="text-xs text-[#8A8D82]">{viewingLive.unit}</p>
                  <div className="flex items-center gap-2">
                    <button onClick={() => openAdjust(viewingLive, "subtract")} disabled={viewingLive.quantity <= 0} className="p-1.5 rounded-lg border border-[#D6D8CD] hover:bg-[#C0573F]/10 text-[#C0573F] transition disabled:opacity-40 disabled:cursor-not-allowed" title="Adjust stock — subtract"><Minus className="w-4 h-4" /></button>
                    <span className="text-lg font-bold tabular-nums min-w-[3ch] text-center text-[#2B2B27]">{viewingLive.quantity}</span>
                    <button onClick={() => openAdjust(viewingLive, "add")} className="p-1.5 rounded-lg border border-[#D6D8CD] hover:bg-[#7E9B6F]/15 text-[#7E9B6F] transition" title="Adjust stock — add"><PlusIcon className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <DetailField icon={Building2} label="Category" value={viewingLive.category} />
                <DetailField icon={Hash} label="Quantity" value={`${viewingLive.quantity} ${viewingLive.unit}`} />
                <DetailField icon={AlertTriangle} label="Min Stock" value={String(viewingLive.minimumStock)} />
                <DetailField icon={MapPin} label="Location" value={viewingLive.location !== "—" ? viewingLive.location : "—"} />
                <DetailField icon={Package} label="Supplier" value={viewingLive.supplier !== "—" ? viewingLive.supplier : "—"} />
                <DetailField icon={Calendar} label="Expiry" value={viewingLive.expiryDate ? new Date(viewingLive.expiryDate).toLocaleDateString() : "—"} />
              </div>
              {(viewingLive.raw as { batchNumber?: string }).batchNumber && (
                <div className="mt-3 rounded-lg border border-[#D6D8CD] bg-white p-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8A8D82]">Barcode / Batch No.</p>
                    <button onClick={() => setPrintLabels(toLabels([viewingLive]))} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#D6D8CD] text-xs font-semibold text-[#2B2B27] hover:bg-[#F5F6F1] transition" title="Print this label">
                      <Printer className="w-3.5 h-3.5" /> Print label
                    </button>
                  </div>
                  <div className="flex justify-center"><Barcode value={String((viewingLive.raw as { batchNumber?: string }).batchNumber)} /></div>
                </div>
              )}

              {viewingLive.notes && (
                <div className="bg-[#C39A3E]/10 border-l-4 border-[#C39A3E] p-3 rounded">
                  <p className="text-xs font-semibold text-[#C39A3E] mb-1">Notes</p>
                  <p className="text-sm text-[#2B2B27]">{viewingLive.notes}</p>
                </div>
              )}
            </div>
            <div className="sticky bottom-0 bg-[#F5F6F1] border-t border-[#E1E3D9] px-6 py-4 flex flex-wrap items-center justify-between gap-3">
              <button onClick={() => setViewing(null)} className="px-6 py-2 text-[#2B2B27] hover:bg-[#EBEDE4] rounded-lg transition font-medium">Close</button>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => { const v = viewingLive; setViewing(null); setAdjusting(v); }} className="px-4 py-2 bg-[#2E4A48] hover:bg-[#25403D] text-white font-semibold rounded-lg transition text-sm">
                  <SlidersHorizontal className="w-4 h-4 inline mr-1" /> Adjust
                </button>
                <button onClick={() => { const v = viewingLive; setViewing(null); startEditing(v); }} className="px-4 py-2 bg-[#C39A3E] hover:bg-[#AD892F] text-white font-semibold rounded-lg transition text-sm">
                  <Edit className="w-4 h-4 inline mr-1" /> Edit
                </button>
                <button onClick={() => { handleDelete(viewingLive); setViewing(null); }} className="px-4 py-2 bg-[#C0573F] hover:bg-[#A8482F] text-white font-semibold rounded-lg transition text-sm">
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

      {/* Adjust Stock Modal */}
      {adjusting && <AdjustStockModal item={adjusting} initialMode={adjustMode} onApply={handleAdjustWithReason} onCancel={() => setAdjusting(null)} />}

      {/* Print-only barcode label sheet */}
      {printLabels && <BarcodeLabelSheet labels={printLabels} onDone={() => setPrintLabels(null)} />}
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

/** Adjust stock by an arbitrary amount with a required reason note (Module 14). */
function AdjustStockModal({
  item, initialMode = "add", onApply, onCancel,
}: {
  item: InventoryItem;
  initialMode?: "add" | "subtract";
  onApply: (item: InventoryItem, delta: number, reason: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"add" | "subtract">(initialMode);
  const [qty, setQty] = useState("1");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const amount = Math.max(0, Number(qty) || 0);
  const delta = mode === "add" ? amount : -amount;
  const nextQty = Math.max(0, item.quantity + delta);

  const submit = async () => {
    if (amount <= 0) return;
    setSaving(true);
    await onApply(item, delta, reason.trim());
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="bg-[#2E4A48] text-white p-5 flex items-center justify-between rounded-t-xl">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#C39A3E]">Adjust Stock</p>
            <h2 className="text-lg font-bold">{item.itemName}</h2>
          </div>
          <button onClick={onCancel} className="p-2 hover:bg-white/20 rounded-lg transition"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex rounded-lg border border-[#D6D8CD] overflow-hidden">
            <button type="button" onClick={() => setMode("add")} className={`flex-1 py-2 text-sm font-semibold flex items-center justify-center gap-1.5 transition ${mode === "add" ? "bg-[#7E9B6F] text-white" : "bg-white text-[#2B2B27] hover:bg-[#F5F6F1]"}`}><PlusIcon className="w-4 h-4" /> Add</button>
            <button type="button" onClick={() => setMode("subtract")} className={`flex-1 py-2 text-sm font-semibold flex items-center justify-center gap-1.5 transition ${mode === "subtract" ? "bg-[#C0573F] text-white" : "bg-white text-[#2B2B27] hover:bg-[#F5F6F1]"}`}><Minus className="w-4 h-4" /> Subtract</button>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#8A8D82] mb-1">Quantity ({item.unit})</label>
            <input type="number" min="0" value={qty} onChange={e => setQty(e.target.value)} className="w-full px-3 py-2 border border-[#D6D8CD] rounded-lg text-sm focus:ring-2 focus:ring-[#2E4A48]/30 focus:border-[#2E4A48] outline-none" />
          </div>
          <div className="flex items-center justify-between rounded-lg bg-[#F5F6F1] px-4 py-3 text-sm">
            <span className="text-[#8A8D82]">On hand</span>
            <span className="font-bold text-[#2B2B27] tabular-nums">{item.quantity} → {nextQty} {item.unit}</span>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#8A8D82] mb-1">Reason note</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="e.g. Delivery received, damaged units removed, cycle-count correction…" className="w-full px-3 py-2 border border-[#D6D8CD] rounded-lg text-sm focus:ring-2 focus:ring-[#2E4A48]/30 focus:border-[#2E4A48] outline-none resize-none" />
          </div>
        </div>
        <div className="bg-[#F5F6F1] border-t border-[#E1E3D9] px-6 py-4 flex justify-end gap-2 rounded-b-xl">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm font-medium text-[#2B2B27] hover:bg-[#EBEDE4] rounded-lg transition">Cancel</button>
          <button type="button" onClick={submit} disabled={saving || amount <= 0} className="px-5 py-2 rounded-lg bg-[#2E4A48] text-white text-sm font-semibold hover:bg-[#25403D] disabled:opacity-50 transition">
            {saving ? "Saving…" : "Apply adjustment"}
          </button>
        </div>
      </div>
    </div>
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

  // Every item gets a scannable barcode/batch number; auto-generate if blank.
  useEffect(() => {
    if (!form.batchNumber) onChange({ ...form, batchNumber: generateBarcode() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[#2E4A48] text-white p-5 flex items-center justify-between z-10">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onCancel} className="p-2 hover:bg-white/20 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              <label className="block text-sm font-semibold text-[#2B2B27] mb-1">Barcode / Batch No.</label>
              <div className="flex gap-2">
                <input type="text" value={form.batchNumber} onChange={set("batchNumber")} className="flex-1 px-3 py-2 border border-[#D6D8CD] rounded-lg text-sm font-mono focus:ring-2 focus:ring-[#2E4A48]/30 focus:border-[#2E4A48] outline-none" placeholder="Auto-generated" />
                <button type="button" onClick={() => onChange({ ...form, batchNumber: generateBarcode() })} title="Generate a new code" className="px-3 py-2 border border-[#D6D8CD] rounded-lg text-sm font-medium text-[#2B2B27] hover:bg-[#F5F6F1]"><RefreshCw className="w-4 h-4" /></button>
              </div>
              {form.batchNumber && <div className="mt-2 flex justify-center rounded border border-[#EEF0E8] bg-white p-1.5"><Barcode value={form.batchNumber} height={40} width={1.4} /></div>}
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
        <div className="sticky bottom-0 bg-[#F5F6F1] border-t border-[#E1E3D9] px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <button onClick={onCancel} className="px-5 py-2 text-[#2B2B27] hover:bg-[#EBEDE4] rounded-lg transition font-medium text-sm">Cancel</button>
          <button onClick={onSave} className="px-5 py-2 bg-[#2E4A48] hover:bg-[#25403D] text-white font-semibold rounded-lg transition active:scale-95 text-sm">{saveLabel}</button>
        </div>
      </div>
    </div>
  );
}
