"use client";

import { useMemo, useState } from "react";
import {
  RefreshCw, X, Megaphone, CalendarDays, UtensilsCrossed, SlidersHorizontal,
  Plus, Trash2, Star, CheckCircle2, Loader2, Pin, MapPin,
} from "lucide-react";
import Swal from "sweetalert2";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";
import {
  EVENT_CATEGORY_META, RSVP_PILL, DINING_STATUS_PILL, MEAL_TYPES, DINING_VENUES,
  ANNOUNCEMENT_PRIORITY_PILL, PREFERENCE_CATEGORIES,
} from "./pmsMeta";

/**
 * Resident & Family engagement (Phase 7 PMS) — live, scoped to the signed-in
 * resident by the /api/db layer. Announcements feed · community calendar with
 * RSVP · dining reservations · preference profiles. Every write goes through the
 * scoped, ownership-checked API — no static data, no localStorage.
 */

type Row = Record<string, unknown>;
const diningForm0 = { mealType: "DINNER", reservedAt: "", partySize: "1", venue: "Main Dining", specialRequests: "", guestNames: "" };
const prefForm0 = { category: "Room Comfort", preference: "", value: "", notes: "" };

export default function MyCommunity() {
  const { data: residents } = useLiveQuery<Row>("residents", { query: "take=10", tables: ["Resident"] });
  const annQ = useLiveQuery<Row>("announcements", { query: "f_published=true&take=50", tables: ["Announcement"] });
  const eventsQ = useLiveQuery<Row>("community-events", { query: "f_published=true&take=100", tables: ["CommunityEvent"] });
  const rsvpQ = useLiveQuery<Row>("event-attendances", { query: "take=200", tables: ["EventAttendance"] });
  const diningQ = useLiveQuery<Row>("dining-reservations", { query: "take=100", tables: ["DiningReservation"] });
  const prefsQ = useLiveQuery<Row>("resident-preferences", { query: "take=100", tables: ["ResidentPreference"] });

  const resident = residents[0];
  const residentId = String(resident?.id ?? "");

  const [showDining, setShowDining] = useState(false);
  const [diningForm, setDiningForm] = useState(diningForm0);
  const [showPref, setShowPref] = useState(false);
  const [prefForm, setPrefForm] = useState(prefForm0);
  const [busyId, setBusyId] = useState<string | null>(null);

  const rsvpByEvent = useMemo(() => {
    const map: Record<string, Row> = {};
    rsvpQ.data.forEach(a => { map[String(a.eventId)] = a; });
    return map;
  }, [rsvpQ.data]);

  const events = useMemo(
    () => [...eventsQ.data].sort((a, b) => new Date(String(a.startTime)).getTime() - new Date(String(b.startTime)).getTime()),
    [eventsQ.data]
  );
  const announcements = useMemo(
    () => [...annQ.data].sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (new Date(String(b.publishedAt ?? 0)).getTime() - new Date(String(a.publishedAt ?? 0)).getTime())),
    [annQ.data]
  );
  const prefsByCategory = useMemo(() => {
    const map: Record<string, Row[]> = {};
    prefsQ.data.forEach(p => { const c = String(p.category); (map[c] ??= []).push(p); });
    return map;
  }, [prefsQ.data]);

  /* ── RSVP ── */
  const rsvp = async (eventId: string, status: string) => {
    if (!residentId) { Swal.fire({ title: "No Resident Linked", text: "Your account has no linked resident yet.", icon: "warning" }); return; }
    setBusyId(eventId);
    try {
      const existing = rsvpByEvent[eventId];
      if (existing) await updateRecord("event-attendances", String(existing.id), { status });
      else await createRecord("event-attendances", { eventId, residentId, status });
      await rsvpQ.refetch();
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not update RSVP.", icon: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const rateEvent = async (attendanceId: string) => {
    const result = await Swal.fire({
      title: "Rate this Event",
      html: `<select id="swal-rating" class="swal2-select" style="width:80%"><option value="5">★★★★★ Excellent</option><option value="4">★★★★ Good</option><option value="3">★★★ Okay</option><option value="2">★★ Poor</option><option value="1">★ Very poor</option></select>`,
      icon: "question", showCancelButton: true, confirmButtonColor: "#22c55e", cancelButtonColor: "#6b7280", confirmButtonText: "Submit",
      preConfirm: () => Number((document.getElementById("swal-rating") as HTMLSelectElement | null)?.value ?? 5) || 5,
    });
    if (!result.isConfirmed) return;
    setBusyId(attendanceId);
    try {
      await updateRecord("event-attendances", attendanceId, { status: "ATTENDED", rating: Number(result.value) });
      await rsvpQ.refetch();
      Swal.fire({ title: "Thank You!", icon: "success", timer: 1400, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not submit rating.", icon: "error" });
    } finally {
      setBusyId(null);
    }
  };

  /* ── Dining ── */
  const submitDining = async () => {
    if (!diningForm.reservedAt) { Swal.fire({ title: "Missing Time", text: "Please pick a date and time.", icon: "warning" }); return; }
    if (!residentId) { Swal.fire({ title: "No Resident Linked", text: "Your account has no linked resident yet.", icon: "warning" }); return; }
    try {
      await createRecord("dining-reservations", {
        residentId,
        mealType: diningForm.mealType,
        reservedAt: new Date(diningForm.reservedAt).toISOString(),
        partySize: Number(diningForm.partySize) || 1,
        venue: diningForm.venue || null,
        specialRequests: diningForm.specialRequests || null,
        guestNames: diningForm.guestNames || null,
        status: "REQUESTED",
      });
      await diningQ.refetch();
      setShowDining(false);
      setDiningForm(diningForm0);
      Swal.fire({ title: "Reservation Requested", text: "The dining team has been notified.", icon: "success", timer: 1800, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not reserve.", icon: "error" });
    }
  };

  const cancelDining = async (id: string) => {
    const confirmed = await Swal.fire({ title: "Cancel Reservation?", icon: "warning", showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Cancel" });
    if (!confirmed.isConfirmed) return;
    setBusyId(id);
    try { await updateRecord("dining-reservations", id, { status: "CANCELLED" }); await diningQ.refetch(); }
    catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not cancel.", icon: "error" }); }
    finally { setBusyId(null); }
  };

  /* ── Preferences ── */
  const savePref = async () => {
    if (!prefForm.preference || !prefForm.value) { Swal.fire({ title: "Missing Fields", text: "Preference and value are required.", icon: "warning" }); return; }
    if (!residentId) { Swal.fire({ title: "No Resident Linked", text: "Your account has no linked resident yet.", icon: "warning" }); return; }
    try {
      await createRecord("resident-preferences", {
        residentId, category: prefForm.category, preference: prefForm.preference, value: prefForm.value, notes: prefForm.notes || null,
      });
      await prefsQ.refetch();
      setShowPref(false);
      setPrefForm(prefForm0);
      Swal.fire({ title: "Preference Saved", icon: "success", timer: 1400, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not save preference.", icon: "error" });
    }
  };

  const deletePref = async (id: string) => {
    const confirmed = await Swal.fire({ title: "Remove Preference?", icon: "warning", showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Remove" });
    if (!confirmed.isConfirmed) return;
    setBusyId(id);
    try { await deleteRecord("resident-preferences", id); await prefsQ.refetch(); }
    catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not remove.", icon: "error" }); }
    finally { setBusyId(null); }
  };

  const refreshAll = () => { annQ.refetch(); eventsQ.refetch(); rsvpQ.refetch(); diningQ.refetch(); prefsQ.refetch(); };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Community &amp; Events
          </h1>
          <p className="text-gray-600">Announcements · events · dining reservations · your preference profile</p>
        </div>
        <button onClick={refreshAll} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Announcements */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-1.5 mb-3">
          <Megaphone className="w-4 h-4 text-yellow-500" />
          <h3 className="font-semibold text-gray-900 text-sm">Announcements</h3>
        </div>
        {announcements.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No announcements right now.</p>
        ) : (
          <div className="space-y-2">
            {announcements.slice(0, 8).map(a => (
              <div key={String(a.id)} className="border border-gray-100 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  {Boolean(a.pinned) && <Pin className="w-3.5 h-3.5 text-yellow-500" />}
                  <p className="text-sm font-semibold text-gray-900">{String(a.title)}</p>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${ANNOUNCEMENT_PRIORITY_PILL[String(a.priority)] ?? ANNOUNCEMENT_PRIORITY_PILL.NORMAL}`}>{String(a.priority)}</span>
                </div>
                <p className="text-xs text-gray-600">{String(a.body)}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{String(a.authorName ?? "")}{a.publishedAt ? ` · ${new Date(String(a.publishedAt)).toLocaleDateString()}` : ""}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Community calendar */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-1.5 mb-3">
          <CalendarDays className="w-4 h-4 text-yellow-500" />
          <h3 className="font-semibold text-gray-900 text-sm">Community Calendar</h3>
        </div>
        {events.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No upcoming events.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {events.map(e => {
              const m = EVENT_CATEGORY_META[String(e.category)] ?? EVENT_CATEGORY_META.SOCIAL;
              const Icon = m.icon;
              const att = rsvpByEvent[String(e.id)];
              const status = att ? String(att.status) : "";
              const past = new Date(String(e.startTime)).getTime() < Date.now();
              const busy = busyId === String(e.id) || busyId === String(att?.id);
              return (
                <div key={String(e.id)} className="border border-gray-200 rounded-lg overflow-hidden">
                  {e.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={String(e.imageUrl)} alt="" className="w-full h-24 object-cover" />
                  ) : (
                    <div className={`w-full h-24 flex items-center justify-center ${m.cls}`}><Icon className="w-8 h-8 opacity-40" /></div>
                  )}
                  <div className="p-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${m.cls}`}><Icon className="w-3 h-3" /> {m.label}</span>
                    <p className="text-sm font-semibold text-gray-900 mt-1">{String(e.title)}</p>
                    <p className="text-xs text-gray-500">{new Date(String(e.startTime)).toLocaleString()}</p>
                    {e.location ? <p className="text-xs text-gray-400 inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> {String(e.location)}</p> : null}
                    <div className="mt-2">
                      {busy ? (
                        <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                      ) : past && status === "ATTENDED" && !att?.rating ? (
                        <button onClick={() => rateEvent(String(att.id))} className="w-full px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg transition inline-flex items-center justify-center gap-1"><Star className="w-3.5 h-3.5" /> Rate Event</button>
                      ) : att?.rating ? (
                        <span className="inline-flex items-center gap-0.5 text-amber-500 font-semibold text-xs">{Number(att.rating)} <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" /></span>
                      ) : status === "GOING" ? (
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${RSVP_PILL.GOING}`}>Going</span>
                          <button onClick={() => rsvp(String(e.id), "DECLINED")} className="text-xs text-red-500 hover:underline">Cancel</button>
                        </div>
                      ) : !past ? (
                        <button onClick={() => rsvp(String(e.id), "GOING")} className="w-full px-3 py-1.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-black text-xs font-semibold rounded-lg transition inline-flex items-center justify-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> RSVP — I&apos;m Going</button>
                      ) : (
                        <span className="text-[11px] text-gray-400">Event ended</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Dining reservations */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <UtensilsCrossed className="w-4 h-4 text-yellow-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Dining Reservations</h3>
          </div>
          <button onClick={() => { setDiningForm(diningForm0); setShowDining(true); }} className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-black text-xs font-semibold rounded-lg hover:shadow-md transition"><Plus className="w-3.5 h-3.5" /> Reserve</button>
        </div>
        {diningQ.data.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No dining reservations yet.</p>
        ) : (
          <div className="space-y-2">
            {diningQ.data.map(d => {
              const status = String(d.status);
              const busy = busyId === String(d.id);
              return (
                <div key={String(d.id)} className="flex items-center justify-between gap-3 border border-gray-100 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{String(d.mealType)} · {String(d.venue ?? "Dining")}</p>
                    <p className="text-xs text-gray-500">{d.reservedAt ? new Date(String(d.reservedAt)).toLocaleString() : ""} · party of {String(d.partySize ?? 1)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${DINING_STATUS_PILL[status] ?? "bg-gray-100 text-gray-700"}`}>{status}</span>
                    {["REQUESTED", "CONFIRMED"].includes(status) && (busy ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" /> : <button onClick={() => cancelDining(String(d.id))} className="text-xs text-red-500 hover:underline">Cancel</button>)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Preference profile */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <SlidersHorizontal className="w-4 h-4 text-yellow-500" />
            <h3 className="font-semibold text-gray-900 text-sm">My Preference Profile</h3>
          </div>
          <button onClick={() => { setPrefForm(prefForm0); setShowPref(true); }} className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-black text-xs font-semibold rounded-lg hover:shadow-md transition"><Plus className="w-3.5 h-3.5" /> Add</button>
        </div>
        {prefsQ.data.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No preferences set — add your comfort, dining, and activity preferences.</p>
        ) : (
          <div className="space-y-3">
            {Object.entries(prefsByCategory).map(([cat, items]) => (
              <div key={cat}>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{cat}</p>
                <div className="space-y-1">
                  {items.map(p => {
                    const busy = busyId === String(p.id);
                    return (
                      <div key={String(p.id)} className="flex items-center justify-between gap-3 border border-gray-100 rounded-lg px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm text-gray-900">{String(p.preference)}: <span className="font-semibold">{String(p.value)}</span></p>
                          {p.notes ? <p className="text-xs text-gray-400">{String(p.notes)}</p> : null}
                        </div>
                        {busy ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" /> : <button onClick={() => deletePref(String(p.id))} className="p-1.5 rounded hover:bg-red-100 text-red-500 transition" title="Remove"><Trash2 className="w-4 h-4" /></button>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Dining Modal */}
      {showDining && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
              <h2 className="text-xl font-bold">Reserve Dining</h2>
              <button onClick={() => setShowDining(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Meal</label>
                  <select value={diningForm.mealType} onChange={e => setDiningForm(f => ({ ...f, mealType: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    {MEAL_TYPES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Venue</label>
                  <select value={diningForm.venue} onChange={e => setDiningForm(f => ({ ...f, venue: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    {DINING_VENUES.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Date &amp; Time</label>
                  <input type="datetime-local" value={diningForm.reservedAt} onChange={e => setDiningForm(f => ({ ...f, reservedAt: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Party Size</label>
                  <input type="number" min="1" value={diningForm.partySize} onChange={e => setDiningForm(f => ({ ...f, partySize: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Guests (optional)</label>
                  <input type="text" value={diningForm.guestNames} onChange={e => setDiningForm(f => ({ ...f, guestNames: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Special Requests</label>
                  <textarea value={diningForm.specialRequests} onChange={e => setDiningForm(f => ({ ...f, specialRequests: e.target.value }))} rows={2} placeholder="Dietary needs, seating, occasion…" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setShowDining(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Cancel</button>
              <button onClick={submitDining} className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">Request Reservation</button>
            </div>
          </div>
        </div>
      )}

      {/* Preference Modal */}
      {showPref && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
              <h2 className="text-xl font-bold">Add Preference</h2>
              <button onClick={() => setShowPref(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Category</label>
                <select value={prefForm.category} onChange={e => setPrefForm(f => ({ ...f, category: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                  {PREFERENCE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Preference</label>
                <input type="text" value={prefForm.preference} onChange={e => setPrefForm(f => ({ ...f, preference: e.target.value }))} placeholder="e.g. Preferred wake-up time" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Value</label>
                <input type="text" value={prefForm.value} onChange={e => setPrefForm(f => ({ ...f, value: e.target.value }))} placeholder="e.g. 6:30 AM" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Notes (optional)</label>
                <textarea value={prefForm.notes} onChange={e => setPrefForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setShowPref(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Cancel</button>
              <button onClick={savePref} className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">Save Preference</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
