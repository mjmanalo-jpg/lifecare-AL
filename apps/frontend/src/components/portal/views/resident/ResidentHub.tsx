"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity, Calendar, Bus, ConciergeBell, Megaphone, Search, X, RefreshCw, Eye,
  ChevronLeft, ChevronRight, Plus, Trash2, Star, CheckCircle2, Clock,
  HeartPulse, AlertTriangle, Pill, Droplets, Wind, Thermometer, MessageSquare,
  MapPin, Navigation, User, Car, Accessibility, Stethoscope, Siren, TreePine,
  UtensilsCrossed, CalendarDays, SlidersHorizontal, Pin, Loader2, Phone, FileText,
  type LucideIcon,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";
import { adaptResident, humanize } from "@/lib/adapters";
import {
  CATEGORY_META, PRIORITY_PILL, REQUEST_STATUS_PILL, TEAM_LABEL,
  autoAssignTeam, CONCIERGE_CATALOG, BOOKING_STATUS_PILL,
} from "../services/serviceMeta";
import {
  EVENT_CATEGORY_META, RSVP_PILL, DINING_STATUS_PILL, MEAL_TYPES, DINING_VENUES,
  ANNOUNCEMENT_PRIORITY_PILL, PREFERENCE_CATEGORIES,
} from "../pms/pmsMeta";

/* ── Helpers ── */
type Row = Record<string, unknown>;
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : v == null ? d : String(v));
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const fmtDT = (iso: string) => iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";
const fmtShort = (iso: string) => iso ? new Date(iso).toLocaleDateString() : "—";
const timeAgo = (iso: string) => {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return new Date(iso).toLocaleDateString();
  } catch { return ""; }
};

type TabKey = "report" | "appointments" | "transport" | "services" | "community";

/* ── Pagination ── */
function Pagination({ page, totalPages, total, label, setPage }: { page: number; totalPages: number; total: number; label: string; setPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between text-xs text-gray-500 pt-2">
      <span>{total} {label} total</span>
      <div className="flex items-center gap-1">
        <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} className="p-1.5 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40"><ChevronLeft className="w-3.5 h-3.5" /></button>
        <span className="px-2 font-semibold">{page}/{totalPages}</span>
        <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="p-1.5 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40"><ChevronRight className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
}

/* ── Stat Box ── */
function StatBox({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: LucideIcon; color: string }) {
  const COLORS: Record<string, string> = {
    blue: "text-blue-600 bg-blue-50 border-blue-200", green: "text-green-600 bg-green-50 border-green-200",
    amber: "text-amber-600 bg-amber-50 border-amber-200", purple: "text-purple-600 bg-purple-50 border-purple-200",
    rose: "text-rose-600 bg-rose-50 border-rose-200", gray: "text-gray-600 bg-gray-50 border-gray-200",
  };
  const c = COLORS[color] || COLORS.blue;
  return (
    <div className={`rounded-lg border p-3 ${c}`}>
      <div className="flex items-center justify-between mb-0.5">
        <p className="text-[10px] font-semibold text-gray-600">{label}</p>
        <Icon className={`w-3.5 h-3.5 ${c.split(" ")[0]}`} />
      </div>
      <p className={`text-xl font-bold ${c.split(" ")[0]}`}>{value}</p>
    </div>
  );
}

