/**
 * "One Care · One Journey" — a per-resident journey compiler.
 *
 * Read-only aggregator: it takes the raw records a resident already has across the
 * whole system (assessments, LOC changes, care-plan reviews, acuity, medications,
 * incidents, wounds, referrals, clinical records, shift endorsements, weight,
 * private caregiver, documents, notes, admission) and normalises them into one
 * chronological `JourneyEvent[]`. Nothing is stored — the journey always reflects
 * whatever exists. Pure (no React), so it stays unit-testable and bundle-light.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
const s = (v: unknown) => (v == null ? "" : String(v));
/** First non-empty ISO-ish date from a list of candidate fields. */
const pickDate = (r: Row, ...keys: string[]): string => {
  for (const k of keys) { const v = r?.[k]; if (v != null && v !== "") return s(v); }
  return "";
};

export type JourneyCategory =
  | "ADMISSION" | "ASSESSMENT" | "LOC" | "CARE_PLAN" | "ACUITY" | "CARE_EVENT"
  | "MEDICATION" | "INCIDENT" | "WOUND" | "REFERRAL" | "CLINICAL_RECORD"
  | "ENDORSEMENT" | "WEIGHT" | "PRIVATE_CARE" | "DOCUMENT" | "NOTE";

export type JourneyAccent = "teal" | "green" | "amber" | "coral" | "ink";

export interface JourneyCategoryMeta {
  label: string;
  accent: JourneyAccent;
  /** Clinician-portal tab segment this category deep-links to (nurse/care-manager). */
  tab?: string;
}

export const JOURNEY_CATEGORY_META: Record<JourneyCategory, JourneyCategoryMeta> = {
  ADMISSION: { label: "Admission & Intake", accent: "teal", tab: "residents" },
  ASSESSMENT: { label: "Assessment", accent: "teal", tab: "careacuity" },
  LOC: { label: "Level of Care", accent: "teal", tab: "careacuity" },
  CARE_PLAN: { label: "Care Plan Review", accent: "green", tab: "careplans" },
  ACUITY: { label: "Care Acuity", accent: "teal", tab: "careacuity" },
  CARE_EVENT: { label: "Care Event", accent: "green", tab: "caredelivery" },
  MEDICATION: { label: "Medication", accent: "ink", tab: "mar" },
  INCIDENT: { label: "Incident", accent: "coral", tab: "incidents" },
  WOUND: { label: "Wound Care", accent: "coral", tab: "woundcare" },
  REFERRAL: { label: "Referral", accent: "amber", tab: "appointmentcalendar" },
  CLINICAL_RECORD: { label: "Clinical Record", accent: "teal", tab: "clinicalrecords" },
  ENDORSEMENT: { label: "Shift Endorsement", accent: "ink", tab: "shiftendorsements" },
  WEIGHT: { label: "Weight", accent: "green", tab: "weightmonitoring" },
  PRIVATE_CARE: { label: "Private Caregiver", accent: "teal", tab: "privatecare" },
  DOCUMENT: { label: "Document", accent: "ink", tab: "clinicalrecords" },
  NOTE: { label: "Note", accent: "ink" },
};

export const JOURNEY_CATEGORY_ORDER: JourneyCategory[] = [
  "ADMISSION", "ASSESSMENT", "LOC", "ACUITY", "CARE_PLAN", "CARE_EVENT", "MEDICATION",
  "INCIDENT", "WOUND", "REFERRAL", "CLINICAL_RECORD", "ENDORSEMENT",
  "WEIGHT", "PRIVATE_CARE", "DOCUMENT", "NOTE",
];

export interface JourneyEvent {
  id: string;              // unique across the journey (category-prefixed)
  residentId: string;
  category: JourneyCategory;
  title: string;
  summary?: string;
  status?: string;
  date: string;            // ISO — sort key
  by?: string;
  tab?: string;            // deep-link tab (from category meta)
  href?: string;           // external link (e.g. document / drive)
}

/** All raw record sources for one resident's journey (already parsed). */
export interface JourneySources {
  residentId: string;
  admittedAt?: string;             // resident.moveInDate / admissionDate / createdAt
  admissionSummary?: string;       // e.g. "Room 302 · Level 3"
  locHistory?: Row[];
  careEvents?: Row[];
  assessmentsV42?: Row[];
  carePlanReviews?: Row[];
  acuity?: Row[];
  woundRecords?: Row[];
  endorsements?: Row[];
  weightLogs?: Row[];
  clinicalRecords?: Record<string, Row[]> | null;
  privateCare?: Row[];
  medications?: Row[];
  incidents?: Row[];
  referrals?: Row[];
  documents?: Row[];
  notes?: Row[];
}

const meta = (c: JourneyCategory) => JOURNEY_CATEGORY_META[c];
const forRes = (rows: Row[] | undefined, rid: string) => (rows || []).filter((r) => s(r.residentId) === rid);
const titleCase = (v: string) => (v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : "");

