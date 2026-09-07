"use client";

// Caregiver "My Shift" — the mobile-first shift screen: shift header, a compact
// completion/attention metric card, Quick record tiles, and per-resident routine
// cards with a search + status filter. Deliberately NOT the shared
// RoleCommandDashboard (no act-now "Needs attention" block, no queue sections) —
// caregivers get a focused execution view. All data comes from the same governed
// read model: GET /api/dashboards/caregiver.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, Utensils, GlassWater, Droplets, Footprints, Moon, Smile, AlertTriangle,
  Calendar, Repeat, RefreshCw, ChevronRight,
  ListChecks, Clock,
} from "lucide-react";
import { ClinicalHeader, ClinicalModal, ClinicalPage, DataState, SearchInput } from "@/components/portal/views/clinical/clinical-ui";
import { QuickRecordFlow } from "@/components/portal/views/clinical/CareLogsBoard";
import TodaysCareBoard from "@/components/portal/views/clinical/TodaysCareBoard";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { careDay } from "@/lib/lifecare/routineCompletions";
import { countProgress, deriveState, manilaMinutesNow, manilaDay } from "@/lib/lifecare/occurrenceStatus";
import ADLMonitoringBoard from "@/components/portal/views/clinical/ADLMonitoringBoard";
import ShiftEndorsementBoard from "@/components/portal/views/clinical/ShiftEndorsementBoard";
import type { DashboardPayload, DashboardQueueItem, DashboardSection } from "@/lib/dashboard/types";

// Quick record → deep-links to Daily Care Logs with the domain preselected
// (?focus=<AS-code>; see CareLogsBoard focusToDomain). Nutrition + Hydration both
// map to AS-08, whose meal form captures intake and fluid volume together.
const QUICK_RECORD_TILES: { label: string; icon: typeof Activity; focus: string }[] = [
  { label: "Vitals", icon: Activity, focus: "AS-06" },
  { label: "Nutrition", icon: Utensils, focus: "AS-08" },
  { label: "Hydration", icon: GlassWater, focus: "AS-08" },
  { label: "Bowel/urine", icon: Droplets, focus: "AS-10" },
  { label: "Mobility", icon: Footprints, focus: "AS-02" },
  { label: "Sleep", icon: Moon, focus: "AS-12" },
  { label: "Mood", icon: Smile, focus: "AS-05" },
  { label: "Concern", icon: AlertTriangle, focus: "AS-13" },
];

const sectionOf = (data: DashboardPayload, key: string): DashboardQueueItem[] =>
  data.sections.find((s: DashboardSection) => s.key === key)?.items ?? [];

