"use client";

/**
 * One Care · One Journey — a per-resident journey library.
 *
 * Read-only aggregator: for the selected resident it compiles EVERY record/form
 * across the system (assessment, LOC, acuity, care-plan reviews, medications,
 * incidents, wounds, referrals, clinical records, shift endorsements, weight,
 * private caregiver, documents, notes, admission) into one chronological feed.
 * The compilation lives in `lib/residentJourney.ts`; this component only sources
 * the raw records (Prisma via useLiveQuery + app-setting JSON) and renders them.
 *
 * Roles: Nurse + Care Manager (deep-links to each source board) and Family
 * (read-only, sponsor-scoped by the API — deep-links hidden). Migration-free.
 */

import { useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Search, ChevronRight, ChevronDown, ExternalLink, Printer,
  UserPlus, ClipboardList, Gauge, Layers, Pill, AlertTriangle, Bandage,
  Stethoscope, FolderOpen, FileText, Scale, HeartHandshake, StickyNote, ClipboardCheck,
  RefreshCw, ShieldCheck, ShieldAlert, CalendarClock,
  TrendingUp, TrendingDown, Minus, ArrowRight, GitCompareArrows,
  type LucideIcon,
} from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { originOf, assessmentRawScore, classifyAssessment } from "@/lib/lifecare/assessment";
import { ASSESSMENT_DOMAINS } from "@/lib/lifecare/dataset";
import { DOMAIN_CODES } from "@/lib/lifecare/types";
import { type ClinicianRole } from "./useClinician";
import { ClinicalPage, ClinicalHeader, ClinicalButton, StatCard, DataState, SERIF } from "./clinical-ui";
import {
  buildJourney, JOURNEY_CATEGORY_META, JOURNEY_CATEGORY_ORDER,
  type JourneyCategory, type JourneyAccent, type JourneyEvent,
} from "@/lib/residentJourney";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const DOMAIN_NAME: Record<string, string> = Object.fromEntries(ASSESSMENT_DOMAINS.map((d) => [d.code, d.name]));
interface DomainRow { code: string; name: string; score: number; note: string }
interface FormValidation { by: string; role: string; at: string; decision: string; notes: string }
interface FormRecord {
  id: string; kind: string; originLabel: string; icon: LucideIcon;
  status: string; level: string; score: number; date: string; by: string; reason: string;
  isReassessment: boolean; suggestedLevel: string; capabilityGate: boolean;
  justification: string; interval: string; nextReview: string;
  validation: FormValidation | null; completedBy: string; completedAt: string;
  domains: DomainRow[];
}
const s = (v: unknown) => (v == null ? "" : String(v));
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
const pick = (r: Row, ...keys: string[]) => { for (const k of keys) { const v = r?.[k]; if (v != null && v !== "") return s(v); } return ""; };
const fmtDate = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
const fmtDay = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }); };

const ACCENT_VAR: Record<JourneyAccent, string> = {
  teal: "var(--clinical-panel)", green: "var(--clinical-green)", amber: "var(--clinical-amber)",
  coral: "var(--clinical-coral)", ink: "var(--clinical-ink-soft)",
};
const CATEGORY_ICON: Record<JourneyCategory, LucideIcon> = {
  ADMISSION: UserPlus, ASSESSMENT: ClipboardList, LOC: Gauge, CARE_PLAN: ClipboardCheck,
  ACUITY: Layers, MEDICATION: Pill, INCIDENT: AlertTriangle, WOUND: Bandage,
  REFERRAL: Stethoscope, CLINICAL_RECORD: FolderOpen, ENDORSEMENT: FileText,
  WEIGHT: Scale, PRIVATE_CARE: HeartHandshake, DOCUMENT: FileText, NOTE: StickyNote,
};

const settingVal = (rows: Row[], key: string) => rows.find((r) => s(r.key || r.id) === key)?.value as string | undefined;
const parseArr = (raw: string | undefined): Row[] => { if (!raw) return []; try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; } };
const parseObj = (raw: string | undefined): Record<string, Row[]> => { if (!raw) return {}; try { const v = JSON.parse(raw); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; } };

