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
  ListChecks, BellRing, ConciergeBell,
  RefreshCw, ShieldCheck, ShieldAlert, CalendarClock,
  TrendingUp, TrendingDown, Minus, ArrowRight, GitCompareArrows, Paperclip, Activity,
  type LucideIcon,
} from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { PhysicalExamHistory } from "./PhysicalExamForm";
import { originOf, assessmentRawScore, classifyAssessment } from "@/lib/lifecare/assessment";
import { lifecareLetterhead, LIFECARE_BRAND_CSS } from "@/lib/lifecare/brand";
import { ASSESSMENT_DOMAINS } from "@/lib/lifecare/dataset";
import { DOMAIN_CODES } from "@/lib/lifecare/types";
import { type ClinicianRole } from "./useClinician";
import { ClinicalPage, ClinicalHeader, ClinicalButton, StatCard, DataState, SERIF } from "./clinical-ui";
import {
  buildJourney, JOURNEY_CATEGORY_META, JOURNEY_CATEGORY_ORDER,
  type JourneyCategory, type JourneyAccent, type JourneyEvent,
} from "@/lib/residentJourney";
// Folded-in record boards — each renders locked to a single residentId, giving
// One Care · One Journey its per-resident record tabs (staff only, not readOnly).
import ClinicalRecordsBoard from "./ClinicalRecordsBoard";
import ResidentCareHistory from "./ResidentCareHistory";
import ResidentProgressReport from "./ResidentProgressReport";
import VitalsTrendBoard from "./VitalsTrendBoard";
import RoutineGeneratorBoard from "./RoutineGeneratorBoard";
import { ResidentCarePlanView } from "./CarePlanReviewsBoard";

// The resident-hub tabs: the two native panels (journey / forms) plus the six
// folded-in record boards.
type ResidentView = "journey" | "forms" | "physexam" | "careplan" | "clinical" | "timeline" | "progress" | "vitals" | "routine";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const DOMAIN_NAME: Record<string, string> = Object.fromEntries(ASSESSMENT_DOMAINS.map((d) => [d.code, d.name]));
interface DomainRow { code: string; name: string; score: number; note: string; evidence: string; flags: string[] }
interface FormValidation { by: string; role: string; at: string; decision: string; notes: string }
interface Layer1Snapshot {
  residentName: string; firstName?: string; middleName?: string; lastName?: string;
  dob?: string; age?: string; sex?: string;
  primaryContact?: string; contactNo?: string; referralSource?: string;
  reasonForAdmission?: string;
  diagnoses?: string; allergies?: string; medications?: string;
  medicationList?: { name: string; dose?: string; frequency?: string; instructions?: string; requiresVitals?: boolean }[];
  medicationListReviewed?: string;
  hospitalEd12mo?: boolean; hospitalEdReason?: string;
  significantChange3090?: boolean; significantChangeDescribe?: string;
  physicianFollowUp?: string;
  canParticipate?: string; authorizedRepresentative?: string;
  familyInvolvement?: string[]; advanceDirective?: string;
  culturalPreferences?: string; overallGoals?: string[]; goalsPreferences?: string;
  advanceCareContext?: string;
}
interface Layer3Snapshot {
  finalLevel?: string; finalLevelJustification?: string;
  belowFloorReason?: string; overrideReason?: string;
  reconciledModifiers?: string[];
  capabilityReview?: { outcome: string; rationale: string };
  reassessmentInterval?: string; nextReviewDate?: string;
}
interface FormRecord {
  id: string; kind: string; originLabel: string; icon: LucideIcon;
  status: string; level: string; score: number; date: string; by: string; reason: string;
  isReassessment: boolean; suggestedLevel: string; capabilityGate: boolean;
  justification: string; interval: string; nextReview: string;
  validation: FormValidation | null; completedBy: string; completedAt: string;
  domains: DomainRow[];
  layer1?: Layer1Snapshot; layer3?: Layer3Snapshot;
}
interface AdmissionForm {
  id: string; date: string; residentName: string; room: string; careLevel: string; v42Level: string; status: string;
  dob: string; gender: string; phone: string; email: string; emergencyContact: string; emergencyContactPhone: string;
  medicalAssessment: string; allergies: string; medicalHistory: string; surgeries: string; hospitalizations: string;
  medications: { name: string; dose?: string; frequency?: string }[];
  attachments: { url: string; name: string }[];
  domains: DomainRow[];
}
const s = (v: unknown) => (v == null ? "" : String(v));
// Parse the admission's serialized careAssessment blob (migration-free clinical store).
const parseCareBlob = (raw: string): { meds: { name: string; dose?: string; frequency?: string }[]; attachments: { url: string; name: string }[]; surgeries: string; hospitalizations: string } => {
  const t = (raw || "").trim();
  if (t.startsWith("{")) { try { const o = JSON.parse(t); return { meds: Array.isArray(o.medications) ? o.medications : [], attachments: Array.isArray(o.attachments) ? o.attachments : [], surgeries: String(o.surgeries ?? ""), hospitalizations: String(o.hospitalizations ?? "") }; } catch { /* not structured */ } }
  return { meds: [], attachments: [], surgeries: "", hospitalizations: "" };
};
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
  CARE_EVENT: ClipboardCheck, TASK: ListChecks, CALL_BELL: BellRing, REQUEST: ConciergeBell,
  ACUITY: Layers, MEDICATION: Pill, INCIDENT: AlertTriangle, WOUND: Bandage,
  REFERRAL: Stethoscope, CLINICAL_RECORD: FolderOpen, ENDORSEMENT: FileText,
  WEIGHT: Scale, PRIVATE_CARE: HeartHandshake, OVERAGE: TrendingUp, DOCUMENT: FileText, NOTE: StickyNote,
};

const settingVal = (rows: Row[], key: string) => rows.find((r) => s(r.key || r.id) === key)?.value as string | undefined;
const parseArr = (raw: string | undefined): Row[] => { if (!raw) return []; try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; } };
const parseObj = (raw: string | undefined): Record<string, Row[]> => { if (!raw) return {}; try { const v = JSON.parse(raw); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; } };

