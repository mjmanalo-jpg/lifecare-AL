"use client";

/**
 * Care documentation over the DailyRounds models (Stage 10–11), migration-free.
 * Two views share one data hook:
 *   • CareLogsBoard (default)  — the Residents tab: level filters, level badge,
 *     per-shift domain progress, 14 domain quick-log shortcuts, QR + View modal.
 *   • CareLogsTimeline (named) — the Care Logs tab: resident cards showing today's
 *     logged entries with "+ Log" and expand.
 * Both open the shared quick-log modal keyed to the 14 LifeCare v4.2 assessment
 * domains (AS-01 … AS-14) plus a standalone Pain symptom log:
 *   • Model-backed domains reuse the existing rich Daily Rounds forms
 *     (Clinical Monitoring→vital-signs, Nutrition→meal-records, Continence→
 *     bowel+urine, Skin→edema, Behavior→mood, Sleep→round-sleep-records,
 *     Safety→concern-records, Mobility→mobility-records, Pain→pain-records).
 *   • The remaining domains (ADLs, Fall Risk, Cognition, Medication,
 *     Communication, Reablement, plus a Skin note) are captured as generic
 *     0–4 status + note quick-logs stored migration-free in the app-setting
 *     `care_log_notes` (a JSON array), folded back into the timeline / counts.
 */

import { useMemo, useState, useRef } from "react";
import {
  Activity, Utensils, Droplets, Smile, Zap, Footprints, Moon, Wind,
  CalendarDays, Sun, Clock,
  ChevronUp, ChevronDown, Plus, QrCode, Eye, Download, Sparkles,
  UserRound, Pill, Check, Camera, Image as ImageIcon, Trash2, Pencil, UserX,
  ExternalLink, Bath, TrendingDown, Brain, MessageCircle, Dumbbell, ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, upsertRecord, updateRecord } from "@/lib/api";
import { qrDataUrl } from "@/lib/qr";
import { useClinician, type ClinicianRole } from "./useClinician";
import { ClinicalPage, ClinicalHeader, ClinicalButton, ClinicalModal, SearchInput, DataState, controlClass } from "./clinical-ui";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// The 14 LifeCare v4.2 assessment domains (AS-01 … AS-14) that the board charts,
// plus a standalone "pain" symptom log (Pain doesn't map to one v4.2 domain, so
// it stays available as its own quick-log). DomainKey is the tab / chip identity.
type DomainKey =
  | "AS-01" | "AS-02" | "AS-03" | "AS-04" | "AS-05" | "AS-06" | "AS-07"
  | "AS-08" | "AS-09" | "AS-10" | "AS-11" | "AS-12" | "AS-13" | "AS-14" | "pain";

// Which underlying quick-log form a domain renders. Model-backed forms reuse the
// existing rich Daily Rounds inputs (unchanged); "generic" is the 0–4 status +
// note store; "continence" shows bowel+urine; "skin" shows edema + a skin note.
type FormKind =
  | "vitals" | "meals" | "continence" | "skin" | "mood" | "sleep" | "concerns"
  | "mobility" | "pain" | "generic";

// Local calendar day (YYYY-MM-DD). Rounds are created at LOCAL midnight, so the
// "today" filter must compare on the local day too — comparing UTC dates dropped
// same-day rounds in ahead-of-UTC timezones (e.g. UTC+8), showing "0 logs today".
const localDayKey = (v: unknown) => { const d = v instanceof Date ? v : new Date(String(v ?? "")); return isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const todayKey = () => localDayKey(new Date());
const todayDate = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const shiftNow = (): "DAY" | "EVENING" | "NIGHT" => { const h = new Date().getHours(); return h >= 7 && h < 15 ? "DAY" : h >= 15 && h < 23 ? "EVENING" : "NIGHT"; };
const s = (v: unknown) => (v == null ? "" : String(v));
const fmtBool = (v: unknown) => (v ? "true" : "false");
const rel = (iso: string) => {
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!isFinite(sec)) return "";
  if (sec < 60) return "just now";
  const m = sec / 60; if (m < 60) return `about ${Math.round(m)} min ago`;
  const h = m / 60; if (h < 24) return `about ${Math.round(h)} hour${Math.round(h) === 1 ? "" : "s"} ago`;
  return `${Math.round(h / 24)} day${Math.round(h / 24) === 1 ? "" : "s"} ago`;
};

// careLevel enum → LifeCare "Level N · label" badge (adjust mapping if needed).
// Maps the 4-value careLevel enum onto its representative Level of Care (1–5) —
// aligned with the Pre-Admission / Care-Acuity scale (L1 Independent, L2 Assisted,
// L4 Memory, L5 Skilled). Level 3 (Enhanced Assisted) shares the ASSISTED enum, so
// it also reads as Assisted here.
const LEVELS: Record<string, { n: number; label: string; badge: string }> = {
  INDEPENDENT: { n: 1, label: "Independent", badge: "bg-green-100 text-green-700" },
  ASSISTED: { n: 2, label: "Assisted", badge: "bg-amber-100 text-amber-700" },
  MEMORY: { n: 4, label: "Memory Care", badge: "bg-orange-100 text-orange-700" },
  SKILLED: { n: 5, label: "Skilled Care", badge: "bg-red-100 text-red-700" },
};
export const levelOf = (r: Row) => LEVELS[s(r.careLevel)] || { n: 2, label: "Assisted", badge: "bg-blue-100 text-blue-700" };

// Theme-safe care-level chip: ink label + a coloured dot keyed to the level
// (green independent → amber moderate → coral memory/skilled), replacing the
// hardcoded light bg-*-100 badges that stranded contrast in dark mode.
const LEVEL_DOT: Record<number, string> = { 1: "var(--clinical-green)", 2: "var(--clinical-panel)", 3: "var(--clinical-amber)", 4: "var(--clinical-coral)", 5: "var(--clinical-coral)" };
function LevelBadge({ lvl }: { lvl: { n: number; label: string } }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold text-[var(--clinical-ink)]" style={{ borderColor: "var(--clinical-line-strong)" }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: LEVEL_DOT[lvl.n] ?? "var(--clinical-panel)" }} />Level {lvl.n} · {lvl.label}
    </span>
  );
}
const genderLabel = (g: unknown) => { const v = s(g).toLowerCase(); return v.startsWith("m") ? "Male" : v.startsWith("f") ? "Female" : "Gender not specified"; };

// Theme-safe domain label chip for the Care Logs timeline (replaces the
// hardcoded bg-*-100 pills that lost contrast in dark mode).
function DomainChip({ label }: { label: string }) {
  return <span className="shrink-0 mt-0.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-[var(--clinical-ink-soft)]" style={{ borderColor: "var(--clinical-line-strong)", backgroundColor: "var(--clinical-surface-2)" }}>{label}</span>;
}
const BOWEL_REF_KEY = "bowel_reference_photo"; // migration-free: one community reference image (data URL), set by nurse/care manager

