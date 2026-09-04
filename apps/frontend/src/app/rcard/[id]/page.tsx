"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  Pill, ClipboardList, ConciergeBell, ShieldAlert,
  UserRound, CalendarClock, Loader2, FileDown, StickyNote, IdCard,
  Users, Phone, Activity, HeartPulse, Gauge, AlertTriangle, Heart, X, Package, FileText, Printer,
} from "lucide-react";
import { taskNotesOf } from "@/lib/taskNotes";
import { patientCode } from "@/lib/patientId";
import { parseAcuityItems, LOC_LEVEL_META } from "@/lib/locBilling";
import { parseLocHistory, historyForResident, LOC_SOURCE_LABEL } from "@/lib/lifecare/locHistory";
import { ABOUT_ME_KEY, parseAboutMeStore, profileFor, AboutMeProfile as AboutProfile } from "@/lib/aboutMe";
import { HEALTH_ASSESSMENT_KEY, parseHealthStore, healthFor, HealthAssessment } from "@/lib/healthAssessment";
import AboutMeProfile from "@/components/portal/views/clinical/AboutMeProfile";
import HealthAssessmentForm from "@/components/portal/views/clinical/HealthAssessmentForm";
import DocumentSection from "@/components/portal/views/clinical/DocumentSection";
import BelongingsFormsPanel from "@/components/portal/views/clinical/BelongingsForms";
import { updateRecord, upsertRecord } from "@/lib/api";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import { lifecareLetterhead, LIFECARE_BRAND_CSS } from "@/lib/lifecare/brand";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const fmt = (v: unknown) => (v ? new Date(s(v)).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");
const fmtDate = (v: unknown) => (v ? new Date(s(v)).toLocaleDateString() : "—");
const cap = (k: string) => k.charAt(0).toUpperCase() + k.slice(1);
const age = (dob: unknown) => {
  if (!dob) return null;
  const d = new Date(s(dob)); if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 31_557_600_000);
};

const STATUS_META: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700 border-emerald-200",
  DISCHARGED: "bg-gray-200 text-gray-700 border-gray-300",
  ON_LEAVE: "bg-amber-100 text-amber-700 border-amber-200",
  DECEASED: "bg-red-100 text-red-700 border-red-200",
};

const VAX_STATUS: Record<string, string> = {
  COMPLETED: "bg-emerald-100 text-emerald-700 border-emerald-200",
  SCHEDULED: "bg-blue-100 text-blue-700 border-blue-200",
  OVERDUE: "bg-red-100 text-red-700 border-red-200",
  DECLINED: "bg-gray-200 text-gray-600 border-gray-300",
  EXEMPTED: "bg-amber-100 text-amber-700 border-amber-200",
};
const SEVERITY_META: Record<string, string> = {
  MILD: "bg-gray-100 text-gray-600 border-gray-200",
  MODERATE: "bg-amber-100 text-amber-700 border-amber-200",
  SEVERE: "bg-orange-100 text-orange-700 border-orange-200",
  LIFE_THREATENING: "bg-red-100 text-red-700 border-red-200",
};

// Human labels for the admission 12-domain baseline + the acuity 10-domain scores.
const ADL_DOMAIN_LABEL: Record<string, string> = {
  clinical: "Clinical / Medical", adl: "Activities of Daily Living", cognitive: "Cognition",
  mobility: "Mobility", nutrition: "Nutrition", medication: "Medication", behavioral: "Behavioral",
  psychosocial: "Psychosocial", continence: "Continence", skin: "Skin / Wounds",
  communication: "Communication", emergency: "Emergency / Safety",
};
const ACUITY_DOMAIN_LABEL: Record<string, string> = {
  adl: "ADL", mobility: "Mobility", cognition: "Cognition", behavior: "Behavior", nutrition: "Nutrition",
  elimination: "Elimination", medication: "Medication", medical: "Medical", psychosocial: "Psychosocial", night: "Night Care",
};

type TabKey = "about" | "belongings" | "documents" | "family" | "emergency" | "adl" | "medical" | "advance" | "acuity" | "preadmit" | "care";
type TabGroup = "Overview" | "Clinical" | "Assessment" | "Records";
const TAB_GROUPS: TabGroup[] = ["Overview", "Clinical", "Assessment", "Records"];
// Nav-audit §03 — the sidebar's per-resident entries now live here as record
// tabs (Journey · Clinical Records · Monitoring · Care Plan added), grouped so
// the growing tab list stays scannable. Routes for the standalone boards stay.
const TABS: { key: TabKey; label: string; icon: typeof Pill; group: TabGroup }[] = [
  // Overview — profile + belongings + documents live together up front.
  { key: "about", label: "About Me", icon: Heart, group: "Overview" },
  { key: "belongings", label: "Belongings", icon: Package, group: "Overview" },
  { key: "documents", label: "Documents", icon: FileText, group: "Overview" },
  { key: "family", label: "Family", icon: Users, group: "Overview" },
  { key: "emergency", label: "Emergency", icon: Phone, group: "Overview" },
  // Clinical
  { key: "care", label: "Meds & Tasks", icon: CalendarClock, group: "Clinical" },
  { key: "adl", label: "ADL Baseline", icon: Activity, group: "Clinical" },
  // Assessment & LOC
  { key: "preadmit", label: "Pre-Admission (v4.2)", icon: ClipboardList, group: "Assessment" },
  { key: "acuity", label: "Care Acuity", icon: Gauge, group: "Assessment" },
  // Records
  { key: "medical", label: "Medical & Surgical Hx", icon: ClipboardList, group: "Records" },
  { key: "advance", label: "Advance Care", icon: HeartPulse, group: "Records" },
];

async function getJson(url: string) {
  try { const r = await fetch(url, { credentials: "include" }); if (!r.ok) return { ok: false, status: r.status, data: null }; const j = await r.json(); return { ok: true, status: 200, data: j?.data ?? null }; }
  catch { return { ok: false, status: 0, data: null }; }
}

type Assessment = { note?: string; domains?: Record<string, { level?: string; notes?: string }> };
function parseAssessment(raw: string): Assessment | null {
  if (!raw) return null;
  try { const v = JSON.parse(raw); return v && typeof v === "object" ? (v as Assessment) : null; } catch { return null; }
}

// Latest acuity record for a resident — an APPROVED one wins; otherwise the most
// recent of any status (so a pending/in-review assessment still shows).
function latestAcuityFor(items: Array<Record<string, unknown>>, residentId: string): Record<string, unknown> | null {
  const mine = items.filter((x) => x && x.residentId === residentId);
  const approved = mine.filter((x) => x.status === "APPROVED");
  const pool = approved.length ? approved : mine;
  return pool.sort((a, b) => s(b.decidedAt || b.createdAt).localeCompare(s(a.decidedAt || a.createdAt)))[0] || null;
}

