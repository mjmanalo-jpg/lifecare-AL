"use client";

import { useMemo, useState, useEffect } from "react";
import {
  Pill, Search, X, Plus, RefreshCw, CheckCircle2, AlertTriangle,
  Eye, Trash2, PauseCircle, PlayCircle, Ban, Clock, UserRound,
  Stethoscope, type LucideIcon,
} from "lucide-react";
import Swal from "sweetalert2";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident, humanize } from "@/lib/adapters";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";

type MedStatus = "ACTIVE" | "DISCONTINUED" | "PENDING" | "ON_HOLD";
interface MedVM {
  id: string; residentId: string; residentName: string; room: string;
  name: string; dosage: string; frequency: string; route: string;
  status: MedStatus; startDate: string | null; endDate: string | null;
  prescribedBy: string; reason: string; sideEffects: string; contraindications: string;
}

const STATUS_BADGE: Record<MedStatus, string> = {
  ACTIVE: "bg-green-100 text-green-800 border-green-300",
  PENDING: "bg-blue-100 text-blue-800 border-blue-300",
  ON_HOLD: "bg-amber-100 text-amber-800 border-amber-300",
  DISCONTINUED: "bg-gray-200 text-gray-600 border-gray-300",
};
const STATUS_ORDER: MedStatus[] = ["ACTIVE", "PENDING", "ON_HOLD", "DISCONTINUED"];
const ROUTES = ["oral", "injection", "IV", "topical", "inhalation", "sublingual", "transdermal"];
const FREQUENCIES = ["Daily", "Twice daily", "Three times daily", "Four times daily", "Every 12 hours", "At bedtime", "PRN (as needed)"];

const asStr = (v: unknown): string => (v == null ? "" : String(v));

