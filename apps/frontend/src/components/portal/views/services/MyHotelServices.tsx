"use client";

import { useMemo, useState } from "react";
import {
  ConciergeBell, RefreshCw, X, Star, CheckCircle2, Camera, Ban, Loader2,
} from "lucide-react";
import Swal from "sweetalert2";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord } from "@/lib/api";
import {
  CATEGORY_META, PRIORITY_PILL, REQUEST_STATUS_PILL, TEAM_LABEL,
  autoAssignTeam, CONCIERGE_CATALOG, BOOKING_STATUS_PILL,
} from "./serviceMeta";

/**
 * Shared Family/Resident "Hotel Services" view (Phase 7 cont.). The /api/db
 * layer scopes service-requests, concierge-bookings, and residents to the
 * signed-in sponsor's resident(s) (FAMILY) or the resident's own record
 * (RESIDENT), so this component simply renders whatever it is allowed to
 * see — live. Residents request services, watch the ticket move through the
 * workflow in realtime, confirm & rate completed work (1–5 ★), and book
 * concierge premium services.
 */

type Row = Record<string, unknown>;

const requestForm = { category: "HOUSEKEEPING", subType: "Room Clean", priority: "ROUTINE", details: "" };
const bookingForm = { category: "SALON_BARBER", scheduledAt: "", notes: "" };

function timeAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return "";
  }
}

