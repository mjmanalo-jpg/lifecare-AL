"use client";

import { useMemo, useState } from "react";
import {
  RefreshCw, Plus, X, Search, LogIn, LogOut, Loader2, Trash2, Receipt,
  BadgeCheck, CircleDollarSign, Users, DoorOpen, ChevronLeft, ChevronRight, Eye,
} from "lucide-react";
import Swal from "sweetalert2";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";
import { VISIT_TYPE_META, FRONTDESK_STATUS_PILL } from "./pmsMeta";

/**
 * Front Desk & Guest Management (Phase 7 PMS) — live via Supabase realtime +
 * polling. Workflow: guest/new-resident arrival → check-in (ID & visitor pass)
 * → inquiries/ancillary payments (dining/salon) → check-out & receipt.
 */

type Row = Record<string, unknown>;

const rel = (v: unknown): Row => (v && typeof v === "object" ? (v as Row) : {});

const adaptVisit = (r: Row) => {
  const resident = rel(r.resident);
  let ancillary: { label: string; amount: number }[] = [];
  try { ancillary = r.ancillaryItems ? JSON.parse(String(r.ancillaryItems)) : []; } catch { ancillary = []; }
  return {
    id: String(r.id ?? ""),
    visitType: String(r.visitType ?? "GUEST_VISIT"),
    status: String(r.status ?? "ARRIVED"),
    visitorName: String(r.visitorName ?? ""),
    visitorPhone: String(r.visitorPhone ?? ""),
    idType: String(r.idType ?? ""),
    idNumber: String(r.idNumber ?? ""),
    visitorPass: String(r.visitorPass ?? ""),
    residentId: String(r.residentId ?? ""),
    residentName: `${String(resident.firstName ?? "")} ${String(resident.lastName ?? "")}`.trim(),
    roomNumber: String(r.roomNumber ?? resident.roomNumber ?? ""),
    purpose: String(r.purpose ?? ""),
    arrivalTime: String(r.arrivalTime ?? ""),
    checkInTime: r.checkInTime ? String(r.checkInTime) : "",
    checkOutTime: r.checkOutTime ? String(r.checkOutTime) : "",
    ancillary,
    ancillaryTotal: Number(r.ancillaryTotal ?? 0),
    receiptNumber: String(r.receiptNumber ?? ""),
    notes: String(r.notes ?? ""),
  };
};
type Visit = ReturnType<typeof adaptVisit>;

const adaptResident = (r: Row) => ({
  id: String(r.id ?? ""),
  name: `${String(r.firstName ?? "")} ${String(r.lastName ?? "")}`.trim(),
  roomNumber: String(r.roomNumber ?? ""),
});

const VISIT_TYPES = ["GUEST_VISIT", "NEW_RESIDENT_ARRIVAL", "TOUR", "CONTRACTOR", "DELIVERY"];
const ID_TYPES = ["Driver's License", "Passport", "UMID", "PhilID", "Senior ID", "Company ID"];

const emptyForm = {
  visitType: "GUEST_VISIT", visitorName: "", visitorPhone: "",
  idType: "Driver's License", idNumber: "", residentId: "", roomNumber: "", purpose: "",
};

