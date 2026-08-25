// Daily per-shift monitoring of the 14 scored assessment domains (AS-01..AS-14),
// the discrepancy trigger engine, and the manage → persist → LOC-review case
// lifecycle. Pure + migration-free: state lives in the app-settings
//   domain_logs          — one row per resident × date × shift (the trend source)
//   domain_observations  — one open monitoring case per resident × domain
// This module holds NO React and NO JSON import so it stays unit-testable under
// `node --test`; domain names/anchors are looked up from assessment_domains.json
// in the UI (same pattern as PrivateCaregiverBoard).

import { DOMAIN_CODES } from "./types.ts";
import type { DomainCode } from "./types.ts";

export const DOMAIN_LOGS_KEY = "domain_logs";
export const DOMAIN_CASES_KEY = "domain_observations";

// Thresholds — provisional, tune to the LifeCare SOP.
export const WORSE_DELTA = 1;       // shift score >= baseline + 1  → BASELINE
export const ABS_SEVERE = 3;        // shift score >= 3             → ABSOLUTE
export const INCIDENT_SCORE = 4;    // shift score = 4              → raise Incident
export const SWING = 2;             // intra-day max-min >= 2       → SWING
export const TREND_WINDOW_DAYS = 3; // rise sustained over this many distinct days → TREND
export const PERSIST_DAYS = 3;      // discrepancies on >= this many distinct days → LOC review
export const PERSIST_AGE_DAYS = 5;  // OR case open >= this many days & still tripping → LOC review

export type Shift = "AM" | "PM" | "NOC";
export type DomainScore = 0 | 1 | 2 | 3 | 4;
export const SHIFTS: { v: Shift; label: string }[] = [
  { v: "AM", label: "AM Shift (6am–2pm)" },
  { v: "PM", label: "PM Shift (2pm–10pm)" },
  { v: "NOC", label: "Noc Shift (10pm–6am)" },
];
const SHIFT_RANK: Record<string, number> = { AM: 0, PM: 1, NOC: 2 };

export interface DomainLog {
  id: string;
  residentId: string;
  date: string;            // YYYY-MM-DD
  shift: Shift;
  scores: Partial<Record<DomainCode, DomainScore>>;
  by: string;
  at: string;              // ISO
  notified?: boolean;             // notification already fired for this shift row
  incidentDomains?: DomainCode[]; // domains that already raised an incident from this row
}

export type TriggerReason = "BASELINE" | "TREND" | "ABSOLUTE" | "SWING";

export interface DomainTrigger {
  residentId: string;
  domain: DomainCode;
  reasons: TriggerReason[];
  latestScore: number;
  latestDate: string;
  latestShift: string;
  baseline: number | null;
  severe: boolean;         // latest day carries a score >= INCIDENT_SCORE
}

export type CaseStatus = "OPEN" | "MANAGING" | "LOC_REVIEW_DUE" | "RESOLVED";
export interface CaseOccurrence { date: string; shift: string; score: number; reasons: TriggerReason[] }
export interface CaseNote { at: string; by: string; note: string }
export interface DomainCase {
  id: string;
  residentId: string;
  domain: DomainCode;
  status: CaseStatus;
  openedAt: string;              // ISO
  occurrences: CaseOccurrence[];
  managementNotes: CaseNote[];
  escalatedAt?: string;
  locReviewDueAt?: string;
  locReviewOpenedAt?: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

export const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `dm-${Math.random().toString(36).slice(2)}`;

// ── parse / persist ──────────────────────────────────────────────────────────
export const parseDomainLogs = (raw: string | null | undefined): DomainLog[] => {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((l) => l && typeof l.id === "string") : []; } catch { return []; }
};
export const parseDomainCases = (raw: string | null | undefined): DomainCase[] => {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((c) => c && typeof c.id === "string") : []; } catch { return []; }
};

const key = (l: Pick<DomainLog, "residentId" | "date" | "shift">) => `${l.residentId}|${l.date}|${l.shift}`;
const rank = (l: Pick<DomainLog, "date" | "shift">) => `${l.date}#${SHIFT_RANK[l.shift] ?? 0}`;

/** Upsert a shift row (replace the same resident/date/shift, else prepend). */
export function upsertDomainLog(logs: DomainLog[], entry: DomainLog): DomainLog[] {
  const k = key(entry);
  const idx = logs.findIndex((l) => key(l) === k);
  if (idx === -1) return [entry, ...logs];
  const next = logs.slice();
  next[idx] = entry;
  return next;
}

/** The most recent recorded scores for a resident (for carry-forward pre-fill). */
export function carryForwardScores(residentId: string, logs: DomainLog[]): Partial<Record<DomainCode, DomainScore>> {
  const mine = logs.filter((l) => l.residentId === residentId).sort((a, b) => rank(b).localeCompare(rank(a)));
  return mine[0]?.scores ?? {};
}

