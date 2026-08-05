"use client";

import RefreshButton from "@/components/portal/RefreshButton";

import { useMemo, useState, useEffect } from "react";
import {
  Stethoscope, Search, RefreshCw, Plus, X, CheckCircle2, Trash2, Loader2,
  Send, Inbox, Eye, ChevronLeft, ChevronRight, UserRound, Clock, type LucideIcon,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";
import { useClinician } from "@/components/portal/views/clinical/useClinician";

/**
 * Physician Consults & Referrals — outbound specialist referrals the physician
 * raises, and inbound consult requests the care team logs for the physician to
 * answer. Backed by MedicalNote (noteType CONSULTATION | REFERRAL); a resolved
 * item is co-signed by the physician. Live via Supabase realtime + polling,
 * with search, filters, pagination and a responsive detail modal.
 */

type Row = Record<string, unknown>;
const asStr = (v: unknown): string => (v == null ? "" : String(v));

const KIND_META: Record<string, { label: string; icon: LucideIcon; cls: string }> = {
  CONSULTATION: { label: "Consult", icon: Inbox, cls: "bg-teal-100 text-teal-700" },
  REFERRAL: { label: "Referral", icon: Send, cls: "bg-indigo-100 text-indigo-700" },
};

type ConsultVM = {
  id: string; residentId: string; kind: string; title: string; content: string;
  authorName: string; resolvedBy: string; resolvedAt: string; createdAt: string;
};

const PER_PAGE = 8;

export default function PhysicianConsults() {
  const clinician = useClinician("PHYSICIAN");
  const residentsQ = useLiveQuery<Row>("residents", { query: "take=300", tables: ["Resident"] });
  const notesQ = useLiveQuery<Row>("medical-notes", { query: "take=600", tables: ["MedicalNote"] });

  const residents = useMemo(() => residentsQ.data.map(adaptResident), [residentsQ.data]);
  const nameById = useMemo(() => new Map(residents.map((r) => [r.id, r])), [residents]);

  const [kindFilter, setKindFilter] = useState<"all" | "CONSULTATION" | "REFERRAL">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "resolved">("open");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [viewing, setViewing] = useState<ConsultVM | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const items = useMemo<ConsultVM[]>(() => notesQ.data
    .filter((n) => n.noteType === "CONSULTATION" || n.noteType === "REFERRAL")
    .map((n) => ({
      id: asStr(n.id), residentId: asStr(n.residentId), kind: asStr(n.noteType),
      title: asStr(n.title), content: asStr(n.content), authorName: asStr(n.authorName),
      resolvedBy: asStr(n.coSignedBy), resolvedAt: asStr(n.coSignedAt), createdAt: asStr(n.createdAt),
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [notesQ.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (kindFilter !== "all" && i.kind !== kindFilter) return false;
      if (statusFilter === "open" && i.resolvedBy) return false;
      if (statusFilter === "resolved" && !i.resolvedBy) return false;
      if (q && !i.title.toLowerCase().includes(q) && !i.content.toLowerCase().includes(q) && !(nameById.get(i.residentId)?.name ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, kindFilter, statusFilter, search, nameById]);

  // Reset to first page whenever the result set changes.
  useEffect(() => { setPage(1); }, [kindFilter, statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const pageClamped = Math.min(page, totalPages);
  const paginated = filtered.slice((pageClamped - 1) * PER_PAGE, pageClamped * PER_PAGE);

  const stats = useMemo(() => ({
    openConsults: items.filter((i) => i.kind === "CONSULTATION" && !i.resolvedBy).length,
    openReferrals: items.filter((i) => i.kind === "REFERRAL" && !i.resolvedBy).length,
    resolved: items.filter((i) => i.resolvedBy).length,
  }), [items]);

  const resolve = async (id: string) => {
    setBusyId(id);
    try {
      await updateRecord("medical-notes", id, { coSignedBy: clinician.name, coSignedAt: new Date().toISOString() });
      await notesQ.refetch();
      setViewing((v) => (v && v.id === id ? { ...v, resolvedBy: clinician.name, resolvedAt: new Date().toISOString() } : v));
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not resolve.", icon: "error" });
    } finally { setBusyId(null); }
  };

  const remove = async (id: string) => {
    const c = await Swal.fire({ title: "Delete?", icon: "warning", showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Delete" });
    if (!c.isConfirmed) return;
    try { await deleteRecord("medical-notes", id); await notesQ.refetch(); setViewing((v) => (v && v.id === id ? null : v)); }
    catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not delete.", icon: "error" }); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-1 flex items-center gap-2">
            <Stethoscope className="w-7 h-7 text-yellow-500 flex-shrink-0" /> Consults &amp; Referrals
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live</span>
            Answer care-team consult requests &amp; raise specialist referrals
          </p>
        </div>
        <div className="flex items-center gap-2 self-start">
          <RefreshButton onRefresh={() => notesQ.refetch()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium" />
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">
            <Plus className="w-4 h-4" /> New Referral / Consult
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Open Consults" value={stats.openConsults} icon={Inbox} tone="teal" />
        <Stat label="Open Referrals" value={stats.openReferrals} icon={Send} tone="indigo" />
        <Stat label="Resolved" value={stats.resolved} icon={CheckCircle2} tone="green" />
      </div>

      {/* Filters + search */}
      <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
        <div className="flex gap-2 flex-wrap">
          {(["open", "resolved", "all"] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition border ${statusFilter === s ? "bg-yellow-400 text-black border-yellow-400" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
              {s === "open" ? "Open" : s === "resolved" ? "Resolved" : "All"}
            </button>
          ))}
          <span className="w-px bg-gray-200 mx-1 hidden sm:block" />
          {(["all", "CONSULTATION", "REFERRAL"] as const).map((k) => (
            <button key={k} onClick={() => setKindFilter(k)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition border ${kindFilter === k ? "bg-yellow-400 text-black border-yellow-400" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
              {k === "all" ? "All Types" : KIND_META[k].label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search subject, patient, or details…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
        </div>
      </div>

      {/* List */}
      {notesQ.loading && items.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">No {statusFilter !== "all" ? statusFilter : ""} consults or referrals.</div>
      ) : (
        <div className="space-y-2">
          {paginated.map((i) => {
            const meta = KIND_META[i.kind] ?? KIND_META.CONSULTATION;
            const Icon = meta.icon; const r = nameById.get(i.residentId); const busy = busyId === i.id;
            return (
              <div key={i.id} className="bg-white rounded-lg border border-gray-200 hover:border-yellow-300 hover:shadow-md transition p-4">
                <div className="flex items-start justify-between gap-3">
                  <button onClick={() => setViewing(i)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${meta.cls}`}><Icon className="w-3 h-3" /> {meta.label}</span>
                      <h3 className="font-semibold text-gray-900 text-sm">{i.title}</h3>
                      {i.resolvedBy && <span className="inline-flex items-center gap-1 text-[11px] text-green-600 font-semibold"><CheckCircle2 className="w-3 h-3" /> Resolved</span>}
                    </div>
                    <p className="text-xs text-gray-500">{r?.name ?? "Unknown"} · Room {r?.room ?? "—"} · raised by {i.authorName || "care team"}</p>
                    {i.content && <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap line-clamp-2">{i.content}</p>}
                  </button>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => setViewing(i)} className="p-1.5 rounded hover:bg-blue-50 text-blue-600 transition" title="View"><Eye className="w-4 h-4" /></button>
                    {!i.resolvedBy && (busy ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" /> : (
                      <button onClick={() => resolve(i.id)} className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition"><CheckCircle2 className="w-3.5 h-3.5" /> Resolve</button>
                    ))}
                    <button onClick={() => remove(i.id)} className="p-1.5 rounded hover:bg-red-100 text-red-500 transition" title="Delete"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {filtered.length > PER_PAGE && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm text-gray-600">
            {(pageClamped - 1) * PER_PAGE + 1}–{Math.min(pageClamped * PER_PAGE, filtered.length)} of {filtered.length}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pageClamped === 1}
              className="flex items-center gap-1 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm font-medium">
              <ChevronLeft className="w-4 h-4" /> Prev
            </button>
            <span className="px-3 py-2 text-sm font-medium text-gray-700">Page {pageClamped} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={pageClamped === totalPages}
              className="flex items-center gap-1 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm font-medium">
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Responsive detail modal */}
      {viewing && (() => {
        const meta = KIND_META[viewing.kind] ?? KIND_META.CONSULTATION;
        const Icon = meta.icon; const r = nameById.get(viewing.residentId); const busy = busyId === viewing.id;
        return (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
              <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-blue-600 text-white p-5 flex items-start justify-between gap-3 z-10">
                <div className="min-w-0">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${meta.cls}`}><Icon className="w-3 h-3" /> {meta.label}</span>
                  <h2 className="text-lg sm:text-xl font-bold mt-1 break-words">{viewing.title}</h2>
                </div>
                <button onClick={() => setViewing(null)} className="p-2 hover:bg-white/20 rounded-lg transition flex-shrink-0"><X className="w-6 h-6" /></button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div><p className="text-xs font-semibold text-gray-500 mb-0.5 flex items-center gap-1"><UserRound className="w-3.5 h-3.5" /> Patient</p><p className="text-gray-900">{r?.name ?? "Unknown"}</p><p className="text-xs text-gray-400">Room {r?.room ?? "—"}</p></div>
                  <div><p className="text-xs font-semibold text-gray-500 mb-0.5 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Raised</p><p className="text-gray-900">{viewing.authorName || "Care team"}</p><p className="text-xs text-gray-400">{viewing.createdAt ? new Date(viewing.createdAt).toLocaleString() : "—"}</p></div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">Clinical question / details</p>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <p className="text-sm text-gray-900 whitespace-pre-wrap">{viewing.content || "—"}</p>
                  </div>
                </div>
                {viewing.resolvedBy ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> Resolved by {viewing.resolvedBy}{viewing.resolvedAt ? ` · ${new Date(viewing.resolvedAt).toLocaleString()}` : ""}
                  </div>
                ) : (
                  <p className="text-xs text-amber-600 font-semibold">Awaiting physician response</p>
                )}
              </div>
              <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between gap-2 flex-wrap">
                <button onClick={() => remove(viewing.id)} className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 border border-red-200 font-semibold rounded-lg hover:bg-red-100 transition text-sm">
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
                {!viewing.resolvedBy && (
                  <button onClick={() => resolve(viewing.id)} disabled={busy}
                    className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-green-400 to-green-500 text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50 text-sm">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Resolve &amp; Co-sign
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {showAdd && (
        <AddConsultModal residents={residents.map((r) => ({ id: r.id, name: r.name, room: r.room }))} authorName={clinician.name}
          onClose={() => setShowAdd(false)} onSaved={() => { void notesQ.refetch(); setShowAdd(false); }} />
      )}
    </div>
  );
}

function AddConsultModal({ residents, authorName, onClose, onSaved }: {
  residents: { id: string; name: string; room: string }[]; authorName: string; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({ residentId: "", noteType: "REFERRAL", title: "", content: "" });
  const [saving, setSaving] = useState(false);
  const valid = form.residentId && form.title.trim();
  const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      await createRecord("medical-notes", {
        residentId: form.residentId, title: form.title.trim(), content: form.content.trim() || form.title.trim(),
        noteType: form.noteType, authorName,
      });
      Swal.fire({ title: "Created", icon: "success", timer: 1300, showConfirmButton: false });
      onSaved();
    } catch (err) {
      setSaving(false);
      Swal.fire({ title: "Save Failed", text: err instanceof Error ? err.message : "Could not save.", icon: "error" });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
          <h2 className="text-xl font-bold">New Consult / Referral</h2>
          <button onClick={onClose} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Patient <span className="text-red-500">*</span></label>
                <select value={form.residentId} onChange={(e) => setForm((f) => ({ ...f, residentId: e.target.value }))} className={inputCls}>
                  <option value="">Select…</option>
                  {residents.map((r) => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Type</label>
                <select value={form.noteType} onChange={(e) => setForm((f) => ({ ...f, noteType: e.target.value }))} className={inputCls}>
                  <option value="REFERRAL">Specialist Referral</option>
                  <option value="CONSULTATION">Consult Request</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Subject <span className="text-red-500">*</span></label>
              <input type="text" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Cardiology referral — arrhythmia workup" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Clinical question / details</label>
              <textarea value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} rows={5} className={`${inputCls} resize-y`} />
            </div>
          </div>
          <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
            <button type="button" onClick={onClose} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Cancel</button>
            <button type="submit" disabled={!valid || saving}
              className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50">
              <Send className="w-4 h-4" /> {saving ? "Saving…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const TONES: Record<string, { wrap: string; icon: string; value: string }> = {
  teal: { wrap: "bg-teal-50 border-teal-200", icon: "text-teal-500", value: "text-teal-600" },
  indigo: { wrap: "bg-indigo-50 border-indigo-200", icon: "text-indigo-500", value: "text-indigo-600" },
  green: { wrap: "bg-green-50 border-green-200", icon: "text-green-500", value: "text-green-600" },
};
function Stat({ label, value, icon: Icon, tone }: { label: string; value: number; icon: LucideIcon; tone: keyof typeof TONES }) {
  const t = TONES[tone];
  return (
    <div className={`p-4 rounded-lg border ${t.wrap}`}>
      <div className="flex items-center justify-between"><p className="text-xs sm:text-sm text-gray-600 font-semibold">{label}</p><Icon className={`w-4 h-4 ${t.icon}`} /></div>
      <p className={`text-2xl sm:text-3xl font-bold mt-1 ${t.value}`}>{value}</p>
    </div>
  );
}
