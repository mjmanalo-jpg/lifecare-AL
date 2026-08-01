"use client";

import { useState } from "react";
import {
  Calendar, Clock, Activity, CheckCircle2, RefreshCw, Search, Plus, X, Phone,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord } from "@/lib/api";
import {
  useRelative, useNowTs, ReportStat, TabLoading, EmptyState, LiveBadge, FormField,
  type Row,
} from "./shared";

const AVATAR_COLORS = ["bg-blue-100 text-blue-700", "bg-purple-100 text-purple-700", "bg-green-100 text-green-700", "bg-rose-100 text-rose-700", "bg-amber-100 text-amber-700"];
const EMPTY_FORM = { visitorName: "", relationship: "", purpose: "", date: "", phone: "", notes: "" };

/** Appointments & Visits — live visit history and self-service visit requests. */
export default function FamilyAppointments() {
  const { relative, displayName } = useRelative();
  const now = useNowTs();

  const { data: visitRows, loading: visitLoading, refetch: refetchVisits } = useLiveQuery("visits", {
    query: "take=100",
    tables: ["Visit"],
  });

  const [showVisitForm, setShowVisitForm] = useState(false);
  const [savingVisit, setSavingVisit] = useState(false);
  const [visitFilter, setVisitFilter] = useState<"all" | "upcoming" | "past">("all");
  const [visitSearch, setVisitSearch] = useState("");
  const [visitForm, setVisitForm] = useState(EMPTY_FORM);

  const enriched = visitRows.map((v: Row, i: number) => {
    const inTs = v.checkInTime ? new Date(String(v.checkInTime)).getTime() : 0;
    const outTs = v.checkOutTime ? new Date(String(v.checkOutTime)).getTime() : 0;
    const upcoming = inTs > now;
    const name = String(v.visitorName ?? "Guest");
    return {
      id: String(v.id ?? i), name,
      relationship: String(v.relationship ?? ""),
      purpose: String(v.purpose ?? ""),
      phone: String(v.visitorPhone ?? ""),
      notes: String(v.notes ?? ""),
      inTs, outTs, upcoming,
      status: upcoming ? "Scheduled" : outTs ? "Completed" : "Visited",
      durationMin: outTs && inTs ? Math.round((outTs - inTs) / 60000) : 0,
      avatar: AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length],
    };
  });

  const q = visitSearch.trim().toLowerCase();
  const filtered = enriched
    .filter((v) => (visitFilter === "all" ? true : visitFilter === "upcoming" ? v.upcoming : !v.upcoming))
    .filter((v) => !q || v.name.toLowerCase().includes(q) || v.relationship.toLowerCase().includes(q) || v.purpose.toLowerCase().includes(q))
    .sort((a, b) => (a.upcoming && b.upcoming ? a.inTs - b.inTs : b.inTs - a.inTs));

  const monthCount = enriched.filter((v) => { if (!v.inTs || !now) return false; const d = new Date(v.inTs), n = new Date(now); return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear(); }).length;
  const uniqueVisitors = new Set(enriched.map((v) => v.name)).size;
  const statusBadge = (s: string) => s === "Scheduled" ? "bg-blue-100 text-blue-700" : s === "Completed" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700";

  const createVisit = async () => {
    if (!visitForm.visitorName.trim() || !visitForm.date) {
      Swal.fire({ title: "Missing info", text: "Visitor name and date/time are required.", icon: "warning" });
      return;
    }
    if (!relative) { Swal.fire({ title: "No relative linked", icon: "error" }); return; }
    setSavingVisit(true);
    try {
      await createRecord("visits", {
        residentId: relative.id,
        visitorName: visitForm.visitorName.trim(),
        relationship: visitForm.relationship.trim() || null,
        purpose: visitForm.purpose.trim() || null,
        visitorPhone: visitForm.phone.trim() || null,
        notes: visitForm.notes.trim() || null,
        checkInTime: new Date(visitForm.date).toISOString(),
      });
      await refetchVisits();
      setShowVisitForm(false);
      setVisitForm(EMPTY_FORM);
      Swal.fire({ title: "Visit Requested", icon: "success", timer: 1400, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Request Failed", text: err instanceof Error ? err.message : "Could not save visit.", icon: "error" });
    } finally {
      setSavingVisit(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <Calendar className="w-6 h-6 text-purple-500 flex-shrink-0" /> Appointments &amp; Visits
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm mt-1">
            <LiveBadge />
            Visits with {displayName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void refetchVisits()} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium"><RefreshCw className="w-4 h-4" /> Refresh</button>
          <button onClick={() => { setVisitForm(EMPTY_FORM); setShowVisitForm(true); }} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-purple-600 text-white font-semibold rounded-lg hover:shadow-lg transition text-sm"><Plus className="w-4 h-4" /> Request Visit</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <ReportStat label="Total Visits" value={enriched.length} icon={Calendar} tone="gray" />
        <ReportStat label="Upcoming" value={enriched.filter((v) => v.upcoming).length} icon={Clock} tone="blue" />
        <ReportStat label="This Month" value={monthCount} icon={CheckCircle2} tone="green" />
        <ReportStat label="Visitors" value={uniqueVisitors} icon={Activity} tone="rose" />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden bg-white self-start">
          {(["all", "upcoming", "past"] as const).map((f) => (
            <button key={f} onClick={() => setVisitFilter(f)} className={`px-4 py-2 text-sm font-medium capitalize transition ${visitFilter === f ? "bg-purple-500 text-white" : "text-gray-700 hover:bg-gray-50"}`}>{f}</button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
          <input type="text" placeholder="Search visitor, relationship, purpose…" value={visitSearch} onChange={(e) => setVisitSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none" />
        </div>
      </div>

      {/* List */}
      {visitLoading && visitRows.length === 0 ? (
        <TabLoading label="Loading appointments..." />
      ) : filtered.length === 0 ? (
        <EmptyState message={visitRows.length === 0 ? "No visits recorded yet. Request the first one." : "No visits match your filters."} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((v) => (
            <div key={v.id} className={`bg-white rounded-lg border p-4 ${v.upcoming ? "border-purple-200" : "border-gray-200"}`}>
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold flex-shrink-0 ${v.avatar}`}>{v.name.charAt(0).toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-gray-900 truncate">{v.name}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0 ${statusBadge(v.status)}`}>{v.status}</span>
                  </div>
                  {v.relationship && <p className="text-xs text-gray-600">{v.relationship}</p>}
                </div>
              </div>
              <div className="mt-3 space-y-1.5 text-sm">
                <p className="flex items-center gap-2 text-gray-700"><Clock className="w-4 h-4 text-gray-400 flex-shrink-0" /> {v.inTs ? new Date(v.inTs).toLocaleString() : "—"}</p>
                {v.purpose && <p className="flex items-center gap-2 text-gray-700"><Activity className="w-4 h-4 text-gray-400 flex-shrink-0" /> {v.purpose}</p>}
                {v.durationMin > 0 && <p className="flex items-center gap-2 text-gray-500 text-xs"><CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" /> {v.durationMin >= 60 ? `${Math.floor(v.durationMin / 60)}h ${v.durationMin % 60}m` : `${v.durationMin}m`} visit</p>}
                {v.phone && <p className="flex items-center gap-2 text-gray-500 text-xs"><Phone className="w-4 h-4 text-gray-400 flex-shrink-0" /> {v.phone}</p>}
              </div>
              {v.notes && <p className="mt-2 text-xs text-gray-600 p-2 bg-gray-50 rounded border-l-2 border-purple-300">📝 {v.notes}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Request Visit modal */}
      {showVisitForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-purple-500 to-purple-600 text-white p-5 flex items-center justify-between">
              <h2 className="text-xl font-bold">Request a Visit</h2>
              <button onClick={() => setShowVisitForm(false)} className="p-2 hover:bg-white/10 rounded-lg transition"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="Visitor Name *"><input type="text" value={visitForm.visitorName} onChange={(e) => setVisitForm((f) => ({ ...f, visitorName: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-purple-400 outline-none" /></FormField>
                <FormField label="Relationship"><input type="text" value={visitForm.relationship} onChange={(e) => setVisitForm((f) => ({ ...f, relationship: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-purple-400 outline-none" /></FormField>
              </div>
              <FormField label="Date &amp; Time *"><input type="datetime-local" value={visitForm.date} onChange={(e) => setVisitForm((f) => ({ ...f, date: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-purple-400 outline-none" /></FormField>
              <FormField label="Purpose"><input type="text" value={visitForm.purpose} onChange={(e) => setVisitForm((f) => ({ ...f, purpose: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-purple-400 outline-none" /></FormField>
              <FormField label="Phone"><input type="text" value={visitForm.phone} onChange={(e) => setVisitForm((f) => ({ ...f, phone: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-purple-400 outline-none" /></FormField>
              <FormField label="Notes"><textarea value={visitForm.notes} onChange={(e) => setVisitForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-purple-400 outline-none resize-y" /></FormField>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setShowVisitForm(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Cancel</button>
              <button onClick={() => void createVisit()} disabled={savingVisit} className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-purple-500 to-purple-600 text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-60"><Plus className="w-4 h-4" /> {savingVisit ? "Saving…" : "Request Visit"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