export default function FrontDeskBoard() {
  const { data: rows, loading, error, refetch } = useLiveQuery<Row>(
    "front-desk-visits", { query: "include=resident&take=300", tables: ["FrontDeskVisit"], pollMs: 12000 }
  );
  const residentsQ = useLiveQuery<Row>("residents", { query: "take=300", tables: ["Resident"] });

  const visits = useMemo<Visit[]>(() => rows.map(adaptVisit), [rows]);
  const residents = useMemo(() => residentsQ.data.map(adaptResident), [residentsQ.data]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Visit | null>(null);
  const [page, setPage] = useState(1);
  const perPage = 12;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visits.filter(v => {
      if (q && !v.visitorName.toLowerCase().includes(q) && !v.roomNumber.toLowerCase().includes(q) && !v.residentName.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && v.status !== statusFilter) return false;
      return true;
    });
  }, [visits, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const stats = useMemo(() => ({
    onSite: visits.filter(v => v.status === "CHECKED_IN").length,
    arriving: visits.filter(v => v.status === "ARRIVED").length,
    newArrivals: visits.filter(v => v.visitType === "NEW_RESIDENT_ARRIVAL" && v.status !== "CHECKED_OUT").length,
    ancillary: visits.reduce((s, v) => s + v.ancillaryTotal, 0),
  }), [visits]);

  const handleCreate = async () => {
    if (!form.visitorName) {
      Swal.fire({ title: "Missing Fields", text: "Visitor name is required.", icon: "warning" });
      return;
    }
    try {
      const resident = residents.find(r => r.id === form.residentId);
      await createRecord("front-desk-visits", {
        visitType: form.visitType,
        status: "ARRIVED",
        visitorName: form.visitorName,
        visitorPhone: form.visitorPhone || null,
        idType: form.idType || null,
        idNumber: form.idNumber || null,
        residentId: form.residentId || null,
        roomNumber: form.roomNumber || resident?.roomNumber || null,
        purpose: form.purpose || null,
        arrivalTime: new Date().toISOString(),
      });
      await refetch();
      setShowCreate(false);
      setForm(emptyForm);
      Swal.fire({ title: "Arrival Logged", text: `${form.visitorName} added to the front desk.`, icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not log arrival.", icon: "error" });
    }
  };

  const handleCheckIn = async (v: Visit) => {
    const result = await Swal.fire({
      title: "Check In & Issue Pass",
      html:
        `<p style="font-size:14px;margin-bottom:10px">${v.visitorName} — verify ID and issue a visitor pass:</p>` +
        `<input id="swal-pass" class="swal2-input" placeholder="Visitor pass no." value="${v.visitorPass || `VP-${Math.floor(1000 + (v.id.charCodeAt(0) + v.id.length) % 9000)}`}">`,
      icon: "question", showCancelButton: true,
      confirmButtonColor: "#22c55e", cancelButtonColor: "#6b7280", confirmButtonText: "Check In",
      preConfirm: () => (document.getElementById("swal-pass") as HTMLInputElement | null)?.value ?? "",
    });
    if (!result.isConfirmed) return;
    setBusyId(v.id);
    try {
      await updateRecord("front-desk-visits", v.id, {
        status: "CHECKED_IN",
        visitorPass: String(result.value || "") || null,
        checkInTime: new Date().toISOString(),
      });
      await refetch();
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not check in.", icon: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const handleAncillary = async (v: Visit) => {
    const result = await Swal.fire({
      title: "Add Ancillary Charge",
      html:
        `<p style="font-size:14px;margin-bottom:10px">Guest dining, salon services, café, etc.</p>` +
        `<input id="swal-label" class="swal2-input" placeholder="Description (e.g. Guest lunch)">` +
        `<input id="swal-amount" type="number" min="0" step="0.01" class="swal2-input" placeholder="Amount (₱)">`,
      icon: "question", showCancelButton: true,
      confirmButtonColor: "#f59e0b", cancelButtonColor: "#6b7280", confirmButtonText: "Add Charge",
      preConfirm: () => ({
        label: (document.getElementById("swal-label") as HTMLInputElement | null)?.value ?? "",
        amount: Number((document.getElementById("swal-amount") as HTMLInputElement | null)?.value ?? 0) || 0,
      }),
    });
    if (!result.isConfirmed) return;
    const { label, amount } = (result.value as { label: string; amount: number }) ?? { label: "", amount: 0 };
    if (!label || amount <= 0) return;
    setBusyId(v.id);
    try {
      const items = [...v.ancillary, { label, amount }];
      const total = items.reduce((s, i) => s + i.amount, 0);
      await updateRecord("front-desk-visits", v.id, {
        ancillaryItems: JSON.stringify(items),
        ancillaryTotal: total,
      });
      await refetch();
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not add charge.", icon: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const handleCheckOut = async (v: Visit) => {
    const receiptNo = v.receiptNumber || `RCPT-${Math.floor(1000 + (v.id.charCodeAt(0) + v.id.length) % 9000)}`;
    const itemsHtml = v.ancillary.length
      ? v.ancillary.map(i => `<div style="display:flex;justify-content:space-between;font-size:13px"><span>${i.label}</span><span>₱${i.amount.toLocaleString()}</span></div>`).join("")
      : `<p style="font-size:13px;color:#6b7280">No ancillary charges.</p>`;
    const result = await Swal.fire({
      title: "Check Out & Receipt",
      html:
        `<div style="text-align:left;border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:10px">` +
        `<p style="font-weight:600;margin-bottom:6px">Receipt ${receiptNo}</p>` +
        `<p style="font-size:13px;color:#374151;margin-bottom:8px">${v.visitorName}${v.roomNumber ? ` · Room ${v.roomNumber}` : ""}</p>` +
        itemsHtml +
        `<div style="display:flex;justify-content:space-between;font-weight:700;border-top:1px solid #e5e7eb;margin-top:8px;padding-top:8px"><span>Total</span><span>₱${v.ancillaryTotal.toLocaleString()}</span></div>` +
        `</div>`,
      icon: "success", showCancelButton: true,
      confirmButtonColor: "#22c55e", cancelButtonColor: "#6b7280", confirmButtonText: "Check Out & Issue Receipt",
    });
    if (!result.isConfirmed) return;
    setBusyId(v.id);
    try {
      await updateRecord("front-desk-visits", v.id, {
        status: "CHECKED_OUT",
        checkOutTime: new Date().toISOString(),
        receiptNumber: receiptNo,
      });
      // Ancillary spend on a resident's account posts into the invoice pipeline.
      if (v.residentId && v.ancillaryTotal > 0) {
        await createRecord("service-charges", {
          residentId: v.residentId,
          description: `Front-desk ancillary — ${v.ancillary.map(i => i.label).join(", ")} (${receiptNo})`,
          amount: v.ancillaryTotal,
          serviceDate: new Date().toISOString(),
          category: "Dining Services",
        });
      }
      await refetch();
      Swal.fire({ title: "Checked Out", text: `Receipt ${receiptNo} issued.`, icon: "success", timer: 1600, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not check out.", icon: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (v: Visit) => {
    const confirmed = await Swal.fire({
      title: "Delete Record?", text: `Remove the front-desk record for ${v.visitorName}?`, icon: "warning",
      showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Delete",
    });
    if (!confirmed.isConfirmed) return;
    try {
      await deleteRecord("front-desk-visits", v.id);
      await refetch();
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not delete record.", icon: "error" });
    }
  };

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const value = e.target.value;
    setForm(f => {
      const next = { ...f, [field]: value };
      if (field === "residentId") {
        const r = residents.find(x => x.id === value);
        if (r) next.roomNumber = r.roomNumber;
      }
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Front Desk
          </h1>
          <p className="text-gray-600">Guest management — arrivals · check-in (ID &amp; pass) · ancillary payments · check-out &amp; receipt</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void refetch()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button onClick={() => { setForm(emptyForm); setShowCreate(true); }} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95">
            <Plus className="w-4 h-4" /> Log Arrival
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="On-Site (Checked In)" value={String(stats.onSite)} icon={Users} color="green" />
        <Stat label="Awaiting Check-In" value={String(stats.arriving)} icon={LogIn} color="amber" />
        <Stat label="New Resident Arrivals" value={String(stats.newArrivals)} icon={DoorOpen} color="blue" />
        <Stat label="Ancillary (all)" value={`₱${Math.round(stats.ancillary).toLocaleString()}`} icon={CircleDollarSign} color="purple" />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-center">
        <div className="flex gap-2 flex-wrap">
          {["all", "ARRIVED", "CHECKED_IN", "CHECKED_OUT"].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition border ${
                statusFilter === s ? "bg-yellow-400 text-black border-yellow-400" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
              }`}>
              {s === "all" ? "All" : s.replace(/_/g, " ")}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search visitor, resident, or room…" value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {/* Table */}
      {loading && visits.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading front-desk activity...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">No front-desk records match your filters.</div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Type</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Visitor</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">ID / Pass</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Visiting</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Arrival</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Ancillary</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginated.map(v => {
                const meta = VISIT_TYPE_META[v.visitType] ?? VISIT_TYPE_META.GUEST_VISIT;
                const TypeIcon = meta.icon;
                const busy = busyId === v.id;
                return (
                  <tr key={v.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${meta.cls}`}>
                        <TypeIcon className="w-3 h-3" /> {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{v.visitorName}</p>
                      {v.visitorPhone && <p className="text-xs text-gray-500">{v.visitorPhone}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {v.idType ? <p>{v.idType}{v.idNumber ? ` · ${v.idNumber}` : ""}</p> : <span className="text-gray-400">—</span>}
                      {v.visitorPass && <p className="inline-flex items-center gap-1 text-emerald-600 font-semibold mt-0.5"><BadgeCheck className="w-3 h-3" /> {v.visitorPass}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {v.residentName || v.purpose || "—"}
                      {v.roomNumber && <p className="text-gray-400">Room {v.roomNumber}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{v.arrivalTime ? new Date(v.arrivalTime).toLocaleString() : "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${FRONTDESK_STATUS_PILL[v.status] ?? "bg-gray-100 text-gray-700"}`}>
                        {v.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900 font-medium">
                      {v.ancillaryTotal ? `₱${v.ancillaryTotal.toLocaleString()}` : "—"}
                      {v.receiptNumber && <p className="text-[10px] text-gray-400">{v.receiptNumber}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1 flex-wrap">
                        {busy ? (
                          <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                        ) : (
                          <>
                            <button onClick={() => setViewing(v)} className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition" title="View"><Eye className="w-4 h-4" /></button>
                            {v.status === "ARRIVED" && (
                              <button onClick={() => handleCheckIn(v)} className="p-1.5 rounded hover:bg-green-100 text-green-600 transition" title="Check In & Issue Pass"><LogIn className="w-4 h-4" /></button>
                            )}
                            {v.status === "CHECKED_IN" && (
                              <>
                                <button onClick={() => handleAncillary(v)} className="p-1.5 rounded hover:bg-amber-100 text-amber-600 transition" title="Add Ancillary Charge"><CircleDollarSign className="w-4 h-4" /></button>
                                <button onClick={() => handleCheckOut(v)} className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition" title="Check Out & Receipt"><LogOut className="w-4 h-4" /></button>
                              </>
                            )}
                            {v.status === "CHECKED_OUT" && v.receiptNumber && (
                              <span className="p-1.5 text-gray-400" title={`Receipt ${v.receiptNumber}`}><Receipt className="w-4 h-4" /></span>
                            )}
                            <button onClick={() => handleDelete(v)} className="p-1.5 rounded hover:bg-red-100 text-red-600 transition" title="Delete"><Trash2 className="w-4 h-4" /></button>
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
          <p className="text-xs text-gray-500">{filtered.length} records total</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-sm font-medium text-gray-700">Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {/* View Modal */}
      {viewing && <FrontDeskViewModal visit={viewing} onClose={() => setViewing(null)} />}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
              <h2 className="text-xl font-bold">Log Arrival</h2>
              <button onClick={() => setShowCreate(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Visit Type</label>
                  <select value={form.visitType} onChange={set("visitType")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    {VISIT_TYPES.map(t => <option key={t} value={t}>{VISIT_TYPE_META[t].label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Visitor Name</label>
                  <input type="text" value={form.visitorName} onChange={set("visitorName")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Phone</label>
                  <input type="tel" value={form.visitorPhone} onChange={set("visitorPhone")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">ID Type</label>
                  <select value={form.idType} onChange={set("idType")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    {ID_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">ID Number</label>
                  <input type="text" value={form.idNumber} onChange={set("idNumber")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Visiting Resident (optional)</label>
                  <select value={form.residentId} onChange={set("residentId")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    <option value="">— none —</option>
                    {residents.map(r => <option key={r.id} value={r.id}>{r.name} (Room {r.roomNumber})</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Room</label>
                  <input type="text" value={form.roomNumber} onChange={set("roomNumber")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Purpose</label>
                  <input type="text" value={form.purpose} onChange={set("purpose")} placeholder="e.g. Family visit, tour, move-in" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setShowCreate(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Cancel</button>
              <button onClick={handleCreate} className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">Log Arrival</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ── */

function Stat({ label, value, icon: Icon, color }: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; color: string }) {
  const COLORS: Record<string, string> = {
    blue: "text-blue-600 bg-blue-50 border-blue-200",
    green: "text-green-600 bg-green-50 border-green-200",
    amber: "text-amber-600 bg-amber-50 border-amber-200",
    purple: "text-purple-600 bg-purple-50 border-purple-200",
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

function FrontDeskViewModal({ visit, onClose }: { visit: Visit; onClose: () => void }) {
  const meta = VISIT_TYPE_META[visit.visitType] ?? VISIT_TYPE_META.GUEST_VISIT;

  const fields: [string, string][] = [
    ["Visit Type", meta.label],
    ["Status", visit.status.replace(/_/g, " ")],
    ["Visitor Name", visit.visitorName],
    ["Visitor Phone", visit.visitorPhone || "—"],
    ["ID Type", visit.idType || "—"],
    ["ID Number", visit.idNumber || "—"],
    ["Visitor Pass", visit.visitorPass || "—"],
    ["Visiting Resident", visit.residentName || "—"],
    ["Room", visit.roomNumber || "—"],
    ["Purpose", visit.purpose || "—"],
    ["Arrival Time", visit.arrivalTime ? new Date(visit.arrivalTime).toLocaleString() : "—"],
    ["Check-In Time", visit.checkInTime ? new Date(visit.checkInTime).toLocaleString() : "—"],
    ["Check-Out Time", visit.checkOutTime ? new Date(visit.checkOutTime).toLocaleString() : "—"],
    ["Receipt Number", visit.receiptNumber || "—"],
    ["Notes", visit.notes || "—"],
  ];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
          <h2 className="text-xl font-bold">{visit.visitorName}</h2>
          <button onClick={onClose} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-6 space-y-4">
          {fields.map(([label, value]) => (
            <div key={label} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
              <p className="text-sm font-medium text-gray-900 mt-0.5 whitespace-pre-wrap">{value}</p>
            </div>
          ))}
          {visit.ancillary.length > 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Ancillary Charges</p>
              <div className="space-y-1">
                {visit.ancillary.map((a, i) => (
                  <div key={i} className="flex items-center justify-between text-xs text-gray-700">
                    <span>{a.label}</span>
                    <span className="font-medium">₱{a.amount.toLocaleString()}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs font-bold text-gray-900 border-t border-gray-200 pt-1 mt-1">
                  <span>Total</span>
                  <span>₱{visit.ancillaryTotal.toLocaleString()}</span>
                </div>
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
