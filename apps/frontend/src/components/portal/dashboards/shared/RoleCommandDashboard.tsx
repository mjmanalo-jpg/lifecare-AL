"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity, AlertTriangle, ArrowUpRight, BellRing, CalendarClock, CheckCircle2,
  ChevronRight, CircleHelp, ClipboardCheck, Clock3, Info, Loader2, RefreshCw,
  ShieldAlert, Stethoscope, UserRoundCheck, UsersRound,
} from "lucide-react";
import {
  ClinicalButton, ClinicalCard, ClinicalHeader, ClinicalModal, ClinicalPage,
  DataState, FieldLabel, StatusPill, controlClass,
} from "@/components/portal/views/clinical/clinical-ui";
import type {
  DashboardAction, DashboardMetric, DashboardPayload, DashboardQueueItem, DashboardRole,
} from "@/lib/dashboard/types";
import { NURSE_COMMAND_SHORTCUTS } from "@/lib/dashboard/nurseZones";

type DrilldownData = {
  metricKey: string; asOf: string; numerator: number; denominator: number; truncated: boolean;
  records: Array<{ id: string; label: string; detail?: string; occurredAt?: string; href: string; inNumerator: boolean }>;
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

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/dashboards/${role}`, { cache: "no-store", credentials: "include" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Dashboard unavailable.");
      setData(body);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dashboard unavailable.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [role]);

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
    ["act-now", "now", "my-residents", "my-care-now", "clinical-triage", "clinical-state", "clinical-risk", "facility-status", "urgent", "professional-review"].includes(item.key)), [visibleSections]);
  const otherSections = useMemo(() => visibleSections.filter((item) =>
    !primarySections.some((primary) => primary.key === item.key)), [primarySections, visibleSections]);

  return (
    <ClinicalPage className="space-y-5">
      <ClinicalHeader
        title={pageTitle || data?.title || "Care dashboard"}
        subtitle={pageSubtitle || data?.subtitle || "Loading the governed care record…"}
        right={
          <div className="flex flex-wrap items-center gap-2">
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
            {error && <InlineNotice tone="danger" text={error} />}
            {data.warnings.map((warning) => <InlineNotice key={warning} tone="warning" text={warning} />)}

            {showMetrics && (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {data.metrics.map((item) => (
                  <MetricButton key={item.key} metric={item} active={selectedMetric?.key === item.key}
                    onClick={() => setSelectedMetric((current) => current?.key === item.key ? null : item)} />
                ))}
              </div>
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
  const summaries = data.role === "resident-coordinator" ? [
    { label: "Urgent", value: data.sections.find((item) => item.key === "urgent")?.items.length || 0 },
    { label: "Due today", value: data.sections.find((item) => item.key === "today")?.items.length || 0 },
    { label: "Upcoming", value: data.sections.find((item) => item.key === "upcoming")?.items.length || 0 },
    { label: "Unowned", value: data.sections.find((item) => item.key === "awaiting")?.items.length || 0 },
    { label: "Admissions", value: data.sections.find((item) => item.key === "admissions")?.items.length || 0 },
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

function MetricButton({ metric, active, onClick }: { metric: DashboardMetric; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={active}
      className={`min-h-28 rounded-xl border p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--clinical-panel)] sm:p-4 ${active ? "border-[var(--clinical-panel)] bg-[var(--clinical-surface-2)]" : "border-[var(--clinical-line)] bg-[var(--clinical-surface)] hover:border-[var(--clinical-line-strong)]"}`}>
      <span className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--clinical-muted)]">{metric.label}</span>
        <Info className="h-3.5 w-3.5 shrink-0 text-[var(--clinical-muted)]" />
      </span>
      <span className={`mt-3 block text-3xl font-bold tracking-[-0.03em] tabular-nums ${METRIC_TONE[metric.state]}`}>{metric.display}</span>
      <span className="mt-1 block truncate text-xs text-[var(--clinical-muted)]">{metric.window}</span>
    </button>
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
        {item.photoUrl && <img src={item.photoUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />}
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
