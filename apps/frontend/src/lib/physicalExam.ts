// Physical Exam — the on-admission "CLINICAL ASSESSMENT" body check, mirroring
// the paper form exactly: the 11 injury types (a fill-in beside each) plus the
// front / back / side body diagrams. Migration-free store in the `physical_exams`
// app-setting, one record per resident.

export const PHYSICAL_EXAMS_KEY = "physical_exams";

// The 11 injury types from the paper form, in the paper's order (1..11).
export const INJURY_TYPES = [
  "None Apparent", "Abrasion", "Skin Tear", "Laceration", "Hematoma", "Swelling",
  "Burn", "Sprain", "Fracture", "Edema", "Bed Sore",
] as const;
export type InjuryType = (typeof INJURY_TYPES)[number];

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
  examinedAt?: string;       // stamped when the exam is completed
  status: "DRAFT" | "COMPLETE";
  updatedAt?: string;
}

export const parsePhysicalExams = (raw: string | null | undefined): PhysicalExam[] => {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((e) => e && typeof e.id === "string") : []; }
  catch { return []; }
};

/** The resident's current exam (most recently updated), or null. */
export const examForResident = (all: PhysicalExam[], residentId: string): PhysicalExam | null =>
  all.filter((e) => e.residentId === residentId)
     .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))[0] ?? null;

export const emptyExam = (residentId: string): PhysicalExam => ({
  id: (globalThis.crypto?.randomUUID?.() ?? `pe-${residentId}-${Date.now()}`),
  residentId, injuries: {}, status: "DRAFT",
});

/** True once any injury line has a mark (or "None Apparent" is marked). */
export const hasAnyMark = (e: Pick<PhysicalExam, "injuries">): boolean =>
  Object.values(e.injuries || {}).some((v) => (v || "").trim() !== "");
