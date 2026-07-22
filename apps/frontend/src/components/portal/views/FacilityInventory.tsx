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
import Swal from "sweetalert2";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptInventoryItem } from "@/lib/adapters";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Inventory Management
          </h1>
          <p className="text-gray-600">Track supplies, equipment, and stock levels across the facility</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void refetch()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95">
            <Plus className="w-4 h-4" /> Add Item
          </button>
        </div>
      </div>

      {/* Stat Boxes */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatBox label="Total Items" value={String(stats.total)} icon={Package} color="blue" />
        <StatBox label="In Stock" value={String(stats.inStock)} icon={Package} color="green" />
        <StatBox label="Low Stock" value={String(stats.lowStock)} icon={AlertTriangle} color="red" />
        <StatBox label="Total Qty" value={String(stats.totalQty)} icon={Hash} color="purple" />
        <StatBox label="Categories" value={String(stats.categories)} icon={Building2} color="amber" />
        <StatBox label="Locations" value={String(stats.locations)} icon={MapPin} color="blue" />
      </div>

      {/* Chart */}
      {categoryDist.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Building2 className="w-4 h-4 text-yellow-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Category Distribution</h3>
          </div>
          <div className="h-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryDist} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" fontSize={9} tickLine={false} axisLine={false} angle={-20} textAnchor="end" height={40} />
                <YAxis allowDecimals={false} fontSize={10} tickLine={false} axisLine={false} width={20} />
                <Tooltip />
                <Bar dataKey="value" name="Items" radius={[3, 3, 0, 0]}>
                  {categoryDist.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search name, category, location, supplier…" value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
        </div>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
          <option value="all">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
        </select>
        <select value={locationFilter} onChange={e => setLocationFilter(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
          <option value="all">All Locations</option>
          {locations.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <label className="flex items-center gap-2 px-3 py-2.5 bg-white border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition text-sm select-none">
          <input type="checkbox" checked={showLowStock} onChange={e => setShowLowStock(e.target.checked)} className="rounded" />
          <AlertTriangle className="w-4 h-4 text-red-500" /> Low stock only
        </label>
        <div className="flex rounded-lg border border-gray-300 overflow-hidden">
          <button onClick={() => { setViewMode("grid"); setPage(1); }}
            className={`px-3 py-2.5 text-sm transition ${viewMode === "grid" ? "bg-yellow-400 text-black font-semibold" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button onClick={() => { setViewMode("table"); setPage(1); }}
            className={`px-3 py-2.5 text-sm transition ${viewMode === "table" ? "bg-yellow-400 text-black font-semibold" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
            <Table2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {loading && items.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading inventory...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">No items match your filters.</div>
      ) : viewMode === "grid" ? (
        /* ── Grid View ── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {paginated.map(item => (
            <div key={item.id} className={`bg-white rounded-lg border overflow-hidden hover:shadow-md transition group ${item.lowStock ? "border-red-300 ring-1 ring-red-200" : "border-gray-200"}`}>
              {/* Stock bar */}
              <div className="h-1.5 bg-gray-100">
                <div
                  className={`h-full transition-all duration-500 ${item.lowStock ? "bg-red-500" : "bg-green-500"}`}
                  style={{ width: `${Math.min(100, (item.quantity / Math.max(item.minimumStock, 1)) * 100)}%` }}
                />
              </div>
              <div className="p-3">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <h3 className="font-semibold text-gray-900 text-sm truncate flex-1">{item.itemName}</h3>
                  {item.lowStock && <span title="Low Stock"><AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" /></span>}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                  <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-medium">{item.category}</span>
                  {item.location !== "—" && <span>{item.location}</span>}
                </div>

                {/* Qty display */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleQuickAdjust(item, -1)} className="p-1 rounded hover:bg-red-50 text-red-500 transition" title="Decrease"><Minus className="w-3.5 h-3.5" /></button>
                    <span className={`text-lg font-bold min-w-[3ch] text-center ${item.lowStock ? "text-red-600" : "text-gray-900"}`}>{item.quantity}</span>
                    <button onClick={() => handleQuickAdjust(item, 1)} className="p-1 rounded hover:bg-green-50 text-green-500 transition" title="Increase"><PlusIcon className="w-3.5 h-3.5" /></button>
                  </div>
                  <span className="text-xs text-gray-500">{item.unit} &middot; Min: {item.minimumStock}</span>
                </div>

                <div className="flex gap-1.5">
                  <button onClick={() => setViewing(item)} className="flex-1 px-2 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded transition flex items-center justify-center gap-1">
                    <Eye className="w-3 h-3" /> View
                  </button>
                  <button onClick={() => startEditing(item)} className="flex-1 px-2 py-1.5 text-xs font-medium text-yellow-600 bg-yellow-50 hover:bg-yellow-100 rounded transition flex items-center justify-center gap-1">
                    <Edit className="w-3 h-3" /> Edit
                  </button>
                  <button onClick={() => handleDelete(item)} className="px-2 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded transition">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* ── Table View ── */
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Item</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Category</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Qty</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Min</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Location</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Supplier</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Expiry</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginated.map(item => (
                <tr key={item.id} className={`hover:bg-gray-50 transition ${item.lowStock ? "bg-red-50/40" : ""}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">{item.itemName}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{item.category}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleQuickAdjust(item, -1)} className="p-0.5 rounded hover:bg-red-100 text-red-500"><Minus className="w-3 h-3" /></button>
                      <span className={`font-semibold min-w-[2.5ch] text-center ${item.lowStock ? "text-red-600" : "text-gray-900"}`}>{item.quantity}</span>
                      <button onClick={() => handleQuickAdjust(item, 1)} className="p-0.5 rounded hover:bg-green-100 text-green-500"><PlusIcon className="w-3 h-3" /></button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{item.minimumStock}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{item.location !== "—" ? item.location : ""}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{item.supplier !== "—" ? item.supplier : ""}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{item.expiryDate ? new Date(item.expiryDate).toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-3">
                    {item.lowStock ? (
                      <span className="flex items-center gap-1 text-red-600 text-xs font-medium"><AlertTriangle className="w-3 h-3" /> Low</span>
                    ) : (
                      <span className="text-green-600 text-xs font-medium">OK</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => setViewing(item)} className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition" title="View"><Eye className="w-4 h-4" /></button>
                      <button onClick={() => startEditing(item)} className="p-1.5 rounded hover:bg-yellow-100 text-yellow-600 transition" title="Edit"><Edit className="w-4 h-4" /></button>
                      <button onClick={() => handleDelete(item)} className="p-1.5 rounded hover:bg-red-100 text-red-600 transition" title="Delete"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {filtered.length > perPage && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="text-sm text-gray-600">{filtered.length} items total</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">Previous</button>
            <span className="px-3 py-2 text-sm font-medium text-gray-700">Page {page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">Next</button>
          </div>
        </div>
      )}

      {/* View Modal */}
      {viewing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className={`sticky top-0 bg-gradient-to-r ${viewing.lowStock ? "from-red-400 to-red-500" : "from-blue-400 to-blue-500"} text-white p-5 flex items-center justify-between z-10`}>
              <h2 className="text-xl font-bold">{viewing.itemName}</h2>
              <button onClick={() => setViewing(null)} className="p-2 hover:bg-white/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              {/* Stock level bar */}
              <div>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-semibold text-gray-700">Stock Level</span>
                  <span className={`font-bold ${viewing.lowStock ? "text-red-600" : "text-green-600"}`}>
                    {viewing.quantity} / {viewing.minimumStock} min
                  </span>
                </div>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${viewing.lowStock ? "bg-red-500" : "bg-green-500"}`}
                    style={{ width: `${Math.min(100, (viewing.quantity / Math.max(viewing.minimumStock, 1)) * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">{viewing.unit}</p>
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
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded">
                  <p className="text-xs font-semibold text-yellow-700 mb-1">Notes</p>
                  <p className="text-sm text-gray-900">{viewing.notes}</p>
                </div>
              )}
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setViewing(null)} className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium">Close</button>
              <div className="flex gap-2">
                <button onClick={() => { setViewing(null); startEditing(viewing); }} className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white font-semibold rounded-lg transition text-sm">
                  <Edit className="w-4 h-4 inline mr-1" /> Edit
                </button>
                <button onClick={() => { handleDelete(viewing); setViewing(null); }} className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg transition text-sm">
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

function StatBox({ label, value, icon: Icon, color }: { label: string; value: string; icon: LucideIcon; color: string }) {
  const COLORS: Record<string, string> = {
    blue: "text-blue-600 bg-blue-50 border-blue-200",
    green: "text-green-600 bg-green-50 border-green-200",
    red: "text-red-600 bg-red-50 border-red-200",
    purple: "text-purple-600 bg-purple-50 border-purple-200",
    amber: "text-amber-600 bg-amber-50 border-amber-200",
  };
  const c = COLORS[color] || COLORS.blue;
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

function DetailField({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="bg-gray-50 p-3 rounded border border-gray-200">
      <p className="text-xs text-gray-600 font-semibold flex items-center gap-1 mb-0.5"><Icon className="w-3 h-3" />{label}</p>
      <p className="text-sm font-semibold text-gray-900">{value}</p>
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
        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onCancel} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Item Name</label>
              <input type="text" value={form.itemName} onChange={set("itemName")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Category</label>
              <select value={form.category} onChange={set("category")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Unit</label>
              <input type="text" value={form.unit} onChange={set("unit")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" placeholder="pcs, boxes..." />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Quantity</label>
              <input type="number" min="0" value={form.quantity} onChange={set("quantity")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Minimum Stock</label>
              <input type="number" min="0" value={form.minimumStock} onChange={set("minimumStock")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Location</label>
              <input type="text" value={form.location} onChange={set("location")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Supplier</label>
              <input type="text" value={form.supplier} onChange={set("supplier")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Expiry Date</label>
              <input type="date" value={form.expiryDate} onChange={set("expiryDate")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Notes</label>
              <textarea value={form.notes} onChange={set("notes")} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
            </div>
          </div>
        </div>
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
          <button onClick={onCancel} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Cancel</button>
          <button onClick={onSave} className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">{saveLabel}</button>
        </div>
      </div>
    </div>
  );
}
