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
  Calendar, Repeat, RefreshCw, ChevronRight, NotebookPen, Accessibility, Scale, Syringe,
  ListChecks, Clock, Flag, ShieldCheck,
} from "lucide-react";
import { ClinicalHeader, ClinicalModal, ClinicalPage, DataState, SearchInput } from "@/components/portal/views/clinical/clinical-ui";
import { QuickRecordFlow } from "@/components/portal/views/clinical/CareLogsBoard";
import TodaysCareBoard from "@/components/portal/views/clinical/TodaysCareBoard";
import ADLMonitoringBoard from "@/components/portal/views/clinical/ADLMonitoringBoard";
import WeightMonitoringBoard from "@/components/portal/views/clinical/WeightMonitoringBoard";
import MARDailyBoard from "@/components/portal/views/clinical/MARDailyBoard";
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

export default function CaregiverShiftBoard() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "due" | "overdue" | "uptodate">("all");
  const [quickFocus, setQuickFocus] = useState<string | null>(null);
  const [routineResident, setRoutineResident] = useState<{ id: string; name: string } | null>(null);
  const [cardAction, setCardAction] = useState<{ kind: "log" | "adl" | "weight" | "mar"; id: string; name: string } | null>(null);
  const [showToday, setShowToday] = useState(false);
  const [showHandover, setShowHandover] = useState(false);

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

  // Metric card values. Due now / Overdue are derived from the SAME per-resident
  // buckets as the roster below (overdue = my-care-now, due next = my-care-next),
  // so the tiles can never disagree with each resident's "N overdue · N due next"
  // badges — previously "Due now" read the my-care-now bucket and duplicated Overdue.
  const completion = data?.metrics.find((m) => m.key === "care_delivery_on_time");
  const overdueCount = cards.reduce((sum, c) => sum + c.overdue, 0);
  const dueNowCount = cards.reduce((sum, c) => sum + c.dueNext, 0);
  const dueNowResidents = cards.filter((c) => c.dueNext > 0).length;
  const openConcerns = data?.summary.openEscalations ?? 0;

  const shiftLine = data
    ? `${data.shift.label} · ${data.shift.range} · ${data.summary.activeResidents} assigned resident${data.summary.activeResidents === 1 ? "" : "s"}`
    : "Loading shift…";

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
              {/* Shift task completion */}
              <div className="bg-[var(--clinical-surface)] p-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-500/10 text-[var(--clinical-panel)]"><ListChecks className="h-4 w-4" /></span>
                  <p className="text-2xl font-bold leading-none tabular-nums text-[var(--clinical-ink)]">{completion ? completion.numerator : "—"}{completion ? <span className="text-sm font-semibold text-[var(--clinical-muted)]"> / {completion.denominator}</span> : null}</p>
                </div>
                <p className="mt-1.5 text-[12px] font-semibold text-[var(--clinical-ink)]">Tasks done this shift</p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--clinical-surface-2)]"><div className="h-full rounded-full bg-[var(--clinical-panel)] transition-[width] duration-500" style={{ width: `${completion && completion.denominator ? Math.round((completion.numerator / completion.denominator) * 100) : 0}%` }} /></div>
              </div>

              {/* Due now — items coming due this shift (not yet overdue) */}
              <div className="bg-[var(--clinical-surface)] p-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-[var(--clinical-amber)]"><Clock className="h-4 w-4" /></span>
                  <p className="text-2xl font-bold leading-none tabular-nums text-[var(--clinical-ink)]">{dueNowCount}</p>
                </div>
                <p className="mt-1.5 text-[12px] font-semibold text-[var(--clinical-ink)]">Due now</p>
                <p className="mt-0.5 text-[10px] text-[var(--clinical-muted)]">Across {dueNowResidents} resident{dueNowResidents === 1 ? "" : "s"}</p>
              </div>

              {/* Overdue — tile flushes red when there is overdue work */}
              <div className={`p-3 ${overdueCount ? "bg-red-500/[0.06]" : "bg-[var(--clinical-surface)]"}`}>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${overdueCount ? "bg-red-500/15 text-[var(--clinical-danger,#dc2626)]" : "bg-[var(--clinical-surface-2)] text-[var(--clinical-muted)]"}`}><AlertTriangle className="h-4 w-4" /></span>
                  <p className={`text-2xl font-bold leading-none tabular-nums ${overdueCount ? "text-[var(--clinical-danger,#dc2626)]" : "text-[var(--clinical-ink)]"}`}>{overdueCount}</p>
                </div>
                <p className="mt-1.5 text-[12px] font-semibold text-[var(--clinical-ink)]">Overdue</p>
                <p className={`mt-0.5 text-[10px] font-medium ${overdueCount ? "text-[var(--clinical-danger,#dc2626)]" : "text-[var(--clinical-muted)]"}`}>{overdueCount ? "Needs action now" : "All caught up"}</p>
              </div>

              {/* Open concerns */}
              <div className="bg-[var(--clinical-surface)] p-3">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${openConcerns ? "bg-amber-500/10 text-[var(--clinical-amber)]" : "bg-emerald-500/10 text-emerald-500"}`}>{openConcerns ? <Flag className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}</span>
                  <p className={`text-2xl font-bold leading-none tabular-nums ${openConcerns ? "text-[var(--clinical-amber)]" : "text-[var(--clinical-ink)]"}`}>{openConcerns}</p>
                </div>
                <p className="mt-1.5 text-[12px] font-semibold text-[var(--clinical-ink)]">Open concerns</p>
                <p className={`mt-0.5 text-[10px] ${openConcerns ? "text-[var(--clinical-amber)]" : "text-emerald-500"}`}>{openConcerns ? "Nurse notified" : "None — all clear"}</p>
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
                        <button type="button" onClick={() => setRoutineResident({ id: c.id, name: c.name })}
                          className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-300">
                          {c.overdue} overdue
                        </button>
                      )}
                      {c.dueNext > 0 && (
                        <button type="button" onClick={() => setRoutineResident({ id: c.id, name: c.name })}
                          className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300">
                          {c.dueNext} due next
                        </button>
                      )}
                      {c.status === "uptodate" && (
                        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">Up to date</span>
                      )}
                    </div>
                    {/* Per-resident chart shortcuts — open in-place (modal), scoped
                        to this resident. Replaces the Daily Log / ADL / Weight / MAR
                        sidebar items: one tap, no page navigation. */}
                    <div className="mt-3 grid grid-cols-4 gap-2">
                      {([
                        ["log", "Daily Log", NotebookPen],
                        ["adl", "ADL", Accessibility],
                        ["weight", "Weight", Scale],
                        ["mar", "MAR", Syringe],
                      ] as const).map(([kind, label, Icon]) => (
                        <button key={kind} type="button" onClick={() => setCardAction({ kind, id: c.id, name: c.name })}
                          className="flex flex-col items-center justify-center gap-1 rounded-lg border border-[var(--clinical-line)] px-2 py-2 text-[11px] font-semibold text-[var(--clinical-ink-soft)] transition hover:border-[var(--clinical-panel)] hover:bg-[var(--clinical-surface-2)] hover:text-[var(--clinical-ink)]">
                          <Icon className="h-4 w-4 text-[var(--clinical-panel)]" />
                          {label}
                        </button>
                      ))}
                    </div>
                    <button type="button" onClick={() => setRoutineResident({ id: c.id, name: c.name })}
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
        <ClinicalModal open onClose={() => setRoutineResident(null)} title={`Routine — ${routineResident.name}`} description="Today's care checklist for this resident." size="xl">
          <TodaysCareBoard role="CAREGIVER" focusResidentId={routineResident.id} embedded />
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

      {/* Per-resident chart shortcuts, opened in-place from the card. */}
      {cardAction?.kind === "log" && (
        <QuickRecordFlow residentId={cardAction.id} onClose={() => setCardAction(null)} />
      )}
      {cardAction && cardAction.kind !== "log" && (
        <ClinicalModal open onClose={() => setCardAction(null)} size="xl"
          title={`${cardAction.kind === "adl" ? "Daily Living (ADL)" : cardAction.kind === "weight" ? "Weight Tracking" : "MAR"} — ${cardAction.name}`}>
          {cardAction.kind === "adl" && <ADLMonitoringBoard clinicianRole="CAREGIVER" focusResidentId={cardAction.id} embedded />}
          {cardAction.kind === "weight" && <WeightMonitoringBoard clinicianRole="CAREGIVER" focusResidentId={cardAction.id} embedded />}
          {cardAction.kind === "mar" && <MARDailyBoard clinicianRole="CAREGIVER" focusResidentId={cardAction.id} embedded />}
        </ClinicalModal>
      )}
    </ClinicalPage>
  );
}
