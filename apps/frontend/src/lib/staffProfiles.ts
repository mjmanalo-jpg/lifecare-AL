/**
 * Staff Profiles & Records — credibility + face-enrollment for nurses/caregivers.
 *
 * Migration-free: a JSON object in the app-setting `staff_profiles`, keyed by the
 * staff member's User id (so clock-in can look up their enrolled face photo in
 * O(1)). Holds their credentials (license, trainings, accreditations) and the
 * photo(s) used for facial verification at clock-in.
 */

export const STAFF_PROFILES_KEY = "staff_profiles";

export interface StaffCredential {
  id: string;
  name: string;          // e.g. "Basic Life Support (BLS)"
  issuer?: string;       // e.g. "Philippine Red Cross"
  date?: string;         // issued (YYYY-MM-DD)
  expiry?: string;       // expiry (YYYY-MM-DD), when applicable
}

export interface StaffProfile {
  userId: string;
  staffId?: string;
  name: string;
  role: string;                 // NURSE | CAREGIVER | …
  photo?: string;               // primary face-verification photo (downscaled dataURL)
  photos?: string[];            // extra reference angles (optional)
  licenseNo?: string;
  hireDate?: string;
  status?: "ACTIVE" | "INACTIVE";
  accredited?: boolean;         // vetted / cleared to take on duty
  trainings: StaffCredential[];
  accreditations: StaffCredential[];
  notes?: string;
  updatedAt: string;
  updatedBy?: string;
}

/** Parse the app-setting value into a { [userId]: StaffProfile } map. */
export function parseStaffProfiles(raw: string | null | undefined): Record<string, StaffProfile> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, StaffProfile> = {};
    for (const [k, p] of Object.entries(v as Record<string, unknown>)) {
      const prof = p as Partial<StaffProfile>;
      if (prof && typeof prof.userId === "string") {
        out[k] = {
          trainings: Array.isArray(prof.trainings) ? prof.trainings : [],
          accreditations: Array.isArray(prof.accreditations) ? prof.accreditations : [],
          ...prof,
        } as StaffProfile;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** True when a profile is complete enough to identity-verify at clock-in. */
export function hasFaceEnrollment(p: StaffProfile | undefined): boolean {
  return !!p?.photo && p.photo.length > 100;
}

export const emptyProfile = (userId: string, name: string, role: string, nowISO: string): StaffProfile => ({
  userId, name, role, status: "ACTIVE", accredited: false, trainings: [], accreditations: [], updatedAt: nowISO,
});
