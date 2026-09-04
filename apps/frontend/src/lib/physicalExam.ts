// Physical Exam — the on-admission "CLINICAL ASSESSMENT" body check, mirroring
// the paper form: the 11 injury types (a fill-in beside each) and the front /
// back / side body diagrams. Migration-free store in the `physical_exams`
// app-setting. A resident accumulates MANY exams over time (one per admission /
// re-check); each has a DRAFT → SUBMITTED lifecycle. A SUBMITTED exam is locked
// (read-only) and appears on the resident's One Care · One Journey, newest first.

export const PHYSICAL_EXAMS_KEY = "physical_exams";

// The 11 injury types from the paper form, in the paper's order (1..11).
export const INJURY_TYPES = [
  "None Apparent", "Abrasion", "Skin Tear", "Laceration", "Hematoma", "Swelling",
  "Burn", "Sprain", "Fracture", "Edema", "Bed Sore",
] as const;
export type InjuryType = (typeof INJURY_TYPES)[number];

export type PhysicalExamStatus = "DRAFT" | "SUBMITTED";

export interface PhysicalExam {
  id: string;
  residentId: string;
  residentName?: string;
  room?: string;
  // Per injury type: the fill-in next to that line on the paper form (a mark,
  // count, or affected area). Empty / absent = not present.
  injuries: Partial<Record<InjuryType, string>>;
  bodyNotes?: string;        // free-text observations keyed to the body diagram
  examinedBy?: string;
  status: PhysicalExamStatus;
  submittedAt?: string;      // stamped once submitted (locks the exam)
  createdAt?: string;
  updatedAt?: string;
}

export const parsePhysicalExams = (raw: string | null | undefined): PhysicalExam[] => {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((e) => e && typeof e.id === "string") : []; }
  catch { return []; }
};

const sortKey = (e: PhysicalExam) => e.submittedAt || e.updatedAt || e.createdAt || "";

/** All of a resident's exams, newest first. */
export const examsForResident = (all: PhysicalExam[], residentId: string): PhysicalExam[] =>
  all.filter((e) => e.residentId === residentId).sort((a, b) => sortKey(b).localeCompare(sortKey(a)));

/** The resident's most recent exam (draft or submitted), or null. */
export const latestExamFor = (all: PhysicalExam[], residentId: string): PhysicalExam | null =>
  examsForResident(all, residentId)[0] ?? null;

export const emptyExam = (residentId: string): PhysicalExam => ({
  id: (globalThis.crypto?.randomUUID?.() ?? `pe-${residentId}-${Date.now()}`),
  residentId, injuries: {}, status: "DRAFT",
});

/** True once any injury line has a mark. Gate for submitting. */
export const hasAnyMark = (e: Pick<PhysicalExam, "injuries">): boolean =>
  Object.values(e.injuries || {}).some((v) => (v || "").trim() !== "");