const fmtTime = (iso?: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

// The server packs the resident glance as
// "Approved assistance: X · Allergies: Y · Diet: Z · Code status: W · Care notes: <notes>",
// where <notes> can be the FULL generated care plan (a paragraph). Split on the
// Care-notes marker (the dump itself contains " · ", so we can't split naively),
// render the short structured fields as scannable pills, and only show notes when
// they're a genuine short note — never a plan dump.
type Precautions = { tags: { label: string; value: string }[]; note: string };
const CARE_NOTES_MARKER = " · Care notes: ";
const parsePrecautions = (detail: string): Precautions => {
  const idx = detail.indexOf(CARE_NOTES_MARKER);
  const head = idx === -1 ? detail : detail.slice(0, idx);
  const notesRaw = idx === -1 ? "" : detail.slice(idx + CARE_NOTES_MARKER.length);
  const tags = head.split(" · ").map((seg) => {
    const i = seg.indexOf(": ");
    return i === -1 ? { label: "", value: seg.trim() } : { label: seg.slice(0, i).trim(), value: seg.slice(i + 2).trim() };
  }).filter((t) => t.value && t.label !== "Care notes");
  return { tags, note: notesRaw && notesRaw.length <= 120 ? notesRaw : "" };
};

type ResidentCard = {
  id: string;
  name: string;
  room: string;
  precautions: string;
  nextTime: string;
  nextAt: string;
  nextTitle: string;
  overdue: number;
  dueNext: number;
  status: "overdue" | "due" | "uptodate";
};

const STATUS_RANK: Record<ResidentCard["status"], number> = { overdue: 0, due: 1, uptodate: 2 };

// Current shift window by Manila hour (Night 22-06 / Morning 06-14 / Afternoon 14-22).
// Returns a predicate over a "HH:MM" scheduledTime — Night wraps midnight.
function currentShift(nowMin: number): { label: string; inWindow: (hhmm: string) => boolean } {
  const h = Math.floor(nowMin / 60);
  const toMin = (t: string) => { const m = /(\d{1,2}):(\d{2})/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : 0; };
  if (h >= 6 && h < 14) return { label: "Morning", inWindow: (t) => { const s = toMin(t); return s >= 360 && s < 840; } };
  if (h >= 14 && h < 22) return { label: "Afternoon", inWindow: (t) => { const s = toMin(t); return s >= 840 && s < 1320; } };
  return { label: "Night", inWindow: (t) => { const s = toMin(t); return s >= 1320 || s < 360; } };
}

// The day a Night shift belongs to spills past midnight; occurrences are keyed to
// the Manila care day, which already advances at 00:00, so today's careDay covers it.
type ShiftOcc = { scheduledTime: string; workflowState?: string | null; careDeliveryOutcome?: string | null; escalationState?: string | null; assignedStaffId?: string | null; residentId?: string };

export default function CaregiverShiftBoard() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "due" | "overdue" | "uptodate">("all");
  const [quickFocus, setQuickFocus] = useState<string | null>(null);
  const [routineResident, setRoutineResident] = useState<{ id: string; name: string } | null>(null);
  const [routineTab, setRoutineTab] = useState<"routine" | "log" | "adl">("routine");
  const [showToday, setShowToday] = useState(false);
  const [showHandover, setShowHandover] = useState(false);

  // My-Shift occurrence metrics (SLMS v4.2 #4/#5) — derived from the SAME
  // RoutineOccurrence rows the Resident Daily Routine charts, scoped to THIS
  // caregiver's ASSIGNED RESIDENTS (occurrences are resident-owned; the generic
  // read is already community/resident-scoped) AND the current shift window.
  const { data: occRows, refetch: refetchOccs } = useLiveQuery<ShiftOcc & { careDate?: unknown }>(
    "routine-occurrences", { tables: ["RoutineOccurrence"], query: "take=500" },
  );
  const [, setShiftTick] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setShiftTick(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const nowMin = manilaMinutesNow();
  const today = careDay();
  const shift = useMemo(() => currentShift(nowMin), [nowMin]);
  // The caregiver's assigned residents for this shift (the dashboard roster).
  const myResidentIds = useMemo(
    () => new Set((data ? sectionOf(data, "my-residents") : []).map((r) => r.residentId || r.id).filter(Boolean)),
    [data],
  );
  const myResidentKey = useMemo(() => [...myResidentIds].sort().join(","), [myResidentIds]);
  // Occurrences are materialized on-demand (#3 §5): ensure each assigned resident's
  // care day exists so My Shift shows counts on load, then refetch.
  useEffect(() => {
    const ids = myResidentKey.split(",").filter(Boolean);
    if (!ids.length) return;
    let cancelled = false;
    (async () => {
      let created = false;
      for (const rid of ids) {
        try {
          const r = await fetch(`/api/routine/occurrences?residentId=${encodeURIComponent(rid)}&careDate=${today}`);
          const j = r.ok ? await r.json() : null;
          if (j && j.count > 0) created = true;
        } catch { /* non-fatal */ }
      }
      if (!cancelled && created) refetchOccs();
    })();
    return () => { cancelled = true; };
  }, [myResidentKey, today, refetchOccs]);
  const myShiftOccs = useMemo(() => {
    return (occRows || []).filter((o) =>
      manilaDay((o as { careDate?: unknown }).careDate) === today &&
      o.residentId != null && myResidentIds.has(String(o.residentId)) &&
      shift.inWindow(o.scheduledTime),
    );
  }, [occRows, myResidentIds, today, shift]);
  const shiftMetrics = useMemo(() => {
    const p = countProgress(myShiftOccs, nowMin);
    let dueNow = 0, upcoming = 0;
    for (const o of myShiftOccs) {
      const s = deriveState({ scheduledTime: o.scheduledTime, workflowState: o.workflowState }, nowMin);
      if (s === "Due") dueNow += 1; else if (s === "Upcoming") upcoming += 1;
    }
    return { dueNow, overdue: p.overdue, upcoming, completed: p.completed, total: p.total, pendingReview: p.pendingReview };
  }, [myShiftOccs, nowMin]);
  // Rows that must ALWAYS surface regardless of state: critical, overdue, pending
  // exception (a live escalation), or a handover-flagged item.
  const alwaysShow = useMemo(() =>
    myShiftOccs.filter((o) => {
      const s = deriveState({ scheduledTime: o.scheduledTime, workflowState: o.workflowState }, nowMin);
      return s === "Overdue" || (o.escalationState && o.escalationState !== "Not required");
    }).length,
  [myShiftOccs, nowMin]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await fetch("/api/dashboards/caregiver?window=shift", { cache: "no-store", credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Dashboard unavailable.");
      setData(body);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dashboard unavailable.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const t = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(t);
  }, [load]);

  // Assemble per-resident routine cards from the my-residents roster plus the
  // due-now / due-next care windows. A resident's bucket is its worst status:
  // overdue > due > up to date.
  const cards = useMemo<ResidentCard[]>(() => {
    if (!data) return [];
    const now = sectionOf(data, "my-care-now");
    const next = sectionOf(data, "my-care-next");
    const byRes = (items: DashboardQueueItem[]) => {
      const m = new Map<string, DashboardQueueItem[]>();
      items.forEach((it) => { const k = it.residentId || it.id; (m.get(k) ?? m.set(k, []).get(k)!).push(it); });
      return m;
    };
    const nowByRes = byRes(now);
    const nextByRes = byRes(next);
    const list = sectionOf(data, "my-residents").map((r): ResidentCard => {
      const id = r.residentId || r.id;
      const nowItems = nowByRes.get(id) ?? [];
      const nextItems = nextByRes.get(id) ?? [];
      const nextItem = nowItems[0] ?? nextItems[0];
      const status: ResidentCard["status"] = nowItems.length ? "overdue" : nextItems.length ? "due" : "uptodate";
      return {
        id,
        name: r.residentLabel || r.title,
        room: r.roomLabel || "",
        precautions: r.detail || r.reason || "",
        nextTime: fmtTime(nextItem?.dueAt),
        nextAt: nextItem?.dueAt || "",
        nextTitle: nextItem?.title || "",
        overdue: nowItems.length,
        dueNext: nextItems.length,
        status,
      };
    });
    // Most urgent first: overdue → due → up to date, then by soonest due time.
    // A caregiver should never have to hunt for who needs them next.
    return list.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.nextAt.localeCompare(b.nextAt));
  }, [data]);

  const counts = useMemo(() => ({
    all: cards.length,
    due: cards.filter((c) => c.status === "due").length,
    overdue: cards.filter((c) => c.status === "overdue").length,
    uptodate: cards.filter((c) => c.status === "uptodate").length,
  }), [cards]);

  const q = search.trim().toLowerCase();
  const visibleCards = cards.filter((c) =>
    (filter === "all" || c.status === filter) &&
    (!q || c.name.toLowerCase().includes(q) || c.room.toLowerCase().includes(q)));

  // The at-a-glance shift metrics are now derived from THIS caregiver's
  // RoutineOccurrence rows (shiftMetrics above) — the same rows the Resident Daily
  // Routine charts — so the tiles and the routine board can never disagree. The
  // per-resident card badges below keep using the dashboard buckets (c.overdue /
  // c.dueNext) for who-needs-you routing.
  const shiftLine = data
    ? `${data.shift.label} · ${data.shift.range} · ${data.summary.activeResidents} assigned resident${data.summary.activeResidents === 1 ? "" : "s"}`
    : "Loading shift…";

  // Open the resident's routine hub on the Routine tab (Daily Log / ADL live as
  // sibling tabs inside the same modal — no separate modal opens from the card).
  const openRoutine = (c: ResidentCard) => { setRoutineTab("routine"); setRoutineResident({ id: c.id, name: c.name }); };

  return (
    <ClinicalPage className="space-y-4">
      <ClinicalHeader
        title="My Shift"
        subtitle={shiftLine}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setShowToday(true)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold text-[var(--clinical-ink-soft)] transition hover:text-[var(--clinical-ink)]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
              <Calendar className="h-4 w-4" /> Today
            </button>
            <button onClick={() => setShowHandover(true)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold text-[var(--clinical-ink-soft)] transition hover:text-[var(--clinical-ink)]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
              <Repeat className="h-4 w-4" /> View handover
            </button>
            <button onClick={() => void load()} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold text-[var(--clinical-ink-soft)] transition hover:text-[var(--clinical-ink)]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        }
      />

      <DataState loading={loading && !data} error={error && !data ? new Error(error) : null} empty={false} onRetry={() => void load()} skeletonRows={4}>
        {data && (
          <>
            {/* At-a-glance shift metrics — read-only, they refresh live with the
                payload. Due now / Overdue are derived from the same per-resident
                buckets as the roster below so the tiles always match the rows. */}
            <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-[var(--clinical-line)] xl:grid-cols-4" style={{ borderColor: "var(--clinical-line)" }}>
              {/* Due now — my occurrences derived-Due this shift */}
              <div className="bg-[var(--clinical-surface)] p-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-[var(--clinical-amber)]"><Clock className="h-4 w-4" /></span>
                  <p className="text-2xl font-bold leading-none tabular-nums text-[var(--clinical-ink)]">{shiftMetrics.dueNow}</p>
                </div>
                <p className="mt-1.5 text-[12px] font-semibold text-[var(--clinical-ink)]">Due now</p>
                <p className="mt-0.5 text-[10px] text-[var(--clinical-muted)]">{shift.label} shift{alwaysShow ? ` · ${alwaysShow} need attention` : ""}</p>
              </div>

              {/* Overdue — tile flushes red when there is overdue work */}
              <div className={`p-3 ${shiftMetrics.overdue ? "bg-red-500/[0.06]" : "bg-[var(--clinical-surface)]"}`}>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${shiftMetrics.overdue ? "bg-red-500/15 text-[var(--clinical-danger,#dc2626)]" : "bg-[var(--clinical-surface-2)] text-[var(--clinical-muted)]"}`}><AlertTriangle className="h-4 w-4" /></span>
                  <p className={`text-2xl font-bold leading-none tabular-nums ${shiftMetrics.overdue ? "text-[var(--clinical-danger,#dc2626)]" : "text-[var(--clinical-ink)]"}`}>{shiftMetrics.overdue}</p>
                </div>
                <p className="mt-1.5 text-[12px] font-semibold text-[var(--clinical-ink)]">Overdue</p>
                <p className={`mt-0.5 text-[10px] font-medium ${shiftMetrics.overdue ? "text-[var(--clinical-danger,#dc2626)]" : "text-[var(--clinical-muted)]"}`}>{shiftMetrics.overdue ? "Needs action now" : "All caught up"}</p>
              </div>

              {/* Upcoming — my occurrences not yet due this shift */}
              <div className="bg-[var(--clinical-surface)] p-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-500/10 text-[var(--clinical-panel)]"><Clock className="h-4 w-4" /></span>
                  <p className="text-2xl font-bold leading-none tabular-nums text-[var(--clinical-ink)]">{shiftMetrics.upcoming}</p>
                </div>
                <p className="mt-1.5 text-[12px] font-semibold text-[var(--clinical-ink)]">Upcoming</p>
                <p className="mt-0.5 text-[10px] text-[var(--clinical-muted)]">Later this shift</p>
              </div>

              {/* Completed — my occurrences charted complete this shift */}
              <div className="bg-[var(--clinical-surface)] p-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500"><ListChecks className="h-4 w-4" /></span>
                  <p className="text-2xl font-bold leading-none tabular-nums text-[var(--clinical-ink)]">{shiftMetrics.completed}<span className="text-sm font-semibold text-[var(--clinical-muted)]"> / {shiftMetrics.total}</span></p>
                </div>
                <p className="mt-1.5 text-[12px] font-semibold text-[var(--clinical-ink)]">Completed</p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--clinical-surface-2)]"><div className="h-full rounded-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${shiftMetrics.total ? Math.round((shiftMetrics.completed / shiftMetrics.total) * 100) : 0}%` }} /></div>
              </div>
            </section>

            {/* Quick record */}
            <section className="rounded-2xl border border-[var(--clinical-line)] bg-[var(--clinical-surface)] p-4 sm:p-5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h2 className="text-sm font-bold uppercase tracking-[0.06em] text-[var(--clinical-ink)]">Quick record</h2>
                <p className="text-xs text-[var(--clinical-muted)]">Additional or higher-frequency entries</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {QUICK_RECORD_TILES.map(({ label, icon: Icon, focus }) => (
                  <button key={label} type="button" onClick={() => setQuickFocus(focus)}
                    className="flex flex-col items-center justify-center gap-2 rounded-xl border border-[var(--clinical-line)] px-3 py-4 text-center transition hover:border-[var(--clinical-panel)] hover:bg-[var(--clinical-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--clinical-panel)]">
                    <Icon className="h-5 w-5 text-[var(--clinical-panel)]" />
                    <span className="text-xs font-semibold text-[var(--clinical-ink)]">{label}</span>
                  </button>
                ))}
              </div>
            </section>

            {/* Search + status filter */}
            <SearchInput value={search} onChange={setSearch} placeholder="Search assigned resident or room" />
            <div id="cg-roster" role="tablist" aria-label="Care status" className="flex flex-wrap gap-2 scroll-mt-4">
              {([
                ["all", "All", counts.all],
                ["due", "Due", counts.due],
                ["overdue", "Overdue", counts.overdue],
                ["uptodate", "Up to date", counts.uptodate],
              ] as const).map(([value, label, count]) => (
                <button key={value} role="tab" aria-selected={filter === value} onClick={() => setFilter(value)}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition ${filter === value ? "border-[var(--clinical-panel)] bg-[var(--clinical-panel)] text-white" : "border-[var(--clinical-line)] text-[var(--clinical-ink-soft)] hover:text-[var(--clinical-ink)]"}`}>
                  {label} <span className="tabular-nums opacity-80">{count}</span>
                </button>
              ))}
            </div>

            {/* Resident routine cards */}
            {visibleCards.length === 0 ? (
              <div className="rounded-2xl border border-[var(--clinical-line)] bg-[var(--clinical-surface)] p-8 text-center">
                <p className="font-semibold text-[var(--clinical-ink)]">{cards.length === 0 ? "No residents assigned to this shift" : "No residents match"}</p>
                <p className="mt-1 text-sm text-[var(--clinical-muted)]">{cards.length === 0 ? "Assigned residents appear here when the current roster gives you coverage responsibility." : "Clear the search or filter to see all residents."}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {visibleCards.map((c) => (
                  <div key={c.id} className="rounded-2xl border border-[var(--clinical-line)] bg-[var(--clinical-surface)] p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-[var(--clinical-surface-2)] leading-none">
                        <span className="text-[9px] font-semibold uppercase tracking-wide text-[var(--clinical-muted)]">Room</span>
                        <span className="mt-1 text-base font-bold text-[var(--clinical-ink)]">{c.room || "—"}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold text-[var(--clinical-ink)]">{c.name}</p>
                        {(() => {
                          const { tags, note } = parsePrecautions(c.precautions);
                          return (
                            <>
                              {tags.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                  {tags.map((t) => {
                                    const critical = t.label === "Allergies";
                                    return (
                                      <span key={`${t.label}:${t.value}`} className="inline-flex items-center gap-1 rounded-md bg-[var(--clinical-surface-2)] px-2 py-0.5 text-[11px] font-semibold text-[var(--clinical-ink-soft)]">
                                        {t.label && <span className="font-normal opacity-60">{t.label}</span>}<span className={critical ? "text-rose-600 dark:text-rose-400" : ""}>{t.value}</span>
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                              {note && <p className="mt-1.5 line-clamp-1 text-xs text-[var(--clinical-muted)]">{note}</p>}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                    {c.nextTitle && (
                      <div className="mt-3">
                        <p className="text-xs text-[var(--clinical-muted)]">{c.nextTime ? `${c.nextTime} · ` : ""}Next priority</p>
                        <p className="font-semibold text-[var(--clinical-ink)]">{c.nextTitle}</p>
                      </div>
                    )}
                    {/* Overdue / due-next are clickable → open this resident's routine. */}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {c.overdue > 0 && (
                        <button type="button" onClick={() => openRoutine(c)}
                          className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-300">
                          {c.overdue} overdue
                        </button>
                      )}
                      {c.dueNext > 0 && (
                        <button type="button" onClick={() => openRoutine(c)}
                          className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300">
                          {c.dueNext} due next
                        </button>
                      )}
                      {c.status === "uptodate" && (
                        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">Up to date</span>
                      )}
                    </div>
                    {/* Daily Log + ADL live as tabs inside the Open Routine hub below;
                        Weight + MAR are now standing caregiver sidebar items. */}
                    <button type="button" onClick={() => openRoutine(c)}
                      className="mt-2 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--clinical-panel)] px-4 text-sm font-semibold text-white transition hover:opacity-90">
                      Open routine <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </DataState>

      {quickFocus && <QuickRecordFlow focus={quickFocus} onClose={() => setQuickFocus(null)} />}
      {routineResident && (
        <ClinicalModal open onClose={() => setRoutineResident(null)} title={`Routine — ${routineResident.name}`} description="Checklist, daily log and ADL for this resident." size="xl">
          <div role="tablist" aria-label="Routine sections" className="mb-4 flex gap-1 rounded-xl bg-[var(--clinical-surface-2)] p-1">
            {([["routine", "Routine"], ["log", "Daily Log"], ["adl", "ADL"]] as const).map(([value, label]) => (
              <button key={value} role="tab" aria-selected={routineTab === value} onClick={() => setRoutineTab(value)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${routineTab === value ? "bg-[var(--clinical-surface)] text-[var(--clinical-panel)] shadow-sm" : "text-[var(--clinical-muted)] hover:text-[var(--clinical-ink)]"}`}>
                {label}
              </button>
            ))}
          </div>
          {routineTab === "routine" && <TodaysCareBoard role="CAREGIVER" focusResidentId={routineResident.id} embedded />}
          {routineTab === "log" && <QuickRecordFlow residentId={routineResident.id} embedded onClose={() => {}} />}
          {routineTab === "adl" && <ADLMonitoringBoard clinicianRole="CAREGIVER" focusResidentId={routineResident.id} embedded />}
        </ClinicalModal>
      )}

      {showToday && (
        <ClinicalModal open onClose={() => setShowToday(false)} size="xl" title="Today's Care" description="Your assigned residents' shift care checklist.">
          <TodaysCareBoard role="CAREGIVER" embedded />
        </ClinicalModal>
      )}
      {showHandover && (
        <ClinicalModal open onClose={() => setShowHandover(false)} size="xl" title="Shift Handover" description="Review and record the shift endorsement.">
          <ShiftEndorsementBoard clinicianRole="CAREGIVER" embedded />
        </ClinicalModal>
      )}
    </ClinicalPage>
  );
}