// Downscale an image file to a JPEG data URL so the app-settings JSON stays small.
async function toDataUrl(file: File, maxDim = 900, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d"); if (!ctx) { reject(new Error("no canvas")); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

// The record shape a summary/collect step reads. Distinct from DomainKey because
// AS-10 Continence folds TWO record shapes (bowel + urine) into one domain, and a
// generic quick-log has its own shape. Model-backed forms keep their old shapes.
type SumKind = "vitals" | "meals" | "bowel" | "urine" | "edema" | "concerns" | "mood" | "pain" | "mobility" | "sleep" | "generic";

// The 14 v4.2 domains + Pain. `form` selects which quick-log UI renders;
// `resource` is the Prisma model for single-model-backed domains (used when the
// duplicate-per-day check needs the domain's primary resource / label).
const DOMAINS: { key: DomainKey; code: string; label: string; icon: LucideIcon; tint: string; bg: string; pill: string; form: FormKind; resource?: string }[] = [
  { key: "AS-01", code: "AS-01", label: "ADLs / Personal Care", icon: Bath, tint: "text-cyan-600", bg: "bg-cyan-50", pill: "bg-cyan-100 text-cyan-700", form: "generic" },
  { key: "AS-02", code: "AS-02", label: "Mobility / Transfers", icon: Footprints, tint: "text-teal-600", bg: "bg-teal-50", pill: "bg-teal-100 text-teal-700", form: "mobility", resource: "mobility-records" },
  { key: "AS-03", code: "AS-03", label: "Fall Risk", icon: TrendingDown, tint: "text-red-600", bg: "bg-red-50", pill: "bg-red-100 text-red-700", form: "generic" },
  { key: "AS-04", code: "AS-04", label: "Cognition", icon: Brain, tint: "text-violet-600", bg: "bg-violet-50", pill: "bg-violet-100 text-violet-700", form: "generic" },
  { key: "AS-05", code: "AS-05", label: "Behavior / BPSD", icon: Smile, tint: "text-purple-500", bg: "bg-purple-50", pill: "bg-purple-100 text-purple-700", form: "mood", resource: "mood-records" },
  { key: "AS-06", code: "AS-06", label: "Clinical Monitoring", icon: Activity, tint: "text-rose-500", bg: "bg-rose-50", pill: "bg-rose-100 text-rose-600", form: "vitals", resource: "vital-signs" },
  { key: "AS-07", code: "AS-07", label: "Medication", icon: Pill, tint: "text-emerald-600", bg: "bg-emerald-50", pill: "bg-emerald-100 text-emerald-700", form: "generic" },
  { key: "AS-08", code: "AS-08", label: "Nutrition / Hydration", icon: Utensils, tint: "text-green-600", bg: "bg-green-50", pill: "bg-green-100 text-green-700", form: "meals", resource: "meal-records" },
  { key: "AS-09", code: "AS-09", label: "Communication", icon: MessageCircle, tint: "text-blue-600", bg: "bg-blue-50", pill: "bg-blue-100 text-blue-700", form: "generic" },
  { key: "AS-10", code: "AS-10", label: "Continence / Toileting", icon: Droplets, tint: "text-amber-600", bg: "bg-amber-50", pill: "bg-amber-100 text-amber-700", form: "continence", resource: "bowel-records" },
  { key: "AS-11", code: "AS-11", label: "Skin Integrity", icon: Wind, tint: "text-sky-600", bg: "bg-sky-50", pill: "bg-sky-100 text-sky-700", form: "skin", resource: "edema-records" },
  { key: "AS-12", code: "AS-12", label: "Sleep / Daily Routine", icon: Moon, tint: "text-indigo-500", bg: "bg-indigo-50", pill: "bg-indigo-100 text-indigo-700", form: "sleep", resource: "round-sleep-records" },
  { key: "AS-13", code: "AS-13", label: "Safety / Supervision", icon: ShieldAlert, tint: "text-orange-600", bg: "bg-orange-50", pill: "bg-orange-100 text-orange-700", form: "concerns", resource: "concern-records" },
  { key: "AS-14", code: "AS-14", label: "Reablement / Therapy", icon: Dumbbell, tint: "text-lime-600", bg: "bg-lime-50", pill: "bg-lime-100 text-lime-700", form: "generic" },
  { key: "pain", code: "Pain", label: "Pain", icon: Zap, tint: "text-orange-500", bg: "bg-orange-50", pill: "bg-orange-100 text-orange-700", form: "pain", resource: "pain-records" },
];
const DOMAIN_BY_KEY = new Map(DOMAINS.map((d) => [d.key, d]));

// 0–4 status anchor labels (v4.2 independence / risk scale) for generic quick-logs.
const STATUS_ANCHORS: { v: number; label: string }[] = [
  { v: 0, label: "Independent" }, { v: 1, label: "Low" }, { v: 2, label: "Moderate" }, { v: 3, label: "High" }, { v: 4, label: "Very high" },
];
const statusLabel = (n: unknown) => STATUS_ANCHORS.find((a) => a.v === Number(n))?.label ?? "";

// A generic quick-log record stored in the `care_log_notes` app-setting array.
type NoteRec = { id: string; residentId: string; dailyRoundId?: string; domain: string; status?: number; note?: string; shift?: string; by?: string; at: string };
const CARE_LOG_NOTES_KEY = "care_log_notes";
const parseNotes = (raw: string | undefined): NoteRec[] => { if (!raw) return []; try { const v = JSON.parse(raw); return Array.isArray(v) ? (v as NoteRec[]) : []; } catch { return []; } };

const summarize = (kind: SumKind, r: Row): string => {
  const p: string[] = [];
  const add = (k: string, v: unknown) => { if (v !== undefined && v !== null && v !== "") p.push(`${k}: ${v}`); };
  switch (kind) {
    case "vitals": add("diastolic", r.diastolic); add("heartRate", r.heartRate); add("respiratoryRate", r.respRate); add("systolic", r.systolic); add("temp", r.temperature); add("spo2", r.spo2); break;
    case "meals": add("assistanceLevel", s(r.feedingAssist).toLowerCase()); add("hydrationMl", r.fluidAmountMl); add("mealType", s(r.mealType).toLowerCase()); add("intake", r.intakeLevel); break;
    case "bowel": add("bloodPresent", fmtBool(r.hasBlood)); add("bristolType", r.bristolType); add("continent", r.containment === "Continent" ? "true" : undefined); break;
    case "urine": add("outputMl", r.outputMl); add("bloodPresent", fmtBool(r.hasBlood)); add("color", s(r.color).toLowerCase()); if (r.painful) p.push("painful"); break;
    case "edema": add("location", r.location); add("severity", s(r.severity).toLowerCase()); break;
    case "concerns": add("category", s(r.category).toLowerCase()); add("severity", s(r.severity).toLowerCase()); break;
    case "mood": add("mood", s(r.mood).toLowerCase()); if (r.behaviorNotes) p.push(s(r.behaviorNotes)); break;
    case "pain": add("painScore", r.score); add("location", r.location); add("type", s(r.type).toLowerCase()); break;
    case "mobility": add("assistanceLevel", s(r.assistanceLevel).toLowerCase()); add("assistiveDevice", r.assistiveDevice); add("fallIncident", fmtBool(r.fallOccurred)); break;
    case "sleep": add("hoursSlept", r.totalHours); add("quality", s(r.quality).toLowerCase()); add("disturbances", r.interruptionReason); break;
    case "generic": { const st = statusLabel(r.status); if (st) p.push(`status ${r.status} (${st})`); if (r.note) p.push(s(r.note).slice(0, 80)); break; }
  }
  return p.join(" · ") || "logged";
};

// ── Clinical trigger alerts ──────────────────────────────────────────────────
// Certain domain values are clinically significant and auto-raise an Incident so
// they surface in the resident's "Recent Incidents" (visible to caregiver / nurse
// / care manager) — mirroring the abnormal-vitals trigger in /api/vitals. Vitals
// themselves are handled server-side (mirrorVitals → /api/vitals), so they are
// intentionally NOT re-evaluated here to avoid double-logging.
type TriggerAlert = { type: string; severity: "MINOR" | "MODERATE" | "SEVERE" | "CRITICAL"; title: string; description: string };
const cap = (v: string) => (v ? v[0] + v.slice(1).toLowerCase() : v);
// Keyed by the record shape (SumKind), not the domain, so a single record type
// keeps its clinical trigger regardless of which v4.2 domain it now lives under
// (e.g. bowel/urine both belong to AS-10 Continence, edema to AS-11 Skin).
function evalDomainTrigger(kind: SumKind, d: Row, f: Row, name: string): TriggerAlert | null {
  const who = name || "Resident";
  switch (kind) {
    case "bowel": {
      if (d.bristolType == null) return { type: "OTHER", severity: "MODERATE", title: "No bowel movement", description: `No bowel movement recorded for ${who}. Monitor bowel pattern — escalate if no BM for 3+ days (constipation / impaction risk).` };
      if (d.bristolType === 1) return { type: "OTHER", severity: "MODERATE", title: "Constipation signs", description: `${who} passed hard, lumpy stool (Bristol Type 1) — constipation risk. Review hydration, diet and bowel protocol.` };
      if (d.bristolType === 7) return { type: "INFECTION", severity: "MODERATE", title: "Diarrhea", description: `${who} passed watery stool (Bristol Type 7) — diarrhea. Monitor hydration and watch for signs of infection.` };
      return null;
    }
    case "urine": {
      if (d.outputMl === 0) return { type: "MEDICAL_EMERGENCY", severity: "SEVERE", title: "No urine output", description: `No urine output recorded for ${who} — possible retention. Assess bladder, consider a bladder scan and notify the nurse.` };
      if (d.painful) return { type: "INFECTION", severity: d.hasBlood ? "SEVERE" : "MODERATE", title: "Painful urination (dysuria)", description: `${who} had painful/burning urination${d.hasBlood ? " with blood present" : ""} — possible UTI. Assess symptoms, consider a urinalysis and notify the nurse.` };
      if (s(d.color) === "Dark") return { type: "OTHER", severity: "MODERATE", title: "Dark urine", description: `${who}'s urine is dark — possible dehydration or concentrated output. Encourage fluids and monitor intake.` };
      return null;
    }
    case "edema": {
      const sev = s(f.severity);
      if (["MODERATE", "SEVERE", "DEEP"].includes(sev)) return { type: "MEDICAL_EMERGENCY", severity: sev === "MODERATE" ? "MODERATE" : "SEVERE", title: `Edema — ${cap(sev)}`, description: `${cap(sev)} edema noted for ${who}${f.location ? ` at ${s(f.location)}` : ""}${f.pitting ? " (pitting)" : ""}. Monitor for fluid overload / cardiac or renal cause.` };
      return null;
    }
    case "concerns": {
      const sev = s(f.severity);
      if (sev === "HIGH" || sev === "CRITICAL") return { type: "MEDICAL_EMERGENCY", severity: sev === "CRITICAL" ? "CRITICAL" : "SEVERE", title: `${cap(sev)} clinical concern`, description: `${cap(sev)}-severity concern raised for ${who}${f.category ? ` (${s(f.category).toLowerCase()})` : ""}: ${s(f.description) || "see care log"}.` };
      return null;
    }
    case "pain": {
      const score = Number(d.score) || 0;
      if (score >= 7) return { type: "MEDICAL_EMERGENCY", severity: "SEVERE", title: `Severe pain (${score}/10)`, description: `${who} reported severe pain of ${score}/10${f.location ? ` at ${s(f.location)}` : ""}. Assess, treat per orders and notify the nurse.` };
      if (score >= 4) return { type: "OTHER", severity: "MODERATE", title: `Moderate pain (${score}/10)`, description: `${who} reported pain of ${score}/10${f.location ? ` at ${s(f.location)}` : ""}. Review analgesia and reassess.` };
      return null;
    }
    case "mobility": {
      if (d.fallOccurred === true) return { type: "FALL", severity: "CRITICAL", title: "Fall during mobility", description: `A fall was reported for ${who} during mobility. Complete a full fall assessment and notify the nurse immediately.` };
      if (d.activityType === "BED_REST") return { type: "OTHER", severity: "MODERATE", title: "Did not ambulate", description: `${who} did not ambulate this shift — immobility / decline risk. Review mobility plan and DVT / pressure-injury precautions.` };
      if (s(f.assistanceLevel) === "DEPENDENT") return { type: "OTHER", severity: "MODERATE", title: "Dependent mobility", description: `${who} was fully dependent for mobility. Ensure the repositioning schedule and pressure-injury precautions are in place.` };
      return null;
    }
    case "sleep": {
      const hrs = Number(d.totalHours) || 0;
      const q = s(f.quality);
      if (hrs > 0 && hrs < 4) return { type: "OTHER", severity: "MODERATE", title: `Poor sleep (${hrs}h)`, description: `${who} slept only ${hrs}h${q ? ` (${q.toLowerCase()} quality)` : ""}. Review causes (pain, anxiety, nocturia) and sleep hygiene.` };
      if (q === "Poor" || q === "Very Poor") return { type: "OTHER", severity: "MODERATE", title: "Poor sleep quality", description: `${who}'s sleep quality was ${q.toLowerCase()}${Array.isArray(f.disturbances) && f.disturbances.length ? ` — disturbances: ${(f.disturbances as string[]).join(", ")}` : ""}. Review contributing factors.` };
      return null;
    }
    default: return null;
  }
}

// ── Shared data layer ────────────────────────────────────────────────────────
type Entry = { id: string; resId: string; domain: DomainKey; at: string; summary: string };

export function useCareLogData(clinicianRole: ClinicianRole) {
  const { name: clinicianName, userId: clinicianId } = useClinician(clinicianRole);
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const roundQ = useLiveQuery<Row>("daily-rounds", { query: "take=2000", tables: ["DailyRound"] });
  const vitQ = useLiveQuery<Row>("vital-signs", { query: "take=800", tables: ["VitalSigns"] });
  const mealQ = useLiveQuery<Row>("meal-records", { query: "take=800", tables: ["MealRecord"] });
  const bowQ = useLiveQuery<Row>("bowel-records", { query: "take=800", tables: ["BowelRecord"] });
  const uriQ = useLiveQuery<Row>("urine-records", { query: "take=800", tables: ["UrineRecord"] });
  const edeQ = useLiveQuery<Row>("edema-records", { query: "take=800", tables: ["EdemaRecord"] });
  const conQ = useLiveQuery<Row>("concern-records", { query: "take=800", tables: ["ConcernRecord"] });
  const moodQ = useLiveQuery<Row>("mood-records", { query: "take=800", tables: ["MoodRecord"] });
  const painQ = useLiveQuery<Row>("pain-records", { query: "take=800", tables: ["PainRecord"] });
  const mobQ = useLiveQuery<Row>("mobility-records", { query: "take=800", tables: ["MobilityRecord"] });
  const sleepQ = useLiveQuery<Row>("round-sleep-records", { query: "take=800", tables: ["SleepRecord"] });
  const { data: settingRows, refetch: refetchSettings } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  const refetchAll = async () => { await Promise.allSettled([roundQ.refetch(), vitQ.refetch(), mealQ.refetch(), bowQ.refetch(), uriQ.refetch(), edeQ.refetch(), conQ.refetch(), moodQ.refetch(), painQ.refetch(), mobQ.refetch(), sleepQ.refetch(), refetchSettings()]); };
  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);

  const roundToRes = useMemo(() => {
    const m = new Map<string, string>(); const day = todayKey();
    (roundQ.data || []).forEach((r) => { if (s(r.roundDate).slice(0, 10) === day) m.set(s(r.id), s(r.residentId)); });
    return m;
  }, [roundQ.data]);

  // Generic 0–4 status + note quick-logs (AS-01/03/04/07/09/14 + Skin note),
  // migration-free in the `care_log_notes` app-setting JSON array.
  const noteRecs = useMemo<NoteRec[]>(() => parseNotes(settingRows.find((r) => (r.key || r.id) === CARE_LOG_NOTES_KEY)?.value), [settingRows]);

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    const collect = (rows: Row[] | undefined, domain: DomainKey, kind: SumKind) => (rows || []).forEach((r) => {
      const resId = roundToRes.get(s(r.dailyRoundId)); if (resId) out.push({ id: s(r.id), resId, domain, at: s(r.time || r.createdAt || todayDate()), summary: summarize(kind, r) });
    });
    collect(vitQ.data, "AS-06", "vitals"); collect(mealQ.data, "AS-08", "meals");
    collect(bowQ.data, "AS-10", "bowel"); collect(uriQ.data, "AS-10", "urine");
    collect(edeQ.data, "AS-11", "edema"); collect(conQ.data, "AS-13", "concerns");
    collect(moodQ.data, "AS-05", "mood"); collect(painQ.data, "pain", "pain");
    collect(mobQ.data, "AS-02", "mobility"); collect(sleepQ.data, "AS-12", "sleep");
    // Generic notes: only today's, and only ones targeting a known domain chip.
    const day = todayKey();
    noteRecs.forEach((n) => { if (localDayKey(n.at) === day && DOMAIN_BY_KEY.has(n.domain as DomainKey)) out.push({ id: s(n.id), resId: s(n.residentId), domain: n.domain as DomainKey, at: s(n.at), summary: summarize("generic", n) }); });
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }, [roundToRes, vitQ.data, mealQ.data, bowQ.data, uriQ.data, edeQ.data, conQ.data, moodQ.data, painQ.data, mobQ.data, sleepQ.data, noteRecs]);

  const byResident = useMemo(() => {
    const m = new Map<string, Entry[]>();
    entries.forEach((e) => { const a = m.get(e.resId); if (a) a.push(e); else m.set(e.resId, [e]); });
    return m;
  }, [entries]);

  const domainsByRes = useMemo(() => {
    const m = new Map<string, Set<DomainKey>>();
    entries.forEach((e) => { const set = m.get(e.resId); if (set) set.add(e.domain); else m.set(e.resId, new Set([e.domain])); });
    return m;
  }, [entries]);

  const bowelRef = useMemo(() => s(settingRows.find((r) => (r.key || r.id) === BOWEL_REF_KEY)?.value), [settingRows]);
  const saveBowelRef = async (dataUrl: string | null) => {
    await upsertRecord("app-settings", BOWEL_REF_KEY, { key: BOWEL_REF_KEY, value: dataUrl || "" });
    await refetchSettings();
  };

  const ensureRound = async (residentId: string): Promise<string> => {
    const existing = (roundQ.data || []).find((r) => s(r.residentId) === residentId && s(r.roundDate).slice(0, 10) === todayKey());
    if (existing) return s(existing.id);
    // roundDate is a @db.Date column — send today's LOCAL date at UTC-midnight so
    // Postgres stores exactly that calendar day (no timezone-shift truncation),
    // and the bare-date comparison above matches it back in any timezone.
    const r = await createRecord("daily-rounds", { residentId, caregiverId: clinicianId, caregiverName: clinicianName, shift: shiftNow(), roundDate: `${todayKey()}T00:00:00.000Z`, status: "IN_PROGRESS" });
    await roundQ.refetch();
    return s(r?.id ?? r?.data?.id);
  };

  // Every entry across ALL dates (not just today) — powers history/analytics
  // views (e.g. Care History), where entries must appear on their own dates.
  const roundToResAll = useMemo(() => {
    const m = new Map<string, { resId: string; date: string }>();
    (roundQ.data || []).forEach((r) => m.set(s(r.id), { resId: s(r.residentId), date: s(r.roundDate) }));
    return m;
  }, [roundQ.data]);
  const allEntries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    const collect = (rows: Row[] | undefined, domain: DomainKey, kind: SumKind) => (rows || []).forEach((r) => {
      const info = roundToResAll.get(s(r.dailyRoundId));
      if (info) out.push({ id: s(r.id), resId: info.resId, domain, at: s(r.time || r.createdAt || info.date), summary: summarize(kind, r) });
    });
    collect(vitQ.data, "AS-06", "vitals"); collect(mealQ.data, "AS-08", "meals");
    collect(bowQ.data, "AS-10", "bowel"); collect(uriQ.data, "AS-10", "urine");
    collect(edeQ.data, "AS-11", "edema"); collect(conQ.data, "AS-13", "concerns");
    collect(moodQ.data, "AS-05", "mood"); collect(painQ.data, "pain", "pain");
    collect(mobQ.data, "AS-02", "mobility"); collect(sleepQ.data, "AS-12", "sleep");
    noteRecs.forEach((n) => { if (DOMAIN_BY_KEY.has(n.domain as DomainKey)) out.push({ id: s(n.id), resId: s(n.residentId), domain: n.domain as DomainKey, at: s(n.at), summary: summarize("generic", n) }); });
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }, [roundToResAll, vitQ.data, mealQ.data, bowQ.data, uriQ.data, edeQ.data, conQ.data, moodQ.data, painQ.data, mobQ.data, sleepQ.data, noteRecs]);

  // Append a generic quick-log to `care_log_notes` (read-modify-write the array).
  const saveNote = async (rec: Omit<NoteRec, "id" | "at" | "by" | "shift"> & { at?: string }) => {
    const next: NoteRec[] = [{ id: `cln-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: rec.at || new Date().toISOString(), by: clinicianName, shift: shiftNow(), ...rec }, ...noteRecs];
    await upsertRecord("app-settings", CARE_LOG_NOTES_KEY, { key: CARE_LOG_NOTES_KEY, value: JSON.stringify(next) });
    await refetchSettings();
  };

  const refetchResidents = () => resQ.refetch();

  return { residents, entries, allEntries, byResident, domainsByRes, bowelRef, saveBowelRef, ensureRound, saveNote, refetchAll, refetchResidents, loading: resQ.loading };
}

// ── Residents tab — quick-log list (Image 15) ────────────────────────────────
export default function CareLogsBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const { residents, domainsByRes, ensureRound, saveNote, refetchAll, refetchResidents, bowelRef, saveBowelRef, loading } = useCareLogData(clinicianRole);

  const [search, setSearch] = useState("");
  const [careLevelFilter, setCareLevelFilter] = useState("");
  const [roomFilter, setRoomFilter] = useState("");
  const [logFor, setLogFor] = useState<Row | null>(null);
  const [logTab, setLogTab] = useState<DomainKey>("AS-01");
  const [qrFor, setQrFor] = useState<Row | null>(null);
  const [viewFor, setViewFor] = useState<Row | null>(null);
  const [editFor, setEditFor] = useState<Row | null>(null);

  const q = search.trim().toLowerCase();
  const rooms = Array.from(new Set(residents.map((r: Row) => s(r.room)).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const filtered = residents.filter((r: Row) => {
    const okQ = !q || s(r.name).toLowerCase().includes(q) || s(r.room).toLowerCase().includes(q);
    const okLevel = !careLevelFilter || s(r.careLevel) === careLevelFilter;
    const okRoom = !roomFilter || s(r.room) === roomFilter;
    return okQ && okLevel && okRoom;
  });
  const openLog = (r: Row, tab: DomainKey) => { setLogTab(tab); setLogFor(r); };

  // Deactivate = discharge from the active roster. Mirrors FacilityResidents'
  // status control: updateRecord("residents", id, { status }). We use DISCHARGED
  // (the established "off the active roster" status) rather than a new field.
  const deactivate = async (r: Row) => {
    const res = await Swal.fire({
      title: "Deactivate resident?",
      text: `${s(r.name)} will be marked Discharged and removed from the active roster.`,
      icon: "warning", showCancelButton: true, confirmButtonColor: "#dc2626",
      cancelButtonColor: "#6b7280", confirmButtonText: "Deactivate",
    });
    if (!res.isConfirmed) return;
    try {
      await updateRecord("residents", s(r.id), { status: "DISCHARGED" });
      await refetchResidents();
      Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Resident deactivated", showConfirmButton: false, timer: 1600 });
    } catch (err) {
      Swal.fire({ title: "Could not deactivate", text: err instanceof Error ? err.message : "Update failed.", icon: "error" });
    }
  };

  return (
    <ClinicalPage>
      <ClinicalHeader
        title="Residents"
        subtitle={`${residents.length} active resident${residents.length === 1 ? "" : "s"}`}
      />

      <div className="mt-5 flex flex-col sm:flex-row gap-3 mb-5">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by name or room…" className="flex-1" />
        <select value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)} aria-label="Filter by room" className={`${controlClass} sm:w-40`}>
          <option value="">All rooms</option>
          {rooms.map((rm) => <option key={rm} value={rm}>Room {rm}</option>)}
        </select>
        <select value={careLevelFilter} onChange={(e) => setCareLevelFilter(e.target.value)} aria-label="Filter by level of care" className={`${controlClass} sm:w-56`}>
          <option value="">All levels of care</option>
          {CARE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>
        {(careLevelFilter || roomFilter || search) && (
          <ClinicalButton variant="ghost" onClick={() => { setSearch(""); setCareLevelFilter(""); setRoomFilter(""); }}>Clear</ClinicalButton>
        )}
      </div>

      <DataState
        loading={loading && residents.length === 0}
        empty={filtered.length === 0}
        emptyTitle={residents.length === 0 ? "No active residents" : "No residents match"}
        emptyHint={residents.length === 0 ? "Residents appear here once they are admitted to the active roster." : "Clear the search or level filter to see all residents."}
        skeletonRows={4}
      >
        <div className="space-y-3">
          {filtered.map((r: Row) => {
            const lvl = levelOf(r);
            const diet = s(r.dietRestriction) || s(r.raw?.dietType) || "Regular";
            return (
              <div key={s(r.id)} className="rounded-xl border p-4" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-3">
                  <div className="flex min-w-0 items-start gap-3 sm:flex-1 sm:items-center">
                  <div className="w-11 h-11 rounded-xl bg-[var(--clinical-surface-2)] flex flex-col items-center justify-center leading-none shrink-0"><span className="text-[9px] font-semibold text-[var(--clinical-muted)]">Rm</span><span className="text-sm font-bold text-[var(--clinical-ink-soft)]">{s(r.room)}</span></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col items-start gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
                      <p className="break-words font-bold leading-snug text-[var(--clinical-ink)] sm:truncate">{s(r.name)}</p>
                      <LevelBadge lvl={lvl} />
                    </div>
                    <p className="text-xs text-[var(--clinical-muted)] mt-0.5">{genderLabel(r.raw?.gender)} · {diet}</p>
                  </div>
                  </div>
                  <div className="grid w-full grid-cols-4 gap-2 sm:flex sm:w-auto sm:shrink-0 sm:items-center sm:gap-1.5">
                    <button onClick={() => setViewFor(r)} aria-label={`View ${s(r.name)}'s profile`} title="View profile" className="flex h-11 w-full items-center justify-center rounded-xl bg-[var(--clinical-surface-2)] text-[var(--clinical-ink-soft)] hover:brightness-95 sm:w-11"><Eye className="w-4 h-4" /></button>
                    <button onClick={() => setEditFor(r)} aria-label={`Edit ${s(r.name)}`} title="Edit resident" className="flex h-11 w-full items-center justify-center rounded-xl bg-[var(--clinical-surface-2)] text-[var(--clinical-panel)] hover:brightness-95 sm:w-11"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => deactivate(r)} aria-label={`Deactivate ${s(r.name)}`} title="Deactivate resident" className="flex h-11 w-full items-center justify-center rounded-xl bg-[var(--clinical-surface-2)] text-[var(--clinical-coral)] hover:brightness-95 sm:w-11"><UserX className="w-4 h-4" /></button>
                    <button onClick={() => setQrFor(r)} aria-label={`Show QR for ${s(r.name)}`} title="Resident QR" className="flex h-11 w-full items-center justify-center rounded-xl bg-[var(--clinical-surface-2)] text-[var(--clinical-ink-soft)] hover:brightness-95 sm:w-11"><QrCode className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </DataState>

      {logFor && <LogModal resident={logFor} initialTab={logTab} loggedDomains={domainsByRes.get(s(logFor.id)) || new Set()} ensureRound={ensureRound} saveNote={saveNote} clinicianRole={clinicianRole} bowelRef={bowelRef} saveBowelRef={saveBowelRef} onDone={refetchAll} onClose={() => setLogFor(null)} />}
      {qrFor && <QrModal resident={qrFor} onClose={() => setQrFor(null)} />}
      {viewFor && <ViewModal resident={viewFor} loggedDomains={domainsByRes.get(s(viewFor.id)) || new Set()} onOpenLog={(t) => { setViewFor(null); openLog(viewFor, t); }} onClose={() => setViewFor(null)} />}
      {editFor && <EditResidentModal resident={editFor} onSaved={refetchResidents} onClose={() => setEditFor(null)} />}
    </ClinicalPage>
  );
}