// ── baseline (from the resident's latest finished assessment) ─────────────────
interface AssessmentLike {
  status?: string;
  updatedAt?: string;
  createdAt?: string;
  layer1?: { residentId?: string };
  domains?: Partial<Record<DomainCode, { score?: number }>>;
}
export function baselineFor(residentId: string, assessments: AssessmentLike[]): Partial<Record<DomainCode, number>> {
  const finished = (assessments || [])
    .filter((a) => a.layer1?.residentId === residentId && (a.status === "VALIDATED" || a.status === "COMPLETED"))
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
  const latest = finished[0];
  if (!latest?.domains) return {};
  const out: Partial<Record<DomainCode, number>> = {};
  for (const code of DOMAIN_CODES) {
    const sc = latest.domains[code]?.score;
    if (typeof sc === "number") out[code] = sc;
  }
  return out;
}

// ── trigger evaluation ────────────────────────────────────────────────────────
/** Distinct days (asc) → max score that day, for one domain. */
function dayMaxSeries(points: { date: string; score: number }[]): { date: string; score: number }[] {
  const m = new Map<string, number>();
  for (const p of points) m.set(p.date, Math.max(m.get(p.date) ?? -Infinity, p.score));
  return [...m.entries()].map(([date, score]) => ({ date, score })).sort((a, b) => a.date.localeCompare(b.date));
}

export function evaluateDomainTriggers(
  residentId: string,
  logs: DomainLog[],
  baseline: Partial<Record<DomainCode, number>>,
): DomainTrigger[] {
  const mine = logs.filter((l) => l.residentId === residentId);
  const out: DomainTrigger[] = [];

  for (const code of DOMAIN_CODES) {
    // All scored points for this domain, ascending by date+shift.
    const pts = mine
      .map((l) => ({ date: l.date, shift: l.shift, score: l.scores[code] }))
      .filter((p): p is { date: string; shift: Shift; score: DomainScore } => typeof p.score === "number")
      .sort((a, b) => rank(a).localeCompare(rank(b)));
    if (pts.length === 0) continue;

    const latest = pts[pts.length - 1];
    const latestDate = latest.date;
    const bl = baseline[code];
    const reasons: TriggerReason[] = [];

    // R1 — worse than assessment baseline (current shift).
    if (typeof bl === "number" && latest.score >= bl + WORSE_DELTA) reasons.push("BASELINE");
    // R3 — high absolute severity (current shift).
    if (latest.score >= ABS_SEVERE) reasons.push("ABSOLUTE");
    // R4 — intra-day swing on the latest date.
    const sameDay = pts.filter((p) => p.date === latestDate).map((p) => p.score);
    if (sameDay.length >= 2 && Math.max(...sameDay) - Math.min(...sameDay) >= SWING) reasons.push("SWING");
    // R2 — sustained worsening trend over the last N distinct days.
    const days = dayMaxSeries(pts).slice(-TREND_WINDOW_DAYS);
    if (days.length >= 2 && days[days.length - 1].score - days[0].score >= 1 &&
        days.every((d, i) => i === 0 || d.score >= days[i - 1].score)) reasons.push("TREND");

    if (reasons.length === 0) continue;
    const severe = Math.max(...sameDay) >= INCIDENT_SCORE;
    out.push({ residentId, domain: code, reasons, latestScore: latest.score, latestDate, latestShift: latest.shift, baseline: bl ?? null, severe });
  }
  return out;
}

// ── Sourcing from the daily care logs (care_log_notes) ────────────────────────
// The caregivers score the 14 domains in "Document care"; those 0–4 status logs
// are the single source. Domain Monitoring never re-scores — it adapts these logs
// and runs the trigger engine over them.
export const CARE_LOG_NOTES_KEY = "care_log_notes";
export interface CareLogNote { residentId: string; domain: string; status?: number; shift?: string; at: string }

/** Adapt Document-care 0–4 status logs into DomainLogs grouped per resident × date
 *  × shift. Only scored AS-domains with a numeric status are included; a domain
 *  logged twice in one shift keeps the worst score. */
export function careLogNotesToDomainLogs(notes: CareLogNote[]): DomainLog[] {
  const byKey = new Map<string, DomainLog>();
  for (const n of notes || []) {
    if (typeof n.status !== "number") continue;
    const code = n.domain as DomainCode;
    if (!DOMAIN_CODES.includes(code)) continue;
    const date = String(n.at || "").slice(0, 10);
    if (!date) continue;
    const shift = (n.shift === "AM" || n.shift === "PM" || n.shift === "NOC" ? n.shift : "AM") as Shift;
    const k = `${n.residentId}|${date}|${shift}`;
    let log = byKey.get(k);
    if (!log) { log = { id: k, residentId: n.residentId, date, shift, scores: {}, by: "", at: n.at }; byKey.set(k, log); }
    const score = Math.max(0, Math.min(4, Math.round(n.status))) as DomainScore;
    const prev = log.scores[code];
    log.scores[code] = prev == null ? score : (Math.max(prev, score) as DomainScore);
  }
  return [...byKey.values()];
}

