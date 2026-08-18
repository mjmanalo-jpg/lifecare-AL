"use client";

/**
 * Care Acuity & Level of Care — unified onto the LifeCare v4.2 assessment.
 * The "Assessments" tab embeds ResidentAssessmentV42 (the full 3-layer
 * pre-admission form: New → complete → nurse-validate → care plan), so there is
 * ONE assessment instrument everywhere; it stores to the app-setting
 * `assessments_v42`. Service Packages, Care Activities and Level History remain.
 * Level History merges the durable `loc_history` (populated by v4.2 validation)
 * with legacy approved `acuity_assessments` records so pre-v4.2 10/14-domain
 * (0–5 /50 · 0–4 /56) history still renders. Migration-free.
 */

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { parseLocHistory, historyForResident, LOC_HISTORY_KEY, LOC_SOURCE_LABEL, type LocHistoryEntry, type LocSource } from "@/lib/lifecare/locHistory";
import { ASSESSMENTS_V42_KEY, type AssessmentV42, type AssessmentStatus } from "@/lib/lifecare/assessment";
import { careLevelEnumToLevel } from "@/lib/lifecare/carePackage";
import { LEVEL_MODEL, DOMAIN_BASELINE } from "@/lib/lifecare/levelModel";
import type { CareLevel } from "@/lib/lifecare/types";
import assessmentDomains from "@/lib/lifecare/data/assessment_domains.json";
import { adaptResident } from "@/lib/adapters";
import type { ClinicianRole } from "./useClinician";
import ResidentAssessmentV42 from "./ResidentAssessmentV42";
import {
  ClinicalPage, ClinicalHeader, ClinicalCard, ClinicalModal,
  StatCard, controlClass, SERIF,
} from "./clinical-ui";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ACUITY_KEY = "acuity_assessments";
const s = (v: unknown) => (v == null ? "" : String(v));
const fmtDate = (isoStr: string) => (isoStr ? new Date(isoStr).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");

interface Domain { key: string; label: string; scale: string[] }

// LifeCare v4.2 — the 14 SCORED assessment domains (AS-01..AS-14, 0–4 each → /56).
// Sourced directly from the rule-data JSON; each domain's 5 anchors become the
// 0–4 selector labels. NS-01 (non-scored) is filtered out. Used by NEW records.
interface DomainDefRaw { code: string; name: string; scored: boolean; anchors: string[] }
const V42_SCORED: Domain[] = (assessmentDomains as DomainDefRaw[])
  .filter((d) => d.scored)
  .map((d) => ({ key: d.code, label: d.name, scale: d.anchors }));

// Legacy 10-domain acuity model (0–5 each → /50). KEPT so pre-v4.2 records still
// render correctly in the review modal and Level-History detail view.
const LEGACY_ACUITY_DOMAINS: Domain[] = [
  { key: "adl", label: "Activities of Daily Living", scale: ["Fully independent", "Minimal setup or cueing", "Some help with 1–2 ADLs", "Help with most ADLs", "Extensive assistance (one-person)", "Total dependence (two-person)"] },
  { key: "mobility", label: "Mobility & Fall Risk", scale: ["Independent, no fall risk", "Steady with device, low risk", "Supervision, occasionally unsteady", "Assist to transfer, moderate risk", "High fall risk, extensive assist", "Non-ambulatory / bedbound"] },
  { key: "cognition", label: "Cognition & Memory", scale: ["Fully oriented", "Mild forgetfulness", "Occasional confusion", "Moderate impairment, needs cueing", "Severe impairment, disoriented", "Profound impairment"] },
  { key: "behavior", label: "Behavior & Emotional Regulation", scale: ["No concerns", "Occasional mild agitation", "Intermittent agitation/anxiety", "Frequent behaviors, redirectable", "Frequent, hard to redirect", "Severe behaviors, safety risk"] },
  { key: "nutrition", label: "Nutrition & Hydration", scale: ["Independent, good appetite", "Mild appetite changes", "Needs encouragement/monitoring", "Needs feeding assist / modified diet", "Poor intake, high risk", "Tube feeding / NPO / complex"] },
  { key: "elimination", label: "Elimination & Continence", scale: ["Fully continent", "Occasional incontinence", "Needs toileting schedule", "Frequently incontinent, needs assist", "Fully incontinent / catheter", "Ostomy / complex needs"] },
  { key: "medication", label: "Medication Complexity", scale: ["No meds or self-admin", "Simple regimen, supervised", "Several meds, nurse-administered", "Complex regimen / PRNs", "High-alert meds / titration", "IV / injectable / intensive"] },
  { key: "medical", label: "Medical Acuity & Stability", scale: ["Stable, no issues", "Stable chronic conditions", "Needs routine monitoring", "Unstable, frequent monitoring", "Acute needs / skilled care", "Complex / critical"] },
  { key: "psychosocial", label: "Psychosocial & Family Needs", scale: ["Well-adjusted", "Minor adjustment needs", "Needs regular engagement", "Isolation / mood concerns", "Significant psychosocial needs", "Complex needs / crisis support"] },
  { key: "night", label: "Night Care Requirements", scale: ["Sleeps through night", "Occasional night check", "Scheduled night checks", "Frequent night assistance", "Extensive night care", "Continuous night supervision"] },
];

// Level → clinical-editorial accent. L1 reads as low/resolved (green), L2 info (teal),
// L3 in-progress (amber), L4/L5 attention (coral).
type LevelAccent = "green" | "teal" | "amber" | "coral";
const ACCENT_VAR: Record<LevelAccent, string> = { green: "var(--clinical-green)", teal: "var(--clinical-panel)", amber: "var(--clinical-amber)", coral: "var(--clinical-coral)" };
interface Level { n: number; name: string; intensity: string; accent: LevelAccent; careLevel: string; package: string; services: string[] }
// LifeCare Care Level Model (L1–L5) — sourced from the workbook master via
// levelModel.ts (care_level_model.json + LEVEL_PACKAGE_DOMAINS). Names, need
// patterns and package domains are NOT hardcoded here; only the UI accent + the
// careLevel enum mapping are local presentation concerns.
const LEVEL_ACCENTS: Record<number, LevelAccent> = { 1: "green", 2: "teal", 3: "amber", 4: "coral", 5: "coral" };
const LEVEL_CARE_ENUM: Record<number, string> = { 1: "INDEPENDENT", 2: "ASSISTED", 3: "ASSISTED", 4: "MEMORY", 5: "SKILLED" };
const LEVELS: Level[] = LEVEL_MODEL.map((m) => ({
  n: m.n,
  name: m.name,
  intensity: m.intensity,
  accent: LEVEL_ACCENTS[m.n] ?? "coral",
  careLevel: LEVEL_CARE_ENUM[m.n] ?? "ASSISTED",
  package: m.packageSummary,
  services: m.includedDomainLabels,
}));
const accentFor = (n: number) => LEVELS.find((l) => l.n === n)?.accent ?? "coral";

// Theme-safe level chip: ink label + a coloured dot (matches WoundCare's status chip).
function LevelChip({ level, label }: { level: number; label?: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold text-[var(--clinical-ink)]" style={{ borderColor: "var(--clinical-line-strong)" }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ACCENT_VAR[accentFor(level)] }} />
      {label ? `Level ${level} — ${label}` : `L${level}`}
    </span>
  );
}


type AStatus = "PENDING_NURSE" | "PENDING_ADMIN" | "APPROVED" | "REJECTED";
interface Acuity { id: string; residentId: string; scores: Record<string, number>; total: number; level: number; levelName: string; trigger?: string; notes?: string; status: AStatus; createdBy?: string; createdAt: string; decidedBy?: string; decidedAt?: string; rejectionReason?: string; }
const parseAcuity = (raw: string | null | undefined): Acuity[] => { if (!raw) return []; try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((a) => a && typeof a.id === "string") : []; } catch { return []; } };
// Small local safe parser for the v4.2 assessment app-setting (JSON array of
// AssessmentV42). Header stats + Level-History source-lookup read from this;
// we avoid importing the full rule-data bundle just to parse a list.
const parseV42 = (raw: string | null | undefined): AssessmentV42[] => { if (!raw) return []; try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((a) => a && typeof a.id === "string") : []; } catch { return []; } };
const levelFromCare = (v: CareLevel | number | undefined): number | null => { if (typeof v === "number") return v; if (!v) return null; const m = /([1-5])/.exec(String(v)); return m ? Number(m[1]) : null; };
// A record is a v4.2 14-domain assessment (0–4, /56) if its scores are keyed by
// AS-codes; otherwise it's a legacy 10-domain acuity record (0–5, /50).
const isV42Acuity = (a: Acuity): boolean => "AS-01" in (a.scores || {});
const scaleMaxOf = (a: Acuity): number => (isV42Acuity(a) ? 56 : 50);
// Domain set + per-domain max used to RENDER a given record.
const domainsFor = (a: Acuity): { domains: Domain[]; max: number } =>
  isV42Acuity(a) ? { domains: V42_SCORED, max: 4 } : { domains: LEGACY_ACUITY_DOMAINS, max: 5 };