// ── Care Logs tab — today's log timeline (Image 18) ──────────────────────────
export function CareLogsTimeline({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const { residents, entries, byResident, domainsByRes, bowelRef, saveBowelRef, ensureRound, saveNote, refetchAll, loading } = useCareLogData(clinicianRole);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [logFor, setLogFor] = useState<Row | null>(null);
  const [logTab, setLogTab] = useState<DomainKey>("AS-01");
  const [statusFilter, setStatusFilter] = useState<"all" | "needs" | "documented">("all");

  const q = search.trim().toLowerCase();
  const documentedResidents = residents.filter((r: Row) => (byResident.get(s(r.id)) || []).length > 0).length;
  const needsDocumentation = Math.max(0, residents.length - documentedResidents);
  const documentedDomains = new Set(entries.map((entry) => entry.domain)).size;
  const coverage = residents.length ? Math.round((documentedResidents / residents.length) * 100) : 0;
  const filtered = residents.filter((r: Row) => {
    const matchesQuery = !q || s(r.name).toLowerCase().includes(q) || s(r.room).toLowerCase().includes(q);
    const hasEntries = (byResident.get(s(r.id)) || []).length > 0;
    const matchesStatus = statusFilter === "all" || (statusFilter === "documented" ? hasEntries : !hasEntries);
    return matchesQuery && matchesStatus;
  });
  const toggle = (id: string) => setExpanded((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const now = new Date();
  const dateLabel = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const sm = { DAY: { label: "Day Shift", Icon: Sun }, EVENING: { label: "Evening Shift", Icon: Clock }, NIGHT: { label: "Night Shift", Icon: Moon } }[shiftNow()];
  const SIcon = sm.Icon;

  return (
    <ClinicalPage>
      <ClinicalHeader
        title="Daily Care Logs"
        subtitle="Review shift documentation, identify residents still waiting for an entry, and add care observations from one workspace."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold text-[var(--clinical-ink-soft)]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}><CalendarDays className="h-4 w-4 text-[var(--clinical-panel)]" /> <span className="hidden lg:inline">{dateLabel}</span><span className="lg:hidden">Today</span></span>
            <span className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold text-[var(--clinical-ink-soft)]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}><SIcon className="h-4 w-4 text-[var(--clinical-amber)]" /> {sm.label}</span>
          </div>
        }
      />

      <section className="clinical-summary-band mt-6 overflow-hidden rounded-2xl bg-[var(--clinical-panel)] text-white">
        <div className="grid gap-px bg-white/15 sm:grid-cols-[1.35fr_repeat(3,1fr)]">
          <div className="bg-[var(--clinical-panel)] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-blue-100">Shift documentation coverage</p>
                <p className="mt-1 text-3xl font-bold tracking-[-0.03em]">{coverage}%</p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15"><Activity className="h-6 w-6" /></div>
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-black/20" aria-label={`${documentedResidents} of ${residents.length} residents documented`}>
              <div className="h-full rounded-full bg-white transition-[width] duration-500" style={{ width: `${coverage}%` }} />
            </div>
            <p className="mt-2 text-xs text-blue-100">{documentedResidents} of {residents.length} residents have an entry this shift</p>
          </div>
          <div className="bg-[var(--clinical-panel)] p-5"><p className="text-xs font-semibold text-blue-100">Entries today</p><p className="mt-2 text-2xl font-bold tabular-nums">{entries.length}</p></div>
          <div className="bg-[var(--clinical-panel)] p-5"><p className="text-xs font-semibold text-blue-100">Still due</p><p className="mt-2 text-2xl font-bold tabular-nums">{needsDocumentation}</p></div>
          <div className="bg-[var(--clinical-panel)] p-5"><p className="text-xs font-semibold text-blue-100">Domains charted</p><p className="mt-2 text-2xl font-bold tabular-nums">{documentedDomains}<span className="ml-1 text-sm font-semibold text-blue-100">/ 14</span></p></div>
        </div>
      </section>

      <div className="my-5 flex flex-col gap-3 rounded-2xl border p-3 sm:flex-row sm:items-center" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search resident or room…" className="min-w-0 flex-1" />
        <div role="tablist" aria-label="Documentation status" className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--clinical-surface-2)] p-1">
          {([
            ["all", "All", residents.length],
            ["needs", "Still due", needsDocumentation],
            ["documented", "Documented", documentedResidents],
          ] as const).map(([value, label, count]) => (
            <button key={value} role="tab" aria-selected={statusFilter === value} onClick={() => setStatusFilter(value)} className={`min-h-10 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition ${statusFilter === value ? "bg-[var(--clinical-surface)] text-[var(--clinical-ink)] shadow-sm" : "text-[var(--clinical-muted)] hover:text-[var(--clinical-ink)]"}`}>
              {label} <span className="ml-1 tabular-nums opacity-70">{count}</span>
            </button>
          ))}
        </div>
      </div>

      <DataState
        loading={loading && residents.length === 0}
        empty={filtered.length === 0}
        emptyTitle={residents.length === 0 ? "No active residents" : "No residents match"}
        emptyHint={residents.length === 0 ? "Residents appear here once they are admitted to the active roster." : "Clear the search to see all residents."}
        skeletonRows={4}
      >
        <div className="space-y-3">
          {filtered.map((r: Row) => {
            const list = byResident.get(s(r.id)) || [];
            const open = expanded.has(s(r.id));
            // Count only the 14 v4.2 assessment domains toward coverage (Pain is a
            // standalone symptom log, not one of the 14).
            const set = domainsByRes.get(s(r.id));
            const domainCount = set ? [...set].filter((k) => k !== "pain").length : 0;
            const lastEntry = list[0];
            return (
              <div key={s(r.id)} className="group overflow-hidden rounded-2xl border transition hover:border-[var(--clinical-line-strong)]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                <div className="grid items-center gap-4 p-4 sm:grid-cols-[minmax(180px,1.15fr)_minmax(180px,1fr)_auto] sm:p-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-[var(--clinical-surface-2)] leading-none"><span className="text-[9px] font-semibold uppercase tracking-wide text-[var(--clinical-muted)]">Room</span><span className="mt-1 text-base font-bold text-[var(--clinical-ink)]">{s(r.room)}</span></div>
                    <div className="min-w-0">
                      <p className="truncate font-bold text-[var(--clinical-ink)]">{s(r.name)}</p>
                      <p className={`mt-1 inline-flex items-center gap-1.5 text-xs font-semibold ${list.length ? "text-[var(--clinical-green)]" : "text-[var(--clinical-amber)]"}`}>
                        {list.length ? <Check className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                        {list.length ? "Documented this shift" : "Documentation still due"}
                      </p>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-3 text-xs"><span className="font-semibold text-[var(--clinical-ink-soft)]">{domainCount} of 14 domains</span><span className="text-[var(--clinical-muted)]">{lastEntry ? rel(lastEntry.at) : "No entry yet"}</span></div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--clinical-surface-2)]" aria-label={`${domainCount} of 14 care domains documented`}><div className="h-full rounded-full bg-[var(--clinical-green)] transition-[width] duration-500" style={{ width: `${Math.round((domainCount / 14) * 100)}%` }} /></div>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <ClinicalButton variant={list.length ? "secondary" : "primary"} size="sm" onClick={() => { setLogTab("AS-01"); setLogFor(r); }}><Plus className="h-4 w-4" /> {list.length ? "Add entry" : "Start log"}</ClinicalButton>
                    {list.length > 0 && <button onClick={() => toggle(s(r.id))} aria-label={open ? "Collapse logs" : "Review today's logs"} className="flex h-11 w-11 items-center justify-center rounded-xl text-[var(--clinical-muted)] transition hover:bg-[var(--clinical-surface-2)] hover:text-[var(--clinical-ink)]">{open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}</button>}
                  </div>
                </div>
                {open && list.length > 0 && (
                  <div className="space-y-3 border-t bg-[var(--clinical-surface-2)] px-4 py-4 sm:px-5" style={{ borderColor: "var(--clinical-line)" }}>
                    {list.map((e, i) => { const d = DOMAINS.find((x) => x.key === e.domain)!; return (
                      <div key={i} className="flex items-start gap-3 rounded-xl bg-[var(--clinical-surface)] p-3">
                        <DomainChip label={d.label} />
                        <span className="text-sm text-[var(--clinical-ink-soft)] flex-1 min-w-0">{e.summary}</span>
                        <span className="text-xs text-[var(--clinical-muted)] shrink-0">{rel(e.at)}</span>
                      </div>
                    ); })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DataState>

      {logFor && <LogModal resident={logFor} initialTab={logTab} loggedDomains={domainsByRes.get(s(logFor.id)) || new Set()} ensureRound={ensureRound} saveNote={saveNote} clinicianRole={clinicianRole} bowelRef={bowelRef} saveBowelRef={saveBowelRef} onDone={refetchAll} onClose={() => setLogFor(null)} />}
    </ClinicalPage>
  );
}

// ── Quick-log modal (14 v4.2 domains + Pain) ─────────────────────────────────
const chip = "px-2.5 py-1.5 rounded-lg border text-xs font-medium transition text-center";
const chipOn = "bg-[var(--clinical-panel)] text-white border-[var(--clinical-panel)]";
const chipOff = "bg-[var(--clinical-surface)] text-[var(--clinical-ink-soft)] border-[var(--clinical-line-strong)] hover:border-[var(--clinical-panel)]";
const num = "w-full px-3 py-2 rounded-lg border border-[var(--clinical-line-strong)] bg-[var(--clinical-surface)] text-base font-semibold text-[var(--clinical-ink)] outline-none focus:border-[var(--clinical-panel)] focus:ring-1 focus:ring-[var(--clinical-panel)]";
const txt = "w-full px-3 py-2 rounded-lg border border-[var(--clinical-line-strong)] bg-[var(--clinical-surface)] text-sm text-[var(--clinical-ink)] outline-none focus:border-[var(--clinical-panel)] focus:ring-1 focus:ring-[var(--clinical-panel)]";

function Chips({ options, value, onChange, cols = 4 }: { options: { v: string; label: string }[]; value: string; onChange: (v: string) => void; cols?: number }) {
  return <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>{options.map((o) => <button key={o.v} type="button" onClick={() => onChange(value === o.v ? "" : o.v)} className={`${chip} ${value === o.v ? chipOn : chipOff}`}>{o.label}</button>)}</div>;
}
function Multi({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const set = new Set(value);
  return <div className="flex flex-wrap gap-1.5">{options.map((o) => { const on = set.has(o); return <button key={o} type="button" onClick={() => { const n = new Set(set); if (on) n.delete(o); else n.add(o); onChange([...n]); }} className={`px-2.5 py-1 rounded-full border text-xs font-medium ${on ? chipOn : chipOff}`}>{o}</button>; })}</div>;
}
function Label({ children }: { children: React.ReactNode }) { return <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--clinical-muted)] mb-1.5">{children}</p>; }
function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} role="switch" aria-checked={on}
      className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border text-xs font-medium transition ${on ? chipOn : chipOff}`}>
      <span className="text-left leading-tight">{label}</span>
      <span className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${on ? "bg-white/85" : "bg-[var(--clinical-line-strong)]"}`}>
        <span className={`inline-block h-3 w-3 rounded-full shadow-sm transition-transform ${on ? "translate-x-[14px] bg-[var(--clinical-panel)]" : "translate-x-0.5 bg-[var(--clinical-surface)]"}`} />
      </span>
    </button>
  );
}
// Bowel reference image — a Bristol-type identification aid. Nurse/Care Manager
// uploads it once (community-scoped, persists by default); caregivers see it
// read-only in the Bowel form to identify the type.
function BowelReference({ photo, canEdit, onSave }: { photo?: string; canEdit: boolean; onSave: (d: string | null) => Promise<void> }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (!file) return; setBusy(true); try { await onSave(await toDataUrl(file)); } catch { Swal.fire({ title: "Could not save photo", icon: "error" }); } finally { setBusy(false); e.target.value = ""; } };
  return (
    <div>
      <Label>Stool Reference {canEdit ? "— upload to help caregivers identify the type" : "— identify the type"}</Label>
      <input ref={ref} type="file" accept="image/*" capture="environment" onChange={pick} className="hidden" />
      {photo ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="Stool reference" className="w-full h-44 object-contain bg-[var(--clinical-surface-2)] rounded-xl border" style={{ borderColor: "var(--clinical-line)" }} />
          {canEdit && (
            <div className="absolute top-2 right-2 flex gap-1.5">
              <button type="button" onClick={() => ref.current?.click()} disabled={busy} className="px-2 py-1 rounded-lg bg-black/50 text-white text-xs font-semibold hover:bg-black/70">Replace</button>
              <button type="button" onClick={() => onSave(null)} aria-label="Remove reference photo" className="p-1.5 rounded-lg bg-black/50 text-white hover:bg-black/70"><Trash2 className="w-4 h-4" /></button>
            </div>
          )}
        </div>
      ) : canEdit ? (
        <button type="button" onClick={() => ref.current?.click()} disabled={busy} className="w-full flex flex-col items-center justify-center gap-1.5 py-5 rounded-xl border-2 border-dashed text-[var(--clinical-muted)] hover:border-[var(--clinical-panel)] hover:text-[var(--clinical-ink)] disabled:opacity-60" style={{ borderColor: "var(--clinical-line-strong)" }}><div className="flex items-center gap-2"><Camera className="w-5 h-5" /><ImageIcon className="w-5 h-5" /></div><span className="text-sm font-medium">{busy ? "Saving…" : "Upload reference photo"}</span></button>
      ) : (
        <p className="text-xs text-[var(--clinical-muted)] py-4 text-center border-2 border-dashed rounded-xl" style={{ borderColor: "var(--clinical-line-strong)" }}>No reference photo yet — a nurse or care manager can add one.</p>
      )}
    </div>
  );
}
function VitalField({ label, unit, hint, value, onChange }: { label: string; unit: string; hint: string; value: string | undefined; onChange: (v: string) => void }) {
  return <div><Label>{label}</Label><div className="relative"><input inputMode="decimal" value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={num} aria-label={label} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--clinical-muted)]">{unit}</span></div><p className="text-[10px] text-[var(--clinical-muted)] mt-1">Normal {hint}</p></div>;
}

