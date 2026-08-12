"use client";

import { useMemo, useState } from "react";
import { CalendarDays, Plus, X, Clock, Stethoscope, Users, ClipboardList, MapPin, Loader2, Calendar as CalIcon, Link2, Copy, Check, Download, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, upsertRecord } from "@/lib/api";
import { buildIcsCalendar, buildIcsEvent, googleCalendarUrl, type IcsEvent } from "@/lib/ics";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

// Appointment types are encoded in the visit's `purpose` as "[TYPE] Title", so
// this rides on the existing self-writable `visits` model (resident-scoped —
// families only ever see their own resident's schedule). Migration-free.
const TYPES = [
  { key: "FAMILY_MEETING", label: "Family Meeting", color: "#3b82f6", icon: Users },
  { key: "DOCTOR", label: "Doctor Visit", color: "#ef4444", icon: Stethoscope },
  { key: "CARE_CONFERENCE", label: "Care Conference", color: "#a855f7", icon: ClipboardList },
  { key: "TOUR", label: "Tour", color: "#f59e0b", icon: MapPin },
  { key: "ACTIVITY", label: "Activity / Event", color: "#22c55e", icon: CalIcon },
  { key: "OTHER", label: "Other", color: "#6b7280", icon: CalendarDays },
] as const;
const typeMeta = (k: string) => TYPES.find((t) => t.key === k) ?? TYPES[TYPES.length - 1];

function parseAppt(v: Row) {
  const purpose = s(v.purpose);
  const m = purpose.match(/^\[([A-Z_]+)\]\s*(.*)$/);
  return {
    id: s(v.id),
    type: m ? m[1] : "OTHER",
    title: m ? m[2] : purpose || "Appointment",
    when: s(v.checkInTime),
    withWhom: s(v.visitorName),
    notes: s(v.notes),
    source: "visit",
  };
}

// Approved medical referrals (from the Medical Appointments / Referrals board)
// reflect here once signed off. The New Referral modal packs the specialist into
// notes line 1 ("Specialist: <name>"), so extract it for display.
const specialistFromNotes = (notes: string) => { const m = s(notes).split("\n")[0].match(/^Specialist:\s*(.*)$/); return m ? m[1].trim() : ""; };
const REFERRAL_ON_CALENDAR = new Set(["APPROVED", "SCHEDULED", "COMPLETED"]);
function parseReferral(r: Row) {
  const specialist = specialistFromNotes(s(r.notes));
  return {
    id: `ref-${s(r.id)}`,
    type: "DOCTOR",
    title: s(r.reason) || specialist || "Medical appointment",
    when: s(r.scheduledDate),
    withWhom: specialist || s(r.facilityName),
    notes: s(r.facilityName),
    source: "referral",
  };
}
const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);

type Appt = ReturnType<typeof parseAppt>;

// Build an ICS event from a parsed appointment (shared by the "download all" and
// per-appointment "add to calendar" affordances).
function apptToIcsEvent(a: Appt, residentName?: string): IcsEvent {
  const meta = typeMeta(a.type);
  const descParts = [meta.label, residentName ? `Resident: ${residentName}` : "", a.withWhom && a.withWhom !== "—" ? `With: ${a.withWhom}` : "", a.notes].filter(Boolean);
  return {
    uid: `visit-${a.id}@assisted-living`,
    start: a.when,
    summary: `${a.title}${residentName ? ` — ${residentName}` : ""}`,
    description: descParts.join("\n"),
  };
}

