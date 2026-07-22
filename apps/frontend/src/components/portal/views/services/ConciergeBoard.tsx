"use client";

import { useMemo, useState } from "react";
import {
  RefreshCw, Plus, X, Trash2, Search, CheckCircle2, Ban, Loader2, Star,
  CalendarCheck, Clock, CircleDollarSign, Play, ChevronLeft, ChevronRight, Eye,
} from "lucide-react";
import Swal from "sweetalert2";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";
import { CONCIERGE_CATALOG, BOOKING_STATUS_PILL } from "./serviceMeta";

/**
 * Concierge & premium "hotel on the hospital" services desk (Phase 7 cont.)
 * — live via Supabase realtime + polling fallback. Staff confirm, run, and
 * complete resident bookings across the premium catalog (wake-up calls,
 * turndown, salon & barber, café/bistro, movie & game nights, garden lounge,
 * guest suite, spa therapy, chaplain visits). Billable services post a
 * ServiceCharge into the invoice pipeline on completion.
 */

type Row = Record<string, unknown>;

const rel = (v: unknown): Row => (v && typeof v === "object" ? (v as Row) : {});

const adaptBooking = (r: Row) => {
  const resident = rel(r.resident);
  return {
    id: String(r.id ?? ""),
    residentId: String(r.residentId ?? ""),
    residentName: `${String(resident.firstName ?? "")} ${String(resident.lastName ?? "")}`.trim() || "—",
    roomNumber: String(resident.roomNumber ?? ""),
    category: String(r.category ?? "CONCIERGE_DESK"),
    serviceName: String(r.serviceName ?? "Concierge service"),
    scheduledAt: r.scheduledAt ? String(r.scheduledAt) : "",
    status: String(r.status ?? "REQUESTED"),
    staffName: String(r.staffName ?? ""),
    location: String(r.location ?? ""),
    price: Number(r.price ?? 0),
    billable: Boolean(r.billable),
    billed: Boolean(r.billed),
    rating: Number(r.rating ?? 0),
    notes: String(r.notes ?? ""),
    createdAt: String(r.createdAt ?? ""),
  };
};
type Booking = ReturnType<typeof adaptBooking>;

const adaptResident = (r: Row) => ({
  id: String(r.id ?? ""),
  name: `${String(r.firstName ?? "")} ${String(r.lastName ?? "")}`.trim(),
  roomNumber: String(r.roomNumber ?? ""),
});
type ResidentOpt = ReturnType<typeof adaptResident>;

