// Who may chart a routine occurrence.
//
// Care is charted by the role that DELIVERS it. Each routine event definition names
// that role (`responsibleRole`, shown as the "Assisted By" column: CGs / NOD / OTH), so
// the occurrence itself carries the answer:
//
//   • Caregiver-owned (CGs)  → the caregiver on shift charts it.
//   • Nurse-owned    (NOD)   → the nurse charts it. Medication, vitals, glucose,
//                              treatments and anything order-required default here
//                              (see assistance.ts defaultRole).
//   • Care Manager           → never charts. Clinical oversight reads the record and
//                              governs it; charting care they did not deliver would put
//                              a false signature on a clinical record.
//
// Client and server both call this, so the buttons a role sees and the writes the API
// accepts can never disagree.

/** True when the definition's responsible role is the nurse on duty (NOD). */
export function isNurseOwned(responsibleRole: string | null | undefined): boolean {
  return String(responsibleRole ?? "").trim().toLowerCase() === "nurse";
}

/**
 * May `role` chart an occurrence whose definition names `responsibleRole`?
 *
 * Note this is the ROLE question only — the caregiver's shift/time window is a separate
 * gate (isChartable), applied on top of this by both the board and the API.
 */
export function canChartOccurrence(
  role: string | null | undefined, responsibleRole: string | null | undefined,
): boolean {
  const r = String(role ?? "").toUpperCase();
  if (r === "NURSE") return isNurseOwned(responsibleRole);
  // Caregivers keep charting the care they deliver. Nurse-owned rows are deliberately
  // NOT blocked for them here: that is a separate policy question about who may sign
  // for a medication pass, not part of making the manager view read-only.
  if (r === "CAREGIVER") return true;
  // SUPERADMIN keeps write access for support/QA; CARE_MANAGER and every other
  // oversight role is read-only.
  return r === "SUPERADMIN";
}

/** "Assisted By" abbreviation to show where an action button would otherwise be. */
export function assistedByLabel(responsibleRole: string | null | undefined): string {
  const v = String(responsibleRole ?? "").trim().toLowerCase();
  if (v === "nurse") return "NOD";
  if (v === "other authorized") return "OTH";
  return "CGs";
}