/**
 * Compile a resident's full journey, newest first. Every source is filtered to
 * the resident and mapped to a normalised event; undated records are dropped so
 * the timeline never shows a floating "—".
 */
export function buildJourney(src: JourneySources): JourneyEvent[] {
  const rid = src.residentId;
  const out: JourneyEvent[] = [];
  const push = (e: Omit<JourneyEvent, "residentId" | "tab"> & { tab?: string }) => {
    if (!e.date) return;
    out.push({ ...e, residentId: rid, tab: e.tab ?? meta(e.category).tab });
  };

  // Admission / intake (synthesised from the resident record).
  if (src.admittedAt) {
    push({ id: `admission:${rid}`, category: "ADMISSION", title: "Admitted to community", summary: src.admissionSummary, date: src.admittedAt });
  }

  // Assessments (v4.2). The same instrument serves two boards (Pre-Admission and
  // Care Acuity); origin + reassessment lineage decide the label and deep-link.
  for (const a of (src.assessmentsV42 || [])) {
    if (s(a?.layer1?.residentId) !== rid) continue;
    const lvl = s(a?.layer3?.finalLevel);
    const isAcuity = s(a?.origin) === "ACUITY";
    const isReassess = !!s(a?.layer3?.priorAssessmentId);
    const kind = isReassess ? "Reassessment" : isAcuity ? "Care acuity assessment" : "Pre-admission assessment";
    push({
      id: `assessment:${s(a.id)}`, category: "ASSESSMENT",
      title: `${kind}${lvl ? ` — ${lvl}` : ""}`,
      summary: s(a?.layer1?.reasonForAdmission) || undefined,
      status: titleCase(s(a.status)), by: s(a.createdBy) || undefined,
      date: pickDate(a, "updatedAt", "createdAt"),
      tab: isAcuity ? "careacuity" : "prescreen",
    });
  }

  // Care events — governed task-completion outcomes (exceptions surface first).
  for (const c of forRes(src.careEvents, rid)) {
    const exception = !!c.isException;
    push({
      id: `careevent:${s(c.id)}`, category: "CARE_EVENT",
      title: `${s(c.eventName) || s(c.outcome) || "Care event"}${c.domain ? ` — ${s(c.domain)}` : ""}`,
      summary: [s(c.observation), s(c.exceptionDetail)].filter(Boolean).join(" · ") || undefined,
      status: exception ? `Exception · ${s(c.outcome)}` : s(c.outcome), by: s(c.actorName) || undefined,
      date: pickDate(c, "occurredAt", "createdAt"),
    });
  }

  // Level-of-Care history.
  for (const e of forRes(src.locHistory, rid)) {
    push({
      id: `loc:${s(e.id)}`, category: "LOC",
      title: `Level of care set to ${s(e.level)}`,
      summary: [e.previousLevel ? `from ${s(e.previousLevel)}` : "", s(e.notes)].filter(Boolean).join(" · ") || undefined,
      status: s(e.source), by: s(e.by) || undefined, date: pickDate(e, "at"),
    });
  }

  // Care-acuity approvals (legacy board).
  for (const a of forRes(src.acuity, rid)) {
    push({
      id: `acuity:${s(a.id)}`, category: "ACUITY",
      title: `Care acuity — Level ${s(a.level)}${a.levelName ? ` (${s(a.levelName)})` : ""}`,
      summary: a.total != null ? `Score ${s(a.total)}` : undefined,
      status: titleCase(s(a.status).replace(/_/g, " ")), by: s(a.createdBy) || undefined,
      date: pickDate(a, "decidedAt", "createdAt"),
    });
  }

  // Care-plan reviews.
  for (const r of forRes(src.carePlanReviews, rid)) {
    push({
      id: `careplan:${s(r.id)}`, category: "CARE_PLAN",
      title: `Care plan review${r.reviewPeriod ? ` — ${s(r.reviewPeriod)}` : ""}`,
      summary: [r.levelAtReview ? `Level ${s(r.levelAtReview)}` : "", s(r.carePlanStatus)].filter(Boolean).join(" · ") || undefined,
      status: s(r.decision), by: s(r.reviewedBy) || undefined, date: pickDate(r, "reviewDate"),
    });
  }

  // Medications (order started).
  for (const m of forRes(src.medications, rid)) {
    push({
      id: `med:${s(m.id)}`, category: "MEDICATION",
      title: `Medication — ${s(m.name)}`,
      summary: [s(m.dosage), s(m.frequency)].filter(Boolean).join(" · ") || undefined,
      status: titleCase(s(m.status)), by: s(m.prescribedBy) || undefined,
      date: pickDate(m, "startDate", "createdAt"),
    });
  }

  // Incidents.
  for (const i of forRes(src.incidents, rid)) {
    push({
      id: `incident:${s(i.id)}`, category: "INCIDENT",
      title: `Incident — ${s(i.incidentType || i.title) || "Reported"}`,
      summary: s(i.description) || s(i.title) || undefined,
      status: i.resolvedAt ? "Resolved" : (s(i.severity) ? titleCase(s(i.severity)) : "Open"),
      date: pickDate(i, "incidentDate", "createdAt"),
    });
  }

  // Wound records.
  for (const w of forRes(src.woundRecords, rid)) {
    push({
      id: `wound:${s(w.id)}`, category: "WOUND",
      title: `Wound — ${s(w.woundType) || "recorded"}${w.stage ? ` (${s(w.stage)})` : ""}`,
      summary: s(w.location) || undefined, status: titleCase(s(w.status)),
      date: pickDate(w, "discoveredAt", "createdAt"),
    });
  }

  // Hospital referrals.
  for (const r of forRes(src.referrals, rid)) {
    push({
      id: `referral:${s(r.id)}`, category: "REFERRAL",
      title: `Referral — ${s(r.specialist || r.facilityName) || "appointment"}`,
      summary: s(r.reason) || undefined, status: titleCase(s(r.status)),
      date: pickDate(r, "scheduledDate", "createdAt"),
    });
  }

  // Clinical records (labs / therapy / referrals / medications / orders / diagnoses).
  const cr = src.clinicalRecords || {};
  const CR_MAP: { key: string; label: string; date: string[]; title: string; status?: string }[] = [
    { key: "labs", label: "Lab result", date: ["dateCollected", "createdAt"], title: "testName", status: "status" },
    { key: "therapy", label: "Therapy", date: ["sessionDate", "createdAt"], title: "type", status: "therapist" },
    { key: "referrals", label: "Referral", date: ["referralDate", "createdAt"], title: "specialist", status: "reason" },
    { key: "medications", label: "Medication change", date: ["date", "createdAt"], title: "medName", status: "changeType" },
    { key: "orders", label: "Order", date: ["orderDate", "createdAt"], title: "orderType", status: "status" },
    { key: "diagnoses", label: "Diagnosis", date: ["date", "createdAt"], title: "diagnosis", status: "icdCode" },
  ];
  for (const cfg of CR_MAP) {
    for (const rec of forRes(cr[cfg.key], rid)) {
      push({
        id: `clinrec:${cfg.key}:${s(rec.id)}`, category: "CLINICAL_RECORD",
        title: `${cfg.label} — ${s(rec[cfg.title]) || "recorded"}`,
        summary: cfg.status ? (s(rec[cfg.status]) || undefined) : undefined,
        href: s(rec.driveLink) || undefined,
        date: pickDate(rec, ...cfg.date),
      });
    }
  }

  // Shift endorsements — residentId is nested in the endorsement's residents[].
  for (const e of (src.endorsements || [])) {
    const list = Array.isArray(e?.residents) ? e.residents : [];
    if (!list.some((x: Row) => s(x.residentId) === rid)) continue;
    push({
      id: `endorse:${s(e.id)}`, category: "ENDORSEMENT",
      title: `Shift endorsement${e.shiftLabel ? ` — ${s(e.shiftLabel)}` : ""}`,
      summary: s(e.generalNotes) || undefined, status: titleCase(s(e.status)),
      date: pickDate(e, "date", "createdAt"),
    });
  }

  // Weight logs.
  for (const w of forRes(src.weightLogs, rid)) {
    if (w.unable) continue;
    push({
      id: `weight:${s(w.id)}`, category: "WEIGHT",
      title: `Weight — ${s(w.weightKg)} kg`, status: titleCase(s(w.type)),
      date: pickDate(w, "date", "createdAt"),
    });
  }

  // Private caregiver assignments.
  for (const p of forRes(src.privateCare, rid)) {
    push({
      id: `pcg:${s(p.id)}`, category: "PRIVATE_CARE",
      title: `Private caregiver — ${s(p.caregiverName) || "assigned"}`,
      summary: s(p.schedule) || undefined, status: titleCase(s(p.status).replace(/_/g, " ")),
      by: s(p.requestedBy) || undefined, date: pickDate(p, "requestedAt", "startDate"),
    });
  }

  // Documents.
  for (const d of forRes(src.documents, rid)) {
    push({
      id: `doc:${s(d.id)}`, category: "DOCUMENT",
      title: `Document — ${s(d.title) || s(d.fileName) || "uploaded"}`,
      summary: s(d.documentType).replace(/_/g, " ") || undefined,
      href: s(d.fileUrl) || undefined, by: s(d.uploadedByName) || undefined,
      date: pickDate(d, "uploadedAt", "createdAt"),
    });
  }

  // Notes.
  for (const n of forRes(src.notes, rid)) {
    push({
      id: `note:${s(n.id)}`, category: "NOTE",
      title: `Note${n.category ? ` — ${s(n.category).replace(/-/g, " ")}` : ""}`,
      summary: s(n.content) || undefined, by: s(n.authorName) || undefined,
      date: pickDate(n, "createdAt"),
    });
  }

  return out.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}