const STATUSES = ["REQUESTED", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

const emptyForm = {
  residentId: "", category: "CONCIERGE_DESK", scheduledAt: "",
  location: "", price: "", notes: "",
};

export default function ConciergeBoard() {
  const { data: rows, loading, error, refetch } = useLiveQuery<Row>(
    "concierge-bookings", { query: "include=resident&take=400", tables: ["ConciergeBooking"] }
  );
  const residentsQ = useLiveQuery<Row>("residents", { query: "take=300", tables: ["Resident"] });

  const bookings = useMemo<Booking[]>(() => rows.map(adaptBooking), [rows]);
  const residents = useMemo<ResidentOpt[]>(() => residentsQ.data.map(adaptResident), [residentsQ.data]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [viewing, setViewing] = useState<Booking | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const perPage = 12;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bookings.filter(b => {
      if (q && !b.residentName.toLowerCase().includes(q) && !b.serviceName.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && b.status !== statusFilter) return false;
      return true;
    });
  }, [bookings, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const stats = useMemo(() => {
    const rated = bookings.filter(b => b.rating >= 1);
    return {
      requested: bookings.filter(b => b.status === "REQUESTED").length,
      confirmed: bookings.filter(b => ["CONFIRMED", "IN_PROGRESS"].includes(b.status)).length,
      completed: bookings.filter(b => b.status === "COMPLETED").length,
      revenue: bookings.filter(b => b.billed).reduce((s, b) => s + b.price, 0),
      avgRating: rated.length ? rated.reduce((s, b) => s + b.rating, 0) / rated.length : 0,
    };
  }, [bookings]);

  const handleCreate = async () => {
    if (!form.residentId || !form.scheduledAt) {
      Swal.fire({ title: "Missing Fields", text: "Resident and schedule are required.", icon: "warning" });
      return;
    }
    const cat = CONCIERGE_CATALOG[form.category];
    try {
      await createRecord("concierge-bookings", {
        residentId: form.residentId,
        category: form.category,
        serviceName: cat?.label ?? form.category,
        scheduledAt: new Date(form.scheduledAt).toISOString(),
        status: "CONFIRMED", // desk-created bookings are confirmed on the spot
        staffName: "Concierge Desk",
        location: form.location || null,
        price: form.price !== "" ? Number(form.price) || 0 : cat?.defaultPrice ?? 0,
        billable: (form.price !== "" ? Number(form.price) > 0 : cat?.billable) ?? false,
        notes: form.notes || null,
      });
      await refetch();
      setShowCreate(false);
      setForm(emptyForm);
      Swal.fire({ title: "Booked", text: `${cat?.label ?? "Service"} confirmed.`, icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Booking Failed", text: err instanceof Error ? err.message : "Could not create booking.", icon: "error" });
    }
  };

  const handleConfirm = async (b: Booking) => {
    setBusyId(b.id);
    try {
      await updateRecord("concierge-bookings", b.id, { status: "CONFIRMED", staffName: "Concierge Desk" });
      await refetch();
    } catch (err) {
      Swal.fire({ title: "Update Failed", text: err instanceof Error ? err.message : "Could not confirm booking.", icon: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const handleStart = async (b: Booking) => {
    setBusyId(b.id);
    try {
      await updateRecord("concierge-bookings", b.id, { status: "IN_PROGRESS" });
      await refetch();
    } catch (err) {
      Swal.fire({ title: "Update Failed", text: err instanceof Error ? err.message : "Could not start service.", icon: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const handleComplete = async (b: Booking) => {
    const result = await Swal.fire({
      title: "Complete Booking",
      html:
        `<p style="font-size:14px;margin-bottom:10px">"${b.serviceName}" for ${b.residentName} — final price:</p>` +
        `<input id="swal-price" type="number" min="0" step="0.01" class="swal2-input" placeholder="Price (₱, 0 = complimentary)" value="${b.price || ""}">`,
      icon: "question", showCancelButton: true,
      confirmButtonColor: "#22c55e", cancelButtonColor: "#6b7280", confirmButtonText: "Complete",
      preConfirm: () => Number((document.getElementById("swal-price") as HTMLInputElement | null)?.value ?? 0) || 0,
    });
    if (!result.isConfirmed) return;
    const price = Number(result.value ?? 0);
    setBusyId(b.id);
    try {
      const billable = price > 0;
      await updateRecord("concierge-bookings", b.id, {
        status: "COMPLETED", price: billable ? price : 0, billable, billed: billable,
      });
      // Billable premium services post straight into the invoice pipeline.
      if (billable) {
        await createRecord("service-charges", {
          residentId: b.residentId,
          description: `${b.serviceName} (Concierge booking ${b.id.slice(0, 8)})`,
          amount: price,
          serviceDate: new Date().toISOString(),
          category: "Concierge Services",
        });
      }
      await refetch();
      Swal.fire({
        title: "Booking Completed",
        text: billable ? `₱${price.toLocaleString()} posted to the resident's invoice pipeline.` : "Complimentary service logged.",
        icon: "success", timer: 2000, showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire({ title: "Complete Failed", text: err instanceof Error ? err.message : "Could not complete booking.", icon: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (b: Booking) => {
    const confirmed = await Swal.fire({
      title: "Cancel Booking?", text: `Cancel "${b.serviceName}" for ${b.residentName}?`, icon: "warning",
      showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Cancel Booking",
    });
    if (!confirmed.isConfirmed) return;
    setBusyId(b.id);
    try {
      await updateRecord("concierge-bookings", b.id, { status: "CANCELLED" });
      await refetch();
    } catch (err) {
      Swal.fire({ title: "Cancel Failed", text: err instanceof Error ? err.message : "Could not cancel booking.", icon: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (b: Booking) => {
    const confirmed = await Swal.fire({
      title: "Delete Booking?", text: "Remove this booking permanently?", icon: "warning",
      showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Delete",
    });
    if (!confirmed.isConfirmed) return;
    try {
      await deleteRecord("concierge-bookings", b.id);
      await refetch();
    } catch (err) {
      Swal.fire({ title: "Delete Failed", text: err instanceof Error ? err.message : "Could not delete booking.", icon: "error" });
    }
  };

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Concierge Desk
          </h1>
          <p className="text-gray-600">Premium &quot;hotel on the hospital&quot; services — wake-up calls · turndown · salon · café · spa · guest suite · chaplain</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void refetch()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button onClick={() => { setForm(emptyForm); setShowCreate(true); }} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95">
            <Plus className="w-4 h-4" /> New Booking
          </button>
        </div>
      </div>

      {/* Stat Boxes */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatBox label="Requested" value={String(stats.requested)} icon={Clock} color="amber" />
        <StatBox label="Confirmed / Active" value={String(stats.confirmed)} icon={CalendarCheck} color="blue" />
        <StatBox label="Completed" value={String(stats.completed)} icon={CheckCircle2} color="green" />
        <StatBox label="Billed Revenue" value={`₱${Math.round(stats.revenue).toLocaleString()}`} icon={CircleDollarSign} color="purple" />
        <StatBox label="Avg Rating" value={stats.avgRating ? `${stats.avgRating.toFixed(1)} ★` : "—"} icon={Star} color="amber" />
      </div>

      {/* Premium catalog reference */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 text-sm mb-3">Premium Service Catalog</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {Object.entries(CONCIERGE_CATALOG).map(([k, c]) => {
            const Icon = c.icon;
            return (
              <button key={k}
                onClick={() => { setForm({ ...emptyForm, category: k, price: c.defaultPrice ? String(c.defaultPrice) : "" }); setShowCreate(true); }}
                className={`text-left border rounded-lg p-2.5 hover:shadow-md transition ${c.cls}`}>
                <Icon className="w-4 h-4 mb-1" />
                <p className="text-xs font-semibold text-gray-900 leading-tight">{c.label}</p>
                <p className="text-[10px] text-gray-500 leading-tight mt-0.5">{c.defaultPrice ? `from ₱${c.defaultPrice}` : "Complimentary"}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-center">
        <div className="flex gap-2 flex-wrap">
          {["all", ...STATUSES].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition border ${
                statusFilter === s
                  ? "bg-yellow-400 text-black border-yellow-400"
                  : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
              }`}>
              {s === "all" ? "All" : s.replace(/_/g, " ")}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search resident or service…" value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {/* Bookings table */}
      {loading && bookings.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading concierge bookings...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">No bookings match your filters.</div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Service</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Resident · Room</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Scheduled</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Location</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Price</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-700">Rating</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginated.map(b => {
                const cat = CONCIERGE_CATALOG[b.category];
                const Icon = cat?.icon ?? CalendarCheck;
                const busy = busyId === b.id;
                return (
                  <tr key={b.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cat?.cls ?? "text-gray-600 bg-gray-50 border-gray-200"}`}>
                        <Icon className="w-3 h-3" /> {b.serviceName}
                      </span>
                      {b.notes && <p className="text-[11px] text-gray-500 mt-0.5 max-w-[220px] truncate" title={b.notes}>{b.notes}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{b.residentName}</p>
                      <p className="text-xs text-gray-500">Room {b.roomNumber || "—"}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{b.scheduledAt ? new Date(b.scheduledAt).toLocaleString() : "—"}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{b.location || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${BOOKING_STATUS_PILL[b.status] ?? "bg-gray-100 text-gray-700"}`}>
                        {b.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900 font-medium">
                      {b.price ? `₱${b.price.toLocaleString()}` : "Free"}
                      {b.billed && <p className="text-[10px] text-green-600 font-semibold">POSTED</p>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {b.rating >= 1 ? (
                        <span className="inline-flex items-center gap-0.5 text-amber-500 font-semibold text-xs">
                          {b.rating} <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1 flex-wrap">
                        {busy ? (
                          <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                        ) : (
                          <>
                            <button onClick={() => setViewing(b)} className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition" title="View Details"><Eye className="w-4 h-4" /></button>
                            {b.status === "REQUESTED" && (
                              <button onClick={() => handleConfirm(b)} className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition" title="Confirm Booking"><CalendarCheck className="w-4 h-4" /></button>
                            )}
                            {b.status === "CONFIRMED" && (
                              <button onClick={() => handleStart(b)} className="p-1.5 rounded hover:bg-indigo-100 text-indigo-600 transition" title="Start Service"><Play className="w-4 h-4" /></button>
                            )}
                            {["CONFIRMED", "IN_PROGRESS"].includes(b.status) && (
                              <button onClick={() => handleComplete(b)} className="p-1.5 rounded hover:bg-green-100 text-green-600 transition" title="Complete"><CheckCircle2 className="w-4 h-4" /></button>
                            )}
                            {!["COMPLETED", "CANCELLED"].includes(b.status) && (
                              <button onClick={() => handleCancel(b)} className="p-1.5 rounded hover:bg-red-100 text-red-500 transition" title="Cancel"><Ban className="w-4 h-4" /></button>
                            )}
                            <button onClick={() => handleDelete(b)} className="p-1.5 rounded hover:bg-red-100 text-red-600 transition" title="Delete"><Trash2 className="w-4 h-4" /></button>
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">{filtered.length} bookings total</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-sm font-medium text-gray-700">Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {/* View Modal */}
      {viewing && <ConciergeViewModal booking={viewing} onClose={() => setViewing(null)} />}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
              <h2 className="text-xl font-bold">New Concierge Booking</h2>
              <button onClick={() => setShowCreate(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Resident</label>
                  <select value={form.residentId} onChange={set("residentId")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    <option value="">Select resident…</option>
                    {residents.map(r => <option key={r.id} value={r.id}>{r.name} — Room {r.roomNumber}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Service</label>
                  <select value={form.category} onChange={e => {
                    const cat = CONCIERGE_CATALOG[e.target.value];
                    setForm(f => ({ ...f, category: e.target.value, price: cat?.defaultPrice ? String(cat.defaultPrice) : "" }));
                  }} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    {Object.entries(CONCIERGE_CATALOG).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Date &amp; Time</label>
                  <input type="datetime-local" value={form.scheduledAt} onChange={set("scheduledAt")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Price (₱)</label>
                  <input type="number" min="0" step="0.01" value={form.price} onChange={set("price")} placeholder="0 = complimentary" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Location</label>
                  <input type="text" value={form.location} onChange={set("location")} placeholder="e.g. Spa Suite, Garden Lounge, Room 302" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Notes</label>
                  <textarea value={form.notes} onChange={set("notes")} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setShowCreate(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Cancel</button>
              <button onClick={handleCreate} className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">Confirm Booking</button>
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

function ConciergeViewModal({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const cat = CONCIERGE_CATALOG[booking.category];
  const CatIcon = cat?.icon ?? CalendarCheck;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
          <h2 className="text-xl font-bold">{booking.serviceName}</h2>
          <button onClick={onClose} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-6 space-y-5">
          <div className="flex flex-wrap gap-2">
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${cat?.cls ?? "text-gray-600 bg-gray-50 border-gray-200"}`}><CatIcon className="w-3.5 h-3.5" /> {cat?.label ?? booking.category}</span>
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${BOOKING_STATUS_PILL[booking.status] ?? "bg-gray-100 text-gray-700"}`}>{booking.status.replace(/_/g, " ")}</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              ["Resident", booking.residentName || "—"],
              ["Room", booking.roomNumber || "—"],
              ["Scheduled", booking.scheduledAt ? new Date(booking.scheduledAt).toLocaleString() : "—"],
              ["Location", booking.location || "—"],
              ["Staff", booking.staffName || "—"],
              ["Price", booking.price ? `₱${booking.price.toLocaleString()}` : "Complimentary"],
              ["Billed", booking.billed ? "Yes — posted to invoice" : "No"],
              ["Rating", booking.rating >= 1 ? `${booking.rating} ★` : "—"],
            ].map(([label, value]) => (
              <div key={label} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
                <p className="text-sm font-medium text-gray-900 mt-0.5">{value}</p>
              </div>
            ))}
          </div>
          {booking.notes && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Notes</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{booking.notes}</p>
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
