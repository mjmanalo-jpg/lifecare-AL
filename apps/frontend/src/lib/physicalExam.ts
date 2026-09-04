// Physical Exam (on-admission "Clinical Assessment" body check) — migration-free
// store in the `physical_exams` app-setting. Mirrors the paper CLINICAL
// ASSESSMENT form: 11 injury types documented against a body location, with an
// optional photo. Stored as an array (one current exam per resident) so the
// One Care · One Journey aggregator can read it like the other record sources.

export const PHYSICAL_EXAMS_KEY = "physical_exams";

// The 11 injury types from the paper form (index 0 = the "all clear" option).
export const INJURY_TYPES = [
  "None Apparent", "Abrasion", "Skin Tear", "Laceration", "Hematoma", "Swelling",
  "Burn", "Sprain", "Fracture", "Edema", "Bed Sore",
] as const;
export type InjuryType = (typeof INJURY_TYPES)[number];

export const BODY_PARTS = [
  "Head", "Face", "Neck", "Chest", "Abdomen", "Back", "Buttocks",
  "Left arm", "Right arm", "Left hand", "Right hand",
  "Left leg", "Right leg", "Left foot", "Right foot", "Other",
] as const;

export const BODY_SIDES = [
  { value: "NA", label: "—" },
  { value: "FRONT", label: "Front" },
  { value: "BACK", label: "Back" },
  { value: "LEFT", label: "Left" },
  { value: "RIGHT", label: "Right" },
] as const;
export type BodySide = (typeof BODY_SIDES)[number]["value"];
export const sideLabel = (v: string): string => BODY_SIDES.find((x) => x.value === v)?.label || "";

export interface PhysicalExamFinding {
  id: string;
  injury: InjuryType;
  bodyPart: string;
  side: BodySide;
  description: string;
  photoUrl?: string;
}

// DRAFT = not yet completed (hidden from the journey); NONE_APPARENT / FINDINGS
// are the two completed outcomes (examinedAt is stamped on completion).
export type PhysicalExamStatus = "DRAFT" | "NONE_APPARENT" | "FINDINGS";

export interface PhysicalExam {
  id: string;
  residentId: string;
  residentName?: string;
  room?: string;
  status: PhysicalExamStatus;
  findings: PhysicalExamFinding[];
  examinedBy?: string;
  examinedAt?: string;   // set once the exam is completed → surfaces in the journey
  generalNotes?: string;
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

export const newFinding = (): PhysicalExamFinding => ({
  id: (globalThis.crypto?.randomUUID?.() ?? `pf-${Date.now()}`),
  injury: "Abrasion", bodyPart: BODY_PARTS[0], side: "NA", description: "",
});

export const emptyExam = (residentId: string): PhysicalExam => ({
  id: (globalThis.crypto?.randomUUID?.() ?? `pe-${residentId}-${Date.now()}`),
  residentId, status: "DRAFT", findings: [],
});