export default function CareAcuityBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const searchParams = useSearchParams();
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const { data: settingRows } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  // Deep-link (?resident=<id>) from other boards → open that resident's assessment.
  const deepLinkResident = useMemo(() => {
    const rid = searchParams?.get("resident") || "";
    if (!rid) return null;
    const r = residents.find((x: Row) => s(x.id) === rid);
    return { id: rid, name: r ? s(r.name) : "" };
  }, [searchParams, residents]);
  const careLevelById = useMemo(() => {
    const m = new Map<string, string>();
    (resQ.data || []).forEach((r) => m.set(s(r.id), s(r.careLevel)));
    return m;
  }, [resQ.data]);

  // Legacy 10/14-domain acuity records (READ-ONLY) — kept so pre-v4.2 approved
  // records still surface in Level History. No new records are written here.
  const items = useMemo(() => parseAcuity(settingRows.find((r) => (r.key || r.id) === ACUITY_KEY)?.value), [settingRows]);
  const approved = useMemo(() => items.filter((a) => a.status === "APPROVED").sort((a, b) => (b.decidedAt || "").localeCompare(a.decidedAt || "")), [items]);
  const acuityById = useMemo(() => { const m = new Map<string, Acuity>(); items.forEach((a) => m.set(a.id, a)); return m; }, [items]);

  // v4.2 assessments (the single instrument) — drives header stats + Level-History detail.
  const v42List = useMemo(() => parseV42(settingRows.find((r) => (r.key || r.id) === ASSESSMENTS_V42_KEY)?.value), [settingRows]);
  const v42ById = useMemo(() => { const m = new Map<string, AssessmentV42>(); v42List.forEach((a) => m.set(a.id, a)); return m; }, [v42List]);

  // Unified Level of Care history (pre-admission + reassessment + acuity approvals).
  const locHistory = useMemo(() => parseLocHistory(settingRows.find((r) => (r.key || r.id) === LOC_HISTORY_KEY)?.value), [settingRows]);

  const [tab, setTab] = useState<"queue" | "packages" | "activities" | "history">("queue");

  // v4.2 workflow states → header stats.
  const countByStatus = (st: AssessmentStatus) => v42List.filter((a) => a.status === st).length;
  const awaitingValidation = countByStatus("COMPLETED"); // completed, awaiting nurse validation
  const inProgress = countByStatus("DRAFT");             // still being assessed

  // Level distribution — latest VALIDATED v4.2 finalLevel per resident; fall back
  // to resident.careLevel for residents without a validated assessment.
  const dist = useMemo(() => {
    const d: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const byResident = new Map<string, number>();
    v42List
      .filter((a) => a.status === "VALIDATED")
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
      .forEach((a) => {
        const rid = s(a.layer1?.residentId);
        if (!rid || byResident.has(rid)) return;
        const n = levelFromCare(a.layer3?.finalLevel);
        if (n) byResident.set(rid, n);
      });
    residents.forEach((r) => {
      const rid = s(r.id);
      const n = byResident.get(rid) ?? careLevelEnumToLevel(careLevelById.get(rid));
      if (n) d[n] = (d[n] || 0) + 1;
    });
    return d;
  }, [v42List, residents, careLevelById]);

  // Map the board's role to a valid v4.2 clinician role.
  const roleForV42 = clinicianRole === "FACILITY_ADMIN" ? "CARE_MANAGER" : clinicianRole;

  return (
    <ClinicalPage>
      <ClinicalHeader
        title="Care Acuity & Level of Care"
        subtitle="Assessment scoring, level assignment, and care planning"
      />

      {/* Stats */}
      <div className="mt-5 mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard value={residents.length} label="Total Residents" accent="ink" />
        <StatCard value={awaitingValidation} label="Awaiting Validation" accent="amber" />
        <StatCard value={inProgress} label="In Progress" accent="coral" />
        <ClinicalCard top="green" className="p-4 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--clinical-muted)]">Level Distribution</p>
          <div className="mt-2 flex items-center justify-center gap-2 flex-wrap">{LEVELS.map((l) => <span key={l.n} className="text-xs font-bold tabular-nums" style={{ color: ACCENT_VAR[l.accent] }}>L{l.n}:{dist[l.n] || 0}</span>)}</div>
        </ClinicalCard>
      </div>

      {/* Tabs */}
      <div className="mb-5 inline-flex flex-wrap gap-1 rounded-xl p-1" style={{ backgroundColor: "var(--clinical-surface-2)" }}>
        {([["queue", "Assessments"], ["packages", "Service Packages"], ["activities", "Care Activities"], ["history", "Level History"]] as const).map(([v, label]) => (
          <button key={v} onClick={() => setTab(v)} className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${tab === v ? "bg-[var(--clinical-surface)] shadow-sm text-[var(--clinical-ink)]" : "text-[var(--clinical-muted)] hover:text-[var(--clinical-ink)]"}`}>{label}</button>
        ))}
      </div>

      {/* Assessments — the single v4.2 3-layer instrument, embedded. New → complete
          → nurse-validate → care plan; stores to assessments_v42. */}
      {tab === "queue" && <ResidentAssessmentV42 clinicianRole={roleForV42} embedded deepLinkResident={deepLinkResident} />}

      {tab === "packages" && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {LEVELS.map((l) => (
            <ClinicalCard key={l.n} top={l.accent} className="p-4">
              <div className="mb-1 flex items-center gap-2"><LevelChip level={l.n} /><span className="text-xs text-[var(--clinical-muted)]">{l.intensity} intensity</span></div>
              <p className="font-bold text-[var(--clinical-ink)]">{l.name}</p>
              <p className="mb-2 text-sm text-[var(--clinical-muted)]">{l.package}</p>
              <ul className="space-y-1">{l.services.map((sv) => <li key={sv} className="flex items-start gap-2 text-sm text-[var(--clinical-ink-soft)]"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: ACCENT_VAR[l.accent] }} />{sv}</li>)}</ul>
            </ClinicalCard>
          ))}
        </div>
      )}

      {tab === "activities" && <CareActivitiesView />}

      {tab === "history" && <LevelHistoryView residents={residents} approved={approved} locHistory={locHistory} v42ById={v42ById} acuityById={acuityById} />}
    </ClinicalPage>
  );
}

// ── Care Activities — the rule-sourced Baseline-by-LOC matrix ─────────────────
// Sourced from care_level_model.json (baselineByDomain) via levelModel.ts — the
// authoritative "Operational Care Task Package — Baseline by LOC". No hardcoded
// activity/frequency catalog.
function CareActivitiesView() {
  const [lvl, setLvl] = useState<number | "">("");
  const cols = lvl === "" ? [1, 2, 3, 4] : [Number(lvl)];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select value={lvl} onChange={(e) => setLvl(e.target.value === "" ? "" : Number(e.target.value))} aria-label="Filter by level" className={`${controlClass} max-w-xs`}>
          <option value="">All Levels (L1–L4)</option>
          {LEVELS.filter((l) => l.n <= 4).map((l) => <option key={l.n} value={l.n}>Level {l.n} — {l.name}</option>)}
        </select>
        <span className="text-xs text-[var(--clinical-muted)]">Baseline care by domain per Level of Care. L5 delivers L4 baselines within a comfort-focused pathway.</span>
      </div>
      <div className="overflow-x-auto rounded-xl border" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="border-b text-left text-[var(--clinical-muted)]" style={{ borderColor: "var(--clinical-line)" }}>
            <th className="px-4 py-2.5 font-semibold">Domain</th>
            {cols.map((c) => <th key={c} className="px-4 py-2.5 font-semibold">L{c}</th>)}
            <th className="px-4 py-2.5 font-semibold">Modifier rule</th>
          </tr></thead>
          <tbody>
            {DOMAIN_BASELINE.map((d) => (
              <tr key={d.domain} className="border-b last:border-0 align-top" style={{ borderColor: "var(--clinical-line)" }}>
                <td className="px-4 py-2.5 font-medium text-[var(--clinical-ink)]">{d.domain}</td>
                {cols.map((c) => <td key={c} className="px-4 py-2.5 text-[var(--clinical-ink-soft)]">{d.byLevel[c] || "—"}</td>)}
                <td className="px-4 py-2.5 text-[var(--clinical-muted)]">{d.modifierRule || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Level History — per-resident level-change timeline ───────────────────────
// Unified level-of-care timeline entry (merged from loc_history + legacy acuity).
type LocKind = "v42" | "acuity";
type LocTimelineItem = { key: string; at: string; level: number; source: string; sourceKey: LocSource | "ACUITY_APPROVAL"; kind: LocKind; assessmentId?: string; by?: string; role?: string; rawScore?: number; scoreMax: number; previousLevel?: number; notes?: string };
const levelNum = (v: unknown) => { const m = /([1-5])/.exec(String(v ?? "")); return m ? Number(m[1]) : 0; };

function LevelHistoryView({ residents, approved, locHistory, v42ById, acuityById }: { residents: Row[]; approved: Acuity[]; locHistory: LocHistoryEntry[]; v42ById: Map<string, AssessmentV42>; acuityById: Map<string, Acuity> }) {
  const [sel, setSel] = useState("");
  const [detail, setDetail] = useState<LocTimelineItem | null>(null);
  const resId = sel || (residents[0] ? s(residents[0].id) : "");

  // Merge the durable loc_history with any legacy approved-acuity records not yet
  // represented there (matched by assessmentId), into one chronological timeline.
  const timeline = useMemo<LocTimelineItem[]>(() => {
    const mine = historyForResident(locHistory, resId);
    const seenAssessment = new Set(mine.map((e) => e.assessmentId).filter(Boolean) as string[]);
    const fromHistory: LocTimelineItem[] = mine.map((e, i) => {
      // For acuity approvals, derive the scale from the linked record (56 for
      // v4.2, 50 for legacy); old history entries were /50 → fallback 50.
      const linked = e.source === "ACUITY_APPROVAL" && e.assessmentId ? acuityById.get(e.assessmentId) : undefined;
      const scoreMax = e.source === "ACUITY_APPROVAL" ? (linked ? scaleMaxOf(linked) : 50) : 56;
      return {
        key: e.id || `h-${i}`, at: e.at, level: levelNum(e.level), source: LOC_SOURCE_LABEL[e.source] || e.source, sourceKey: e.source,
        kind: e.source === "ACUITY_APPROVAL" ? "acuity" : "v42", assessmentId: e.assessmentId,
        by: e.by, role: e.role, rawScore: e.rawScore, scoreMax,
        previousLevel: e.previousLevel ? levelNum(e.previousLevel) : undefined, notes: e.notes,
      };
    });
    const fromAcuity: LocTimelineItem[] = approved
      .filter((a) => a.residentId === resId && !seenAssessment.has(a.id))
      .map((a) => ({ key: `a-${a.id}`, at: s(a.decidedAt || a.createdAt), level: a.level, source: "Acuity Approval", sourceKey: "ACUITY_APPROVAL", kind: "acuity", assessmentId: a.id, by: a.decidedBy || a.createdBy, rawScore: a.total, scoreMax: scaleMaxOf(a), notes: a.trigger ? `Trigger: ${a.trigger}` : undefined }));
    return [...fromHistory, ...fromAcuity].sort((x, y) => (y.at || "").localeCompare(x.at || ""));
  }, [locHistory, approved, resId, acuityById]);

  return (
    <ClinicalCard className="p-5">
      <h2 className="text-lg font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>Care Level History</h2>
      <p className="mb-3 text-sm text-[var(--clinical-muted)]">Full record of every level of care a resident has been through — pre-admission, reassessments and acuity approvals. Select an entry to view all recorded details.</p>
      <select value={resId} onChange={(e) => setSel(e.target.value)} aria-label="Select resident" className={`${controlClass} max-w-sm`}>
        {residents.length === 0 && <option value="">No residents</option>}
        {residents.map((r) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — {s(r.room)}</option>)}
      </select>
      <div className="mt-4">
        {timeline.length === 0 ? <p className="text-[var(--clinical-muted)]">No level changes recorded.</p>
          : <div className="space-y-2">
              {timeline.map((t) => { const prev = t.previousLevel; return (
                <button type="button" key={t.key} onClick={() => setDetail(t)} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-black/[0.03] hover:border-[var(--clinical-line-strong)]" style={{ borderColor: "var(--clinical-line)" }}>
                  <div className="flex items-center gap-2">
                    <LevelChip level={t.level} label={LEVELS.find((l) => l.n === t.level)?.name} />
                    {prev != null && prev !== t.level && <span className="text-xs font-semibold" style={{ color: ACCENT_VAR[accentFor(t.level)] }}>{prev < t.level ? "▲" : "▼"} from L{prev}</span>}
                    <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide border" style={{ borderColor: "var(--clinical-line-strong)", color: "var(--clinical-muted)" }}>{t.source}</span>
                  </div>
                  <span className="text-xs text-[var(--clinical-muted)]">{t.rawScore != null ? `${t.rawScore}/${t.scoreMax} · ` : ""}{fmtDate(t.at)} · {t.by || "—"} ›</span>
                </button>
              ); })}
            </div>}
      </div>
      {detail && <LevelHistoryDetail item={detail} v42={detail.assessmentId ? v42ById.get(detail.assessmentId) : undefined} acuity={detail.assessmentId ? acuityById.get(detail.assessmentId) : undefined} onClose={() => setDetail(null)} />}
    </ClinicalCard>
  );
}

// Full detail of a single LOC-history entry — shows every recorded field plus the
// underlying assessment (14-domain v4.2 or 10-domain acuity) behind the level.
// Severity colour for a 0–max domain score (green → teal → amber → coral).
function scoreColor(score: number, max: number): string {
  const r = max > 0 ? score / max : 0;
  if (r <= 0.15) return "var(--clinical-green)";
  if (r <= 0.35) return "var(--clinical-panel)";
  if (r <= 0.55) return "var(--clinical-amber)";
  return "var(--clinical-coral)";
}

function StatTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)" }}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--clinical-muted)]">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-[var(--clinical-ink)]">{value}</p>
    </div>
  );
}

// One domain row: colour-coded score badge + domain name + anchor label.
function DomainScoreRow({ label, score, max, anchor }: { label: string; score: number; max: number; anchor: string }) {
  const color = scoreColor(score, max);
  return (
    <div className="flex items-center gap-3 rounded-lg border p-2.5" style={{ borderColor: "var(--clinical-line)" }}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-sm font-bold text-white" style={{ backgroundColor: color }}>{score}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold leading-tight text-[var(--clinical-ink)]">{label}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-[var(--clinical-muted)]">{anchor}</p>
      </div>
    </div>
  );
}

function LevelHistoryDetail({ item, v42, acuity, onClose }: { item: LocTimelineItem; v42?: AssessmentV42; acuity?: Acuity; onClose: () => void }) {
  const lvl = LEVELS.find((l) => l.n === item.level);
  const v42Total = v42?.domains ? Object.values(v42.domains).reduce((n, d) => n + (typeof d?.score === "number" ? d.score : 0), 0) : 0;
  return (
    <ClinicalModal open onClose={onClose} title={`Level of Care — ${item.source}`} description={lvl ? `Level ${item.level} — ${lvl.name}` : `Level ${item.level}`} size="lg">
      <div className="space-y-5">
        {/* Summary header — level + source, then stat tiles */}
        <div className="rounded-xl border p-4" style={{ borderColor: "var(--clinical-line)" }}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <LevelChip level={item.level} label={lvl?.name} />
            {item.previousLevel != null && item.previousLevel !== item.level && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: ACCENT_VAR[accentFor(item.level)] }}>
                {item.previousLevel < item.level ? "▲" : "▼"} from Level {item.previousLevel}
              </span>
            )}
            <span className="ml-auto inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide border" style={{ borderColor: "var(--clinical-line-strong)", color: "var(--clinical-muted)" }}>{item.source}</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {item.rawScore != null && <StatTile label="Raw score" value={`${item.rawScore} / ${item.scoreMax}`} />}
            <StatTile label="Recorded" value={fmtDate(item.at)} />
            <StatTile label="By" value={item.by || "—"} />
            {item.role && <StatTile label="Role" value={item.role} />}
          </div>
          {item.notes && (
            <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--clinical-line)" }}>
              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--clinical-muted)]">Notes</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-[var(--clinical-ink)]">{item.notes}</p>
            </div>
          )}
        </div>

        {v42 && (
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--clinical-ink)]">v4.2 Assessment — 14 domains</p>
              <span className="rounded-md px-2 py-0.5 text-xs font-bold text-white" style={{ backgroundColor: "var(--clinical-panel)" }}>{v42Total} / 56</span>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {V42_SCORED.map((d) => { const sc = v42.domains?.[d.key as keyof typeof v42.domains]?.score ?? 0; return (
                <DomainScoreRow key={d.key} label={d.label} score={sc} max={4} anchor={d.scale[sc] ?? ""} />
              ); })}
            </div>
            {v42.layer3?.finalLevelJustification && <p className="mt-3 rounded-lg border p-3 text-sm" style={{ borderColor: "var(--clinical-line)" }}><span className="font-semibold text-[var(--clinical-ink)]">Justification:</span> <span className="text-[var(--clinical-muted)]">{v42.layer3.finalLevelJustification}</span></p>}
            {v42.layer1?.reasonForAdmission && <p className="mt-2 text-sm"><span className="font-semibold text-[var(--clinical-ink)]">Reason for admission:</span> <span className="text-[var(--clinical-muted)]">{v42.layer1.reasonForAdmission}</span></p>}
          </div>
        )}

        {!v42 && acuity && (() => { const { domains, max } = domainsFor(acuity); const scaleMax = scaleMaxOf(acuity); const dc = domains.length; return (
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--clinical-ink)]">Acuity Assessment — {dc} domains{acuity.trigger ? ` · ${acuity.trigger}` : ""}</p>
              <span className="rounded-md px-2 py-0.5 text-xs font-bold text-white" style={{ backgroundColor: "var(--clinical-panel)" }}>{acuity.total} / {scaleMax}</span>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {domains.map((d) => { const sc = Number(acuity.scores?.[d.key] ?? 0); return (
                <DomainScoreRow key={d.key} label={d.label} score={sc} max={max} anchor={d.scale[sc] ?? ""} />
              ); })}
            </div>
            {acuity.notes && <p className="mt-3 rounded-lg border p-3 text-sm" style={{ borderColor: "var(--clinical-line)" }}><span className="font-semibold text-[var(--clinical-ink)]">Notes:</span> <span className="text-[var(--clinical-muted)]">{acuity.notes}</span></p>}
          </div>
        ); })()}

        {!v42 && !acuity && <p className="rounded-lg border p-3 text-sm text-[var(--clinical-muted)]" style={{ borderColor: "var(--clinical-line)" }}>The detailed assessment behind this entry is no longer available, but the recorded summary above is preserved.</p>}
      </div>
    </ClinicalModal>
  );
}
