/**
 * Patient identity + intake body-check helpers (migration-free).
 *
 * - `patientCode` derives a stable, human-readable Patient ID from the
 *   resident's UUID, so every resident has a unique display number without a
 *   new database column. It is deterministic (same resident → same code).
 * - The intake body-check (identifying marks + pre-existing conditions captured
 *   at move-in) is persisted as a single ResidentNote with
 *   `category = INTAKE_CATEGORY`, its `content` holding the JSON below. This
 *   gives a permanent, showable record ("bakit may ganito si resident") with no
 *   schema change.
 */

/** ResidentNote.category that flags the intake body-map note. */
export const INTAKE_CATEGORY = "INTAKE_BODY_MAP";

/**
 * Stable, unique, readable Patient ID derived from the resident UUID.
 * e.g. patientCode("3a8f...","GHC") -> "GHC-K3F9A1"
 */
export function patientCode(id: string, communityCode?: string | null): string {
  const prefix =
    (communityCode || "RES").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "RES";
  const s = (id || "").replace(/-/g, "");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  const code = h.toString(36).toUpperCase().padStart(6, "0").slice(-6);
  return `${prefix}-${code}`;
}

export type FindingType =
  | "SCAR" | "TATTOO" | "BIRTHMARK" | "MOLE" | "WOUND"
  | "BRUISE" | "AMPUTATION" | "RASH" | "SWELLING" | "OTHER";

export type BodySide = "LEFT" | "RIGHT" | "CENTER" | "NA";

export type IntakeStatus = "PENDING" | "NO_MARKS" | "MARKS_DOCUMENTED";

export interface IntakeFinding {
  id: string;
  type: FindingType;
  bodyPart: string;
  side: BodySide;
  description: string;
  photoUrl?: string;
}

export interface IntakeData {
  status: IntakeStatus;
  findings: IntakeFinding[];
  examinedBy?: string;
  examinedAt?: string;   // ISO
  generalNotes?: string;
}

export const FINDING_TYPES: { value: FindingType; label: string }[] = [
  { value: "SCAR", label: "Scar" },
  { value: "TATTOO", label: "Tattoo" },
  { value: "BIRTHMARK", label: "Birthmark" },
  { value: "MOLE", label: "Mole" },
  { value: "WOUND", label: "Wound / Sore" },
  { value: "BRUISE", label: "Bruise" },
  { value: "SWELLING", label: "Swelling / Edema" },
  { value: "RASH", label: "Rash / Skin condition" },
  { value: "AMPUTATION", label: "Amputation / Missing limb" },
  { value: "OTHER", label: "Other" },
];

export const BODY_PARTS: string[] = [
  "Head / Scalp", "Face", "Neck", "Chest", "Abdomen", "Back", "Buttocks",
  "Left arm", "Right arm", "Left hand", "Right hand",
  "Left leg", "Right leg", "Left foot", "Right foot",
  "Hip / Groin", "Other",
];

export const BODY_SIDES: { value: BodySide; label: string }[] = [
  { value: "NA", label: "—" },
  { value: "LEFT", label: "Left" },
  { value: "RIGHT", label: "Right" },
  { value: "CENTER", label: "Center" },
];

export const INTAKE_STATUS_META: Record<IntakeStatus, { label: string; badge: string }> = {
  PENDING: { label: "Intake pending", badge: "bg-amber-100 text-amber-700 border border-amber-200" },
  NO_MARKS: { label: "No marks on admission", badge: "bg-green-100 text-green-700 border border-green-200" },
  MARKS_DOCUMENTED: { label: "Marks documented", badge: "bg-blue-100 text-blue-700 border border-blue-200" },
};

export const EMPTY_INTAKE: IntakeData = { status: "PENDING", findings: [] };

export function findingTypeLabel(t: string): string {
  return FINDING_TYPES.find((f) => f.value === t)?.label ?? t;
}

/** Parse a ResidentNote.content string into IntakeData, tolerating bad input. */
export function parseIntake(content: string | null | undefined): IntakeData {
  if (!content) return { ...EMPTY_INTAKE };
  try {
    const raw = JSON.parse(content) as Partial<IntakeData>;
    return {
      status: raw.status ?? "PENDING",
      findings: Array.isArray(raw.findings) ? raw.findings : [],
      examinedBy: raw.examinedBy,
      examinedAt: raw.examinedAt,
      generalNotes: raw.generalNotes,
    };
  } catch {
    return { ...EMPTY_INTAKE };
  }
}

/** Derive the persisted status from the findings (marks present ⇒ documented). */
export function resolveIntakeStatus(data: IntakeData): IntakeStatus {
  if (data.findings.length > 0) return "MARKS_DOCUMENTED";
  return data.status === "NO_MARKS" ? "NO_MARKS" : data.status;
}
