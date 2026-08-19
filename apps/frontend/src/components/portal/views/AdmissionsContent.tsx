"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Swal from "@/lib/swal";
import {
  UserPlus, Stethoscope, ClipboardList, ShieldCheck, BedDouble,
  Users, HeartPulse, Check, ChevronLeft, ChevronRight, X, Plus, Search,
  CheckCircle2, Loader2, CircleDot, Ban, AlertTriangle, Download, Printer, Pencil,
  Brain, Activity, Apple, Pill, Droplets, MessageSquare, Siren, Sparkles,
  Camera, Trash2, Image as ImageIcon, Eye, Moon,
} from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { useFacilityConfig } from "@/lib/useFacilityConfig";
import { ASSESSMENTS_V42_KEY, originOf, classifyAssessment, assessmentRawScore, type AssessmentV42 } from "@/lib/lifecare/assessment";
import { createRecord, updateRecord, upsertRecord, deleteRecord } from "@/lib/api";
import { recordAudit } from "@/lib/auditClient";
import { insuranceProvider } from "@/lib/integrations/insurance";
import { qrDataUrl } from "@/lib/qr";

// ── Step catalogue (required = blocks completion until satisfied) ──────────────
const STEPS = [
  { n: 1, key: "registration", label: "Registration",        icon: UserPlus,      required: true  },
  { n: 2, key: "medical",      label: "Medical Assess.",     icon: Stethoscope,   required: false },
  { n: 3, key: "care",         label: "Care Assess.",        icon: ClipboardList, required: true  },
  { n: 4, key: "insurance",    label: "Insurance Verify",    icon: ShieldCheck,   required: false },
  { n: 5, key: "room",         label: "Room & QR",           icon: BedDouble,     required: true  },
  { n: 6, key: "team",         label: "Assign Care Team",    icon: Users,         required: false },
  { n: 7, key: "plan",         label: "Care Plan",           icon: HeartPulse,    required: false },
] as const;
const STEP_COUNT = STEPS.length; // 7

const CARE_LEVELS = ["INDEPENDENT", "ASSISTED", "MEMORY", "SKILLED"];

// ── 12-domain comprehensive clinical assessment (Stage 3) ─────────────────────
// Stored migration-free as JSON inside the existing free-text `careAssessment`
// column: { __v: "clinical-12", note, domains: { <key>: { level, notes } } }.
// Each domain's option list is ordered by acuity (index 0 = lowest … 3 = highest);
// an index >= 2 counts as an "elevated" flag for the risk summary + suggested
// level of care — the missing Stage-3 → Stage-5 handoff surfaced by the audit.
const CLINICAL_DOMAINS = [
  { key: "clinical",      label: "Clinical Status",      icon: Stethoscope,   hint: "Primary diagnoses, active conditions",   options: ["Stable", "Monitored", "Unstable", "Critical"] },
  { key: "adl",           label: "ADL / IADL",           icon: ClipboardList, hint: "Bathing, dressing, toileting, feeding",   options: ["Independent", "Supervision", "Partial Assist", "Full Assist"] },
  { key: "cognitive",     label: "Cognitive",            icon: Brain,         hint: "Orientation, memory, decision-making",    options: ["Intact", "Mild", "Moderate", "Severe"] },
  { key: "mobility",      label: "Mobility / Fall Risk", icon: Activity,      hint: "Transfers, gait, fall history",          options: ["Independent", "Assistive Device", "Wheelchair", "Bedbound"] },
  { key: "nutrition",     label: "Nutrition",            icon: Apple,         hint: "Diet, swallowing, weight trend",         options: ["Normal", "Modified Diet", "At Risk", "Malnourished"] },
  { key: "medication",    label: "Medication",           icon: Pill,          hint: "Polypharmacy, high-alert meds",          options: ["None", "Simple", "Complex", "High-Risk"] },
  { key: "behavioral",    label: "Behavioral",           icon: AlertTriangle, hint: "Agitation, wandering, aggression",       options: ["None", "Occasional", "Frequent", "Severe"] },
  { key: "psychosocial",  label: "Psychosocial",         icon: Users,         hint: "Mood, isolation, family support",        options: ["Stable", "Mild Concern", "At Risk", "High Concern"] },
  { key: "continence",    label: "Continence",           icon: Droplets,      hint: "Bladder & bowel management",             options: ["Continent", "Occasional", "Incontinent", "Catheter / Ostomy"] },
  { key: "skin",          label: "Skin / Wound",         icon: ShieldCheck,   hint: "Braden risk, existing wounds",           options: ["Intact", "At Risk", "Wound Present", "Pressure Injury"] },
  { key: "communication", label: "Communication",        icon: MessageSquare, hint: "Sensory & language barriers",            options: ["No Barrier", "Hearing", "Vision", "Speech / Language"] },
  { key: "emergency",     label: "Emergency Risk",       icon: Siren,         hint: "Elopement, code status, allergy alerts", options: ["Low", "Moderate", "High", "Critical"] },
  { key: "sleep",         label: "Sleep / Daily Routine", icon: Moon,         hint: "Sleep quality, day-night pattern",       options: ["Normal", "Occasional Disturbance", "Frequent Disturbance", "Severe Disruption"] },
  { key: "therapy",       label: "Reablement / Therapy",  icon: HeartPulse,   hint: "PT / OT needs, rehab potential",         options: ["None", "Maintenance", "Active Therapy", "Intensive Rehab"] },
] as const;
// Tag kept as "clinical-12" for backward-compatible parsing of existing records;
// the instrument now captures 14 domains (aligned with the v4.2 AS-01..AS-14 set).
const CLINICAL_TAG = "clinical-12";
type DomainState = { level: string; notes: string };
type ClinicalState = Record<string, DomainState>;

// Wound / marks captured under the Skin/Wound domain — shape mirrors the Wound
// Care Tracker's record (app-setting `wound_records`) so they carry over on
// completion. Photos are downscaled JPEG data URLs.
const WOUND_KEY = "wound_records";
const WOUND_TYPES = ["Pressure Ulcer", "Surgical", "Traumatic", "Diabetic", "Skin Tear", "Bruise / Mark", "Other"];
const WOUND_STAGES = ["Stage 1", "Stage 2", "Stage 3", "Stage 4", "Unstageable", "DTI", "N/A"];
type WoundEntry = { id: string; bodyLocation: string; woundType: string; stage: string; notes: string; photo: string };

const domainIndex = (key: string, level: string): number => {
  const d = CLINICAL_DOMAINS.find((x) => x.key === key);
  return d ? (d.options as readonly string[]).indexOf(level) : -1;
};
// Tint for an option chip by acuity index: green → amber → orange → red.
const acuityTone = (i: number): string =>
  i <= 0 ? "bg-emerald-500 text-white border-emerald-500"
  : i === 1 ? "bg-amber-400 text-white border-amber-400"
  : i === 2 ? "bg-orange-500 text-white border-orange-500"
  : "bg-red-500 text-white border-red-500";
const clinicalSummary = (domains: ClinicalState) => {
  let flags = 0, filled = 0, max = 0;
  for (const d of CLINICAL_DOMAINS) {
    const lvl = domains[d.key]?.level; if (!lvl) continue;
    filled++; const i = domainIndex(d.key, lvl); if (i >= 2) flags++; if (i > max) max = i;
  }
  return { flags, filled, max };
};
// Heuristic level-of-care suggestion from the domain acuities.
const suggestLevel = (domains: ClinicalState): string => {
  const idx = (k: string) => domainIndex(k, domains[k]?.level || "");
  if (idx("clinical") >= 3 || idx("skin") >= 3 || idx("medication") >= 3 || idx("mobility") >= 3 || idx("emergency") >= 3) return "SKILLED";
  if (idx("cognitive") >= 2 || idx("behavioral") >= 2) return "MEMORY";
  const { flags, max } = clinicalSummary(domains);
  if (flags >= 1 || max >= 1) return "ASSISTED";
  return "INDEPENDENT";
};
// Serialize the free-text note + domains into the careAssessment column. Falls
// back to a plain note (or null) when no structured domain has been captured, so
// legacy free-text records keep working.
type MedRow = { id: string; name: string; dose: string; frequency: string };
const serializeClinical = (
  note: string, domains: ClinicalState, wounds: WoundEntry[] = [],
  meds: MedRow[] = [], extra: { surgeries?: string; hospitalizations?: string } = {},
): string | null => {
  const filled = Object.entries(domains).filter(([, v]) => v && (v.level || (v.notes || "").trim()));
  const hasWounds = Array.isArray(wounds) && wounds.length > 0;
  const cleanMeds = (meds || []).filter((m) => m.name.trim());
  const surgeries = (extra.surgeries || "").trim();
  const hospitalizations = (extra.hospitalizations || "").trim();
  const hasExtra = cleanMeds.length > 0 || !!surgeries || !!hospitalizations;
  if (!filled.length && !hasWounds && !hasExtra) return note.trim() || null;
  return JSON.stringify({
    __v: CLINICAL_TAG, note: note.trim() || undefined, domains: Object.fromEntries(filled),
    ...(hasWounds ? { wounds } : {}),
    ...(cleanMeds.length ? { medications: cleanMeds } : {}),
    ...(surgeries ? { surgeries } : {}),
    ...(hospitalizations ? { hospitalizations } : {}),
  });
};
const parseClinical = (raw: string): { note: string; domains: ClinicalState; wounds: WoundEntry[]; meds: MedRow[]; surgeries: string; hospitalizations: string } => {
  const t = (raw || "").trim();
  if (t.startsWith("{")) {
    try {
      const o = JSON.parse(t);
      if (o && o.__v === CLINICAL_TAG) return {
        note: String(o.note ?? ""), domains: (o.domains || {}) as ClinicalState,
        wounds: Array.isArray(o.wounds) ? (o.wounds as WoundEntry[]) : [],
        meds: Array.isArray(o.medications) ? (o.medications as MedRow[]) : [],
        surgeries: String(o.surgeries ?? ""), hospitalizations: String(o.hospitalizations ?? ""),
      };
    } catch { /* not structured */ }
  }
  return { note: t, domains: {}, wounds: [], meds: [], surgeries: "", hospitalizations: "" };
};