export default function PhysicianOrders() {
  const { data: medRows, loading, error, refetch } = useLiveQuery<Record<string, unknown>>(
    "medications", { query: "include=resident&take=500", tables: ["Medication"] }
  );
  const { data: residentRows, refetch: refetchResidents } = useLiveQuery<Record<string, unknown>>(
    "residents", { query: "take=300", tables: ["Resident"] }
  );

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | MedStatus>("all");
  const [viewing, setViewing] = useState<MedVM | null>(null);
  const [adding, setAdding] = useState(false);

  const residents = useMemo(() => residentRows.map(adaptResident), [residentRows]);
  const residentById = useMemo(() => new Map(residents.map((r) => [r.id, r])), [residents]);

  const meds = useMemo<MedVM[]>(() => medRows.map((row) => {
    const rel = row.resident as { firstName?: string; lastName?: string; roomNumber?: string } | undefined;
    const joined = residentById.get(String(row.residentId ?? ""));
    return {
      id: String(row.id), residentId: asStr(row.residentId),
      residentName: rel ? `${rel.firstName ?? ""} ${rel.lastName ?? ""}`.trim() : joined?.name ?? "Unknown",
      room: rel?.roomNumber ?? joined?.room ?? "—",
      name: asStr(row.name), dosage: asStr(row.dosage), frequency: asStr(row.frequency) || "Daily",
      route: asStr(row.route) || "oral",
      status: (STATUS_ORDER.includes(row.status as MedStatus) ? row.status : "ACTIVE") as MedStatus,
      startDate: row.startDate ? String(row.startDate) : null,
      endDate: row.endDate ? String(row.endDate) : null,
      prescribedBy: asStr(row.prescribedBy), reason: asStr(row.reason),
      sideEffects: asStr(row.sideEffects), contraindications: asStr(row.contraindications),
    };
  }), [medRows, residentById]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return meds.filter((m) => {
      if (q && !m.name.toLowerCase().includes(q) && !m.residentName.toLowerCase().includes(q) && !m.room.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && m.status !== statusFilter) return false;
      return true;
    }).sort((a, b) => a.residentName.localeCompare(b.residentName) || a.name.localeCompare(b.name));
  }, [meds, search, statusFilter]);

  const stats = useMemo(() => ({
    total: meds.length,
    active: meds.filter((m) => m.status === "ACTIVE").length,
    onHold: meds.filter((m) => m.status === "ON_HOLD" || m.status === "PENDING").length,
    discontinued: meds.filter((m) => m.status === "DISCONTINUED").length,
  }), [meds]);

  const refreshAll = () => { void refetch(); void refetchResidents(); };

  const handleStatus = async (m: MedVM, status: MedStatus, verb: string) => {
    const result = await Swal.fire({
      title: `${verb} Medication?`, text: `${m.name} ${m.dosage} for ${m.residentName}`,
      icon: "warning", showCancelButton: true,
      confirmButtonColor: status === "DISCONTINUED" ? "#ef4444" : "#f59e0b",
      cancelButtonColor: "#6b7280", confirmButtonText: verb,
    });
    if (!result.isConfirmed) return;
    try {
      await updateRecord("medications", m.id, {
        status, ...(status === "DISCONTINUED" ? { endDate: new Date().toISOString() } : {}),
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
      title: "Delete Order?", text: `${m.name} ${m.dosage} for ${m.residentName} will be permanently removed.`,
      icon: "warning", showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Delete",
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent mb-1 flex items-center gap-2">
            <Pill className="w-7 h-7 text-yellow-500 flex-shrink-0" /> Orders &amp; Prescriptions
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live</span>
            Manage prescriptions, review active orders, and track administration
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={refreshAll} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button onClick={() => setAdding(true)} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">
            <Plus className="w-4 h-4" /> New Order
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Stat label="Total Orders" value={stats.total} icon={Pill} tone="gray" />
        <Stat label="Active" value={stats.active} icon={CheckCircle2} tone="green" />
        <Stat label="On Hold / Pending" value={stats.onHold} icon={PauseCircle} tone="amber" />
        <Stat label="Discontinued" value={stats.discontinued} icon={Ban} tone="red" />
      </div>

      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
          <input type="text" placeholder="Search by medication, resident, or room..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(["all", ...STATUS_ORDER] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${statusFilter === s ? "bg-yellow-400 text-black" : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"}`}>
              {s === "all" ? "All" : humanize(s)}
            </button>
          ))}
          <span className="text-sm text-gray-500 ml-auto">{filtered.length} orders</span>
        </div>
      </div>

      {loading && meds.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">Loading orders...</div>
      ) : error ? (
        <div className="bg-white rounded-lg border border-red-200 p-10 text-center text-red-600">Failed to load: {error}</div>
      ) : filtered.length > 0 ? (
        <div className="space-y-2">
          {filtered.map((m) => (
            <div key={m.id} className="bg-white rounded-lg border border-gray-200 hover:border-yellow-300 hover:shadow-md transition p-4 flex items-center gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-gray-900 truncate">💊 {m.name}</h3>
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${STATUS_BADGE[m.status]}`}>{humanize(m.status)}</span>
                </div>
                <p className="text-sm text-gray-600 flex items-center gap-1 mt-0.5"><UserRound className="w-3.5 h-3.5 text-gray-400" /> {m.residentName} &middot; Room {m.room}</p>
                <p className="text-xs text-gray-500 mt-0.5">{m.dosage} &middot; {m.frequency} &middot; {m.route}{m.prescribedBy ? ` &middot; Rx: ${m.prescribedBy}` : ""}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0 flex-wrap">
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
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">
          {meds.length === 0 ? "No orders on file. Create the first prescription." : "No orders match your filters."}
        </div>
      )}

      {/* View Modal */}
      {viewing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black p-5 sm:p-6 flex items-center justify-between z-10">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold">💊 {viewing.name} {viewing.dosage}</h2>
                <p className="text-yellow-900/70 text-sm">{viewing.residentName} &middot; Room {viewing.room}</p>
              </div>
              <button onClick={() => setViewing(null)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`px-3 py-1 rounded-full text-sm font-bold border ${STATUS_BADGE[viewing.status]}`}>{humanize(viewing.status)}</span>
                <span className="px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-700 capitalize">{viewing.route}</span>
                <span className="px-3 py-1 rounded-full text-sm font-medium bg-blue-50 text-blue-700">{viewing.frequency}</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-sm font-semibold text-gray-600 mb-1">Start Date</p><p className="text-gray-900 text-sm">{viewing.startDate ? new Date(viewing.startDate).toLocaleDateString() : "—"}</p></div>
                <div><p className="text-sm font-semibold text-gray-600 mb-1">End Date</p><p className="text-gray-900 text-sm">{viewing.endDate ? new Date(viewing.endDate).toLocaleDateString() : "Ongoing"}</p></div>
                <div><p className="text-sm font-semibold text-gray-600 mb-1">Prescribed By</p><p className="text-gray-900 text-sm">{viewing.prescribedBy || "—"}</p></div>
                <div><p className="text-sm font-semibold text-gray-600 mb-1">Reason</p><p className="text-gray-900 text-sm">{viewing.reason || "—"}</p></div>
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
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between gap-2">
              <button onClick={() => setViewing(null)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Close</button>
              {viewing.status !== "DISCONTINUED" && (
                <button onClick={() => void handleStatus(viewing, "DISCONTINUED", "Discontinue")}
                  className="flex items-center gap-2 px-5 py-2 bg-red-50 text-red-600 border border-red-200 font-semibold rounded-lg hover:bg-red-100 transition">
                  <Ban className="w-4 h-4" /> Discontinue
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Order Modal */}
      {adding && (
        <AddOrderModal residents={residents.map((r) => ({ id: r.id, name: r.name, room: r.room }))}
          onClose={() => setAdding(false)} onSaved={() => { void refetch(); setAdding(false); }} />
      )}
    </div>
  );
}

interface MedForm {
  residentId: string; name: string; dosage: string; frequency: string;
  route: string; status: MedStatus; startDate: string; endDate: string;
  prescribedBy: string; reason: string; sideEffects: string; contraindications: string;
}

function AddOrderModal({ residents, onClose, onSaved }: {
  residents: { id: string; name: string; room: string }[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<MedForm>({
    residentId: "", name: "", dosage: "", frequency: "Daily",
    route: "oral", status: "ACTIVE", startDate: new Date().toISOString().slice(0, 10), endDate: "",
    prescribedBy: "Dr. Alan Reyes", reason: "", sideEffects: "", contraindications: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (key: keyof MedForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const valid = form.residentId && form.name.trim() && form.dosage.trim();
  const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none text-sm";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      await createRecord("medications", {
        residentId: form.residentId, name: form.name.trim(), dosage: form.dosage.trim(),
        frequency: form.frequency, route: form.route, status: form.status,
        startDate: new Date(form.startDate).toISOString(),
        endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
        prescribedBy: form.prescribedBy.trim() || null, reason: form.reason.trim() || null,
        sideEffects: form.sideEffects.trim() || null, contraindications: form.contraindications.trim() || null,
      });
      Swal.fire({ title: "Order Created", icon: "success", timer: 1400, showConfirmButton: false });
      onSaved();
    } catch (err) {
      setSaving(false);
      Swal.fire({ title: "Save Failed", text: err instanceof Error ? err.message : "Could not create order.", icon: "error" });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black p-5 sm:p-6 flex items-center justify-between z-10">
          <div><h2 className="text-xl sm:text-2xl font-bold">New Prescription Order</h2><p className="text-yellow-900/70 text-sm">Create a new medication order for a patient</p></div>
          <button onClick={onClose} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Patient <span className="text-red-500">*</span></label>
              <select value={form.residentId} onChange={set("residentId")} className={inputCls}>
                <option value="">Select patient...</option>
                {residents.map((r) => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className="block text-sm font-semibold text-gray-700 mb-1">Medication <span className="text-red-500">*</span></label><input type="text" value={form.name} onChange={set("name")} placeholder="Lisinopril" className={inputCls} /></div>
              <div><label className="block text-sm font-semibold text-gray-700 mb-1">Dosage <span className="text-red-500">*</span></label><input type="text" value={form.dosage} onChange={set("dosage")} placeholder="10mg" className={inputCls} /></div>
              <div><label className="block text-sm font-semibold text-gray-700 mb-1">Frequency</label><select value={form.frequency} onChange={set("frequency")} className={inputCls}>{FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}</select></div>
              <div><label className="block text-sm font-semibold text-gray-700 mb-1">Route</label><select value={form.route} onChange={set("route")} className={inputCls}>{ROUTES.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
              <div><label className="block text-sm font-semibold text-gray-700 mb-1">Start Date</label><input type="date" value={form.startDate} onChange={set("startDate")} className={inputCls} /></div>
              <div><label className="block text-sm font-semibold text-gray-700 mb-1">End Date</label><input type="date" value={form.endDate} onChange={set("endDate")} min={form.startDate} className={inputCls} /></div>
            </div>
            <div><label className="block text-sm font-semibold text-gray-700 mb-1">Reason / Indication</label><input type="text" value={form.reason} onChange={set("reason")} placeholder="Hypertension management" className={inputCls} /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className="block text-sm font-semibold text-gray-700 mb-1">Side Effects</label><textarea value={form.sideEffects} onChange={set("sideEffects")} rows={2} placeholder="Dizziness, dry cough..." className={`${inputCls} resize-y`} /></div>
              <div><label className="block text-sm font-semibold text-gray-700 mb-1">Contraindications</label><textarea value={form.contraindications} onChange={set("contraindications")} rows={2} placeholder="Avoid with NSAIDs..." className={`${inputCls} resize-y`} /></div>
            </div>
          </div>
          <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between gap-2">
            <button type="button" onClick={onClose} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Cancel</button>
            <button type="submit" disabled={!valid || saving}
              className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed">
              <Plus className="w-4 h-4" /> {saving ? "Saving..." : "Create Order"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const TONES: Record<string, { wrap: string; icon: string; value: string }> = {
  gray: { wrap: "bg-white border-gray-200", icon: "text-gray-500", value: "text-gray-900" },
  green: { wrap: "bg-green-50 border-green-200", icon: "text-green-500", value: "text-green-600" },
  amber: { wrap: "bg-amber-50 border-amber-200", icon: "text-amber-500", value: "text-amber-600" },
  red: { wrap: "bg-red-50 border-red-200", icon: "text-red-500", value: "text-red-600" },
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
