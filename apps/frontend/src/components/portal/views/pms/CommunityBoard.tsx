"use client";

import { useMemo, useState } from "react";
import {
  RefreshCw, Plus, X, Trash2, CalendarDays, Megaphone, UtensilsCrossed,
  Users, CheckCircle2, Ban, Loader2, Pin, Play, Search, ChevronLeft, ChevronRight, Eye,
} from "lucide-react";
import Swal from "sweetalert2";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";
import {
  EVENT_CATEGORY_META, DINING_STATUS_PILL, ANNOUNCEMENT_PRIORITY_PILL,
} from "./pmsMeta";

/**
 * Resident & Family Engagement — staff management (Phase 7 PMS). Live via
 * Supabase realtime + polling. One board, three sub-views: community calendar
 * (events + RSVPs), dining reservations, and automated announcements.
 */

type Row = Record<string, unknown>;
const rel = (v: unknown): Row => (v && typeof v === "object" ? (v as Row) : {});
const residentName = (r: Row) => `${String(rel(r.resident).firstName ?? "")} ${String(rel(r.resident).lastName ?? "")}`.trim() || "—";

const EVENT_CATEGORIES = Object.keys(EVENT_CATEGORY_META);
const SUBTABS = [
  { key: "events", label: "Community Calendar", icon: CalendarDays },
  { key: "dining", label: "Dining Reservations", icon: UtensilsCrossed },
  { key: "announcements", label: "Announcements", icon: Megaphone },
];

const eventForm0 = { title: "", category: "SOCIAL", description: "", location: "", startTime: "", capacity: "", host: "" };
const annForm0 = { title: "", body: "", audience: "ALL", priority: "NORMAL", pinned: false };

