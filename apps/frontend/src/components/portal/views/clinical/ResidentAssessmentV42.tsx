"use client";

// Phase 0 — Resident Assessment v4.2 three-layer form.
// Replaces the legacy 50-point pre-admission form (kept read-only). Persists
// migration-free in the app-setting `assessments_v42` (JSON array), tenant-scoped
// like every other clinical board. Score is advisory (max /56, NS-01 excluded);
// the deterministic MLR-floor + modifier + override + L5-pathway engine drives
// the suggested Level of Care (GAP-001: banding not yet calibrated).

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Plus, X, Trash2, Pencil, CheckCircle2, Gauge, AlertTriangle,
  ShieldCheck, RefreshCw, Info, Layers, LayoutGrid, Table2, FileText,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord, updateRecord, createRecord } from "@/lib/api";
import { recordLocSignoff, LOC_SIGNOFF_KEY, parseLocSignoffs } from "@/lib/lifecare/locSignoff";
import { levelMeta } from "@/lib/lifecare/levelModel";
import { recordAudit } from "@/lib/auditClient";
import { generateCarePlanFromV42 } from "@/lib/carePlanV42Gen";
import { decideLocApplication } from "@/lib/lifecare/downstream.ts";
import { recordLocChange, parseLocHistory, latestEntry, normalizeLevel, LOC_HISTORY_KEY } from "@/lib/lifecare/locHistory";
import {
  ClinicalPage, ClinicalHeader, ClinicalButton, ClinicalCard, StatCard,
  SearchInput, DataState, StatusPill, MicroLabel, controlClass, DISPLAY,
} from "./clinical-ui";
import SignatureModal from "@/components/portal/SignatureModal";
import {
  ASSESSMENTS_V42_KEY, newAssessment, cloneForReassessment, originOf,
  classifyAssessment, assessmentRawScore, requiredModifierIds, assessmentValidationIssues, medItemsOf,
  type AssessmentV42, type AssessmentLayer1, type DomainEntry, type AssessmentStatus,
  type AssessmentOrigin, type ModifierReconciliationDecision,
} from "@/lib/lifecare/assessment.ts";
import MedicationsEditor from "./MedicationsEditor";
import { syncMedicationsToMar, type MedRow } from "@/lib/lifecare/medSync.ts";
import { VITALS_KEY } from "@/lib/lifecare/medConstants.ts";
import {
  ASSESSMENT_DOMAINS, modifierById,
} from "@/lib/lifecare/dataset.ts";
import type { CareLevel, DomainCode, ClinicalContext } from "@/lib/lifecare/types.ts";
import { CRM_LEADS_KEY, parseLeads } from "@/lib/crmLeads";
import { composeName, nameParts } from "@/lib/names";
import { printNarrativeReport } from "@/lib/lifecare/narrativeReport";
import DomainScoreGrid from "./DomainScoreGrid";

type SettingRow = { key?: string; id?: string; value?: string };

const RAW_MAX = 56;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
const LEVELS: CareLevel[] = ["L1", "L2", "L3", "L4", "L5"];
const LEVEL_LABEL: Record<CareLevel, string> = {
  L1: "Level 1", L2: "Level 2", L3: "Level 3", L4: "Level 4", L5: "Level 5 (Pathway)",
};
// L1–L5 → accent (low = positive, mid = caution, high = attention).
const LEVEL_ACCENT: Record<CareLevel, "green" | "amber" | "coral"> = {
  L1: "green", L2: "green", L3: "amber", L4: "coral", L5: "coral",
};
const LEVEL_COLOR: Record<CareLevel, string> = {
  L1: "var(--clinical-green)", L2: "var(--clinical-green)", L3: "var(--clinical-amber)",
  L4: "var(--clinical-coral)", L5: "var(--clinical-coral)",
};

// The NS-01 non-scored profile domain (goals / preferences / decision support).
const NS01 = ASSESSMENT_DOMAINS.find((d) => d.code === "NS-01");

const REASSESSMENT_OPTIONS = ["30 days", "90 days", "6 months", "Annually", "On change of condition"];
/** Next review date (local yyyy-mm-dd) auto-computed from a reassessment interval; "" for event-driven. */
function nextReviewFor(option: string): string {
  const d = new Date();
  switch (option) {
    case "30 days": d.setDate(d.getDate() + 30); break;
    case "90 days": d.setDate(d.getDate() + 90); break;
    case "6 months": d.setMonth(d.getMonth() + 6); break;
    case "Annually": d.setFullYear(d.getFullYear() + 1); break;
    default: return ""; // "On change of condition" — event-driven, no scheduled date
  }
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const CAPABILITY_OUTCOMES = [
  { value: "WITHIN_CAPABILITY", label: "Within capability" },
  { value: "ESCALATE_TRANSFER", label: "Escalate / transfer" },
  { value: "EMERGENCY_PATHWAY", label: "Emergency pathway" },
] as const;

const input = controlClass;
const chipOn = "bg-[var(--clinical-panel)] text-white border-[var(--clinical-panel)]";
const chipOff = "bg-[var(--clinical-surface)] text-[var(--clinical-ink-soft)] border-[var(--clinical-line-strong)] hover:border-[var(--clinical-panel)]";

const newId = () => `av42-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ── Reusable inputs ──────────────────────────────────────────────────────────
function Text({ label, value, onChange, placeholder, type = "text", readOnly }: { label: string; value?: string; onChange: (v: string) => void; placeholder?: string; type?: string; readOnly?: boolean }) {
  return (
    <label className="block">
      <MicroLabel className="mb-1">{label}</MicroLabel>
      <input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} readOnly={readOnly} className={`${input}${readOnly ? " bg-black/5 cursor-not-allowed" : ""}`} />
    </label>
  );
}
function Area({ label, value, onChange, placeholder, rows = 2 }: { label: string; value?: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <label className="block">
      <MicroLabel className="mb-1">{label}</MicroLabel>
      <textarea rows={rows} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={input} />
    </label>
  );
}
function Bool({ label, value, onChange }: { label: string; value?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!value)}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${value ? chipOn : chipOff}`}>
      <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${value ? "bg-white/20 border-white" : "border-[var(--clinical-line-strong)]"}`}>{value && <CheckCircle2 className="w-3 h-3" />}</span>
      {label}
    </button>
  );
}
function Choice({ label, value, options, onChange }: { label: string; value?: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div>
      <MicroLabel className="mb-1">{label}</MicroLabel>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button key={o.value} type="button" onClick={() => onChange(o.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${value === o.value ? chipOn : chipOff}`}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}
