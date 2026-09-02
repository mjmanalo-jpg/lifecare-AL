// ─────────────────────────────────────────────────────────────
// Resident PROFILE edit authorization (Module 01).
//
// The resident master profile — demographics, status, care level, allergies,
// diagnosis, physician, diet, advance-care preferences — may only be created or
// edited by a Care Manager or an Administrator (SUPERADMIN), plus platform admins.
//
// This is DISTINCT from clinical field updates (acuity level, next-assessment
// date, care package) which the wider care team (nurse, physician) writes back
// from assessments. Those fields are intentionally NOT listed below, so a
// clinical-only PATCH still goes through for other staff roles.
// ─────────────────────────────────────────────────────────────

export const RESIDENT_PROFILE_EDIT_ROLES = new Set(["CARE_MANAGER", "SUPERADMIN"]);

// Columns that make up the master profile. Writing ANY of these requires a
// profile-edit role. Anything not listed (currentAcuityLevel, nextAssessmentDue,
// lastAssessmentDate, currentCarePackageId, currentAcuityScoreId,
// careDependencyLevel, …) stays writable by the clinical care team.
export const RESIDENT_PROFILE_FIELDS = new Set([
  "firstName", "lastName", "dateOfBirth", "gender", "phone", "email", "roomNumber",
  "careLevel", "status", "admissionDate", "emergencyContact", "emergencyContactPhone",
  "medicalHistory", "allergies", "notes", "diagnosis", "primaryPhysician", "dietRestriction",
  "nationality", "religion", "maritalStatus", "language", "surgeries", "hospitalizations",
  "causeOfDeath", "deathDate", "isDeceased", "photoUrl", "advanceDirectives", "dnrStatus",
  "livingWill", "healthcareProxy", "healthcareProxyPhone", "codeStatus", "sponsorId",
]);

/** May this role create/edit a resident's master profile? */
export function canEditResidentProfile(role: string, isPlatform: boolean): boolean {
  return isPlatform || RESIDENT_PROFILE_EDIT_ROLES.has(role);
}

// Emergency / family contact — coordination data, not clinical. Move-in roles
// may edit ONLY these two profile fields (via the Move-in board) without holding
// full profile-edit rights.
export const RESIDENT_CONTACT_FIELDS = new Set(["emergencyContact", "emergencyContactPhone"]);
export const RESIDENT_CONTACT_EDIT_ROLES = new Set(["RESIDENT_COORDINATOR", "NURSE", "FACILITY_ADMIN"]);

/** True when a residents PATCH touches profile fields the role isn't allowed to edit. */
export function residentProfileEditDenied(role: string, isPlatform: boolean, keys: string[]): boolean {
  if (canEditResidentProfile(role, isPlatform)) return false;
  const touchedProfile = keys.filter((k) => RESIDENT_PROFILE_FIELDS.has(k));
  if (touchedProfile.length === 0) return false;
  // Move-in roles may edit the emergency/family contact alone — but nothing else.
  if (RESIDENT_CONTACT_EDIT_ROLES.has(role) && touchedProfile.every((k) => RESIDENT_CONTACT_FIELDS.has(k))) return false;
  return true;
}