export default function ResidentJourneyBoard({ clinicianRole = "NURSE", readOnly = false }: { clinicianRole?: ClinicianRole; readOnly?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  // Portal segment from the live URL (nurse / care_manager / …) — the Care Manager
  // portal passes clinicianRole="FACILITY_ADMIN", so the URL is the reliable source.
  const roleSeg = (pathname || "").split("/").filter(Boolean)[0] || clinicianRole.toLowerCase();
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const { data: settingRows } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  const medQ = useLiveQuery<Row>("medications", { query: "take=2000", tables: ["Medication"] });
  const incQ = useLiveQuery<Row>("incidents", { query: "take=2000", tables: ["Incident"] });
  const refQ = useLiveQuery<Row>("hospital-referrals", { query: "take=1000", tables: ["HospitalReferral"] });
  const docQ = useLiveQuery<Row>("resident-documents", { query: "take=1000", tables: ["ResidentDocument"] });
  const noteQ = useLiveQuery<Row>("resident-notes", { query: "take=2000", tables: ["ResidentNote"] });

  const residents = useMemo(() => (resQ.data || []).map((raw) => {
    const a = adaptResident(raw);
    const room = s(a.room ?? raw.room ?? "");
    return {
      id: s(a.id), name: s(a.name), room,
      admittedAt: pick(raw, "moveInDate", "admissionDate", "createdAt"),
      admissionSummary: [room ? `Room ${room}` : "", s(raw.careLevel) ? s(raw.careLevel) : ""].filter(Boolean).join(" · ") || undefined,
    };
  }), [resQ.data]);

  const [resId, setResId] = useState("");
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<JourneyCategory | "ALL">("ALL");
  const [view, setView] = useState<"journey" | "forms">("journey");

  const resident = useMemo(() => residents.find((r) => r.id === resId) || null, [residents, resId]);

  // Assessment-form history (Pre-Admission → reassessment) for the Forms tab.
  // Live off `assessments_v42`, so every new reassessment shows up automatically.
  const forms = useMemo<FormRecord[]>(() => {
    if (!resident) return [];
    return parseArr(settingVal(settingRows, "assessments_v42"))
      .filter((a) => s(a?.layer1?.residentId) === resident.id)
      .map((a) => {
        const isAcuity = originOf(a) === "ACUITY";
        const isReassess = !!s(a?.layer3?.priorAssessmentId);
        const cls = classifyAssessment({ domains: a?.domains ?? {}, context: a?.context ?? {} });
        const v = a?.validation;
        return {
          id: s(a.id),
          kind: isReassess ? "Reassessment" : isAcuity ? "Care Acuity Assessment" : "Pre-Admission Assessment",
          originLabel: isAcuity ? "Care Acuity" : "Pre-Admission",
          icon: isReassess ? RefreshCw : isAcuity ? Layers : UserPlus,
          status: s(a.status).toUpperCase(),
          level: s(a?.layer3?.finalLevel),
          score: assessmentRawScore({ domains: a?.domains ?? {} }),
          date: pick(a, "updatedAt", "createdAt"),
          by: s(a.createdBy),
          reason: s(a?.layer1?.reasonForAdmission),
          isReassessment: isReassess,
          suggestedLevel: s(cls.suggestedLevel),
          capabilityGate: !!cls.capabilityGate,
          justification: s(a?.layer3?.finalLevelJustification),
          interval: s(a?.layer3?.reassessmentInterval),
          nextReview: s(a?.layer3?.nextReviewDate),
          validation: v ? { by: s(v.by), role: s(v.role), at: s(v.at), decision: s(v.decision).replace(/_/g, " "), notes: s(v.notes) } : null,
          completedBy: s(a?.completedBy),
          completedAt: s(a?.completedAt),
          domains: DOMAIN_CODES.map((code) => ({ code, name: DOMAIN_NAME[code] || code, score: Number(a?.domains?.[code]?.score ?? 0), note: s(a?.domains?.[code]?.goalNote) })),
        };
      })
      .sort((x, y) => (y.date || "").localeCompare(x.date || ""));
  }, [resident, settingRows]);

  const journey = useMemo<JourneyEvent[]>(() => {
    if (!resident) return [];
    return buildJourney({
      residentId: resident.id,
      admittedAt: resident.admittedAt || undefined,
      admissionSummary: resident.admissionSummary,
      locHistory: parseArr(settingVal(settingRows, "loc_history")),
      assessmentsV42: parseArr(settingVal(settingRows, "assessments_v42")),
      carePlanReviews: parseArr(settingVal(settingRows, "care_plan_reviews")),
      acuity: parseArr(settingVal(settingRows, "acuity_assessments")),
      woundRecords: parseArr(settingVal(settingRows, "wound_records")),
      endorsements: parseArr(settingVal(settingRows, "shift_endorsements")),
      weightLogs: parseArr(settingVal(settingRows, "weight_logs")),
      clinicalRecords: parseObj(settingVal(settingRows, "clinical_records")),
      privateCare: parseArr(settingVal(settingRows, "private_caregiver_assignments")),
      medications: medQ.data || [],
      incidents: incQ.data || [],
      referrals: refQ.data || [],
      documents: docQ.data || [],
      notes: noteQ.data || [],
    });
  }, [resident, settingRows, medQ.data, incQ.data, refQ.data, docQ.data, noteQ.data]);

  // Counts per category (for the filter chips) + the filtered feed.
  const counts = useMemo(() => {
    const m = new Map<JourneyCategory, number>();
    journey.forEach((e) => m.set(e.category, (m.get(e.category) || 0) + 1));
    return m;
  }, [journey]);
  const events = useMemo(() => (cat === "ALL" ? journey : journey.filter((e) => e.category === cat)), [journey, cat]);

  const span = useMemo(() => {
    if (journey.length === 0) return "—";
    const last = journey[0].date, first = journey[journey.length - 1].date;
    return first === last ? fmtDate(first) : `${fmtDate(first)} → ${fmtDate(last)}`;
  }, [journey]);

  const q = search.trim().toLowerCase();
  const filteredResidents = residents.filter((r) => !q || r.name.toLowerCase().includes(q) || r.room.toLowerCase().includes(q));

  // Deep-link to a source board. The assessment board (careacuity) opens straight
  // to this resident via ?resident=; other boards just switch tab.
  const openTab = (tab?: string) => {
    if (!tab || readOnly) return;
    const q = tab === "careacuity" && resident ? `?resident=${encodeURIComponent(resident.id)}` : "";
    router.push(`/${roleSeg}/${tab}${q}`);
  };

  // Group the filtered feed by calendar day for the timeline rails.
  const groups = useMemo(() => {
    const g: { day: string; items: JourneyEvent[] }[] = [];
    for (const e of events) {
      const day = (e.date || "").slice(0, 10);
      const last = g[g.length - 1];
      if (last && last.day === day) last.items.push(e); else g.push({ day, items: [e] });
    }
    return g;
  }, [events]);

  // ── Resident picker ─────────────────────────────────────────────────────────
  if (!resident) {
    return (
      <ClinicalPage>
        <ClinicalHeader title="One Care · One Journey" subtitle="Every record and form for a resident, compiled into one continuous journey." />
        <div className="relative mt-5 mb-4">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-[var(--clinical-muted)]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search resident by name or room…" aria-label="Search residents" className="w-full rounded-2xl border py-3 pl-11 pr-4 text-sm outline-none focus:ring-2 focus:ring-[var(--clinical-panel)]/30" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }} />
        </div>
        <DataState loading={resQ.loading && residents.length === 0} error={resQ.error} empty={filteredResidents.length === 0} emptyTitle={q ? "No residents match" : "No residents yet"} emptyHint={q ? "Try a different name or room." : "Residents appear here once admitted."} onRetry={() => void resQ.refetch()} skeletonRows={5}>
          <div className="space-y-2">
            {filteredResidents.map((r) => (
              <button key={r.id} onClick={() => setResId(r.id)} className="group flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition hover:shadow-sm" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold" style={{ backgroundColor: "var(--clinical-surface-2)", color: "var(--clinical-ink-soft)" }}>{initials(r.name)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-[var(--clinical-ink)]">{r.name}</p>
                  <p className="text-xs text-[var(--clinical-muted)]">{r.room ? `Room ${r.room}` : "—"}{r.admittedAt ? ` · admitted ${fmtDate(r.admittedAt)}` : ""}</p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-[var(--clinical-muted)] transition group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        </DataState>
      </ClinicalPage>
    );
  }

  // ── Resident journey ─────────────────────────────────────────────────────────
  return (
    <ClinicalPage>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ClinicalButton variant="secondary" size="sm" onClick={() => { setResId(""); setCat("ALL"); }}><ChevronRight className="h-4 w-4 rotate-180" /> Residents</ClinicalButton>
          <div>
            <h1 className="text-2xl font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>{resident.name}</h1>
            <p className="text-sm text-[var(--clinical-muted)]">One Care · One Journey{resident.room ? ` — Room ${resident.room}` : ""}</p>
          </div>
        </div>
        <ClinicalButton variant="secondary" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</ClinicalButton>
      </div>

      {/* View tabs — full journey vs. the assessment-form history */}
      <div className="mb-5 inline-flex flex-wrap gap-1 rounded-xl p-1" style={{ backgroundColor: "var(--clinical-surface-2)" }}>
        {([["journey", "Journey", journey.length], ["forms", "Forms", forms.length]] as const).map(([v, label, n]) => (
          <button key={v} onClick={() => setView(v)}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${view === v ? "bg-[var(--clinical-surface)] shadow-sm text-[var(--clinical-ink)]" : "text-[var(--clinical-muted)] hover:text-[var(--clinical-ink)]"}`}>
            {label}
            <span className="rounded-full px-1.5 text-[10px] tabular-nums" style={{ backgroundColor: view === v ? "var(--clinical-surface-2)" : "var(--clinical-surface)" }}>{n}</span>
          </button>
        ))}
      </div>

      {view === "forms" ? (
        <FormsPanel forms={forms} />
      ) : (
      <>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard value={journey.length} label="Journey entries" accent="ink" />
        <StatCard value={counts.size} label="Record types" accent="ink" />
        <StatCard value={span} label="Span" accent="ink" />
        <StatCard value={journey[0] ? fmtDate(journey[0].date) : "—"} label="Latest entry" accent="ink" />
      </div>

      {/* Category filter chips */}
      <div className="mb-5 flex flex-wrap gap-2">
        <FilterChip active={cat === "ALL"} label="All" count={journey.length} onClick={() => setCat("ALL")} />
        {JOURNEY_CATEGORY_ORDER.filter((c) => counts.get(c)).map((c) => (
          <FilterChip key={c} active={cat === c} label={JOURNEY_CATEGORY_META[c].label} count={counts.get(c) || 0} accent={JOURNEY_CATEGORY_META[c].accent} onClick={() => setCat(c)} />
        ))}
      </div>

      {events.length === 0 ? (
        <div className="rounded-2xl border p-10 text-center text-sm text-[var(--clinical-muted)]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
          {journey.length === 0 ? "No records compiled for this resident yet. As forms and records are added anywhere in the system, they appear here automatically." : "No entries in this category."}
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((grp) => (
            <div key={grp.day}>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-[var(--clinical-muted)]">{fmtDay(grp.day)}</p>
              <div className="space-y-2.5">
                {grp.items.map((e) => {
                  const m = JOURNEY_CATEGORY_META[e.category];
                  const Icon = CATEGORY_ICON[e.category];
                  const color = ACCENT_VAR[m.accent];
                  return (
                    <div key={e.id} className="flex gap-3 rounded-xl border p-3.5" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, var(--clinical-surface))`, color }}><Icon className="h-4 w-4" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, var(--clinical-surface))`, color }}>{m.label}</span>
                          {e.status ? <span className="text-[11px] font-semibold text-[var(--clinical-ink-soft)]">{e.status}</span> : null}
                          <span className="ml-auto text-[11px] tabular-nums text-[var(--clinical-muted)]">{fmtDate(e.date)}</span>
                        </div>
                        <p className="mt-1 font-semibold text-[var(--clinical-ink)]">{e.title}</p>
                        {e.summary ? <p className="mt-0.5 line-clamp-2 text-sm text-[var(--clinical-ink-soft)]">{e.summary}</p> : null}
                        <div className="mt-1 flex flex-wrap items-center gap-3">
                          {e.by ? <span className="text-[11px] text-[var(--clinical-muted)]">by {e.by}</span> : null}
                          {e.href ? <a href={e.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--clinical-panel)] hover:underline">View document <ExternalLink className="h-3 w-3" /></a> : null}
                          {!readOnly && e.tab ? <button onClick={() => openTab(e.tab)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--clinical-panel)] hover:underline">Open in {m.label} <ChevronRight className="h-3 w-3" /></button> : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      </>
      )}
    </ClinicalPage>
  );
}

// ── Forms tab — the resident's assessment-form history (Pre-Admission → reassessment) ──
const FORM_STATUS_TONE: Record<string, string> = {
  VALIDATED: "var(--clinical-panel)", COMPLETED: "var(--clinical-green)",
  DRAFT: "var(--clinical-amber)", SUPERSEDED: "var(--clinical-muted)",
};

const levelNumOf = (lvl: string) => { const m = /([1-5])/.exec(lvl || ""); return m ? Number(m[1]) : 0; };

interface DomainDelta { code: string; name: string; before: number; after: number; delta: number }
interface FormChanges {
  levelBefore: string; levelAfter: string; levelDelta: number;
  scoreBefore: number; scoreAfter: number; scoreDelta: number;
  domains: DomainDelta[];
}

// Delta between a form and the chronologically previous one — the backtrack view.
function computeChanges(f: FormRecord, prev?: FormRecord): FormChanges | null {
  if (!prev) return null;
  const effCur = f.level || f.suggestedLevel;
  const effPrev = prev.level || prev.suggestedLevel;
  const domains: DomainDelta[] = f.domains
    .map((d) => {
      const before = prev.domains.find((x) => x.code === d.code)?.score ?? 0;
      return { code: d.code, name: d.name, before, after: d.score, delta: d.score - before };
    })
    .filter((d) => d.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return {
    levelBefore: effPrev, levelAfter: effCur, levelDelta: levelNumOf(effCur) - levelNumOf(effPrev),
    scoreBefore: prev.score, scoreAfter: f.score, scoreDelta: f.score - prev.score,
    domains,
  };
}

// Higher acuity/score = more care needed (coral, up); lower = improvement (green, down).
function TrendPill({ delta, suffix = "" }: { delta: number; suffix?: string }) {
  const color = delta === 0 ? "var(--clinical-muted)" : delta > 0 ? "var(--clinical-coral)" : "var(--clinical-green)";
  const Icon = delta === 0 ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums" style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
      <Icon className="h-3 w-3" />{delta > 0 ? `+${delta}` : delta}{suffix}
    </span>
  );
}

function FormsPanel({ forms }: { forms: FormRecord[] }) {
  const [openId, setOpenId] = useState<string | null>(forms[0]?.id ?? null);
  if (forms.length === 0) {
    return (
      <div className="rounded-2xl border p-10 text-center text-sm text-[var(--clinical-muted)]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
        No assessment forms recorded for this resident yet. Pre-admission assessments and reassessments appear here as they are created.
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--clinical-muted)]">Complete record trail of every assessment form for this resident — from pre-admission intake through each reassessment. Click a form to view its result. {forms.length} form{forms.length === 1 ? "" : "s"} on file.</p>
      <ol className="relative space-y-3 border-l-2 pl-6" style={{ borderColor: "var(--clinical-line)" }}>
        {forms.map((f, i) => {
          const Icon = f.icon;
          const tone = FORM_STATUS_TONE[f.status] || "var(--clinical-ink-soft)";
          const isOpen = openId === f.id;
          const prev = forms[i + 1]; // chronologically earlier form (list is newest-first)
          const chg = computeChanges(f, prev);
          return (
            <li key={f.id} className="relative">
              <span className="absolute -left-[31px] top-5 flex h-4 w-4 items-center justify-center rounded-full ring-4" style={{ backgroundColor: tone, ["--tw-ring-color" as string]: "var(--clinical-ground)" }} />
              <div className="overflow-hidden rounded-xl border transition" style={{ backgroundColor: "var(--clinical-surface)", borderColor: isOpen ? tone : "var(--clinical-line)", boxShadow: isOpen ? `0 0 0 1px ${tone}` : undefined }}>
                {/* clickable summary row */}
                <button onClick={() => setOpenId(isOpen ? null : f.id)} aria-expanded={isOpen} className="flex w-full items-start gap-3 p-4 text-left transition hover:bg-[var(--clinical-surface-2)]">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `color-mix(in srgb, ${tone} 14%, var(--clinical-surface))`, color: tone }}><Icon className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-[var(--clinical-ink)]">{f.kind}</span>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ backgroundColor: "var(--clinical-surface-2)", color: "var(--clinical-ink-soft)" }}>{f.originLabel}</span>
                      {i === 0 && <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ backgroundColor: "color-mix(in srgb, var(--clinical-panel) 12%, transparent)", color: "var(--clinical-panel)" }}>Latest</span>}
                      <span className="ml-auto text-[11px] tabular-nums text-[var(--clinical-muted)]">{fmtDate(f.date)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-white" style={{ backgroundColor: tone }}>{f.status}</span>
                      {f.level && <span className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold text-white" style={{ backgroundColor: "var(--clinical-coral)" }}>{f.level}</span>}
                      <span className="text-[11px] text-[var(--clinical-muted)]">Acuity <span className="font-bold tabular-nums text-[var(--clinical-ink-soft)]">{f.score}</span> / 56</span>
                      {chg && chg.scoreDelta !== 0 && <TrendPill delta={chg.scoreDelta} suffix=" pts" />}
                      {chg && chg.levelDelta !== 0 && <span className="inline-flex items-center gap-1 text-[10px] font-bold" style={{ color: chg.levelDelta > 0 ? "var(--clinical-coral)" : "var(--clinical-green)" }}>{chg.levelBefore}<ArrowRight className="h-3 w-3" />{chg.levelAfter}</span>}
                      {f.by && <span className="text-[11px] text-[var(--clinical-muted)]">· by {f.by}</span>}
                    </div>
                  </div>
                  <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-[var(--clinical-muted)] transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>

                {/* read-only result */}
                {isOpen && <FormResult f={f} tone={tone} prev={prev} chg={chg} />}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// The read-only outcome of a single assessment form.
function FormResult({ f, tone, prev, chg }: { f: FormRecord; tone: string; prev?: FormRecord; chg: FormChanges | null }) {
  const scored = f.domains.filter((d) => d.score > 0);
  const deltaByCode = new Map((chg?.domains ?? []).map((d) => [d.code, d.delta]));
  return (
    <div className="border-t p-4 space-y-4" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)" }}>
      {/* outcome stat grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ResultStat label="Final Level of Care" value={f.level || "—"} strong tone={f.level ? "var(--clinical-coral)" : undefined} />
        <ResultStat label="Engine suggested" value={f.suggestedLevel || "—"} />
        <ResultStat label="Raw acuity" value={`${f.score} / 56`} />
        <ResultStat label="Status" value={f.status.charAt(0) + f.status.slice(1).toLowerCase()} tone={tone} />
      </div>

      {/* acuity bar */}
      <div>
        <div className="h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: "var(--clinical-line)" }}>
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round((f.score / 56) * 100))}%`, background: tone }} />
        </div>
      </div>

      {/* changes since the previous form — the backtrack view */}
      {chg ? (
        <div className="rounded-lg border p-3" style={{ borderColor: "var(--clinical-panel)", backgroundColor: "color-mix(in srgb, var(--clinical-panel) 6%, var(--clinical-surface))" }}>
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[var(--clinical-panel)]">
            <GitCompareArrows className="h-3.5 w-3.5" /> Changes since {prev?.kind}{prev?.date ? ` · ${fmtDate(prev.date)}` : ""}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <span className="flex items-center gap-2">
              <span className="text-xs text-[var(--clinical-muted)]">Level of Care</span>
              <span className="inline-flex items-center gap-1 font-bold text-[var(--clinical-ink)]">
                {chg.levelBefore || "—"}<ArrowRight className="h-3.5 w-3.5 text-[var(--clinical-muted)]" />{chg.levelAfter || "—"}
              </span>
              {chg.levelDelta !== 0
                ? <span className="text-[11px] font-bold" style={{ color: chg.levelDelta > 0 ? "var(--clinical-coral)" : "var(--clinical-green)" }}>{chg.levelDelta > 0 ? "higher need" : "improved"}</span>
                : <span className="text-[11px] text-[var(--clinical-muted)]">unchanged</span>}
            </span>
            <span className="flex items-center gap-2">
              <span className="text-xs text-[var(--clinical-muted)]">Raw acuity</span>
              <span className="inline-flex items-center gap-1 font-bold tabular-nums text-[var(--clinical-ink)]">
                {chg.scoreBefore}<ArrowRight className="h-3.5 w-3.5 text-[var(--clinical-muted)]" />{chg.scoreAfter}
              </span>
              <TrendPill delta={chg.scoreDelta} suffix=" pts" />
            </span>
          </div>
          {chg.domains.length > 0 ? (
            <div className="mt-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--clinical-muted)]">{chg.domains.length} domain{chg.domains.length === 1 ? "" : "s"} changed</p>
              <div className="flex flex-wrap gap-1.5">
                {chg.domains.map((d) => {
                  const color = d.delta > 0 ? "var(--clinical-coral)" : "var(--clinical-green)";
                  return (
                    <span key={d.code} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]" style={{ borderColor: `color-mix(in srgb, ${color} 40%, var(--clinical-line))`, backgroundColor: "var(--clinical-surface)" }} title={`${d.name}: ${d.before} → ${d.after}`}>
                      <span className="max-w-[9rem] truncate font-medium text-[var(--clinical-ink-soft)]">{d.name}</span>
                      <span className="tabular-nums font-bold" style={{ color }}>{d.before}→{d.after}</span>
                      {d.delta > 0 ? <TrendingUp className="h-3 w-3" style={{ color }} /> : <TrendingDown className="h-3 w-3" style={{ color }} />}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="mt-2.5 text-xs text-[var(--clinical-muted)]">No domain score changes since the previous assessment.</p>
          )}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-[var(--clinical-muted)]" style={{ borderColor: "var(--clinical-line)" }}>
          Baseline assessment — the first on file for this resident, so there is nothing earlier to compare against.
        </p>
      )}

      {/* flags */}
      {f.capabilityGate && (
        <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--clinical-coral) 12%, transparent)", color: "var(--clinical-coral)" }}>
          <ShieldAlert className="h-4 w-4 shrink-0" /> Capability review required before the care plan goes live.
        </div>
      )}

      {/* validation / sign-off */}
      {f.validation ? (
        <div className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface-2)" }}>
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[var(--clinical-panel)]"><ShieldCheck className="h-3.5 w-3.5" /> Clinical validation</p>
          <p className="mt-1.5 text-[var(--clinical-ink)]"><span className="font-semibold capitalize">{f.validation.decision.toLowerCase()}</span> — by {f.validation.by}{f.validation.role ? ` (${f.validation.role})` : ""}{f.validation.at ? ` on ${fmtDate(f.validation.at)}` : ""}.</p>
          {f.validation.notes && <p className="mt-1 text-[var(--clinical-ink-soft)]">{f.validation.notes}</p>}
        </div>
      ) : f.status === "COMPLETED" ? (
        <p className="text-xs text-[var(--clinical-muted)]">Completed{f.completedBy ? ` by ${f.completedBy}` : ""} — awaiting clinical validation.</p>
      ) : null}

      {/* justification */}
      {f.justification && (
        <div className="text-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--clinical-muted)]">Final LOC justification</p>
          <p className="mt-1 text-[var(--clinical-ink-soft)]">{f.justification}</p>
        </div>
      )}

      {/* reassessment schedule */}
      {(f.interval || f.nextReview) && (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--clinical-muted)]">
          <CalendarClock className="h-3.5 w-3.5" />
          {f.interval && <span>Reassess: <span className="font-semibold text-[var(--clinical-ink-soft)]">{f.interval}</span></span>}
          {f.nextReview && <span>Next review: <span className="font-semibold text-[var(--clinical-ink-soft)]">{fmtDate(f.nextReview)}</span></span>}
        </p>
      )}

      {/* reason */}
      {f.reason && (
        <div className="text-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--clinical-muted)]">Reason for admission</p>
          <p className="mt-1 text-[var(--clinical-ink-soft)]">{f.reason}</p>
        </div>
      )}

      {/* domain breakdown */}
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--clinical-muted)]">Domain scores {scored.length > 0 ? `(${scored.length}/14 scored)` : ""}</p>
        <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {f.domains.map((d) => {
            const dlt = deltaByCode.get(d.code) ?? 0;
            const dltColor = dlt > 0 ? "var(--clinical-coral)" : "var(--clinical-green)";
            return (
            <div key={d.code} className="flex items-center gap-2 text-xs">
              <span className="w-32 shrink-0 truncate text-[var(--clinical-ink-soft)]" title={d.name}>{d.name}</span>
              <span className="flex flex-1 gap-0.5">
                {[0, 1, 2, 3].map((n) => (
                  <span key={n} className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: n < d.score ? tone : "var(--clinical-line)" }} />
                ))}
              </span>
              {dlt !== 0 && <span className="shrink-0 text-[10px] font-bold tabular-nums" style={{ color: dltColor }}>{dlt > 0 ? `+${dlt}` : dlt}</span>}
              <span className="w-6 shrink-0 text-right font-bold tabular-nums text-[var(--clinical-ink)]">{d.score}</span>
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ResultStat({ label, value, tone, strong }: { label: string; value: string; tone?: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border p-2.5" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface-2)" }}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--clinical-muted)]">{label}</p>
      <p className={`mt-0.5 tabular-nums ${strong ? "text-lg font-bold" : "text-sm font-semibold"}`} style={{ color: tone || "var(--clinical-ink)" }}>{value}</p>
    </div>
  );
}

function FilterChip({ active, label, count, accent = "ink", onClick }: { active: boolean; label: string; count: number; accent?: JourneyAccent; onClick: () => void }) {
  const color = ACCENT_VAR[accent];
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition"
      style={active
        ? { backgroundColor: color, borderColor: color, color: "#ffffff" }
        : { backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line-strong)", color: "var(--clinical-ink-soft)" }}>
      {label}
      <span className="rounded-full px-1.5 text-[10px] tabular-nums" style={active ? { backgroundColor: "rgba(255,255,255,0.25)" } : { backgroundColor: "var(--clinical-surface-2)" }}>{count}</span>
    </button>
  );
}