/* ── View Modal (type-aware) ── */
function ViewModal({ title, row, onClose }: { title: string; row: Row; onClose: () => void }) {
  const isTransport = row._tab === "transport";
  const isAppointment = row._tab === "appointments";
  const type = isTransport ? "transport" : isAppointment ? "appointment" : title.startsWith("Announcement") ? "announcement" : title.startsWith("Event") ? "event" : title.startsWith("Dining") ? "dining" : title.startsWith("Preference") ? "preference" : title.startsWith("Ticket") || row._tab === "services" ? "service" : "generic";

  if (type === "transport") {
    const reqType = str(row.type);
    const meta = { MEDICAL_APPOINTMENT: { label: "Medical Appointment", icon: Stethoscope, gradient: "from-blue-500 to-indigo-600" }, DIALYSIS: { label: "Dialysis Run", icon: Droplets, gradient: "from-cyan-500 to-blue-500" }, THERAPY: { label: "Therapy Run", icon: HeartPulse, gradient: "from-purple-500 to-pink-500" }, FAMILY_OUTING: { label: "Family Outing", icon: TreePine, gradient: "from-emerald-500 to-teal-500" }, EMERGENCY_TRANSFER: { label: "Emergency Transfer", icon: Siren, gradient: "from-red-500 to-rose-600" }, OTHER: { label: "Other", icon: Bus, gradient: "from-gray-500 to-slate-600" } }[reqType] ?? { label: reqType, icon: Bus, gradient: "from-gray-500 to-slate-600" };
    const TypeIcon = meta.icon;
    const status = str(row.status);
    const statusPill = REQUEST_STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600";
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
          <div className={`bg-gradient-to-r ${meta.gradient} px-4 sm:px-6 py-4 sm:py-5 text-white flex items-center justify-between`}>
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0"><TypeIcon className="w-5 h-5" /></div>
              <div className="min-w-0">
                <p className="text-white/70 text-xs font-medium">{meta.label}</p>
                <h2 className="font-bold text-base sm:text-lg truncate">{str(row.destination)}</h2>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition shrink-0"><X className="w-5 h-5" /></button>
          </div>
          <div className="p-4 sm:p-6 space-y-3 overflow-y-auto flex-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</span>
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${statusPill}`}>{status}</span>
            </div>
            {row.requestedDate && <div className="flex items-center justify-between py-2.5 border-b border-gray-100">
              <span className="text-xs text-gray-500 flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Date & Time</span>
              <span className="text-sm font-semibold text-gray-900">{fmtDT(str(row.requestedDate))}</span>
            </div>}
            {row.purpose && <div className="flex items-center justify-between py-2.5 border-b border-gray-100">
              <span className="text-xs text-gray-500 flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Purpose</span>
              <span className="text-sm text-gray-900 text-right max-w-[60%]">{str(row.purpose)}</span>
            </div>}
            <div className="flex items-center gap-4 py-2.5 border-b border-gray-100">
              <span className="text-xs text-gray-500 flex items-center gap-1.5"><Navigation className="w-3.5 h-3.5" /> Options</span>
              <div className="flex items-center gap-2 flex-wrap justify-end flex-1">
                {Boolean(row.wheelchairNeeded) && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold"><Accessibility className="w-3 h-3" /> Wheelchair</span>}
                {Boolean(row.escortRequired) && <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-semibold">Escort: {str(row.escortRole)}</span>}
                <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[10px] font-semibold">{row.returnRequired ? "Round Trip" : "One-Way"}</span>
              </div>
            </div>
            {row.source && <div className="flex items-center justify-between py-2.5 border-b border-gray-100">
              <span className="text-xs text-gray-500">Source</span>
              <span className="text-xs font-medium text-gray-700">{str(row.source)}</span>
            </div>}
            {row.notes && <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
              <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wide mb-1">Notes</p>
              <p className="text-sm text-blue-900 whitespace-pre-wrap">{str(row.notes)}</p>
            </div>}
          </div>
          <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
            <button onClick={onClose} className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold rounded-xl transition text-sm">Close</button>
          </div>
        </div>
      </div>
    );
  }

  if (type === "appointment") {
    const name = str(row.name ?? row.visitorName ?? "Guest");
    const initials = name.split(" ").map(w => w.charAt(0)).join("").slice(0, 2).toUpperCase();
    const status = str(row.status ?? "");
    const statusPill = status === "Scheduled" ? "bg-blue-100 text-blue-700" : status === "Completed" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700";
    const avatarColors: Record<string, string> = { S: "from-blue-500 to-indigo-500", A: "from-amber-500 to-orange-500", M: "from-emerald-500 to-teal-500", R: "from-rose-500 to-pink-500" };
    const gradient = avatarColors[name.charAt(0).toUpperCase()] ?? "from-purple-500 to-violet-500";
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
          <div className={`bg-gradient-to-r ${gradient} px-4 sm:px-6 py-4 sm:py-5 text-white flex items-center justify-between`}>
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="w-9 h-9 sm:w-12 sm:h-12 rounded-2xl bg-white/20 flex items-center justify-center text-sm sm:text-lg font-black shrink-0">{initials}</div>
              <div className="min-w-0">
                <p className="text-white/70 text-xs font-medium">Visit Appointment</p>
                <h2 className="font-bold text-base sm:text-lg truncate">{name}</h2>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition shrink-0"><X className="w-5 h-5" /></button>
          </div>
          <div className="p-4 sm:p-6 space-y-3 overflow-y-auto flex-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</span>
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${statusPill}`}>{status}</span>
            </div>
            {row.relationship && <div className="flex items-center justify-between py-2.5 border-b border-gray-100">
              <span className="text-xs text-gray-500 flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Relationship</span>
              <span className="text-sm font-semibold text-gray-900">{str(row.relationship)}</span>
            </div>}
            {(row.inTs || row.checkInTime) && <div className="flex items-center justify-between py-2.5 border-b border-gray-100">
              <span className="text-xs text-gray-500 flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Date & Time</span>
              <span className="text-sm font-semibold text-gray-900">{fmtDT(str(new Date(num(row.inTs) || str(row.checkInTime)).toISOString()))}</span>
            </div>}
            {row.purpose && <div className="flex items-center justify-between py-2.5 border-b border-gray-100">
              <span className="text-xs text-gray-500 flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Purpose</span>
              <span className="text-sm text-gray-900 text-right max-w-[60%]">{str(row.purpose)}</span>
            </div>}
            {row.phone && <div className="flex items-center justify-between py-2.5 border-b border-gray-100">
              <span className="text-xs text-gray-500 flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> Phone</span>
              <span className="text-sm text-gray-900">{str(row.phone)}</span>
            </div>}
            {row.durationMin ? <div className="flex items-center justify-between py-2.5 border-b border-gray-100">
              <span className="text-xs text-gray-500 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Duration</span>
              <span className="text-sm font-semibold text-gray-900">{num(row.durationMin)} min</span>
            </div> : null}
            {row.notes && <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
              <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wide mb-1">Notes</p>
              <p className="text-sm text-blue-900 whitespace-pre-wrap">{str(row.notes)}</p>
            </div>}
          </div>
          <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
            <button onClick={onClose} className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold rounded-xl transition text-sm">Close</button>
          </div>
        </div>
      </div>
    );
  }

  if (type === "announcement") {
    const priority = str(row.priority);
    const pill = ANNOUNCEMENT_PRIORITY_PILL[priority] ?? ANNOUNCEMENT_PRIORITY_PILL.NORMAL;
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
          <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-4 sm:px-6 py-4 sm:py-5 text-white flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                <Megaphone className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="font-bold text-base sm:text-lg truncate">{str(row.title)}</h2>
                <p className="text-white/70 text-xs">{str(row.authorName ?? "")}{row.publishedAt ? ` · ${fmtShort(str(row.publishedAt))}` : ""}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition shrink-0"><X className="w-5 h-5" /></button>
          </div>
          <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {Boolean(row.pinned) && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold"><Pin className="w-3 h-3" /> Pinned</span>}
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${pill}`}>{priority}</span>
            </div>
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{str(row.body || "No content.")}</p>
            </div>
            {row.publishedAt && <p className="text-xs text-gray-400 text-right">Published {fmtDT(str(row.publishedAt))}</p>}
          </div>
          <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
            <button onClick={onClose} className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold rounded-xl transition text-sm">Close</button>
          </div>
        </div>
      </div>
    );
  }

  if (type === "event") {
    const cat = EVENT_CATEGORY_META[str(row.category)] ?? EVENT_CATEGORY_META.SOCIAL;
    const CatIcon = cat.icon;
    const att = str((row as Row & { _attStatus?: string })._attStatus ?? "");
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
          {row.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={str(row.imageUrl)} alt="" className="w-full h-32 sm:h-40 object-cover" />
          ) : (
            <div className={`w-full h-32 sm:h-40 flex items-center justify-center ${cat.cls}`}><CatIcon className="w-12 h-12 sm:w-16 sm:h-16 opacity-30" /></div>
          )}
          <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
            <div>
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${cat.cls}`}><CatIcon className="w-3 h-3" /> {cat.label}</span>
              <h2 className="text-xl font-bold text-gray-900 mt-2">{str(row.title)}</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
                <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wide">Date & Time</p>
                <p className="text-sm font-semibold text-blue-900 mt-0.5">{fmtDT(str(row.startTime))}</p>
              </div>
              {row.location && <div className="bg-purple-50 rounded-xl p-3 border border-purple-100">
                <p className="text-[10px] font-semibold text-purple-500 uppercase tracking-wide">Location</p>
                <p className="text-sm font-semibold text-purple-900 mt-0.5 flex items-center gap-1"><MapPin className="w-3 h-3" /> {str(row.location)}</p>
              </div>}
              {row.capacity && <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-100">
                <p className="text-[10px] font-semibold text-emerald-500 uppercase tracking-wide">Capacity</p>
                <p className="text-sm font-semibold text-emerald-900 mt-0.5">{str(row.capacity)} spots</p>
              </div>}
              {row.host && <div className="bg-amber-50 rounded-xl p-3 border border-amber-100">
                <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-wide">Host</p>
                <p className="text-sm font-semibold text-amber-900 mt-0.5">{str(row.host)}</p>
              </div>}
            </div>
            {row.description && <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Description</p>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{str(row.description)}</p>
            </div>}
            {att && <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Your RSVP:</span>
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${RSVP_PILL[att] ?? "bg-gray-100 text-gray-600"}`}>{att}</span>
            </div>}
          </div>
          <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
            <button onClick={onClose} className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold rounded-xl transition text-sm">Close</button>
          </div>
        </div>
      </div>
    );
  }

  if (type === "dining") {
    const status = str(row.status);
    const pill = DINING_STATUS_PILL[status] ?? "bg-gray-100 text-gray-700";
    const mealColors: Record<string, string> = { BREAKFAST: "from-amber-400 to-orange-500", LUNCH: "from-emerald-400 to-teal-500", DINNER: "from-indigo-400 to-purple-500" };
    const gradient = mealColors[str(row.mealType)] ?? "from-blue-400 to-indigo-500";
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
          <div className={`bg-gradient-to-r ${gradient} px-4 sm:px-6 py-4 sm:py-5 text-white flex items-center justify-between`}>
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white/20 flex items-center justify-center"><UtensilsCrossed className="w-5 h-5" /></div>
              <div>
                <h2 className="font-bold text-base sm:text-lg">{str(row.mealType)}</h2>
                <p className="text-white/70 text-xs">{str(row.venue ?? "Dining")}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition"><X className="w-5 h-5" /></button>
          </div>
          <div className="p-4 sm:p-6 space-y-3 overflow-y-auto flex-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</span>
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${pill}`}>{status}</span>
            </div>
            {row.reservedAt && <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="text-xs text-gray-500">When</span>
              <span className="text-sm font-semibold text-gray-900">{fmtDT(str(row.reservedAt))}</span>
            </div>}
            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="text-xs text-gray-500">Party Size</span>
              <span className="text-sm font-semibold text-gray-900">{str(row.partySize ?? 1)} guests</span>
            </div>
            {row.guestNames && <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="text-xs text-gray-500">Guests</span>
              <span className="text-sm text-gray-900 text-right max-w-[60%]">{str(row.guestNames)}</span>
            </div>}
            {row.specialRequests && <div className="bg-amber-50 rounded-xl p-3 border border-amber-100">
              <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-wide mb-1">Special Requests</p>
              <p className="text-sm text-amber-900 whitespace-pre-wrap">{str(row.specialRequests)}</p>
            </div>}
          </div>
          <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
            <button onClick={onClose} className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold rounded-xl transition text-sm">Close</button>
          </div>
        </div>
      </div>
    );
  }

  if (type === "preference") {
    const catColors: Record<string, string> = { Dining: "from-orange-400 to-amber-500", "Room Comfort": "from-blue-400 to-indigo-500", Activities: "from-purple-400 to-pink-500", "Wake-Up": "from-emerald-400 to-teal-500", Communication: "from-cyan-400 to-blue-500" };
    const gradient = catColors[str(row.category)] ?? "from-gray-400 to-gray-500";
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
          <div className={`bg-gradient-to-r ${gradient} px-4 sm:px-6 py-4 sm:py-5 text-white flex items-center justify-between`}>
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white/20 flex items-center justify-center"><SlidersHorizontal className="w-5 h-5" /></div>
              <div>
                <p className="text-white/70 text-xs font-medium">{str(row.category)}</p>
                <h2 className="font-bold text-base sm:text-lg">{str(row.preference)}</h2>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition"><X className="w-5 h-5" /></button>
          </div>
          <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
            <div className="bg-gray-50 rounded-xl p-3 sm:p-4 border border-gray-100 text-center">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Value</p>
              <p className="text-xl sm:text-2xl font-black text-gray-900">{str(row.value)}</p>
            </div>
            {row.notes && <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
              <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wide mb-1">Notes</p>
              <p className="text-sm text-blue-900 whitespace-pre-wrap">{str(row.notes)}</p>
            </div>}
          </div>
          <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
            <button onClick={onClose} className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold rounded-xl transition text-sm">Close</button>
          </div>
        </div>
      </div>
    );
  }

  /* Generic fallback */
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 sm:px-5 py-3 sm:py-4 flex items-center justify-between z-10">
          <h2 className="font-bold text-gray-900 text-sm sm:text-base">{title}</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 sm:p-5 space-y-3">
          {Object.entries(row).filter(([k]) => !k.startsWith("_") && k !== "raw").map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 text-sm border-b border-gray-100 pb-2">
              <span className="text-gray-500 font-medium capitalize">{k.replace(/([A-Z])/g, " $1").trim()}</span>
              <span className="text-gray-900 text-right max-w-[60%] break-words">{v == null ? "—" : String(v)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════ */
/*                              MAIN HUB                                       */
/* ════════════════════════════════════════════════════════════════════════════ */

interface ResidentHubProps { initialTab?: TabKey; }

export default function ResidentHub({ initialTab = "report" }: ResidentHubProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [viewRow, setViewRow] = useState<Row | null>(null);
  const [viewTitle, setViewTitle] = useState("");

  const openView = (row: Row, title: string) => { setViewRow(row); setViewTitle(title); };

  return (
    <div className="space-y-5">
      {/* Tab Content — standalone, no tab bar */}
      {activeTab === "report" && <ReportTab />}
      {activeTab === "appointments" && <AppointmentsTab onView={openView} />}
      {activeTab === "transport" && <TransportTab onView={openView} />}
      {activeTab === "services" && <ServicesTab onView={openView} />}
      {activeTab === "community" && <CommunityTab onView={openView} />}

      {/* View Modal */}
      {viewRow && <ViewModal title={viewTitle} row={viewRow} onClose={() => setViewRow(null)} />}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════ */
/*                           REPORT TAB                                        */
/* ════════════════════════════════════════════════════════════════════════════ */

const SNAPSHOT = [
  { key: "HEART_RATE", label: "Heart Rate", icon: HeartPulse, color: "text-red-500" },
  { key: "BLOOD_PRESSURE", label: "Blood Pressure", icon: Droplets, color: "text-blue-500" },
  { key: "TEMPERATURE", label: "Temperature", icon: Thermometer, color: "text-orange-500" },
  { key: "OXYGEN", label: "Oxygen", icon: Wind, color: "text-green-500" },
];

function ReportTab() {
  const { data: residentRows } = useLiveQuery<Row>("residents", { query: "include=incidents,medications&take=1", tables: ["Resident", "Incident", "Medication"] });
  const { data: vitalsRows } = useLiveQuery<Row>("vitals", { query: "include=resident&take=50", tables: ["VitalsLog"] });
  const { data: visitRows } = useLiveQuery<Row>("visits", { query: "take=100", tables: ["Visit"] });
  const { data: messageRows } = useLiveQuery<Row>("messages", { query: "include=sender&take=100", tables: ["Message"] });

  const [nowTs, setNowTs] = useState(0);
  useEffect(() => { const tick = () => setNowTs(Date.now()); tick(); const t = setInterval(tick, 60000); return () => clearInterval(t); }, []);

  const relative = useMemo(() => residentRows.length ? adaptResident(residentRows[0]) : null, [residentRows]);
  const displayName = relative?.name ?? "Resident";

  const relVitals = useMemo(() => {
    if (!relative) return vitalsRows;
    return vitalsRows.filter(v => { const r = v.resident as Row | undefined; return v.residentId === relative.id || r?.roomNumber === relative.room; });
  }, [vitalsRows, relative]);

  const rawMeds = useMemo(() => (relative?.raw?.medications ?? []) as Row[], [relative]);
  const rawIncidents = useMemo(() => (relative?.raw?.incidents ?? []) as Row[], [relative]);

  const isToday = (iso: string) => {
    if (!iso || !nowTs) return false;
    const d = new Date(iso), n = new Date(nowTs);
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  };
  const vitalsToday = relVitals.filter(v => isToday(str(v.recordedAt))).length;
  const openAlerts = rawIncidents.filter(i => !i.resolvedAt).length;

  const latestVital = (type: string) => {
    let best: Row | undefined;
    for (const v of relVitals) { if (v.type !== type) continue; if (!best || new Date(str(v.recordedAt)) > new Date(str(best.recordedAt))) best = v; }
    return best;
  };

  type Ev = { icon: LucideIcon; color: string; title: string; detail: string; ts: number; when: string };
  const t = (iso: unknown) => (iso ? new Date(str(iso)).getTime() : 0);
  const events: Ev[] = [
    ...relVitals.map(v => ({ icon: HeartPulse, color: "text-red-500", title: `${humanize(str(v.type))} recorded`, detail: `${str(v.value)}${v.unit ? ` ${str(v.unit)}` : ""}`, ts: t(v.recordedAt), when: v.recordedAt ? fmtDT(str(v.recordedAt)) : "" })),
    ...rawIncidents.map(i => ({ icon: AlertTriangle, color: "text-orange-500", title: humanize(str(i.incidentType ?? "")) || "Incident", detail: str(i.description ?? ""), ts: t(i.incidentDate), when: i.incidentDate ? fmtDT(str(i.incidentDate)) : "" })),
    ...visitRows.map(v => ({ icon: Calendar, color: "text-purple-500", title: `Visit — ${str(v.visitorName ?? "Guest")}`, detail: str(v.purpose ?? ""), ts: t(v.checkInTime), when: v.checkInTime ? fmtDT(str(v.checkInTime)) : "" })),
    ...messageRows.map(m => ({ icon: MessageSquare, color: "text-blue-500", title: str(m.subject ?? humanize(str(m.messageType ?? ""))) || "Message", detail: str(m.content ?? ""), ts: t(m.createdAt), when: m.createdAt ? fmtDT(str(m.createdAt)) : "" })),
  ].filter(e => e.ts > 0).sort((a, b) => b.ts - a.ts).slice(0, 10);

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="bg-gradient-to-br from-green-50 to-blue-50 border border-green-200 rounded-lg p-3 sm:p-5">
        <p className="text-gray-800 text-xs sm:text-sm">
          {displayName} has <span className="font-bold">{vitalsToday}</span> vital reading{vitalsToday === 1 ? "" : "s"} today,
          <span className="font-bold"> {rawMeds.length}</span> active medication{rawMeds.length === 1 ? "" : "s"}, and
          {openAlerts > 0 ? <span className="font-bold text-red-600"> {openAlerts} open alert{openAlerts === 1 ? "" : "s"}</span> : <span className="font-bold text-green-600"> no open alerts</span>}.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <StatBox label="Vitals Today" value={vitalsToday} icon={HeartPulse} color="rose" />
        <StatBox label="Medications" value={rawMeds.length} icon={Pill} color="blue" />
        <StatBox label="Open Alerts" value={openAlerts} icon={AlertTriangle} color={openAlerts > 0 ? "amber" : "green"} />
        <StatBox label="Total Vitals" value={relVitals.length} icon={Activity} color="gray" />
      </div>

      {/* Vitals Snapshot */}
      <div>
        <h3 className="font-semibold text-gray-900 mb-3 text-sm">Vitals Snapshot</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
          {SNAPSHOT.map(({ key, label, icon: Icon, color }) => {
            const v = latestVital(key);
            return (
              <div key={key} className="bg-white p-3 sm:p-4 rounded-lg border border-gray-200">
                <p className="text-xs text-gray-600 font-semibold flex items-center gap-1"><Icon className={`w-3.5 h-3.5 ${color}`} /> {label}</p>
                <p className="text-xl sm:text-2xl font-bold text-gray-900 mt-1">{v ? str(v.value) : "—"}<span className="text-xs sm:text-sm font-medium text-gray-500 ml-1">{v?.unit ? str(v.unit) : ""}</span></p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        {/* Timeline */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-3 sm:p-5">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2 text-sm"><Activity className="w-4 h-4 text-blue-500" /> Activity Timeline</h3>
          {events.length > 0 ? (
            <ol className="relative border-l-2 border-gray-100 ml-2 space-y-4">
              {events.map((e, i) => {
                const Icon = e.icon;
                return (
                  <li key={i} className="ml-4">
                    <span className="absolute -left-[9px] flex items-center justify-center w-4 h-4 bg-white rounded-full ring-2 ring-gray-100"><Icon className={`w-3 h-3 ${e.color}`} /></span>
                    <div className="flex items-start justify-between gap-2 sm:gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 text-xs sm:text-sm">{e.title}</p>
                        {e.detail && <p className="text-xs text-gray-600 truncate">{e.detail}</p>}
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0">{e.when}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : <p className="text-sm text-gray-500 py-6 text-center">No recent activity.</p>}
        </div>

        {/* Medications */}
        <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-5">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2 text-sm"><Pill className="w-4 h-4 text-blue-500" /> Medications</h3>
          {rawMeds.length > 0 ? (
            <div className="space-y-2">
              {rawMeds.map((m, i) => (
                <div key={i} className="p-2.5 rounded-lg bg-blue-50 border border-blue-100">
                  <p className="font-medium text-gray-900 text-sm">{str(m.name ?? "")} <span className="text-gray-500 font-normal">{str(m.dosage ?? "")}</span></p>
                  <p className="text-xs text-gray-600">{str(m.frequency ?? "")}{m.status ? ` • ${humanize(str(m.status))}` : ""}</p>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-gray-500 py-4 text-center">No active medications.</p>}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════ */
/*                         APPOINTMENTS TAB                                    */
/* ════════════════════════════════════════════════════════════════════════════ */

const AVATAR_COLORS = ["bg-blue-100 text-blue-700", "bg-purple-100 text-purple-700", "bg-green-100 text-green-700", "bg-rose-100 text-rose-700", "bg-amber-100 text-amber-700"];

function AppointmentsTab({ onView }: { onView: (r: Row, title: string) => void }) {
  const { data: residentRows } = useLiveQuery<Row>("residents", { query: "include=incidents,medications&take=1", tables: ["Resident"] });
  const { data: visitRows, loading, refetch } = useLiveQuery<Row>("visits", { query: "take=100", tables: ["Visit"] });

  const [nowTs, setNowTs] = useState(0);
  useEffect(() => { const tick = () => setNowTs(Date.now()); tick(); const t = setInterval(tick, 60000); return () => clearInterval(t); }, []);
  const relative = useMemo(() => residentRows.length ? adaptResident(residentRows[0]) : null, [residentRows]);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<"all" | "upcoming" | "past">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const perPage = 10;
  const [form, setForm] = useState({ visitorName: "", relationship: "", purpose: "", date: "", phone: "", notes: "" });

  const enriched = useMemo(() => visitRows.map((v, i) => {
    const inTs = v.checkInTime ? new Date(str(v.checkInTime)).getTime() : 0;
    const outTs = v.checkOutTime ? new Date(str(v.checkOutTime)).getTime() : 0;
    const upcoming = inTs > nowTs;
    const name = str(v.visitorName ?? "Guest");
    return {
      id: str(v.id ?? i), name, relationship: str(v.relationship ?? ""), purpose: str(v.purpose ?? ""),
      phone: str(v.visitorPhone ?? ""), notes: str(v.notes ?? ""),
      inTs, outTs, upcoming, status: upcoming ? "Scheduled" : outTs ? "Completed" : "Visited",
      durationMin: outTs && inTs ? Math.round((outTs - inTs) / 60000) : 0,
      avatar: AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length], raw: v,
    };
  }), [visitRows, nowTs]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => enriched
    .filter(v => (filter === "all" ? true : filter === "upcoming" ? v.upcoming : !v.upcoming))
    .filter(v => !q || v.name.toLowerCase().includes(q) || v.relationship.toLowerCase().includes(q) || v.purpose.toLowerCase().includes(q))
    .sort((a, b) => (a.upcoming && b.upcoming ? a.inTs - b.inTs : b.inTs - a.inTs)),
  [enriched, filter, q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const monthCount = enriched.filter(v => { if (!v.inTs || !nowTs) return false; const d = new Date(v.inTs), n = new Date(nowTs); return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear(); }).length;
  const uniqueVisitors = new Set(enriched.map(v => v.name)).size;
  const statusBadge = (s: string) => s === "Scheduled" ? "bg-blue-100 text-blue-700" : s === "Completed" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700";

  const createVisit = async () => {
    if (!form.visitorName.trim() || !form.date) { Swal.fire({ title: "Missing info", text: "Visitor name and date/time are required.", icon: "warning" }); return; }
    if (!relative) { Swal.fire({ title: "No resident linked", icon: "error" }); return; }
    setSaving(true);
    try {
      await createRecord("visits", {
        residentId: relative.id, visitorName: form.visitorName.trim(),
        relationship: form.relationship.trim() || null, purpose: form.purpose.trim() || null,
        visitorPhone: form.phone.trim() || null, notes: form.notes.trim() || null,
        checkInTime: new Date(form.date).toISOString(),
      });
      await refetch(); setShowForm(false); setForm({ visitorName: "", relationship: "", purpose: "", date: "", phone: "", notes: "" });
      Swal.fire({ title: "Visit Requested", icon: "success", timer: 1400, showConfirmButton: false });
    } catch (err) { Swal.fire({ title: "Request Failed", text: err instanceof Error ? err.message : "Could not save visit.", icon: "error" }); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatBox label="Total Visits" value={enriched.length} icon={Calendar} color="gray" />
        <StatBox label="Upcoming" value={enriched.filter(v => v.upcoming).length} icon={Clock} color="blue" />
        <StatBox label="This Month" value={monthCount} icon={CheckCircle2} color="green" />
        <StatBox label="Visitors" value={uniqueVisitors} icon={Activity} color="rose" />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden bg-white self-start">
          {(["all", "upcoming", "past"] as const).map(f => (
            <button key={f} onClick={() => { setFilter(f); setPage(1); }} className={`px-4 py-2 text-sm font-medium capitalize transition ${filter === f ? "bg-yellow-500 text-black" : "text-gray-700 hover:bg-gray-50"}`}>{f}</button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search visitor, relationship, purpose…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
        </div>
        <button onClick={() => { setForm({ visitorName: "", relationship: "", purpose: "", date: "", phone: "", notes: "" }); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition text-sm whitespace-nowrap">
          <Plus className="w-4 h-4" /> Request Visit
        </button>
      </div>

      {/* List */}
      {loading && enriched.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500 text-sm">Loading appointments...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500 text-sm">{enriched.length === 0 ? "No visits recorded yet." : "No visits match your filters."}</div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          {/* Desktop table */}
          <div className="hidden md:block">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <Th>Visitor</Th><Th>Relationship</Th><Th>Purpose</Th><Th>Date</Th><Th>Status</Th><Th align="center">View</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paginated.map(v => (
                  <tr key={v.id} className="hover:bg-gray-50 transition">
                    <Td>
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${v.avatar}`}>{v.name.charAt(0).toUpperCase()}</div>
                        <span className="font-medium text-gray-900">{v.name}</span>
                      </div>
                    </Td>
                    <Td className="text-xs text-gray-600">{v.relationship || "—"}</Td>
                    <Td className="text-xs text-gray-600">{v.purpose || "—"}</Td>
                    <Td className="text-xs text-gray-500">{v.inTs ? fmtDT(str(new Date(v.inTs).toISOString())) : "—"}</Td>
                    <Td><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusBadge(v.status)}`}>{v.status}</span></Td>
                    <Td align="center">
                      <button onClick={() => onView({ ...v, _tab: "appointments" }, `Visit — ${v.name}`)} className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition" title="View"><Eye className="w-4 h-4" /></button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile cards */}
          <div className="md:hidden p-3 space-y-2">
            {paginated.map(v => (
              <div key={v.id} className="border border-gray-200 rounded-lg p-3 flex items-start gap-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${v.avatar}`}>{v.name.charAt(0).toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm text-gray-900 truncate">{v.name}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0 ${statusBadge(v.status)}`}>{v.status}</span>
                  </div>
                  {v.relationship && <p className="text-xs text-gray-500">{v.relationship}</p>}
                  <p className="text-xs text-gray-500 mt-1">{v.inTs ? fmtDT(str(new Date(v.inTs).toISOString())) : "—"}</p>
                  <button onClick={() => onView({ ...v, _tab: "appointments" }, `Visit — ${v.name}`)} className="mt-1 text-xs text-blue-600 font-semibold">View Details</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} total={filtered.length} label="visits" setPage={setPage} />

      {/* Request Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="bg-gradient-to-r from-purple-500 to-violet-600 px-4 sm:px-6 py-4 sm:py-5 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white/20 flex items-center justify-center"><Calendar className="w-5 h-5" /></div>
                <h2 className="text-lg sm:text-xl font-bold">Request a Visit</h2>
              </div>
              <button onClick={() => setShowForm(false)} className="p-2 hover:bg-white/20 rounded-xl transition"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 sm:p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Visitor Name *</label>
                  <input type="text" value={form.visitorName} onChange={e => setForm(f => ({ ...f, visitorName: e.target.value }))} placeholder="Full name" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:ring-2 focus:ring-purple-400 focus:border-purple-400 outline-none transition placeholder:text-gray-400" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Relationship</label>
                  <input type="text" value={form.relationship} onChange={e => setForm(f => ({ ...f, relationship: e.target.value }))} placeholder="e.g. Daughter, Son" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:ring-2 focus:ring-purple-400 focus:border-purple-400 outline-none transition placeholder:text-gray-400" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Date & Time *</label>
                <input type="datetime-local" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:ring-2 focus:ring-purple-400 focus:border-purple-400 outline-none transition" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Purpose</label>
                <input type="text" value={form.purpose} onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} placeholder="e.g. Birthday celebration" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:ring-2 focus:ring-purple-400 focus:border-purple-400 outline-none transition placeholder:text-gray-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Phone</label>
                <input type="text" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Contact number" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:ring-2 focus:ring-purple-400 focus:border-purple-400 outline-none transition placeholder:text-gray-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Notes <span className="text-gray-400 normal-case">(optional)</span></label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Any additional details…" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:ring-2 focus:ring-purple-400 focus:border-purple-400 outline-none transition placeholder:text-gray-400 resize-none" />
              </div>
            </div>
            <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="px-5 py-2.5 text-gray-600 hover:bg-gray-200 rounded-xl transition text-sm font-semibold">Cancel</button>
              <button onClick={() => void createVisit()} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-500 to-violet-600 text-white font-semibold rounded-xl hover:shadow-lg transition active:scale-95 disabled:opacity-60 text-sm">
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Plus className="w-4 h-4" /> Request Visit</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Table helpers ── */
function Th({ children, align }: { children: React.ReactNode; align?: string }) {
  return <th className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider${align === "center" ? " text-center" : ""}`}>{children}</th>;
}
function Td({ children, className = "", align }: { children: React.ReactNode; className?: string; align?: string }) {
  return <td className={`px-4 py-3 ${className}${align === "center" ? " text-center" : ""}`}>{children}</td>;
}

/* ════════════════════════════════════════════════════════════════════════════ */
/*                           TRANSPORT TAB                                     */
/* ════════════════════════════════════════════════════════════════════════════ */

const TYPE_META: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  MEDICAL_APPOINTMENT: { label: "Medical Appointment", icon: Stethoscope, color: "text-blue-600 bg-blue-50 border-blue-200" },
  DIALYSIS: { label: "Dialysis Run", icon: Droplets, color: "text-cyan-600 bg-cyan-50 border-cyan-200" },
  THERAPY: { label: "Therapy Run", icon: HeartPulse, color: "text-purple-600 bg-purple-50 border-purple-200" },
  FAMILY_OUTING: { label: "Family Outing", icon: TreePine, color: "text-green-600 bg-green-50 border-green-200" },
  EMERGENCY_TRANSFER: { label: "Emergency Transfer", icon: Siren, color: "text-red-600 bg-red-50 border-red-200" },
  OTHER: { label: "Other", icon: Bus, color: "text-gray-600 bg-gray-50 border-gray-200" },
};
const REQUEST_STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700", APPROVED: "bg-blue-100 text-blue-700", SCHEDULED: "bg-indigo-100 text-indigo-700",
  DECLINED: "bg-red-100 text-red-700", COMPLETED: "bg-green-100 text-green-700", CANCELLED: "bg-gray-100 text-gray-600",
};
const TRIP_STEPS = ["SCHEDULED", "INSPECTION", "EN_ROUTE", "ARRIVED", "RETURNING", "COMPLETED"];
const TRIP_STEP_LABELS: Record<string, string> = { SCHEDULED: "Scheduled", INSPECTION: "Inspection", EN_ROUTE: "En Route", ARRIVED: "Arrived", RETURNING: "Return", COMPLETED: "Drop-Off" };
const emptyTransportForm = { type: "MEDICAL_APPOINTMENT", destination: "", purpose: "", requestedDate: "", returnRequired: true, wheelchairNeeded: false, escortRequired: false, escortRole: "NURSE", notes: "" };

function TransportTab({ onView }: { onView: (r: Row, title: string) => void }) {
  const { data: residents } = useLiveQuery<Row>("residents", { query: "take=10", tables: ["Resident"] });
  const { data: requestRows, loading, error, refetch } = useLiveQuery<Row>("transport-requests", { query: "include=trip&take=100", tables: ["TransportRequest", "Trip"] });
  const { data: tripRows, refetch: refetchTrips } = useLiveQuery<Row>("trips", { query: "include=vehicle,driver&take=100", tables: ["Trip", "Vehicle", "Driver"], pollMs: 10000 });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyTransportForm);
  const [residentId, setResidentId] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const perPage = 10;

  const resolvedResidentId = residentId || str(residents[0]?.id ?? "");
  const residentName = useMemo(() => {
    const r = residents.find(x => str(x.id) === resolvedResidentId) ?? residents[0];
    return r ? `${str(r.firstName ?? "")} ${str(r.lastName ?? "")}`.trim() : "your resident";
  }, [residents, resolvedResidentId]);

  const requests = useMemo(() => [...requestRows].sort((a, b) => new Date(str(b.createdAt ?? 0)).getTime() - new Date(str(a.createdAt ?? 0)).getTime()), [requestRows]);
  const activeTrips = useMemo(() => tripRows.filter(t => ["SCHEDULED", "INSPECTION", "EN_ROUTE", "ARRIVED", "RETURNING"].includes(str(t.status))), [tripRows]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => requests.filter(r => {
    if (filter !== "all" && String(r.status) !== filter) return false;
    if (q && !str(r.destination).toLowerCase().includes(q) && !str(r.type).toLowerCase().includes(q)) return false;
    return true;
  }), [requests, filter, q]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const stats = useMemo(() => ({
    pending: requests.filter(r => r.status === "PENDING").length,
    scheduled: requests.filter(r => r.status === "SCHEDULED" || r.status === "APPROVED").length,
    live: activeTrips.filter(t => ["EN_ROUTE", "ARRIVED", "RETURNING"].includes(str(t.status))).length,
    completed: requests.filter(r => r.status === "COMPLETED").length,
  }), [requests, activeTrips]);

  const handleSubmit = async () => {
    if (!form.destination || !form.requestedDate) { Swal.fire({ title: "Missing Fields", text: "Destination and date/time are required.", icon: "warning" }); return; }
    if (!resolvedResidentId) { Swal.fire({ title: "No Resident Linked", icon: "warning" }); return; }
    try {
      await createRecord("transport-requests", {
        residentId: resolvedResidentId, type: form.type, destination: form.destination, purpose: form.purpose || null,
        requestedDate: new Date(form.requestedDate).toISOString(), returnRequired: form.returnRequired,
        wheelchairNeeded: form.wheelchairNeeded, escortRequired: form.escortRequired,
        escortRole: form.escortRequired ? form.escortRole : null,
        priority: form.type === "EMERGENCY_TRANSFER" ? "EMERGENCY" : "NORMAL",
        status: "PENDING", source: "PORTAL", notes: form.notes || null,
      });
      await refetch(); setShowForm(false); setForm(emptyTransportForm);
      Swal.fire({ title: "Request Sent", text: "Transport dispatcher has been notified.", icon: "success", timer: 2000, showConfirmButton: false });
    } catch (err) { Swal.fire({ title: "Request Failed", text: err instanceof Error ? err.message : "Could not send request.", icon: "error" }); }
  };

  const set = (field: string, value: unknown) => setForm(f => ({ ...f, [field]: value }));

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Pending" value={String(stats.pending)} icon={Clock} color="amber" />
        <StatBox label="Scheduled" value={String(stats.scheduled)} icon={Bus} color="blue" />
        <StatBox label="Live Now" value={String(stats.live)} icon={Navigation} color="green" />
        <StatBox label="Completed" value={String(stats.completed)} icon={CheckCircle2} color="purple" />
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {/* Live trips */}
      {activeTrips.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2"><Navigation className="w-4 h-4 text-green-600" /> Trips In Motion</h2>
          {activeTrips.map(trip => {
            const status = str(trip.status);
            const vehicle = trip.vehicle as Row | undefined;
            const driver = trip.driver as Row | undefined;
            const live = ["EN_ROUTE", "ARRIVED", "RETURNING"].includes(status);
            const stepIndex = TRIP_STEPS.indexOf(status);
            return (
              <div key={str(trip.id)} className={`bg-white rounded-lg border p-4 space-y-3 ${live ? "border-green-300 ring-1 ring-green-200" : "border-gray-200"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold text-gray-900 text-sm">
                    <MapPin className="w-4 h-4 text-yellow-500" /> {str(trip.origin ?? "Facility")} → {str(trip.destination ?? "")}
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${live ? "bg-green-100 text-green-700" : "bg-indigo-100 text-indigo-700"}`}>
                    {live && <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse mr-1.5" />}
                    {TRIP_STEP_LABELS[status] ?? status}
                  </span>
                </div>
                <div className="flex items-center gap-1">{TRIP_STEPS.map((step, i) => <div key={step} className="flex-1 flex items-center gap-1"><div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${i <= stepIndex ? "bg-yellow-500" : "bg-gray-200"}`} />{i < TRIP_STEPS.length - 1 && <div className={`h-0.5 flex-1 ${i < stepIndex ? "bg-yellow-400" : "bg-gray-200"}`} />}</div>)}</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div className="flex items-center gap-2 text-gray-700"><Car className="w-3.5 h-3.5 text-gray-400" />{vehicle ? `${str(vehicle.name)} · ${str(vehicle.licensePlate)}` : "Vehicle pending"}</div>
                  <div className="flex items-center gap-2 text-gray-700"><User className="w-3.5 h-3.5 text-gray-400" />{driver ? str(driver.name) : "Driver pending"}</div>
                  <div className="flex items-center gap-2 text-gray-700"><Clock className="w-3.5 h-3.5 text-gray-400" />{trip.scheduledAt ? fmtDT(str(trip.scheduledAt)) : "—"}</div>
                </div>
                {live && trip.lastPingAt ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs text-green-800 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="font-bold flex items-center gap-1"><Navigation className="w-3.5 h-3.5" /> Live GPS</span>
                    <span>Last ping {timeAgo(str(trip.lastPingAt))}</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Filters + Request button */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden bg-white self-start flex-wrap">
          {["all", "PENDING", "APPROVED", "SCHEDULED", "COMPLETED"].map(s => (
            <button key={s} onClick={() => { setFilter(s); setPage(1); }} className={`px-3 py-1.5 text-xs font-semibold capitalize transition ${filter === s ? "bg-yellow-500 text-black" : "text-gray-600 hover:bg-gray-50"}`}>{s === "all" ? "All" : s}</button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search destination, type…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none" />
        </div>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition text-sm whitespace-nowrap">
          <Plus className="w-4 h-4" /> Request Transport
        </button>
      </div>

      {/* Request history table */}
      {loading && requests.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500 text-sm">Loading transport requests…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500 text-sm">No transport requests match.</div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <div className="hidden md:block">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr><Th>Type</Th><Th>Destination</Th><Th>Date</Th><Th>Options</Th><Th>Status</Th><Th align="center">View</Th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paginated.map(r => {
                  const meta = TYPE_META[str(r.type)] ?? TYPE_META.OTHER;
                  const Icon = meta.icon;
                  const status = str(r.status);
                  return (
                    <tr key={str(r.id)} className="hover:bg-gray-50 transition">
                      <Td>
                        <div className="flex items-center gap-2">
                          <div className={`w-7 h-7 rounded-lg border flex items-center justify-center flex-shrink-0 ${meta.color}`}><Icon className="w-4 h-4" /></div>
                          <span className="font-medium text-gray-900 text-xs">{meta.label}</span>
                        </div>
                      </Td>
                      <Td className="text-xs text-gray-900">{str(r.destination)}</Td>
                      <Td className="text-xs text-gray-500">{r.requestedDate ? fmtDT(str(r.requestedDate)) : "—"}</Td>
                      <Td className="text-xs text-gray-500">
                        {Boolean(r.wheelchairNeeded) && <span title="Wheelchair"><Accessibility className="w-3.5 h-3.5 text-blue-500 inline" /> </span>}
                        {Boolean(r.escortRequired) && <span className="text-[10px] font-semibold px-1 py-0.5 rounded bg-purple-50 text-purple-600">Escort</span>}
                        {r.returnRequired ? "Round" : "One-way"}
                      </Td>
                      <Td><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${REQUEST_STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600"}`}>{status}</span></Td>
                      <Td align="center">
                        <button onClick={() => onView({ ...r, _tab: "transport" }, `${meta.label} — ${str(r.destination)}`)} className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition"><Eye className="w-4 h-4" /></button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="md:hidden p-3 space-y-2">
            {paginated.map(r => {
              const meta = TYPE_META[str(r.type)] ?? TYPE_META.OTHER;
              const Icon = meta.icon;
              const status = str(r.status);
              return (
                <div key={str(r.id)} className="border border-gray-200 rounded-lg p-3 flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0 ${meta.color}`}><Icon className="w-4 h-4" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm text-gray-900 truncate">{meta.label}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 ${REQUEST_STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600"}`}>{status}</span>
                    </div>
                    <p className="text-xs text-gray-500">{str(r.destination)}</p>
                    <p className="text-xs text-gray-400">{r.requestedDate ? fmtDT(str(r.requestedDate)) : "—"}</p>
                    <button onClick={() => onView({ ...r, _tab: "transport" }, `${meta.label} — ${str(r.destination)}`)} className="mt-1 text-xs text-blue-600 font-semibold">View Details</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} total={filtered.length} label="requests" setPage={setPage} />

      {/* Request Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="bg-gradient-to-r from-blue-500 to-indigo-600 px-4 sm:px-6 py-4 sm:py-5 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white/20 flex items-center justify-center"><Bus className="w-5 h-5" /></div>
                <h2 className="text-lg sm:text-xl font-bold">Request Transport</h2>
              </div>
              <button onClick={() => setShowForm(false)} className="p-2 hover:bg-white/20 rounded-xl transition"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 sm:p-6 space-y-4">
              {residents.length > 1 && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Resident</label>
                  <select value={resolvedResidentId} onChange={e => setResidentId(e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition">
                    {residents.map(r => <option key={str(r.id)} value={str(r.id)}>{str(r.firstName)} {str(r.lastName)} — Room {str(r.roomNumber)}</option>)}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Trip Type</label>
                  <select value={form.type} onChange={e => set("type", e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition">
                    {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Date & Time</label>
                  <input type="datetime-local" value={form.requestedDate} onChange={e => set("requestedDate", e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Destination</label>
                  <input type="text" value={form.destination} onChange={e => set("destination", e.target.value)} placeholder="e.g. St. Luke's Medical Center" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition placeholder:text-gray-400" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Purpose</label>
                  <input type="text" value={form.purpose} onChange={e => set("purpose", e.target.value)} placeholder="e.g. Cardiology follow-up" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition placeholder:text-gray-400" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl cursor-pointer text-sm select-none transition hover:bg-gray-100"><input type="checkbox" checked={form.returnRequired} onChange={e => set("returnRequired", e.target.checked)} className="rounded" />Round trip</label>
                <label className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl cursor-pointer text-sm select-none transition hover:bg-gray-100"><input type="checkbox" checked={form.wheelchairNeeded} onChange={e => set("wheelchairNeeded", e.target.checked)} className="rounded" /><Accessibility className="w-4 h-4 text-blue-500" /> Wheelchair</label>
                <label className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl cursor-pointer text-sm select-none transition hover:bg-gray-100"><input type="checkbox" checked={form.escortRequired} onChange={e => set("escortRequired", e.target.checked)} className="rounded" />Escort</label>
              </div>
              {form.escortRequired && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Escort Role</label>
                  <select value={form.escortRole} onChange={e => set("escortRole", e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition">
                    <option value="NURSE">Nurse</option><option value="CAREGIVER">Caregiver</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Notes <span className="text-gray-400 normal-case">(optional)</span></label>
                <textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2} placeholder="Any additional details…" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition placeholder:text-gray-400 resize-none" />
              </div>
            </div>
            <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="px-5 py-2.5 text-gray-600 hover:bg-gray-200 rounded-xl transition text-sm font-semibold">Cancel</button>
              <button onClick={handleSubmit} className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-semibold rounded-xl hover:shadow-lg transition active:scale-95 text-sm">Send Request</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════ */
/*                           SERVICES TAB                                      */
/* ════════════════════════════════════════════════════════════════════════════ */

const svcRequestForm = { category: "HOUSEKEEPING", subType: "Room Clean", priority: "ROUTINE", details: "" };
const svcBookingForm = { category: "SALON_BARBER", scheduledAt: "", notes: "" };

function ServicesTab({ onView }: { onView: (r: Row, title: string) => void }) {
  const { data: residents } = useLiveQuery<Row>("residents", { query: "take=10", tables: ["Resident"] });
  const { data: ticketRows, loading, error, refetch } = useLiveQuery<Row>("service-requests", { query: "take=100", tables: ["ServiceRequest"] });
  const bookingsQ = useLiveQuery<Row>("concierge-bookings", { query: "take=100", tables: ["ConciergeBooking"] });

  const [showRequest, setShowRequest] = useState(false);
  const [showBooking, setShowBooking] = useState(false);
  const [reqForm, setReqForm] = useState(svcRequestForm);
  const [bookForm, setBookForm] = useState(svcBookingForm);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const perPage = 10;

  const resident = residents[0];
  const residentId = str(resident?.id ?? "");
  const residentName = resident ? `${str(resident.firstName ?? "")} ${str(resident.lastName ?? "")}`.trim() : "your resident";

  const tickets = useMemo(() => [...ticketRows].sort((a, b) => new Date(str(b.createdAt ?? 0)).getTime() - new Date(str(a.createdAt ?? 0)).getTime()), [ticketRows]);
  const bookings = useMemo(() => [...bookingsQ.data].sort((a, b) => new Date(str(b.createdAt ?? 0)).getTime() - new Date(str(a.createdAt ?? 0)).getTime()), [bookingsQ.data]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => tickets.filter(t => {
    if (q && !str(CATEGORY_META[str(t.category)]?.label ?? "").toLowerCase().includes(q) && !str(t.subType).toLowerCase().includes(q) && !str(t.details).toLowerCase().includes(q)) return false;
    return true;
  }), [tickets, q]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);
  const awaitingConfirm = tickets.filter(t => str(t.status) === "COMPLETED");
  const hasAwaiting = awaitingConfirm.length > 0;

  const submitRequest = async () => {
    if (!reqForm.details) { Swal.fire({ title: "Missing Details", text: "Please describe what you need.", icon: "warning" }); return; }
    if (!residentId) { Swal.fire({ title: "No Resident Linked", icon: "warning" }); return; }
    const team = autoAssignTeam(reqForm.category, reqForm.subType);
    try {
      await createRecord("service-requests", {
        residentId, roomNumber: str(resident?.roomNumber ?? "") || null,
        category: reqForm.category, subType: reqForm.subType || null, details: reqForm.details,
        source: "RESIDENT_PORTAL", priority: reqForm.priority, status: "ASSIGNED", assignedTeam: team,
      });
      await refetch(); setShowRequest(false); setReqForm(svcRequestForm);
      Swal.fire({ title: "Request Sent", text: `Assigned to ${TEAM_LABEL[team]?.toLowerCase() ?? team}.`, icon: "success", timer: 2200, showConfirmButton: false });
    } catch (err) { Swal.fire({ title: "Request Failed", text: err instanceof Error ? err.message : "Could not send request.", icon: "error" }); }
  };

  const confirmAndRate = async (t: Row) => {
    const result = await Swal.fire({
      title: "Confirm & Rate Service",
      html: `<p style="font-size:14px;margin-bottom:10px">How satisfied are you? (1–5 ★)</p><select id="swal-rating" class="swal2-select" style="width:80%"><option value="5">★★★★★ Excellent</option><option value="4">★★★★ Good</option><option value="3">★★★ Okay</option><option value="2">★★ Poor</option><option value="1">★ Very poor</option></select><input id="swal-comment" class="swal2-input" placeholder="Comment (optional)">`,
      icon: "question", showCancelButton: true, confirmButtonColor: "#22c55e", cancelButtonColor: "#6b7280",
      preConfirm: () => ({ rating: Number((document.getElementById("swal-rating") as HTMLSelectElement | null)?.value ?? 5) || 5, comment: (document.getElementById("swal-comment") as HTMLInputElement | null)?.value ?? "" }),
    });
    if (!result.isConfirmed) return;
    const { rating, comment } = (result.value as { rating: number; comment: string }) ?? { rating: 5, comment: "" };
    setBusyId(str(t.id));
    try {
      await updateRecord("service-requests", str(t.id), { status: "CONFIRMED", rating, ratingComment: comment || null });
      await refetch();
      Swal.fire({ title: "Thank You!", icon: "success", timer: 1800, showConfirmButton: false });
    } catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not confirm.", icon: "error" }); }
    finally { setBusyId(null); }
  };

  const submitBooking = async () => {
    if (!bookForm.scheduledAt) { Swal.fire({ title: "Missing Schedule", icon: "warning" }); return; }
    if (!residentId) { Swal.fire({ title: "No Resident Linked", icon: "warning" }); return; }
    const cat = CONCIERGE_CATALOG[bookForm.category];
    try {
      await createRecord("concierge-bookings", {
        residentId, category: bookForm.category, serviceName: cat?.label ?? bookForm.category,
        scheduledAt: new Date(bookForm.scheduledAt).toISOString(), status: "REQUESTED",
        price: cat?.defaultPrice ?? 0, billable: cat?.billable ?? false, notes: bookForm.notes || null,
      });
      await bookingsQ.refetch(); setShowBooking(false); setBookForm(svcBookingForm);
      Swal.fire({ title: "Booking Requested", icon: "success", timer: 2200, showConfirmButton: false });
    } catch (err) { Swal.fire({ title: "Booking Failed", text: err instanceof Error ? err.message : "Could not send booking.", icon: "error" }); }
  };

  const cancelBooking = async (b: Row) => {
    const confirmed = await Swal.fire({ title: "Cancel Booking?", text: `Cancel "${str(b.serviceName)}"?`, icon: "warning", showCancelButton: true, confirmButtonColor: "#ef4444" });
    if (!confirmed.isConfirmed) return;
    setBusyId(str(b.id));
    try { await updateRecord("concierge-bookings", str(b.id), { status: "CANCELLED" }); await bookingsQ.refetch(); }
    catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not cancel.", icon: "error" }); }
    finally { setBusyId(null); }
  };

  return (
    <div className="space-y-5">
      {/* Confirm & rate banner */}
      {hasAwaiting && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2"><CheckCircle2 className="w-5 h-5 text-green-600" /><h3 className="font-semibold text-green-900 text-sm">Service done — please confirm & rate</h3></div>
          <div className="space-y-2">
            {awaitingConfirm.map(t => (
              <div key={str(t.id)} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white border border-green-200 rounded-lg px-3 py-2">
                <div className="min-w-0"><p className="text-sm font-medium text-gray-900 truncate">{CATEGORY_META[str(t.category)]?.label ?? str(t.category)}{t.subType ? ` — ${str(t.subType)}` : ""}</p></div>
                {busyId === str(t.id) ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" /> :
                  <button onClick={() => confirmAndRate(t)} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg transition whitespace-nowrap"><Star className="w-3.5 h-3.5" /> Confirm & Rate</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category cards */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 text-sm mb-3">Request a Service</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {Object.entries(CATEGORY_META).map(([k, m]) => {
            const Icon = m.icon;
            return (
              <button key={k} onClick={() => { setReqForm({ ...svcRequestForm, category: k, subType: m.subTypes[0] }); setShowRequest(true); }}
                className={`text-left border rounded-lg p-3 hover:shadow-md transition ${m.cls}`}>
                <Icon className="w-5 h-5 mb-1.5" /><p className="text-xs font-semibold text-gray-900 leading-tight">{m.label}</p><p className="text-[10px] text-gray-500 leading-tight mt-0.5">{m.sub}</p>
              </button>
            );
          })}
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {/* Search + tickets */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search service requests…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none" />
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 text-sm mb-3">My Service Requests</h3>
        {loading && tickets.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">Loading your requests…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">{tickets.length === 0 ? "No service requests yet — tap a card above." : "No requests match your search."}</p>
        ) : (
          <div className="space-y-2">
            {paginated.map(t => {
              const meta = CATEGORY_META[str(t.category)] ?? CATEGORY_META.HOUSEKEEPING;
              const Icon = meta.icon;
              const status = str(t.status);
              const rating = num(t.rating ?? 0);
              const hasCharge = num(t.charge ?? 0) > 0;
              return (
                <div key={str(t.id)} className="border border-gray-200 rounded-lg p-3 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className={`p-2 rounded-lg border flex-shrink-0 ${meta.cls}`}><Icon className="w-4 h-4" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-900">{meta.label}{t.subType ? ` — ${str(t.subType)}` : ""}</p>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${REQUEST_STATUS_PILL[status] ?? "bg-gray-100 text-gray-700"}`}>{status.replace(/_/g, " ")}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${PRIORITY_PILL[str(t.priority)] ?? PRIORITY_PILL.ROUTINE}`}>{str(t.priority)}</span>
                      </div>
                      {str(t.details ?? "") && <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{str(t.details)}</p>}
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {t.assignedTeam ? `${TEAM_LABEL[str(t.assignedTeam)] ?? t.assignedTeam} · ` : ""}{timeAgo(str(t.createdAt ?? ""))}
                        {hasCharge && ` · ₱${num(t.charge).toLocaleString()}${t.billed ? " (on invoice)" : ""}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:flex-col sm:items-end flex-shrink-0">
                    {rating >= 1 && <span className="inline-flex items-center gap-0.5 text-amber-500 font-semibold text-xs whitespace-nowrap">{rating} <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" /></span>}
                    {status === "COMPLETED" && <button onClick={() => confirmAndRate(t)} className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg transition whitespace-nowrap">Confirm & Rate</button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <Pagination page={page} totalPages={totalPages} total={filtered.length} label="requests" setPage={setPage} />
      </div>

      {/* Concierge */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3"><ConciergeBell className="w-4 h-4 text-yellow-500" /><h3 className="font-semibold text-gray-900 text-sm">Concierge & Premium Services</h3></div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-4">
          {Object.entries(CONCIERGE_CATALOG).map(([k, c]) => {
            const Icon = c.icon;
            return (
              <button key={k} onClick={() => { setBookForm({ ...svcBookingForm, category: k }); setShowBooking(true); }}
                className={`text-left border rounded-lg p-2.5 hover:shadow-md transition ${c.cls}`}>
                <Icon className="w-4 h-4 mb-1" /><p className="text-xs font-semibold text-gray-900 leading-tight">{c.label}</p>
                <p className="text-[10px] text-gray-500 leading-tight mt-0.5">{c.defaultPrice ? `from ₱${c.defaultPrice}` : "Complimentary"}</p>
              </button>
            );
          })}
        </div>
        {bookings.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">My Bookings</h4>
            {bookings.slice(0, 10).map(b => {
              const cat = CONCIERGE_CATALOG[str(b.category)];
              const Icon = cat?.icon ?? ConciergeBell;
              const status = str(b.status);
              const hasPrice = num(b.price ?? 0) > 0;
              return (
                <div key={str(b.id)} className="border border-gray-200 rounded-lg p-3 flex items-center gap-3">
                  <div className={`p-2 rounded-lg border ${cat?.cls ?? "text-gray-600 bg-gray-50 border-gray-200"}`}><Icon className="w-4 h-4" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-900">{str(b.serviceName)}</p>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${BOOKING_STATUS_PILL[status] ?? "bg-gray-100 text-gray-700"}`}>{status.replace(/_/g, " ")}</span>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5">{b.scheduledAt ? fmtDT(str(b.scheduledAt)) : ""}{hasPrice ? ` · ₱${num(b.price).toLocaleString()}` : " · Complimentary"}</p>
                  </div>
                  {["REQUESTED", "CONFIRMED"].includes(status) && (busyId === str(b.id) ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" /> :
                    <button onClick={() => cancelBooking(b)} className="p-1.5 rounded hover:bg-red-100 text-red-500 transition" title="Cancel"><Trash2 className="w-4 h-4" /></button>)}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Request Modal */}
      {showRequest && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black px-4 sm:px-5 py-4 sm:py-5 flex items-center justify-between z-10">
              <h2 className="text-lg sm:text-xl font-bold">Request {CATEGORY_META[reqForm.category]?.label ?? "a Service"}</h2>
              <button onClick={() => setShowRequest(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-5 h-5 sm:w-6 sm:h-6" /></button>
            </div>
            <div className="p-4 sm:p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="block text-sm font-semibold text-gray-700 mb-1">Type</label>
                  <select value={reqForm.subType} onChange={e => setReqForm(f => ({ ...f, subType: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    {(CATEGORY_META[reqForm.category]?.subTypes ?? []).map(s => <option key={s} value={s}>{s}</option>)}
                  </select></div>
                <div><label className="block text-sm font-semibold text-gray-700 mb-1">Priority</label>
                  <select value={reqForm.priority} onChange={e => setReqForm(f => ({ ...f, priority: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    <option value="ROUTINE">Routine</option><option value="URGENT">Urgent</option><option value="EMERGENCY">Emergency</option>
                  </select></div>
                <div className="col-span-2"><label className="block text-sm font-semibold text-gray-700 mb-1">What do you need?</label>
                  <textarea value={reqForm.details} onChange={e => setReqForm(f => ({ ...f, details: e.target.value }))} rows={3} placeholder="Describe your request…" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
                <div className="col-span-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-800">Goes to: <strong>{TEAM_LABEL[autoAssignTeam(reqForm.category, reqForm.subType)]}</strong> · Room {str(resident?.roomNumber ?? "—")}</div>
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
              <button onClick={() => setShowRequest(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition text-sm">Cancel</button>
              <button onClick={submitRequest} className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">Send Request</button>
            </div>
          </div>
        </div>
      )}

      {/* Booking Modal */}
      {showBooking && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black px-4 sm:px-5 py-4 sm:py-5 flex items-center justify-between z-10">
              <h2 className="text-lg sm:text-xl font-bold">Book {CONCIERGE_CATALOG[bookForm.category]?.label ?? "a Service"}</h2>
              <button onClick={() => setShowBooking(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-5 h-5 sm:w-6 sm:h-6" /></button>
            </div>
            <div className="p-4 sm:p-6 space-y-4">
              <p className="text-sm text-gray-600">{CONCIERGE_CATALOG[bookForm.category]?.desc}</p>
              <div><label className="block text-sm font-semibold text-gray-700 mb-1">Preferred Date & Time</label>
                <input type="datetime-local" value={bookForm.scheduledAt} onChange={e => setBookForm(f => ({ ...f, scheduledAt: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
              <div><label className="block text-sm font-semibold text-gray-700 mb-1">Notes (optional)</label>
                <textarea value={bookForm.notes} onChange={e => setBookForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
              {(CONCIERGE_CATALOG[bookForm.category]?.defaultPrice ?? 0) > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-800">Billable — from <strong>₱{CONCIERGE_CATALOG[bookForm.category].defaultPrice}</strong>, posted to monthly invoice.</div>
              )}
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
              <button onClick={() => setShowBooking(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition text-sm">Cancel</button>
              <button onClick={submitBooking} className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">Request Booking</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════ */
/*                          COMMUNITY TAB                                      */
/* ════════════════════════════════════════════════════════════════════════════ */

const commDiningForm0 = { mealType: "DINNER", reservedAt: "", partySize: "1", venue: "Main Dining", specialRequests: "", guestNames: "" };
const commPrefForm0 = { category: "Room Comfort", preference: "", value: "", notes: "" };

function CommunityTab({ onView }: { onView: (r: Row, title: string) => void }) {
  const { data: residents } = useLiveQuery<Row>("residents", { query: "take=10", tables: ["Resident"] });
  const annQ = useLiveQuery<Row>("announcements", { query: "f_published=true&take=50", tables: ["Announcement"] });
  const eventsQ = useLiveQuery<Row>("community-events", { query: "f_published=true&take=100", tables: ["CommunityEvent"] });
  const rsvpQ = useLiveQuery<Row>("event-attendances", { query: "take=200", tables: ["EventAttendance"] });
  const diningQ = useLiveQuery<Row>("dining-reservations", { query: "take=100", tables: ["DiningReservation"] });
  const prefsQ = useLiveQuery<Row>("resident-preferences", { query: "take=100", tables: ["ResidentPreference"] });

  const [showDining, setShowDining] = useState(false);
  const [diningForm, setDiningForm] = useState(commDiningForm0);
  const [showPref, setShowPref] = useState(false);
  const [prefForm, setPrefForm] = useState(commPrefForm0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const perPage = 8;

  const resident = residents[0];
  const residentId = str(resident?.id ?? "");

  const rsvpByEvent = useMemo(() => { const map: Record<string, Row> = {}; rsvpQ.data.forEach(a => { map[str(a.eventId)] = a; }); return map; }, [rsvpQ.data]);
  const events = useMemo(() => [...eventsQ.data].sort((a, b) => new Date(str(a.startTime)).getTime() - new Date(str(b.startTime)).getTime()), [eventsQ.data]);
  const announcements = useMemo(() => [...annQ.data].sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (new Date(str(b.publishedAt ?? 0)).getTime() - new Date(str(a.publishedAt ?? 0)).getTime())), [annQ.data]);
  const prefsByCategory = useMemo(() => { const map: Record<string, Row[]> = {}; prefsQ.data.forEach(p => { const c = str(p.category); (map[c] ??= []).push(p); }); return map; }, [prefsQ.data]);

  const q = search.trim().toLowerCase();
  const filteredEvents = useMemo(() => events.filter(e => {
    if (q && !str(e.title).toLowerCase().includes(q) && !str(e.category).toLowerCase().includes(q)) return false;
    return true;
  }), [events, q]);
  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / perPage));
  const paginatedEvents = filteredEvents.slice((page - 1) * perPage, page * perPage);

  const rsvp = async (eventId: string, status: string) => {
    if (!residentId) { Swal.fire({ title: "No Resident Linked", icon: "warning" }); return; }
    setBusyId(eventId);
    try {
      const existing = rsvpByEvent[eventId];
      if (existing) await updateRecord("event-attendances", str(existing.id), { status });
      else await createRecord("event-attendances", { eventId, residentId, status });
      await rsvpQ.refetch();
    } catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not update RSVP.", icon: "error" }); }
    finally { setBusyId(null); }
  };

  const rateEvent = async (attendanceId: string) => {
    const result = await Swal.fire({
      title: "Rate this Event", html: `<select id="swal-rating" class="swal2-select" style="width:80%"><option value="5">★★★★★ Excellent</option><option value="4">★★★★ Good</option><option value="3">★★★ Okay</option><option value="2">★★ Poor</option><option value="1">★ Very poor</option></select>`,
      icon: "question", showCancelButton: true, confirmButtonColor: "#22c55e", cancelButtonColor: "#6b7280",
      preConfirm: () => Number((document.getElementById("swal-rating") as HTMLSelectElement | null)?.value ?? 5) || 5,
    });
    if (!result.isConfirmed) return;
    setBusyId(attendanceId);
    try { await updateRecord("event-attendances", attendanceId, { status: "ATTENDED", rating: Number(result.value) }); await rsvpQ.refetch(); Swal.fire({ title: "Thank You!", icon: "success", timer: 1400, showConfirmButton: false }); }
    catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not submit rating.", icon: "error" }); }
    finally { setBusyId(null); }
  };

  const submitDining = async () => {
    if (!diningForm.reservedAt) { Swal.fire({ title: "Missing Time", icon: "warning" }); return; }
    if (!residentId) { Swal.fire({ title: "No Resident Linked", icon: "warning" }); return; }
    try {
      await createRecord("dining-reservations", {
        residentId, mealType: diningForm.mealType, reservedAt: new Date(diningForm.reservedAt).toISOString(),
        partySize: Number(diningForm.partySize) || 1, venue: diningForm.venue || null,
        specialRequests: diningForm.specialRequests || null, guestNames: diningForm.guestNames || null, status: "REQUESTED",
      });
      await diningQ.refetch(); setShowDining(false); setDiningForm(commDiningForm0);
      Swal.fire({ title: "Reservation Requested", icon: "success", timer: 1800, showConfirmButton: false });
    } catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not reserve.", icon: "error" }); }
  };

  const cancelDining = async (id: string) => {
    const confirmed = await Swal.fire({ title: "Cancel Reservation?", icon: "warning", showCancelButton: true, confirmButtonColor: "#ef4444" });
    if (!confirmed.isConfirmed) return;
    setBusyId(id);
    try { await updateRecord("dining-reservations", id, { status: "CANCELLED" }); await diningQ.refetch(); }
    catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not cancel.", icon: "error" }); }
    finally { setBusyId(null); }
  };

  const savePref = async () => {
    if (!prefForm.preference || !prefForm.value) { Swal.fire({ title: "Missing Fields", icon: "warning" }); return; }
    if (!residentId) { Swal.fire({ title: "No Resident Linked", icon: "warning" }); return; }
    try {
      await createRecord("resident-preferences", { residentId, category: prefForm.category, preference: prefForm.preference, value: prefForm.value, notes: prefForm.notes || null });
      await prefsQ.refetch(); setShowPref(false); setPrefForm(commPrefForm0);
      Swal.fire({ title: "Preference Saved", icon: "success", timer: 1400, showConfirmButton: false });
    } catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not save.", icon: "error" }); }
  };

  const deletePref = async (id: string) => {
    const confirmed = await Swal.fire({ title: "Remove Preference?", icon: "warning", showCancelButton: true, confirmButtonColor: "#ef4444" });
    if (!confirmed.isConfirmed) return;
    setBusyId(id);
    try { await deleteRecord("resident-preferences", id); await prefsQ.refetch(); }
    catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not remove.", icon: "error" }); }
    finally { setBusyId(null); }
  };

  const refreshAll = () => { annQ.refetch(); eventsQ.refetch(); rsvpQ.refetch(); diningQ.refetch(); prefsQ.refetch(); };

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatBox label="Announcements" value={announcements.length} icon={Megaphone} color="blue" />
        <StatBox label="Events" value={events.length} icon={CalendarDays} color="purple" />
        <StatBox label="Dining" value={diningQ.data.length} icon={UtensilsCrossed} color="amber" />
        <StatBox label="Preferences" value={prefsQ.data.length} icon={SlidersHorizontal} color="green" />
      </div>

      {/* Search */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search events, announcements…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
        </div>
        <button onClick={refreshAll} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {/* Announcements */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-1.5 mb-3"><Megaphone className="w-4 h-4 text-yellow-500" /><h3 className="font-semibold text-gray-900 text-sm">Announcements</h3></div>
        {announcements.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">No announcements right now.</p> : (
          <div className="space-y-2">
            {announcements.slice(0, 8).map(a => (
              <div key={str(a.id)} className="border border-gray-100 rounded-lg px-3 py-2 cursor-pointer hover:bg-gray-50 transition" onClick={() => onView(a, `Announcement — ${str(a.title)}`)}>
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  {Boolean(a.pinned) && <Pin className="w-3.5 h-3.5 text-yellow-500" />}
                  <p className="text-sm font-semibold text-gray-900">{str(a.title)}</p>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${ANNOUNCEMENT_PRIORITY_PILL[str(a.priority)] ?? ANNOUNCEMENT_PRIORITY_PILL.NORMAL}`}>{str(a.priority)}</span>
                </div>
                <p className="text-xs text-gray-600 line-clamp-2">{str(a.body)}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{str(a.authorName ?? "")}{a.publishedAt ? ` · ${fmtShort(str(a.publishedAt))}` : ""}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Events */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-1.5 mb-3"><CalendarDays className="w-4 h-4 text-yellow-500" /><h3 className="font-semibold text-gray-900 text-sm">Community Calendar</h3></div>
        {filteredEvents.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">{events.length === 0 ? "No upcoming events." : "No events match your search."}</p> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {paginatedEvents.map(e => {
              const m = EVENT_CATEGORY_META[str(e.category)] ?? EVENT_CATEGORY_META.SOCIAL;
              const Icon = m.icon;
              const att = rsvpByEvent[str(e.id)];
              const status = att ? str(att.status) : "";
              const past = new Date(str(e.startTime)).getTime() < Date.now();
              const busy = busyId === str(e.id) || busyId === str(att?.id);
              return (
                <div key={str(e.id)} className="border border-gray-200 rounded-lg overflow-hidden">
                  {e.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={str(e.imageUrl)} alt="" className="w-full h-24 object-cover" />
                  ) : (
                    <div className={`w-full h-24 flex items-center justify-center ${m.cls}`}><Icon className="w-8 h-8 opacity-40" /></div>
                  )}
                  <div className="p-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${m.cls}`}><Icon className="w-3 h-3" /> {m.label}</span>
                    <p className="text-sm font-semibold text-gray-900 mt-1">{str(e.title)}</p>
                    <p className="text-xs text-gray-500">{fmtDT(str(e.startTime))}</p>
                    {e.location ? <p className="text-xs text-gray-400 inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> {str(e.location)}</p> : null}
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => onView(e, `Event — ${str(e.title)}`)} className="flex items-center gap-1 px-3 py-1.5 border border-gray-200 text-gray-700 hover:bg-gray-50 text-xs font-semibold rounded-lg transition"><Eye className="w-3.5 h-3.5" /> View</button>
                      <div className="flex-1">
                        {busy ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" /> :
                          past && status === "ATTENDED" && !att?.rating ? <button onClick={() => rateEvent(str(att.id))} className="w-full px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg transition inline-flex items-center justify-center gap-1"><Star className="w-3.5 h-3.5" /> Rate</button> :
                            att?.rating ? <span className="inline-flex items-center gap-0.5 text-amber-500 font-semibold text-xs">{num(att.rating)} <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" /></span> :
                              status === "GOING" ? <div className="flex items-center gap-2"><span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${RSVP_PILL.GOING}`}>Going</span><button onClick={() => rsvp(str(e.id), "DECLINED")} className="text-xs text-red-500 hover:underline">Cancel</button></div> :
                                !past ? <button onClick={() => rsvp(str(e.id), "GOING")} className="w-full px-3 py-1.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-black text-xs font-semibold rounded-lg transition inline-flex items-center justify-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> RSVP</button> :
                                  <span className="text-[11px] text-gray-400">Event ended</span>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <Pagination page={page} totalPages={totalPages} total={filteredEvents.length} label="events" setPage={setPage} />
      </div>

      {/* Dining */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5"><UtensilsCrossed className="w-4 h-4 text-yellow-500" /><h3 className="font-semibold text-gray-900 text-sm">Dining Reservations</h3></div>
          <button onClick={() => { setDiningForm(commDiningForm0); setShowDining(true); }} className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-black text-xs font-semibold rounded-lg hover:shadow-md transition"><Plus className="w-3.5 h-3.5" /> Reserve</button>
        </div>
        {diningQ.data.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">No dining reservations yet.</p> : (
          <div className="space-y-2">
            {diningQ.data.map(d => {
              const status = str(d.status);
              return (
                <div key={str(d.id)} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border border-gray-100 rounded-lg px-3 py-2">
                  <div className="min-w-0 cursor-pointer hover:bg-gray-50 rounded px-2 py-1 transition flex-1" onClick={() => onView(d, `Dining — ${str(d.mealType)}`)}>
                    <p className="text-sm font-medium text-gray-900">{str(d.mealType)} · {str(d.venue ?? "Dining")}</p>
                    <p className="text-xs text-gray-500">{d.reservedAt ? fmtDT(str(d.reservedAt)) : ""} · party of {str(d.partySize ?? 1)}</p>
                  </div>
                  <div className="flex items-center gap-2 px-2">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold flex-shrink-0 ${DINING_STATUS_PILL[status] ?? "bg-gray-100 text-gray-700"}`}>{status}</span>
                    {["REQUESTED", "CONFIRMED"].includes(status) && (busyId === str(d.id) ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" /> : <button onClick={() => cancelDining(str(d.id))} className="text-xs text-red-500 hover:underline">Cancel</button>)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Preferences */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5"><SlidersHorizontal className="w-4 h-4 text-yellow-500" /><h3 className="font-semibold text-gray-900 text-sm">My Preference Profile</h3></div>
          <button onClick={() => { setPrefForm(commPrefForm0); setShowPref(true); }} className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-black text-xs font-semibold rounded-lg hover:shadow-md transition"><Plus className="w-3.5 h-3.5" /> Add</button>
        </div>
        {prefsQ.data.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">No preferences set yet.</p> : (
          <div className="space-y-3">
            {Object.entries(prefsByCategory).map(([cat, items]) => (
              <div key={cat}>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{cat}</p>
                <div className="space-y-1">
                  {items.map(p => (
                    <div key={str(p.id)} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border border-gray-100 rounded-lg px-3 py-2">
                      <div className="min-w-0 cursor-pointer hover:bg-gray-50 rounded px-2 py-1 transition flex-1" onClick={() => onView(p, `Preference — ${str(p.preference)}`)}>
                        <p className="text-sm text-gray-900">{str(p.preference)}: <span className="font-semibold">{str(p.value)}</span></p>
                        {p.notes ? <p className="text-xs text-gray-400">{str(p.notes)}</p> : null}
                      </div>
                      {busyId === str(p.id) ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" /> : <button onClick={() => deletePref(str(p.id))} className="p-1.5 rounded hover:bg-red-100 text-red-500 transition" title="Remove"><Trash2 className="w-4 h-4" /></button>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Dining Modal */}
      {showDining && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4" onClick={() => setShowDining(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="bg-gradient-to-r from-amber-400 to-orange-500 px-4 sm:px-6 py-4 sm:py-5 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white/20 flex items-center justify-center"><UtensilsCrossed className="w-5 h-5" /></div>
                <h2 className="text-lg sm:text-xl font-bold">Reserve Dining</h2>
              </div>
              <button onClick={() => setShowDining(false)} className="p-2 hover:bg-white/20 rounded-xl transition"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 sm:p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Meal Type</label>
                  <select value={diningForm.mealType} onChange={e => setDiningForm(f => ({ ...f, mealType: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:ring-2 focus:ring-amber-400 focus:border-amber-400 outline-none transition">
                    {MEAL_TYPES.map(m => <option key={m} value={m}>{m.charAt(0) + m.slice(1).toLowerCase()}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Venue</label>
                  <select value={diningForm.venue} onChange={e => setDiningForm(f => ({ ...f, venue: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:ring-2 focus:ring-amber-400 focus:border-amber-400 outline-none transition">
                    {DINING_VENUES.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Date & Time</label>
                  <input type="datetime-local" value={diningForm.reservedAt} onChange={e => setDiningForm(f => ({ ...f, reservedAt: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:ring-2 focus:ring-amber-400 focus:border-amber-400 outline-none transition" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Party Size</label>
                  <input type="number" min="1" value={diningForm.partySize} onChange={e => setDiningForm(f => ({ ...f, partySize: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:ring-2 focus:ring-amber-400 focus:border-amber-400 outline-none transition" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Guests <span className="text-gray-400 normal-case">(optional)</span></label>
                  <input type="text" value={diningForm.guestNames} onChange={e => setDiningForm(f => ({ ...f, guestNames: e.target.value }))} placeholder="Names of guests joining" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:ring-2 focus:ring-amber-400 focus:border-amber-400 outline-none transition placeholder:text-gray-400" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Special Requests <span className="text-gray-400 normal-case">(optional)</span></label>
                  <textarea value={diningForm.specialRequests} onChange={e => setDiningForm(f => ({ ...f, specialRequests: e.target.value }))} rows={2} placeholder="Dietary needs, seating preference…" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:ring-2 focus:ring-amber-400 focus:border-amber-400 outline-none transition placeholder:text-gray-400 resize-none" />
                </div>
              </div>
            </div>
            <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-3">
              <button onClick={() => setShowDining(false)} className="px-5 py-2.5 text-gray-600 hover:bg-gray-200 rounded-xl transition text-sm font-semibold">Cancel</button>
              <button onClick={submitDining} className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold rounded-xl hover:shadow-lg transition active:scale-95 text-sm">Request Reservation</button>
            </div>
          </div>
        </div>
      )}

      {/* Preference Modal */}
      {showPref && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4" onClick={() => setShowPref(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="bg-gradient-to-r from-purple-400 to-pink-500 px-4 sm:px-6 py-4 sm:py-5 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white/20 flex items-center justify-center"><SlidersHorizontal className="w-5 h-5" /></div>
                <h2 className="text-lg sm:text-xl font-bold">Add Preference</h2>
              </div>
              <button onClick={() => setShowPref(false)} className="p-2 hover:bg-white/20 rounded-xl transition"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 sm:p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Category</label>
                <select value={prefForm.category} onChange={e => setPrefForm(f => ({ ...f, category: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:ring-2 focus:ring-purple-400 focus:border-purple-400 outline-none transition">
                  {PREFERENCE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Preference</label>
                <input type="text" value={prefForm.preference} onChange={e => setPrefForm(f => ({ ...f, preference: e.target.value }))} placeholder="e.g. Preferred wake-up time" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:ring-2 focus:ring-purple-400 focus:border-purple-400 outline-none transition placeholder:text-gray-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Value</label>
                <input type="text" value={prefForm.value} onChange={e => setPrefForm(f => ({ ...f, value: e.target.value }))} placeholder="e.g. 6:30 AM" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:ring-2 focus:ring-purple-400 focus:border-purple-400 outline-none transition placeholder:text-gray-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Notes <span className="text-gray-400 normal-case">(optional)</span></label>
                <textarea value={prefForm.notes} onChange={e => setPrefForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Any additional details…" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:ring-2 focus:ring-purple-400 focus:border-purple-400 outline-none transition placeholder:text-gray-400 resize-none" />
              </div>
            </div>
            <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-3">
              <button onClick={() => setShowPref(false)} className="px-5 py-2.5 text-gray-600 hover:bg-gray-200 rounded-xl transition text-sm font-semibold">Cancel</button>
              <button onClick={savePref} className="px-5 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:shadow-lg transition active:scale-95 text-sm">Save Preference</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
