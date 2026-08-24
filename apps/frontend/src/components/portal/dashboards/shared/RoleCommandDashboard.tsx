"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Activity, AlertTriangle, ArrowUpRight, BellRing, CalendarClock, CheckCircle2,
  ChevronRight, ChevronDown, CircleHelp, ClipboardCheck, ClipboardList, Clock3, Info, Loader2, RefreshCw,
  ShieldAlert, Stethoscope, UserRoundCheck, UsersRound, Timer, Clock, CalendarDays, CalendarRange,
  TrendingUp, TrendingDown,
} from "lucide-react";
import {
  ClinicalButton, ClinicalCard, ClinicalHeader, ClinicalModal, ClinicalPage,
  DataState, FieldLabel, StatusPill, controlClass,
} from "@/components/portal/views/clinical/clinical-ui";
import type {
  DashboardAction, DashboardHuddle, DashboardMetric, DashboardPayload, DashboardQueueItem, DashboardRole, DashboardWindowKey,
} from "@/lib/dashboard/types";
import { NURSE_COMMAND_SHORTCUTS } from "@/lib/dashboard/nurseZones";

type DrilldownData = {
  metricKey: string; asOf: string; numerator: number; denominator: number; truncated: boolean;
  records: Array<{ id: string; label: string; detail?: string; occurredAt?: string; href: string; inNumerator: boolean }>;
};

const DASHBOARD_WINDOW_OPTIONS: Record<DashboardWindowKey, { label: string; icon: typeof Timer; hint: string }> = {
  shift: { label: "Shift", icon: Timer, hint: "Current shift" },
  "24h": { label: "24 h", icon: Clock, hint: "Rolling 24 hours" },
  "7d": { label: "7 days", icon: CalendarDays, hint: "Rolling 7 days" },
  "30d": { label: "30 days", icon: CalendarRange, hint: "Rolling 30 days" },
};

const SECTION_ICONS: Record<string, typeof Activity> = {
  "clinical-triage": ShieldAlert, "caregiver-deployment": UsersRound,
  "shift-watchlist": UserRoundCheck, "care-delivery-status": Activity,
  "shift-endorsement": ClipboardCheck,
  "my-residents": UserRoundCheck, "my-care-now": ShieldAlert, "my-care-next": CalendarClock,
  "my-care-later": Clock3, "document-care": ClipboardCheck, "need-nurse-help": ShieldAlert,
  "assignment-update": UserRoundCheck, "shift-close": ClipboardCheck,
  "act-now": ShieldAlert, "nurse-review": Stethoscope, "due-overdue": CalendarClock,
  deployment: UsersRound, watchlist: UserRoundCheck, "next-two-hours": Clock3,
  "new-since-shift": BellRing, handover: ClipboardCheck, assignment: UserRoundCheck,
  now: ShieldAlert, next: CalendarClock, later: Clock3, precautions: AlertTriangle,
  "clinical-state": Stethoscope, "clinical-risk": Stethoscope, "assessment-loc": ClipboardCheck,
  "care-plan-governance": ClipboardCheck, "care-delivery-reliability": Activity,
  "safety-transitions": ShieldAlert, "staffing-team-quality": UsersRound, "open-decisions": CircleHelp,
  "facility-status": Activity, "care-quality": CheckCircle2, safety: ShieldAlert,
  workforce: UsersRound, continuity: ClipboardCheck, urgent: ShieldAlert, today: CalendarClock,
  upcoming: Clock3, awaiting: CircleHelp, admissions: UserRoundCheck,
  residents: UserRoundCheck, "family-contacts": UsersRound, endorsement: ClipboardCheck,
  "professional-review": Stethoscope, "care-plan-review": ClipboardCheck,
  // Administrator (§7) zones.
  "community-snapshot": UsersRound, "staffing-coverage": UsersRound,
  "clinical-quality-safety": ShieldAlert, "care-governance-compliance": ClipboardCheck,
  "service-utilization": Stethoscope, "management-action-queue": ShieldAlert,
  // Resident Coordinator (§8) zones.
  "resident-snapshot": UserRoundCheck, "today-schedule": CalendarClock,
  "admissions-returns": UserRoundCheck, "open-coordination": ClipboardCheck,
  "family-preferences": UsersRound, "alerts-for-action": BellRing, "endorsement-notes": ClipboardCheck,
};

const PRIORITY_CLASS = {
  P1: "bg-[var(--clinical-coral)] text-white",
  P2: "bg-amber-500 text-amber-950",
  P3: "bg-[var(--clinical-panel)] text-white",
  P4: "bg-[var(--clinical-surface-2)] text-[var(--clinical-ink-soft)]",
};
const METRIC_TONE = {
  GOOD: "text-emerald-600",
  WATCH: "text-amber-600",
  ACTION: "text-[var(--clinical-coral)]",
};

// Attention band ordering: act first, then watch. GOOD never reaches the band.
const ATTENTION_RANK: Record<string, number> = { ACTION: 0, WATCH: 1, GOOD: 2 };

