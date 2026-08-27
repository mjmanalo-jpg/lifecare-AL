/**
 * APPENDIX IV — Personal Health Assessment & Disclosure of Medical History
 * (form LEG-4HA-018). The pre-admission health disclosure filled out by the
 * resident / legal representative: prior-diagnosis checklist + 16 functional
 * and lifestyle questions.
 *
 * Migration-free: a JSON object in the app-setting `health_assessments`, keyed
 * by residentId — same shape as `about_me_profiles`. The rcard Medical &
 * Surgical Hx tab reads and edits it.
 */

export const HEALTH_ASSESSMENT_KEY = "health_assessments";

export interface HealthAssessment {
  // Header
  residentContact?: string;
  physicianName?: string;
  physicianContact?: string;

  // Previous diagnosis / current condition checklist (keys from CONDITION_OPTIONS)
  conditions?: string[];
  postStrokeWhen?: string;
  cancerSpecify?: string;
  skinSpecify?: string;

  // Prescribed medications (free text; a prescription copy may be attached)
  medications?: string;

  // 16 questions
  memoryLoss?: "" | "MILD" | "MODERATE" | "SEVERE";       // Q1
  lastHospitalized?: "" | "LT_1_YEAR" | "LT_2_YEARS";     // Q2
  hospitalizationReason?: string;                          // Q3
  majorSurgery?: "" | "YES" | "NO";                        // Q4
  surgeryType?: string;
  mobility?: "" | "INDEPENDENT" | "ASSISTED" | "IMMOBILE"; // Q5
  sleepingPattern?: string[];                              // Q6 (keys from SLEEP_OPTIONS)
  falling?: "" | "YES" | "NO";                             // Q7
  fallingWhen?: string;
  feedingMode?: "" | "ORAL" | "TUBE";                      // Q8
  smokes?: "" | "YES" | "NO";                              // Q9
  sticksPerDay?: string;
  drinksAlcohol?: "" | "YES" | "NO";                       // Q10
  alcoholFrequency?: string;
  physicianVisitFrequency?: string;                        // Q11
  bathroomIndependent?: string;                            // Q12
  onDiapers?: string;
  emotionalIssues?: string[];                              // Q13 (keys from EMOTION_OPTIONS)
  hobbies?: string[];                                      // Q14 (keys from HOBBY_OPTIONS)
  hobbiesOther?: string;
  foodDrugAllergies?: string;                              // Q15
  covidVaccination?: string;                               // Q16

  // Accomplished / concurred by (resident or legal representative)
  concurredBy?: string;
  concurredDate?: string; // YYYY-MM-DD

  updatedAt?: string;
  updatedBy?: string;
}

/** The whole app-setting value: { [residentId]: HealthAssessment }. */
export type HealthAssessmentStore = Record<string, HealthAssessment>;

export const emptyHealthAssessment = (): HealthAssessment => ({});

const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** Parse the app-setting value into a resident-keyed map, tolerating junk. */
export function parseHealthStore(raw: string | null | undefined): HealthAssessmentStore {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: HealthAssessmentStore = {};
    for (const [k, p] of Object.entries(v as Record<string, unknown>)) {
      const a = (p ?? {}) as Partial<HealthAssessment>;
      out[k] = {
        ...a,
        conditions: strArr(a.conditions),
        sleepingPattern: strArr(a.sleepingPattern),
        emotionalIssues: strArr(a.emotionalIssues),
        hobbies: strArr(a.hobbies),
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** The assessment for one resident (never null — empty if unset). */
export function healthFor(store: HealthAssessmentStore, residentId: string): HealthAssessment {
  return store[residentId] ?? emptyHealthAssessment();
}

/** True when the resident has any health-assessment data recorded. */
export function hasHealthAssessment(a: HealthAssessment | undefined): boolean {
  if (!a) return false;
  return Object.entries(a).some(([k, v]) => {
    if (k === "updatedAt" || k === "updatedBy") return false;
    return Array.isArray(v) ? v.length > 0 : !!String(v ?? "").trim();
  });
}