// The 14 scored v4.2 assessment domains (labels kept local to avoid pulling the
// full rule-data bundle into the resident card).
const V42_DOMAIN_LABEL: Record<string, string> = {
  "AS-01": "ADLs / Personal Care", "AS-02": "Mobility / Transfers", "AS-03": "Fall Risk",
  "AS-04": "Cognition", "AS-05": "Behavior / BPSD", "AS-06": "Clinical Monitoring",
  "AS-07": "Medication Support", "AS-08": "Nutrition / Hydration", "AS-09": "Communication",
  "AS-10": "Continence / Toileting", "AS-11": "Skin Integrity", "AS-12": "Sleep / Daily Routine",
  "AS-13": "Safety / Supervision", "AS-14": "Reablement / Therapy",
};
type V42 = {
  id?: string; status?: string; updatedAt?: string; createdAt?: string;
  layer1?: { residentId?: string; convertedAdmissionId?: string; residentName?: string; reasonForAdmission?: string; goalsPreferences?: string };
  domains?: Record<string, { score?: number }>;
  layer3?: { finalLevel?: string; finalLevelJustification?: string };
};
function parseV42Items(raw: string): V42[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? (v as V42[]) : []; } catch { return []; }
}
/** Latest v4.2 assessment for a resident — matched by linked residentId, admission id,
 * or resident name (a validated assessment may not carry a residentId/admission link yet). */
function latestV42For(items: V42[], residentId: string, admissionIds: string[], residentName: string): V42 | null {
  const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const rn = norm(residentName);
  const mine = items.filter((a) =>
    a?.layer1?.residentId === residentId ||
    (a?.layer1?.convertedAdmissionId && admissionIds.includes(String(a.layer1.convertedAdmissionId))) ||
    (!!rn && norm(a?.layer1?.residentName) === rn));
  const validated = mine.filter((a) => a.status === "VALIDATED" || a.status === "COMPLETED");
  const pool = validated.length ? validated : mine;
  return pool.sort((a, b) => s(b.updatedAt || b.createdAt).localeCompare(s(a.updatedAt || a.createdAt)))[0] || null;
}
function v42RawScore(a: V42 | null): number {
  if (!a?.domains) return 0;
  return Object.values(a.domains).reduce((sum, d) => sum + (typeof d?.score === "number" ? d.score : 0), 0);
}