const METRIC_STATE_LABEL: Record<string, string> = { ACTION: "Act now", WATCH: "Watch", GOOD: "Steady" };
const METRIC_TOP: Record<string, "coral" | "amber" | "green" | "none"> = { ACTION: "coral", WATCH: "amber", GOOD: "none" };

// Governed §6/§7 zone a KPI belongs to, keyed by metric key. Role-agnostic labels so
// one map serves care-manager and administrator alike; unmapped keys fall to "Other measures".
const METRIC_GROUP: Record<string, string> = {
  open_clinical_escalations: "Clinical Risk", change_of_condition: "Clinical Risk", repeated_variance_rate: "Clinical Risk",
  assessment_current: "Assessment & LOC", reassessment_on_time: "Assessment & LOC",
  care_plan_current: "Care Plan", care_plan_backlog: "Care Plan",
  care_delivered_this_shift: "Care Delivery", care_delivery: "Care Delivery", variance_free_delivery: "Care Delivery",
  care_delivery_reliability: "Care Delivery", observed_vs_planned_burden: "Care Delivery",
  overdue_care_rate: "Care Delivery", exception_event_rate: "Care Delivery",
  safety_incidents: "Safety & Transitions", hospital_ed: "Safety & Transitions", hospital_ed_count: "Safety & Transitions",
  assignment_coverage: "Staffing & Coverage", unassigned_care: "Staffing & Coverage",
  competency_currency: "Staffing & Coverage", census_occupancy: "Staffing & Coverage",
  dt013_review_load: "Service & Decisions", dt013_utilization: "Service & Decisions",
  dt014_review_load: "Service & Decisions", dt014_utilization: "Service & Decisions",
  nursing_review_turnaround: "Service & Decisions", audit_exceptions: "Governance",
};
function metricGroup(key: string) { return METRIC_GROUP[key] ?? "Other measures"; }

/** Movement vs the metric's own baseline, only when both sides are comparable percentages.
 *  Direction is shown neutrally — the metric's state already carries good/bad, so an arrow
 *  never implies "up is good" (escalations rising is bad). */
function metricDelta(metric: DashboardMetric): number | null {
  if (!metric.baseline || !metric.display.includes("%")) return null;
  const current = Number(metric.display.replace(/[^0-9.-]/g, ""));
  const baseMatch = metric.baseline.match(/(-?\d+(?:\.\d+)?)\s*%/);
  if (!baseMatch || Number.isNaN(current)) return null;
  const base = Number(baseMatch[1]);
  if (Number.isNaN(base)) return null;
  return Math.round((current - base) * 10) / 10;
}

function formatTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function relativeFreshness(value?: string) {
  if (!value) return "Waiting for first refresh";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Waiting for first refresh"
    : `Updated ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
}

interface RoleCommandDashboardProps {
  role: DashboardRole;
  sectionKeys?: readonly string[];
  pageTitle?: string;
  pageSubtitle?: string;
  showMetrics?: boolean;
  showShiftSummary?: boolean;
}

export default function RoleCommandDashboard({
  role,
  sectionKeys,
  pageTitle,
  pageSubtitle,
  showMetrics = true,
  showShiftSummary = true,
}: RoleCommandDashboardProps) {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<DashboardMetric | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [actingId, setActingId] = useState("");
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownError, setDrilldownError] = useState("");
  const [drilldown, setDrilldown] = useState<DrilldownData | null>(null);
  const [windowKey, setWindowKey] = useState<DashboardWindowKey>("shift");
  const [measuresOpen, setMeasuresOpen] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/dashboards/${role}?window=${encodeURIComponent(windowKey)}`, { cache: "no-store", credentials: "include" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Dashboard unavailable.");
      setData(body);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dashboard unavailable.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [role, windowKey]);

  useEffect(() => {
    // Initial synchronization with the server-owned dashboard read model.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const refresh = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(refresh);
  }, [load]);

  const runAction = async (action: DashboardAction) => {
    setActingId(action.entityId);
    try {
      const body = action.type === "ACKNOWLEDGE_ASSIGNMENT"
        ? { action: action.type, assignmentId: action.entityId }
        : { action: action.type, escalationId: action.entityId };
      const response = await fetch("/api/dashboards/actions", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Action could not be completed.");
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action could not be completed.");
    } finally {
      setActingId("");
    }
  };

  const openDrilldown = async (metric: DashboardMetric) => {
    setDrilldownOpen(true); setDrilldownLoading(true); setDrilldownError(""); setDrilldown(null);
    try {
      const response = await fetch(`/api/dashboards/drilldown/${encodeURIComponent(metric.key)}?role=${encodeURIComponent(role)}`, { cache: "no-store", credentials: "include" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Metric records could not be loaded.");
      setDrilldown(body);
    } catch (cause) {
      setDrilldownError(cause instanceof Error ? cause.message : "Metric records could not be loaded.");
    } finally {
      setDrilldownLoading(false);
    }
  };

  const visibleSections = useMemo(() => {
    const sections = data?.sections ?? [];
    if (!sectionKeys?.length) return sections;
    const allowed = new Set(sectionKeys);
    return sections.filter((section) => allowed.has(section.key));
  }, [data, sectionKeys]);
  const primarySections = useMemo(() => visibleSections.filter((item) =>
    ["act-now", "now", "my-residents", "my-care-now", "clinical-triage", "clinical-state", "clinical-risk", "facility-status", "urgent", "professional-review", "community-snapshot", "management-action-queue", "alerts-for-action", "resident-snapshot"].includes(item.key)), [visibleSections]);
  const otherSections = useMemo(() => visibleSections.filter((item) =>
    !primarySections.some((primary) => primary.key === item.key)), [primarySections, visibleSections]);

  return (
    <ClinicalPage className="space-y-5">
      <ClinicalHeader
        title={pageTitle || data?.title || "Care dashboard"}
        subtitle={pageSubtitle || data?.subtitle || "Loading the governed care record…"}
        right={
          <div className="flex flex-wrap items-center gap-2">
            {showMetrics && (role === "care-manager" || role === "facility-admin") && (
              <WindowSelector value={windowKey} onChange={setWindowKey} />
            )}
            {role === "caregiver" && (
              <ClinicalButton variant="danger" onClick={() => setHelpOpen(true)}>
                <ShieldAlert className="h-4 w-4" /> Need Nurse / Help
              </ClinicalButton>
            )}
            <ClinicalButton variant="secondary" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </ClinicalButton>
          </div>
        }
      />

      <DataState loading={loading && !data} error={error && !data ? new Error(error) : null} empty={false} onRetry={() => void load()} skeletonRows={6}>
        {data && (
          <>
            {showShiftSummary && <ShiftBar data={data} />}
            {role === "nurse" && <NurseCommandBar data={data} />}
            {data.huddle && <HuddlePanel huddle={data.huddle} />}
            {error && <InlineNotice tone="danger" text={error} />}
            {data.warnings.map((warning) => <InlineNotice key={warning} tone="warning" text={warning} />)}

            {showMetrics && data.metrics.length > 0 && (
              <MetricsBoard
                metrics={data.metrics}
                selectedKey={selectedMetric?.key ?? null}
                onSelect={(item) => setSelectedMetric((current) => current?.key === item.key ? null : item)}
                open={measuresOpen}
                onToggle={() => setMeasuresOpen((value) => !value)}
              />
            )}
            {showMetrics && selectedMetric && <MetricDefinition metric={selectedMetric} onDrilldown={() => void openDrilldown(selectedMetric)} />}

            <div className="space-y-4">
              {primarySections.map((item) => <QueueSection key={item.key} section={item} actingId={actingId} onAction={runAction} prominent />)}
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {otherSections.map((item) => <QueueSection key={item.key} section={item} actingId={actingId} onAction={runAction} />)}
              </div>
            </div>
          </>
        )}
      </DataState>

      {data && (
        <HelpRequestModal open={helpOpen} onClose={() => setHelpOpen(false)} residents={data.residentChoices || []}
          onComplete={() => { setHelpOpen(false); void load(true); }} />
      )}
      <DrilldownModal open={drilldownOpen} onClose={() => setDrilldownOpen(false)} metric={selectedMetric}
        loading={drilldownLoading} error={drilldownError} data={drilldown} />
    </ClinicalPage>
  );
}

function ShiftBar({ data }: { data: DashboardPayload }) {
  const sectionCount = (key: string) => data.sections.find((item) => item.key === key)?.items.length || 0;
  const summaries = data.role === "resident-coordinator" ? [
    { label: "Residents", value: data.summary.activeResidents },
    { label: "Today", value: sectionCount("today-schedule") },
    { label: "Open coordination", value: sectionCount("open-coordination") },
    { label: "Admissions", value: sectionCount("admissions-returns") },
    { label: "Alerts", value: sectionCount("alerts-for-action") },
  ] : data.role === "facility-admin" ? [
    { label: "Census", value: data.summary.activeResidents },
    { label: "Occupancy", value: data.summary.capacity ? `${data.summary.occupancyPct ?? 0}%` : "—" },
    { label: "Admissions", value: data.summary.admissionsInProgress ?? 0 },
    { label: "Watch / Escalated", value: data.summary.watchEscalated ?? 0 },
    { label: "Open escalations", value: data.summary.openEscalations },
  ] : data.role === "nurse" ? [
    { label: "Census", value: data.summary.activeResidents },
    { label: "CG present", value: data.summary.caregiversPresent ?? data.summary.staffedNow },
    { label: "PCG / dedicated", value: data.summary.pcgAssignments ?? 0 },
    { label: "Uncovered", value: data.summary.residentsUncovered },
    { label: "New / return", value: data.summary.newOrReturningResidents ?? 0 },
  ] : data.role === "caregiver" ? [
    { label: "Assigned", value: data.summary.activeResidents },
    { label: "Due now", value: data.sections.find((item) => item.key === "my-care-now")?.items.length || 0 },
    { label: "Next", value: data.sections.find((item) => item.key === "my-care-next")?.items.length || 0 },
    { label: "Open help", value: data.sections.find((item) => item.key === "need-nurse-help")?.items.length || 0 },
    { label: "Progress", value: data.metrics.find((item) => item.key === "care_delivery_on_time")?.display || "0%" },
  ] : [
    { label: "Active residents", value: data.summary.activeResidents },
    { label: "Staffed now", value: data.summary.staffedNow },
    { label: "Uncovered", value: data.summary.residentsUncovered },
    { label: "Open escalations", value: data.summary.openEscalations },
    { label: "Overdue", value: data.summary.overdueWork },
  ];
  return (
    <section className="overflow-hidden rounded-2xl bg-[var(--clinical-panel)] text-white shadow-[0_18px_44px_-32px_rgba(15,23,42,0.9)]">
      <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold">{data.shift.label}</span>
            <span className="rounded-md bg-white/12 px-2 py-1 text-xs font-semibold text-white/90">{data.shift.range}</span>
            <span className="rounded-md bg-white/12 px-2 py-1 text-xs font-semibold text-white/90">
              Handover: {data.summary.handoverStatus.replaceAll("_", " ").toLowerCase()}
            </span>
          </div>
          <p className="mt-1 text-xs text-white/70">
            {relativeFreshness(data.asOf)} - Facility service context
            {data.role === "caregiver" && ` - Nurse: ${data.summary.nurseOnDuty || "not clocked in"}`}
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-x-5 gap-y-3 sm:grid-cols-5">
          {summaries.map((item) => (
            <div key={item.label} className="min-w-0">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/60">{item.label}</dt>
              <dd className="mt-0.5 text-xl font-bold tabular-nums">{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function NurseCommandBar({ data }: { data: DashboardPayload }) {
  const counts = new Map(data.sections.map((section) => [section.key, section.items]));
  return (
    <nav aria-label="Nurse shift command shortcuts" className="overflow-hidden rounded-xl border border-[var(--clinical-line)] bg-[var(--clinical-surface)]">
      <div className="grid grid-cols-2 divide-x divide-y divide-[var(--clinical-line)] sm:grid-cols-3 xl:grid-cols-6 xl:divide-y-0">
        {NURSE_COMMAND_SHORTCUTS.map((shortcut) => {
          const items = counts.get(shortcut.sectionKey) || [];
          const value = shortcut.priority
            ? items.filter((item) => item.priority === shortcut.priority).length
            : shortcut.key === "overdue"
              ? data.summary.overdueWork
              : items.length;
          return (
            <a
              key={shortcut.key}
              href={`#${shortcut.sectionKey}`}
              className="group flex min-h-20 items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--clinical-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--clinical-panel)]"
            >
              <span className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--clinical-ink-soft)] group-hover:text-[var(--clinical-ink)]">
                {shortcut.label}
              </span>
              <span className="text-2xl font-bold tabular-nums text-[var(--clinical-panel)]">{value}</span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}

/** §11 step 4 — generated shift huddle briefing (nurse). */
function HuddlePanel({ huddle }: { huddle: DashboardHuddle }) {
  const groups: Array<{ label: string; icon: typeof UsersRound; lines: string[]; accent: string }> = [
    { label: "Residents to watch", icon: UsersRound, lines: huddle.residentsToWatch, accent: "text-[var(--clinical-panel)]" },
    { label: "Care changes", icon: Activity, lines: huddle.careChanges, accent: "text-[var(--clinical-amber)]" },
    { label: "Safety risks", icon: ShieldAlert, lines: huddle.safetyRisks, accent: "text-[var(--clinical-danger, #dc2626)]" },
    { label: "Staffing notes", icon: ClipboardList, lines: huddle.staffingNotes, accent: "text-[var(--clinical-muted)]" },
  ];
  return (
    <section aria-label="Shift huddle briefing" className="rounded-xl border border-[var(--clinical-line)] bg-[var(--clinical-surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.06em] text-[var(--clinical-ink)]">
          <Stethoscope className="h-4 w-4 text-[var(--clinical-panel)]" /> Shift huddle
        </h2>
        <span className="text-xs font-semibold text-[var(--clinical-muted)]">{huddle.headline}</span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {groups.map((group) => (
          <div key={group.label} className="min-w-0 rounded-lg border border-[var(--clinical-line)] bg-[var(--clinical-surface)] p-3">
            <p className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.07em] ${group.accent}`}>
              <group.icon className="h-3.5 w-3.5" /> {group.label}
            </p>
            {group.lines.length === 0 ? (
              <p className="mt-1.5 text-xs text-[var(--clinical-muted)]">Nothing flagged.</p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {group.lines.map((line, index) => (
                  <li key={index} className="text-xs leading-snug text-[var(--clinical-ink-soft)]">{line}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** §10 aggregate window control — lives in the header's action region for care-manager and
 *  administrator. The clock icons make it self-describing, so the group label is aria-only. */
function WindowSelector({ value, onChange }: { value: DashboardWindowKey; onChange: (key: DashboardWindowKey) => void }) {
  return (
    <div role="group" aria-label="Time window" className="flex flex-wrap items-center gap-1 rounded-xl border border-[var(--clinical-line)] bg-[var(--clinical-surface)] p-1 shadow-sm">
      {(Object.entries(DASHBOARD_WINDOW_OPTIONS) as Array<[DashboardWindowKey, { label: string; icon: typeof Timer; hint: string }]>).map(([key, { label, icon: Icon, hint }]) => {
        const active = value === key;
        return (
          <button key={key} type="button" onClick={() => onChange(key)} title={hint} aria-pressed={active}
            className={`group relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--clinical-panel)] ${active
              ? "bg-[var(--clinical-panel)] text-white shadow-[0_2px_8px_-2px_var(--clinical-panel)]"
              : "text-[var(--clinical-ink-soft)] hover:bg-[var(--clinical-surface-2)] hover:text-[var(--clinical-ink)]"}`}>
            <Icon className={`h-3.5 w-3.5 transition-colors ${active ? "text-white/80" : "text-[var(--clinical-muted)] group-hover:text-[var(--clinical-ink-soft)]"}`} aria-hidden />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Attention-first metric board: metrics in an action or watch state rise into a prominent
 *  band; steady (GOOD) metrics collapse into a zone-grouped disclosure so the eye lands on
 *  what needs a decision, not a wall of zeros. Every card still opens the same definition +
 *  drill-down via onSelect. */
function MetricsBoard({
  metrics, selectedKey, onSelect, open, onToggle,
}: {
  metrics: DashboardMetric[];
  selectedKey: string | null;
  onSelect: (metric: DashboardMetric) => void;
  open: boolean;
  onToggle: () => void;
}) {
  const attention = useMemo(
    () => metrics.filter((item) => item.state !== "GOOD").sort((a, b) => ATTENTION_RANK[a.state] - ATTENTION_RANK[b.state]),
    [metrics],
  );
  const steady = useMemo(() => metrics.filter((item) => item.state === "GOOD"), [metrics]);

  return (
    <section aria-label="Governed measures" className="space-y-3">
      {attention.length > 0 ? (
        <>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold uppercase tracking-[0.06em] text-[var(--clinical-ink)]">Needs attention</h2>
            <span className="rounded-md bg-[var(--clinical-coral)] px-2 py-0.5 text-xs font-bold tabular-nums text-white">{attention.length}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {attention.map((item) => (
              <AttentionMetricCard key={item.key} metric={item} active={selectedKey === item.key} onClick={() => onSelect(item)} />
            ))}
          </div>
        </>
      ) : (
        <ClinicalCard top="green" className="flex items-center gap-3 px-4 py-3.5">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          <div className="min-w-0">
            <p className="font-semibold text-[var(--clinical-ink)]">All measures are steady this window</p>
            <p className="mt-0.5 text-xs text-[var(--clinical-muted)]">No governed measure is in an action or watch state right now.</p>
          </div>
        </ClinicalCard>
      )}
      {steady.length > 0 && (
        <SteadyMeasures metrics={steady} selectedKey={selectedKey} onSelect={onSelect} open={open} onToggle={onToggle} />
      )}
    </section>
  );
}

function DeltaChip({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) return null;
  // Neutral tone on purpose: the state color already carries good/bad, so the arrow only shows movement.
  const Icon = delta > 0 ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums text-[var(--clinical-muted)]" title="Change versus baseline">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {Math.abs(delta)} pt{Math.abs(delta) === 1 ? "" : "s"}
    </span>
  );
}

function AttentionMetricCard({ metric, active, onClick }: { metric: DashboardMetric; active: boolean; onClick: () => void }) {
  const StateIcon = metric.state === "ACTION" ? ShieldAlert : AlertTriangle;
  const delta = metricDelta(metric);
  return (
    <ClinicalCard top={METRIC_TOP[metric.state]} className={active ? "ring-2 ring-[var(--clinical-panel)]" : ""}>
      <button type="button" onClick={onClick} aria-expanded={active}
        className="flex min-h-32 w-full flex-col p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--clinical-panel)]">
        <span className="flex items-center justify-between gap-2">
          <span className={`inline-flex items-center gap-1 rounded-md bg-[var(--clinical-surface-2)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] ${METRIC_TONE[metric.state]}`}>
            <StateIcon className="h-3 w-3" aria-hidden /> {METRIC_STATE_LABEL[metric.state]}
          </span>
          <Info className="h-3.5 w-3.5 shrink-0 text-[var(--clinical-muted)]" />
        </span>
        <span className="mt-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--clinical-muted)]">{metric.label}</span>
        <span className="mt-1 flex items-baseline gap-2">
          <span className={`text-3xl font-bold tracking-[-0.03em] tabular-nums ${METRIC_TONE[metric.state]}`}>{metric.display}</span>
          <DeltaChip delta={delta} />
        </span>
        <span className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-2 text-xs text-[var(--clinical-muted)]">
          <span>{metric.window}</span>
          {metric.baseline && <><span aria-hidden>·</span><span className="truncate">{metric.baseline}</span></>}
        </span>
      </button>
    </ClinicalCard>
  );
}

function SteadyMeasures({
  metrics, selectedKey, onSelect, open, onToggle,
}: {
  metrics: DashboardMetric[];
  selectedKey: string | null;
  onSelect: (metric: DashboardMetric) => void;
  open: boolean;
  onToggle: () => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, DashboardMetric[]>();
    for (const metric of metrics) {
      const label = metricGroup(metric.key);
      (map.get(label) ?? map.set(label, []).get(label)!).push(metric);
    }
    return Array.from(map.entries());
  }, [metrics]);

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--clinical-line)] bg-[var(--clinical-surface)]">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex w-full min-h-11 items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--clinical-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--clinical-panel)]">
        <span className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
          <span className="text-sm font-bold uppercase tracking-[0.06em] text-[var(--clinical-ink)]">Steady measures</span>
          <span className="rounded-md bg-[var(--clinical-surface-2)] px-2 py-0.5 text-xs font-bold tabular-nums text-[var(--clinical-ink-soft)]">{metrics.length}</span>
        </span>
        <ChevronDown className={`h-4 w-4 text-[var(--clinical-muted)] transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="space-y-4 border-t border-[var(--clinical-line)] px-4 py-4">
          {groups.map(([label, items]) => (
            <div key={label}>
              <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-[var(--clinical-muted)]">{label}</p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {items.map((metric) => (
                  <button key={metric.key} type="button" onClick={() => onSelect(metric)} aria-expanded={selectedKey === metric.key}
                    className={`flex min-h-14 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--clinical-panel)] ${selectedKey === metric.key ? "border-[var(--clinical-panel)] bg-[var(--clinical-surface-2)]" : "border-[var(--clinical-line)] bg-[var(--clinical-surface)] hover:border-[var(--clinical-line-strong)]"}`}>
                    <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--clinical-muted)]">{metric.label}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                      <span className="text-sm font-bold tabular-nums text-[var(--clinical-ink)]">{metric.display}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetricDefinition({ metric, onDrilldown }: { metric: DashboardMetric; onDrilldown: () => void }) {
  return (
    <div className="rounded-xl border border-[var(--clinical-line)] bg-[var(--clinical-surface-2)] p-4" aria-live="polite">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <h2 className="font-bold text-[var(--clinical-ink)]">{metric.label}</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--clinical-ink-soft)]">{metric.definition}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ClinicalButton variant="secondary" onClick={onDrilldown}><Info className="h-4 w-4" /> Inspect numerator / denominator</ClinicalButton>
          <Link href={metric.href} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-[var(--clinical-panel)] hover:bg-[var(--clinical-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--clinical-panel)]">
            Open source board <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <DefinitionCell label="Numerator" value={`${metric.numerator} · ${metric.numeratorLabel}`} />
        <DefinitionCell label="Denominator" value={`${metric.denominator} · ${metric.denominatorLabel}`} />
        <DefinitionCell label="Window" value={metric.window} />
        <DefinitionCell label="Comparison" value={metric.baseline || "No comparison baseline"} />
        <DefinitionCell label="Threshold" value={metric.threshold} />
        <DefinitionCell label="Sources" value={`${metric.sourceModels.join(", ")} · definition v${metric.definitionVersion}`} />
      </dl>
      {metric.exclusions.length > 0 && <p className="mt-3 text-xs text-[var(--clinical-muted)]">Exclusions: {metric.exclusions.join("; ")}</p>}
    </div>
  );
}

function DrilldownModal({
  open, onClose, metric, loading, error, data,
}: {
  open: boolean; onClose: () => void; metric: DashboardMetric | null; loading: boolean; error: string; data: DrilldownData | null;
}) {
  return (
    <ClinicalModal open={open} onClose={onClose} title={metric ? `${metric.label} · source records` : "Metric source records"}
      description="The numerator and denominator are recalculated from the same tenant-scoped governed sources."
      size="lg" footer={<ClinicalButton variant="secondary" onClick={onClose}>Close</ClinicalButton>}>
      {loading ? (
        <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-[var(--clinical-muted)]"><Loader2 className="h-5 w-5 animate-spin" /> Loading source records…</div>
      ) : error ? (
        <InlineNotice tone="danger" text={error} />
      ) : data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-[var(--clinical-surface-2)] p-4"><p className="text-xs font-semibold uppercase tracking-[0.07em] text-[var(--clinical-muted)]">Numerator</p><p className="mt-1 text-2xl font-bold tabular-nums text-[var(--clinical-ink)]">{data.numerator}</p></div>
            <div className="rounded-xl bg-[var(--clinical-surface-2)] p-4"><p className="text-xs font-semibold uppercase tracking-[0.07em] text-[var(--clinical-muted)]">Denominator</p><p className="mt-1 text-2xl font-bold tabular-nums text-[var(--clinical-ink)]">{data.denominator}</p></div>
          </div>
          <p className="text-xs text-[var(--clinical-muted)]">Reconciled {relativeFreshness(data.asOf)}{data.truncated ? " · showing the first 500 records" : ""}</p>
          {data.records.length === 0 ? (
            <p className="rounded-xl border border-[var(--clinical-line)] p-6 text-center text-sm text-[var(--clinical-muted)]">No records are in this metric window.</p>
          ) : (
            <div className="divide-y divide-[var(--clinical-line)] overflow-hidden rounded-xl border border-[var(--clinical-line)]">
              {data.records.map((record) => (
                <div key={record.id} className="flex items-start gap-3 bg-[var(--clinical-surface)] p-3">
                  <span className={`mt-0.5 rounded-md px-2 py-1 text-[10px] font-bold uppercase ${record.inNumerator ? "bg-emerald-100 text-emerald-800" : "bg-[var(--clinical-surface-2)] text-[var(--clinical-ink-soft)]"}`}>{record.inNumerator ? "Numerator" : "Denominator only"}</span>
                  <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-[var(--clinical-ink)]">{record.label}</p>{record.detail && <p className="mt-1 text-xs text-[var(--clinical-muted)]">{record.detail}</p>}</div>
                  <Link href={record.href} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--clinical-panel)]" aria-label={`Open ${record.label}`}><ArrowUpRight className="h-4 w-4" /></Link>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </ClinicalModal>
  );
}

function DefinitionCell({ label, value }: { label: string; value: string }) {
  return <div><dt className="font-semibold uppercase tracking-[0.06em] text-[var(--clinical-muted)]">{label}</dt><dd className="mt-1 text-[var(--clinical-ink-soft)]">{value}</dd></div>;
}

function QueueSection({
  section, actingId, onAction, prominent = false,
}: {
  section: DashboardPayload["sections"][number];
  actingId: string;
  onAction: (action: DashboardAction) => void;
  prominent?: boolean;
}) {
  const Icon = SECTION_ICONS[section.key] || Activity;
  const visible = section.items.slice(0, prominent ? 12 : 7);
  return (
    <ClinicalCard id={section.key} top={prominent && section.items.some((item) => item.priority === "P1") ? "coral" : "none"} className="scroll-mt-24 overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--clinical-line)] px-4 py-3.5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 rounded-lg bg-[var(--clinical-surface-2)] p-2 text-[var(--clinical-panel)]"><Icon className="h-4 w-4" /></span>
          <div className="min-w-0">
            <h2 className="font-bold text-[var(--clinical-ink)]">{section.title}</h2>
            <p className="mt-0.5 text-xs leading-5 text-[var(--clinical-muted)]">{section.description}</p>
          </div>
        </div>
        <span className="rounded-md bg-[var(--clinical-surface-2)] px-2 py-1 text-xs font-bold tabular-nums text-[var(--clinical-ink-soft)]">{section.items.length}</span>
      </div>
      {visible.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <CheckCircle2 className="mx-auto h-5 w-5 text-emerald-600" />
          <p className="mt-2 text-sm font-semibold text-[var(--clinical-ink)]">{section.emptyTitle}</p>
          {section.emptyHint && <p className="mt-1 text-xs text-[var(--clinical-muted)]">{section.emptyHint}</p>}
        </div>
      ) : (
        <div className="divide-y divide-[var(--clinical-line)]">
          {visible.map((item) => <QueueRow key={item.id} item={item} acting={actingId === item.sourceId} onAction={onAction} />)}
        </div>
      )}
      {section.items.length > visible.length && (
        <Link href={visible[0]?.sourceHref || "#"} className="flex min-h-11 items-center justify-center gap-1 border-t border-[var(--clinical-line)] px-4 py-2 text-sm font-semibold text-[var(--clinical-panel)] hover:bg-[var(--clinical-surface-2)]">
          View all {section.items.length} items <ChevronRight className="h-4 w-4" />
        </Link>
      )}
    </ClinicalCard>
  );
}

function QueueRow({ item, acting, onAction }: { item: DashboardQueueItem; acting: boolean; onAction: (action: DashboardAction) => void }) {
  const timestamp = item.dueAt ? `Due ${formatTime(item.dueAt)}` : formatTime(item.occurredAt);
  return (
    <article className="group px-4 py-3.5 hover:bg-[var(--clinical-surface-2)]">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 inline-flex min-w-8 items-center justify-center rounded-md px-1.5 py-1 text-[11px] font-bold ${PRIORITY_CLASS[item.priority]}`}>{item.priority}</span>
        {item.photoUrl && <Image src={item.photoUrl} alt="" width={40} height={40} unoptimized className="h-10 w-10 shrink-0 rounded-lg object-cover" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="font-semibold text-[var(--clinical-ink)]">{item.title}</h3>
            <StatusPill status={item.state} />
            {item.isNew && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-sky-800">New</span>}
          </div>
          {(item.residentLabel || item.roomLabel || timestamp) && (
            <p className="mt-1 text-xs text-[var(--clinical-muted)]">
              {[item.residentLabel, item.roomLabel ? `Room ${item.roomLabel}` : "", timestamp].filter(Boolean).join(" · ")}
            </p>
          )}
          {item.detail && <p className="mt-1.5 line-clamp-2 text-sm leading-5 text-[var(--clinical-ink-soft)]">{item.detail}</p>}
          <p className="mt-1.5 text-xs text-[var(--clinical-muted)]">{item.reason}</p>
          {item.ownerLabel && <p className="mt-1 text-xs font-medium text-[var(--clinical-ink-soft)]">Owner: {item.ownerLabel}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {item.action && (
            <ClinicalButton size="sm" onClick={() => onAction(item.action!)} disabled={acting}>
              {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              <span className="hidden sm:inline">{item.action.label}</span>
            </ClinicalButton>
          )}
          <Link href={item.sourceHref} aria-label={`Open source record for ${item.title}`}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--clinical-muted)] hover:bg-[var(--clinical-surface)] hover:text-[var(--clinical-panel)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--clinical-panel)]">
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </article>
  );
}

function InlineNotice({ tone, text }: { tone: "warning" | "danger"; text: string }) {
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${tone === "danger" ? "border-rose-300 bg-rose-50 text-rose-900" : "border-amber-300 bg-amber-50 text-amber-950"}`}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{text}</p>
    </div>
  );
}

const HELP_OPTIONS = [
  { value: "CLINICAL_CHANGE", label: "Clinical change" },
  { value: "UNSAFE", label: "Unsafe to continue" },
  { value: "SECOND_ASSIST", label: "Need second assist" },
  { value: "REFUSAL", label: "Resident refusal" },
  { value: "BEHAVIOR_CONCERN", label: "Behavior concern" },
  { value: "MEDICATION_CONCERN", label: "Medication concern" },
  { value: "OTHER", label: "Other help" },
];

function HelpRequestModal({
  open, onClose, residents, onComplete,
}: {
  open: boolean;
  onClose: () => void;
  residents: Array<{ id: string; label: string; room?: string }>;
  onComplete: () => void;
}) {
  const [residentId, setResidentId] = useState("");
  const [category, setCategory] = useState("CLINICAL_CHANGE");
  const [detail, setDetail] = useState("");
  const [observation, setObservation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!residentId || detail.trim().length < 4) {
      setError("Choose an assigned resident and describe what is happening.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/dashboards/actions", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REQUEST_HELP", residentId, category, detail, observation }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "The request could not be raised.");
      setResidentId(""); setCategory("CLINICAL_CHANGE"); setDetail(""); setObservation("");
      onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request could not be raised.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ClinicalModal open={open} onClose={onClose} title="Need Nurse / Help"
      description="Creates a traceable escalation from the resident and task context."
      footer={
        <>
          <ClinicalButton variant="secondary" onClick={onClose} disabled={submitting}>Cancel</ClinicalButton>
          <ClinicalButton variant="danger" onClick={() => void submit()} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
            Raise request
          </ClinicalButton>
        </>
      }>
      <div className="space-y-4">
        {error && <InlineNotice tone="danger" text={error} />}
        <div>
          <FieldLabel htmlFor="help-resident" required>Assigned resident</FieldLabel>
          <select id="help-resident" value={residentId} onChange={(event) => setResidentId(event.target.value)} className={controlClass}>
            <option value="">Choose resident…</option>
            {residents.map((resident) => <option key={resident.id} value={resident.id}>{resident.label}{resident.room ? ` · Room ${resident.room}` : ""}</option>)}
          </select>
        </div>
        <div>
          <FieldLabel htmlFor="help-category" required>Request type</FieldLabel>
          <select id="help-category" value={category} onChange={(event) => setCategory(event.target.value)} className={controlClass}>
            {HELP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div>
          <FieldLabel htmlFor="help-detail" required>What is happening?</FieldLabel>
          <textarea id="help-detail" rows={3} value={detail} onChange={(event) => setDetail(event.target.value)}
            placeholder="State the immediate concern and what help is needed." className={controlClass} />
        </div>
        <div>
          <FieldLabel htmlFor="help-observation">Observation</FieldLabel>
          <textarea id="help-observation" rows={2} value={observation} onChange={(event) => setObservation(event.target.value)}
            placeholder="Optional objective observation or resident response." className={controlClass} />
        </div>
        <p className="text-xs leading-5 text-[var(--clinical-muted)]">Clinical change, unsafe care, and medication concerns enter the nurse queue as urgent. This request does not alter the resident&apos;s level of care or care plan.</p>
      </div>
    </ClinicalModal>
  );
}