export default function MyHotelServices() {
  const { data: residents } = useLiveQuery<Row>("residents", { query: "take=10", tables: ["Resident"] });
  const { data: ticketRows, loading, error, refetch } = useLiveQuery<Row>(
    "service-requests", { query: "take=100", tables: ["ServiceRequest"] }
  );
  const bookingsQ = useLiveQuery<Row>("concierge-bookings", { query: "take=100", tables: ["ConciergeBooking"] });

  const [showRequest, setShowRequest] = useState(false);
  const [showBooking, setShowBooking] = useState(false);
  const [reqForm, setReqForm] = useState(requestForm);
  const [bookForm, setBookForm] = useState(bookingForm);
  const [busyId, setBusyId] = useState<string | null>(null);

  const resident = residents[0];
  const residentId = String(resident?.id ?? "");
  const residentName = resident
    ? `${String(resident.firstName ?? "")} ${String(resident.lastName ?? "")}`.trim()
    : "your resident";

  const tickets = useMemo(
    () => [...ticketRows].sort((a, b) => new Date(String(b.createdAt ?? 0)).getTime() - new Date(String(a.createdAt ?? 0)).getTime()),
    [ticketRows]
  );
  const bookings = useMemo(
    () => [...bookingsQ.data].sort((a, b) => new Date(String(b.createdAt ?? 0)).getTime() - new Date(String(a.createdAt ?? 0)).getTime()),
    [bookingsQ.data]
  );

  const awaitingConfirm = tickets.filter(t => String(t.status) === "COMPLETED");

  /* ── Actions ── */

  const submitRequest = async () => {
    if (!reqForm.details) {
      Swal.fire({ title: "Missing Details", text: "Please describe what you need.", icon: "warning" });
      return;
    }
    if (!residentId) {
      Swal.fire({ title: "No Resident Linked", text: "Your account has no linked resident yet.", icon: "warning" });
      return;
    }
    const team = autoAssignTeam(reqForm.category, reqForm.subType);
    try {
      await createRecord("service-requests", {
        residentId,
        roomNumber: String(resident?.roomNumber ?? "") || null,
        category: reqForm.category,
        subType: reqForm.subType || null,
        details: reqForm.details,
        source: "RESIDENT_PORTAL",
        priority: reqForm.priority,
        status: "ASSIGNED",
        assignedTeam: team,
      });
      await refetch();
      setShowRequest(false);
      setReqForm(requestForm);
      Swal.fire({
        title: "Request Sent",
        text: `Your ticket was created and assigned to the ${TEAM_LABEL[team].toLowerCase()}. Track it live below.`,
        icon: "success", timer: 2200, showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire({ title: "Request Failed", text: err instanceof Error ? err.message : "Could not send request.", icon: "error" });
    }
  };

  const confirmAndRate = async (t: Row) => {
    const result = await Swal.fire({
      title: "Confirm & Rate Service",
      html:
        `<p style="font-size:14px;margin-bottom:10px">How satisfied are you with this service? (1–5 ★)</p>` +
        `<select id="swal-rating" class="swal2-select" style="width:80%">` +
        `<option value="5">★★★★★ — Excellent</option>` +
        `<option value="4">★★★★ — Good</option>` +
        `<option value="3">★★★ — Okay</option>` +
        `<option value="2">★★ — Poor</option>` +
        `<option value="1">★ — Very poor</option>` +
        `</select>` +
        `<input id="swal-comment" class="swal2-input" placeholder="Comment (optional)">`,
      icon: "question", showCancelButton: true,
      confirmButtonColor: "#22c55e", cancelButtonColor: "#6b7280", confirmButtonText: "Confirm Service",
      preConfirm: () => ({
        rating: Number((document.getElementById("swal-rating") as HTMLSelectElement | null)?.value ?? 5) || 5,
        comment: (document.getElementById("swal-comment") as HTMLInputElement | null)?.value ?? "",
      }),
    });
    if (!result.isConfirmed) return;
    const { rating, comment } = (result.value as { rating: number; comment: string }) ?? { rating: 5, comment: "" };
    setBusyId(String(t.id));
    try {
      await updateRecord("service-requests", String(t.id), {
        status: "CONFIRMED",
        rating,
        ratingComment: comment || null,
      });
      await refetch();
      Swal.fire({ title: "Thank You!", text: "Your rating helps us improve our services.", icon: "success", timer: 1800, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not confirm the service.", icon: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const submitBooking = async () => {
    if (!bookForm.scheduledAt) {
      Swal.fire({ title: "Missing Schedule", text: "Please pick a date and time.", icon: "warning" });
      return;
    }
    if (!residentId) {
      Swal.fire({ title: "No Resident Linked", text: "Your account has no linked resident yet.", icon: "warning" });
      return;
    }
    const cat = CONCIERGE_CATALOG[bookForm.category];
    try {
      await createRecord("concierge-bookings", {
        residentId,
        category: bookForm.category,
        serviceName: cat?.label ?? bookForm.category,
        scheduledAt: new Date(bookForm.scheduledAt).toISOString(),
        status: "REQUESTED",
        price: cat?.defaultPrice ?? 0,
        billable: cat?.billable ?? false,
        notes: bookForm.notes || null,
      });
      await bookingsQ.refetch();
      setShowBooking(false);
      setBookForm(bookingForm);
      Swal.fire({
        title: "Booking Requested",
        text: "The concierge desk has been notified and will confirm your booking.",
        icon: "success", timer: 2200, showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire({ title: "Booking Failed", text: err instanceof Error ? err.message : "Could not send booking.", icon: "error" });
    }
  };

  const cancelBooking = async (b: Row) => {
    const confirmed = await Swal.fire({
      title: "Cancel Booking?", text: `Cancel "${String(b.serviceName)}"?`, icon: "warning",
      showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Cancel Booking",
    });
    if (!confirmed.isConfirmed) return;
    setBusyId(String(b.id));
    try {
      await updateRecord("concierge-bookings", String(b.id), { status: "CANCELLED" });
      await bookingsQ.refetch();
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not cancel the booking.", icon: "error" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Hotel Services
          </h1>
          <p className="text-gray-600">Room comfort, housekeeping &amp; concierge for {residentName} — tracked live</p>
        </div>
        <button onClick={() => { void refetch(); void bookingsQ.refetch(); }} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Confirm & rate banner */}
      {awaitingConfirm.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            <h3 className="font-semibold text-green-900 text-sm">Service done — please confirm &amp; rate</h3>
          </div>
          <div className="space-y-2">
            {awaitingConfirm.map(t => (
              <div key={String(t.id)} className="flex items-center justify-between gap-3 bg-white border border-green-200 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {CATEGORY_META[String(t.category)]?.label ?? String(t.category)}{t.subType ? ` — ${String(t.subType)}` : ""}
                  </p>
                  {String(t.photoProofUrl ?? "") && (
                    <a href={String(t.photoProofUrl)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
                      <Camera className="w-3 h-3" /> View photo proof
                    </a>
                  )}
                </div>
                {busyId === String(t.id) ? (
                  <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                ) : (
                  <button onClick={() => confirmAndRate(t)} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg transition whitespace-nowrap">
                    <Star className="w-3.5 h-3.5" /> Confirm &amp; Rate
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Request a service — category cards */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 text-sm mb-3">Request a Service</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {Object.entries(CATEGORY_META).map(([k, m]) => {
            const Icon = m.icon;
            return (
              <button key={k}
                onClick={() => { setReqForm({ ...requestForm, category: k, subType: m.subTypes[0] }); setShowRequest(true); }}
                className={`text-left border rounded-lg p-3 hover:shadow-md transition ${m.cls}`}>
                <Icon className="w-5 h-5 mb-1.5" />
                <p className="text-xs font-semibold text-gray-900 leading-tight">{m.label}</p>
                <p className="text-[10px] text-gray-500 leading-tight mt-0.5">{m.sub}</p>
              </button>
            );
          })}
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {/* My tickets */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 text-sm mb-3">My Service Requests</h3>
        {loading && tickets.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">Loading your requests…</p>
        ) : tickets.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">No service requests yet — tap a card above to get started.</p>
        ) : (
          <div className="space-y-2">
            {tickets.slice(0, 20).map(t => {
              const meta = CATEGORY_META[String(t.category)] ?? CATEGORY_META.HOUSEKEEPING;
              const Icon = meta.icon;
              const status = String(t.status);
              const rating = Number(t.rating ?? 0);
              return (
                <div key={String(t.id)} className="border border-gray-200 rounded-lg p-3 flex items-start gap-3">
                  <div className={`p-2 rounded-lg border ${meta.cls}`}><Icon className="w-4 h-4" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-900">{meta.label}{t.subType ? ` — ${String(t.subType)}` : ""}</p>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${REQUEST_STATUS_PILL[status] ?? "bg-gray-100 text-gray-700"}`}>{status.replace(/_/g, " ")}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${PRIORITY_PILL[String(t.priority)] ?? PRIORITY_PILL.ROUTINE}`}>{String(t.priority)}</span>
                    </div>
                    {String(t.details ?? "") && <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{String(t.details)}</p>}
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {t.assignedTeam ? `${TEAM_LABEL[String(t.assignedTeam)] ?? t.assignedTeam} · ` : ""}
                      {timeAgo(String(t.createdAt ?? ""))}
                      {Number(t.charge ?? 0) > 0 && ` · ₱${Number(t.charge).toLocaleString()}${t.billed ? " (on invoice)" : ""}`}
                    </p>
                  </div>
                  {rating >= 1 && (
                    <span className="inline-flex items-center gap-0.5 text-amber-500 font-semibold text-xs whitespace-nowrap">
                      {rating} <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                    </span>
                  )}
                  {status === "COMPLETED" && (
                    <button onClick={() => confirmAndRate(t)} className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg transition whitespace-nowrap">
                      Confirm &amp; Rate
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Concierge premium services */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <ConciergeBell className="w-4 h-4 text-yellow-500" />
          <h3 className="font-semibold text-gray-900 text-sm">Concierge &amp; Premium Services</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-4">
          {Object.entries(CONCIERGE_CATALOG).map(([k, c]) => {
            const Icon = c.icon;
            return (
              <button key={k}
                onClick={() => { setBookForm({ ...bookingForm, category: k }); setShowBooking(true); }}
                className={`text-left border rounded-lg p-2.5 hover:shadow-md transition ${c.cls}`}>
                <Icon className="w-4 h-4 mb-1" />
                <p className="text-xs font-semibold text-gray-900 leading-tight">{c.label}</p>
                <p className="text-[10px] text-gray-500 leading-tight mt-0.5">{c.defaultPrice ? `from ₱${c.defaultPrice}` : "Complimentary"}</p>
              </button>
            );
          })}
        </div>

        {bookings.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">My Bookings</h4>
            {bookings.slice(0, 10).map(b => {
              const cat = CONCIERGE_CATALOG[String(b.category)];
              const Icon = cat?.icon ?? ConciergeBell;
              const status = String(b.status);
              return (
                <div key={String(b.id)} className="border border-gray-200 rounded-lg p-3 flex items-center gap-3">
                  <div className={`p-2 rounded-lg border ${cat?.cls ?? "text-gray-600 bg-gray-50 border-gray-200"}`}><Icon className="w-4 h-4" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-900">{String(b.serviceName)}</p>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${BOOKING_STATUS_PILL[status] ?? "bg-gray-100 text-gray-700"}`}>{status.replace(/_/g, " ")}</span>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {b.scheduledAt ? new Date(String(b.scheduledAt)).toLocaleString() : ""}
                      {Number(b.price ?? 0) > 0 ? ` · ₱${Number(b.price).toLocaleString()}` : " · Complimentary"}
                    </p>
                  </div>
                  {["REQUESTED", "CONFIRMED"].includes(status) && (
                    busyId === String(b.id) ? (
                      <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                    ) : (
                      <button onClick={() => cancelBooking(b)} className="p-1.5 rounded hover:bg-red-100 text-red-500 transition" title="Cancel Booking"><Ban className="w-4 h-4" /></button>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Request Modal */}
      {showRequest && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
              <h2 className="text-xl font-bold">Request {CATEGORY_META[reqForm.category]?.label ?? "a Service"}</h2>
              <button onClick={() => setShowRequest(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Type</label>
                  <select value={reqForm.subType} onChange={e => setReqForm(f => ({ ...f, subType: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    {(CATEGORY_META[reqForm.category]?.subTypes ?? []).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Priority</label>
                  <select value={reqForm.priority} onChange={e => setReqForm(f => ({ ...f, priority: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    <option value="ROUTINE">Routine</option>
                    <option value="URGENT">Urgent</option>
                    <option value="EMERGENCY">Emergency</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">What do you need?</label>
                  <textarea value={reqForm.details} onChange={e => setReqForm(f => ({ ...f, details: e.target.value }))} rows={3}
                    placeholder="e.g. The room feels warm — please adjust the aircon to 22°C." className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
                <div className="col-span-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-800">
                  Goes to: <strong>{TEAM_LABEL[autoAssignTeam(reqForm.category, reqForm.subType)]}</strong> · Room {String(resident?.roomNumber ?? "—")}
                </div>
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setShowRequest(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Cancel</button>
              <button onClick={submitRequest} className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">Send Request</button>
            </div>
          </div>
        </div>
      )}

      {/* Booking Modal */}
      {showBooking && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
              <h2 className="text-xl font-bold">Book {CONCIERGE_CATALOG[bookForm.category]?.label ?? "a Service"}</h2>
              <button onClick={() => setShowBooking(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">{CONCIERGE_CATALOG[bookForm.category]?.desc}</p>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Preferred Date &amp; Time</label>
                <input type="datetime-local" value={bookForm.scheduledAt} onChange={e => setBookForm(f => ({ ...f, scheduledAt: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Notes (optional)</label>
                <textarea value={bookForm.notes} onChange={e => setBookForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
              </div>
              {(CONCIERGE_CATALOG[bookForm.category]?.defaultPrice ?? 0) > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-800">
                  Billable service — from <strong>₱{CONCIERGE_CATALOG[bookForm.category].defaultPrice}</strong>, posted to the monthly invoice after completion.
                </div>
              )}
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setShowBooking(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Cancel</button>
              <button onClick={submitBooking} className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">Request Booking</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