export default function ResidentJourneyBoard({ clinicianRole = "NURSE", readOnly = false, residentId }: { clinicianRole?: ClinicianRole; readOnly?: boolean; residentId?: string }) {
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
  const ceQ = useLiveQuery<Row>("care-events", { query: "take=2000", tables: ["CareEvent"] });
  const admQ = useLiveQuery<Row>("admissions", { query: "take=2000", tables: ["Admission"] });
  const cpQ = useLiveQuery<Row>("care-plans", { query: "take=1000", tables: ["CarePlan"] });
  const taskQ = useLiveQuery<Row>("tasks", { query: "take=3000", tables: ["Task"] });
  const cbQ = useLiveQuery<Row>("call-bells", { query: "take=1000", tables: ["CallBell"] });
  const svcQ = useLiveQuery<Row>("service-requests", { query: "take=1000", tables: ["ServiceRequest"] });

  const residents = useMemo(() => (resQ.data || []).map((raw) => {
    const a = adaptResident(raw);
    const room = s(a.room ?? raw.room ?? "");
    return {
      id: s(a.id), name: s(a.name), room,
      admittedAt: pick(raw, "moveInDate", "admissionDate", "createdAt"),
      admissionSummary: [room ? `Room ${room}` : "", s(raw.careLevel) ? s(raw.careLevel) : ""].filter(Boolean).join(" · ") || undefined,
    };
  }), [resQ.data]);

  const [resId, setResId] = useState(residentId ?? "");
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<JourneyCategory | "ALL">("ALL");
  const [view, setView] = useState<ResidentView>("journey");

  const resident = useMemo(() => residents.find((r) => r.id === resId) || null, [residents, resId]);

  // This resident's admissions — used to link a pre-admission/admission v4.2
  // assessment (which carries convertedAdmissionId, not always residentId) to the
  // resident so a validated pre-admission and a completed admission both surface.
  const residentAdmissionIds = useMemo(() => {
    if (!resident) return new Set<string>();
    return new Set((admQ.data || []).filter((a) => s(a.residentId) === resident.id).map((a) => s(a.id)));
  }, [admQ.data, resident]);
  const assessmentsV42 = useMemo<Row[]>(() => {
    const list = parseArr(settingVal(settingRows, "assessments_v42")) as Row[];
    if (!resident) return list;
    const norm = (v: unknown) => s(v).trim().toLowerCase().replace(/\s+/g, " ");
    const rn = norm(resident.name);
    return list.map((a) => {
      if (s(a?.layer1?.residentId) === resident.id) return a;
      if (a?.layer1?.convertedAdmissionId && residentAdmissionIds.has(s(a.layer1.convertedAdmissionId))) {
        return { ...a, layer1: { ...a.layer1, residentId: resident.id } };
      }
      // Fall back to a resident-name match so a validated assessment captured by name
      // (no residentId / admission link resolved yet) still surfaces in Journey + Forms.
      // ponytail: exact-name match; a rare same-name collision would cross-link.
      if (rn && norm(a?.layer1?.residentName) === rn) {
        return { ...a, layer1: { ...a.layer1, residentId: resident.id } };
      }
      return a;
    });
  }, [settingRows, resident, residentAdmissionIds]);

  // Assessment-form history (Pre-Admission → reassessment) for the Forms tab.
  // Live off `assessments_v42`, so every new reassessment shows up automatically.
  const forms = useMemo<FormRecord[]>(() => {
    if (!resident) return [];
    return assessmentsV42
      .filter((a) => s(a?.layer1?.residentId) === resident.id && originOf(a) !== "ADMISSION")
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
          domains: DOMAIN_CODES.map((code) => ({ code, name: DOMAIN_NAME[code] || code, score: Number(a?.domains?.[code]?.score ?? 0), note: s(a?.domains?.[code]?.goalNote), evidence: s(a?.domains?.[code]?.evidence), flags: Array.isArray(a?.domains?.[code]?.modifierFlags) ? a.domains[code].modifierFlags : [] })),
          layer1: a?.layer1 ? {
            residentName: s(a.layer1.residentName), firstName: s(a.layer1.firstName), middleName: s(a.layer1.middleName), lastName: s(a.layer1.lastName),
            dob: s(a.layer1.dateOfBirth), age: s(a.layer1.age), sex: s(a.layer1.sex),
            primaryContact: s(a.layer1.primaryContact), contactNo: s(a.layer1.contactNo), referralSource: s(a.layer1.referralSource),
            reasonForAdmission: s(a.layer1.reasonForAdmission),
            diagnoses: s(a.layer1.diagnoses), allergies: s(a.layer1.allergies), medications: s(a.layer1.medications),
            medicationList: Array.isArray(a.layer1.medicationList) ? a.layer1.medicationList : undefined,
            medicationListReviewed: s(a.layer1.medicationListReviewed),
            hospitalEd12mo: !!a.layer1.hospitalEd12mo, hospitalEdReason: s(a.layer1.hospitalEdReason),
            significantChange3090: !!a.layer1.significantChange3090, significantChangeDescribe: s(a.layer1.significantChangeDescribe),
            physicianFollowUp: s(a.layer1.physicianFollowUp),
            canParticipate: s(a.layer1.canParticipate), authorizedRepresentative: s(a.layer1.authorizedRepresentative),
            familyInvolvement: Array.isArray(a.layer1.familyInvolvement) ? a.layer1.familyInvolvement : undefined,
            advanceDirective: s(a.layer1.advanceDirective), culturalPreferences: s(a.layer1.culturalPreferences),
            overallGoals: Array.isArray(a.layer1.overallGoals) ? a.layer1.overallGoals : undefined,
            goalsPreferences: s(a.layer1.goalsPreferences), advanceCareContext: s(a.layer1.advanceCareContext),
          } : undefined,
          layer3: a?.layer3 ? {
            finalLevel: s(a.layer3.finalLevel), finalLevelJustification: s(a.layer3.finalLevelJustification),
            belowFloorReason: s(a.layer3.belowFloorReason), overrideReason: s(a.layer3.overrideReason),
            reconciledModifiers: Array.isArray(a.layer3.reconciledModifiers) ? a.layer3.reconciledModifiers : undefined,
            capabilityReview: a.layer3.capabilityReview ? { outcome: s(a.layer3.capabilityReview.outcome), rationale: s(a.layer3.capabilityReview.rationale) } : undefined,
            reassessmentInterval: s(a.layer3.reassessmentInterval), nextReviewDate: s(a.layer3.nextReviewDate),
          } : undefined,
        };
      })
      .sort((x, y) => (y.date || "").localeCompare(x.date || ""));
  }, [resident, assessmentsV42]);

  // Completed admission intake forms — the full onboarding record (all details),
  // distinct from the screening pre-admission. 14-domain + LOC come from the
  // admission's own ADMISSION-origin assessment (av42-adm-<id>).
  const admissionForms = useMemo<AdmissionForm[]>(() => {
    if (!resident) return [];
    const byId = new Map((parseArr(settingVal(settingRows, "assessments_v42")) as Row[]).map((a) => [s(a.id), a]));
    return (admQ.data || [])
      .filter((a) => s(a.residentId) === resident.id && s(a.status).toUpperCase() === "COMPLETED")
      .map((a) => {
        const blob = parseCareBlob(s(a.careAssessment));
        const v42 = byId.get(`av42-adm-${s(a.id)}`);
        const v42Level = v42 ? (s(v42.layer3?.finalLevel) || s(classifyAssessment({ domains: v42.domains ?? {}, context: v42.context ?? {} }).suggestedLevel)) : "";
        return {
          id: s(a.id), date: pick(a, "completedAt", "updatedAt", "createdAt"),
          residentName: `${s(a.firstName)} ${s(a.lastName)}`.trim(), room: s(a.roomNumber),
          careLevel: s(a.careLevel), v42Level, status: s(a.status).toUpperCase(),
          dob: s(a.dateOfBirth).slice(0, 10), gender: s(a.gender), phone: s(a.phone), email: s(a.email),
          emergencyContact: s(a.emergencyContact), emergencyContactPhone: s(a.emergencyContactPhone),
          medicalAssessment: s(a.medicalAssessment), allergies: s(a.allergies), medicalHistory: s(a.medicalHistory),
          surgeries: blob.surgeries || s(a.surgeries), hospitalizations: blob.hospitalizations || s(a.hospitalizations),
          medications: blob.meds, attachments: blob.attachments,
          domains: v42 ? DOMAIN_CODES.map((code) => ({ code, name: DOMAIN_NAME[code] || code, score: Number(v42.domains?.[code]?.score ?? 0), note: s(v42.domains?.[code]?.goalNote), evidence: s(v42.domains?.[code]?.evidence), flags: Array.isArray(v42.domains?.[code]?.modifierFlags) ? v42.domains[code].modifierFlags : [] })) : [],
        };
      })
      .sort((x, y) => (y.date || "").localeCompare(x.date || ""));
  }, [resident, admQ.data, settingRows]);

  const journey = useMemo<JourneyEvent[]>(() => {
    if (!resident) return [];
    return buildJourney({
      residentId: resident.id,
      admittedAt: resident.admittedAt || undefined,
      admissionSummary: resident.admissionSummary,
      locHistory: parseArr(settingVal(settingRows, "loc_history")),
      assessmentsV42,
      carePlans: cpQ.data || [],
      carePlanReviews: parseArr(settingVal(settingRows, "care_plan_reviews")),
      tasks: taskQ.data || [],
      callBells: cbQ.data || [],
      serviceRequests: svcQ.data || [],
      acuity: parseArr(settingVal(settingRows, "acuity_assessments")),
      woundRecords: parseArr(settingVal(settingRows, "wound_records")),
      endorsements: parseArr(settingVal(settingRows, "shift_endorsements")),
      weightLogs: parseArr(settingVal(settingRows, "weight_logs")),
      clinicalRecords: parseObj(settingVal(settingRows, "clinical_records")),
      privateCare: parseArr(settingVal(settingRows, "private_caregiver_assignments")),
      overageEvents: parseArr(settingVal(settingRows, "package_overage_events")),
      medications: medQ.data || [],
      incidents: incQ.data || [],
      referrals: refQ.data || [],
      documents: docQ.data || [],
      notes: noteQ.data || [],
      careEvents: ceQ.data || [],
    });
  }, [resident, assessmentsV42, settingRows, medQ.data, incQ.data, refQ.data, docQ.data, noteQ.data, ceQ.data, cpQ.data, taskQ.data, cbQ.data, svcQ.data]);

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
  // When embedded with a fixed residentId, never show the chooser: render a
  // loading state until the resident row resolves, then the journey below.
  if (!resident && !residentId) {
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
  // Embedded (locked) instance whose resident row hasn't resolved yet.
  if (!resident) {
    return (
      <ClinicalPage>
        <DataState loading={resQ.loading} error={resQ.error} empty={!resQ.loading} emptyTitle="Resident not found" emptyHint="This resident could not be loaded." onRetry={() => void resQ.refetch()} skeletonRows={5}>
          <div />
        </DataState>
      </ClinicalPage>
    );
  }
  const viewTabs: { v: ResidentView; label: string; count?: number }[] = [
    { v: "journey", label: "Journey", count: journey.length },
    { v: "forms", label: "Forms", count: forms.length },
    { v: "physexam", label: "Physical Exam" },
    // Family (readOnly) keeps just Journey + Forms; staff get the full record set.
    ...(readOnly ? [] : ([
      { v: "careplan", label: "Care Plan" },
      { v: "clinical", label: "Clinical Records" },
      { v: "timeline", label: "Care Timeline" },
      { v: "progress", label: "Progress Report" },
      { v: "vitals", label: "Vital Signs" },
      { v: "routine", label: "Routine" },
    ] as { v: ResidentView; label: string; count?: number }[])),
  ];

  return (
    <ClinicalPage>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {!residentId && <ClinicalButton variant="secondary" size="sm" onClick={() => { setResId(""); setCat("ALL"); }}><ChevronRight className="h-4 w-4 rotate-180" /> Residents</ClinicalButton>}
          <div>
            <h1 className="text-2xl font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>{resident.name}</h1>
            <p className="text-sm text-[var(--clinical-muted)]">One Care · One Journey{resident.room ? ` — Room ${resident.room}` : ""}</p>
          </div>
        </div>
        <ClinicalButton variant="secondary" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</ClinicalButton>
      </div>

      {/* View tabs — journey, assessment forms, and the folded-in record boards */}
      <div className="mb-5 inline-flex flex-wrap gap-1 rounded-xl p-1" style={{ backgroundColor: "var(--clinical-surface-2)" }}>
        {viewTabs.map(({ v, label, count }) => (
          <button key={v} onClick={() => setView(v)}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${view === v ? "bg-[var(--clinical-surface)] shadow-sm text-[var(--clinical-ink)]" : "text-[var(--clinical-muted)] hover:text-[var(--clinical-ink)]"}`}>
            {label}
            {count !== undefined && <span className="rounded-full px-1.5 text-[10px] tabular-nums" style={{ backgroundColor: view === v ? "var(--clinical-surface-2)" : "var(--clinical-surface)" }}>{count}</span>}
          </button>
        ))}
      </div>

      {view === "forms" ? (
        <FormsPanel forms={forms} admissions={admissionForms} />
      ) : view === "physexam" ? (
        <PhysicalExamHistory residentId={resident.id} residentName={resident.name} room={resident.room} />
      ) : view === "careplan" ? (
        <ResidentCarePlanView residentId={resident.id} />
      ) : view === "clinical" ? (
        <ClinicalRecordsBoard key={resident.id} clinicianRole={clinicianRole} residentId={resident.id} />
      ) : view === "timeline" ? (
        <ResidentCareHistory key={resident.id} clinicianRole={clinicianRole} residentId={resident.id} />
      ) : view === "progress" ? (
        <ResidentProgressReport key={resident.id} clinicianRole={clinicianRole} residentId={resident.id} />
      ) : view === "vitals" ? (
        <VitalsTrendBoard key={resident.id} clinicianRole={clinicianRole} residentId={resident.id} />
      ) : view === "routine" ? (
        <RoutineGeneratorBoard key={resident.id} residentId={resident.id} />
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

function FormsPanel({ forms, admissions = [] }: { forms: FormRecord[]; admissions?: AdmissionForm[] }) {
  const [openId, setOpenId] = useState<string | null>(forms[0]?.id ?? null);
  const [openAdm, setOpenAdm] = useState<string | null>(admissions[0]?.id ?? null);
  if (forms.length === 0 && admissions.length === 0) {
    return (
      <div className="rounded-2xl border p-10 text-center text-sm text-[var(--clinical-muted)]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
        No assessment forms recorded for this resident yet. Pre-admission assessments, admissions, and reassessments appear here as they are created.
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {admissions.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-bold text-[var(--clinical-ink)]">Admission / Intake {admissions.length > 1 ? `(${admissions.length})` : ""}</h3>
          {admissions.map((a) => <AdmissionCard key={a.id} a={a} open={openAdm === a.id} onToggle={() => setOpenAdm(openAdm === a.id ? null : a.id)} />)}
        </section>
      )}
      {forms.length > 0 && <p className="text-sm text-[var(--clinical-muted)]">Complete record trail of every assessment form for this resident — from pre-admission intake through each reassessment. Click a form to view its result. {forms.length} form{forms.length === 1 ? "" : "s"} on file.</p>}
      {forms.length > 0 && (
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
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={(e) => { e.stopPropagation(); printAssessmentForm(f); }} className="rounded-lg p-1.5 text-[var(--clinical-muted)] transition hover:bg-[var(--clinical-surface-2)] hover:text-[var(--clinical-panel)]" title="Print / Save as PDF">
                      <Printer className="h-4 w-4" />
                    </button>
                    <ChevronDown className={`h-4 w-4 text-[var(--clinical-muted)] transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </div>
                </button>

                {/* read-only result */}
                {isOpen && <FormResult f={f} tone={tone} prev={prev} chg={chg} />}
              </div>
            </li>
          );
        })}
      </ol>
      )}
    </div>
  );
}