// MealRecord.appetite (AppetiteLevel) is required — derive it from the % consumed.
const APPETITE_BY_INTAKE: Record<string, string> = { "0%": "REFUSED", "25%": "POOR", "50%": "FAIR", "75%": "GOOD", "100%": "GOOD" };
const MOOD_MAP: Record<string, string> = { Calm: "CALM", Happy: "HAPPY", Anxious: "ANXIOUS", Agitated: "AGITATED", Confused: "CONFUSED", Withdrawn: "WITHDRAWN", Distressed: "SAD", Combative: "AGGRESSIVE" };
const SLEEP_MAP: Record<string, string> = { Excellent: "RESTFUL", Good: "FAIR", Fair: "RESTLESS", Poor: "POOR", "Very Poor": "INSOMNIA" };

function LogModal({ resident, initialTab, loggedDomains, ensureRound, saveNote, clinicianRole, bowelRef, saveBowelRef, onDone, onClose }: {
  resident: Row; initialTab: DomainKey; loggedDomains: Set<DomainKey>; ensureRound: (id: string) => Promise<string>; saveNote: (rec: { residentId: string; dailyRoundId?: string; domain: string; status?: number; note?: string }) => Promise<void>; clinicianRole: ClinicianRole; bowelRef: string; saveBowelRef: (dataUrl: string | null) => Promise<void>; onDone: () => Promise<void>; onClose: () => void;
}) { // rendered only when open (parent gates on logFor); ClinicalModal open is always true here
  const [tab, setTab] = useState<DomainKey>(initialTab);
  const [f, setF] = useState<Row>({});
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  // Domains logged during this modal session (added to the prop set from today).
  const [savedNow, setSavedNow] = useState<Set<DomainKey>>(new Set());
  const set = (patch: Row) => setF((p) => ({ ...p, ...patch }));
  const switchTab = (t: DomainKey) => { setTab(t); setF({}); setNotes(""); };
  const logged = new Set(loggedDomains);
  const nowT = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dom = DOMAIN_BY_KEY.get(tab)!;
  const form = dom.form;

  const aiNote = () => {
    const bits = Object.entries(f).filter(([, v]) => v !== "" && v != null && v !== false && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(", ") : v}`);
    setNotes(bits.length ? `${resident.name}: ${tab} — ${bits.join("; ")}.` : `${resident.name}: ${tab} log recorded.`);
  };

  // Build the model-backed write(s) for the selected form. Returns one item per
  // record to create, each tagged with its SumKind so the clinical trigger keeps
  // working. Continence (AS-10) can emit both a bowel and a urine record; Skin
  // (AS-11) emits the edema record (the free-text skin note is saved separately).
  type Payload = { resource: string; data: Row; kind: SumKind };
  const buildPayloads = (roundId: string): Payload[] => {
    const base = { dailyRoundId: roundId, time: new Date().toISOString(), notes: notes || null };
    const out: Payload[] = [];
    switch (form) {
      case "vitals": {
        const d: Row = { ...base, temperatureUnit: "°C", weightUnit: "kg" };
        ["systolic", "diastolic", "heartRate", "respRate", "spo2", "weight", "temperature"].forEach((k) => { if (f[k] !== "" && f[k] != null) d[k] = Number(f[k]); });
        if (!(d.systolic == null && d.heartRate == null && d.temperature == null && d.spo2 == null && d.respRate == null && d.weight == null)) out.push({ resource: "vital-signs", data: d, kind: "vitals" });
        break;
      }
      case "meals":
        if (f.mealType) out.push({ resource: "meal-records", data: { ...base, mealType: f.mealType, appetite: APPETITE_BY_INTAKE[s(f.intakeLevel)] || "FAIR", intakeLevel: s(f.intakeLevel) || "0%", feedingAssist: f.feedingAssist || null, fluidAmountMl: f.fluidAmountMl ? Number(f.fluidAmountMl) : null }, kind: "meals" });
        break;
      case "continence": {
        if (f.bristolType != null || f.containment) out.push({ resource: "bowel-records", data: { ...base, bristolType: f.bristolType ? Number(f.bristolType) : null, hasBlood: !!f.hasBlood, containment: f.containment || null }, kind: "bowel" });
        if (f.uColor || f.outputMl || f.uPainful || f.uHasBlood || f.uContainment) out.push({ resource: "urine-records", data: { ...base, color: f.uColor || null, outputMl: f.outputMl ? Number(f.outputMl) : null, hasBlood: !!f.uHasBlood, painful: !!f.uPainful, containment: f.uContainment || null }, kind: "urine" });
        break;
      }
      case "skin":
        if (f.severity || f.location) out.push({ resource: "edema-records", data: { ...base, location: f.location || "", severity: f.severity || "NONE", pitting: !!f.pitting }, kind: "edema" });
        break;
      case "concerns":
        if (f.description || notes) out.push({ resource: "concern-records", data: { ...base, category: f.category || "PHYSICAL", description: f.description || notes || "", severity: f.severity || "LOW" }, kind: "concerns" });
        break;
      case "mood":
        if (f.mood) out.push({ resource: "mood-records", data: { ...base, mood: MOOD_MAP[f.mood] || "CALM", behaviorNotes: [f.baseline ? `Baseline: ${f.baseline}` : "", (f.tags || []).length ? `Tags: ${(f.tags || []).join(", ")}` : ""].filter(Boolean).join(" · ") || null }, kind: "mood" });
        break;
      case "pain":
        out.push({ resource: "pain-records", data: { ...base, score: Number(f.score) || 0, location: f.location || "", type: f.type || null, reliefActions: (f.interventions || []).join(", ") || null }, kind: "pain" });
        break;
      case "mobility":
        if (f.assistanceLevel) out.push({ resource: "mobility-records", data: { ...base, activityType: f.ambulated === false ? "BED_REST" : "AMBULATION", assistanceLevel: f.assistanceLevel, assistiveDevice: f.assistiveDevice || null, fallOccurred: !!f.fallOccurred }, kind: "mobility" });
        break;
      case "sleep":
        if (f.totalHours) out.push({ resource: "round-sleep-records", data: { ...base, totalHours: Number(f.totalHours), quality: SLEEP_MAP[f.quality] || "FAIR", interruptionReason: (f.disturbances || []).join(", ") || null }, kind: "sleep" });
        break;
    }
    return out;
  };

  const mirrorVitals = async (d: Row) => {
    const posts: { type: string; value: string; unit: string }[] = [];
    if (d.systolic != null && d.diastolic != null) posts.push({ type: "BLOOD_PRESSURE", value: `${d.systolic}/${d.diastolic}`, unit: "mmHg" });
    if (d.heartRate != null) posts.push({ type: "HEART_RATE", value: String(d.heartRate), unit: "bpm" });
    if (d.temperature != null) posts.push({ type: "TEMPERATURE", value: String(d.temperature), unit: "°C" });
    if (d.respRate != null) posts.push({ type: "RESPIRATORY_RATE", value: String(d.respRate), unit: "/min" });
    if (d.spo2 != null) posts.push({ type: "OXYGEN", value: String(d.spo2), unit: "%" });
    if (d.weight != null) posts.push({ type: "WEIGHT", value: String(d.weight), unit: "kg" });
    await Promise.allSettled(posts.map((p) => fetch("/api/vitals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ residentId: s(resident.id), type: p.type, value: p.value, unit: p.unit }) })));
  };

  const save = async () => {
    // One entry per domain per day — flag a duplicate and let the user override
    // (e.g. to correct an earlier entry).
    if (logged.has(tab) || savedNow.has(tab)) {
      const proceed = await Swal.fire({
        title: `${dom.label} already logged today`,
        text: `A ${dom.label} entry already exists for ${s(resident.name)} today — one entry per domain per day is expected. Log another anyway?`,
        icon: "warning", showCancelButton: true, confirmButtonColor: "#2563eb", confirmButtonText: "Log anyway", cancelButtonText: "Cancel",
      });
      if (!proceed.isConfirmed) return;
    }
    setSaving(true);
    try {
      const roundId = await ensureRound(s(resident.id));
      if (!roundId) throw new Error("Could not open a care round for this resident.");

      // Generic 0–4 status + note domains → the migration-free care_log_notes store.
      if (form === "generic") {
        if (f.status == null && !notes.trim()) { Swal.fire({ title: "Nothing to save", text: "Select a status or add a note for this domain.", icon: "info" }); setSaving(false); return; }
        await saveNote({ residentId: s(resident.id), dailyRoundId: roundId, domain: tab, status: f.status != null ? Number(f.status) : undefined, note: notes.trim() || undefined });
        setSavedNow((prev) => new Set(prev).add(tab));
        await onDone();
        Swal.fire({ toast: true, position: "top-end", icon: "success", title: `${dom.label} logged`, showConfirmButton: false, timer: 1500 });
        setF({}); setNotes("");
        setSaving(false);
        return;
      }

      const built = buildPayloads(roundId);
      // Skin (AS-11) also accepts a free-text skin note stored generically.
      const skinNote = form === "skin" ? s(f.skinNote).trim() : "";
      if (!built.length && !skinNote) { Swal.fire({ title: "Nothing to save", text: "Enter at least one value for this domain.", icon: "info" }); setSaving(false); return; }

      let raisedAlert: TriggerAlert | null = null;
      for (const p of built) {
        await createRecord(p.resource, p.data);
        if (p.kind === "vitals") { try { await mirrorVitals(p.data); } catch { /* best-effort */ } }
        // Clinically-significant values auto-raise an Incident (Recent Incidents).
        // Best-effort — a trigger failure must never block the care log itself.
        const alert = p.kind === "vitals" ? null : evalDomainTrigger(p.kind, p.data, f, s(resident.name));
        if (alert) {
          raisedAlert = alert;
          try {
            await createRecord("incidents", { residentId: s(resident.id), incidentType: alert.type, severity: alert.severity, description: alert.description, followUpRequired: alert.severity === "SEVERE" || alert.severity === "CRITICAL", incidentDate: new Date().toISOString() });
          } catch { /* best-effort */ }
        }
      }
      if (skinNote) { try { await saveNote({ residentId: s(resident.id), dailyRoundId: roundId, domain: tab, note: skinNote }); } catch { /* best-effort */ } }

      setSavedNow((prev) => new Set(prev).add(tab));
      await onDone();
      const alert = raisedAlert;
      Swal.fire({ toast: true, position: "top-end", icon: alert ? "warning" : "success", title: alert ? `${dom.label} logged — ${alert.title} alert raised` : `${dom.label} logged`, text: alert ? "Logged to Recent Incidents for clinical review." : undefined, showConfirmButton: false, timer: alert ? 2800 : 1500 });
      setF({}); setNotes("");
    } catch (e) { Swal.fire({ title: "Save failed", text: e instanceof Error ? e.message : "Could not save.", icon: "error" }); }
    finally { setSaving(false); }
  };

  return (
    <ClinicalModal
      open
      onClose={onClose}
      size="lg"
      title={`Document care — ${s(resident.name)}`}
      description={`${dom.label} · Room ${s(resident.room)} · ${nowT}`}
      footer={
        <div className="flex flex-1 items-center justify-between">
          <ClinicalButton variant="ghost" size="sm" onClick={onClose}>Close</ClinicalButton>
          <span className="text-[11px] text-[var(--clinical-muted)]">{new Set([...logged, ...savedNow].filter((k) => k !== "pain")).size}/14 logged</span>
        </div>
      }
    >
      <div className="mb-5 grid grid-cols-5 gap-1 rounded-2xl bg-[var(--clinical-surface-2)] p-1.5 sm:grid-cols-8 lg:grid-cols-8">
        {DOMAINS.map((d) => { const on = d.key === tab; const doneD = logged.has(d.key) || savedNow.has(d.key); const Icon = d.icon; return (
          <button key={d.key} onClick={() => switchTab(d.key)} aria-label={`${d.code} ${d.label}`} title={`${d.code} · ${d.label}`} className={`relative flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 transition ${on ? "bg-[var(--clinical-surface)] text-[var(--clinical-panel)] shadow-sm" : "text-[var(--clinical-muted)] hover:bg-[var(--clinical-surface)] hover:text-[var(--clinical-ink)]"}`}>
            <Icon className="h-4 w-4 shrink-0" />
            <span className="text-[9px] font-semibold leading-tight text-center line-clamp-2">{d.label}</span>
            {doneD && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--clinical-green)]" aria-label="Already documented" />}
          </button>
        ); })}
      </div>

      <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface-2)" }}>
            <span className="rounded-md bg-[var(--clinical-panel)] px-1.5 py-0.5 text-[10px] font-bold text-white">{dom.code}</span>
            <span className="text-sm font-semibold text-[var(--clinical-ink)]">{dom.label}</span>
          </div>
          {form === "generic" && (<>
            <div><Label>Status (v4.2 anchor)</Label><Chips cols={5} value={s(f.status)} onChange={(v) => set({ status: v === "" ? undefined : Number(v) })} options={STATUS_ANCHORS.map((a) => ({ v: String(a.v), label: `${a.v} · ${a.label}` }))} /><p className="text-[10px] text-[var(--clinical-muted)] mt-1">0 Independent · 1 Low · 2 Moderate · 3 High · 4 Very high</p></div>
          </>)}
          {form === "vitals" && (<>
            <div><Label>Blood Pressure</Label><div className="grid grid-cols-2 gap-2">
              <div><input inputMode="numeric" value={f.systolic ?? ""} onChange={(e) => set({ systolic: e.target.value })} placeholder="Systolic" aria-label="Systolic" className={num} /><p className="text-[10px] text-[var(--clinical-muted)] mt-1">90–139 mmHg</p></div>
              <div><input inputMode="numeric" value={f.diastolic ?? ""} onChange={(e) => set({ diastolic: e.target.value })} placeholder="Diastolic" aria-label="Diastolic" className={num} /><p className="text-[10px] text-[var(--clinical-muted)] mt-1">60–89 mmHg</p></div>
            </div></div>
            <VitalField label="Heart Rate" unit="bpm" hint="60–100 bpm" value={f.heartRate} onChange={(v) => set({ heartRate: v })} />
            <VitalField label="Temperature" unit="°C" hint="36.1–37.2 °C" value={f.temperature} onChange={(v) => set({ temperature: v })} />
            <VitalField label="Oxygen Saturation" unit="%" hint="≥ 95 %" value={f.spo2} onChange={(v) => set({ spo2: v })} />
            <VitalField label="Respiratory Rate" unit="/min" hint="12–20 /min" value={f.respRate} onChange={(v) => set({ respRate: v })} />
            <VitalField label="Weight" unit="kg" hint="per baseline" value={f.weight} onChange={(v) => set({ weight: v })} />
          </>)}
          {form === "meals" && (<>
            <div><Label>Meal Type</Label><Chips cols={4} value={f.mealType || ""} onChange={(v) => set({ mealType: v })} options={[{ v: "BREAKFAST", label: "Breakfast" }, { v: "LUNCH", label: "Lunch" }, { v: "DINNER", label: "Dinner" }, { v: "SNACK", label: "Snack" }]} /></div>
            <div><Label>% Consumed</Label><Chips cols={5} value={f.intakeLevel || ""} onChange={(v) => set({ intakeLevel: v })} options={["0%", "25%", "50%", "75%", "100%"].map((x) => ({ v: x, label: x }))} /></div>
            <div><Label>Assistance</Label><Chips cols={2} value={f.feedingAssist || ""} onChange={(v) => set({ feedingAssist: v })} options={[{ v: "Independent", label: "Independent" }, { v: "Setup Only", label: "Setup Only" }, { v: "Partial Assist", label: "Partial Assist" }, { v: "Full Assist", label: "Full Assist" }]} /></div>
            <div><Label>Hydration (mL)</Label><div className="flex flex-wrap gap-1.5 items-center">{[0, 100, 150, 200, 250, 300].map((n) => <button key={n} type="button" onClick={() => set({ fluidAmountMl: (Number(f.fluidAmountMl) || 0) + n })} className={`${chip} ${chipOff}`}>+{n}</button>)}<span className="ml-1 text-xs font-bold text-[var(--clinical-panel)]">{Number(f.fluidAmountMl) || 0}mL</span><button type="button" onClick={() => set({ fluidAmountMl: 0 })} className="text-[10px] text-[var(--clinical-muted)] underline">reset</button></div></div>
          </>)}
          {form === "continence" && (<>
            <div className="rounded-xl border p-3 space-y-3" style={{ borderColor: "var(--clinical-line)" }}>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--clinical-panel)]">Bowel</p>
              <Label>Bristol Stool Scale</Label>
              <Chips cols={4} value={s(f.bristolType)} onChange={(v) => set({ bristolType: v })} options={[1, 2, 3, 4, 5, 6, 7].map((n) => ({ v: String(n), label: `Type ${n}` })).concat([{ v: "", label: "None" }])} />
              <div className="grid grid-cols-2 gap-2"><Toggle label="No Blood" on={f.hasBlood === false} onClick={() => set({ hasBlood: f.hasBlood === false ? undefined : false })} /><Toggle label="Continent" on={f.containment === "Continent"} onClick={() => set({ containment: f.containment === "Continent" ? "" : "Continent" })} /></div>
              <BowelReference photo={bowelRef} canEdit={clinicianRole === "NURSE" || clinicianRole === "FACILITY_ADMIN"} onSave={saveBowelRef} />
            </div>
            <div className="rounded-xl border p-3 space-y-3" style={{ borderColor: "var(--clinical-line)" }}>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--clinical-panel)]">Urine</p>
              <div><Label>Color</Label><Chips cols={4} value={f.uColor || ""} onChange={(v) => set({ uColor: v })} options={["Clear", "Pale", "Yellow", "Dark"].map((x) => ({ v: x, label: x }))} /></div>
              <div><Label>Output (mL)</Label><input inputMode="numeric" value={f.outputMl ?? ""} onChange={(e) => set({ outputMl: e.target.value })} placeholder="mL" aria-label="Urine output in mL" className={num} /></div>
              <div className="grid grid-cols-2 gap-2"><Toggle label="No Blood" on={f.uHasBlood === false} onClick={() => set({ uHasBlood: f.uHasBlood === false ? undefined : false })} /><Toggle label="Continent" on={f.uContainment === "Continent"} onClick={() => set({ uContainment: f.uContainment === "Continent" ? "" : "Continent" })} /></div>
              <Toggle label="Painful / burning (dysuria)" on={!!f.uPainful} onClick={() => set({ uPainful: !f.uPainful })} />
            </div>
          </>)}
          {form === "skin" && (<>
            <div><Label>Edema Location</Label><input value={f.location ?? ""} onChange={(e) => set({ location: e.target.value })} placeholder="e.g. Ankles, bilateral" className={txt} /></div>
            <div><Label>Edema Severity</Label><Chips cols={3} value={f.severity || ""} onChange={(v) => set({ severity: v })} options={["NONE", "TRACE", "MILD", "MODERATE", "SEVERE", "DEEP"].map((x) => ({ v: x, label: x[0] + x.slice(1).toLowerCase() }))} /></div>
            <Toggle label="Pitting" on={!!f.pitting} onClick={() => set({ pitting: !f.pitting })} />
            <div><Label>Skin Note (pressure areas, wounds, integrity)</Label><textarea rows={2} value={f.skinNote ?? ""} onChange={(e) => set({ skinNote: e.target.value })} placeholder="e.g. Sacrum intact, no redness…" className={txt} /></div>
          </>)}
          {form === "concerns" && (<>
            <div><Label>Category</Label><Chips cols={3} value={f.category || ""} onChange={(v) => set({ category: v })} options={["PHYSICAL", "BEHAVIORAL", "SKIN", "PAIN", "HYDRATION", "OTHER"].map((x) => ({ v: x, label: x[0] + x.slice(1).toLowerCase() }))} /></div>
            <div><Label>Severity</Label><Chips cols={4} value={f.severity || ""} onChange={(v) => set({ severity: v })} options={["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((x) => ({ v: x, label: x[0] + x.slice(1).toLowerCase() }))} /></div>
            <div><Label>Description</Label><textarea rows={2} value={f.description ?? ""} onChange={(e) => set({ description: e.target.value })} className={txt} /></div>
          </>)}
          {form === "mood" && (<>
            <div><Label>Current Mood</Label><Chips cols={4} value={f.mood || ""} onChange={(v) => set({ mood: v })} options={["Calm", "Happy", "Anxious", "Agitated", "Confused", "Withdrawn", "Distressed", "Combative"].map((x) => ({ v: x, label: x }))} /></div>
            <div><Label>Baseline Mood</Label><Chips cols={4} value={f.baseline || ""} onChange={(v) => set({ baseline: v })} options={["Calm", "Happy", "Anxious", "Variable"].map((x) => ({ v: x, label: x }))} /></div>
            <div><Label>Behavior Tags</Label><Multi value={f.tags || []} onChange={(v) => set({ tags: v })} options={["Cooperative", "Resistive", "Wandering", "Calling out", "Sleeping excessively", "Appetite change", "Sundowning"]} /></div>
          </>)}
          {form === "pain" && (<>
            <div><Label>Pain Score (0–10)</Label><Chips cols={6} value={s(f.score)} onChange={(v) => set({ score: v })} options={Array.from({ length: 11 }, (_, i) => ({ v: String(i), label: String(i) }))} /></div>
            <div><Label>Location</Label><Multi value={f.location ? [f.location] : []} onChange={(v) => set({ location: v[v.length - 1] || "" })} options={["Head", "Chest", "Abdomen", "Back", "Hip", "Leg", "Arm", "Shoulder", "Knee", "Foot", "Generalized"]} /></div>
            <div><Label>Pain Type</Label><Chips cols={3} value={f.type || ""} onChange={(v) => set({ type: v })} options={["Aching", "Sharp", "Burning", "Throbbing", "Cramping", "Pressure"].map((x) => ({ v: x, label: x }))} /></div>
            <div><Label>Intervention</Label><Multi value={f.interventions || []} onChange={(v) => set({ interventions: v })} options={["Repositioned", "Medication given", "Ice/Heat applied", "Notified nurse", "Family notified"]} /></div>
          </>)}
          {form === "mobility" && (<>
            <div><Label>Assistance Level</Label><Chips cols={2} value={f.assistanceLevel || ""} onChange={(v) => set({ assistanceLevel: v })} options={[{ v: "INDEPENDENT", label: "Independent" }, { v: "SUPERVISED", label: "Supervision" }, { v: "MINIMAL", label: "Minimal Assist" }, { v: "MODERATE", label: "Moderate Assist" }, { v: "MAXIMAL", label: "Maximum Assist" }, { v: "DEPENDENT", label: "Dependent" }]} /></div>
            <div><Label>Mobility Aid</Label><Chips cols={3} value={f.assistiveDevice || ""} onChange={(v) => set({ assistiveDevice: v })} options={["None", "Cane", "Walker", "Wheelchair", "Bed-bound", "Gait belt"].map((x) => ({ v: x, label: x }))} /></div>
            <Toggle label="Did not ambulate" on={f.ambulated === false} onClick={() => set({ ambulated: f.ambulated === false ? undefined : false })} />
            <button type="button" onClick={() => set({ fallOccurred: !f.fallOccurred })} className="w-full py-2 rounded-lg border text-xs font-semibold" style={f.fallOccurred ? { backgroundColor: "var(--clinical-coral)", color: "#fff", borderColor: "var(--clinical-coral)" } : { color: "var(--clinical-coral)", borderColor: "var(--clinical-coral)" }}>⚠ Report Fall Incident</button>
          </>)}
          {form === "sleep" && (<>
            <div><Label>Hours of Sleep</Label><Chips cols={5} value={s(f.totalHours)} onChange={(v) => set({ totalHours: v })} options={[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ v: String(n), label: `${n}h` }))} /></div>
            <div><Label>Sleep Quality</Label><Chips cols={5} value={f.quality || ""} onChange={(v) => set({ quality: v })} options={["Excellent", "Good", "Fair", "Poor", "Very Poor"].map((x) => ({ v: x, label: x }))} /></div>
            <div><Label>Disturbances</Label><Multi value={f.disturbances || []} onChange={(v) => set({ disturbances: v })} options={["Pain", "Anxiety", "Noise", "Nocturia", "Confusion", "Nightmares", "Restlessness"]} /></div>
          </>)}

          <div>
            <div className="flex items-center justify-between mb-1"><Label>Clinical Notes (optional)</Label><button onClick={aiNote} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--clinical-panel)]"><Sparkles className="w-3 h-3" /> AI Note</button></div>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observations… or tap AI Note" aria-label="Clinical notes" className={txt} />
          </div>
          <ClinicalButton variant="accent" onClick={save} disabled={saving} className="w-full">{saving ? "Saving…" : `Save ${dom.label} entry`}</ClinicalButton>
      </div>
    </ClinicalModal>
  );
}

// ── QR modal ─────────────────────────────────────────────────────────────────
// The QR encodes the resident's full care-card URL (/rcard/<id>) — the same
// scannable payload FacilityResidents / ResidentQRModal use — so scanning it
// (or tapping "Open card") resolves in-system to the full profile.
function QrModal({ resident, onClose }: { resident: Row; onClose: () => void }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const cardUrl = `${origin}/rcard/${s(resident.id)}`;
  const download = () => { const a = document.createElement("a"); a.href = qrDataUrl(cardUrl, { size: 400 }); a.download = `QR-${s(resident.name).replace(/\s+/g, "-")}.svg`; a.click(); };
  return (
    <ClinicalModal open onClose={onClose} title={s(resident.name)} description="Scan to open the full care card." size="sm">
      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrDataUrl(cardUrl, { size: 220 })} alt="Resident QR" width={220} height={220} className="mx-auto rounded-xl border" style={{ borderColor: "var(--clinical-line)" }} />
        <div className="mt-4 flex flex-col gap-2">
          <ClinicalButton variant="secondary" onClick={download} className="w-full"><Download className="w-4 h-4" /> Download QR</ClinicalButton>
          <a href={cardUrl} target="_blank" rel="noopener noreferrer" className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-[var(--clinical-panel)] text-white text-sm font-semibold hover:brightness-110"><ExternalLink className="w-4 h-4" /> Open card</a>
        </div>
      </div>
    </ClinicalModal>
  );
}

// ── View modal — profile + today's logging + meds, View Full Profile at bottom
function MedsList({ residentId }: { residentId: string }) {
  const { data } = useLiveQuery<Row>("medications", { query: `take=100&f_residentId=${residentId}`, tables: ["Medication"] });
  if (!data.length) return <p className="text-sm text-[var(--clinical-muted)]">No medications on file.</p>;
  return (
    <div className="space-y-2">
      {data.map((m) => {
        const name = s(m.name || m.medicationName || m.drugName) || "Medication";
        const dose = s(m.dosage || m.dose || m.strength);
        const sub = [s(m.route), s(m.frequency || m.schedule || m.time || m.scheduleTime)].filter(Boolean).join(" · ");
        return <div key={s(m.id)} className="flex items-start justify-between gap-2"><div><p className="text-sm font-semibold text-[var(--clinical-ink)]">{name}</p>{sub && <p className="text-xs text-[var(--clinical-muted)]">{sub}</p>}</div><span className="text-sm text-[var(--clinical-ink-soft)] shrink-0">{dose || "—"}</span></div>;
      })}
    </div>
  );
}

function ViewModal({ resident, loggedDomains, onOpenLog, onClose }: { resident: Row; loggedDomains: Set<DomainKey>; onOpenLog: (t: DomainKey) => void; onClose: () => void }) {
  const raw = (resident.raw || {}) as Row;
  const lvl = levelOf(resident);
  // Open the resident's full care card (same /rcard/<id> page the per-resident QR encodes).
  const goFull = () => { try { window.location.href = `/rcard/${s(resident.id)}`; } catch { /* noop */ } };
  const field = (label: string, value: string) => <div><p className="text-[11px] text-[var(--clinical-muted)]">{label}</p><p className="text-sm font-semibold text-[var(--clinical-ink)]">{value || "—"}</p></div>;

  return (
    <ClinicalModal
      open
      onClose={onClose}
      title={s(resident.name)}
      description={`Room ${s(resident.room)} · Level ${lvl.n} · ${lvl.label}`}
      footer={<ClinicalButton variant="primary" onClick={goFull} className="w-full"><UserRound className="w-4 h-4" /> View Full Profile</ClinicalButton>}
    >
      <div className="space-y-5">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-[var(--clinical-surface-2)] flex flex-col items-center justify-center leading-none shrink-0"><span className="text-[9px] font-semibold text-[var(--clinical-muted)]">Rm</span><span className="text-sm font-bold text-[var(--clinical-ink-soft)]">{s(resident.room)}</span></div>
          <div className="min-w-0"><p className="font-bold text-[var(--clinical-ink)] truncate">{s(resident.name)}</p><LevelBadge lvl={lvl} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {field("Date of Birth", s(raw.dateOfBirth).slice(0, 10))}
          {field("Gender", s(raw.gender))}
          {field("Admission Date", s(raw.admissionDate).slice(0, 10))}
          {field("Diet Type", s(resident.dietRestriction) || s(raw.dietType) || "Regular")}
          {field("Mobility Aid", s(raw.mobility) || s(raw.mobilityAid))}
          {field("Assigned Nurse", s(raw.assignedNurse))}
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--clinical-muted)] mb-2">Today&apos;s Care Logging</p>
          <div className="grid grid-cols-4 gap-2">
            {DOMAINS.map((d) => { const on = loggedDomains.has(d.key); const Icon = d.icon; return (
              <button key={d.key} onClick={() => onOpenLog(d.key)} aria-label={`Log ${d.label}`} className="rounded-xl border p-2 flex flex-col items-center gap-1 hover:bg-[var(--clinical-surface-2)]" style={{ borderColor: on ? "var(--clinical-green)" : "var(--clinical-line)", backgroundColor: on ? "color-mix(in srgb, var(--clinical-green) 12%, transparent)" : "transparent" }}>
                <Icon className="w-4 h-4" style={{ color: on ? "var(--clinical-green)" : "var(--clinical-ink-soft)" }} />
                <span className="text-[10px] text-[var(--clinical-ink-soft)]">{d.label}</span>
                {on ? <Check className="w-3 h-3" style={{ color: "var(--clinical-green)" }} /> : <span className="text-[9px] text-[var(--clinical-muted)]">log</span>}
              </button>
            ); })}
          </div>
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--clinical-muted)] mb-2 flex items-center gap-1.5"><Pill className="w-3.5 h-3.5" /> Medications</p>
          <MedsList residentId={s(resident.id)} />
        </div>
      </div>
    </ClinicalModal>
  );
}

// ── Edit modal (Image 76) ────────────────────────────────────────────────────
// Replicates NurseRecords' updateRecord("residents", id, {...}) mapping, expanded
// to the LifeCare Basic Information layout + collapsible sections. Every field
// persisted here maps to a real Resident column (no invented fields).
const CARE_OPTIONS: { v: string; label: string }[] = [
  { v: "INDEPENDENT", label: "Level 1 · Independent" },
  { v: "ASSISTED", label: "Level 2 · Assisted" },
  { v: "MEMORY", label: "Level 4 · Memory Care" },
  { v: "SKILLED", label: "Level 5 · Skilled Care" },
];
const editInput = controlClass;

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--clinical-line)" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-3.5 py-3 text-sm font-semibold text-[var(--clinical-ink-soft)] hover:bg-[var(--clinical-surface-2)]">
        <span>{title}{subtitle ? <span className="text-[var(--clinical-muted)] font-normal"> {subtitle}</span> : null}</span>
        {open ? <ChevronUp className="w-4 h-4 text-[var(--clinical-muted)]" /> : <ChevronDown className="w-4 h-4 text-[var(--clinical-muted)]" />}
      </button>
      {open && <div className="px-3.5 pb-3.5 pt-1 space-y-3">{children}</div>}
    </div>
  );
}
function EditLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return <p className="text-[12px] font-semibold text-[var(--clinical-ink-soft)] mb-1">{children}{required && <span className="text-[var(--clinical-coral)]"> *</span>}</p>;
}

function EditResidentModal({ resident, onSaved, onClose }: { resident: Row; onSaved: () => Promise<void> | void; onClose: () => void }) {
  const raw = (resident.raw || {}) as Row;
  const initialName = s(resident.name);
  const sp = initialName.indexOf(" ");
  const [firstName, setFirstName] = useState(s(raw.firstName) || (sp === -1 ? initialName : initialName.slice(0, sp)));
  const [lastName, setLastName] = useState(s(raw.lastName) || (sp === -1 ? "" : initialName.slice(sp + 1)));
  const [room, setRoom] = useState(s(resident.room) === "—" ? "" : s(resident.room));
  const [gender, setGender] = useState(s(raw.gender));
  const [dob, setDob] = useState(s(raw.dateOfBirth).slice(0, 10));
  const [admission, setAdmission] = useState(s(raw.admissionDate).slice(0, 10));
  const [careLevel, setCareLevel] = useState(s(raw.careLevel) || "ASSISTED");
  const [dnr, setDnr] = useState(!!raw.dnrStatus);
  const [conditions, setConditions] = useState(s(resident.medicalHistory) || s(raw.medicalHistory));
  const [allergies, setAllergies] = useState(s(resident.allergies) || s(raw.allergies));
  const [notes, setNotes] = useState(s(resident.notes) || s(raw.notes));
  const [saving, setSaving] = useState(false);

  const nConditions = conditions.split(",").map((c) => c.trim()).filter(Boolean).length;
  const nAllergies = allergies.split(",").map((c) => c.trim()).filter(Boolean).length;
  const valid = firstName.trim() && lastName.trim() && room.trim() && dob && admission;

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await updateRecord("residents", s(resident.id), {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        roomNumber: room.trim(),
        gender: gender || null,
        dateOfBirth: dob ? new Date(dob).toISOString() : null,
        admissionDate: new Date(admission).toISOString(),
        careLevel,
        dnrStatus: dnr,
        medicalHistory: conditions.trim() || null,
        allergies: allergies.trim() || null,
        notes: notes.trim() || null,
      });
      await onSaved();
      Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Resident updated", showConfirmButton: false, timer: 1500 });
      onClose();
    } catch (err) {
      Swal.fire({ title: "Update failed", text: err instanceof Error ? err.message : "Could not save changes.", icon: "error" });
      setSaving(false);
    }
  };

  return (
    <ClinicalModal
      open
      onClose={onClose}
      title={`Edit — ${s(resident.name)}`}
      description="Update resident details"
      footer={<>
        <ClinicalButton variant="ghost" size="sm" onClick={onClose}>Cancel</ClinicalButton>
        <ClinicalButton variant="accent" onClick={save} disabled={!valid || saving}>{saving ? "Saving…" : "Save Changes"}</ClinicalButton>
      </>}
    >
        <div className="space-y-3">
          <div className="rounded-xl border px-3.5 py-3.5 space-y-3" style={{ borderColor: "var(--clinical-line)" }}>
            <p className="text-sm font-semibold text-[var(--clinical-ink-soft)]">Basic Information</p>
            <div className="grid grid-cols-2 gap-3">
              <div><EditLabel required>First Name</EditLabel><input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={editInput} /></div>
              <div><EditLabel required>Last Name</EditLabel><input value={lastName} onChange={(e) => setLastName(e.target.value)} className={editInput} /></div>
              <div><EditLabel required>Room Number</EditLabel><input value={room} onChange={(e) => setRoom(e.target.value)} className={editInput} /></div>
              <div><EditLabel>Gender</EditLabel>
                <select value={gender} onChange={(e) => setGender(e.target.value)} className={editInput}>
                  <option value="">Not specified</option>
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div><EditLabel required>Date of Birth</EditLabel><input type="date" value={dob} onChange={(e) => setDob(e.target.value)} className={editInput} /></div>
              <div><EditLabel required>Admission Date</EditLabel><input type="date" value={admission} onChange={(e) => setAdmission(e.target.value)} className={editInput} /></div>
            </div>
          </div>

          <Section title="Care Level & Clinical Flags">
            <div><EditLabel>Care Level</EditLabel>
              <select value={careLevel} onChange={(e) => setCareLevel(e.target.value)} className={editInput}>
                {CARE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--clinical-ink-soft)] cursor-pointer">
              <input type="checkbox" checked={dnr} onChange={(e) => setDnr(e.target.checked)} className="w-4 h-4 rounded" />
              DNR (Do Not Resuscitate)
            </label>
          </Section>

          <Section title="Medical Conditions" subtitle={`(${nConditions} selected)`}>
            <EditLabel>Conditions (comma-separated)</EditLabel>
            <textarea rows={2} value={conditions} onChange={(e) => setConditions(e.target.value)} placeholder="Hypertension, Type 2 Diabetes" className={editInput} />
          </Section>

          <Section title="Allergies" subtitle={`(${nAllergies} selected)`}>
            <EditLabel>Allergies (comma-separated)</EditLabel>
            <textarea rows={2} value={allergies} onChange={(e) => setAllergies(e.target.value)} placeholder="Penicillin, Shellfish" className={editInput} />
          </Section>

          <Section title="Care Plan Notes">
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Special care instructions, preferences…" className={editInput} />
          </Section>
        </div>
    </ClinicalModal>
  );
}