// ── Carry-forward: seed a Care Acuity assessment (Stage 5) on completion ───────
// On admission completion the 12-domain screen seeds a PENDING_NURSE record into
// the CareAcuityBoard's own store (`acuity_assessments`), so it surfaces there for
// nurse review — closing the Stage-3 → Stage-5 handoff without touching the board.
const ACUITY_KEY = "acuity_assessments";
// admission 12-domain key → CareAcuityBoard's 10-domain key (skin / communication /
// emergency have no 1:1 acuity domain, so they ride only in the free-text note).
const ACUITY_DOMAIN_MAP: Record<string, string> = {
  clinical: "medical", adl: "adl", cognitive: "cognition", mobility: "mobility",
  nutrition: "nutrition", medication: "medication", behavioral: "behavior",
  psychosocial: "psychosocial", continence: "elimination",
};
// admission acuity index (0..3, four levels) → acuity board score (0..5, six levels).
const IDX_TO_SCORE = [0, 2, 3, 5];
const ACUITY_LEVELS = [
  { n: 1, name: "Independent Living Plus", min: 0, max: 10 },
  { n: 2, name: "Assisted Living", min: 11, max: 20 },
  { n: 3, name: "Enhanced Assisted Care", min: 21, max: 30 },
  { n: 4, name: "Memory / Comprehensive Care", min: 31, max: 40 },
  { n: 5, name: "Skilled / Complex Care", min: 41, max: 50 },
];
const newId = () => globalThis.crypto?.randomUUID?.() ?? `ac-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const parseArr = (raw: unknown): Record<string, unknown>[] => {
  try { const v = JSON.parse(String(raw ?? "") || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
};
// The authoritative level of care is the resident's careLevel (set from the
// pre-admission level). The acuity board keys off the assessment's stored `level`,
// so seed it from careLevel — NOT from the lossy 12-domain→10-domain re-mapping,
// which under-counts (only 9 of 10 domains map). ASSISTED represents both L2 & L3,
// so it seeds as L2 (the base assisted tier), matching the pre-admission badge.
const CARELEVEL_TO_LEVEL: Record<string, number> = { INDEPENDENT: 1, ASSISTED: 2, MEMORY: 4, SKILLED: 5 };
// Build the PENDING_NURSE acuity record from the captured domains (null if nothing
// mappable was assessed). `note` carries the skin/communication/emergency detail.
// `careLevel` fixes the level; `totalOverride` (the pre-admission total) keeps the
// header Score consistent with that level.
const buildSeedAcuity = (residentId: string, domains: ClinicalState, note: string, createdBy: string, careLevel = "", totalOverride?: number) => {
  const scores: Record<string, number> = {};
  for (const key of Object.keys(ACUITY_DOMAIN_MAP)) {
    const lvl = domains[key]?.level; if (!lvl) continue;
    const i = domainIndex(key, lvl); if (i < 0) continue;
    scores[ACUITY_DOMAIN_MAP[key]] = IDX_TO_SCORE[i] ?? 0;
  }
  if (!Object.keys(scores).length) return null;
  const mappedTotal = Object.values(scores).reduce((a, b) => a + b, 0);
  const total = typeof totalOverride === "number" && totalOverride > 0 ? totalOverride : mappedTotal;
  const levelN = CARELEVEL_TO_LEVEL[careLevel] ?? (ACUITY_LEVELS.find((l) => total >= l.min && total <= l.max)?.n ?? 1);
  const lvl = ACUITY_LEVELS.find((l) => l.n === levelN) ?? ACUITY_LEVELS[0];
  const extra = ["skin", "communication", "emergency"]
    .map((k) => (domains[k]?.level ? `${CLINICAL_DOMAINS.find((d) => d.key === k)?.label}: ${domains[k].level}` : ""))
    .filter(Boolean).join(" · ");
  return {
    id: newId(), residentId, scores, total, level: lvl.n, levelName: lvl.name,
    trigger: "Admission",
    notes: ["Seeded from admission 12-domain clinical assessment — review & adjust.", extra, note.trim()].filter(Boolean).join("\n"),
    status: "PENDING_NURSE", createdBy, createdAt: new Date().toISOString(),
  };
};

// Downscale an image file to a JPEG data URL (keeps the careAssessment JSON small).
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
const woundInp = "w-full px-2.5 py-1.5 border border-gray-200 rounded-lg bg-white text-gray-900 text-xs outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent";

// Wound / Marks capture embedded in the Skin/Wound domain card. Mirrors the Wound
// Care Tracker's add form (location, type, stage, notes, photo upload / take-photo).
function SkinWoundSection({ wounds, onChange }: { wounds: WoundEntry[]; onChange: (next: WoundEntry[]) => void }) {
  const blank: WoundEntry = { id: "", bodyLocation: "", woundType: WOUND_TYPES[0], stage: "", notes: "", photo: "" };
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<WoundEntry>(blank);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  const pickPhoto = async (file?: File | null) => {
    if (!file) return;
    setBusy(true);
    try { const url = await toDataUrl(file); setDraft((d) => ({ ...d, photo: url })); } catch { /* ignore */ } finally { setBusy(false); }
  };
  const add = () => {
    if (!draft.bodyLocation.trim() && !draft.photo && !draft.notes.trim()) return;
    onChange([{ ...draft, id: newId() }, ...wounds]);
    setDraft(blank); setAdding(false);
  };

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Wound / Marks Record{wounds.length ? ` (${wounds.length})` : ""}</span>
        {!adding && <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 hover:text-amber-700"><Plus className="w-3.5 h-3.5" /> Add wound / mark</button>}
      </div>

      {wounds.length > 0 && (
        <div className="space-y-2 mb-2">
          {wounds.map((w) => (
            <div key={w.id} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {w.photo ? <img src={w.photo} alt="wound" className="h-10 w-10 rounded object-cover border border-gray-200" /> : <span className="h-10 w-10 rounded bg-gray-100 flex items-center justify-center text-gray-300"><ImageIcon className="w-4 h-4" /></span>}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-gray-800 truncate">{w.bodyLocation || "Unspecified location"}</p>
                <p className="text-[11px] text-gray-400 truncate">{[w.woundType, w.stage].filter(Boolean).join(" · ") || "—"}{w.notes ? ` — ${w.notes}` : ""}</p>
              </div>
              <button type="button" onClick={() => onChange(wounds.filter((x) => x.id !== w.id))} className="p-1 text-gray-300 hover:text-red-500" aria-label="Remove"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input value={draft.bodyLocation} onChange={(e) => setDraft((d) => ({ ...d, bodyLocation: e.target.value }))} placeholder="Body location (e.g. Sacrum)" className={woundInp} />
            <select value={draft.woundType} onChange={(e) => setDraft((d) => ({ ...d, woundType: e.target.value }))} className={woundInp}>{WOUND_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            <select value={draft.stage} onChange={(e) => setDraft((d) => ({ ...d, stage: e.target.value }))} className={woundInp}><option value="">Stage / severity…</option>{WOUND_STAGES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            <input value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} placeholder="Notes" className={woundInp} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickPhoto(e.target.files?.[0])} />
            <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pickPhoto(e.target.files?.[0])} />
            <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"><ImageIcon className="w-3.5 h-3.5" /> Upload</button>
            <button type="button" onClick={() => camRef.current?.click()} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"><Camera className="w-3.5 h-3.5" /> Take photo</button>
            {busy && <span className="text-[11px] text-gray-400">Processing…</span>}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {draft.photo && <img src={draft.photo} alt="preview" className="h-9 w-9 rounded object-cover border border-gray-200" />}
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={() => { setAdding(false); setDraft(blank); }} className="text-[11px] font-semibold text-gray-500">Cancel</button>
              <button type="button" onClick={add} className="rounded-lg bg-amber-500 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-amber-600">Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Prefill an admission from a completed Pre-Admission Assessment (Stage 2 → 3)
// The pre-admission form (app-setting `preadmission_assessments`) already captured
// demographics, medical history and 6 scored domains — pull them in so the
// registrar doesn't re-key everything, and map the scores onto the 14 domains.
const PREADMIT_KEY = "preadmission_assessments";
const PA_DOMAIN_MAP: { pa: string; max: number; dom: string }[] = [
  { pa: "adl", max: 12, dom: "adl" },
  { pa: "mobility", max: 6, dom: "mobility" },
  { pa: "continence", max: 4, dom: "continence" },
  { pa: "cognition", max: 8, dom: "cognitive" },
  { pa: "nursing", max: 8, dom: "clinical" },
  { pa: "risk", max: 12, dom: "emergency" },
];
// Map the v4.2 assessment's 14 scored domains (AS-01..AS-14, each 0-4) onto the
// wizard's clinical-domain keys. AS-02 + AS-03 both feed "mobility" (kept: higher).
const V42_DOMAIN_MAP: { as: string; dom: string }[] = [
  { as: "AS-01", dom: "adl" }, { as: "AS-02", dom: "mobility" }, { as: "AS-03", dom: "mobility" },
  { as: "AS-04", dom: "cognitive" }, { as: "AS-05", dom: "behavioral" }, { as: "AS-06", dom: "clinical" },
  { as: "AS-07", dom: "medication" }, { as: "AS-08", dom: "nutrition" }, { as: "AS-09", dom: "communication" },
  { as: "AS-10", dom: "continence" }, { as: "AS-11", dom: "skin" }, { as: "AS-12", dom: "sleep" },
  { as: "AS-13", dom: "emergency" }, { as: "AS-14", dom: "therapy" },
];
// Normalize a domain sub-score (0..max) into the 4-level acuity index (0..3).
const scoreIdx = (score: unknown, max: number) => (max ? Math.max(0, Math.min(3, Math.round(((Number(score) || 0) / max) * 3))) : 0);
// Pre-admission stores DOB as YYYY-MM-DD or M/D/YYYY; the wizard input needs YYYY-MM-DD.
const normDOB = (v: unknown) => {
  const t = String(v ?? "").trim(); if (!t) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = new Date(t); return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
};
const paLevel = (p: Record<string, unknown>) => Number(p.overrideLevel) || Number((p.scores as Record<string, unknown> | undefined)?.level) || 0;

type Row = Record<string, unknown>;
type TeamMember = { id: string; name: string; role: string; userId?: string };

const s = (v: unknown) => (v == null ? "" : String(v));
const parseCompleted = (v: unknown): number[] => {
  try { const a = JSON.parse(s(v) || "[]"); return Array.isArray(a) ? a.map(Number) : []; }
  catch { return []; }
};
const parseTeam = (v: unknown): TeamMember[] => {
  try { const a = JSON.parse(s(v) || "[]"); return Array.isArray(a) ? a : []; }
  catch { return []; }
};

const emptyForm = {
  firstName: "", lastName: "", dateOfBirth: "", gender: "", phone: "", email: "",
  emergencyContact: "", emergencyContactPhone: "",
  sponsorName: "", sponsorEmail: "",
  medicalAssessment: "", allergies: "", medicalHistory: "", surgeries: "", hospitalizations: "",
  careAssessment: "", careLevel: "", mobility: "",
  insuranceProvider: "", insurancePolicyNumber: "", insuranceVerified: false, insuranceVerifiedAt: "",
  roomNumber: "", qrPayload: "",
  careTeam: "[]", carePlan: "", carePlanGoals: "",
};
type Form = typeof emptyForm & { id?: string; completedSteps?: string; status?: string };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}
const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none text-sm";

export default function AdmissionsContent() {
  const { data: admissionRows, loading, refetch } = useLiveQuery<Row>("admissions", { tables: ["Admission"] });
  const { data: staffRows } = useLiveQuery<Row>("staff", { query: "include=user", tables: ["Staff"] });
  const { data: residentRows } = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const { data: userRows } = useLiveQuery<Row>("users", { tables: ["User"] });
  const { data: settingRows } = useLiveQuery<Row>("app-settings", { tables: ["AppSetting"] });
  // Completed pre-admission assessments available to prefill a new admission from.
  const preadmits = useMemo(
    () => parseArr(settingRows.find((r) => (r.key ?? r.id) === PREADMIT_KEY)?.value)
      .filter((p) => String(p.residentName ?? "").trim())
      .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))),
    [settingRows]
  );
  // v4.2 pre-admission assessments (the current instrument). Only PREADMISSION-origin
  // records that are completed/validated are offered as a prefill source.
  const preadmitsV42 = useMemo<AssessmentV42[]>(
    () => (parseArr(settingRows.find((r) => (r.key ?? r.id) === ASSESSMENTS_V42_KEY)?.value) as unknown as AssessmentV42[])
      .filter((a) => originOf(a) !== "ACUITY")
      .filter((a) => a.status === "COMPLETED" || a.status === "VALIDATED")
      .filter((a) => String(a.layer1?.residentName ?? "").trim())
      .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))),
    [settingRows]
  );

  const staffOptions = useMemo<TeamMember[]>(
    () => staffRows.map((r) => {
      const user = r.user as { name?: string } | undefined;
      return { id: s(r.id), name: user?.name ?? "Staff", role: s(r.position), userId: s(r.userId) };
    }),
    [staffRows]
  );

  const [wizardOpen, setWizardOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [selectedAdmission, setSelectedAdmission] = useState<Row | null>(null);
  const [editView, setEditView] = useState(false);
  const [viewSaving, setViewSaving] = useState(false);
  const [form, setForm] = useState<Form>({ ...emptyForm });
  const [clinical, setClinical] = useState<ClinicalState>({});
  const [skinWounds, setSkinWounds] = useState<WoundEntry[]>([]);
  // Pre-admission total (0–50) captured on prefill, so the seeded acuity's Score
  // matches its level. Null when the assessment was entered manually.
  const [prefillTotal, setPrefillTotal] = useState<number | null>(null);
  const [medList, setMedList] = useState<MedRow[]>([]);
  const addMed = () => setMedList((l) => [...l, { id: newId(), name: "", dose: "", frequency: "" }]);
  const patchMed = (mid: string, patch: Partial<MedRow>) => setMedList((l) => l.map((m) => (m.id === mid ? { ...m, ...patch } : m)));
  const removeMed = (mid: string) => setMedList((l) => l.filter((m) => m.id !== mid));
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED">("all");

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  // Stage 2 → Stage 3 handoff: pull a completed pre-admission assessment into the
  // wizard (demographics, medical history, care level + the 14 domains).
  // v4.2 pre-admission → wizard prefill (demographics, medical history, care level
  // and the 14 clinical domains derived from the AS-01..AS-14 scores).
  const prefillFromV42 = async (id: string) => {
    const a = preadmitsV42.find((x) => s(x.id) === id);
    if (!a) return;
    const name = s(a.layer1?.residentName);
    const c = await Swal.fire({
      title: "Prefill from pre-admission?",
      text: `Populate this admission with ${name || "the assessment"}'s v4.2 pre-admission data? Matching fields already entered will be overwritten.`,
      icon: "question", showCancelButton: true, confirmButtonColor: "#d97706", confirmButtonText: "Prefill",
    });
    if (!c.isConfirmed) return;

    const parts = name.trim().split(/\s+/);
    const firstName = parts.shift() || "";
    const lastName = parts.join(" ");
    const lvlStr = s(a.layer3?.finalLevel) || s(classifyAssessment({ domains: a.domains ?? {}, context: a.context ?? {} }).suggestedLevel);
    const lvl = Number(lvlStr.match(/([1-5])/)?.[1] || 0);
    const careLevel = lvl === 1 ? "INDEPENDENT" : lvl === 4 ? "MEMORY" : lvl === 5 ? "SKILLED" : lvl ? "ASSISTED" : "";
    setPrefillTotal(assessmentRawScore({ domains: a.domains ?? {} }) || null);

    const scores = (a.domains ?? {}) as Record<string, { score?: number } | undefined>;
    const nextClinical: ClinicalState = {};
    for (const mp of V42_DOMAIN_MAP) {
      const raw = scores[mp.as]?.score;
      if (raw == null) continue;
      const dom = CLINICAL_DOMAINS.find((d) => d.key === mp.dom); if (!dom) continue;
      const idx = scoreIdx(raw, 4);
      const cur = nextClinical[mp.dom];
      const curIdx = cur ? (dom.options as readonly string[]).indexOf(cur.level) : -1;
      if (idx > curIdx) nextClinical[mp.dom] = { level: dom.options[idx], notes: "" }; // AS-02+AS-03 → mobility: keep higher
    }
    setClinical(nextClinical);

    const meds = s(a.layer1?.medications);
    const medRows: MedRow[] = meds
      ? meds.split(/[\n;,]+/).map((x) => x.trim()).filter(Boolean).map((nm) => ({ id: newId(), name: nm, dose: "", frequency: "" }))
      : [];
    setMedList(medRows);

    set({
      firstName: firstName || form.firstName,
      lastName: lastName || form.lastName,
      dateOfBirth: normDOB(a.layer1?.dateOfBirth) || form.dateOfBirth,
      gender: s(a.layer1?.sex) || form.gender,
      phone: s(a.layer1?.contactNo) || form.phone,
      emergencyContact: s(a.layer1?.primaryContact) || form.emergencyContact,
      allergies: s(a.layer1?.allergies) || form.allergies,
      medicalHistory: s(a.layer1?.diagnoses) || form.medicalHistory,
      medicalAssessment: s(a.layer1?.reasonForAdmission) || form.medicalAssessment,
      surgeries: s(a.layer1?.surgeries) || form.surgeries,
      hospitalizations: [a.layer1?.hospitalEd12mo ? "ED / hospital in last 12 months" : "", s(a.layer1?.hospitalEdReason)].filter(Boolean).join(" — ") || form.hospitalizations,
      careAssessment: s(a.layer1?.reasonForAdmission) || form.careAssessment,
      careLevel: careLevel || form.careLevel,
    });
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Prefilled from pre-admission", showConfirmButton: false, timer: 1600 });
  };

  const prefillFromPreadmission = async (paId: string) => {
    if (paId.startsWith("v42:")) { await prefillFromV42(paId.slice(4)); return; }
    const pa = preadmits.find((p) => s(p.id) === paId);
    if (!pa) return;
    const c = await Swal.fire({
      title: "Prefill from pre-admission?",
      text: `Populate this admission with ${s(pa.residentName) || "the assessment"}'s pre-admission data? Matching fields already entered will be overwritten.`,
      icon: "question", showCancelButton: true, confirmButtonColor: "#d97706", confirmButtonText: "Prefill",
    });
    if (!c.isConfirmed) return;

    const parts = s(pa.residentName).trim().split(/\s+/);
    const firstName = parts.shift() || "";
    const lastName = parts.join(" ");
    const sc = (pa.scores || {}) as Record<string, unknown>;
    const lvl = paLevel(pa);
    const careLevel = lvl === 1 ? "INDEPENDENT" : lvl === 4 ? "MEMORY" : lvl === 5 ? "SKILLED" : lvl ? "ASSISTED" : "";
    setPrefillTotal(Number(sc.total) || null);

    const nextClinical: ClinicalState = {};
    for (const mp of PA_DOMAIN_MAP) {
      if (sc[mp.pa] == null) continue;
      const dom = CLINICAL_DOMAINS.find((d) => d.key === mp.dom); if (!dom) continue;
      nextClinical[mp.dom] = { level: dom.options[scoreIdx(sc[mp.pa], mp.max)], notes: "" };
    }
    setClinical(nextClinical);

    const others = Array.isArray(pa.otherConditions) ? (pa.otherConditions as string[]) : [];
    const meds = s(pa.currentMedications);
    // Split the free-text current-medications blob into structured rows the nurse
    // can refine; each becomes an ACTIVE Medication on completion.
    const medRows: MedRow[] = meds
      ? meds.split(/[\n;,]+/).map((x) => x.trim()).filter(Boolean).map((nm) => ({ id: newId(), name: nm, dose: "", frequency: "" }))
      : [];
    setMedList(medRows);

    // Flatten the pre-admission's structured Individualized Care Plan (problem →
    // goal → interventions → frequency → responsible) into the wizard's Step 7
    // free-text fields, so the plan authored during screening carries over.
    const cp = pa.carePlan as { problems?: unknown } | undefined;
    const problems = (Array.isArray(cp?.problems) ? cp!.problems : []) as Record<string, unknown>[];
    const carePlanText = problems.map((p) => {
      const iv = Array.isArray(p.interventions) ? (p.interventions as unknown[]).map((x) => s(x)).filter(Boolean).join("; ") : "";
      const meta = [s(p.frequency) && `Frequency: ${s(p.frequency)}`, s(p.responsible) && `Responsible: ${s(p.responsible)}`].filter(Boolean).join(" · ");
      return [`[${s(p.domain) || "General"}] ${s(p.problem)}`.trim(), iv && `  Interventions: ${iv}`, meta && `  ${meta}`].filter(Boolean).join("\n");
    }).join("\n\n");
    const goalsText = problems.map((p) => [`[${s(p.domain) || "General"}] ${s(p.goal)}`.trim(), s(p.expectedOutcome) && `— Expected: ${s(p.expectedOutcome)}`].filter(Boolean).join(" ")).filter((l) => l.replace(/\[[^\]]*\]/, "").trim()).join("\n");

    set({
      firstName: firstName || form.firstName,
      lastName: lastName || form.lastName,
      dateOfBirth: normDOB(pa.dateOfBirth) || form.dateOfBirth,
      gender: s(pa.sex) || form.gender,
      phone: s(pa.contactNo) || form.phone,
      emergencyContact: s(pa.primaryContact) || form.emergencyContact,
      allergies: s(pa.allergies) || form.allergies,
      medicalHistory: [s(pa.primaryDiagnosis), s(pa.secondaryDiagnosis), ...others].filter(Boolean).join("; ") || form.medicalHistory,
      medicalAssessment: s(pa.clinicalConcerns) || form.medicalAssessment,
      surgeries: s(pa.previousSurgeries) || form.surgeries,
      hospitalizations: [pa.hospitalized12mo ? "Hospitalized in last 12 months" : "", s(pa.hospitalizationReason)].filter(Boolean).join(" — ") || form.hospitalizations,
      careAssessment: s(pa.reasonForAdmission) || s(pa.clinicalJustification) || form.careAssessment,
      careLevel: careLevel || form.careLevel,
      carePlan: carePlanText || form.carePlan,
      carePlanGoals: goalsText || form.carePlanGoals,
    });
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Prefilled from pre-admission", showConfirmButton: false, timer: 1600 });
  };

  // Rooms already taken by residents or by other in-progress admissions.
  const occupiedRooms = useMemo(() => {
    const taken = new Set<string>();
    const fullName = `${form.firstName} ${form.lastName}`.trim().toLowerCase();
    residentRows.forEach((r) => {
      if (!r.roomNumber) return;
      // A resident's own room isn't "taken" when re-admitting that same person.
      if (fullName && `${s(r.firstName)} ${s(r.lastName)}`.trim().toLowerCase() === fullName) return;
      taken.add(s(r.roomNumber));
    });
    admissionRows.forEach((a) => {
      if (s(a.id) !== s(form.id) && s(a.status) !== "CANCELLED" && a.roomNumber) taken.add(s(a.roomNumber));
    });
    return taken;
  }, [residentRows, admissionRows, form.id, form.firstName, form.lastName]);

  const { data: roomRows } = useLiveQuery<Record<string, unknown>>(
    "rooms", { query: "take=200", tables: ["Room"] }
  );
  const allRooms = useMemo(() => roomRows.map((r) => s(r.roomNumber)).filter(Boolean), [roomRows]);
  const availableRooms = useMemo(
    () => allRooms.filter((r) => !occupiedRooms.has(r) || r === form.roomNumber),
    [allRooms, occupiedRooms, form.roomNumber]
  );

  const openNew = () => { setForm({ ...emptyForm }); setClinical({}); setSkinWounds([]); setMedList([]); setPrefillTotal(null); setStep(1); setVerifyMsg(""); setWizardOpen(true); };

  const openView = (row: Row) => {
    setSelectedAdmission(row);
    setEditView(false);
    setViewOpen(true);
  };
  const openViewEdit = (row: Row) => {
    setSelectedAdmission(row);
    setEditView(true);
    setViewOpen(true);
  };

  // Look up the resident's existing medication names so a re-save doesn't create
  // duplicate meds (only genuinely new ones are added).
  const existingMedNames = async (rid: string): Promise<Set<string>> => {
    try {
      const r = await fetch(`/api/db/medications?f_residentId=${rid}&take=300`, { credentials: "include" });
      if (!r.ok) return new Set();
      const j = await r.json();
      return new Set(((j?.data as Row[]) || []).map((m) => s(m.name).trim().toLowerCase()).filter(Boolean));
    } catch { return new Set(); }
  };

  // Save the editable detail view → update the Admission AND sync profile/medical
  // fields + new medications onto the linked resident (so the rcard reflects it).
  const saveAdmissionEdit = async (row: Row, data: { admission: Row; residentSync: Row; meds: MedRow[] }) => {
    setViewSaving(true);
    try {
      await updateRecord("admissions", s(row.id), data.admission);
      let rid = s(row.residentId);
      if (!rid) {
        const fullName = `${s(data.residentSync.firstName)} ${s(data.residentSync.lastName)}`.trim().toLowerCase();
        const match = residentRows.find((r) => s(r.roomNumber) === s(data.residentSync.roomNumber) && `${s(r.firstName)} ${s(r.lastName)}`.trim().toLowerCase() === fullName);
        rid = s(match?.id);
        if (rid) await updateRecord("admissions", s(row.id), { residentId: rid });
      }
      if (rid) {
        await updateRecord("residents", rid, data.residentSync);
        const existing = await existingMedNames(rid);
        const toCreate = data.meds.filter((m) => m.name.trim() && !existing.has(m.name.trim().toLowerCase()));
        if (toCreate.length) {
          const startDate = new Date().toISOString();
          await Promise.all(toCreate.map((m) => createRecord("medications", {
            residentId: rid, name: m.name.trim(), dosage: m.dose.trim() || "—", frequency: m.frequency.trim() || "—",
            route: "oral", status: "ACTIVE", startDate, prescribedBy: `${s(data.residentSync.firstName)} ${s(data.residentSync.lastName)} (Admission)`,
          }).catch(() => null)));
        }
      }
      await refetch();
      setViewOpen(false);
      setEditView(false);
      Swal.fire({ toast: true, position: "top-end", icon: "success", title: rid ? "Saved · synced to resident card" : "Saved (no linked resident found)", showConfirmButton: false, timer: 2400 });
    } catch (err) {
      Swal.fire({ title: "Could not save", text: err instanceof Error ? err.message : "Update failed.", icon: "error" });
    } finally {
      setViewSaving(false);
    }
  };

  const openExisting = (row: Row) => {
    const parsedCA = parseClinical(s(row.careAssessment));
    setClinical(parsedCA.domains);
    setSkinWounds(parsedCA.wounds);
    setMedList(parsedCA.meds);
    setForm({
      id: s(row.id),
      firstName: s(row.firstName), lastName: s(row.lastName),
      dateOfBirth: row.dateOfBirth ? s(row.dateOfBirth).slice(0, 10) : "",
      gender: s(row.gender), phone: s(row.phone), email: s(row.email),
      emergencyContact: s(row.emergencyContact), emergencyContactPhone: s(row.emergencyContactPhone),
      sponsorName: s(row.sponsorName), sponsorEmail: s(row.sponsorEmail),
      medicalAssessment: s(row.medicalAssessment), allergies: s(row.allergies), medicalHistory: s(row.medicalHistory),
      surgeries: parsedCA.surgeries, hospitalizations: parsedCA.hospitalizations,
      careAssessment: parsedCA.note, careLevel: s(row.careLevel), mobility: s(row.mobility),
      insuranceProvider: s(row.insuranceProvider), insurancePolicyNumber: s(row.insurancePolicyNumber),
      insuranceVerified: Boolean(row.insuranceVerified), insuranceVerifiedAt: s(row.insuranceVerifiedAt),
      roomNumber: s(row.roomNumber), qrPayload: s(row.qrPayload),
      careTeam: s(row.careTeam) || "[]", carePlan: s(row.carePlan), carePlanGoals: s(row.carePlanGoals),
      completedSteps: s(row.completedSteps) || "[]", status: s(row.status),
    });
    setStep(Math.min(Math.max(Number(row.currentStep) || 1, 1), STEP_COUNT));
    setVerifyMsg("");
    setWizardOpen(true);
  };

  const buildPayload = (extra: Row = {}): Row => ({
    firstName: form.firstName, lastName: form.lastName,
    dateOfBirth: form.dateOfBirth ? new Date(form.dateOfBirth).toISOString() : null,
    gender: form.gender || null, phone: form.phone || null, email: form.email || null,
    emergencyContact: form.emergencyContact || null, emergencyContactPhone: form.emergencyContactPhone || null,
    sponsorName: form.sponsorName || null, sponsorEmail: form.sponsorEmail || null,
    medicalAssessment: form.medicalAssessment || null, allergies: form.allergies || null, medicalHistory: form.medicalHistory || null,
    careAssessment: serializeClinical(form.careAssessment, clinical, skinWounds, medList, { surgeries: form.surgeries, hospitalizations: form.hospitalizations }), careLevel: form.careLevel || null, mobility: form.mobility || null,
    insuranceProvider: form.insuranceProvider || null, insurancePolicyNumber: form.insurancePolicyNumber || null,
    insuranceVerified: form.insuranceVerified, insuranceVerifiedAt: form.insuranceVerifiedAt || null,
    roomNumber: form.roomNumber || null, qrPayload: form.qrPayload || null,
    careTeam: form.careTeam || "[]", carePlan: form.carePlan || null, carePlanGoals: form.carePlanGoals || null,
    ...extra,
  });

  // Per-step required-field guard. Returns a message when the step can't be
  // left, or null when it's satisfied. Required steps: 1 (name), 3 (care level),
  // 5 (room). Empty rooms and occupied rooms are both blocked.
  const stepError = (n: number): string | null => {
    if (n === 1 && (!form.firstName.trim() || !form.lastName.trim()))
      return "First and last name are required to register.";
    if (n === 3 && !form.careLevel) return "Select a care level before continuing.";
    if (n === 5) {
      if (!form.roomNumber) return "Assign a room before continuing.";
      if (occupiedRooms.has(form.roomNumber)) return `Room ${form.roomNumber} is already taken.`;
    }
    return null;
  };

  // Forward stepper navigation is gated: a step is only reachable once every
  // required step before it is satisfied. Going back (target <= current) is
  // always allowed so staff can review/edit earlier steps.
  const canNavigateTo = (target: number): boolean => {
    if (target <= step) return true;
    for (let n = 1; n < target; n++) if (stepError(n)) return false;
    return true;
  };

  const saveStep = async (advance: boolean): Promise<string | undefined> => {
    // Block continuing past a step whose required fields aren't filled.
    // A plain Save (draft) is allowed to be partial, except step 1 — the
    // admission record can't be created without a name.
    if (advance) {
      const err = stepError(step);
      if (err) {
        Swal.fire({ title: "Complete this step", text: err, icon: "warning" });
        return;
      }
    } else if (step === 1 && (!form.firstName.trim() || !form.lastName.trim())) {
      Swal.fire({ title: "Name required", text: "First and last name are required to register.", icon: "warning" });
      return;
    }
    setSaving(true);
    try {
      const completed = new Set(parseCompleted(form.completedSteps));
      completed.add(step);
      const completedSteps = JSON.stringify([...completed].sort((a, b) => a - b));
      const nextStep = advance ? Math.min(step + 1, STEP_COUNT) : step;
      const payload = buildPayload({ completedSteps, currentStep: nextStep });

      let id = form.id;
      if (!id) {
        const res = await createRecord("admissions", payload);
        id = s((res.data as Row)?.id);
      } else {
        await updateRecord("admissions", id, payload);
      }
      await refetch();
      setForm((f) => ({ ...f, id, completedSteps }));
      if (advance) setStep(nextStep);
      return id;
    } catch (err) {
      Swal.fire({ title: "Save failed", text: err instanceof Error ? err.message : "Could not save this step.", icon: "error" });
    } finally {
      setSaving(false);
    }
  };

  const runVerify = async () => {
    if (!form.insuranceProvider.trim() || !form.insurancePolicyNumber.trim()) {
      setVerifyMsg("Enter a provider and policy number first.");
      return;
    }
    setVerifying(true);
    try {
      const r = await insuranceProvider.verify({
        provider: form.insuranceProvider, policyNumber: form.insurancePolicyNumber,
        firstName: form.firstName, lastName: form.lastName,
      });
      set({ insuranceVerified: r.verified, insuranceVerifiedAt: r.verified ? r.verifiedAt : "" });
      setVerifyMsg(r.message + (r.reference ? ` (Ref ${r.reference})` : ""));
    } finally {
      setVerifying(false);
    }
  };

  // Auto-assign the first available room when the resident reaches Step 5 and
  // none has been picked yet. Staff can still change it via the dropdown.
  useEffect(() => {
    if (step === 5 && !form.roomNumber && availableRooms.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      set({ roomNumber: availableRooms[0] });
    }
  }, [step, form.roomNumber, availableRooms]);

  // Auto-generate a unique QR payload when the resident reaches Step 5 and has an ID.
  useEffect(() => {
    if (step === 5 && !form.qrPayload && form.id) {
      const payload = `GH-RES-${form.id.slice(0, 8)}`;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      set({ qrPayload: payload });
    }
  }, [step, form.qrPayload, form.id]);

  // QR download / print helpers.
  const downloadQr = useCallback(() => {
    if (!form.qrPayload) return;
    const link = document.createElement("a");
    link.href = qrDataUrl(form.qrPayload, { size: 400 });
    link.download = `QR-${form.firstName || "resident"}-${form.lastName || ""}.svg`;
    link.click();
  }, [form.qrPayload, form.firstName, form.lastName]);

  const printQr = useCallback(() => {
    if (!form.qrPayload) return;
    const src = qrDataUrl(form.qrPayload, { size: 300 });
    const w = window.open("", "_blank", "width=400,height=500");
    if (!w) return;
    w.document.write(
      `<html><head><title>Wristband — ${form.firstName} ${form.lastName}</title>` +
      `<style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;margin:0}` +
      `img{margin:16px 0}p{font-size:14px;color:#333}</style></head>` +
      `<body><p><b>${form.firstName} ${form.lastName}</b></p>` +
      `<img src="${src}" width="300" height="300" />` +
      `<p>${form.qrPayload}</p></body></html>`
    );
    w.document.close();
    w.onload = () => { w.print(); w.close(); };
  }, [form.qrPayload, form.firstName, form.lastName]);

  const toggleTeam = (m: TeamMember) => {
    const team = parseTeam(form.careTeam);
    const exists = team.find((t) => t.id === m.id);
    const next = exists ? team.filter((t) => t.id !== m.id) : [...team, m];
    set({ careTeam: JSON.stringify(next) });
  };

  // Missing requirements block completion (precision guardrail).
  const missing = useMemo(() => {
    const m: string[] = [];
    if (!form.firstName.trim() || !form.lastName.trim()) m.push("resident name");
    if (!form.careLevel) m.push("care level");
    if (!form.roomNumber) m.push("room assignment");
    return m;
  }, [form.firstName, form.lastName, form.careLevel, form.roomNumber]);

  const cancelAdmission = async (id: string) => {
    const c = await Swal.fire({ title: "Cancel admission?", text: "This marks the onboarding as cancelled.", icon: "warning", showCancelButton: true, confirmButtonColor: "#ef4444", confirmButtonText: "Cancel admission" });
    if (!c.isConfirmed) return;
    await updateRecord("admissions", id, { status: "CANCELLED" });
    await refetch();
    setWizardOpen(false);
  };

  // Permanently remove an onboarding record (does NOT touch a resident already
  // created from it — that lives in the Resident Directory).
  const deleteAdmission = async (id: string, name: string) => {
    const c = await Swal.fire({ title: "Delete admission?", html: `Permanently delete <b>${name || "this admission"}</b>'s onboarding record? This can't be undone.`, icon: "warning", showCancelButton: true, confirmButtonColor: "#ef4444", confirmButtonText: "Delete" });
    if (!c.isConfirmed) return;
    try {
      await deleteRecord("admissions", id);
      await refetch();
      Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Admission deleted", showConfirmButton: false, timer: 1500 });
    } catch (e) { Swal.fire({ title: "Delete failed", text: e instanceof Error ? e.message : "Could not delete.", icon: "error" }); }
  };

  // Resolve (find-or-create) the FAMILY sponsor user, return its id.
  const resolveSponsorId = async (): Promise<string | undefined> => {
    const email = form.sponsorEmail.trim().toLowerCase();
    if (!email) return undefined;
    const existing = userRows.find((u) => s(u.email).toLowerCase() === email);
    if (existing) return s(existing.id);
    try {
      const res = await createRecord("users", {
        email, name: form.sponsorName.trim() || `${form.firstName} ${form.lastName} (Family)`, role: "FAMILY",
      });
      return s((res.data as Row)?.id);
    } catch {
      return undefined; // non-fatal; resident still created
    }
  };

  const completeAdmission = async () => {
    if (missing.length) {
      Swal.fire({ title: "Not ready to complete", html: `Please provide: <b>${missing.join(", ")}</b>.`, icon: "warning" });
      return;
    }
    const id = (await saveStep(false)) ?? form.id;
    const confirm = await Swal.fire({
      title: "Complete Admission?",
      text: `This creates the resident record for ${form.firstName} ${form.lastName}.`,
      icon: "question", showCancelButton: true, confirmButtonColor: "#16a34a", confirmButtonText: "Complete",
    });
    if (!confirm.isConfirmed) return;
    setSaving(true);
    try {
      const sponsorId = await resolveSponsorId();
      let seededAcuity = false;
      const residentPayload: Row = {
        firstName: form.firstName, lastName: form.lastName,
        dateOfBirth: form.dateOfBirth ? new Date(form.dateOfBirth).toISOString() : null,
        gender: form.gender || null, phone: form.phone || null, email: form.email || null,
        roomNumber: form.roomNumber,
        careLevel: form.careLevel,
        admissionDate: new Date().toISOString(),
        emergencyContact: form.emergencyContact || null, emergencyContactPhone: form.emergencyContactPhone || null,
        allergies: form.allergies || null, medicalHistory: form.medicalHistory || null,
        surgeries: form.surgeries || null, hospitalizations: form.hospitalizations || null,
        notes: form.carePlan || null,
        ...(sponsorId ? { sponsorId } : {}),
      };
      // Re-admitting someone who already has a resident profile (same name + room)
      // UPDATES that profile instead of creating a duplicate; otherwise create new.
      const fullName = `${form.firstName} ${form.lastName}`.trim().toLowerCase();
      const existingResident = residentRows.find((r) => s(r.roomNumber) === form.roomNumber && `${s(r.firstName)} ${s(r.lastName)}`.trim().toLowerCase() === fullName);
      let residentId = "";
      if (existingResident) {
        await updateRecord("residents", s(existingResident.id), residentPayload);
        residentId = s(existingResident.id);
      } else {
        const res = await createRecord("residents", residentPayload);
        residentId = s((res.data as Row)?.id);
      }
      // Never mark the admission COMPLETED if the resident profile didn't persist —
      // surface it instead of silently orphaning the admission (residentId null).
      if (!residentId) throw new Error("Resident profile could not be saved — the room may already be assigned to a different resident.");

      // Handoff: notify the assigned care team + create an onboarding task.
      const team = parseTeam(form.careTeam);
      await Promise.all(
        team.filter((t) => t.userId).map((t) =>
          createRecord("notifications", {
            userId: t.userId, type: "TASK_ASSIGNMENT",
            title: "New resident assigned",
            message: `${form.firstName} ${form.lastName} (Room ${form.roomNumber}) has been admitted to your care.`,
            relatedEntityId: residentId, relatedEntityType: "Resident",
          }).catch(() => null)
        )
      );
      if (residentId) {
        await createRecord("tasks", {
          residentId, title: `Welcome & orientation — ${form.firstName} ${form.lastName}`,
          description: "Complete move-in orientation and initial care-plan review.",
          status: "PENDING", priority: "HIGH",
          dueDate: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
          assignedToId: team[0]?.id || null,
        }).catch(() => null);

        // Carry current medications forward as ACTIVE Medication records so they
        // surface on the resident card, the MAR and medication inventory.
        const cleanMeds = medList.filter((mm) => mm.name.trim());
        if (cleanMeds.length) {
          const startDate = new Date().toISOString();
          await Promise.all(cleanMeds.map((mm) =>
            createRecord("medications", {
              residentId, name: mm.name.trim(), dosage: mm.dose.trim() || "—", frequency: mm.frequency.trim() || "—",
              route: "oral", status: "ACTIVE", startDate,
              prescribedBy: `${form.firstName} ${form.lastName} (Admission)`,
            }).catch(() => null)
          ));
        }

        // Carry the 12-domain assessment forward: seed a PENDING_NURSE acuity
        // record so it surfaces on the Care Acuity board for validation. Best-effort.
        const seed = buildSeedAcuity(residentId, clinical, form.careAssessment, `${form.firstName} ${form.lastName} (Admission)`, form.careLevel, prefillTotal ?? undefined);
        if (seed) {
          try {
            const existing = parseArr(settingRows.find((r) => (r.key ?? r.id) === ACUITY_KEY)?.value);
            await upsertRecord("app-settings", ACUITY_KEY, { key: ACUITY_KEY, value: JSON.stringify([seed, ...existing]) });
            seededAcuity = true;
          } catch { /* non-fatal — resident already created */ }
        }

        // Carry Skin/Wound entries into the Wound Care Tracker (`wound_records`).
        if (skinWounds.length) {
          try {
            const now = new Date().toISOString();
            const woundRecs = skinWounds.map((w) => ({
              id: w.id || newId(), residentId, woundType: w.woundType || "Other", stage: w.stage || "",
              bodyLocation: w.bodyLocation || "", discoveredAt: now, discoveredBy: `${form.firstName} ${form.lastName} (Admission)`,
              notes: w.notes || "", status: "Active", photo: w.photo || "", createdAt: now, updatedAt: now,
            }));
            const existingW = parseArr(settingRows.find((r) => (r.key ?? r.id) === WOUND_KEY)?.value);
            await upsertRecord("app-settings", WOUND_KEY, { key: WOUND_KEY, value: JSON.stringify([...woundRecs, ...existingW]) });
          } catch { /* non-fatal */ }
        }
      }

      if (id) {
        await updateRecord("admissions", id, {
          residentId: residentId || null, sponsorId: sponsorId || null, status: "COMPLETED",
          completedSteps: JSON.stringify(Array.from({ length: STEP_COUNT }, (_, i) => i + 1)), currentStep: STEP_COUNT,
        });
      }
      recordAudit({
        action: "CREATE",
        entityType: "admissions",
        entityId: residentId || id || newId(),
        residentId: residentId || undefined,
        residentName: `${form.firstName} ${form.lastName}`.trim(),
        reason: `Admitted ${form.firstName} ${form.lastName} as a resident${seededAcuity ? " (care-acuity assessment seeded for nurse review)" : ""}`,
      });
      await refetch();
      setWizardOpen(false);
      Swal.fire({ title: "Admission Complete", text: `${form.firstName} ${form.lastName} is now a resident.${seededAcuity ? " A care-acuity assessment is pending nurse review." : ""}`, icon: "success", timer: 2300, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Could not complete", text: err instanceof Error ? err.message : "Resident creation failed (room may be taken).", icon: "error" });
    } finally {
      setSaving(false);
    }
  };

  // ── List view ────────────────────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  const filtered = admissionRows
    .filter((a) => statusFilter === "all" || s(a.status) === statusFilter)
    .filter((a) => !q || `${s(a.firstName)} ${s(a.lastName)}`.toLowerCase().includes(q) || s(a.roomNumber).toLowerCase().includes(q));
  const count = (st: string) => admissionRows.filter((a) => s(a.status) === st).length;

  const doneSet = new Set(parseCompleted(form.completedSteps));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-amber-500 to-yellow-600 bg-clip-text text-transparent">Admissions &amp; Onboarding</h1>
          <p className="text-gray-600 text-sm mt-1 flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live</span>
            {STEP_COUNT}-step resident onboarding pipeline
          </p>
        </div>
        <button onClick={openNew} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-yellow-600 text-white font-semibold hover:shadow-lg transition self-start">
          <Plus className="w-4 h-4" /> New Admission
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <Stat label="In Progress" value={count("IN_PROGRESS")} tone="amber" />
        <Stat label="Completed" value={count("COMPLETED")} tone="green" />
        <Stat label="Cancelled" value={count("CANCELLED")} tone="gray" />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden bg-white text-sm">
          {(["all", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const).map((f) => (
            <button key={f} onClick={() => setStatusFilter(f)} className={`px-3 py-2 font-medium transition ${statusFilter === f ? "bg-amber-500 text-white" : "text-gray-700 hover:bg-gray-50"}`}>
              {f === "all" ? "All" : f === "IN_PROGRESS" ? "In Progress" : f[0] + f.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or room…" className={`${inputCls} pl-10`} />
        </div>
      </div>

      {/* List */}
      {loading && admissionRows.length === 0 ? (
        <div className="flex items-center justify-center py-10 text-gray-500"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading admissions…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">No admissions match. Click <b>New Admission</b> to start onboarding.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((a) => {
            const done = parseCompleted(a.completedSteps).length;
            const st = s(a.status);
            const isDone = st === "COMPLETED";
            const isCancelled = st === "CANCELLED";
            const cur = STEPS.find((x) => x.n === (Number(a.currentStep) || 1));
            const badge = isDone ? "bg-green-100 text-green-700" : isCancelled ? "bg-gray-200 text-gray-600" : "bg-amber-100 text-amber-700";
            return (
              <div key={s(a.id)} className="bg-white rounded-xl border border-gray-200 p-5 hover:border-amber-300 hover:shadow-md transition">
                <button onClick={() => openView(a)} className="w-full text-left">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-bold text-gray-900">{s(a.firstName)} {s(a.lastName)}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${badge}`}>{isDone ? "Completed" : isCancelled ? "Cancelled" : "In Progress"}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {a.roomNumber ? `Room ${s(a.roomNumber)} • ` : ""}{isDone ? "Onboarded" : isCancelled ? "Cancelled" : `Next: ${cur?.label ?? "Registration"}`}
                  </p>
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-1"><span>Progress</span><span>{done}/{STEP_COUNT}</span></div>
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className={`h-full ${isDone ? "bg-green-500" : isCancelled ? "bg-gray-400" : "bg-amber-500"} transition-all`} style={{ width: `${(done / STEP_COUNT) * 100}%` }} />
                    </div>
                  </div>
                </button>
                <div className="mt-3 flex items-center justify-end gap-1 border-t border-gray-100 pt-2.5">
                  <button onClick={() => openView(a)} title="View" className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100 transition"><Eye className="w-4 h-4" /> View</button>
                  <button onClick={() => (s(a.status) === "COMPLETED" ? openViewEdit(a) : openExisting(a))} title="Edit" className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-amber-600 hover:bg-amber-50 transition"><Pencil className="w-4 h-4" /> Edit</button>
                  <button onClick={() => deleteAdmission(s(a.id), `${s(a.firstName)} ${s(a.lastName)}`.trim())} title="Delete" className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition"><Trash2 className="w-4 h-4" /> Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Wizard modal */}
      {wizardOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-amber-500 to-orange-600 text-white px-6 pt-4 pb-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/20 text-base font-bold ring-2 ring-white/40">
                    {`${form.firstName?.[0] ?? ""}${form.lastName?.[0] ?? ""}`.toUpperCase() || <UserPlus className="h-5 w-5" />}
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-xl font-bold">{form.firstName || form.lastName ? `${form.firstName} ${form.lastName}`.trim() : "New Admission"}</h2>
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-white">
                      <span className="inline-flex items-center rounded-full bg-white/25 px-2 py-0.5 text-[11px] font-bold tabular-nums">Step {step} / {STEP_COUNT}</span>
                      <span className="font-medium">{STEPS[step - 1].label}</span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {form.id && form.status !== "COMPLETED" && (
                    <button onClick={() => cancelAdmission(form.id!)} title="Cancel admission" className="rounded-lg p-2 text-white/90 transition hover:bg-white/15 hover:text-white"><Ban className="h-5 w-5" /></button>
                  )}
                  <button onClick={() => setWizardOpen(false)} title="Close" className="rounded-lg p-2 text-white/90 transition hover:bg-white/15 hover:text-white"><X className="h-5 w-5" /></button>
                </div>
              </div>
              {/* overall completion */}
              <div className="mt-3.5 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/25">
                  <div className="h-full rounded-full bg-white transition-all duration-300" style={{ width: `${(doneSet.size / STEP_COUNT) * 100}%` }} />
                </div>
                <span className="text-[11px] font-semibold tabular-nums text-white">{doneSet.size}/{STEP_COUNT} complete</span>
              </div>
            </div>

            {/* Stepper */}
            <div className="flex items-start border-b border-gray-100 bg-gray-50/60 px-4 py-4 overflow-x-auto">
              {STEPS.map((st, idx) => {
                const isDone = doneSet.has(st.n);
                const active = st.n === step;
                const reachable = canNavigateTo(st.n);
                const Icon = st.icon;
                const leftFilled = idx > 0 && doneSet.has(STEPS[idx - 1].n);
                const rightFilled = isDone;
                return (
                  <div key={st.n} className="relative flex min-w-[72px] flex-1 flex-col items-center">
                    {/* connectors between nodes (centered on the 8×8 node → top-4) */}
                    {idx > 0 && <span className="absolute right-1/2 top-4 h-0.5 w-full" style={{ backgroundColor: leftFilled ? "#22c55e" : "#e5e7eb" }} />}
                    {idx < STEPS.length - 1 && <span className="absolute left-1/2 top-4 h-0.5 w-full" style={{ backgroundColor: rightFilled ? "#22c55e" : "#e5e7eb" }} />}
                    <button
                      onClick={() => reachable && setStep(st.n)}
                      disabled={!reachable}
                      title={reachable ? st.label : "Fill in the required fields on the earlier steps first."}
                      className={`group relative z-10 flex w-full flex-col items-center gap-1.5 px-1 ${reachable ? "" : "cursor-not-allowed"}`}
                    >
                      <span className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold shadow-sm transition ${active ? "scale-110 border-amber-500 bg-amber-500 text-white ring-4 ring-amber-500/20" : isDone ? "border-green-500 bg-green-500 text-white" : reachable ? "border-gray-300 bg-white text-gray-600 group-hover:border-amber-400 group-hover:text-amber-500" : "border-gray-200 bg-white text-gray-400"}`}>
                        {isDone && !active ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                      </span>
                      <span className={`text-center text-[10px] leading-tight ${active ? "font-bold text-amber-600" : isDone ? "font-medium text-gray-600" : "text-gray-400"}`}>
                        {st.label}{st.required && <span className="text-red-500">*</span>}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto flex-1">
              {step === 1 && (
                <div className="space-y-4">
                  {(preadmits.length > 0 || preadmitsV42.length > 0) && (
                    <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Sparkles className="w-4 h-4 text-indigo-500" />
                        <span className="text-xs font-semibold text-indigo-800">Prefill from a Pre-Admission Assessment</span>
                      </div>
                      <select value="" onChange={(e) => { const v = e.target.value; if (v) prefillFromPreadmission(v); }} className={`${inputCls} mt-2`}>
                        <option value="">Select a completed pre-admission assessment…</option>
                        {preadmitsV42.length > 0 && (
                          <optgroup label="Resident Assessment (v4.2)">
                            {preadmitsV42.map((a) => { const lvl = s(a.layer3?.finalLevel); const dt = s(a.layer1?.assessmentDate) || s(a.updatedAt).slice(0, 10); return (
                              <option key={`v42:${s(a.id)}`} value={`v42:${s(a.id)}`}>{s(a.layer1?.residentName)}{lvl ? ` — ${lvl}` : ""}{dt ? ` · ${dt}` : ""}</option>
                            ); })}
                          </optgroup>
                        )}
                        {preadmits.length > 0 && (
                          <optgroup label="Legacy Pre-Admission">
                            {preadmits.map((p) => { const lvl = paLevel(p); return (
                              <option key={s(p.id)} value={s(p.id)}>{s(p.residentName)}{lvl ? ` — Level ${lvl}` : ""}{p.dateOfAssessment ? ` · ${s(p.dateOfAssessment)}` : ""}</option>
                            ); })}
                          </optgroup>
                        )}
                      </select>
                      <p className="text-[11px] text-indigo-600/80 mt-1.5">Pulls name, DOB, contact, diagnoses, allergies, care level, the 14-domain assessment &amp; the care plan. Review before completing.</p>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="First Name *"><input className={inputCls} value={form.firstName} onChange={(e) => set({ firstName: e.target.value })} /></Field>
                    <Field label="Last Name *"><input className={inputCls} value={form.lastName} onChange={(e) => set({ lastName: e.target.value })} /></Field>
                    <Field label="Date of Birth"><input type="date" className={inputCls} value={form.dateOfBirth} onChange={(e) => set({ dateOfBirth: e.target.value })} /></Field>
                    <Field label="Gender"><select className={inputCls} value={form.gender} onChange={(e) => set({ gender: e.target.value })}><option value="">—</option><option>Female</option><option>Male</option><option>Other</option></select></Field>
                    <Field label="Phone"><input className={inputCls} value={form.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
                    <Field label="Email"><input className={inputCls} value={form.email} onChange={(e) => set({ email: e.target.value })} /></Field>
                    <Field label="Emergency Contact"><input className={inputCls} value={form.emergencyContact} onChange={(e) => set({ emergencyContact: e.target.value })} /></Field>
                    <Field label="Emergency Phone"><input className={inputCls} value={form.emergencyContactPhone} onChange={(e) => set({ emergencyContactPhone: e.target.value })} /></Field>
                  </div>
                  <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-4">
                    <p className="text-xs font-semibold text-amber-800 mb-2">Family Sponsor (gets a scoped Family portal login)</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Field label="Sponsor Name"><input className={inputCls} value={form.sponsorName} onChange={(e) => set({ sponsorName: e.target.value })} /></Field>
                      <Field label="Sponsor Email"><input className={inputCls} value={form.sponsorEmail} onChange={(e) => set({ sponsorEmail: e.target.value })} placeholder="family@example.com" /></Field>
                    </div>
                  </div>
                </div>
              )}
              {step === 2 && (
                <div className="space-y-4">
                  <Field label="Medical Assessment"><textarea rows={4} className={inputCls} value={form.medicalAssessment} onChange={(e) => set({ medicalAssessment: e.target.value })} placeholder="Clinical findings & diagnoses (medications are listed separately below)…" /></Field>

                  {/* Structured current medications → become ACTIVE meds on the resident card + MAR */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-gray-600 flex items-center gap-1.5"><Pill className="w-3.5 h-3.5 text-amber-600" /> Medications</span>
                      <button type="button" onClick={addMed} className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:text-amber-800"><Plus className="w-3.5 h-3.5" /> Add medication</button>
                    </div>
                    {medList.length === 0 ? (
                      <p className="text-xs text-gray-500 border border-dashed border-gray-300 rounded-lg px-3 py-2">No medications added. Each one you add becomes an active medication on the resident card & MAR.</p>
                    ) : (
                      <div className="space-y-2">
                        {medList.map((m) => (
                          <div key={m.id} className="flex flex-col sm:flex-row gap-2">
                            <input className={inputCls + " sm:flex-1"} placeholder="Medication name" value={m.name} onChange={(e) => patchMed(m.id, { name: e.target.value })} />
                            <input className={inputCls + " sm:w-28"} placeholder="Dose" value={m.dose} onChange={(e) => patchMed(m.id, { dose: e.target.value })} />
                            <input className={inputCls + " sm:w-40"} placeholder="Frequency" value={m.frequency} onChange={(e) => patchMed(m.id, { frequency: e.target.value })} />
                            <button type="button" onClick={() => removeMed(m.id)} className="shrink-0 self-start px-2 py-2 rounded-lg border border-gray-300 text-gray-400 hover:text-red-600 hover:border-red-300" aria-label="Remove medication"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Allergies"><input className={inputCls} value={form.allergies} onChange={(e) => set({ allergies: e.target.value })} /></Field>
                    <Field label="Medical History"><input className={inputCls} value={form.medicalHistory} onChange={(e) => set({ medicalHistory: e.target.value })} /></Field>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Previous Surgeries"><input className={inputCls} value={form.surgeries} onChange={(e) => set({ surgeries: e.target.value })} /></Field>
                    <Field label="Hospitalizations"><input className={inputCls} value={form.hospitalizations} onChange={(e) => set({ hospitalizations: e.target.value })} /></Field>
                  </div>
                </div>
              )}
              {step === 3 && (() => {
                const sum = clinicalSummary(clinical);
                const suggestion = sum.filled >= 3 ? suggestLevel(clinical) : "";
                const setDomain = (key: string, patch: Partial<DomainState>) =>
                  setClinical((c) => ({ ...c, [key]: { level: c[key]?.level || "", notes: c[key]?.notes || "", ...patch } }));
                return (
                <div className="space-y-4">
                  {/* Risk roll-up + suggested level of care (Stage 3 → 5 handoff) */}
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <ClipboardList className="w-4 h-4 text-amber-600" />
                      <span className="font-semibold text-gray-800">{CLINICAL_DOMAINS.length}-Domain Clinical Assessment</span>
                      <span className="text-gray-500">· {sum.filled}/{CLINICAL_DOMAINS.length} assessed</span>
                      {sum.flags > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700"><AlertTriangle className="w-3 h-3" />{sum.flags} elevated</span>}
                    </div>
                    {suggestion && (
                      <div className="flex items-center gap-2 text-sm">
                        <Sparkles className="w-4 h-4 text-amber-500" />
                        <span className="text-gray-500">Suggested:</span>
                        <button type="button" onClick={() => set({ careLevel: suggestion })} className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-3 py-1 text-xs font-bold text-white hover:bg-amber-600">
                          {suggestion[0] + suggestion.slice(1).toLowerCase()}{form.careLevel !== suggestion ? " — apply" : ""}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* The 12 clinical domains */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {CLINICAL_DOMAINS.map((d) => {
                      const Icon = d.icon; const cur = clinical[d.key] || { level: "", notes: "" };
                      return (
                        <div key={d.key} className="rounded-xl border border-gray-200 bg-white p-3">
                          <div className="flex items-start gap-2 mb-2">
                            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><Icon className="w-4 h-4" /></span>
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-gray-800 leading-tight">{d.label}</p>
                              <p className="text-[11px] text-gray-400 leading-tight">{d.hint}</p>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1 mb-2">
                            {d.options.map((opt, i) => {
                              const on = cur.level === opt;
                              return (
                                <button key={opt} type="button" onClick={() => setDomain(d.key, { level: on ? "" : opt })}
                                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${on ? acuityTone(i) : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"}`}>
                                  {opt}
                                </button>
                              );
                            })}
                          </div>
                          <input value={cur.notes} onChange={(e) => setDomain(d.key, { notes: e.target.value })} placeholder="Notes (optional)…"
                            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg bg-white text-gray-900 text-xs focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none" />
                          {d.key === "skin" && <SkinWoundSection wounds={skinWounds} onChange={setSkinWounds} />}
                        </div>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Care Level *"><select className={inputCls} value={form.careLevel} onChange={(e) => set({ careLevel: e.target.value })}><option value="">—</option>{CARE_LEVELS.map((c) => <option key={c} value={c}>{c[0] + c.slice(1).toLowerCase()}</option>)}</select></Field>
                    <Field label="Mobility"><input className={inputCls} value={form.mobility} onChange={(e) => set({ mobility: e.target.value })} placeholder="Independent / Walker / Wheelchair" /></Field>
                  </div>
                  <Field label="Assessment Summary / Additional Notes"><textarea rows={3} className={inputCls} value={form.careAssessment} onChange={(e) => set({ careAssessment: e.target.value })} placeholder="Overall clinical summary, support needs, priorities…" /></Field>
                </div>
                );
              })()}
              {step === 4 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Insurance Provider"><input className={inputCls} value={form.insuranceProvider} onChange={(e) => { set({ insuranceProvider: e.target.value, insuranceVerified: false, insuranceVerifiedAt: "" }); setVerifyMsg(""); }} /></Field>
                    <Field label="Policy Number"><input className={inputCls} value={form.insurancePolicyNumber} onChange={(e) => { set({ insurancePolicyNumber: e.target.value, insuranceVerified: false, insuranceVerifiedAt: "" }); setVerifyMsg(""); }} /></Field>
                  </div>
                  <button onClick={runVerify} disabled={verifying} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">
                    {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Verify Coverage
                  </button>
                  {(verifyMsg || form.insuranceVerified) && (
                    <div className={`rounded-lg px-4 py-3 text-sm flex items-center gap-2 ${form.insuranceVerified ? "bg-green-50 text-green-800 border border-green-200" : "bg-amber-50 text-amber-800 border border-amber-200"}`}>
                      {form.insuranceVerified ? <CheckCircle2 className="w-4 h-4" /> : <CircleDot className="w-4 h-4" />} {verifyMsg || "Verified."}
                    </div>
                  )}
                </div>
              )}
              {step === 5 && (
                <div className="space-y-4">
                  <Field label="Room Assignment *">
                    <select className={inputCls} value={form.roomNumber} onChange={(e) => set({ roomNumber: e.target.value })}>
                      <option value="">Select an available room…</option>
                      {availableRooms.map((r) => <option key={r} value={r}>Room {r}</option>)}
                    </select>
                  </Field>
                  <p className="text-xs text-gray-500">A room is assigned automatically from the {availableRooms.length} available — change it above if needed. Occupied rooms are hidden.</p>

                  {/* QR Code — auto-generated, shown inline once the admission has an ID */}
                  {form.id && (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 flex flex-col items-center gap-3">
                      <p className="text-xs font-semibold text-gray-600 self-start flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> Resident QR Code (auto-generated)</p>
                      {form.qrPayload ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={qrDataUrl(form.qrPayload, { size: 160 })} alt="Resident QR code" width={160} height={160} className="rounded-lg border border-gray-200 bg-white" />
                          <code className="text-[10px] bg-gray-100 px-2 py-0.5 rounded text-gray-500">{form.qrPayload}</code>
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={downloadQr} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-white text-xs"><Download className="w-3.5 h-3.5" /> Download</button>
                            <button type="button" onClick={printQr} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-white text-xs"><Printer className="w-3.5 h-3.5" /> Print Wristband</button>
                          </div>
                        </>
                      ) : (
                        <div className="inline-flex items-center gap-2 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Generating…</div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {step === 6 && (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">Select the care team assigned to this resident. They&apos;re notified on completion.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto">
                    {staffOptions.length === 0 && <p className="text-sm text-gray-500">No staff found.</p>}
                    {staffOptions.map((m) => {
                      const selected = parseTeam(form.careTeam).some((t) => t.id === m.id);
                      return (
                        <button key={m.id} onClick={() => toggleTeam(m)} className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border text-left text-sm transition ${selected ? "border-amber-400 bg-amber-50" : "border-gray-200 hover:border-amber-200"}`}>
                          <span><span className="font-medium text-gray-900">{m.name}</span><span className="block text-xs text-gray-500">{m.role}</span></span>
                          {selected && <Check className="w-4 h-4 text-amber-600 flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {step === 7 && (
                <div className="space-y-4">
                  <Field label="Individual Care Plan"><textarea rows={4} className={inputCls} value={form.carePlan} onChange={(e) => set({ carePlan: e.target.value })} placeholder="Daily routine, interventions, preferences…" /></Field>
                  <Field label="Care Goals"><textarea rows={2} className={inputCls} value={form.carePlanGoals} onChange={(e) => set({ carePlanGoals: e.target.value })} placeholder="Measurable wellness objectives…" /></Field>
                  {missing.length > 0 ? (
                    <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Before completing, provide: <b>{missing.join(", ")}</b>.</div>
                  ) : (
                    <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">Ready — completing creates the resident{form.sponsorEmail ? ", links the family sponsor," : ""} notifies the care team, and opens an orientation task.</div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-gray-100 px-6 py-4 flex items-center justify-between bg-gray-50">
              <button onClick={() => setStep((n) => Math.max(1, n - 1))} disabled={step === 1} className="inline-flex items-center gap-1 px-4 py-2 rounded-lg text-gray-700 hover:bg-gray-100 disabled:opacity-40 text-sm font-medium"><ChevronLeft className="w-4 h-4" /> Back</button>
              <div className="flex flex-wrap items-center gap-2 justify-end">
                <button onClick={() => saveStep(false)} disabled={saving} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 text-sm font-medium disabled:opacity-60">{saving ? "Saving…" : "Save"}</button>
                {step < STEP_COUNT ? (
                  <button onClick={() => saveStep(true)} disabled={saving || !!stepError(step)} title={stepError(step) ?? ""} className="inline-flex items-center gap-1 px-5 py-2 rounded-lg bg-amber-500 text-white font-semibold hover:bg-amber-600 text-sm disabled:opacity-50 disabled:cursor-not-allowed">Save &amp; Continue <ChevronRight className="w-4 h-4" /></button>
                ) : (
                  <button onClick={completeAdmission} disabled={saving || missing.length > 0} title={missing.length ? `Missing: ${missing.join(", ")}` : ""} className="inline-flex items-center gap-1 px-5 py-2 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 text-sm disabled:opacity-50"><CheckCircle2 className="w-4 h-4" /> Complete Admission</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* View Modal */}
      {viewOpen && selectedAdmission && (() => {
        const row = selectedAdmission;
        const st = s(row.status);
        const isDone = st === "COMPLETED";
        const isCancelled = st === "CANCELLED";
        const done = parseCompleted(row.completedSteps).length;
        const badge = isDone ? "bg-green-100 text-green-700" : isCancelled ? "bg-gray-200 text-gray-600" : "bg-amber-100 text-amber-700";
        const teamList = parseTeam(row.careTeam);
        const qrPayloadStr = s(row.qrPayload);

        return (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
              {/* Header */}
              <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white px-6 py-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-11 w-11 shrink-0 rounded-full bg-white/15 ring-1 ring-white/20 flex items-center justify-center text-white font-bold text-sm">
                    {(`${s(row.firstName).charAt(0)}${s(row.lastName).charAt(0)}`).toUpperCase() || "?"}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-xl font-bold text-white truncate">{s(row.firstName)} {s(row.lastName)}</h2>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${badge}`}>
                        {isDone ? "Completed" : isCancelled ? "Cancelled" : "In Progress"}
                      </span>
                    </div>
                    <p className="text-slate-300 text-xs mt-0.5 truncate">
                      {row.roomNumber ? `Room ${s(row.roomNumber)} · ` : ""}Admission {s(row.id).slice(0, 8)} · {done}/{STEP_COUNT} steps
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 justify-end shrink-0">
                  {!isDone && !isCancelled && (
                    <button
                      onClick={() => {
                        setViewOpen(false);
                        openExisting(row);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Edit Onboarding
                    </button>
                  )}
                  {form.id && !isDone && !isCancelled && (
                    <button
                      onClick={() => {
                        cancelAdmission(s(row.id));
                      }}
                      title="Cancel Admission"
                      className="p-2 hover:bg-white/10 rounded-lg text-red-400"
                    >
                      <Ban className="w-5 h-5" />
                    </button>
                  )}
                  {isDone && !editView && (
                    <button
                      onClick={() => setEditView(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </button>
                  )}
                  <button onClick={() => setViewOpen(false)} className="p-2 hover:bg-white/10 rounded-lg"><X className="w-5 h-5" /></button>
                </div>
              </div>

              {/* Body */}
              <div className="p-6 overflow-y-auto flex-1 bg-gray-50 space-y-6">
                {editView ? (
                  <AdmissionEditForm row={row} onSave={(d) => saveAdmissionEdit(row, d)} />
                ) : (<>
                {/* Visual Progress Bar */}
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                    <span className="font-semibold text-slate-700">Onboarding Completion Progress</span>
                    <span>{Math.round((done / STEP_COUNT) * 100)}% ({done}/{STEP_COUNT} Steps)</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div className={`h-full ${isDone ? "bg-green-500" : isCancelled ? "bg-gray-400" : "bg-amber-500"} transition-all`} style={{ width: `${(done / STEP_COUNT) * 100}%` }} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Left Column: Profiles */}
                  <div className="space-y-6 md:col-span-2">
                    {/* Resident Info */}
                    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
                      <h3 className="text-sm font-bold text-slate-800 border-b border-gray-100 pb-2">Resident Profile</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="block text-xs font-semibold text-gray-500">Date of Birth</span>
                          <span className="text-gray-900">{row.dateOfBirth ? s(row.dateOfBirth).slice(0, 10) : "—"}</span>
                        </div>
                        <div>
                          <span className="block text-xs font-semibold text-gray-500">Gender</span>
                          <span className="text-gray-900">{s(row.gender) || "—"}</span>
                        </div>
                        <div>
                          <span className="block text-xs font-semibold text-gray-500">Phone</span>
                          <span className="text-gray-900">{s(row.phone) || "—"}</span>
                        </div>
                        <div>
                          <span className="block text-xs font-semibold text-gray-500">Email</span>
                          <span className="text-gray-900">{s(row.email) || "—"}</span>
                        </div>
                        <div>
                          <span className="block text-xs font-semibold text-gray-500">Emergency Contact</span>
                          <span className="text-gray-900">{s(row.emergencyContact) || "—"}</span>
                        </div>
                        <div>
                          <span className="block text-xs font-semibold text-gray-500">Emergency Phone</span>
                          <span className="text-gray-900">{s(row.emergencyContactPhone) || "—"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Sponsor Profile */}
                    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
                      <h3 className="text-sm font-bold text-slate-800 border-b border-gray-100 pb-2">Family Sponsor</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="block text-xs font-semibold text-gray-500">Sponsor Name</span>
                          <span className="text-gray-900 font-medium">{s(row.sponsorName) || "—"}</span>
                        </div>
                        <div>
                          <span className="block text-xs font-semibold text-gray-500">Sponsor Email</span>
                          <span className="text-gray-900">{s(row.sponsorEmail) || "—"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Medical Assessment Details */}
                    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
                      <h3 className="text-sm font-bold text-slate-800 border-b border-gray-100 pb-2">Medical & Clinical</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="block text-xs font-semibold text-gray-500">Allergies</span>
                          <span className="text-red-600 font-medium">{s(row.allergies) || "None reported"}</span>
                        </div>
                        <div>
                          <span className="block text-xs font-semibold text-gray-500">Medical History</span>
                          <span className="text-gray-900">{s(row.medicalHistory) || "—"}</span>
                        </div>
                        <div className="sm:col-span-2">
                          <span className="block text-xs font-semibold text-gray-500">Clinical Assessment Notes</span>
                          <p className="text-gray-700 bg-gray-50 rounded-lg p-3 text-xs mt-1 whitespace-pre-line border border-gray-100">
                            {s(row.medicalAssessment) || "No assessment notes recorded."}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Care Assessment Details */}
                    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
                      <h3 className="text-sm font-bold text-slate-800 border-b border-gray-100 pb-2">Care & Onboarding Profile</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="block text-xs font-semibold text-gray-500">Care Level</span>
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 mt-1">
                            {s(row.careLevel) || "PENDING"}
                          </span>
                        </div>
                        <div>
                          <span className="block text-xs font-semibold text-gray-500">Mobility Status</span>
                          <span className="text-gray-900">{s(row.mobility) || "—"}</span>
                        </div>
                        <div className="sm:col-span-2">
                          <span className="block text-xs font-semibold text-gray-500">Clinical Assessment ({CLINICAL_DOMAINS.length} domains)</span>
                          {(() => {
                            const { note, domains, wounds } = parseClinical(s(row.careAssessment));
                            const entries = CLINICAL_DOMAINS.filter((d) => domains[d.key]?.level || (domains[d.key]?.notes || "").trim());
                            if (!entries.length && !wounds.length) return <p className="text-gray-700 bg-gray-50 rounded-lg p-3 text-xs mt-1 whitespace-pre-line border border-gray-100">{note || "No clinical assessment recorded."}</p>;
                            return (
                              <div className="mt-1 space-y-2">
                                {entries.length > 0 && (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {entries.map((d) => {
                                      const cur = domains[d.key]; const i = domainIndex(d.key, cur.level);
                                      return (
                                        <div key={d.key} className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="text-xs font-semibold text-gray-700">{d.label}</span>
                                            {cur.level && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${acuityTone(i)}`}>{cur.level}</span>}
                                          </div>
                                          {cur.notes && <p className="text-[11px] text-gray-500 mt-1">{cur.notes}</p>}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                                {wounds.length > 0 && (
                                  <div>
                                    <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Wound / Marks ({wounds.length})</span>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                                      {wounds.map((w) => (
                                        <div key={w.id} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 p-2">
                                          {/* eslint-disable-next-line @next/next/no-img-element */}
                                          {w.photo ? <img src={w.photo} alt="wound" className="h-10 w-10 rounded object-cover border border-gray-200" /> : <span className="h-10 w-10 rounded bg-gray-100 flex items-center justify-center text-gray-300"><ImageIcon className="w-4 h-4" /></span>}
                                          <div className="min-w-0">
                                            <p className="text-xs font-semibold text-gray-800 truncate">{w.bodyLocation || "Unspecified location"}</p>
                                            <p className="text-[11px] text-gray-400 truncate">{[w.woundType, w.stage].filter(Boolean).join(" · ") || "—"}{w.notes ? ` — ${w.notes}` : ""}</p>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {note && <p className="text-gray-700 bg-gray-50 rounded-lg p-3 text-xs whitespace-pre-line border border-gray-100">{note}</p>}
                              </div>
                            );
                          })()}
                        </div>
                        <div className="sm:col-span-2">
                          <span className="block text-xs font-semibold text-gray-500">Individual Care Plan</span>
                          <p className="text-gray-700 bg-gray-50 rounded-lg p-3 text-xs mt-1 whitespace-pre-line border border-gray-100">
                            {s(row.carePlan) || "No care plan details set."}
                          </p>
                        </div>
                        <div className="sm:col-span-2">
                          <span className="block text-xs font-semibold text-gray-500">Measurable Goals</span>
                          <p className="text-gray-700 bg-gray-50 rounded-lg p-3 text-xs mt-1 whitespace-pre-line border border-gray-100">
                            {s(row.carePlanGoals) || "No wellness goals specified."}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Room, Insurance, QR, Care Team */}
                  <div className="space-y-6">
                    {/* Room Assignment & QR */}
                    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
                      <h3 className="text-sm font-bold text-slate-800 border-b border-gray-100 pb-2">Room & Identifiers</h3>
                      <div>
                        <span className="block text-xs font-semibold text-gray-500">Assigned Room</span>
                        <span className="text-lg font-bold text-amber-600">{row.roomNumber ? `Room ${s(row.roomNumber)}` : "Not assigned"}</span>
                      </div>

                      {qrPayloadStr && (
                        <div className="border-t border-gray-100 pt-4 flex flex-col items-center gap-3">
                          <span className="text-xs font-semibold text-gray-500 self-start">Wristband QR Code</span>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={qrDataUrl(qrPayloadStr, { size: 160 })} alt="Resident QR code" width={160} height={160} className="rounded-lg border border-gray-200 bg-white" />
                          <code className="text-[10px] bg-gray-100 px-2 py-0.5 rounded text-gray-500">{qrPayloadStr}</code>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const link = document.createElement("a");
                                link.href = qrDataUrl(qrPayloadStr, { size: 400 });
                                link.download = `QR-${row.firstName || "resident"}-${row.lastName || ""}.svg`;
                                link.click();
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-xs"
                            >
                              <Download className="w-3.5 h-3.5" /> Download
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const src = qrDataUrl(qrPayloadStr, { size: 300 });
                                const w = window.open("", "_blank", "width=400,height=500");
                                if (!w) return;
                                w.document.write(
                                  `<html><head><title>Wristband — ${row.firstName} ${row.lastName}</title>` +
                                  `<style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;margin:0}</style></head>` +
                                  `<body><p><b>${row.firstName} ${row.lastName}</b></p><img src="${src}" width="300" height="300" /><p>${qrPayloadStr}</p></body></html>`
                                );
                                w.document.close();
                                w.onload = () => { w.print(); w.close(); };
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-xs"
                            >
                              <Printer className="w-3.5 h-3.5" /> Print
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Insurance Coverage */}
                    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
                      <h3 className="text-sm font-bold text-slate-800 border-b border-gray-100 pb-2">Insurance Coverage</h3>
                      <div>
                        <span className="block text-xs font-semibold text-gray-500">Provider</span>
                        <span className="text-sm text-gray-900 font-medium">{s(row.insuranceProvider) || "—"}</span>
                      </div>
                      <div>
                        <span className="block text-xs font-semibold text-gray-500">Policy Number</span>
                        <span className="text-sm text-gray-900">{s(row.insurancePolicyNumber) || "—"}</span>
                      </div>
                      <div className="border-t border-gray-100 pt-3">
                        <span className="block text-xs font-semibold text-gray-500 mb-1">Status</span>
                        {row.insuranceVerified ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-50 px-2.5 py-1 rounded-lg border border-green-200">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Verified
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
                            <CircleDot className="w-3.5 h-3.5" /> Unverified / Pending
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Assigned Care Team */}
                    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
                      <h3 className="text-sm font-bold text-slate-800 border-b border-gray-100 pb-2">Care Team</h3>
                      {teamList.length === 0 ? (
                        <p className="text-xs text-gray-500">No care team assigned yet.</p>
                      ) : (
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {teamList.map((m) => (
                            <div key={m.id} className="p-2 bg-slate-50 rounded-lg border border-gray-100 text-xs">
                              <p className="font-semibold text-slate-800">{m.name}</p>
                              <p className="text-slate-500 text-[10px] mt-0.5">{m.role}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                </>)}
              </div>

              {/* Footer */}
              <div className="border-t border-gray-100 px-6 py-4 flex flex-wrap items-center justify-end bg-gray-50 gap-2">
                {editView ? (
                  <>
                    <button type="button" onClick={() => setEditView(false)} disabled={viewSaving} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 text-sm font-medium disabled:opacity-50">Cancel</button>
                    <button type="submit" form="admission-edit-form" disabled={viewSaving} className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold shadow-sm transition disabled:opacity-50">{viewSaving ? "Saving…" : "Save changes"}</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setViewOpen(false)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 text-sm font-medium">Close</button>
                    {!isDone && !isCancelled && (
                      <button onClick={() => { setViewOpen(false); openExisting(row); }} className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold shadow-sm transition">
                        <Pencil className="w-4 h-4" /> Edit Onboarding
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// Editable version of the admission detail card. Saving updates the Admission and
// (via the parent) syncs profile/medical fields + new medications to the resident.
function AdmissionEditForm({ row, onSave }: {
  row: Row;
  onSave: (data: { admission: Row; residentSync: Row; meds: MedRow[] }) => void;
}) {
  const g = (k: string) => s(row[k]);
  const ca = parseClinical(g("careAssessment"));
  const [firstName, setFirstName] = useState(g("firstName"));
  const [lastName, setLastName] = useState(g("lastName"));
  const [dateOfBirth, setDateOfBirth] = useState(g("dateOfBirth") ? g("dateOfBirth").slice(0, 10) : "");
  const [gender, setGender] = useState(g("gender"));
  const [phone, setPhone] = useState(g("phone"));
  const [email, setEmail] = useState(g("email"));
  const [emergencyContact, setEmergencyContact] = useState(g("emergencyContact"));
  const [emergencyContactPhone, setEmergencyContactPhone] = useState(g("emergencyContactPhone"));
  const [sponsorName, setSponsorName] = useState(g("sponsorName"));
  const [sponsorEmail, setSponsorEmail] = useState(g("sponsorEmail"));
  const [allergies, setAllergies] = useState(g("allergies"));
  const [medicalHistory, setMedicalHistory] = useState(g("medicalHistory"));
  const [medicalAssessment, setMedicalAssessment] = useState(g("medicalAssessment"));
  const [surgeries, setSurgeries] = useState(ca.surgeries);
  const [hospitalizations, setHospitalizations] = useState(ca.hospitalizations);
  const [careLevel, setCareLevel] = useState(g("careLevel"));
  const [mobility, setMobility] = useState(g("mobility"));
  const [roomNumber, setRoomNumber] = useState(g("roomNumber"));
  const [insuranceProvider, setInsuranceProvider] = useState(g("insuranceProvider"));
  const [insurancePolicyNumber, setInsurancePolicyNumber] = useState(g("insurancePolicyNumber"));
  const [carePlan, setCarePlan] = useState(g("carePlan"));
  const [carePlanGoals, setCarePlanGoals] = useState(g("carePlanGoals"));
  const [meds, setMeds] = useState<MedRow[]>(ca.meds);
  const addM = () => setMeds((l) => [...l, { id: newId(), name: "", dose: "", frequency: "" }]);
  const patchM = (mid: string, patch: Partial<MedRow>) => setMeds((l) => l.map((m) => (m.id === mid ? { ...m, ...patch } : m)));
  const rmM = (mid: string) => setMeds((l) => l.filter((m) => m.id !== mid));
  const CARE_LEVELS = ["INDEPENDENT", "ASSISTED", "MEMORY", "SKILLED"];

  const submit = () => {
    if (!firstName.trim() || !lastName.trim()) { Swal.fire({ title: "First and last name are required", icon: "warning" }); return; }
    const dob = dateOfBirth ? new Date(dateOfBirth).toISOString() : null;
    const admission: Row = {
      firstName: firstName.trim(), lastName: lastName.trim(), dateOfBirth: dob,
      gender: gender || null, phone: phone || null, email: email || null,
      emergencyContact: emergencyContact || null, emergencyContactPhone: emergencyContactPhone || null,
      sponsorName: sponsorName || null, sponsorEmail: sponsorEmail || null,
      allergies: allergies || null, medicalHistory: medicalHistory || null, medicalAssessment: medicalAssessment || null,
      careLevel: careLevel || null, mobility: mobility || null, roomNumber: roomNumber || null,
      insuranceProvider: insuranceProvider || null, insurancePolicyNumber: insurancePolicyNumber || null,
      carePlan: carePlan || null, carePlanGoals: carePlanGoals || null,
      careAssessment: serializeClinical(ca.note, ca.domains, ca.wounds, meds, { surgeries, hospitalizations }),
    };
    // NOTE: medicalAssessment/diagnosis are NOT Resident columns — they live on the
    // Admission and the rcard reads them from there.
    const residentSync: Row = {
      firstName: firstName.trim(), lastName: lastName.trim(), dateOfBirth: dob,
      gender: gender || null, phone: phone || null, email: email || null,
      emergencyContact: emergencyContact || null, emergencyContactPhone: emergencyContactPhone || null,
      allergies: allergies || null, medicalHistory: medicalHistory || null,
      surgeries: surgeries || null, hospitalizations: hospitalizations || null,
      roomNumber: roomNumber || null, careLevel: careLevel || null,
    };
    onSave({ admission, residentSync, meds });
  };

  return (
    <form id="admission-edit-form" onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-5">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
        Editing this admission — saving updates the record and syncs the profile, medical details &amp; new medications to the resident card.
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h3 className="text-sm font-bold text-slate-800 border-b border-gray-100 pb-2">Resident Profile</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="First Name"><input className={inputCls} value={firstName} onChange={(e) => setFirstName(e.target.value)} /></Field>
          <Field label="Last Name"><input className={inputCls} value={lastName} onChange={(e) => setLastName(e.target.value)} /></Field>
          <Field label="Date of Birth"><input type="date" className={inputCls} value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} /></Field>
          <Field label="Gender"><input className={inputCls} value={gender} onChange={(e) => setGender(e.target.value)} /></Field>
          <Field label="Phone"><input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="Email"><input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Emergency Contact"><input className={inputCls} value={emergencyContact} onChange={(e) => setEmergencyContact(e.target.value)} /></Field>
          <Field label="Emergency Phone"><input className={inputCls} value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)} /></Field>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h3 className="text-sm font-bold text-slate-800 border-b border-gray-100 pb-2">Family Sponsor</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Sponsor Name"><input className={inputCls} value={sponsorName} onChange={(e) => setSponsorName(e.target.value)} /></Field>
          <Field label="Sponsor Email"><input className={inputCls} value={sponsorEmail} onChange={(e) => setSponsorEmail(e.target.value)} /></Field>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h3 className="text-sm font-bold text-slate-800 border-b border-gray-100 pb-2">Medical &amp; Clinical</h3>
        <Field label="Medical Assessment"><textarea rows={3} className={inputCls} value={medicalAssessment} onChange={(e) => setMedicalAssessment(e.target.value)} placeholder="Clinical findings & diagnoses…" /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Allergies"><input className={inputCls} value={allergies} onChange={(e) => setAllergies(e.target.value)} /></Field>
          <Field label="Medical History"><input className={inputCls} value={medicalHistory} onChange={(e) => setMedicalHistory(e.target.value)} /></Field>
          <Field label="Previous Surgeries"><input className={inputCls} value={surgeries} onChange={(e) => setSurgeries(e.target.value)} /></Field>
          <Field label="Hospitalizations"><input className={inputCls} value={hospitalizations} onChange={(e) => setHospitalizations(e.target.value)} /></Field>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <div className="flex items-center justify-between border-b border-gray-100 pb-2">
          <h3 className="text-sm font-bold text-slate-800">Medications</h3>
          <button type="button" onClick={addM} className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:text-amber-800"><Plus className="w-3.5 h-3.5" /> Add medication</button>
        </div>
        {meds.length === 0 ? (
          <p className="text-xs text-gray-500">No medications. New ones you add are created on the resident&apos;s MAR (existing ones aren&apos;t duplicated).</p>
        ) : (
          <div className="space-y-2">
            {meds.map((m) => (
              <div key={m.id} className="flex flex-col sm:flex-row gap-2">
                <input className={inputCls + " sm:flex-1"} placeholder="Medication name" value={m.name} onChange={(e) => patchM(m.id, { name: e.target.value })} />
                <input className={inputCls + " sm:w-28"} placeholder="Dose" value={m.dose} onChange={(e) => patchM(m.id, { dose: e.target.value })} />
                <input className={inputCls + " sm:w-40"} placeholder="Frequency" value={m.frequency} onChange={(e) => patchM(m.id, { frequency: e.target.value })} />
                <button type="button" onClick={() => rmM(m.id)} className="shrink-0 self-start px-2 py-2 rounded-lg border border-gray-300 text-gray-400 hover:text-red-600 hover:border-red-300"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h3 className="text-sm font-bold text-slate-800 border-b border-gray-100 pb-2">Care &amp; Room</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Care Level"><select className={inputCls} value={careLevel} onChange={(e) => setCareLevel(e.target.value)}><option value="">—</option>{CARE_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
          <Field label="Mobility Status"><input className={inputCls} value={mobility} onChange={(e) => setMobility(e.target.value)} /></Field>
          <Field label="Assigned Room"><input className={inputCls} value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} /></Field>
        </div>
        <Field label="Individual Care Plan"><textarea rows={3} className={inputCls} value={carePlan} onChange={(e) => setCarePlan(e.target.value)} /></Field>
        <Field label="Measurable Goals"><textarea rows={2} className={inputCls} value={carePlanGoals} onChange={(e) => setCarePlanGoals(e.target.value)} /></Field>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h3 className="text-sm font-bold text-slate-800 border-b border-gray-100 pb-2">Insurance Coverage</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Provider"><input className={inputCls} value={insuranceProvider} onChange={(e) => setInsuranceProvider(e.target.value)} /></Field>
          <Field label="Policy Number"><input className={inputCls} value={insurancePolicyNumber} onChange={(e) => setInsurancePolicyNumber(e.target.value)} /></Field>
        </div>
      </div>

    </form>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "gray" | "amber" | "green" }) {
  const tones: Record<string, string> = { gray: "text-gray-700", amber: "text-amber-600", green: "text-green-600" };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tones[tone]}`}>{value}</p>
    </div>
  );
}