// Full read-only admission / intake record — every detail captured on the form.
function AdmField({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return <div><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--clinical-muted)]">{label}</p><p className="mt-0.5 whitespace-pre-wrap text-[var(--clinical-ink)]">{value}</p></div>;
}
function AdmissionCard({ a, open, onToggle }: { a: AdmissionForm; open: boolean; onToggle: () => void }) {
  const scored = a.domains.filter((d) => d.score > 0);
  return (
    <div className="overflow-hidden rounded-xl border transition" style={{ backgroundColor: "var(--clinical-surface)", borderColor: open ? "var(--clinical-panel)" : "var(--clinical-line)", boxShadow: open ? "0 0 0 1px var(--clinical-panel)" : undefined }}>
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 p-4 text-left transition hover:bg-[var(--clinical-surface-2)]">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: "color-mix(in srgb, var(--clinical-panel) 14%, var(--clinical-surface))", color: "var(--clinical-panel)" }}><UserPlus className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-[var(--clinical-ink)]">Admission / Intake</span>
            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ backgroundColor: "var(--clinical-surface-2)", color: "var(--clinical-ink-soft)" }}>Onboarding</span>
            <span className="ml-auto text-[11px] tabular-nums text-[var(--clinical-muted)]">{fmtDate(a.date)}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-white" style={{ backgroundColor: "var(--clinical-green)" }}>{a.status}</span>
            {a.v42Level && <span className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold text-white" style={{ backgroundColor: "var(--clinical-coral)" }}>{a.v42Level}</span>}
            {a.room && <span className="text-[11px] text-[var(--clinical-muted)]">Room {a.room}</span>}
          </div>
        </div>
        <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-[var(--clinical-muted)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-4 border-t p-4 text-sm" style={{ borderColor: "var(--clinical-line)" }}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <AdmField label="Date of birth" value={a.dob} />
            <AdmField label="Gender" value={a.gender} />
            <AdmField label="Phone" value={a.phone} />
            <AdmField label="Email" value={a.email} />
            <AdmField label="Emergency contact" value={a.emergencyContact} />
            <AdmField label="Emergency phone" value={a.emergencyContactPhone} />
            <AdmField label="Room" value={a.room} />
            <AdmField label="Care level" value={a.careLevel} />
          </div>
          <AdmField label="Medical assessment" value={a.medicalAssessment} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <AdmField label="Allergies" value={a.allergies} />
            <AdmField label="Medical history" value={a.medicalHistory} />
            <AdmField label="Previous surgeries" value={a.surgeries} />
            <AdmField label="Hospitalizations" value={a.hospitalizations} />
          </div>
          {a.medications.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--clinical-muted)]">Medications</p>
              <ul className="mt-1 space-y-1">{a.medications.map((m, i) => <li key={i} className="text-[var(--clinical-ink)]">{m.name}{[m.dose, m.frequency].filter(Boolean).length ? ` — ${[m.dose, m.frequency].filter(Boolean).join(" · ")}` : ""}</li>)}</ul>
            </div>
          )}
          {a.attachments.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--clinical-muted)]">Assessment report</p>
              <ul className="mt-1 space-y-1">{a.attachments.map((att) => <li key={att.url}><a href={att.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium text-[var(--clinical-panel)] hover:underline"><Paperclip className="h-3.5 w-3.5" />{att.name}</a></li>)}</ul>
            </div>
          )}
          {scored.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--clinical-muted)]">14-domain assessment</p>
              <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
                {scored.map((d) => (
                  <div key={d.code} className="flex items-center justify-between gap-2 rounded-md px-2 py-1" style={{ backgroundColor: "var(--clinical-surface-2)" }}>
                    <span className="truncate text-[var(--clinical-ink-soft)]"><span className="font-bold text-[var(--clinical-panel)]">{d.code}</span> {d.name}</span>
                    <span className="shrink-0 font-bold tabular-nums text-[var(--clinical-ink)]">{d.score}/4</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Print assessment as structured PDF ─────────────────────────────────────
const esc = (v: unknown): string => String(v ?? "").replace(/[&<>\"]|\n/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "\n": "<br>" }[c] as string));
const has = (v: unknown): boolean => v != null && String(v).trim() !== "";
const field = (label: string, val: string): string => val ? `<div class="f"><span class="fl">${esc(label)}</span><span class="fv">${esc(val)}</span></div>` : "";
const section = (title: string, body: string): string => body.trim() ? `<div class="sec"><h3>${esc(title)}</h3>${body}</div>` : "";

function printAssessmentForm(f: FormRecord): void {
  const l1 = f.layer1;
  const l3 = f.layer3;
  const name = l1?.residentName || "Resident";
  const title = f.kind;
  const origin = f.originLabel;
  // ── Layer 1 sections ──
  const profileFields = [
    field("Resident", name),
    field("Date of Birth", l1?.dob || ""),
    field("Age", l1?.age || ""),
    field("Sex", l1?.sex || ""),
    field("Phone", l1?.contactNo || ""),
    field("Primary Contact", l1?.primaryContact || ""),
    field("Referral Source", l1?.referralSource || ""),
  ].join("");
  const clinicalFields = [
    field("Diagnoses", l1?.diagnoses || ""),
    field("Allergies", l1?.allergies || ""),
    field("Hospital / ED (12 mo)", l1?.hospitalEd12mo ? `Yes${l1.hospitalEdReason ? ` — ${l1.hospitalEdReason}` : ""}` : ""),
    field("Significant Change (30–90 d)", l1?.significantChange3090 ? `Yes${l1.significantChangeDescribe ? ` — ${l1.significantChangeDescribe}` : ""}` : ""),
    field("Physician Follow-Up", l1?.physicianFollowUp || ""),
  ].join("");
  const meds = l1?.medicationList && l1.medicationList.length > 0
    ? l1.medicationList.map((m) => `<div class="med">${esc(m.name)}${m.dose ? ` — ${esc(m.dose)}` : ""}${m.frequency ? ` · ${esc(m.frequency)}` : ""}${m.instructions ? `<br><span class="mi">${esc(m.instructions)}</span>` : ""}${m.requiresVitals ? ` <span class="vt">⚠ Vitals required</span>` : ""}</div>`).join("")
    : (l1?.medications ? `<div class="med">${esc(l1.medications)}</div>` : "");
  const decisionFields = [
    field("Participation Level", l1?.canParticipate?.replace(/_/g, " ") || ""),
    field("Authorized Representative", l1?.authorizedRepresentative || ""),
    field("Family Involvement", l1?.familyInvolvement?.join(", ") || ""),
    field("Advance Directive", l1?.advanceDirective?.replace(/_/g, " ") || ""),
    field("Cultural / Spiritual Preferences", l1?.culturalPreferences || ""),
    field("Goals & Preferences", l1?.goalsPreferences || ""),
  ].join("");
  // ── Layer 2 — domain scores ──
  const domainRows = f.domains.map((d) => {
    const bars = [0, 1, 2, 3].map((n) => n < d.score ? "█" : "░").join("");
    const detail = [d.evidence ? `Evidence: ${d.evidence}` : "", d.note ? `Goal: ${d.note}` : "", d.flags.length ? `Flags: ${d.flags.join(", ")}` : ""].filter(Boolean).join(" · ");
    return `<tr><td class="dc">${esc(d.code)}</td><td class="dn">${esc(d.name)}</td><td class="ds">${bars}</td><td class="dv">${d.score}/4</td>${detail ? `<td class="dd">${esc(detail)}</td>` : "<td></td>"}</tr>`;
  }).join("");
  // ── Layer 3 — evaluation ──
  const evalFields = [
    field("Final Level of Care", f.level || ""),
    field("Engine Suggested", f.suggestedLevel || ""),
    field("Final LOC Justification", f.justification || ""),
    field("Below-Floor Reason", l3?.belowFloorReason || ""),
    field("Override Reason", l3?.overrideReason || ""),
    field("Reconciled Modifiers", l3?.reconciledModifiers?.join(", ") || ""),
    field("Capability Review", l3?.capabilityReview ? `${l3.capabilityReview.outcome} — ${l3.capabilityReview.rationale}` : ""),
    field("Reassessment Interval", l3?.reassessmentInterval || ""),
    field("Next Review", l3?.nextReviewDate || ""),
  ].join("");
  const validationHtml = f.validation
    ? `<div class="val"><strong>${esc(f.validation.decision)}</strong> — by ${esc(f.validation.by)}${f.validation.role ? ` (${esc(f.validation.role)})` : ""}${f.validation.at ? ` on ${esc(f.validation.at)}` : ""}${f.validation.notes ? `<br>${esc(f.validation.notes)}` : ""}</div>`
    : f.status === "COMPLETED" ? `<div class="val">Completed${f.completedBy ? ` by ${esc(f.completedBy)}` : ""} — awaiting clinical validation.</div>` : "";
  const scoreTotal = f.score;
  const pct = Math.min(100, Math.round((scoreTotal / 56) * 100));

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} — ${esc(name)}</title>
<style>
*{box-sizing:border-box}
body{font-family:"Segoe UI",system-ui,-apple-system,Arial,sans-serif;color:#1f2933;line-height:1.6;max-width:820px;margin:0 auto;padding:44px 48px;font-size:14px}
${LIFECARE_BRAND_CSS}
.rule{border:0;border-top:1.5px solid #ced4da;margin:10px 0 18px}
.company{font-weight:800;font-size:17px;margin:0 0 2px}
.title{font-weight:700;font-size:14px;color:#343a40;margin:0 0 4px}
.origin{font-size:12px;color:#868e96;margin:0 0 12px}
.meta{display:flex;gap:16px;flex-wrap:wrap;margin:10px 0 18px;font-size:13px}
.meta .pill{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:6px;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
.pill-status{background:#4263eb;color:#fff}
.pill-level{background:#e03131;color:#fff}
.pill-score{background:#f1f3f5;color:#495057}
.sec{margin-top:22px;page-break-inside:avoid}
sec h3{font-size:14px;color:#1c7ed6;border-bottom:1px solid #dee2e6;padding-bottom:4px;margin:0 0 10px;page-break-after:avoid}
h3{font-size:14px;color:#1c7ed6;border-bottom:1px solid #dee2e6;padding-bottom:4px;margin:0 0 10px;page-break-after:avoid}
.f{display:flex;gap:8px;margin:3px 0;font-size:13px}.fl{font-weight:700;min-width:160px;flex-shrink:0;color:#495057}.fv{color:#212529}
.med{padding:6px 10px;background:#f8f9fa;border-radius:6px;margin:4px 0;font-size:13px;border-left:3px solid #4263eb}
.mi{color:#868e96;font-style:italic;font-size:12px}
.vt{background:#fff3bf;color:#e8590c;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px}
table{width:100%;border-collapse:collapse;margin:8px 0;font-size:12.5px}
th{text-align:left;font-size:11px;color:#495057;border-bottom:1.5px solid #dee2e6;padding:6px 4px}
td{padding:5px 4px;border-bottom:1px solid #f1f3f5}
.dc{font-weight:700;color:#4263eb;width:60px}.dn{width:180px}.ds{font-family:monospace;letter-spacing:1px;color:#868e96}.dv{text-align:right;font-weight:700;font-variant-numeric:tabular-nums;width:40px}.dd{font-size:11px;color:#868e96;max-width:200px}
tr,td,.sec,.med,.f{page-break-inside:avoid}
.val{background:#f1f3f5;border-radius:8px;padding:10px 14px;font-size:13px;margin-top:12px}
.foot{margin-top:26px;border-top:1px solid #e9ecef;padding-top:10px;color:#adb5bd;font-size:11px}
@page{margin:0}
table.sheet{width:100%;border-collapse:collapse}
table.sheet>thead>tr>td,table.sheet>tfoot>tr>td{padding:0;border:0}
.vpad{height:0}
@media print{body{padding:0;max-width:none;margin:0}td.sheet-body{padding:0 44px}.vpad{height:34px}}
</style></head><body onload="window.focus();window.print()">
<table class="sheet"><thead><tr><td><div class="vpad"></div></td></tr></thead><tbody><tr><td class="sheet-body">
${lifecareLetterhead()}
<hr class="rule">
<p class="company">LifeCare Living Solutions, Inc.</p>
<p class="title">${esc(title)}</p>
<p class="origin">${esc(origin)} · ${esc(f.date)}</p>
<div class="meta">
  <span class="pill pill-status">${esc(f.status)}</span>
  ${f.level ? `<span class="pill pill-level">${esc(f.level)}</span>` : ""}
  <span class="pill pill-score">Acuity ${scoreTotal} / 56 (${pct}%)</span>
  ${f.by ? `<span style="color:#868e96;font-size:12px">by ${esc(f.by)}</span>` : ""}
</div>
${section("Layer 1 · Profile & History", profileFields)}
${section("Clinical History", clinicalFields)}
${meds ? section("Medications", meds) : ""}
${decisionFields ? section("Decision Support & Person-Centered Care", decisionFields) : ""}
${section("Layer 2 · Domain Scores (14 domains, max /56)", `<table><thead><tr><th>Code</th><th>Domain</th><th>Score</th><th>Rating</th><th>Details</th></tr></thead><tbody>${domainRows}<tr style="font-weight:800;border-top:1.5px solid #ced4da"><td></td><td>Total</td><td></td><td class="dv">${scoreTotal}/56</td><td></td></tr></tbody></table>`)}
${section("Layer 3 · Evaluation", evalFields)}
${validationHtml}
<div class="foot">Assessment ${esc(f.id)} · Generated ${esc(new Date().toLocaleString())} · Confidential — for authorized use only.</div>
</td></tr></tbody><tfoot><tr><td><div class="vpad"></div></td></tr></tfoot></table>
</body></html>`;
  const w = window.open("", "_blank", "width=840,height=920");
  if (!w) return;
  w.document.write(html);
  w.document.close();
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

      {/* ── Layer 1 · Profile & History ── */}
      {f.layer1 && (
        <div className="rounded-lg border p-3 space-y-3" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface-2)" }}>
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[var(--clinical-panel)]"><UserPlus className="h-3.5 w-3.5" /> Layer 1 · Profile &amp; History</p>
          {/* Resident profile */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {f.layer1.dob && <div><p className="text-[10px] font-bold uppercase text-[var(--clinical-muted)]">Date of Birth</p><p className="text-sm text-[var(--clinical-ink)]">{f.layer1.dob}</p></div>}
            {f.layer1.age && <div><p className="text-[10px] font-bold uppercase text-[var(--clinical-muted)]">Age</p><p className="text-sm text-[var(--clinical-ink)]">{f.layer1.age}</p></div>}
            {f.layer1.sex && <div><p className="text-[10px] font-bold uppercase text-[var(--clinical-muted)]">Sex</p><p className="text-sm text-[var(--clinical-ink)]">{f.layer1.sex}</p></div>}
            {f.layer1.contactNo && <div><p className="text-[10px] font-bold uppercase text-[var(--clinical-muted)]">Phone</p><p className="text-sm text-[var(--clinical-ink)]">{f.layer1.contactNo}</p></div>}
            {f.layer1.primaryContact && <div><p className="text-[10px] font-bold uppercase text-[var(--clinical-muted)]">Primary Contact</p><p className="text-sm text-[var(--clinical-ink)]">{f.layer1.primaryContact}</p></div>}
            {f.layer1.referralSource && <div><p className="text-[10px] font-bold uppercase text-[var(--clinical-muted)]">Referral Source</p><p className="text-sm text-[var(--clinical-ink)]">{f.layer1.referralSource}</p></div>}
          </div>
          {/* Clinical history */}
          {(f.layer1.diagnoses || f.layer1.allergies || f.layer1.medications) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {f.layer1.diagnoses && <div><p className="text-[10px] font-bold uppercase text-[var(--clinical-muted)]">Diagnoses</p><p className="mt-0.5 whitespace-pre-wrap text-sm text-[var(--clinical-ink)]">{f.layer1.diagnoses}</p></div>}
              {f.layer1.allergies && <div><p className="text-[10px] font-bold uppercase text-[var(--clinical-muted)]">Allergies</p><p className="mt-0.5 whitespace-pre-wrap text-sm text-[var(--clinical-ink)]">{f.layer1.allergies}</p></div>}
            </div>
          )}
          {/* Structured medications */}
          {f.layer1.medicationList && f.layer1.medicationList.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase text-[var(--clinical-muted)]">Medications ({f.layer1.medicationListReviewed === "YES" ? "Reviewed" : f.layer1.medicationListReviewed === "NO" ? "Not reviewed" : "Review status unknown"})</p>
              <div className="mt-1 space-y-1.5">
                {f.layer1.medicationList.map((m, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-md px-2 py-1.5" style={{ backgroundColor: "var(--clinical-surface)" }}>
                    <Pill className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[var(--clinical-panel)]" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--clinical-ink)]">{m.name}{m.dose ? <span className="font-normal text-[var(--clinical-ink-soft)]"> — {m.dose}</span> : null}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--clinical-muted)]">
                        {m.frequency && <span>{m.frequency}</span>}
                        {m.instructions && <span className="italic">{m.instructions}</span>}
                      </div>
                    </div>
                    {m.requiresVitals && <span className="shrink-0 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"><Activity className="h-3 w-3" />Vitals</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Decision support */}
          {(f.layer1.canParticipate || f.layer1.advanceDirective || f.layer1.culturalPreferences || (f.layer1.familyInvolvement && f.layer1.familyInvolvement.length > 0) || f.layer1.goalsPreferences) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {f.layer1.canParticipate && <div><p className="text-[10px] font-bold uppercase text-[var(--clinical-muted)]">Participation Level</p><p className="text-sm text-[var(--clinical-ink)]">{f.layer1.canParticipate.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}</p></div>}
              {f.layer1.authorizedRepresentative && <div><p className="text-[10px] font-bold uppercase text-[var(--clinical-muted)]">Authorized Representative</p><p className="text-sm text-[var(--clinical-ink)]">{f.layer1.authorizedRepresentative}</p></div>}
              {f.layer1.familyInvolvement && f.layer1.familyInvolvement.length > 0 && <div><p className="text-[10px] font-bold uppercase text-[var(--clinical-muted)]">Family Involvement</p><p className="text-sm text-[var(--clinical-ink)]">{f.layer1.familyInvolvement.join(", ")}</p></div>}
              {f.layer1.advanceDirective && <div><p className="text-[10px] font-bold uppercase text-[var(--clinical-muted)]">Advance Directive</p><p className="text-sm text-[var(--clinical-ink)]">{f.layer1.advanceDirective.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}</p></div>}
              {f.layer1.culturalPreferences && <div><p className="text-[10px] font-bold uppercase text-[var(--clinical-muted)]">Cultural / Spiritual Preferences</p><p className="mt-0.5 whitespace-pre-wrap text-sm text-[var(--clinical-ink)]">{f.layer1.culturalPreferences}</p></div>}
              {f.layer1.goalsPreferences && <div className="sm:col-span-2"><p className="text-[10px] font-bold uppercase text-[var(--clinical-muted)]">Goals &amp; Preferences (NS-01)</p><p className="mt-0.5 whitespace-pre-wrap text-sm text-[var(--clinical-ink)]">{f.layer1.goalsPreferences}</p></div>}
            </div>
          )}
          {/* Recent events */}
          {(f.layer1.hospitalEd12mo || f.layer1.significantChange3090 || f.layer1.physicianFollowUp) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {f.layer1.hospitalEd12mo && <div><p className="text-[10px] font-bold uppercase text-[var(--clinical-muted)]">Hospital / ED (12 mo)</p><p className="text-sm text-[var(--clinical-ink)]">Yes{f.layer1.hospitalEdReason ? `: ${f.layer1.hospitalEdReason}` : ""}</p></div>}
              {f.layer1.significantChange3090 && <div><p className="text-[10px] font-bold uppercase text-[var(--clinical-muted)]">Significant Change (30–90 d)</p><p className="text-sm text-[var(--clinical-ink)]">Yes{f.layer1.significantChangeDescribe ? `: ${f.layer1.significantChangeDescribe}` : ""}</p></div>}
              {f.layer1.physicianFollowUp && <div><p className="text-[10px] font-bold uppercase text-[var(--clinical-muted)]">Physician Follow-Up</p><p className="text-sm text-[var(--clinical-ink)]">{f.layer1.physicianFollowUp}</p></div>}
            </div>
          )}
        </div>
      )}

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
        <div className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {f.domains.map((d) => {
            const dlt = deltaByCode.get(d.code) ?? 0;
            const dltColor = dlt > 0 ? "var(--clinical-coral)" : "var(--clinical-green)";
            const hasDetail = !!d.evidence || !!d.note || d.flags.length > 0;
            return (
            <div key={d.code} className="text-xs">
              <div className="flex items-center gap-2">
                <span className="w-32 shrink-0 truncate text-[var(--clinical-ink-soft)]" title={d.name}>{d.name}</span>
                <span className="flex flex-1 gap-0.5">
                  {[0, 1, 2, 3].map((n) => (
                    <span key={n} className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: n < d.score ? tone : "var(--clinical-line)" }} />
                  ))}
                </span>
                {dlt !== 0 && <span className="shrink-0 text-[10px] font-bold tabular-nums" style={{ color: dltColor }}>{dlt > 0 ? `+${dlt}` : dlt}</span>}
                <span className="w-6 shrink-0 text-right font-bold tabular-nums text-[var(--clinical-ink)]">{d.score}</span>
              </div>
              {hasDetail && (
                <div className="mt-1 space-y-0.5 pl-1">
                  {d.evidence && <p className="text-[11px] leading-snug text-[var(--clinical-ink-soft)]"><span className="font-semibold text-[var(--clinical-muted)]">Evidence: </span>{d.evidence}</p>}
                  {d.note && <p className="text-[11px] leading-snug text-[var(--clinical-muted)]"><span className="font-semibold">Goal: </span>{d.note}</p>}
                  {d.flags.length > 0 && <p className="text-[11px] leading-snug text-[var(--clinical-muted)]"><span className="font-semibold">Flags: </span>{d.flags.join(", ")}</p>}
                </div>
              )}
            </div>
            );
          })}
        </div>
      </div>

      {/* ── Layer 3 · Evaluation ── */}
      {f.layer3 && (f.layer3.belowFloorReason || f.layer3.overrideReason || f.layer3.reconciledModifiers?.length || f.layer3.capabilityReview || f.layer3.reassessmentInterval || f.layer3.nextReviewDate) && (
        <div className="rounded-lg border p-3 space-y-3" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface-2)" }}>
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[var(--clinical-panel)]"><Layers className="h-3.5 w-3.5" /> Layer 3 · Evaluation</p>
          {f.layer3.belowFloorReason && (
            <div>
              <p className="text-[10px] font-bold uppercase text-[var(--clinical-muted)]">Below-Floor Reason</p>
              <p className="mt-0.5 text-sm text-[var(--clinical-ink)]">{f.layer3.belowFloorReason}</p>
            </div>
          )}
          {f.layer3.overrideReason && (
            <div>
              <p className="text-[10px] font-bold uppercase text-[var(--clinical-muted)]">Override Reason</p>
              <p className="mt-0.5 text-sm text-[var(--clinical-ink)]">{f.layer3.overrideReason}</p>
            </div>
          )}
          {f.layer3.reconciledModifiers && f.layer3.reconciledModifiers.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase text-[var(--clinical-muted)]">Reconciled Modifiers</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {f.layer3.reconciledModifiers.map((m) => (
                  <span key={m} className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold" style={{ borderColor: "var(--clinical-panel)", color: "var(--clinical-panel)" }}>{m}</span>
                ))}
              </div>
            </div>
          )}
          {f.layer3.capabilityReview && (
            <div>
              <p className="text-[10px] font-bold uppercase text-[var(--clinical-muted)]">Capability Review</p>
              <div className="mt-1 flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold ${f.layer3.capabilityReview.outcome === "WITHIN_CAPABILITY" ? "bg-green-100 text-green-700" : "bg-rose-100 text-rose-700"}`}>{f.layer3.capabilityReview.outcome.replace(/_/g, " ")}</span>
              </div>
              {f.layer3.capabilityReview.rationale && <p className="mt-1 text-sm text-[var(--clinical-ink-soft)]">{f.layer3.capabilityReview.rationale}</p>}
            </div>
          )}
          {(f.layer3.reassessmentInterval || f.layer3.nextReviewDate) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {f.layer3.reassessmentInterval && <span className="text-xs text-[var(--clinical-muted)]">Reassess: <span className="font-semibold text-[var(--clinical-ink-soft)]">{f.layer3.reassessmentInterval}</span></span>}
              {f.layer3.nextReviewDate && <span className="text-xs text-[var(--clinical-muted)]">Next review: <span className="font-semibold text-[var(--clinical-ink-soft)]">{fmtDate(f.layer3.nextReviewDate)}</span></span>}
            </div>
          )}
        </div>
      )}
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