function downloadIcs(filename: string, ics: string) {
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// A URL-safe random token for the subscription feed.
function randomToken(): string {
  const bytes = new Uint8Array(24);
  (globalThis.crypto ?? window.crypto).getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Two app-setting rows back a feed:
//   __cal_feed:<token>          → { residentId }   (SECRET: token→resident map the
//                                  public ICS route reads; `__` hides it from
//                                  the generic /api/db app-settings read)
//   cal_feed_for:<residentId>   → { token }        (readable pointer so this UI can
//                                  reuse the resident's existing token)
const feedByToken = (token: string) => `__cal_feed:${token}`;
const feedForResident = (residentId: string) => `cal_feed_for:${residentId}`;

interface Props {
  /** Required to schedule; the resident the appointments belong to. */
  residentId?: string;
  residentName?: string;
  canSchedule?: boolean;
  title?: string;
}

/** Shared appointment calendar — meetings with family, doctors, care
 *  conferences, tours. Shown on the family + resident dashboards; anyone with
 *  access can schedule, and it reflects on every viewer's calendar. */
export default function AppointmentCalendar({ residentId, residentName, canSchedule = true, title = "Calendar" }: Props) {
  const q = residentId ? `f_residentId=${residentId}&take=300` : "take=300";
  const { data: visitRows, refetch } = useLiveQuery<Row>("visits", { query: q, tables: ["Visit"] });
  const { data: referralRows } = useLiveQuery<Row>("hospital-referrals", { query: q, tables: ["HospitalReferral"] });
  const { data: settingRows } = useLiveQuery<Row>("app-settings", { tables: ["AppSetting"] });

  // Existing subscription-feed token for this resident (readable pointer row).
  const feedToken = useMemo(() => {
    if (!residentId) return "";
    const key = feedForResident(residentId);
    const row = settingRows.find((r) => s(r.key || r.id) === key || s(r.id).endsWith(`:${key}`));
    if (!row) return "";
    try { return String((JSON.parse(s(row.value)) as { token?: string }).token ?? ""); } catch { return ""; }
  }, [settingRows, residentId]);

  const [showConnect, setShowConnect] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [liveToken, setLiveToken] = useState("");
  const activeToken = liveToken || feedToken;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const feedHttpsUrl = activeToken ? `${origin}/api/calendar/${activeToken}/appointments.ics` : "";
  const feedWebcalUrl = activeToken && origin ? feedHttpsUrl.replace(/^https?:\/\//, "webcal://") : "";

  const appts = useMemo(
    () => [
      ...visitRows.map(parseAppt),
      ...referralRows.filter((r) => REFERRAL_ON_CALENDAR.has(s(r.status).toUpperCase())).map(parseReferral),
    ].filter((a) => a.when).sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime()),
    [visitRows, referralRows],
  );
  const todayKey = new Date().toISOString().slice(0, 10);
  const [typeFilter, setTypeFilter] = useState("");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [detailAppt, setDetailAppt] = useState<Appt | null>(null);
  const visibleAppts = useMemo(() => (typeFilter ? appts.filter((a) => a.type === typeFilter) : appts), [appts, typeFilter]);
  const upcoming = useMemo(() => visibleAppts.filter((a) => dayKey(a.when) >= todayKey), [visibleAppts, todayKey]);

  const grouped = useMemo(() => {
    const map = new Map<string, ReturnType<typeof parseAppt>[]>();
    for (const a of upcoming) { const k = dayKey(a.when); (map.get(k) ?? map.set(k, []).get(k)!).push(a); }
    return Array.from(map.entries());
  }, [upcoming]);

  // ── Month-grid calendar ────────────────────────────────────────────────────
  const [monthCursor, setMonthCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const apptsByDay = useMemo(() => {
    const m = new Map<string, Appt[]>();
    for (const a of visibleAppts) { const k = dayKey(a.when); const arr = m.get(k); if (arr) arr.push(a); else m.set(k, [a]); }
    return m;
  }, [visibleAppts]);
  const calendarCells = useMemo(() => {
    const year = monthCursor.getFullYear(), month = monthCursor.getMonth();
    const lead = new Date(year, month, 1).getDay();
    const dim = new Date(year, month + 1, 0).getDate();
    const cells: (string | null)[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= dim; d++) cells.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    return cells;
  }, [monthCursor]);
  const shiftMonth = (delta: number) => setMonthCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  const goThisMonth = () => setMonthCursor(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: "FAMILY_MEETING", title: "", withWhom: "", date: "", time: "10:00", notes: "" });
  const [saving, setSaving] = useState(false);

  const schedule = async () => {
    if (!residentId) return;
    if (!form.title.trim() || !form.date) { Swal.fire({ title: "Add a title and date", icon: "warning" }); return; }
    setSaving(true);
    try {
      const when = new Date(`${form.date}T${form.time || "10:00"}`).toISOString();
      await createRecord("visits", {
        residentId,
        visitorName: form.withWhom || "—",
        purpose: `[${form.type}] ${form.title.trim()}`,
        checkInTime: when,
        notes: form.notes || null,
      });
      await refetch();
      setShowForm(false);
      setForm({ type: "FAMILY_MEETING", title: "", withWhom: "", date: "", time: "10:00", notes: "" });
      Swal.fire({ title: "Scheduled", text: "It now shows on the resident's and family's calendars.", icon: "success", timer: 1900, showConfirmButton: false });
    } catch (e) {
      Swal.fire({ title: "Couldn't schedule", text: e instanceof Error ? e.message : "Try again", icon: "error" });
    } finally { setSaving(false); }
  };

  // Mint (or reuse) the subscription-feed token so external calendars can
  // subscribe to this resident's schedule, then open the Connect panel.
  const openConnect = async () => {
    setShowConnect(true);
    if (activeToken || !residentId) return;
    setConnecting(true);
    try {
      const token = randomToken();
      // Secret token→resident map read by the public ICS route.
      await upsertRecord("app-settings", feedByToken(token), { key: feedByToken(token), value: JSON.stringify({ residentId }) });
      // Readable pointer so this UI reuses the same token next time.
      await upsertRecord("app-settings", feedForResident(residentId), { key: feedForResident(residentId), value: JSON.stringify({ token }) });
      setLiveToken(token);
    } catch (e) {
      Swal.fire({ title: "Couldn't create the feed", text: e instanceof Error ? e.message : "Try again", icon: "error" });
    } finally { setConnecting(false); }
  };

  const copyFeed = async () => {
    if (!feedHttpsUrl) return;
    try {
      await navigator.clipboard.writeText(feedHttpsUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      Swal.fire({ title: "Copy failed", text: feedHttpsUrl, icon: "info" });
    }
  };

  const downloadAll = () => {
    if (!upcoming.length) { Swal.fire({ title: "Nothing to export", text: "There are no upcoming appointments.", icon: "info" }); return; }
    const ics = buildIcsCalendar(upcoming.map((a) => apptToIcsEvent(a, residentName)), residentName ? `${residentName} — Appointments` : "Appointments");
    downloadIcs("appointments.ics", ics);
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="flex items-center gap-2 font-bold text-gray-900"><CalendarDays className="w-5 h-5 text-blue-600" /> {title}</h3>
        <div className="flex items-center gap-2">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-blue-400/40" title="Filter by type">
            <option value="">All types</option>
            {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          {residentId && (
            <button onClick={() => void openConnect()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-xs font-semibold hover:bg-blue-100"><Link2 className="w-4 h-4" /> Connect calendar</button>
          )}
          {canSchedule && residentId && (
            <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"><Plus className="w-4 h-4" /> Schedule</button>
          )}
        </div>
      </div>

      {/* Month grid — appointments shown on their day */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-bold text-gray-900">{monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</p>
          <div className="flex items-center gap-1">
            <button onClick={() => shiftMonth(-1)} className="rounded-lg border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50" aria-label="Previous month"><ChevronLeft className="w-4 h-4" /></button>
            <button onClick={goThisMonth} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">Today</button>
            <button onClick={() => shiftMonth(1)} className="rounded-lg border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50" aria-label="Next month"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-gray-400 mb-1">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {calendarCells.map((key, i) => {
            if (key === null) return <div key={`b${i}`} />;
            const list = apptsByDay.get(key) ?? [];
            const isToday = key === todayKey;
            const isSelected = key === selectedDay;
            return (
              <div key={key} onClick={() => setSelectedDay(key)} className={`min-h-[68px] cursor-pointer rounded-lg border p-1 transition hover:border-blue-300 hover:bg-blue-50/40 ${isSelected ? "border-blue-400 ring-1 ring-blue-300 bg-blue-50/60" : isToday ? "border-blue-300 bg-blue-50/40" : "border-gray-100"}`}>
                <p className={`text-[11px] font-semibold ${isToday ? "text-blue-600" : "text-gray-500"}`}>{Number(key.slice(-2))}</p>
                <div className="mt-0.5 space-y-0.5">
                  {list.slice(0, 2).map((a) => { const meta = typeMeta(a.type); return (
                    <button key={a.id} onClick={(e) => { e.stopPropagation(); setDetailAppt(a); }} title={`${a.title}${a.withWhom && a.withWhom !== "—" ? ` · ${a.withWhom}` : ""}`} className="block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium hover:opacity-80" style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}>
                      {new Date(a.when).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} {a.title}
                    </button>
                  ); })}
                  {list.length > 2 && <p className="px-1 text-[10px] text-gray-400">+{list.length - 2} more</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selectedDay && (
        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50/30 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-bold text-blue-700">{new Date(selectedDay + "T00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
            <button onClick={() => setSelectedDay(null)} className="text-xs font-medium text-gray-500 hover:text-gray-700">Clear</button>
          </div>
          {(apptsByDay.get(selectedDay) ?? []).length === 0 ? (
            <p className="py-2 text-sm text-gray-400">No appointments this day.</p>
          ) : (
            <div className="space-y-1.5">
              {(apptsByDay.get(selectedDay) ?? []).map((a) => { const meta = typeMeta(a.type); const Icon = meta.icon; return (
                <button key={a.id} onClick={() => setDetailAppt(a)} className="flex w-full items-center gap-2.5 rounded-lg border border-gray-100 bg-white p-2 text-left hover:border-blue-200">
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}><Icon className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-gray-900">{a.title}{a.source === "referral" && <span className="ml-2 align-middle inline-flex items-center rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-bold text-green-700">Approved</span>}</span>
                    <span className="text-xs text-gray-500">{new Date(a.when).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {meta.label}{a.withWhom && a.withWhom !== "—" ? ` · ${a.withWhom}` : ""}</span>
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-gray-300" />
                </button>
              ); })}
            </div>
          )}
        </div>
      )}

      {grouped.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">No upcoming appointments.{canSchedule && residentId ? " Tap Schedule to add one." : ""}</p>
      ) : (
        <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
          {grouped.map(([day, list]) => {
            const d = new Date(day + "T00:00");
            const isToday = day === todayKey;
            return (
              <div key={day}>
                <p className={`text-xs font-bold uppercase tracking-wide mb-1.5 ${isToday ? "text-blue-600" : "text-gray-400"}`}>
                  {isToday ? "Today · " : ""}{d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                </p>
                <div className="space-y-1.5">
                  {list.map((a) => {
                    const meta = typeMeta(a.type);
                    const Icon = meta.icon;
                    return (
                      <div key={a.id} className="flex items-start gap-2.5 rounded-lg border border-gray-100 bg-gray-50 p-2.5">
                        <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}><Icon className="h-4 w-4" /></span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-gray-900 truncate">{a.title}{a.source === "referral" && <span className="ml-2 align-middle inline-flex items-center rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-bold text-green-700">Approved</span>}</p>
                          <p className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(a.when).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                            <span className="font-medium" style={{ color: meta.color }}>{meta.label}</span>
                            {a.withWhom && a.withWhom !== "—" && <span>· with {a.withWhom}</span>}
                          </p>
                          {a.notes && <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{a.notes}</p>}
                          <div className="mt-1.5 flex items-center gap-2">
                            <a href={googleCalendarUrl(apptToIcsEvent(a, residentName))} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-700 hover:underline"><ExternalLink className="w-3 h-3" /> Google</a>
                            <button onClick={() => downloadIcs(`${a.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "appointment"}.ics`, buildIcsEvent(apptToIcsEvent(a, residentName), a.title))} className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-700 hover:underline"><Download className="w-3 h-3" /> .ics</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showConnect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-blue-600 px-5 py-4 text-white rounded-t-2xl">
              <h3 className="flex items-center gap-2 font-bold"><Link2 className="w-5 h-5" /> Connect your calendar</h3>
              <button onClick={() => setShowConnect(false)} className="p-1 hover:bg-white/15 rounded"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-5">
              <p className="text-sm text-gray-600">Subscribe to {residentName ? <span className="font-semibold text-gray-900">{residentName}&rsquo;s</span> : "this"} appointment schedule from Google Calendar, Apple Calendar or Outlook. Once subscribed, new and changed appointments sync automatically.</p>

              <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-blue-700 mb-2">Subscription link</p>
                {connecting ? (
                  <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Creating your private feed&hellip;</p>
                ) : feedHttpsUrl ? (
                  <>
                    <div className="flex items-center gap-2">
                      <input readOnly value={feedHttpsUrl} onFocus={(e) => e.currentTarget.select()} className="flex-1 min-w-0 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs text-gray-700 font-mono" />
                      <button onClick={() => void copyFeed()} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 whitespace-nowrap">{copied ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy</>}</button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a href={feedWebcalUrl} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50"><CalIcon className="w-4 h-4" /> Add to Apple / Outlook</a>
                      <a href="https://calendar.google.com/calendar/u/0/r/settings/addbyurl" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50"><ExternalLink className="w-4 h-4" /> Add to Google Calendar</a>
                    </div>
                    <p className="mt-3 text-[11px] leading-relaxed text-gray-500">In Google Calendar choose <span className="font-medium">Other calendars &rarr; From URL</span> and paste the link above. Apple/Outlook open the <span className="font-mono">webcal://</span> link directly. Keep this link private &mdash; anyone with it can view the schedule.</p>
                  </>
                ) : (
                  <p className="text-sm text-gray-500">Select a resident to generate a subscription link.</p>
                )}
              </div>

              <div className="rounded-2xl border border-gray-200 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">One-time export</p>
                <p className="text-xs text-gray-500 mb-3">Download every upcoming appointment as a single <span className="font-mono">.ics</span> file and import it into any calendar app.</p>
                <button onClick={downloadAll} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-800"><Download className="w-4 h-4" /> Download .ics ({upcoming.length})</button>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
              <button onClick={() => setShowConnect(false)} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100">Done</button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-blue-600 px-5 py-4 text-white rounded-t-xl">
              <h3 className="font-bold">Schedule appointment{residentName ? ` — ${residentName}` : ""}</h3>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-white/15 rounded"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 grid grid-cols-2 gap-3">
              <label className="text-xs font-medium text-gray-600 col-span-2">Type
                <select className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
              </label>
              <label className="text-xs font-medium text-gray-600 col-span-2">Title
                <input className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Care plan review" />
              </label>
              <label className="text-xs font-medium text-gray-600">Date
                <input type="date" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </label>
              <label className="text-xs font-medium text-gray-600">Time
                <input type="time" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
              </label>
              <label className="text-xs font-medium text-gray-600 col-span-2">With (family member / doctor)
                <input className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.withWhom} onChange={(e) => setForm({ ...form, withWhom: e.target.value })} placeholder="Optional" />
              </label>
              <label className="text-xs font-medium text-gray-600 col-span-2">Notes
                <textarea className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm min-h-[54px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100">Cancel</button>
              <button onClick={() => void schedule()} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Schedule</button>
            </div>
          </div>
        </div>
      )}

      {detailAppt && (() => {
        const meta = typeMeta(detailAppt.type); const Icon = meta.icon;
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setDetailAppt(null)}>
            <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
                <h3 className="flex items-center gap-2 font-bold text-gray-900"><span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}><Icon className="h-4 w-4" /></span> Appointment details</h3>
                <button onClick={() => setDetailAppt(null)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
              </div>
              <div className="space-y-3 p-5">
                <div>
                  <p className="text-lg font-bold text-gray-900">{detailAppt.title}{detailAppt.source === "referral" && <span className="ml-2 align-middle inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-700">Approved</span>}</p>
                  <p className="text-sm font-medium" style={{ color: meta.color }}>{meta.label}</p>
                </div>
                <div className="space-y-1.5 text-sm text-gray-600">
                  <p className="flex items-center gap-2"><Clock className="h-4 w-4 text-gray-400" />{new Date(detailAppt.when).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                  {detailAppt.withWhom && detailAppt.withWhom !== "—" && <p className="flex items-center gap-2"><Stethoscope className="h-4 w-4 text-gray-400" />{detailAppt.withWhom}</p>}
                  {detailAppt.notes && <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 text-gray-400" />{detailAppt.notes}</p>}
                </div>
                <div className="flex items-center gap-2 border-t border-gray-100 pt-3">
                  <a href={googleCalendarUrl(apptToIcsEvent(detailAppt, residentName))} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"><ExternalLink className="h-3.5 w-3.5" /> Add to Google</a>
                  <button onClick={() => downloadIcs(`${detailAppt.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "appointment"}.ics`, buildIcsEvent(apptToIcsEvent(detailAppt, residentName), detailAppt.title))} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"><Download className="h-3.5 w-3.5" /> Download .ics</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