function MultiChoice({ label, values = [], options, onToggle }: { label: string; values?: string[]; options: { value: string; label: string }[]; onToggle: (v: string) => void }) {
  return (
    <div>
      <MicroLabel className="mb-1">{label}</MicroLabel>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = values.includes(o.value);
          return (
            <button key={o.value} type="button" onClick={() => onToggle(o.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${on ? chipOn : chipOff}`}>{o.label}</button>
          );
        })}
      </div>
    </div>
  );
}
function Section({ code, title, subtitle, children }: { code?: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <ClinicalCard top="teal" className="p-4 sm:p-5">
      <div className="mb-3 border-b pb-2" style={{ borderColor: "var(--clinical-line)" }}>
        <h3 className="text-sm font-bold text-[var(--clinical-ink)]">{code && <span className="text-[var(--clinical-panel)] mr-1.5">{code}</span>}{title}</h3>
        {subtitle && <p className="text-[11px] text-[var(--clinical-muted)] mt-0.5">{subtitle}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </ClinicalCard>
  );
}

// ── Resident picker (converted-lead admissions) ───────────────────────────────
type AdmissionOpt = { id: string; name: string; dob?: string; sex?: string; phone?: string; contact?: string; referralSource?: string };

const ageFromDob = (dob?: string): string => {
  if (!dob) return "";
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a >= 0 && a < 130 ? String(a) : "";
};

function ResidentPicker({ value, onChange, admissions, linkedId, onPick, onUnlink, label = "Resident Name *", placeholder = "Search converted leads or type a name…", linkedLabel = "From CRM", emptyHint = "No in-progress admissions match — keep typing to enter a new name.", optionFallback = "Converted lead · in-progress admission" }: {
  value?: string; onChange: (v: string) => void; admissions: AdmissionOpt[];
  linkedId: string; onPick: (a: AdmissionOpt) => void; onUnlink: () => void;
  label?: string; placeholder?: string; linkedLabel?: string; emptyHint?: string; optionFallback?: string;
}) {
  const [open, setOpen] = useState(false);
  const q = (value ?? "").trim().toLowerCase();
  const matches = admissions.filter((a) => !q || a.name.toLowerCase().includes(q)).slice(0, 8);
  return (
    <label className="block relative">
      <MicroLabel className="mb-1">{label}</MicroLabel>
      <div className="relative">
        <input
          value={value ?? ""}
          onChange={(e) => { onChange(e.target.value); if (linkedId) onUnlink(); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          className={`${input} ${linkedId ? "pr-24" : ""}`}
          autoComplete="off"
        />
        {linkedId && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded text-[var(--clinical-panel)]" style={{ backgroundColor: "color-mix(in srgb, var(--clinical-panel) 12%, transparent)" }}>
            {linkedLabel}
            <button type="button" aria-label="Unlink" onMouseDown={(e) => { e.preventDefault(); onUnlink(); }} className="hover:text-[var(--clinical-coral)]"><X className="w-3 h-3" /></button>
          </span>
        )}
      </div>
      {open && admissions.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border shadow-lg scrollbar-thin" style={{ backgroundColor: "var(--clinical-ground)", borderColor: "var(--clinical-line-strong)" }}>
          {matches.length === 0 ? (
            <div className="px-3 py-2 text-xs text-[var(--clinical-muted)]">{emptyHint}</div>
          ) : matches.map((a) => (
            <button key={a.id} type="button" onMouseDown={(e) => { e.preventDefault(); onPick(a); setOpen(false); }}
              className="w-full text-left px-3 py-2 hover:bg-[var(--clinical-surface-2)] border-b last:border-b-0" style={{ borderColor: "var(--clinical-line)" }}>
              <div className="text-sm font-medium text-[var(--clinical-ink)]">{a.name}</div>
              <div className="text-[11px] text-[var(--clinical-muted)]">{[a.contact, a.sex, a.dob && `DOB ${a.dob}`, a.phone].filter(Boolean).join(" · ") || optionFallback}</div>
            </button>
          ))}
        </div>
      )}
    </label>
  );
}

// ── Persistence helpers ───────────────────────────────────────────────────────
function parseAssessments(raw?: string): AssessmentV42[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as AssessmentV42[]) : [];
  } catch { return []; }
}

// Draft working state = the full assessment sans list metadata; we edit it in place.
type Draft = AssessmentV42;

// Display label for the signing/editing clinician, keyed by the real session role.
const ROLE_LABELS: Record<string, string> = {
  SUPERADMIN: "Super Admin", CARE_MANAGER: "Care Manager", NURSE: "Nurse",
  FACILITY_ADMIN: "Facility Admin", PHYSICIAN: "Physician", CAREGIVER: "Caregiver",
  BILLING_ADMIN: "Billing Admin",
};

export default function ResidentAssessmentV42({ clinicianRole = "NURSE", embedded = false, modalOnly = false, deepLinkResident = null, deepLinkReason = "", origin = "PREADMISSION", newSignal, openSignal }: { clinicianRole?: string; embedded?: boolean; modalOnly?: boolean; deepLinkResident?: { id: string; name: string } | null; deepLinkReason?: string; origin?: AssessmentOrigin; newSignal?: number; openSignal?: { residentId: string; residentName: string; reason?: string; nonce: number } }) {
  // roleLabel is derived from the session role below (after the session fetch).

  const { data: settingRows, loading, error, refetch } = useLiveQuery<SettingRow>("app-settings", { tables: ["AppSetting"] });
  // Scope to this board's own records. Pre-Admission and Care Acuity share the
  // same instrument + store but keep separate lists (see AssessmentOrigin).
  const allStored = useMemo(
    () => parseAssessments(settingRows.find((r) => (r.key || r.id) === ASSESSMENTS_V42_KEY)?.value),
    [settingRows]
  );
  const assessments = useMemo(
    () => allStored.filter((a) => originOf(a) === origin)
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")),
    [allStored, origin]
  );
  // Records owned by the *other* board — never shown here, but must survive every
  // write (persist rewrites the whole store, so we re-append these each time).
  const foreignRecords = useMemo(() => allStored.filter((a) => originOf(a) !== origin), [allStored, origin]);

  // LOC-change approval state per assessment (from loc_signoffs) — badges each card
  // so the clinician sees a reassessment is awaiting CM/Superadmin approval, or was
  // approved. Newest-first store ⇒ the first match for an assessmentId is the latest.
  const signoffByAssessment = useMemo(() => {
    const m = new Map<string, string>();
    for (const sg of parseLocSignoffs(settingRows.find((r) => (r.key || r.id) === LOC_SIGNOFF_KEY)?.value))
      if (sg.assessmentId && !m.has(sg.assessmentId)) m.set(sg.assessmentId, sg.status);
    return m;
  }, [settingRows]);
  const locBadge = (assessmentId: string) => {
    const st = signoffByAssessment.get(assessmentId);
    if (st === "PENDING_FAMILY" || st === "FAMILY_APPROVED") return <StatusPill status="PENDING">Pending approval</StatusPill>;
    if (st === "APPLIED") return <StatusPill status="COMPLETED">LOC approved</StatusPill>;
    return null;
  };

  // Referral source lives on the CRM lead (not the Admission), linked by
  // convertedAdmissionId. Read it from the same app-settings rows we already load.
  const leadSourceByAdmission = useMemo<Record<string, string>>(() => {
    const raw = settingRows.find((r) => (r.key || r.id) === CRM_LEADS_KEY)?.value;
    const out: Record<string, string> = {};
    for (const l of parseLeads(raw)) if (l.convertedAdmissionId && l.source) out[l.convertedAdmissionId] = l.source;
    return out;
  }, [settingRows]);
  // Structured resident-name parts from the source CRM lead, keyed by the converted
  // admission id — so picking a converted lead prefills First / Middle / Last cleanly.
  const leadNameByAdmission = useMemo<Record<string, { firstName: string; middleName: string; lastName: string }>>(() => {
    const raw = settingRows.find((r) => (r.key || r.id) === CRM_LEADS_KEY)?.value;
    const out: Record<string, { firstName: string; middleName: string; lastName: string }> = {};
    for (const l of parseLeads(raw)) {
      if (!l.convertedAdmissionId) continue;
      out[l.convertedAdmissionId] = nameParts({ firstName: l.residentFirstName, middleName: l.residentMiddleName, lastName: l.residentLastName, name: l.prospectiveResident });
    }
    return out;
  }, [settingRows]);

  // Converted CRM leads land here as in-progress admissions — offer them for the picker.
  const { data: admissionRows } = useLiveQuery<{ id: string; firstName?: string; lastName?: string; dateOfBirth?: string; gender?: string; phone?: string; sponsorName?: string; status?: string }>("admissions", { query: "take=500", tables: ["Admission"] });
  const admissionOpts = useMemo<AdmissionOpt[]>(
    // "In progress" by exclusion — mirror the Admissions card, which shows any
    // admission that isn't COMPLETED/CANCELLED as In Progress (status may be
    // null/empty/DRAFT). An exact "IN_PROGRESS" match dropped those admissions.
    () => admissionRows
      .filter((r) => { const st = String(r.status || "").toUpperCase(); return st !== "COMPLETED" && st !== "CANCELLED"; })
      .map((r) => ({
        id: String(r.id),
        name: `${r.firstName ?? ""} ${r.lastName ?? ""}`.replace(/\s*—\s*$/, "").trim(),
        dob: r.dateOfBirth ? String(r.dateOfBirth).slice(0, 10) : undefined,
        sex: r.gender || undefined,
        phone: r.phone || undefined,
        contact: r.sponsorName || undefined,
        referralSource: leadSourceByAdmission[String(r.id)] || undefined,
      }))
      .filter((a) => a.name),
    [admissionRows, leadSourceByAdmission]
  );

  // For a reassessment (LOC Decision Review, origin ACUITY) the picker lists ADMITTED
  // residents — the CRM converted-lead list is only for the Pre-Admission form.
  const { data: residentRows } = useLiveQuery<{ id: string; firstName?: string; lastName?: string; name?: string; dateOfBirth?: string; gender?: string; roomNumber?: string; status?: string; diagnosis?: string; medicalHistory?: string; allergies?: string }>("residents", { tables: ["Resident"] });
  const residentOpts = useMemo<AdmissionOpt[]>(
    () => (residentRows || [])
      .filter((r) => String(r.status || "").toUpperCase() !== "DISCHARGED")
      .map((r) => ({
        id: String(r.id),
        name: `${r.firstName ?? ""} ${r.lastName ?? ""}`.replace(/\s+/g, " ").trim() || String(r.name || ""),
        dob: r.dateOfBirth ? String(r.dateOfBirth).slice(0, 10) : undefined,
        sex: r.gender || undefined,
        contact: r.roomNumber ? `Room ${r.roomNumber}` : undefined,
      }))
      .filter((a) => a.name),
    [residentRows]
  );
  const isAcuity = origin === "ACUITY";

  const [me, setMe] = useState("");
  const [myId, setMyId] = useState("");
  const [myRole, setMyRole] = useState("");
  useEffect(() => { fetch("/api/auth/session").then((r) => r.json()).then((d) => { if (d?.authenticated) { setMe(d.session?.name ?? ""); setMyId(d.session?.userId ?? ""); setMyRole(d.session?.role ?? ""); } }).catch(() => {}); }, []);
  // Sign-off / editing label follows the actual signed-in user's role. SuperAdmin
  // routes through FACILITY_ADMIN/CARE_MANAGER for clinical scope, but must still
  // read as "Super Admin" here; fall back to the passed prop before session load.
  const roleLabel = ROLE_LABELS[myRole] ?? ROLE_LABELS[clinicianRole] ?? "Clinician";

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [layer, setLayer] = useState<1 | 2 | 3>(1);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [showPin, setShowPin] = useState(false); // PIN gate for the Care Manager Validate sign-off
  const [pinValidate, setPinValidate] = useState<{ decision: NonNullable<AssessmentV42["validation"]>["decision"]; notes: string } | null>(null);
  const [linkedAdmissionId, setLinkedAdmissionId] = useState("");
  // True while the open modal was launched from a private-caregiver request. Held
  // in state (not read live from the URL) so it survives the URL being cleared and
  // still drives the banner + the LOC-history source on validation.
  const [pcgOpen, setPcgOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // ── draft mutation helpers ──────────────────────────────────────────────────
  const patchLayer1 = (p: Partial<AssessmentLayer1>) => setDraft((d) => (d ? { ...d, layer1: { ...d.layer1, ...p } } : d));
  // Update a resident-name part and keep the composed residentName (used by 100+ readers) in sync.
  const setNamePart = (p: Partial<Pick<AssessmentLayer1, "firstName" | "middleName" | "lastName">>) =>
    setDraft((d) => { if (!d) return d; const l1 = { ...d.layer1, ...p }; return { ...d, layer1: { ...l1, residentName: composeName(l1.firstName, l1.middleName, l1.lastName) } }; });
  const toggleLayer1Multi = (key: "familyInvolvement" | "overallGoals", v: string) =>
    setDraft((d) => {
      if (!d) return d;
      const cur = d.layer1[key] ?? [];
      const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
      return { ...d, layer1: { ...d.layer1, [key]: next } };
    });
  const patchContext = (p: Partial<ClinicalContext>) => setDraft((d) => (d ? { ...d, context: { ...d.context, ...p } } : d));
  const patchLayer3 = (p: Partial<AssessmentV42["layer3"]>) => setDraft((d) => (d ? { ...d, layer3: { ...d.layer3, ...p } } : d));
  const patchDomain = (code: DomainCode, p: Partial<DomainEntry>) =>
    setDraft((d) => {
      if (!d) return d;
      const prev = d.domains[code] ?? { score: 0 };
      return { ...d, domains: { ...d.domains, [code]: { ...prev, ...p } } };
    });
  const reconcileModifier = (id: string, decision: ModifierReconciliationDecision, rationale?: string) =>
    setDraft((d) => {
      if (!d) return d;
      const reviews = { ...(d.layer3.modifierReconciliations ?? {}), [id]: { decision, rationale } };
      const applied = Object.entries(reviews).filter(([, review]) => review.decision === "APPLIED").map(([modifierId]) => modifierId).sort();
      return { ...d, layer3: { ...d.layer3, modifierReconciliations: reviews, reconciledModifiers: applied } };
    });

  const openNew = () => {
    const a = newAssessment(newId(), me || undefined, new Date().toISOString());
    a.origin = origin;
    setEditingId(null); setLinkedAdmissionId(""); setDraft(a); setLayer(1); setPcgOpen(false); setOpen(true);
  };
  const openEdit = (a: AssessmentV42, initialLayer: 1 | 2 | 3 = 1) => {
    setEditingId(a.id); setLinkedAdmissionId(a.layer1?.convertedAdmissionId ?? "");
    const clone: AssessmentV42 = JSON.parse(JSON.stringify(a));
    // Backfill structured name parts for legacy records so the First/Middle/Last inputs populate.
    if (!clone.layer1.firstName && !clone.layer1.middleName && !clone.layer1.lastName) {
      const np = nameParts({ name: clone.layer1.residentName });
      clone.layer1.firstName = np.firstName; clone.layer1.middleName = np.middleName; clone.layer1.lastName = np.lastName;
    }
    setDraft(clone); setLayer(initialLayer); setPcgOpen(false); setOpen(true);
  };
  // When embedded, the host board (Care Acuity) owns the "New Assessment" button in
  // its header and triggers us via an incrementing `newSignal` — skip the first run.
  const newSignalRef = useRef(newSignal);
  useEffect(() => {
    if (newSignal === undefined || newSignal === newSignalRef.current) return;
    newSignalRef.current = newSignal;
    openNew();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newSignal]);
  // Deep-link target. A REASSESSMENT (opened from a PCG / LOC-review request —
  // deepLinkReason is set) must ALWAYS start a fresh EMPTY form: the resident
  // "undergoes all the questions again", and the prior assessment stays saved as
  // history. Only a plain identity deep-link (no reason) resumes the latest.
  // Called once when arrived via ?resident=<id>.
  const openForResident = (rid: string, rname: string, reason?: string) => {
    if (!reason) {
      const existing = assessments.find((a) => a.layer1?.residentId === rid);
      if (existing) { openEdit(existing); return; }
    }
    const a = newAssessment(newId(), me || undefined, new Date().toISOString());
    a.origin = origin;
    a.layer1.residentId = rid;
    a.layer1.residentName = rname;
    setEditingId(null); setLinkedAdmissionId(""); setDraft(a); setLayer(1); setPcgOpen(reason === "pcg"); setOpen(true);
  };
  const deepRef = useRef(false);
  useEffect(() => {
    if (deepRef.current) return;
    const dl = deepLinkResident;
    if (!dl?.id || !dl.name) return; // wait until the resident name resolves
    if (loading) return; // wait until assessments have loaded (edit-vs-new)
    deepRef.current = true;
    void (async () => {
      openForResident(dl.id, dl.name || "", deepLinkReason);
      // Consume the one-shot deep-link: drop ?resident/?reason so switching Care
      // Acuity tabs (which remounts this board) never re-pops the modal.
      if (pathname) router.replace(pathname, { scroll: false });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkResident, loading]);

  // Imperative open — pops the assessment modal IN PLACE from another board (no
  // navigation). The host bumps `nonce` each time; blank/edit + PCG banner follow
  // the same rules as the deep-link (reason set ⇒ fresh empty form).
  const openSigRef = useRef(openSignal?.nonce);
  useEffect(() => {
    if (!openSignal || openSignal.nonce === openSigRef.current || loading) return;
    openSigRef.current = openSignal.nonce;
    openForResident(openSignal.residentId, openSignal.residentName, openSignal.reason);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal, loading]);

  const pickAdmission = (a: AdmissionOpt) => {
    // Prefill structured name from the source CRM lead (clean parts), else split the name.
    const np = leadNameByAdmission[a.id] || nameParts({ name: a.name });
    patchLayer1({
      residentName: composeName(np.firstName, np.middleName, np.lastName) || a.name,
      firstName: np.firstName, middleName: np.middleName, lastName: np.lastName,
      dateOfBirth: a.dob || draft?.layer1.dateOfBirth,
      sex: a.sex || draft?.layer1.sex,
      age: ageFromDob(a.dob) || draft?.layer1.age,
      contactNo: a.phone || draft?.layer1.contactNo,
      primaryContact: a.contact || draft?.layer1.primaryContact,
      referralSource: a.referralSource || "", // from CRM; blank when the lead has none
      convertedAdmissionId: a.id,
    });
    setLinkedAdmissionId(a.id);
  };

  // Reassessment picker (ACUITY): link to an existing RESIDENT record (not a CRM
  // admission), so the validated level change applies to that resident.
  const pickResident = (a: AdmissionOpt) => {
    const np = nameParts({ name: a.name });
    patchLayer1({
      residentName: a.name,
      firstName: np.firstName, middleName: np.middleName, lastName: np.lastName,
      residentId: a.id,
      dateOfBirth: a.dob || draft?.layer1.dateOfBirth,
      sex: a.sex || draft?.layer1.sex,
      age: ageFromDob(a.dob) || draft?.layer1.age,
      convertedAdmissionId: undefined,
    });
    setLinkedAdmissionId("");
  };

  // Live classification of the working draft (Layer 3 read-out + list scoring).
  const liveResult = useMemo(() => (draft ? classifyAssessment(draft) : null), [draft]);
  const liveRaw = useMemo(() => (draft ? assessmentRawScore(draft) : 0), [draft]);
  const modifierReviewIds = useMemo(() => (draft ? requiredModifierIds(draft) : []), [draft]);

  const persist = async (next: AssessmentV42[]) => {
    // `next` is this board's scoped list; keep the other board's records intact.
    await upsertRecord("app-settings", ASSESSMENTS_V42_KEY, { key: ASSESSMENTS_V42_KEY, value: JSON.stringify([...next, ...foreignRecords]) });
    await refetch();
  };

  const buildRecord = (status: AssessmentStatus, extra: Partial<AssessmentV42> = {}): AssessmentV42 => {
    if (!draft) throw new Error("No draft");
    const now = new Date().toISOString();
    const link = linkedAdmissionId || draft.layer1.convertedAdmissionId;
    return {
      ...draft,
      status,
      updatedAt: now,
      layer1: { ...draft.layer1, convertedAdmissionId: link },
      ...extra,
    };
  };

  const save = async (status: AssessmentStatus, extra: Partial<AssessmentV42> = {}, toast?: string, silent = false) => {
    if (!draft) return;
    // A DRAFT must capture whatever the assessor has entered across Layers 1–3, even
    // without a name yet (it lists as "Unnamed resident" and reopens). The name is only
    // required to finalize (COMPLETED/VALIDATED), where it becomes an identity of record.
    if (status !== "DRAFT" && !draft.layer1.residentName?.trim()) {
      Swal.fire({ title: "Resident name required", text: "Enter the resident's name in Layer 1 before saving.", icon: "warning" });
      setLayer(1); return;
    }
    setSaving(true);
    try {
      const isEdit = !!editingId;
      const rec = buildRecord(status, extra);
      let next: AssessmentV42[];
      if (editingId) {
        next = assessments.map((a) => (a.id === editingId ? rec : a));
      } else {
        next = [rec, ...assessments];
        setEditingId(rec.id);
      }
      setDraft(rec);
      await persist(next);
      if (!silent) {
        recordAudit({
          action: isEdit ? "UPDATE" : "CREATE",
          entityType: "assessments",
          entityId: rec.id,
          residentName: rec.layer1.residentName?.trim() || undefined,
          reason: `${status === "COMPLETED" ? "Completed" : isEdit ? "Updated" : "Started"} resident assessment for ${rec.layer1.residentName?.trim() || "resident"}`,
        });
      }
      if (toast) Swal.fire({ title: toast, icon: "success", timer: 1600, showConfirmButton: false });
    } catch (e) {
      Swal.fire({ title: "Save failed", text: e instanceof Error ? e.message : "Could not save.", icon: "error" });
    } finally { setSaving(false); }
  };

  // ── Auto-save ────────────────────────────────────────────────────────────────
  // Persist the working draft without the assessor pressing "Save Draft", so an
  // accidental close or tab switch never loses entered data. `updatedAt` is left
  // out of the change key so re-stamping it on save can't trigger a save loop.
  const contentKey = (d: Draft) => JSON.stringify({ ...d, updatedAt: undefined });
  const autoSaveKeyRef = useRef<string | null>(null);
  const flushAutoSave = useRef<() => void>(() => {});
  useEffect(() => {
    flushAutoSave.current = () => {
      if (!open || !draft || saving) return;
      if (draft.status && draft.status !== "DRAFT") return; // never downgrade a finalized record
      const key = contentKey(draft);
      if (key === autoSaveKeyRef.current) return;           // nothing new since the last save
      autoSaveKeyRef.current = key;
      void save("DRAFT", {}, undefined, true);              // silent: no toast, no audit spam
    };
  });

  // Debounce while the draft changes; seed a baseline on open so a freshly opened
  // (untouched) record is never written back as a no-op.
  useEffect(() => {
    if (!open || !draft) { autoSaveKeyRef.current = null; return; }
    if (draft.status && draft.status !== "DRAFT") return;
    const key = contentKey(draft);
    if (autoSaveKeyRef.current === null) { autoSaveKeyRef.current = key; return; }
    if (key === autoSaveKeyRef.current) return;
    const t = window.setTimeout(() => flushAutoSave.current(), 800);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, open]);

  // Flush immediately on browser tab-hide / unload and on component unmount
  // (switching portal tabs unmounts this board before the debounce could fire).
  useEffect(() => {
    const flush = () => flushAutoSave.current();
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lock background page scroll while the modal is open, so the wheel/trackpad
  // always drives the modal body — never the portal page behind it (which has
  // its own overflow-y-auto and can otherwise "steal" the scroll).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Scroll the modal body back to the top whenever the layer tab changes (or the
  // modal opens), so each layer opens at its first section instead of inheriting
  // the previous layer's scroll position.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [layer, open]);

  // Flush before an explicit close so the final edits are captured pre-debounce.
  const closeModal = () => { flushAutoSave.current(); setOpen(false); };

  // "Complete Assessment" → COMPLETED. Never downgrade an already-VALIDATED assessment
  // (validation is the terminal state; completing after sign-off must not revert it).
  const completeSigned = () => {
    const now = new Date().toISOString();
    const nextStatus = draft?.status === "VALIDATED" ? "VALIDATED" : "COMPLETED";
    void save(nextStatus, { completedBy: me || "Clinician", completedAt: now }, "Assessment completed").then(() => setOpen(false));
  };

  // All three layers must be complete before the assessment can be signed off:
  // Layer 1 profile (resident name), Layer 2 every domain scored + evidenced (G1),
  // and Layer 3 final LOC + justification + modifier reconciliation (G2–G5).
  const completionIssues = useMemo<{ layer: number; message: string }[]>(() => {
    if (!draft) return [];
    const out: { layer: number; message: string }[] = [];
    if (!draft.layer1.residentName?.trim()) out.push({ layer: 1, message: "Layer 1 — enter the resident name." });
    for (const i of assessmentValidationIssues(draft)) out.push({ layer: i.layer, message: `Layer ${i.layer} — ${i.message}` });
    return out;
  }, [draft]);

  // Nurse → admin validation block (like LevelOfCareReview).
  const validate = async (decision: NonNullable<AssessmentV42["validation"]>["decision"], notes: string) => {
    if (!draft) return;
    if (decision === "NEEDS_REASSESSMENT") {
      if (!notes.trim()) {
        Swal.fire({ title: "Reassessment reason required", text: "Document what must be reassessed before returning this assessment.", icon: "warning" });
        return;
      }
    } else {
      const issues = assessmentValidationIssues(draft);
      if (issues.length) {
        Swal.fire({
          title: "Decision gates incomplete",
          text: issues.map((issue) => `${issue.gate}: ${issue.message}`).join("\n"),
          icon: "warning",
        });
        setLayer(issues[0].layer);
        return;
      }
    }
    const now = new Date().toISOString();
    await save("VALIDATED", { validation: { by: me || "Clinician", role: roleLabel, at: now, decision, notes: notes || undefined } }, "Level of Care validated");

    // Push the resident's structured medications into their MAR (reviewed → ACTIVE,
    // else PENDING). Runs before the LOC branch below so it isn't skipped when a
    // level change is held for family sign-off. Best-effort — never blocks validation.
    const medRid = draft.layer1.residentId ?? "";
    if (decision === "APPROVED" && medRid) {
      try {
        const items = medItemsOf(draft.layer1);
        if (items.length) {
          const [medsJson, vitJson] = await Promise.all([
            fetch(`/api/db/medications?f_residentId=${encodeURIComponent(medRid)}&take=1000`, { credentials: "include", cache: "no-store" }).then((r) => (r.ok ? r.json() : { data: [] })).catch(() => ({ data: [] })),
            fetch(`/api/db/app-settings?f_key=${VITALS_KEY}&take=1`, { credentials: "include", cache: "no-store" }).then((r) => (r.ok ? r.json() : { data: [] })).catch(() => ({ data: [] })),
          ]);
          const existing = ((medsJson?.data ?? []) as MedRow[]);
          let vitalsMap: Record<string, boolean> = {};
          try { vitalsMap = JSON.parse((vitJson?.data as Array<{ value?: string }> | undefined)?.[0]?.value || "{}"); } catch { /* default empty */ }
          await syncMedicationsToMar({ residentId: medRid, items, reviewed: draft.layer1.medicationListReviewed === "YES", existing, vitalsMap, actorName: me || undefined });
        }
      } catch { /* meds sync is best-effort; validation is already saved */ }
    }

    // Wire the validated Final LOC into the production flow (engine-A output):
    // set resident.careLevel, post the LOC charge, and generate a care plan.
    // Only fires for an APPROVED decision on an assessment linked to an existing
    // resident. Governance: no auto-fee change without this authorised approval;
    // the generated plan is a DRAFT the nurse individualises before activation.
    const capabilityReady = !liveResult?.capabilityGate || draft.layer3.capabilityReview?.outcome === "WITHIN_CAPABILITY";
    if (decision === "APPROVED" && !capabilityReady) {
      Swal.fire({
        title: "LOC recorded — downstream activation withheld",
        text: "The capability review routes this resident to escalation/transfer or the emergency pathway. The LOC fee and draft care plan were not activated.",
        icon: "warning",
      });
    }
    if (decision === "APPROVED" && capabilityReady) {
      // Prior recorded level (for the downgrade guard) — from the resident's
      // Level-of-Care history, matched by resident id / admission / name.
      let priorLevel: CareLevel | null = null;
      try {
        const r = await fetch(`/api/db/app-settings?f_key=${LOC_HISTORY_KEY}&take=1`, { credentials: "include", cache: "no-store" });
        const j = r.ok ? await r.json() : null;
        const raw = (j?.data as Array<{ value?: string }> | undefined)?.[0]?.value;
        const prior = latestEntry(
          parseLocHistory(raw),
          draft.layer1.residentId ?? "",
          draft.layer1.convertedAdmissionId ? [draft.layer1.convertedAdmissionId] : [],
          draft.layer1.residentName ?? "",
        );
        const lv = prior ? normalizeLevel(prior.level) : "";
        priorLevel = /^L[1-5]$/.test(lv) ? (lv as CareLevel) : null;
      } catch { /* best-effort: no prior history → treated as a first assessment */ }

      // Governed application: a validated assessment is an authorised reassessment
      // by this clinician. No auto-fee (needs the authoriser) and a downgrade is
      // only applied through this authorised reassessment (CL-19 / CL-21).
      const ds = decideLocApplication({
        residentId: draft.layer1.residentId,
        finalLevel: draft.layer3.finalLevel,
        priorLevel,
        validated: true,
        reassessed: true,
        authorisedBy: me || undefined,
      });
      if (ds && !ds.apply && ds.blockedReason) {
        Swal.fire({ title: "Level of Care not applied", text: ds.blockedReason, icon: "warning" });
      }

      // APPROVAL GATE — a validated reassessment of a resident who ALREADY has an
      // approved level is held for CM/Superadmin approval; the active LOC does NOT
      // change until approved. This covers a same-level reaffirmation too (all LOC
      // needs approval). Approval applies careLevel + billing + the draft plan + the
      // loc_history entry. No family sign-off; the nurse cannot approve. A first
      // assessment (no prior level) and pre-admission apply directly below. The
      // assessment is already saved VALIDATED above.
      const rid = draft.layer1.residentId ?? "";
      const newLevelNorm = normalizeLevel(draft.layer3.finalLevel);
      if (ds && ds.apply && rid && priorLevel) {
        const sameLevel = newLevelNorm === priorLevel;
        await recordLocSignoff({
          residentId: rid, residentName: draft.layer1.residentName,
          oldLevel: priorLevel, newLevel: newLevelNorm,
          careLevelEnum: ds.careLevelEnum, numericLevel: ds.numericLevel,
          // Same-level reaffirmation → no new LOC charge; a real change bills on approval.
          postLocCharge: sameLevel ? false : ds.postLocCharge, generatePlan: ds.generatePlan,
          assessmentId: draft.id, justification: draft.layer3.finalLevelJustification,
          submittedById: myId || undefined, submittedByName: me || undefined, role: roleLabel,
        });
        Swal.fire({ icon: "info", title: "Held for approval", text: sameLevel
          ? "This reassessment keeps the resident at their current level and is held for a Care Manager or Superadmin to approve from the Pending Approval board — the level stays unchanged until then."
          : "This level-of-care change is held for a Care Manager or Superadmin to approve and apply from the Pending Approval board — the current level stays in effect until then." });
        return; // defer careLevel/billing/plan/loc-history to Approve & apply
      }

      if (ds && ds.apply) {
        try {
          await updateRecord("residents", ds.residentId, { careLevel: ds.careLevelEnum });
          if (ds.postLocCharge) {
            await fetch("/api/billing/loc-charge", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ residentId: ds.residentId, level: ds.numericLevel }),
            }).catch(() => {});
          }
          if (ds.generatePlan) {
            await generateCarePlanFromV42({
              residentId: ds.residentId,
              assessment: { ...draft, status: "VALIDATED" } as AssessmentV42,
              createdByName: me || "Clinician",
            });
          }
        } catch {
          // Validation is already saved; a downstream step (care level / billing /
          // draft plan) failed. Surface it so it isn't silently inconsistent.
          Swal.fire({
            toast: true, position: "top-end", icon: "warning",
            title: "Level validated, but a downstream step failed — verify care level, billing and the draft plan.",
            showConfirmButton: false, timer: 3200,
          });
        }
      }
      // Append to the resident's Level of Care history — captured from pre-admission
      // onward (keyed by residentId when admitted, else the linked admission), and
      // again on each reassessment, so the full LOC trail is preserved. When the
      // form was opened FROM a private-caregiver request, tag the entry as such so
      // the Care Level History shows why the reassessment happened.
      const openedForPcg = pcgOpen;
      // A Final LOC set below the engine's MLR floor carries its own rationale into
      // the LOC history so the deviation is auditable, not silent.
      const belowFloorNote = draft.layer3.belowFloorReason?.trim()
        ? ` [Below-floor override → Final ${draft.layer3.finalLevel} under ${liveResult?.mlrFloor ?? "floor"}: ${draft.layer3.belowFloorReason.trim()}]`
        : "";
      const overrideNote = draft.layer3.overrideReason?.trim()
        ? ` [Override → Final ${draft.layer3.finalLevel} vs suggested ${liveResult?.suggestedLevel ?? "band"}: ${draft.layer3.overrideReason.trim()}]`
        : "";
      const baseNote = openedForPcg ? `Reassessed for a private caregiver request. ${draft.layer3.finalLevelJustification ?? ""}`.trim() : (draft.layer3.finalLevelJustification ?? "");
      void recordLocChange({
        residentId: draft.layer1.residentId,
        admissionId: draft.layer1.convertedAdmissionId,
        residentName: draft.layer1.residentName,
        level: draft.layer3.finalLevel,
        source: openedForPcg ? "PRIVATE_CAREGIVER" : (draft.layer3.priorAssessmentId ? "REASSESSMENT" : "PRE_ADMISSION"),
        assessmentId: draft.id,
        rawScore: assessmentRawScore(draft),
        by: me || "Clinician",
        role: roleLabel,
        notes: `${baseNote}${belowFloorNote}${overrideNote}`.trim() || undefined,
      });
    }
  };

  const remove = async (a: AssessmentV42) => {
    const c = await Swal.fire({ title: "Delete assessment?", text: `Remove the v4.2 assessment for ${a.layer1?.residentName || "this resident"}?`, icon: "warning", showCancelButton: true, confirmButtonColor: "#e11d48", confirmButtonText: "Delete" });
    if (!c.isConfirmed) return;
    await persist(assessments.filter((x) => x.id !== a.id));
  };

  const startReassessment = async (prior: AssessmentV42) => {
    const c = await Swal.fire({ title: "Start reassessment?", text: "Creates a new draft carrying this clinical picture forward.", icon: "question", showCancelButton: true, confirmButtonColor: "#2E4A48", confirmButtonText: "Start" });
    if (!c.isConfirmed) return;
    const clone = cloneForReassessment(prior, newId(), new Date().toISOString());
    clone.origin = origin;
    await persist([clone, ...assessments]);
    openEdit(clone);
  };

  // The narrative report reads Layer 1 clinical fields. A reassessment raised from
  // Care Acuity (pick-resident) starts with a blank Layer 1, so backfill from the
  // resident's richest prior assessment and their Resident record before printing —
  // otherwise the Clinical Summary collapses to "<name> is a resident."
  const openNarrativeReport = (a: AssessmentV42) => {
    const s = (v: unknown) => (v == null ? "" : String(v));
    const cur = a.layer1 || ({} as AssessmentV42["layer1"]);
    const rid = s(cur.residentId);
    const nm = s(cur.residentName).trim().toLowerCase();
    const rich = (x?: AssessmentV42) => !!x && !!(s(x.layer1?.diagnoses).trim() || s(x.layer1?.medications).trim() || s(x.layer1?.reasonForAdmission).trim() || s(x.layer1?.dateOfBirth).trim());
    const sameResident = (x: AssessmentV42) => x.id !== a.id && ((!!rid && s(x.layer1?.residentId) === rid) || (!!nm && s(x.layer1?.residentName).trim().toLowerCase() === nm));
    const src = [
      assessments.find((x) => x.id === a.layer3?.priorAssessmentId),
      ...assessments.filter(sameResident).sort((x, y) => s(y.updatedAt).localeCompare(s(x.updatedAt))),
    ].filter((x): x is AssessmentV42 => !!x).find(rich)?.layer1;
    const resident = residentRows.find((r) => (!!rid && s(r.id) === rid) || (!!nm && `${s(r.firstName)} ${s(r.lastName)}`.trim().toLowerCase() === nm));
    const pick = (...vals: Array<string | undefined>) => vals.map((v) => s(v).trim()).find(Boolean) || undefined;
    const enriched: AssessmentV42 = {
      ...a,
      layer1: {
        ...cur,
        dateOfBirth: pick(cur.dateOfBirth, src?.dateOfBirth, resident?.dateOfBirth ? s(resident.dateOfBirth).slice(0, 10) : undefined),
        sex: pick(cur.sex, src?.sex, resident?.gender),
        age: pick(cur.age, src?.age),
        diagnoses: pick(cur.diagnoses, src?.diagnoses, resident?.diagnosis, resident?.medicalHistory),
        medications: pick(cur.medications, src?.medications),
        allergies: pick(cur.allergies, src?.allergies, resident?.allergies),
        surgeries: pick(cur.surgeries, src?.surgeries),
        reasonForAdmission: pick(cur.reasonForAdmission, src?.reasonForAdmission),
      },
    };
    printNarrativeReport(enriched);
  };

  const q = search.trim().toLowerCase();
  const filtered = assessments.filter((a) => !q || (a.layer1?.residentName || "").toLowerCase().includes(q));
  const stat = (lvl: CareLevel) =>
    assessments.filter((a) => (a.layer3?.finalLevel ?? (a.status !== "DRAFT" ? classifyAssessment(a).suggestedLevel : undefined)) === lvl).length;

  // When embedded inside another board (e.g. Care Acuity), suppress this
  // component's own page chrome + big H1 so it composes cleanly: render a light
  // container (just the New-Assessment control, stats, list and modals) instead
  // of the full ClinicalPage + ClinicalHeader.
  const body = (
    <>
      {/* When embedded (Care Acuity), the host board renders the header, stats and
          the New-Assessment button; we only render the search + list here. */}
      {!embedded && (
        <ClinicalHeader
          title="Resident Assessment (v4.2)"
          subtitle="LifeCare Resident Assessment v4.2 — three-layer assessment. 14 scored domains (raw /56, advisory), deterministic MLR-floor engine, and a nurse-confirmed Final Level of Care. Replaces the legacy 50-point pre-admission form."
          right={<ClinicalButton variant="accent" onClick={openNew}><Plus className="w-4 h-4" /> New Assessment</ClinicalButton>}
        />
      )}

      {/* Level distribution — hidden when embedded (Care Acuity shows its own stats). */}
      {!embedded && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Total" value={assessments.length} accent="ink" />
          {LEVELS.map((l) => <StatCard key={l} label={LEVEL_LABEL[l]} value={stat(l)} accent={LEVEL_ACCENT[l]} />)}
        </div>
      )}


      {!modalOnly && (<>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by resident name…" className="max-w-sm flex-1" />
        <div className="inline-flex items-center rounded-lg border p-0.5" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)" }} role="group" aria-label="View mode">
          {([["grid", LayoutGrid, "Grid"], ["table", Table2, "Table"]] as const).map(([mode, Icon, label]) => (
            <button key={mode} type="button" onClick={() => setViewMode(mode)} aria-pressed={viewMode === mode} title={`${label} view`}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${viewMode === mode ? "bg-[var(--clinical-panel)] text-white shadow-sm" : "text-[var(--clinical-muted)] hover:text-[var(--clinical-ink)]"}`}>
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <DataState
        loading={loading && assessments.length === 0}
        error={error}
        empty={filtered.length === 0}
        emptyTitle={assessments.length === 0 ? "No assessments yet" : "No matches"}
        emptyHint={assessments.length === 0 ? "Click New Assessment to assess a resident on the v4.2 model." : "Try a different resident name."}
        emptyAction={assessments.length === 0 ? <ClinicalButton variant="accent" onClick={openNew}><Plus className="w-4 h-4" /> New Assessment</ClinicalButton> : undefined}
        onRetry={() => void refetch()}
        skeletonRows={3}
      >
        {viewMode === "table" ? (
          <AssessmentTable rows={filtered} onEdit={openEdit} onRemove={remove} onReport={openNarrativeReport} locBadge={locBadge} />
        ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((a) => {
            const res = a.status !== "DRAFT" ? classifyAssessment(a) : null;
            const raw = assessmentRawScore(a);
            const eff = a.layer3?.finalLevel ?? res?.suggestedLevel ?? null;
            const overridden = a.layer3?.finalLevel && res && a.layer3.finalLevel !== res.suggestedLevel;
            const top = a.status === "VALIDATED" ? "teal" : a.status === "COMPLETED" ? "green" : "amber";
            return (
              <ClinicalCard key={a.id} top={top} className="group flex flex-col gap-3.5 p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_36px_-24px_rgba(15,23,42,0.5)] sm:p-5">
                {/* header — avatar · identity · status · action cluster */}
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold" style={{ backgroundColor: eff ? `color-mix(in srgb, ${LEVEL_COLOR[eff]} 15%, transparent)` : "var(--clinical-surface-2)", color: eff ? LEVEL_COLOR[eff] : "var(--clinical-ink-soft)", boxShadow: eff ? `inset 0 0 0 1px color-mix(in srgb, ${LEVEL_COLOR[eff]} 32%, transparent)` : "none" }}>
                    {initials(a.layer1?.residentName || "")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-bold text-[var(--clinical-ink)]">{a.layer1?.residentName || "Unnamed resident"}</h3>
                    <p className="mt-0.5 text-xs text-[var(--clinical-muted)]">{a.layer1?.assessmentDate || (a.updatedAt || "").slice(0, 10)} · {a.modelVersion}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {a.status === "VALIDATED" ? <StatusPill status="APPROVED">Validated</StatusPill> : <StatusPill status={a.status} />}
                    {locBadge(a.id)}
                    <div className="flex items-center gap-1">
                      {a.status === "VALIDATED" && <button onClick={() => openNarrativeReport(a)} aria-label="Generate narrative report" title="Generate narrative report (PDF)" className="rounded-md p-1 text-[var(--clinical-panel)] transition hover:bg-[var(--clinical-surface-2)]"><FileText className="h-3.5 w-3.5" /></button>}
                      <button onClick={() => openEdit(a)} aria-label="Edit assessment" title="Edit assessment" className="rounded-md p-1 text-[var(--clinical-ink-soft)] transition hover:bg-[var(--clinical-surface-2)] hover:text-[var(--clinical-panel)]"><Pencil className="h-3.5 w-3.5" /></button>
                      <button onClick={() => remove(a)} aria-label="Delete" title="Delete assessment" className="rounded-md p-1 text-[var(--clinical-coral)] transition hover:bg-[color-mix(in_srgb,var(--clinical-coral)_10%,transparent)]"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                </div>

                {/* badges — soft tinted chips (a dot/icon carries the semantic; never a heavy solid button) */}
                {(a.status === "COMPLETED" || (res && res.capabilityGate) || a.layer3?.priorAssessmentId || a.layer1?.convertedAdmissionId) && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {a.status === "COMPLETED" && (
                      <button
                        type="button"
                        onClick={() => openEdit(a, 3)}
                        title="Sign off the Final Level of Care in Layer 3 · Evaluation"
                        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-95"
                        style={{ backgroundColor: "color-mix(in srgb, var(--clinical-amber) 14%, transparent)", borderColor: "color-mix(in srgb, var(--clinical-amber) 32%, transparent)", color: "var(--clinical-amber)" }}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" /> Awaiting validation
                      </button>
                    )}
                    {res && res.capabilityGate && <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--clinical-coral) 14%, transparent)", borderColor: "color-mix(in srgb, var(--clinical-coral) 32%, transparent)", color: "var(--clinical-coral)" }}><AlertTriangle className="h-3.5 w-3.5" /> Capability gate</span>}
                    {a.layer3?.priorAssessmentId && <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold text-[var(--clinical-ink-soft)]" style={{ backgroundColor: "var(--clinical-surface-2)", borderColor: "var(--clinical-line)" }}><RefreshCw className="h-3.5 w-3.5" /> Reassessment</span>}
                    {a.layer1?.convertedAdmissionId && <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--clinical-panel) 12%, transparent)", borderColor: "color-mix(in srgb, var(--clinical-panel) 28%, transparent)", color: "var(--clinical-panel)" }}>From CRM</span>}
                  </div>
                )}

                {/* level of care + acuity gauge */}
                <div className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--clinical-line)" }}>
                  {eff && (
                    <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ backgroundColor: `color-mix(in srgb, ${LEVEL_COLOR[eff]} 12%, var(--clinical-surface))`, borderBottom: "1px solid var(--clinical-line)" }}>
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-[0.1em]" style={{ color: LEVEL_COLOR[eff] }}>Level of Care</p>
                        <p className="truncate text-sm font-bold text-[var(--clinical-ink)]">{levelMeta(Number(eff.replace("L", "")) || 2).name}</p>
                      </div>
                      <span className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-bold text-white shadow-sm" style={{ background: LEVEL_COLOR[eff] }}>{LEVEL_LABEL[eff]}{overridden ? " · override" : ""}</span>
                    </div>
                  )}
                  <div className="px-4 py-3" style={{ backgroundColor: "var(--clinical-surface-2)" }}>
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--clinical-muted)]">Raw acuity</p>
                      <p className="flex items-baseline gap-1"><span className="text-lg font-bold tabular-nums text-[var(--clinical-ink)]">{raw}</span><span className="text-xs text-[var(--clinical-muted)]">/ {RAW_MAX}</span></p>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: "var(--clinical-line)" }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.round((raw / RAW_MAX) * 100))}%`, background: eff ? LEVEL_COLOR[eff] : "var(--clinical-panel)" }} />
                    </div>
                  </div>
                </div>
              </ClinicalCard>
            );
          })}
        </div>
        )}
      </DataState>
      </>)}

      {/* Three-layer form modal */}
      {open && draft && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div role="dialog" aria-modal="true" aria-label="Resident assessment v4.2" className="flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl shadow-2xl sm:max-h-[92vh] sm:max-w-3xl sm:rounded-2xl" style={{ backgroundColor: "var(--clinical-ground)" }}>
            {/* Header */}
            <div className="flex flex-none items-center justify-between px-5 py-4 text-white" style={{ backgroundColor: "var(--clinical-panel)" }}>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/75">Resident Assessment v4.2</p>
                <h2 className="text-lg font-bold truncate" style={{ fontFamily: DISPLAY }}>{draft.layer1.residentName || "New Assessment"}</h2>
              </div>
              <button onClick={() => closeModal()} aria-label="Close" className="rounded-lg p-2 hover:bg-white/10"><X className="w-5 h-5" /></button>
            </div>

            {/* Live raw-score bar (out of 56) */}
            <div className="flex flex-none flex-wrap items-center justify-between gap-3 px-5 py-2.5 text-white" style={{ backgroundColor: "color-mix(in srgb, var(--clinical-panel) 82%, black)" }}>
              <div className="flex items-center gap-2 text-xs text-white/80">
                <Gauge className="w-4 h-4" />
                <span>Running raw acuity (14 scored domains)</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="hidden sm:block w-40 h-2 rounded-full bg-white/20 overflow-hidden">
                  <div className="h-full rounded-full bg-white/85" style={{ width: `${Math.round((liveRaw / RAW_MAX) * 100)}%` }} />
                </div>
                <span className="text-xl font-bold tabular-nums">{liveRaw}<span className="text-sm text-white/75 font-medium">/{RAW_MAX}</span></span>
              </div>
            </div>

            {/* Layer tabs */}
            <div className="flex flex-none border-b" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)" }}>
              {([[1, "Layer 1 · Profile & History"], [2, "Layer 2 · 14 Domains"], [3, "Layer 3 · Evaluation"]] as const).map(([n, lbl]) => (
                <button key={n} type="button" onClick={() => setLayer(n)}
                  className={`flex-1 px-3 py-2.5 text-xs font-semibold border-b-2 transition ${layer === n ? "border-[var(--clinical-panel)] text-[var(--clinical-panel)]" : "border-transparent text-[var(--clinical-muted)] hover:text-[var(--clinical-ink)]"}`}>
                  <span className="inline-flex items-center gap-1.5"><Layers className="w-3.5 h-3.5" />{lbl}</span>
                </button>
              ))}
            </div>

            {/* Body */}
            <div ref={bodyRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 scrollbar-thin sm:p-5">
              {/* Provenance banner — opened from a private-caregiver request (DT-013). */}
              {pcgOpen && (() => {
                const eff = draft.layer3?.finalLevel ?? liveResult?.suggestedLevel ?? null;
                return (
                  <div className="flex items-start gap-2 rounded-xl border px-4 py-3" style={{ borderColor: "var(--clinical-panel)", backgroundColor: "color-mix(in srgb, var(--clinical-panel) 8%, var(--clinical-surface))" }}>
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--clinical-panel)]" />
                    <div className="text-xs">
                      <p className="font-bold text-[var(--clinical-panel)]">Reassessment for a Private Caregiver request</p>
                      <p className="mt-0.5 text-[var(--clinical-ink-soft)]">Opened from <b>Assign Private Caregiver</b>. {eff ? <>Current Level of Care: <b>{LEVEL_LABEL[eff]}</b>. </> : null}Document why shared 1:6 staffing is insufficient (DT-013) and confirm the Final Level of Care.</p>
                    </div>
                  </div>
                );
              })()}
              {/* ── LAYER 1 ── */}
              {layer === 1 && (
                <>
                  <Section code="A" title="Resident Profile & Clinical Context">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <ResidentPicker label="First Name *" value={draft.layer1.firstName ?? ""} onChange={(v) => { setNamePart({ firstName: v }); }}
                          admissions={isAcuity ? residentOpts : admissionOpts}
                          linkedId={isAcuity ? (draft.layer1.residentId ?? "") : linkedAdmissionId}
                          linkedLabel={isAcuity ? "Resident" : "From CRM"}
                          placeholder={isAcuity ? "Search admitted residents…" : "Search converted leads or type a name…"}
                          emptyHint={isAcuity ? "No admitted residents match — keep typing to enter a name." : "No in-progress admissions match — keep typing to enter a new name."}
                          optionFallback={isAcuity ? "Admitted resident" : "Converted lead · in-progress admission"}
                          onPick={isAcuity ? pickResident : pickAdmission}
                          onUnlink={isAcuity ? () => patchLayer1({ residentId: undefined }) : () => { setLinkedAdmissionId(""); patchLayer1({ convertedAdmissionId: undefined }); }} />
                        <Text label="Middle Name (optional)" value={draft.layer1.middleName} onChange={(v) => setNamePart({ middleName: v })} />
                        <Text label="Last Name *" value={draft.layer1.lastName} onChange={(v) => setNamePart({ lastName: v })} />
                      </div>
                      <div className="sm:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Text label="Assessment Date" type="date" value={draft.layer1.assessmentDate} onChange={(v) => patchLayer1({ assessmentDate: v })} />
                        <Text label="Date of Birth" type="date" value={draft.layer1.dateOfBirth} onChange={(v) => patchLayer1({ dateOfBirth: v, age: ageFromDob(v) })} />
                        <Text label="Age" value={draft.layer1.age || ageFromDob(draft.layer1.dateOfBirth)} onChange={(v) => patchLayer1({ age: v })} placeholder="Auto from DOB" />
                        <Text label="Sex" value={draft.layer1.sex} onChange={(v) => patchLayer1({ sex: v })} placeholder="M / F" />
                      </div>
                      <Text label="Assessment Location" value={draft.layer1.assessmentLocation ?? draft.layer1.location} onChange={(v) => patchLayer1({ assessmentLocation: v })} />
                      <Text label="Primary Contact / Relationship" value={draft.layer1.primaryContact} onChange={(v) => patchLayer1({ primaryContact: v })} placeholder="Name — relationship" />
                      <Text label="Contact No." value={draft.layer1.contactNo} onChange={(v) => patchLayer1({ contactNo: v })} />
                      <Text label="Referral Source" value={draft.layer1.referralSource} onChange={(v) => patchLayer1({ referralSource: v })} />
                      <Text label="Assessor / Role" value={draft.layer1.assessor} onChange={(v) => patchLayer1({ assessor: v })} placeholder="Name — role" />
                      <Text label="Current Living Arrangement" value={draft.layer1.currentLivingArrangement} onChange={(v) => patchLayer1({ currentLivingArrangement: v })} />
                      <Text label="Primary Caregiver" value={draft.layer1.primaryCaregiver} onChange={(v) => patchLayer1({ primaryCaregiver: v })} />
                      <Text label="Reason for Admission / Referral" value={draft.layer1.reasonForAdmission} onChange={(v) => patchLayer1({ reasonForAdmission: v })} />
                      <Text label="Admission Target Date" type="date" value={draft.layer1.admissionTargetDate} onChange={(v) => patchLayer1({ admissionTargetDate: v })} />
                    </div>
                  </Section>

                  <Section code="B" title="Clinical History" subtitle="Non-scored clinical baseline">
                    <Area label="Primary / current diagnoses" value={draft.layer1.diagnoses} onChange={(v) => patchLayer1({ diagnoses: v })} />
                    <Area label="Significant history / surgeries" value={draft.layer1.surgeries} onChange={(v) => patchLayer1({ surgeries: v })} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Text label="Allergies" value={draft.layer1.allergies} onChange={(v) => patchLayer1({ allergies: v })} />
                      <Choice label="Medication list reviewed?" value={draft.layer1.medicationListReviewed}
                        onChange={(v) => patchLayer1({ medicationListReviewed: v as AssessmentLayer1["medicationListReviewed"] })}
                        options={[{ value: "YES", label: "Yes" }, { value: "NO", label: "No" }, { value: "NEEDS_VERIFICATION", label: "Needs Verification" }]} />
                    </div>
                    <MedicationsEditor
                      value={draft.layer1.medicationList ?? medItemsOf(draft.layer1)}
                      onChange={(list) => patchLayer1({ medicationList: list })}
                    />
                    <div className="flex flex-wrap items-end gap-3">
                      <Bool label="Hospital / ED within 12 months?" value={draft.layer1.hospitalEd12mo} onChange={(v) => patchLayer1({ hospitalEd12mo: v })} />
                      {draft.layer1.hospitalEd12mo && <div className="flex-1 min-w-[200px]"><Text label="Reason / date" value={draft.layer1.hospitalEdReason} onChange={(v) => patchLayer1({ hospitalEdReason: v })} /></div>}
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                      <Bool label="Significant change in condition (last 30–90 days)?" value={draft.layer1.significantChange3090} onChange={(v) => patchLayer1({ significantChange3090: v })} />
                      {draft.layer1.significantChange3090 && <div className="flex-1 min-w-[200px]"><Text label="Describe" value={draft.layer1.significantChangeDescribe} onChange={(v) => patchLayer1({ significantChangeDescribe: v })} /></div>}
                    </div>
                    <Text label="Current physician / specialist follow-up" value={draft.layer1.physicianFollowUp} onChange={(v) => patchLayer1({ physicianFollowUp: v })} />
                  </Section>

                  <Section code={NS01?.code ?? "NS-01"} title="Decision Support & Person-Centered Baseline" subtitle={`Non-scored — ${NS01?.calibrationNote ?? "do not add to acuity score."}`}>
                    <Choice label="Can resident participate in care decisions?" value={draft.layer1.canParticipate}
                      onChange={(v) => patchLayer1({ canParticipate: v as AssessmentLayer1["canParticipate"] })}
                      options={[{ value: "INDEPENDENTLY", label: "Independently" }, { value: "WITH_SUPPORT", label: "With support" }, { value: "LIMITED_NO", label: "Limited / No" }]} />
                    <Text label="Authorized decision-maker / representative (name / relationship)" value={draft.layer1.authorizedRepresentative} onChange={(v) => patchLayer1({ authorizedRepresentative: v })} />
                    <div>
                      <MultiChoice label="Family involvement desired" values={draft.layer1.familyInvolvement}
                        onToggle={(v) => toggleLayer1Multi("familyInvolvement", v)}
                        options={[{ value: "ROUTINE", label: "Routine updates" }, { value: "SIGNIFICANT", label: "Significant changes only" }, { value: "SHARED", label: "Shared decisions" }, { value: "OTHER", label: "Other" }]} />
                      {draft.layer1.familyInvolvement?.includes("OTHER") && <div className="mt-2"><Text label="Other — describe" value={draft.layer1.familyInvolvementOther} onChange={(v) => patchLayer1({ familyInvolvementOther: v })} /></div>}
                    </div>
                    <Choice label="Advance directive / POLST / goals-of-care document" value={draft.layer1.advanceDirective}
                      onChange={(v) => patchLayer1({ advanceDirective: v as AssessmentLayer1["advanceDirective"] })}
                      options={[{ value: "AVAILABLE", label: "Available" }, { value: "REQUESTED", label: "Requested" }, { value: "NOT_AVAILABLE", label: "Not available" }, { value: "NOT_APPLICABLE", label: "Not applicable" }]} />
                    <Text label="Important cultural / spiritual / privacy preferences" value={draft.layer1.culturalPreferences} onChange={(v) => patchLayer1({ culturalPreferences: v })} />
                    <div>
                      <MultiChoice label="Resident's overall goals" values={draft.layer1.overallGoals}
                        onToggle={(v) => toggleLayer1Multi("overallGoals", v)}
                        options={[{ value: "INDEPENDENCE", label: "Maintain independence" }, { value: "FUNCTION", label: "Improve function" }, { value: "COMFORT", label: "Comfort / safety" }, { value: "SOCIAL", label: "Social engagement" }, { value: "OTHER", label: "Other" }]} />
                      {draft.layer1.overallGoals?.includes("OTHER") && <div className="mt-2"><Text label="Other — describe" value={draft.layer1.overallGoalsOther} onChange={(v) => patchLayer1({ overallGoalsOther: v })} /></div>}
                    </div>
                    <Area label="Additional goals / preferences (free text)" rows={2} value={draft.layer1.goalsPreferences} onChange={(v) => patchLayer1({ goalsPreferences: v })} placeholder={NS01?.evidenceRequired} />
                  </Section>
                </>
              )}

              {/* ── LAYER 2 ── */}
              {layer === 2 && <DomainScoreGrid domains={draft.domains} onPatch={patchDomain} />}

              {/* ── LAYER 3 ── */}
              {layer === 3 && liveResult && (
                <>
                  <Section title="Advisory Classification" subtitle="Read-only engine output. The nurse confirms the Final LOC below.">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="rounded-lg border p-3" style={{ borderColor: "var(--clinical-line)" }}>
                        <MicroLabel>Raw Acuity</MicroLabel>
                        <p className="text-2xl font-bold text-[var(--clinical-panel)] mt-0.5 tabular-nums">{liveResult.rawScore}<span className="text-sm text-[var(--clinical-muted)]">/{RAW_MAX}</span></p>
                      </div>
                      <div className="rounded-lg border p-3 sm:col-span-2" style={{ borderColor: LEVEL_COLOR[liveResult.advisoryBand], background: `color-mix(in srgb, ${LEVEL_COLOR[liveResult.advisoryBand]} 8%, transparent)` }}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white px-2.5 py-1 rounded" style={{ background: LEVEL_COLOR[liveResult.advisoryBand] }}>{LEVEL_LABEL[liveResult.advisoryBand]}</span>
                          <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--clinical-coral)]">Advisory — not calibrated (GAP-001)</span>
                        </div>
                        <p className="text-[11px] text-[var(--clinical-muted)] mt-1.5">Suggested LOC (engine): <b className="text-[var(--clinical-ink)]">{LEVEL_LABEL[liveResult.suggestedLevel]}</b>{liveResult.mlrFloor ? ` · MLR floor ${liveResult.mlrFloor}` : ""}</p>
                      </div>
                    </div>
                    {liveResult.capabilityGate && (
                      <div className="rounded-lg border px-3 py-2 text-xs flex items-start gap-2" style={{ borderColor: "var(--clinical-coral)", backgroundColor: "color-mix(in srgb, var(--clinical-coral) 8%, transparent)" }}>
                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-[var(--clinical-coral)]" />
                        <span className="text-[var(--clinical-ink)]"><b>Capability gate required.</b> Verify LifeCare can safely deliver this level + modifiers. Emergency needs are never delayed by revenue.</span>
                      </div>
                    )}
                  </Section>

                  <Section title="Triggered Minimum-Level Rules">
                    {liveResult.appliedMlrs.length === 0 ? (
                      <p className="text-xs text-[var(--clinical-muted)]">No Minimum-Level Rules triggered from the current scores/context.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {liveResult.appliedMlrs.map((r) => (
                          <li key={r.id} className="flex items-start gap-2 text-xs">
                            <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded text-white" style={{ background: r.minimumLevel ? "var(--clinical-panel)" : "var(--clinical-muted)" }}>{r.id}{r.minimumLevel ? ` → ${r.minimumLevel}` : " · modifier"}</span>
                            <span className="text-[var(--clinical-ink-soft)]">{r.criticalNeed}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Section>

                  <Section title="Suggested Clinical Modifiers">
                    {liveResult.modifiers.length === 0 ? (
                      <p className="text-xs text-[var(--clinical-muted)]">No modifiers suggested from the current scores/context.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {liveResult.modifiers.map((id) => {
                          const m = modifierById(id);
                          return <span key={id} className="text-[11px] font-medium px-2 py-1 rounded text-[var(--clinical-panel)]" style={{ backgroundColor: "color-mix(in srgb, var(--clinical-panel) 12%, transparent)" }} title={m?.taskPlanEffect}>{id}{m ? ` · ${m.name}` : ""}</span>;
                        })}
                      </div>
                    )}
                  </Section>

                  <Section title="Modifier Reconciliation" subtitle="Every suggested or in-flow modifier needs an explicit clinical disposition before Final LOC approval.">
                    {modifierReviewIds.length === 0 ? (
                      <p className="text-xs text-[var(--clinical-muted)]">No modifiers require reconciliation. Record as none through the validation trace.</p>
                    ) : (
                      <div className="space-y-3">
                        {modifierReviewIds.map((id) => {
                          const legacyApplied = draft.layer3.reconciledModifiers?.includes(id);
                          const review = draft.layer3.modifierReconciliations?.[id] ?? (legacyApplied ? { decision: "APPLIED" as const, rationale: "" } : undefined);
                          const modifier = modifierById(id);
                          return (
                            <div key={id} className="rounded-xl border p-3" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)" }}>
                              <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold text-[var(--clinical-ink)]">{id}{modifier ? ` · ${modifier.name}` : ""}</p>
                                  {modifier?.taskPlanEffect && <p className="mt-0.5 text-xs text-[var(--clinical-muted)]">{modifier.taskPlanEffect}</p>}
                                </div>
                                <div className="flex shrink-0 flex-wrap gap-1.5" role="group" aria-label={`${id} reconciliation`}>
                                  <button type="button" onClick={() => reconcileModifier(id, "APPLIED", review?.rationale)} className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${review?.decision === "APPLIED" ? chipOn : chipOff}`}>Apply</button>
                                  <button type="button" onClick={() => reconcileModifier(id, "NOT_APPLICABLE", review?.rationale)} className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${review?.decision === "NOT_APPLICABLE" ? chipOn : chipOff}`}>Not applicable</button>
                                </div>
                              </div>
                              {review?.decision === "NOT_APPLICABLE" && (
                                <div className="mt-3">
                                  <Text label="Not-applicable rationale *" value={review.rationale} onChange={(v) => reconcileModifier(id, "NOT_APPLICABLE", v)} placeholder="Why this modifier does not apply to the resident…" />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Section>

                  <Section title="Clinical Context" subtitle="Flags the score cannot infer — feed the engine live.">
                    <div className="flex flex-wrap gap-2">
                      <Bool label="L5 palliative pathway authorized" value={draft.context.l5PathwayAuthorized} onChange={(v) => patchContext({ l5PathwayAuthorized: v })} />
                      <Bool label="Acute instability" value={draft.context.acuteInstability} onChange={(v) => patchContext({ acuteInstability: v })} />
                      <Bool label="Recent hospitalization" value={draft.context.recentHospitalization} onChange={(v) => patchContext({ recentHospitalization: v })} />
                      <Bool label="Dysphagia" value={draft.context.dysphagia} onChange={(v) => patchContext({ dysphagia: v })} />
                      <Bool label="Unintended weight loss" value={draft.context.weightLoss} onChange={(v) => patchContext({ weightLoss: v })} />
                    </div>
                  </Section>

                  {liveResult.capabilityGate && (
                    <Section title="Capability Review" subtitle="Required before downstream LOC, fee or care-plan activation.">
                      <div className="flex flex-wrap gap-2" role="group" aria-label="Capability review outcome">
                        {CAPABILITY_OUTCOMES.map((option) => (
                          <button key={option.value} type="button"
                            onClick={() => patchLayer3({ capabilityReview: { outcome: option.value, rationale: draft.layer3.capabilityReview?.rationale ?? "" } })}
                            className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${draft.layer3.capabilityReview?.outcome === option.value ? chipOn : chipOff}`}>
                            {option.label}
                          </button>
                        ))}
                      </div>
                      <Area label="Capability review rationale *" rows={3} value={draft.layer3.capabilityReview?.rationale}
                        onChange={(v) => patchLayer3({ capabilityReview: { outcome: draft.layer3.capabilityReview?.outcome ?? "WITHIN_CAPABILITY", rationale: v } })}
                        placeholder="Document approved scope, staffing/equipment capability, and the safe disposition…" />
                    </Section>
                  )}

                  <Section title="Final Level of Care" subtitle="Nurse-confirmed. Never auto-applies the advisory band.">
                    <div>
                      <MicroLabel className="mb-1.5">Final LOC *</MicroLabel>
                      <div className="flex flex-wrap gap-1.5">
                        {LEVELS.map((l) => (
                          <button key={l} type="button" onClick={() => patchLayer3({ finalLevel: l })}
                            className={`px-3 py-2 rounded-lg text-sm font-semibold border transition ${draft.layer3.finalLevel === l ? "text-white border-transparent" : chipOff}`}
                            style={draft.layer3.finalLevel === l ? { background: LEVEL_COLOR[l] } : undefined}>
                            {LEVEL_LABEL[l]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <Area label="Final LOC Justification *" rows={3} value={draft.layer3.finalLevelJustification} onChange={(v) => patchLayer3({ finalLevelJustification: v })} placeholder="What does this resident actually need? Reconcile the score, MLR floors, modifiers and override." />
                    {/* Below-floor override — the nurse/CM may set a Final LOC under the engine's
                        MLR floor, but must document why (G3 soft gate). Kept in LOC history. */}
                    {!!liveResult.mlrFloor && !!draft.layer3.finalLevel && Number(draft.layer3.finalLevel.slice(1)) < Number(liveResult.mlrFloor.slice(1)) && (
                      <div className="rounded-lg border p-3" style={{ borderColor: "color-mix(in srgb, var(--clinical-amber) 40%, transparent)", background: "color-mix(in srgb, var(--clinical-amber) 8%, transparent)" }}>
                        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--clinical-amber)]"><AlertTriangle className="h-3.5 w-3.5" /> Final {LEVEL_LABEL[draft.layer3.finalLevel]} is below the engine&rsquo;s {LEVEL_LABEL[liveResult.mlrFloor]} minimum-level floor</p>
                        <Area label="Below-floor override reason *" rows={2} value={draft.layer3.belowFloorReason} onChange={(v) => patchLayer3({ belowFloorReason: v })} placeholder="Clinical reason for confirming a Final LOC below the engine's minimum-level floor…" />
                      </div>
                    )}
                    {/* Advisory-band override — the Final LOC differs from the engine's
                        suggested band but is NOT below the MLR floor (that case uses the
                        below-floor reason above). Capture why, for the LOC audit trail. */}
                    {!!liveResult.suggestedLevel && !!draft.layer3.finalLevel && draft.layer3.finalLevel !== liveResult.suggestedLevel && !(!!liveResult.mlrFloor && Number(draft.layer3.finalLevel.slice(1)) < Number(liveResult.mlrFloor.slice(1))) && (
                      <div className="rounded-lg border p-3" style={{ borderColor: "color-mix(in srgb, var(--clinical-panel) 40%, transparent)", background: "color-mix(in srgb, var(--clinical-panel) 6%, transparent)" }}>
                        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--clinical-panel)]"><AlertTriangle className="h-3.5 w-3.5" /> Final {LEVEL_LABEL[draft.layer3.finalLevel]} overrides the engine&rsquo;s suggested {LEVEL_LABEL[liveResult.suggestedLevel]}</p>
                        <Area label="Reason for overriding *" rows={2} value={draft.layer3.overrideReason} onChange={(v) => patchLayer3({ overrideReason: v })} placeholder="Clinical reason for confirming a Final LOC different from the engine's suggested band…" />
                      </div>
                    )}
                  </Section>

                  <Section title="DT-013 · Private Caregiver Review" subtitle="Separate determination — LOC never decides it.">
                    <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)" }}>
                      <div className="flex items-center gap-2 mb-1">
                        {liveResult.dt013.recommendReview ? <StatusPill status="REQUESTED">Review recommended</StatusPill> : <StatusPill status="NORMAL">No indicators</StatusPill>}
                      </div>
                      <p className="text-[var(--clinical-ink-soft)]">{liveResult.dt013.rationale}</p>
                      {liveResult.dt013.triggers.length > 0 && (
                        <ul className="mt-1.5 list-disc pl-4 space-y-0.5 text-[var(--clinical-muted)]">{liveResult.dt013.triggers.map((t, i) => <li key={i}>{t}</li>)}</ul>
                      )}
                    </div>
                  </Section>

                  <Section title="DT-014 · Additional Clinical Services Review" subtitle="Separate determination — run the anti-double-charge test.">
                    <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)" }}>
                      <div className="flex items-center gap-2 mb-1">
                        {liveResult.dt014.recommendReview ? <StatusPill status="REQUESTED">Review recommended</StatusPill> : <StatusPill status="NORMAL">No indicators</StatusPill>}
                      </div>
                      <p className="text-[var(--clinical-ink-soft)]">{liveResult.dt014.rationale}</p>
                      {liveResult.dt014.triggers.length > 0 && (
                        <ul className="mt-1.5 list-disc pl-4 space-y-0.5 text-[var(--clinical-muted)]">{liveResult.dt014.triggers.map((t, i) => <li key={i}>{t}</li>)}</ul>
                      )}
                    </div>
                  </Section>

                  <Section code="H" title="Reassessment">
                    <div>
                      <MicroLabel className="mb-1.5">Reassessment Interval</MicroLabel>
                      <div className="flex flex-wrap gap-1.5">
                        {REASSESSMENT_OPTIONS.map((o) => (
                          <button key={o} type="button" onClick={() => patchLayer3({ reassessmentInterval: o, nextReviewDate: nextReviewFor(o) })} className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${draft.layer3.reassessmentInterval === o ? chipOn : chipOff}`}>{o}</button>
                        ))}
                      </div>
                    </div>
                    <Text label="Next Review Date" type="date" value={draft.layer3.nextReviewDate} onChange={(v) => patchLayer3({ nextReviewDate: v })} />
                    {editingId && (
                      <ClinicalButton variant="secondary" size="sm" onClick={() => draft && startReassessment(draft)}><RefreshCw className="w-3.5 h-3.5" /> Start Reassessment</ClinicalButton>
                    )}
                  </Section>

                  {/* Validation block (nurse → admin) */}
                  <ValidationBlock draft={draft} roleLabel={roleLabel} onChange={(v) => patchLayer3({ validationDraft: v })} onValidate={(decision, notes) => { setPinValidate({ decision, notes }); setShowPin(true); }} busy={saving} />
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex flex-none items-center justify-between gap-2 border-t px-5 py-3.5" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)" }}>
              <span className="text-xs text-[var(--clinical-muted)]">
                {completionIssues.length > 0
                  ? `${completionIssues.length} item${completionIssues.length > 1 ? "s" : ""} left across Layers 1–3`
                  : `${editingId ? "Editing" : "New"} · ${roleLabel}`}
              </span>
              <div className="flex items-center gap-2">
                <ClinicalButton variant="secondary" size="sm" onClick={() => save("DRAFT", {}, "Draft saved")} disabled={saving}>{saving ? "Saving…" : "Save Draft"}</ClinicalButton>
                {draft?.status === "VALIDATED" ? (
                  <span className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--clinical-green) 16%, transparent)", color: "var(--clinical-green)" }}><CheckCircle2 className="w-4 h-4" /> Validated</span>
                ) : (
                  <span title={completionIssues.length ? `Complete all 3 layers first:\n${completionIssues.map((i) => `• ${i.message}`).join("\n")}` : undefined} className={completionIssues.length ? "cursor-not-allowed" : undefined}>
                    <ClinicalButton variant="accent" onClick={() => completeSigned()} disabled={saving || completionIssues.length > 0}><CheckCircle2 className="w-4 h-4" /> Complete Assessment</ClinicalButton>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PIN-signed Care Manager sign-off — validates the Final Level of Care. */}
      <SignatureModal
        open={showPin}
        onClose={() => { setShowPin(false); setPinValidate(null); }}
        onSigned={() => { setShowPin(false); if (pinValidate) { void validate(pinValidate.decision, pinValidate.notes); setPinValidate(null); } }}
        mode="sign"
        title="Sign to validate Level of Care"
        description="Enter your 4-digit signing PIN to confirm the Final Level of Care (Care Manager sign-off)."
      />
    </>
  );

  return (embedded || modalOnly) ? <div className="space-y-6">{body}</div> : <ClinicalPage className="space-y-6">{body}</ClinicalPage>;
}

// ── Table view — the same records as the card grid, in a dense sortable-feel table ──
function AssessmentTable({ rows, onEdit, onRemove, onReport, locBadge }: {
  rows: AssessmentV42[];
  onEdit: (a: AssessmentV42, layer?: 1 | 2 | 3) => void;
  onRemove: (a: AssessmentV42) => void;
  onReport: (a: AssessmentV42) => void;
  locBadge: (assessmentId: string) => ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b text-left text-[var(--clinical-muted)]" style={{ borderColor: "var(--clinical-line)" }}>
            <th className="px-4 py-2.5 font-semibold">Resident</th>
            <th className="px-4 py-2.5 font-semibold">Status</th>
            <th className="px-4 py-2.5 font-semibold">Flags</th>
            <th className="px-4 py-2.5 font-semibold">Raw acuity</th>
            <th className="px-4 py-2.5 font-semibold">Level</th>
            <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const res = a.status !== "DRAFT" ? classifyAssessment(a) : null;
            const raw = assessmentRawScore(a);
            const eff = a.layer3?.finalLevel ?? res?.suggestedLevel ?? null;
            const overridden = a.layer3?.finalLevel && res && a.layer3.finalLevel !== res.suggestedLevel;
            return (
              <tr key={a.id} className="border-b last:border-0 align-middle transition hover:bg-[var(--clinical-surface-2)]" style={{ borderColor: "var(--clinical-line)" }}>
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: eff ? `color-mix(in srgb, ${LEVEL_COLOR[eff]} 16%, var(--clinical-surface))` : "var(--clinical-surface-2)", color: eff ? LEVEL_COLOR[eff] : "var(--clinical-ink-soft)" }}>{initials(a.layer1?.residentName || "")}</span>
                    <button onClick={() => onEdit(a)} className="min-w-0 text-left">
                      <span className="block truncate font-semibold text-[var(--clinical-ink)] hover:underline">{a.layer1?.residentName || "Unnamed resident"}</span>
                      <span className="block text-xs text-[var(--clinical-muted)]">{a.layer1?.assessmentDate || (a.updatedAt || "").slice(0, 10)} · {a.modelVersion}</span>
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3.5"><div className="flex flex-wrap items-center gap-1.5">{a.status === "VALIDATED" ? <StatusPill status="APPROVED">Validated</StatusPill> : <StatusPill status={a.status} />}{locBadge(a.id)}</div></td>
                <td className="px-4 py-3.5">
                  {(a.status === "COMPLETED" || (res && res.capabilityGate) || a.layer3?.priorAssessmentId) ? (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                      {a.status === "COMPLETED" && <button onClick={() => onEdit(a, 3)} title="Sign off in Layer 3 · Evaluation" className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-95" style={{ backgroundColor: "color-mix(in srgb, var(--clinical-amber) 14%, transparent)", borderColor: "color-mix(in srgb, var(--clinical-amber) 32%, transparent)", color: "var(--clinical-amber)" }}><ShieldCheck className="h-3.5 w-3.5" /> Awaiting validation</button>}
                      {res && res.capabilityGate && <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--clinical-coral) 14%, transparent)", borderColor: "color-mix(in srgb, var(--clinical-coral) 32%, transparent)", color: "var(--clinical-coral)" }}><AlertTriangle className="h-3.5 w-3.5" /> Capability gate</span>}
                      {a.layer3?.priorAssessmentId && <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold text-[var(--clinical-ink-soft)]" style={{ backgroundColor: "var(--clinical-surface-2)", borderColor: "var(--clinical-line)" }}><RefreshCw className="h-3.5 w-3.5" /> Reassess</span>}
                    </div>
                  ) : <span className="text-[var(--clinical-muted)]">—</span>}
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums font-bold text-[var(--clinical-ink)]">{raw}</span>
                    <span className="text-xs text-[var(--clinical-muted)]">/ {RAW_MAX}</span>
                    <span className="hidden h-1.5 w-16 overflow-hidden rounded-full sm:block" style={{ backgroundColor: "var(--clinical-line)" }}>
                      <span className="block h-full rounded-full" style={{ width: `${Math.min(100, Math.round((raw / RAW_MAX) * 100))}%`, background: eff ? LEVEL_COLOR[eff] : "var(--clinical-panel)" }} />
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  {eff ? <span className="inline-flex items-center rounded px-2 py-1 text-xs font-bold text-white" style={{ background: LEVEL_COLOR[eff] }}>{LEVEL_LABEL[eff]}{overridden ? " ·ovr" : ""}</span> : <span className="text-[var(--clinical-muted)]">—</span>}
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex justify-end">
                   <div className="inline-flex items-center gap-1">
                    {a.status === "VALIDATED" && <button onClick={() => onReport(a)} aria-label="Generate narrative report" title="Generate narrative report (PDF)" className="rounded-md p-1 text-[var(--clinical-panel)] transition hover:bg-[var(--clinical-surface-2)]"><FileText className="h-3.5 w-3.5" /></button>}
                    <button onClick={() => onEdit(a)} aria-label="Edit" title="Edit assessment" className="rounded-md p-1 text-[var(--clinical-ink-soft)] transition hover:bg-[var(--clinical-surface-2)] hover:text-[var(--clinical-panel)]"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => onRemove(a)} aria-label="Delete" title="Delete assessment" className="rounded-md p-1 text-[var(--clinical-coral)] transition hover:bg-[color-mix(in_srgb,var(--clinical-coral)_10%,transparent)]"><Trash2 className="h-3.5 w-3.5" /></button>
                   </div>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Validation block (nurse → admin approval), mirrors LevelOfCareReview ──────
function ValidationBlock({ draft, roleLabel, onValidate, onChange, busy }: {
  draft: AssessmentV42; roleLabel: string; busy: boolean;
  onValidate: (decision: NonNullable<AssessmentV42["validation"]>["decision"], notes: string) => void;
  onChange: (v: { decision: NonNullable<AssessmentV42["validation"]>["decision"]; notes: string }) => void;
}) {
  const DECISIONS: { value: NonNullable<AssessmentV42["validation"]>["decision"]; label: string }[] = [
    { value: "APPROVED", label: "Approve" },
    { value: "APPROVED_WITH_CHANGES", label: "Approve with changes" },
    { value: "NEEDS_REASSESSMENT", label: "Needs reassessment" },
  ];
  // Controlled off the draft so the decision/notes are captured by Save Draft and
  // restored on reopen. validationDraft (in-progress) wins over a prior signed validation.
  const decision = draft.layer3.validationDraft?.decision ?? draft.validation?.decision ?? "APPROVED";
  const notes = draft.layer3.validationDraft?.notes ?? draft.validation?.notes ?? "";
  return (
    <ClinicalCard top="teal" className="p-4 sm:p-5">
      <h3 className="text-sm font-bold text-[var(--clinical-ink)] mb-3 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-[var(--clinical-panel)]" /> Clinical Validation &amp; Decision</h3>
      {draft.validation ? (
        <div className="rounded-lg border px-3 py-2 text-sm mb-3" style={{ borderColor: "color-mix(in srgb, var(--clinical-green) 40%, transparent)", backgroundColor: "color-mix(in srgb, var(--clinical-green) 10%, transparent)" }}>
          <span className="font-semibold text-[var(--clinical-ink)]">{draft.validation.decision.replace(/_/g, " ")}</span> — validated by {draft.validation.by} ({draft.validation.role}) on {draft.validation.at.slice(0, 10)}.
          {draft.validation.notes && <p className="text-[var(--clinical-ink-soft)] mt-1">{draft.validation.notes}</p>}
        </div>
      ) : (
        <p className="text-xs text-[var(--clinical-muted)] mb-3">Not yet validated. Sign off to confirm the Final Level of Care before the care plan goes live.</p>
      )}
      <MicroLabel className="mb-1.5">Decision</MicroLabel>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {DECISIONS.map((d) => (
          <button key={d.value} type="button" onClick={() => onChange({ decision: d.value, notes })} className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${decision === d.value ? chipOn : chipOff}`}>{d.label}</button>
        ))}
      </div>
      <textarea rows={2} value={notes} onChange={(e) => onChange({ decision, notes: e.target.value })} placeholder="Decision notes — what does this resident actually need?" className={input} />
      <div className="flex items-center gap-2 mt-3">
        <ClinicalButton variant="primary" size="sm" onClick={() => onValidate(decision, notes)} disabled={busy}><CheckCircle2 className="w-4 h-4" /> {draft.status === "VALIDATED" ? "Re-validate" : "Validate Level of Care"}</ClinicalButton>
        <span className="text-[11px] text-[var(--clinical-muted)]">{roleLabel} sign-off</span>
      </div>
    </ClinicalCard>
  );
}