/** Distinct days where a domain read as a discrepancy (worse than baseline, or
 *  absolute-severe) — the persistence signal used to decide a reassessment. */
export function discrepancyDayCount(residentId: string, logs: DomainLog[], domain: DomainCode, baseline: Partial<Record<DomainCode, number>>): number {
  const bl = baseline[domain];
  const dayMax = new Map<string, number>();
  for (const l of logs) {
    if (l.residentId !== residentId) continue;
    const sc = l.scores[domain];
    if (typeof sc !== "number") continue;
    dayMax.set(l.date, Math.max(dayMax.get(l.date) ?? -1, sc));
  }
  let days = 0;
  for (const sc of dayMax.values()) {
    // Reassessment is about DRIFT: worse than the assessed baseline. With no
    // baseline on file, fall back to absolute-severe (≥3) as the proxy.
    const drift = typeof bl === "number" ? sc >= bl + WORSE_DELTA : sc >= ABS_SEVERE;
    if (drift) days++;
  }
  return days;
}

// ── case lifecycle ────────────────────────────────────────────────────────────
const dateOnly = (s: string) => s.slice(0, 10);
const daysBetween = (fromISO: string, toDate: string) => {
  const a = Date.parse(dateOnly(fromISO)), b = Date.parse(dateOnly(toDate));
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : 0;
};

/** Recompute status from occurrences + age (never downgrades from LOC_REVIEW_DUE). */
function recomputeStatus(c: DomainCase, todayDate: string): DomainCase {
  if (c.status === "RESOLVED" || c.status === "LOC_REVIEW_DUE") return c;
  const distinctDays = new Set(c.occurrences.map((o) => o.date)).size;
  const ageDays = daysBetween(c.openedAt, todayDate);
  const persistent = distinctDays >= PERSIST_DAYS || ageDays >= PERSIST_AGE_DAYS;
  if (persistent) return { ...c, status: "LOC_REVIEW_DUE", locReviewDueAt: c.locReviewDueAt ?? `${todayDate}T00:00:00.000Z` };
  if (c.managementNotes.length > 0) return { ...c, status: "MANAGING" };
  return { ...c, status: "OPEN" };
}

/**
 * Fold a fresh trigger into a resident×domain case. Pass `undefined` when no
 * OPEN case exists (or the previous one is RESOLVED) → a new case is opened.
 */
export function advanceCase(existing: DomainCase | undefined, trigger: DomainTrigger, todayDate: string): DomainCase {
  const occ: CaseOccurrence = { date: trigger.latestDate, shift: trigger.latestShift, score: trigger.latestScore, reasons: trigger.reasons };
  if (!existing || existing.status === "RESOLVED") {
    return recomputeStatus({
      id: newId(), residentId: trigger.residentId, domain: trigger.domain,
      status: "OPEN", openedAt: `${todayDate}T00:00:00.000Z`,
      occurrences: [occ], managementNotes: [],
    }, todayDate);
  }
  const occurrences = existing.occurrences.some((o) => o.date === occ.date && o.shift === occ.shift)
    ? existing.occurrences.map((o) => (o.date === occ.date && o.shift === occ.shift ? occ : o))
    : [...existing.occurrences, occ];
  return recomputeStatus({ ...existing, occurrences }, todayDate);
}

export function addManagementNote(c: DomainCase, note: string, by: string, atISO: string): DomainCase {
  const next: DomainCase = { ...c, managementNotes: [...c.managementNotes, { at: atISO, by, note }] };
  // A note means the nurse is actively managing — reflect it unless already escalated/resolved.
  if (next.status === "OPEN") next.status = "MANAGING";
  return next;
}

export function markEscalated(c: DomainCase, atISO: string): DomainCase {
  return { ...c, escalatedAt: atISO, status: c.status === "OPEN" ? "MANAGING" : c.status };
}

export function markLocReviewOpened(c: DomainCase, atISO: string): DomainCase {
  return { ...c, locReviewOpenedAt: atISO };
}

export function resolveCase(c: DomainCase, by: string, atISO: string): DomainCase {
  return { ...c, status: "RESOLVED", resolvedBy: by, resolvedAt: atISO };
}

/** The open (non-resolved) case for a resident×domain, if any. */
export function findOpenCase(cases: DomainCase[], residentId: string, domain: DomainCode): DomainCase | undefined {
  return cases.find((c) => c.residentId === residentId && c.domain === domain && c.status !== "RESOLVED");
}

export const REASON_LABEL: Record<TriggerReason, string> = {
  BASELINE: "Worse than assessment baseline",
  TREND: "Worsening trend",
  ABSOLUTE: "High severity (≥3)",
  SWING: "Inconsistent across shifts",
};

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  OPEN: "Discrepancy",
  MANAGING: "Managing",
  LOC_REVIEW_DUE: "LOC review due",
  RESOLVED: "Resolved",
};