export default function CommunityBoard() {
  const [subtab, setSubtab] = useState("events");

  const eventsQ = useLiveQuery<Row>("community-events", { query: "include=attendances&take=300", tables: ["CommunityEvent", "EventAttendance"] });
  const diningQ = useLiveQuery<Row>("dining-reservations", { query: "include=resident&take=300", tables: ["DiningReservation"] });
  const annQ = useLiveQuery<Row>("announcements", { query: "take=200", tables: ["Announcement"] });

  const [showEvent, setShowEvent] = useState(false);
  const [eventForm, setEventForm] = useState(eventForm0);
  const [showAnn, setShowAnn] = useState(false);
  const [annForm, setAnnForm] = useState(annForm0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ type: string; data: Row } | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const perPage = 10;

  const events = useMemo(
    () => [...eventsQ.data].sort((a, b) => new Date(String(a.startTime)).getTime() - new Date(String(b.startTime)).getTime()),
    [eventsQ.data]
  );

  /* ── Search + Pagination ── */
  const q = search.trim().toLowerCase();

  const filteredEvents = useMemo(() =>
    events.filter(e => !q || String(e.title).toLowerCase().includes(q) || String(e.location ?? "").toLowerCase().includes(q) || String(e.category).toLowerCase().includes(q)),
    [events, q]
  );

  const filteredDining = useMemo(() =>
    diningQ.data.filter(d => !q || residentName(d).toLowerCase().includes(q) || String(d.mealType).toLowerCase().includes(q) || String(d.venue ?? "").toLowerCase().includes(q)),
    [diningQ.data, q]
  );

  const filteredAnn = useMemo(() =>
    annQ.data.filter(a => !q || String(a.title).toLowerCase().includes(q) || String(a.body).toLowerCase().includes(q) || String(a.audience).toLowerCase().includes(q)),
    [annQ.data, q]
  );

  const activeList = subtab === "events" ? filteredEvents : subtab === "dining" ? filteredDining : filteredAnn;
  const totalPages = Math.max(1, Math.ceil(activeList.length / perPage));
  const paginatedList = activeList.slice((page - 1) * perPage, page * perPage);
  const paginatedEvents = subtab === "events" ? paginatedList : filteredEvents;
  const paginatedDining = subtab === "dining" ? paginatedList : filteredDining;
  const paginatedAnn = subtab === "announcements" ? paginatedList : filteredAnn;

  /* ── Events ── */
  const createEvent = async () => {
    if (!eventForm.title || !eventForm.startTime) {
      Swal.fire({ title: "Missing Fields", text: "Title and start time are required.", icon: "warning" });
      return;
    }
    try {
      await createRecord("community-events", {
        title: eventForm.title,
        category: eventForm.category,
        description: eventForm.description || null,
        location: eventForm.location || null,
        startTime: new Date(eventForm.startTime).toISOString(),
        capacity: eventForm.capacity !== "" ? Number(eventForm.capacity) || null : null,
        host: eventForm.host || null,
        published: true,
      });
      await eventsQ.refetch();
      setShowEvent(false);
      setEventForm(eventForm0);
      Swal.fire({ title: "Event Published", text: "Residents & families have been invited.", icon: "success", timer: 1800, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not create event.", icon: "error" });
    }
  };

  const deleteEvent = async (id: string, title: string) => {
    const confirmed = await Swal.fire({ title: "Delete Event?", text: `Remove "${title}"?`, icon: "warning", showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Delete" });
    if (!confirmed.isConfirmed) return;
    try { await deleteRecord("community-events", id); await eventsQ.refetch(); }
    catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not delete.", icon: "error" }); }
  };

  /* ── Dining ── */
  const setDiningStatus = async (id: string, status: string) => {
    setBusyId(id);
    try { await updateRecord("dining-reservations", id, { status }); await diningQ.refetch(); }
    catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not update.", icon: "error" }); }
    finally { setBusyId(null); }
  };

  /* ── Announcements ── */
  const createAnn = async () => {
    if (!annForm.title || !annForm.body) {
      Swal.fire({ title: "Missing Fields", text: "Title and body are required.", icon: "warning" });
      return;
    }
    try {
      await createRecord("announcements", {
        title: annForm.title, body: annForm.body, audience: annForm.audience,
        priority: annForm.priority, pinned: annForm.pinned, published: true, autoNotify: true,
        publishedAt: new Date().toISOString(),
      });
      await annQ.refetch();
      setShowAnn(false);
      setAnnForm(annForm0);
      Swal.fire({ title: "Announcement Sent", text: "Broadcast to the selected audience.", icon: "success", timer: 1800, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not post announcement.", icon: "error" });
    }
  };

  const togglePin = async (id: string, pinned: boolean) => {
    setBusyId(id);
    try { await updateRecord("announcements", id, { pinned: !pinned }); await annQ.refetch(); }
    catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not update.", icon: "error" }); }
    finally { setBusyId(null); }
  };

  const deleteAnn = async (id: string, title: string) => {
    const confirmed = await Swal.fire({ title: "Delete Announcement?", text: `Remove "${title}"?`, icon: "warning", showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Delete" });
    if (!confirmed.isConfirmed) return;
    try { await deleteRecord("announcements", id); await annQ.refetch(); }
    catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not delete.", icon: "error" }); }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Community &amp; Events
          </h1>
          <p className="text-gray-600">Resident &amp; family engagement — calendar · dining reservations · automated announcements</p>
        </div>
        <button onClick={() => { eventsQ.refetch(); diningQ.refetch(); annQ.refetch(); }} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-2 flex-wrap border-b border-gray-200 pb-2">
        {SUBTABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setSubtab(t.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
                subtab === t.key ? "bg-yellow-400 text-black" : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"
              }`}>
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
        <input type="text" placeholder="Search events, reservations, announcements…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
      </div>

      {/* ── Events ── */}
      {subtab === "events" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => { setEventForm(eventForm0); setShowEvent(true); }} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95">
              <Plus className="w-4 h-4" /> New Event
            </button>
          </div>
          {eventsQ.loading && paginatedEvents.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading events…</div>
          ) : paginatedEvents.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">{search ? "No events match your search." : "No events scheduled."}</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {paginatedEvents.map(e => {
                const m = EVENT_CATEGORY_META[String(e.category)] ?? EVENT_CATEGORY_META.SOCIAL;
                const Icon = m.icon;
                const attendances = Array.isArray(e.attendances) ? (e.attendances as Row[]) : [];
                const going = attendances.filter(a => ["GOING", "ATTENDED"].includes(String(a.status))).length;
                return (
                  <div key={String(e.id)} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    {e.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={String(e.imageUrl)} alt="" className="w-full h-28 object-cover" />
                    ) : (
                      <div className={`w-full h-28 flex items-center justify-center ${m.cls}`}><Icon className="w-10 h-10 opacity-40" /></div>
                    )}
                    <div className="p-3">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${m.cls}`}><Icon className="w-3 h-3" /> {m.label}</span>
                        <div className="flex items-center gap-1">
                          <button onClick={() => setViewing({ type: "event", data: e })} className="p-1 rounded hover:bg-blue-100 text-blue-600 transition" title="View"><Eye className="w-3.5 h-3.5" /></button>
                          <button onClick={() => deleteEvent(String(e.id), String(e.title))} className="p-1 rounded hover:bg-red-100 text-red-500 transition" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                      <p className="text-sm font-semibold text-gray-900">{String(e.title)}</p>
                      <p className="text-xs text-gray-500">{new Date(String(e.startTime)).toLocaleString()}</p>
                      {e.location ? <p className="text-xs text-gray-400">{String(e.location)}</p> : null}
                      <p className="text-[11px] text-gray-500 mt-1 inline-flex items-center gap-1">
                        <Users className="w-3 h-3" /> {going} going{e.capacity ? ` / ${String(e.capacity)}` : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Dining ── */}
      {subtab === "dining" && (
        <div className="space-y-4">
          {diningQ.loading && paginatedDining.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading reservations…</div>
          ) : paginatedDining.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">{search ? "No reservations match your search." : "No dining reservations."}</div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Resident</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Meal</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">When</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Venue</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Party</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paginatedDining.map(d => {
                    const busy = busyId === String(d.id);
                    const status = String(d.status);
                    return (
                      <tr key={String(d.id)} className="hover:bg-gray-50 transition">
                        <td className="px-4 py-3 font-medium text-gray-900">{residentName(d)}</td>
                        <td className="px-4 py-3 text-gray-600 text-xs">{String(d.mealType)}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{d.reservedAt ? new Date(String(d.reservedAt)).toLocaleString() : "—"}</td>
                        <td className="px-4 py-3 text-gray-600 text-xs">{String(d.venue ?? "—")}</td>
                        <td className="px-4 py-3 text-gray-600 text-xs">{String(d.partySize ?? 1)}</td>
                        <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${DINING_STATUS_PILL[status] ?? "bg-gray-100 text-gray-700"}`}>{status}</span></td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-1">
                            {busy ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" /> : (
                              <>
                                <button onClick={() => setViewing({ type: "dining", data: d })} className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition" title="View"><Eye className="w-4 h-4" /></button>
                                {status === "REQUESTED" && <button onClick={() => setDiningStatus(String(d.id), "CONFIRMED")} className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition" title="Confirm"><CheckCircle2 className="w-4 h-4" /></button>}
                                {status === "CONFIRMED" && <button onClick={() => setDiningStatus(String(d.id), "SEATED")} className="p-1.5 rounded hover:bg-indigo-100 text-indigo-600 transition" title="Seat"><Play className="w-4 h-4" /></button>}
                                {status === "SEATED" && <button onClick={() => setDiningStatus(String(d.id), "COMPLETED")} className="p-1.5 rounded hover:bg-green-100 text-green-600 transition" title="Complete"><CheckCircle2 className="w-4 h-4" /></button>}
                                {!["COMPLETED", "CANCELLED"].includes(status) && <button onClick={() => setDiningStatus(String(d.id), "CANCELLED")} className="p-1.5 rounded hover:bg-red-100 text-red-500 transition" title="Cancel"><Ban className="w-4 h-4" /></button>}
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
        </div>
      )}

      {/* ── Announcements ── */}
      {subtab === "announcements" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => { setAnnForm(annForm0); setShowAnn(true); }} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95">
              <Plus className="w-4 h-4" /> New Announcement
            </button>
          </div>
          {annQ.loading && paginatedAnn.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading announcements…</div>
          ) : paginatedAnn.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">{search ? "No announcements match your search." : "No announcements."}</div>
          ) : (
            <div className="space-y-2">
              {paginatedAnn.map(a => {
                const busy = busyId === String(a.id);
                const pinned = Boolean(a.pinned);
                return (
                  <div key={String(a.id)} className="bg-white rounded-lg border border-gray-200 p-4 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        {pinned && <Pin className="w-3.5 h-3.5 text-yellow-500" />}
                        <p className="text-sm font-semibold text-gray-900">{String(a.title)}</p>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${ANNOUNCEMENT_PRIORITY_PILL[String(a.priority)] ?? ANNOUNCEMENT_PRIORITY_PILL.NORMAL}`}>{String(a.priority)}</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-600">{String(a.audience)}</span>
                      </div>
                      <p className="text-xs text-gray-600">{String(a.body)}</p>
                      <p className="text-[11px] text-gray-400 mt-1">{String(a.authorName ?? "")}{a.publishedAt ? ` · ${new Date(String(a.publishedAt)).toLocaleString()}` : ""}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {busy ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" /> : (
                        <>
                          <button onClick={() => setViewing({ type: "announcement", data: a })} className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition" title="View"><Eye className="w-4 h-4" /></button>
                          <button onClick={() => togglePin(String(a.id), pinned)} className={`p-1.5 rounded transition ${pinned ? "text-yellow-600 hover:bg-yellow-100" : "text-gray-400 hover:bg-gray-100"}`} title={pinned ? "Unpin" : "Pin"}><Pin className="w-4 h-4" /></button>
                          <button onClick={() => deleteAnn(String(a.id), String(a.title))} className="p-1.5 rounded hover:bg-red-100 text-red-600 transition" title="Delete"><Trash2 className="w-4 h-4" /></button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">{activeList.length} {subtab === "events" ? "events" : subtab === "dining" ? "reservations" : "announcements"} total</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-sm font-medium text-gray-700">Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {/* View Modal */}
      {viewing && <CommunityViewModal type={viewing.type} data={viewing.data} onClose={() => setViewing(null)} />}

      {/* Event Modal */}
      {showEvent && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
              <h2 className="text-xl font-bold">New Community Event</h2>
              <button onClick={() => setShowEvent(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Title</label>
                  <input type="text" value={eventForm.title} onChange={e => setEventForm(f => ({ ...f, title: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Category</label>
                  <select value={eventForm.category} onChange={e => setEventForm(f => ({ ...f, category: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    {EVENT_CATEGORIES.map(c => <option key={c} value={c}>{EVENT_CATEGORY_META[c].label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Start Time</label>
                  <input type="datetime-local" value={eventForm.startTime} onChange={e => setEventForm(f => ({ ...f, startTime: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Location</label>
                  <input type="text" value={eventForm.location} onChange={e => setEventForm(f => ({ ...f, location: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Capacity</label>
                  <input type="number" min="0" value={eventForm.capacity} onChange={e => setEventForm(f => ({ ...f, capacity: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Host</label>
                  <input type="text" value={eventForm.host} onChange={e => setEventForm(f => ({ ...f, host: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Description</label>
                  <textarea value={eventForm.description} onChange={e => setEventForm(f => ({ ...f, description: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setShowEvent(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Cancel</button>
              <button onClick={createEvent} className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">Publish Event</button>
            </div>
          </div>
        </div>
      )}

      {/* Announcement Modal */}
      {showAnn && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
              <h2 className="text-xl font-bold">New Announcement</h2>
              <button onClick={() => setShowAnn(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Title</label>
                <input type="text" value={annForm.title} onChange={e => setAnnForm(f => ({ ...f, title: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Message</label>
                <textarea value={annForm.body} onChange={e => setAnnForm(f => ({ ...f, body: e.target.value }))} rows={4} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Audience</label>
                  <select value={annForm.audience} onChange={e => setAnnForm(f => ({ ...f, audience: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    <option value="ALL">Everyone</option>
                    <option value="RESIDENTS">Residents</option>
                    <option value="FAMILIES">Families</option>
                    <option value="STAFF">Staff</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Priority</label>
                  <select value={annForm.priority} onChange={e => setAnnForm(f => ({ ...f, priority: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    <option value="NORMAL">Normal</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={annForm.pinned} onChange={e => setAnnForm(f => ({ ...f, pinned: e.target.checked }))} className="rounded" />
                Pin to the top of dashboards
              </label>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setShowAnn(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Cancel</button>
              <button onClick={createAnn} className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">Broadcast</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CommunityViewModal({ type, data, onClose }: { type: string; data: Row; onClose: () => void }) {
  const title = type === "event" ? String(data.title) : type === "dining" ? `Dining — ${String(data.mealType)}` : String(data.title);

  const fields: [string, string][] = (() => {
    if (type === "event") {
      const m = EVENT_CATEGORY_META[String(data.category)] ?? EVENT_CATEGORY_META.SOCIAL;
      return [
        ["Category", m.label],
        ["Start", data.startTime ? new Date(String(data.startTime)).toLocaleString() : "—"],
        ["Location", String(data.location || "—")],
        ["Capacity", String(data.capacity || "—")],
        ["Host", String(data.host || "—")],
        ["Description", String(data.description || "—")],
      ];
    }
    if (type === "dining") {
      return [
        ["Resident", residentName(data)],
        ["Meal Type", String(data.mealType)],
        ["When", data.reservedAt ? new Date(String(data.reservedAt)).toLocaleString() : "—"],
        ["Venue", String(data.venue || "—")],
        ["Party Size", String(data.partySize ?? 1)],
        ["Status", String(data.status)],
        ["Special Requests", String(data.specialRequests || "—")],
        ["Guest Names", String(data.guestNames || "—")],
      ];
    }
    return [
      ["Audience", String(data.audience)],
      ["Priority", String(data.priority)],
      ["Pinned", data.pinned ? "Yes" : "No"],
      ["Body", String(data.body || "—")],
      ["Author", String(data.authorName || "—")],
      ["Published", data.publishedAt ? new Date(String(data.publishedAt)).toLocaleString() : "—"],
    ];
  })();

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-6 space-y-4">
          {fields.map(([label, value]) => (
            <div key={label} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
              <p className="text-sm font-medium text-gray-900 mt-0.5 whitespace-pre-wrap">{value}</p>
            </div>
          ))}
        </div>
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end">
          <button onClick={onClose} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Close</button>
        </div>
      </div>
    </div>
  );
}