export default function ResidentCardPage() {
  const params = useParams();
  const id = String(params?.id ?? "");

  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [resident, setResident] = useState<Row | null>(null);
  const [meds, setMeds] = useState<Row[]>([]);
  const [requests, setRequests] = useState<Row[]>([]);
  const [tasks, setTasks] = useState<Row[]>([]);
  const [comms, setComms] = useState<Row[]>([]);
  const [diets, setDiets] = useState<Row[]>([]);
  const [admissions, setAdmissions] = useState<Row[]>([]);
  const [vaccinations, setVaccinations] = useState<Row[]>([]);
  const [allergyRecs, setAllergyRecs] = useState<Row[]>([]);
  const [acuityRows, setAcuityRows] = useState<Row[]>([]);
  const [assessV42Rows, setAssessV42Rows] = useState<Row[]>([]);
  const [locHistoryRows, setLocHistoryRows] = useState<Row[]>([]);
  const [sponsor, setSponsor] = useState<Row | null>(null);
  const [aboutRows, setAboutRows] = useState<Row[]>([]);
  const [healthRows, setHealthRows] = useState<Row[]>([]);
  const [docs, setDocs] = useState<Row[]>([]);
  const [sessionRole, setSessionRole] = useState<string>("");
  const [reloadKey, setReloadKey] = useState(0);
  const loadedIdRef = useRef("");
  const [tab, setTab] = useState<TabKey>("about");
  const [cardUrl, setCardUrl] = useState("");
  const [qrData, setQrData] = useState("");

  useEffect(() => { setCardUrl(window.location.href); }, []);
  useEffect(() => { if (cardUrl) QRCode.toDataURL(cardUrl, { width: 512, margin: 1 }).then(setQrData).catch(() => {}); }, [cardUrl]);
  // Viewer role — only Nurse / Care Manager / Super Admin may edit the About Me profile.
  useEffect(() => { fetch("/api/auth/session").then((r) => r.json()).then((d) => setSessionRole(s(d?.session?.role))).catch(() => {}); }, []);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      // Full-screen spinner only on the first load of a resident; the focus /
      // visibility refresh below re-runs this effect and must stay silent so the
      // card doesn't flash a loader every time the browser tab regains focus.
      if (loadedIdRef.current !== id) setLoading(true);
      const res = await getJson(`/api/db/residents/${id}`);
      if (!alive) return;
      if (res.status === 401) { setDenied(true); setLoading(false); return; }
      const r = res.data as Row | null;
      setResident(r);
      const [m, sr, tk, pc, dt, adm, vax, alg, acu, av42, lh, abt, hlth, doc] = await Promise.all([
        getJson(`/api/db/medications?f_residentId=${id}&take=100`),
        getJson(`/api/db/service-requests?f_residentId=${id}&take=100`),
        getJson(`/api/db/tasks?f_residentId=${id}&take=100`),
        getJson(`/api/db/physician-communications?f_residentId=${id}&take=50`),
        getJson(`/api/db/diet-orders?f_residentId=${id}&take=50`),
        getJson(`/api/db/admissions?f_residentId=${id}&take=5`),
        getJson(`/api/db/vaccinations?f_residentId=${id}&take=100`),
        getJson(`/api/db/allergies?f_residentId=${id}&take=100`),
        getJson(`/api/db/app-settings?f_key=acuity_assessments&take=50`),
        getJson(`/api/db/app-settings?f_key=assessments_v42&take=100`),
        getJson(`/api/db/app-settings?f_key=loc_history&take=1`),
        getJson(`/api/db/app-settings?f_key=${ABOUT_ME_KEY}&take=1`),
        getJson(`/api/db/app-settings?f_key=${HEALTH_ASSESSMENT_KEY}&take=1`),
        getJson(`/api/db/resident-documents?f_residentId=${id}&take=500`),
      ]);
      if (!alive) return;
      setDocs((doc.data as Row[]) || []);
      setHealthRows((hlth.data as Row[]) || []);
      setMeds((m.data as Row[]) || []);
      setRequests((sr.data as Row[]) || []);
      setTasks((tk.data as Row[]) || []);
      setComms((pc.data as Row[]) || []);
      setDiets((dt.data as Row[]) || []);
      setAdmissions((adm.data as Row[]) || []);
      setVaccinations((vax.data as Row[]) || []);
      setAllergyRecs((alg.data as Row[]) || []);
      setAcuityRows((acu.data as Row[]) || []);
      setAssessV42Rows((av42.data as Row[]) || []);
      setLocHistoryRows((lh.data as Row[]) || []);
      setAboutRows((abt.data as Row[]) || []);
      const sponsorId = s(r?.sponsorId);
      if (sponsorId) {
        const sp = await getJson(`/api/db/users?f_id=${sponsorId}&take=1`);
        if (alive) setSponsor(((sp.data as Row[]) || [])[0] || null);
      }
      loadedIdRef.current = id;
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [id, reloadKey]);
  // Realtime-ish: refresh the card's records whenever the user returns to the tab
  // (e.g. after validating an assessment elsewhere) so it never shows stale data.
  useEffect(() => {
    const bump = () => { if (document.visibilityState === "visible") setReloadKey((k) => k + 1); };
    window.addEventListener("focus", bump);
    document.addEventListener("visibilitychange", bump);
    return () => { window.removeEventListener("focus", bump); document.removeEventListener("visibilitychange", bump); };
  }, []);

  const activeMeds = useMemo(() => meds.filter(m => s(m.status) === "ACTIVE" || s(m.status) === "PENDING"), [meds]);
  const recentRequests = useMemo(
    () => [...requests].sort((a, b) => new Date(s(b.createdAt)).getTime() - new Date(s(a.createdAt)).getTime()).slice(0, 6),
    [requests],
  );
  const openTasks = useMemo(
    () => tasks.filter(t => s(t.status) !== "COMPLETED" && s(t.status) !== "CANCELLED")
      .sort((a, b) => new Date(s(a.dueDate)).getTime() - new Date(s(b.dueDate)).getTime()),
    [tasks],
  );

  // Primary physician derived from the latest physician communication; diet from
  // the resident's active diet order (both migration-free).
  // Prefer the resident record's own value (editable on the card); fall back to the
  // derived value (latest physician comm / active diet order) when it's blank.
  const primaryPhysician = useMemo(() => {
    if (s(resident?.primaryPhysician)) return s(resident?.primaryPhysician);
    const latest = [...comms].sort((a, b) => new Date(s(b.occurredAt)).getTime() - new Date(s(a.occurredAt)).getTime())[0];
    return s(latest?.physicianName);
  }, [comms, resident]);
  const dietRestriction = useMemo(() => {
    if (s(resident?.dietRestriction)) return s(resident?.dietRestriction);
    const active = diets.filter(d => d.active !== false)[0];
    if (!active) return "";
    return [s(active.dietType).replace(/_/g, " "), s(active.restrictions)].filter(Boolean).join(" · ");
  }, [diets, resident]);

  // The admission 12-domain clinical assessment doubles as the ADL baseline.
  const baseline = useMemo(() => parseAssessment(s(admissions[0]?.careAssessment)), [admissions]);
  // Latest acuity (Level of Care) assessment from the migration-free app-setting.
  const acuity = useMemo(() => {
    const row = acuityRows.find((x) => s(x.key) === "acuity_assessments") || acuityRows[0];
    return latestAcuityFor(parseAcuityItems(row ? s(row.value) : null), id);
  }, [acuityRows, id]);
  // Latest v4.2 Pre-Admission assessment for this resident (matched by residentId or admission).
  const assessV42 = useMemo(() => {
    const row = assessV42Rows.find((x) => s(x.key) === "assessments_v42") || assessV42Rows[0];
    const admissionIds = admissions.map((a) => s(a.id));
    const rname = [s(resident?.firstName), s(resident?.lastName)].filter(Boolean).join(" ").trim();
    return latestV42For(parseV42Items(row ? s(row.value) : ""), id, admissionIds, rname);
  }, [assessV42Rows, admissions, id, resident]);
  // Care Acuity view — the authoritative Level of Care is the validated v4.2 decision
  // when one exists (its Final LOC can override the raw acuity band); otherwise fall
  // back to the legacy acuity record.
  const acuityView = useMemo(() => {
    const av = assessV42;
    if (av && (av.status === "VALIDATED" || av.status === "COMPLETED") && av.layer3?.finalLevel) {
      const levelN = String(av.layer3.finalLevel).replace(/^L/i, "");
      const doms = (av.domains ?? {}) as Record<string, { score?: number }>;
      return {
        levelN, levelName: LOC_LEVEL_META.find((l) => l.level === Number(levelN))?.name || "",
        score: v42RawScore(av), max: 56, status: s(av.status), assessedAt: s(av.updatedAt || av.createdAt),
        trigger: "", notes: s(av.layer3.finalLevelJustification),
        domainList: Object.entries(V42_DOMAIN_LABEL).map(([code, label]) => ({ label, score: s(doms[code]?.score ?? 0) })),
      };
    }
    if (!acuity) return null;
    const scores = (acuity.scores && typeof acuity.scores === "object" ? acuity.scores : {}) as Record<string, unknown>;
    return {
      levelN: s(acuity.level), levelName: LOC_LEVEL_META.find((l) => l.level === Number(acuity.level))?.name || s(acuity.levelName),
      score: Number(acuity.total) || 0, max: 50, status: s(acuity.status), assessedAt: s(acuity.decidedAt || acuity.createdAt),
      trigger: s(acuity.trigger), notes: s(acuity.notes),
      domainList: Object.entries(scores).map(([k, v]) => ({ label: ACUITY_DOMAIN_LABEL[k] || cap(k), score: s(v) })),
    };
  }, [assessV42, acuity]);
  // Full Level of Care history (pre-admission → reassessments → acuity approvals).
  const locTimeline = useMemo(() => {
    const row = locHistoryRows.find((x) => s(x.key) === "loc_history") || locHistoryRows[0];
    const admissionIds = admissions.map((a) => s(a.id));
    return historyForResident(parseLocHistory(row ? s(row.value) : ""), id, admissionIds);
  }, [locHistoryRows, admissions, id]);

  // About Me profile (migration-free app-setting, keyed by residentId).
  const aboutStore = useMemo(() => {
    const row = aboutRows.find((x) => s(x.key) === ABOUT_ME_KEY) || aboutRows[0];
    return parseAboutMeStore(row ? s(row.value) : "");
  }, [aboutRows]);
  const aboutProfile = useMemo(() => profileFor(aboutStore, id), [aboutStore, id]);
  const canEditAbout = sessionRole === "NURSE" || sessionRole === "CARE_MANAGER" || sessionRole === "SUPERADMIN";

  // APPENDIX IV health assessment (migration-free app-setting, keyed by residentId).
  const healthStore = useMemo(() => {
    const row = healthRows.find((x) => s(x.key) === HEALTH_ASSESSMENT_KEY) || healthRows[0];
    return parseHealthStore(row ? s(row.value) : "");
  }, [healthRows]);
  const healthProfile = useMemo(() => healthFor(healthStore, id), [healthStore, id]);
  const saveHealth = async (next: HealthAssessment) => {
    const stamped: HealthAssessment = { ...next, updatedAt: new Date().toISOString(), updatedBy: sessionRole || "staff" };
    const nextStore = { ...healthStore, [id]: stamped };
    await upsertRecord("app-settings", HEALTH_ASSESSMENT_KEY, { key: HEALTH_ASSESSMENT_KEY, value: JSON.stringify(nextStore) });
    setHealthRows([{ key: HEALTH_ASSESSMENT_KEY, value: JSON.stringify(nextStore) }]);
  };
  // Resident master-profile fields (allergies, physician, emergency contact, diet)
  // are server-gated to Care Manager / Super Admin (see residentProfileEditDenied),
  // so mirror that on the client — a nurse editing them would 403 on save.
  const canEditProfile = sessionRole === "CARE_MANAGER" || sessionRole === "SUPERADMIN";
  const saveAbout = async (next: AboutProfile) => {
    const stamped: AboutProfile = { ...next, updatedAt: new Date().toISOString(), updatedBy: sessionRole || "staff" };
    const nextStore = { ...aboutStore, [id]: stamped };
    await upsertRecord("app-settings", ABOUT_ME_KEY, { key: ABOUT_ME_KEY, value: JSON.stringify(nextStore) });
    setAboutRows([{ key: ABOUT_ME_KEY, value: JSON.stringify(nextStore) }]);
  };

  // Resident has no diagnosis/medicalAssessment column, and allergies/medicalHistory
  // may be blank on the resident while the linked Admission holds them — so fall
  // back to the admission for a complete picture.
  const adm0 = useMemo(() => (admissions[0] || {}) as Row, [admissions]);
  const effAllergies = useMemo(() => s(resident?.allergies) || s(adm0.allergies), [resident, adm0]);
  const effHistory = useMemo(() => s(resident?.medicalHistory) || s(adm0.medicalHistory), [resident, adm0]);
  const effAssessment = useMemo(() => s(adm0.medicalAssessment), [adm0]);
  const primaryDiagnosis = useMemo(() => (effHistory.split(/[;·]/)[0] || "").trim(), [effHistory]);
  // Editable, add-many diagnoses persist in the About Me store (migration-free);
  // fall back to the medical-history-derived primary diagnosis when none saved yet.
  const diagnoses = useMemo(() => {
    const stored = (aboutProfile.diagnoses ?? []).map((d) => s(d).trim()).filter(Boolean);
    return stored.length ? stored : primaryDiagnosis ? [primaryDiagnosis] : [];
  }, [aboutProfile, primaryDiagnosis]);
  const saveDiagnoses = (next: string[]) => saveAbout({ ...aboutProfile, diagnoses: next });
  // Write editable care-card fields straight to the resident record so every view
  // (directory, care logs, family portal) auto-updates from the same source.
  const saveResident = async (patch: Record<string, string | boolean>) => {
    await updateRecord("residents", id, patch);
    setResident((r) => (r ? { ...r, ...patch } : r));
  };
  const refetchDocs = async () => {
    const d = await getJson(`/api/db/resident-documents?f_residentId=${id}&take=500`);
    setDocs((d.data as Row[]) || []);
  };
  const refetchVaccines = async () => {
    const v = await getJson(`/api/db/vaccinations?f_residentId=${id}&take=100`);
    setVaccinations((v.data as Row[]) || []);
  };
  // Family sponsor: prefer the linked sponsor User, else fall back to the
  // admission's captured sponsor name/email.
  const sponsorName = useMemo(() => ([s(sponsor?.firstName), s(sponsor?.lastName)].filter(Boolean).join(" ") || s(sponsor?.name) || s(adm0.sponsorName)), [sponsor, adm0]);
  const sponsorEmail = useMemo(() => s(sponsor?.email) || s(adm0.sponsorEmail), [sponsor, adm0]);
  const sponsorPhone = useMemo(() => s(sponsor?.phone), [sponsor]);

  const residentSlug = () => (`${s(resident?.firstName)} ${s(resident?.lastName)}`.trim() || "resident").toLowerCase().replace(/\s+/g, "-");

  // The whole care card as a downloadable PDF (shown after the QR is scanned).
  const downloadFullPdf = () => {
    if (!resident) return;
    const name = `${s(resident.firstName)} ${s(resident.lastName)}`.trim() || "Resident";
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const M = 40, MAXW = 480, PH = doc.internal.pageSize.getHeight();
    let y = 50;
    const ensure = (h = 14) => { if (y + h > PH - 40) { doc.addPage(); y = 50; } };
    const heading = (t: string) => { ensure(24); doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(30); doc.text(t, M, y); y += 15; };
    const body = (t: string) => { doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(70); for (const ln of doc.splitTextToSize(t || "—", MAXW)) { ensure(13); doc.text(ln, M, y); y += 13; } y += 6; };

    doc.setFont("helvetica", "bold").setFontSize(18).setTextColor(20).text("Resident Care Card", M, y);
    if (qrData) doc.addImage(qrData, "PNG", 470, 26, 90, 90);
    y += 22;
    doc.setFont("helvetica", "bold").setFontSize(14).text(name, M, y); y += 15;
    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(46, 74, 72).text(`Patient ID: ${patientCode(s(resident.id))}`, M, y); y += 15;
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(100).text(`Room ${s(resident.roomNumber) || "—"} · ${s(resident.careLevel) || "—"} · DOB ${fmtDate(resident.dateOfBirth)}${age(resident.dateOfBirth) != null ? ` · ${age(resident.dateOfBirth)} yrs` : ""}`, M, y); y += 24;

    heading("Allergies"); body(effAllergies || "None on record");
    if (effAssessment) { heading("Clinical Assessment"); body(effAssessment); }
    heading("Medical History"); body(effHistory);
    if (resident.surgeries) { heading("Surgeries"); body(s(resident.surgeries)); }
    if (resident.hospitalizations) { heading("Hospitalizations"); body(s(resident.hospitalizations)); }
    heading("Advance Care"); body(`Code status: ${s(resident.codeStatus) || "—"}${resident.dnrStatus ? " · DNR" : ""}`);
    if (resident.advanceDirectives) body(s(resident.advanceDirectives));
    if (acuity) { heading("Care Acuity"); body(`Level ${s(acuity.level)} — ${LOC_LEVEL_META.find((l) => l.level === Number(acuity.level))?.name || s(acuity.levelName)} · score ${s(acuity.total)}/50 · ${s(acuity.status)}`); }
    heading(`Medications (${activeMeds.length})`);
    activeMeds.length ? activeMeds.forEach(m => body(`• ${s(m.name)} ${s(m.dosage)} · ${s(m.frequency)}${m.route ? ` · ${s(m.route)}` : ""}`)) : body("None active");
    heading("Recent Requests");
    recentRequests.length ? recentRequests.forEach(r => body(`• ${s(r.category).replace(/_/g, " ")}${r.subType ? ` — ${s(r.subType)}` : ""}: ${s(r.details)} [${s(r.status)}]`)) : body("None");
    heading("Assignments / To-do");
    openTasks.length ? openTasks.forEach(t => { body(`• ${s(t.title)}${t.dueDate ? ` (due ${fmtDate(t.dueDate)})` : ""}`); taskNotesOf(t as Record<string, unknown>).forEach(n => body(`    - Note: ${n.text} (${n.author})`)); }) : body("Nothing outstanding");
    if (resident.emergencyContact || resident.emergencyContactPhone) { heading("Emergency Contact"); body(`${s(resident.emergencyContact)} ${resident.emergencyContactPhone ? `· ${s(resident.emergencyContactPhone)}` : ""}`); }

    doc.setFontSize(8).setTextColor(150).text(`Generated ${new Date().toLocaleString()} · confidential — authorized care staff only`, M, PH - 24);
    doc.save(`${residentSlug()}-care-card.pdf`);
  };

  // Printable Medical & Surgical History on the LifeCare letterhead — opens the
  // browser Print / Save-as-PDF dialog once the logo image has loaded.
  const printMedicalHistory = () => {
    if (!resident) return;
    const w = window.open("", "_blank", "width=840,height=1000");
    if (!w) return;
    const esc = (v: unknown) => s(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
    const row = (label: string, value: unknown) => (s(value).trim() ? `<div class="row"><div class="l">${esc(label)}</div><div class="v">${esc(value).replace(/\n/g, "<br>")}</div></div>` : "");
    const allergyHtml = allergyRecs.length
      ? `<ul class="alg">${allergyRecs.map((a) => `<li><b>${esc(a.allergen)}</b>${a.reaction ? ` — ${esc(a.reaction)}` : ""} <span class="sev">${esc(s(a.severity).replace(/_/g, " "))}</span></li>`).join("")}</ul>`
      : `<p>${esc(effAllergies || allergies || "None on record.")}</p>`;
    const name = `${s(resident.firstName)} ${s(resident.lastName)}`.trim() || "Resident";
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)} — Medical History</title>
<style>
  *{box-sizing:border-box}
  body{font-family:"Segoe UI",system-ui,-apple-system,Arial,sans-serif;color:#1f2933;line-height:1.6;max-width:800px;margin:0 auto;padding:36px 40px;font-size:13px}
  ${LIFECARE_BRAND_CSS}
  hr.rule{border:0;border-top:1.5px solid #ced4da;margin:10px 0 14px}
  .company{font-weight:800;font-size:16px;margin:0 0 1px}
  .title{font-weight:700;font-size:13px;color:#343a40;margin:0 0 10px}
  .id{margin:1px 0;font-size:12px}.id b{display:inline-block;min-width:110px}
  h2{font-size:14px;color:#212529;border-bottom:1.5px solid #dee2e6;padding-bottom:4px;margin:18px 0 8px}
  .row{display:flex;gap:12px;margin:6px 0;page-break-inside:avoid}.row .l{min-width:170px;font-weight:700;color:#343a40}.row .v{flex:1}
  ul.alg{margin:4px 0;padding-left:18px}ul.alg li{margin:2px 0}.sev{font-size:10px;font-weight:700;text-transform:uppercase;color:#b45309}
  .foot{margin-top:24px;border-top:1px solid #e9ecef;padding-top:8px;color:#adb5bd;font-size:11px}
  @page{margin:0}@media print{body{padding:24px 30px}}
</style></head><body onload="window.focus();window.print()">
  ${lifecareLetterhead()}
  <hr class="rule">
  <p class="company">LifeCare Living Solutions, Inc.</p>
  <p class="title">Resident Medical &amp; Surgical History</p>
  <div class="id"><b>Resident:</b> ${esc(name)}</div>
  <div class="id"><b>Patient ID:</b> ${esc(patientCode(s(resident.id)))}</div>
  <div class="id"><b>Room / DOB:</b> ${esc(s(resident.roomNumber) || "—")} · ${esc(fmtDate(resident.dateOfBirth))}${age(resident.dateOfBirth) != null ? ` · ${age(resident.dateOfBirth)} yrs` : ""}</div>
  <h2>Medical &amp; Surgical History</h2>
  ${row("Primary Diagnosis", primaryDiagnosis)}
  ${effAssessment ? row("Clinical Assessment", effAssessment) : ""}
  ${row("History", effHistory)}
  ${row("Surgeries", s(resident.surgeries))}
  ${row("Hospitalizations", s(resident.hospitalizations))}
  <h2>Allergies</h2>
  ${allergyHtml}
  <div class="foot">Generated ${esc(new Date().toLocaleString())} · Confidential — for authorized use only.</div>
</body></html>`);
    w.document.close();
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>;
  }
  if (denied || !resident) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-sm text-center bg-white rounded-2xl border border-gray-200 p-8">
          <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-gray-900">{denied ? "Staff sign-in required" : "Resident not found"}</h1>
          <p className="text-sm text-gray-500 mt-1">{denied ? "Log in with your staff account to view this resident card." : "This resident card is unavailable."}</p>
          {denied && <a href="/login" className="inline-block mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold">Go to login</a>}
        </div>
      </div>
    );
  }

  const name = `${s(resident.firstName)} ${s(resident.lastName)}`.trim() || "Resident";
  const yrs = age(resident.dateOfBirth);
  const allergies = effAllergies;

  return (
    <div className="min-h-screen bg-gray-50 py-6 px-4 print:bg-white print:py-0">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Title bar */}
        <div className="bg-[#2E4A48] text-white px-5 py-3 flex items-center justify-between rounded-2xl shadow-sm print:shadow-none">
          <span className="text-sm font-semibold uppercase tracking-wide flex items-center gap-2"><UserRound className="w-4 h-4" /> Resident Care Card</span>
          <button onClick={downloadFullPdf} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-sm font-semibold transition print:hidden">
            <FileDown className="w-4 h-4" /> Download PDF
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)] items-start">
        {/* Summary rail — identity + key fields, stays in view while editing */}
        <aside className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 lg:sticky lg:top-6 print:static print:shadow-none">
          <div className="flex items-start gap-4">
            {resident.photoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={s(resident.photoUrl)} alt="" className="w-14 h-14 rounded-full object-cover border border-gray-200 shrink-0" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-[#2E4A48] text-white flex items-center justify-center shrink-0"><UserRound className="w-7 h-7" /></div>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-extrabold text-gray-900 truncate">{name}</h1>
              <p className="mt-1 inline-flex items-center gap-1.5 rounded bg-gray-100 px-2 py-0.5 text-xs font-bold tracking-wide text-gray-800">
                <IdCard className="w-3.5 h-3.5 text-[#2E4A48]" /> {patientCode(s(resident.id))}
              </p>
              <p className="text-sm text-gray-500 mt-1">Room {s(resident.roomNumber) || "—"} · Admitted {fmtDate(resident.admissionDate)}{yrs != null ? ` · Age ${yrs}` : ""}</p>
            </div>
            <span className={`shrink-0 px-2.5 py-1 rounded text-[11px] font-bold uppercase border ${STATUS_META[s(resident.status)] || STATUS_META.ACTIVE}`}>{s(resident.status).replace(/_/g, " ") || "ACTIVE"}</span>
          </div>
          <div className="grid grid-cols-1 gap-y-3 mt-4">
            <DiagnosisCell diagnoses={diagnoses} canEdit={canEditAbout} onSave={saveDiagnoses} />
            <Cell label="Care Level" value={s(resident.careLevel).replace(/_/g, " ")} accent />
            <EditableResidentCell label="Allergies" value={allergies} canEdit={canEditProfile} danger onSave={saveResident} fields={[{ key: "allergies", current: s(resident.allergies), placeholder: "e.g. Penicillin, peanuts" }]} />
            <EditableResidentCell label="Primary Physician" value={primaryPhysician} canEdit={canEditProfile} onSave={saveResident} fields={[{ key: "primaryPhysician", current: s(resident.primaryPhysician), placeholder: "Dr. name" }]} />
            <EditableResidentCell label="Emergency Contact" value={[s(resident.emergencyContact), s(resident.emergencyContactPhone)].filter(Boolean).join(" · ")} canEdit={canEditProfile} onSave={saveResident} fields={[{ key: "emergencyContact", current: s(resident.emergencyContact), placeholder: "Contact name" }, { key: "emergencyContactPhone", current: s(resident.emergencyContactPhone), placeholder: "Phone" }]} />
            <EditableResidentCell label="Diet Restriction" value={dietRestriction} canEdit={canEditProfile} accent onSave={saveResident} fields={[{ key: "dietRestriction", current: s(resident.dietRestriction), placeholder: "e.g. Low sodium" }]} />
          </div>
        </aside>

        {/* Main content — tabs + panels */}
        <main className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden print:shadow-none">
        {/* Resident profile tab bar (About/Family/Emergency/Vaccines/ADL/Medical/Advance/Acuity) */}
        <div className="border-b border-gray-200 bg-gray-50/60 print:hidden">
          <div className="flex gap-0.5 overflow-x-auto px-3 no-scrollbar">
            {TAB_GROUPS.map((g, gi) => (
              <div key={g} className="flex items-center gap-0.5 shrink-0">
                {gi > 0 && <span className="mx-1.5 h-5 w-px bg-gray-200 shrink-0" aria-hidden="true" />}
                {TABS.filter((t) => t.group === g).map(({ key, label, icon: Icon }) => {
                  const on = tab === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setTab(key)}
                      className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition ${
                        on ? "border-[#2E4A48] text-[#2E4A48]" : "border-transparent text-gray-500 hover:text-gray-800"
                      }`}
                    >
                      <Icon className="w-4 h-4" /> {label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Active tab panel */}
        <div className="px-5 py-5">
          {tab === "about" && (
            <AboutMeProfile profile={aboutProfile} canEdit={canEditAbout} onSave={saveAbout} />
          )}

          {tab === "belongings" && (
            <BelongingsFormsPanel residentId={id} residentName={name} room={s(resident.roomNumber)} canEdit={canEditAbout} />
          )}

          {tab === "documents" && (
            <DocumentSection residentId={id} documentType="BELONGINGS" label="Signed Documents" canEdit={canEditAbout} docs={docs} onChanged={refetchDocs} uploadedByName={sessionRole} />
          )}

          {tab === "family" && (
            <Section title="Family & Sponsor" icon={Users}>
              {(sponsorName || sponsorEmail) ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                  <Cell label="Name" value={sponsorName} accent />
                  <Cell label="Role" value="Sponsor / billing contact" />
                  <Cell label="Phone" value={sponsorPhone} />
                  <Cell label="Email" value={sponsorEmail} />
                </div>
              ) : (
                <p className="text-sm text-gray-400">No family sponsor on record.</p>
              )}
            </Section>
          )}

          {tab === "emergency" && (
            <Section title="Emergency Contact" icon={Phone}>
              {resident.emergencyContact || resident.emergencyContactPhone ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                  <Cell label="Contact" value={s(resident.emergencyContact)} accent />
                  <Cell label="Phone" value={s(resident.emergencyContactPhone)} />
                </div>
              ) : (
                <p className="text-sm text-gray-400">No emergency contact on record.</p>
              )}
            </Section>
          )}

          {tab === "adl" && (
            <Section title="ADL Baseline — Admission Assessment" icon={Activity}>
              {baseline?.domains && Object.keys(baseline.domains).length > 0 ? (
                <div className="space-y-2">
                  {Object.entries(baseline.domains).map(([k, d]) => (
                    <div key={k} className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 p-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">{ADL_DOMAIN_LABEL[k] || cap(k)}</p>
                        {d?.notes ? <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap">{d.notes}</p> : null}
                      </div>
                      <span className="shrink-0 px-2 py-0.5 rounded text-[11px] font-semibold bg-[#2E4A48]/10 text-[#2E4A48] border border-[#2E4A48]/20">{d?.level || "—"}</span>
                    </div>
                  ))}
                  {baseline.note ? <p className="text-xs text-gray-500 whitespace-pre-wrap pt-1"><b className="text-gray-700">Summary:</b> {baseline.note}</p> : null}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No admission (12-domain) assessment on file for this resident.</p>
              )}
            </Section>
          )}

          {tab === "medical" && (
            <>
            <div className="flex justify-end">
              <button onClick={printMedicalHistory} className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"><Printer className="h-3.5 w-3.5" /> Print Medical History</button>
            </div>
            <Section title="Medical & Surgical History" icon={ClipboardList}>
              <div className="space-y-3">
                <KV label="Primary Diagnosis" value={primaryDiagnosis} />
                {effAssessment ? <KV label="Clinical Assessment" value={effAssessment} /> : null}
                <EditableResidentCell label="History" value={effHistory} canEdit={canEditProfile} multiline onSave={saveResident} fields={[{ key: "medicalHistory", current: s(resident.medicalHistory), placeholder: "Medical & surgical history" }]} />
                <EditableResidentCell label="Surgeries" value={s(resident.surgeries)} canEdit={canEditProfile} multiline onSave={saveResident} fields={[{ key: "surgeries", current: s(resident.surgeries), placeholder: "Past surgeries" }]} />
                <EditableResidentCell label="Hospitalizations" value={s(resident.hospitalizations)} canEdit={canEditProfile} multiline onSave={saveResident} fields={[{ key: "hospitalizations", current: s(resident.hospitalizations), placeholder: "Hospitalizations" }]} />
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1">Allergies</p>
                  {allergyRecs.length > 0 ? (
                    <ul className="space-y-1.5">
                      {allergyRecs.map((a) => (
                        <li key={s(a.id)} className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 p-2">
                          <span className="text-sm text-gray-800"><AlertTriangle className="inline w-3.5 h-3.5 text-amber-500 mr-1 -mt-0.5" />{s(a.allergen)}{a.reaction ? <span className="text-gray-500"> — {s(a.reaction)}</span> : ""}<span className="text-[11px] text-gray-400"> · {s(a.type).replace(/_/g, " ")}</span></span>
                          <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${SEVERITY_META[s(a.severity)] || SEVERITY_META.MILD}`}>{s(a.severity).replace(/_/g, " ") || "—"}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={`text-sm ${allergies ? "text-red-600 font-semibold" : "text-gray-400"}`}>{allergies || "None on record."}</p>
                  )}
                </div>
              </div>
            </Section>
            <HealthAssessmentForm profile={healthProfile} canEdit={canEditAbout} residentName={name} defaultPhysician={primaryPhysician} defaultAllergies={effAllergies} onSave={saveHealth} />
            <DocumentSection residentId={id} documentType="MEDICAL_HISTORY" label="Documents" canEdit={canEditAbout} docs={docs} onChanged={refetchDocs} uploadedByName={sessionRole} />
            </>
          )}

          {tab === "advance" && (
            <>
            <Section title="Advance Care Planning" icon={HeartPulse}>
              <div className="space-y-3">
                <CodeStatusEditor codeStatus={s(resident.codeStatus)} dnrStatus={!!resident.dnrStatus} canEdit={canEditProfile} onSave={saveResident} />
                <EditableResidentCell label="Advance Directives" value={s(resident.advanceDirectives)} canEdit={canEditProfile} multiline onSave={saveResident} fields={[{ key: "advanceDirectives", current: s(resident.advanceDirectives), placeholder: "Advance directive / POLST / goals of care" }]} />
                <EditableResidentCell label="Living Will" value={s(resident.livingWill)} canEdit={canEditProfile} multiline onSave={saveResident} fields={[{ key: "livingWill", current: s(resident.livingWill), placeholder: "Living will details" }]} />
                <EditableResidentCell label="Healthcare Proxy" value={[s(resident.healthcareProxy), s(resident.healthcareProxyPhone)].filter(Boolean).join(" · ")} canEdit={canEditProfile} onSave={saveResident} fields={[{ key: "healthcareProxy", current: s(resident.healthcareProxy), placeholder: "Proxy name" }, { key: "healthcareProxyPhone", current: s(resident.healthcareProxyPhone), placeholder: "Proxy phone" }]} />
              </div>
            </Section>
            <DocumentSection residentId={id} documentType="ADVANCE_CARE" label="Documents" canEdit={canEditAbout} docs={docs} onChanged={refetchDocs} uploadedByName={sessionRole} />
            </>
          )}

          {tab === "preadmit" && (
            <Section title="Pre-Admission Assessment (v4.2)" icon={ClipboardList}>
              {assessV42 ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {assessV42.layer3?.finalLevel ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-bold bg-[#2E4A48] text-white">Final LOC · {s(assessV42.layer3.finalLevel)}</span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold border border-amber-200 bg-amber-50 text-amber-700">Final LOC pending</span>
                    )}
                    <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-bold border border-gray-200 bg-gray-50 text-gray-700">Raw {v42RawScore(assessV42)}/56</span>
                    <span className={`inline-flex items-center px-2.5 py-1 rounded text-[10px] font-bold uppercase border ${assessV42.status === "VALIDATED" ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-amber-100 text-amber-700 border-amber-200"}`}>{s(assessV42.status).replace(/_/g, " ") || "DRAFT"}</span>
                  </div>
                  <p className="text-xs text-gray-500">Assessed {fmtDate(assessV42.updatedAt || assessV42.createdAt)} · advisory raw score (banding not yet calibrated — GAP-001)</p>
                  {assessV42.domains && typeof assessV42.domains === "object" ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
                      {Object.entries(V42_DOMAIN_LABEL).map(([code, label]) => {
                        const dom = assessV42.domains?.[code] as { score?: number; evidence?: string; goalNote?: string } | undefined;
                        return (
                        <div key={code} className="rounded-lg border border-gray-200 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-gray-700">{label}</span>
                            <span className="text-sm font-bold text-[#2E4A48]">{s(dom?.score ?? 0)}<span className="text-gray-400 font-medium">/4</span></span>
                          </div>
                          {s(dom?.evidence) ? <p className="mt-1 text-[11px] leading-snug text-gray-500"><span className="font-semibold text-gray-600">Evidence: </span>{s(dom.evidence)}</p> : null}
                          {s(dom?.goalNote) ? <p className="mt-0.5 text-[11px] leading-snug text-gray-400"><span className="font-semibold">Goal: </span>{s(dom.goalNote)}</p> : null}
                        </div>
                        );
                      })}
                    </div>
                  ) : null}
                  {assessV42.layer3?.finalLevelJustification ? <p className="text-xs text-gray-500 whitespace-pre-wrap pt-1"><b className="text-gray-700">Justification:</b> {s(assessV42.layer3.finalLevelJustification)}</p> : null}
                  {assessV42.layer1?.reasonForAdmission ? <p className="text-xs text-gray-500 whitespace-pre-wrap"><b className="text-gray-700">Reason for admission:</b> {s(assessV42.layer1.reasonForAdmission)}</p> : null}
                  {assessV42.layer1?.goalsPreferences ? <p className="text-xs text-gray-500 whitespace-pre-wrap"><b className="text-gray-700">Goals / preferences:</b> {s(assessV42.layer1.goalsPreferences)}</p> : null}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No v4.2 pre-admission assessment recorded yet.</p>
              )}
            </Section>
          )}
          {tab === "acuity" && (
            <Section title="Care Acuity — Level of Care" icon={Gauge}>
              {acuityView ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-bold bg-[#2E4A48] text-white">Level {acuityView.levelN}{acuityView.levelName ? ` · ${acuityView.levelName}` : ""}</span>
                    <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-bold border border-gray-200 bg-gray-50 text-gray-700">Score {acuityView.score}/{acuityView.max}</span>
                    <span className={`inline-flex items-center px-2.5 py-1 rounded text-[10px] font-bold uppercase border ${acuityView.status === "APPROVED" || acuityView.status === "VALIDATED" || acuityView.status === "COMPLETED" ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-amber-100 text-amber-700 border-amber-200"}`}>{acuityView.status.replace(/_/g, " ") || "DRAFT"}</span>
                  </div>
                  <p className="text-xs text-gray-500">{[acuityView.trigger ? `Trigger: ${acuityView.trigger}` : "", `Assessed ${fmtDate(acuityView.assessedAt)}`].filter(Boolean).join(" · ")}</p>
                  {acuityView.domainList.length ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {acuityView.domainList.map((d, i) => (
                        <div key={i} className="rounded-lg border border-gray-200 p-2 flex items-center justify-between">
                          <span className="text-xs text-gray-600">{d.label}</span>
                          <span className="text-sm font-bold text-[#2E4A48]">{d.score}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {acuityView.notes ? <p className="text-xs text-gray-500 whitespace-pre-wrap pt-1"><b className="text-gray-700">Notes:</b> {acuityView.notes}</p> : null}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No acuity (Level of Care) assessment recorded yet.</p>
              )}
              <div className="mt-5 border-t border-gray-100 pt-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Level of Care History</p>
                {locTimeline.length === 0 ? (
                  <p className="text-sm text-gray-400">No level changes recorded yet.</p>
                ) : (
                  <ol className="relative space-y-3 border-l-2 border-gray-200 pl-4">
                    {locTimeline.map((e, i) => {
                      const prev = locTimeline[i + 1];
                      const prevN = prev ? Number(/([1-5])/.exec(prev.level)?.[1] || 0) : 0;
                      const curN = Number(/([1-5])/.exec(e.level)?.[1] || 0);
                      return (
                        <li key={e.id || i} className="relative">
                          <span className="absolute -left-[21px] top-1 h-3 w-3 rounded-full bg-[#2E4A48] ring-2 ring-white" />
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center rounded-lg bg-[#2E4A48] px-2.5 py-0.5 text-xs font-bold text-white">{e.level}</span>
                            {prev && prevN !== curN && <span className={`text-xs font-semibold ${curN > prevN ? "text-red-600" : "text-emerald-600"}`}>{curN > prevN ? "▲" : "▼"} from {prev.level}</span>}
                            <span className="inline-flex items-center rounded border border-gray-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">{LOC_SOURCE_LABEL[e.source] || e.source}</span>
                          </div>
                          <p className="mt-0.5 text-xs text-gray-500">{e.rawScore != null ? `Score ${e.rawScore} · ` : ""}{fmtDate(e.at)}{e.by ? ` · ${e.by}` : ""}</p>
                          {e.notes ? <p className="mt-0.5 text-xs text-gray-400 whitespace-pre-wrap">{e.notes}</p> : null}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </Section>
          )}
        </div>

        {/* Meds & Tasks tab — live care ops (moved out from below the tabs) */}
        {tab === "care" && (
        <div className="px-5 py-5 space-y-4">
          {/* Active medications */}
          <Section title={`Medications (${activeMeds.length})`} icon={Pill}>
            {activeMeds.length === 0 ? <p className="text-sm text-gray-400">No active medications.</p> : (
              <ul className="space-y-1.5">
                {activeMeds.map(m => (
                  <li key={s(m.id)} className="text-sm flex items-start gap-2">
                    <Pill className="w-3.5 h-3.5 text-blue-500 mt-0.5 shrink-0" />
                    <span><span className="font-semibold text-gray-900">{s(m.name)}</span> {s(m.dosage)} · {s(m.frequency)}{m.route ? ` · ${s(m.route)}` : ""}{s(m.status) === "PENDING" ? " (pending approval)" : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Recent requests */}
          <Section title="Recent Requests" icon={ConciergeBell}>
            {recentRequests.length === 0 ? <p className="text-sm text-gray-400">No recent requests.</p> : (
              <ul className="space-y-1.5">
                {recentRequests.map(r => (
                  <li key={s(r.id)} className="text-sm flex items-start justify-between gap-2">
                    <span className="min-w-0"><span className="font-medium text-gray-900">{s(r.category).replace(/_/g, " ")}{r.subType ? ` — ${s(r.subType)}` : ""}</span>{r.details ? <span className="text-gray-500">: {s(r.details)}</span> : ""}</span>
                    <span className="shrink-0 text-[11px] font-semibold text-gray-500">{s(r.status)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Assignments / tasks to do */}
          <Section title={`Assignments / To-do (${openTasks.length})`} icon={CalendarClock}>
            {openTasks.length === 0 ? <p className="text-sm text-gray-400">Nothing outstanding.</p> : (
              <ul className="space-y-1.5">
                {openTasks.map(t => {
                  const notes = taskNotesOf(t as Record<string, unknown>);
                  return (
                  <li key={s(t.id)} className="text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 text-gray-900">{s(t.title)}{t.description ? <span className="text-gray-500"> — {s(t.description)}</span> : ""}</span>
                      <span className="shrink-0 text-[11px] text-gray-500">{t.dueDate ? `Due ${fmtDate(t.dueDate)}` : ""}</span>
                    </div>
                    {notes.length > 0 && (
                      <ul className="mt-1 space-y-1">
                        {notes.map(n => (
                          <li key={n.id} className="flex items-start gap-1.5 rounded bg-amber-50 border border-amber-200 px-2 py-1">
                            <StickyNote className="w-3 h-3 text-amber-600 mt-0.5 flex-shrink-0" />
                            <span className="text-[11px] text-gray-700 leading-snug"><b className="text-gray-800">Note:</b> {n.text}<span className="text-gray-400"> — {n.author}</span></span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                  );
                })}
              </ul>
            )}
          </Section>
          <p className="text-[11px] text-gray-400 text-center">Generated {fmt(new Date().toISOString())} · confidential — for authorized care staff only.</p>
        </div>
        )}
        </main>
        </div>
      </div>
    </div>
  );
}

function Cell({ label, value, danger, accent }: { label: string; value: string; danger?: boolean; accent?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`text-sm mt-0.5 ${danger && value ? "text-red-600 font-semibold" : accent && value ? "text-[#2E4A48] font-semibold" : "text-gray-800"}`}>{value || "—"}</p>
    </div>
  );
}

// Primary Diagnosis: read-only list for viewers; add-many inline editor for
// Nurse / Care Manager / Super Admin. Persists via the About Me store (onSave).
function DiagnosisCell({ diagnoses, canEdit, onSave }: { diagnoses: string[]; canEdit: boolean; onSave: (next: string[]) => void | Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [list, setList] = useState<string[]>(diagnoses);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!editing) setList(diagnoses); }, [diagnoses, editing]);
  const add = () => { const v = draft.trim(); if (!v) return; setList((l) => [...l, v]); setDraft(""); };
  const save = async () => { setSaving(true); try { await onSave([...list, draft.trim()].map((d) => d.trim()).filter(Boolean)); setDraft(""); setEditing(false); } finally { setSaving(false); } };
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Primary Diagnosis</p>
        {canEdit && !editing && <button onClick={() => setEditing(true)} className="text-[10px] font-semibold text-[#2E4A48] hover:underline">{diagnoses.length ? "Edit" : "Add"}</button>}
      </div>
      {!editing ? (
        diagnoses.length
          ? <ul className="mt-0.5 space-y-0.5">{diagnoses.map((d, i) => <li key={i} className="text-sm font-semibold text-gray-800">{d}</li>)}</ul>
          : <p className="mt-0.5 text-sm text-gray-400">—</p>
      ) : (
        <div className="mt-1 space-y-1.5">
          {list.map((d, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="flex-1 text-sm text-gray-800">{d}</span>
              <button onClick={() => setList((l) => l.filter((_, idx) => idx !== i))} aria-label={`Remove ${d}`} className="text-gray-300 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder="Add diagnosis…" className="flex-1 min-w-0 rounded-md border border-gray-300 px-2 py-1 text-sm" />
            <button onClick={add} className="shrink-0 rounded-md bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-200">Add</button>
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            <button onClick={save} disabled={saving} className="rounded-md bg-[#2E4A48] px-2.5 py-1 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
            <button onClick={() => { setEditing(false); setList(diagnoses); setDraft(""); }} className="text-xs font-medium text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Inline editor for a resident-record field (or two, e.g. emergency name + phone).
// Saves straight to the residents model so all resident-record views auto-update.
function EditableResidentCell({ label, value, canEdit, danger, accent, multiline, onSave, fields }: {
  label: string; value: string; canEdit: boolean; danger?: boolean; accent?: boolean; multiline?: boolean;
  onSave: (patch: Record<string, string>) => Promise<void>;
  fields: { key: string; current: string; placeholder?: string }[];
}) {
  const [editing, setEditing] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, f.current])));
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!editing) setVals(Object.fromEntries(fields.map((f) => [f.key, f.current]))); }, [editing, fields]);
  const save = async () => { setSaving(true); try { await onSave(Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, v.trim()]))); setEditing(false); } catch { /* leave the editor open so the value isn't lost on a failed save */ } finally { setSaving(false); } };
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
        {canEdit && !editing && <button onClick={() => setEditing(true)} className="text-[10px] font-semibold text-[#2E4A48] hover:underline">Edit</button>}
      </div>
      {!editing ? (
        <p className={`text-sm mt-0.5 whitespace-pre-wrap ${danger && value ? "text-red-600 font-semibold" : accent && value ? "text-[#2E4A48] font-semibold" : "text-gray-800"}`}>{value || "—"}</p>
      ) : (
        <div className="mt-1 space-y-1.5">
          {fields.map((f) => (
            multiline
              ? <textarea key={f.key} rows={3} value={vals[f.key] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} placeholder={f.placeholder} className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm" />
              : <input key={f.key} value={vals[f.key] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} placeholder={f.placeholder} className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm" />
          ))}
          <div className="flex items-center gap-2 pt-0.5">
            <button onClick={save} disabled={saving} className="rounded-md bg-[#2E4A48] px-2.5 py-1 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
            <button onClick={() => setEditing(false)} className="text-xs font-medium text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Code status (select) + DNR (toggle) — writes to the resident record.
function CodeStatusEditor({ codeStatus, dnrStatus, canEdit, onSave }: { codeStatus: string; dnrStatus: boolean; canEdit: boolean; onSave: (patch: Record<string, string | boolean>) => Promise<void> }) {
  const OPTS = ["FULL_CODE", "DNR", "DNI", "COMFORT_CARE"];
  const [editing, setEditing] = useState(false);
  const [cs, setCs] = useState(codeStatus || "FULL_CODE");
  const [dnr, setDnr] = useState(dnrStatus);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!editing) { setCs(codeStatus || "FULL_CODE"); setDnr(dnrStatus); } }, [editing, codeStatus, dnrStatus]);
  const save = async () => { setSaving(true); try { await onSave({ codeStatus: cs, dnrStatus: dnr }); setEditing(false); } catch { /* keep open */ } finally { setSaving(false); } };
  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <select value={cs} onChange={(e) => setCs(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1 text-sm">{OPTS.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}</select>
        <label className="inline-flex items-center gap-1.5 text-sm text-gray-700"><input type="checkbox" checked={dnr} onChange={(e) => setDnr(e.target.checked)} /> DNR</label>
        <button onClick={save} disabled={saving} className="rounded-md bg-[#2E4A48] px-2.5 py-1 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
        <button onClick={() => setEditing(false)} className="text-xs font-medium text-gray-500 hover:text-gray-700">Cancel</button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold border border-gray-200 bg-gray-50 text-gray-700">Code status: {(codeStatus || "").replace(/_/g, " ") || "—"}</span>
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold border ${dnrStatus ? "bg-red-100 text-red-700 border-red-200" : "bg-emerald-100 text-emerald-700 border-emerald-200"}`}>{dnrStatus ? "DNR — Do Not Resuscitate" : "Full resuscitation"}</span>
      {canEdit && <button onClick={() => setEditing(true)} className="text-[10px] font-semibold text-[#2E4A48] hover:underline">Edit</button>}
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-sm text-gray-800 whitespace-pre-wrap mt-0.5">{value || "—"}</p>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Pill; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-gray-500 flex items-center gap-1.5 mb-1.5"><Icon className="w-4 h-4 text-[#2E4A48]" /> {title}</p>
      {children}
    </div>
  );
}
