// SLMS v4.2 Controlled Vocabulary — six SEPARATE canonical field enums.
// NEVER interchange them: workflow state, care-delivery outcome, exception reason,
// clinical finding and escalation state are stored in distinct fields (Controlled
// Vocabulary sheet mandate + Routine Assembly Rule 12). A clinical finding must
// never be saved as a completion status or exception reason.
// Source of truth: SLMS_v4.2_AS_Goals_Tasks_24-Hour_Routine (2).xlsx.

export const WORKFLOW_STATE = ["Upcoming", "Due", "Overdue", "Closed", "Cancelled"] as const;
export const CARE_OUTCOME = ["Completed as planned", "Completed with variance", "Not completed"] as const;
export const EXCEPTION_REASON = [
  "Resident declined", "Resident unavailable", "Unsafe to perform",
  "Clinical hold", "Missed", "Authorized cancellation",
] as const;
export const CLINICAL_FINDING = [
  "Change from baseline", "Increased assistance", "Poor intake",
  "Swallowing concern", "Frequency variance",
] as const;
export const ESCALATION_STATE = ["Not required", "Pending acknowledgement", "Acknowledged", "Resolved"] as const;
export const PRIORITY = ["P1", "P2", "P3", "P4"] as const;

export type WorkflowState = (typeof WORKFLOW_STATE)[number];
export type CareOutcome = (typeof CARE_OUTCOME)[number];
export type ExceptionReason = (typeof EXCEPTION_REASON)[number];
export type ClinicalFinding = (typeof CLINICAL_FINDING)[number];
export type EscalationState = (typeof ESCALATION_STATE)[number];
export type Priority = (typeof PRIORITY)[number];

/** Only "Completed as planned" / "Completed with variance" count as completed care. */
export function countsAsCompleted(o: CareOutcome): boolean {
  return o === "Completed as planned" || o === "Completed with variance";
}

/** Legacy flat outcome enum from careEvents.ts (conflates outcome+exception+finding). */
export type LegacyOutcome =
  | "Completed" | "Not Required" | "Refused" | "Unable" | "Unsafe"
  | "Increased Assist" | "Frequency Variance" | "Clinical Change"
  // Caregiver quick-exception reasons (two-button DONE/EXCEPTION execution).
  | "Resident Away" | "Condition Changed" | "Other";

/**
 * Bridge the legacy flat outcome onto the separated v4.2 fields, so #5 can migrate
 * existing CareEvent rows. Lossy by nature: the flat set collapsed distinctions the
 * v4.2 vocab separates.
 * `Unable`/`Unsafe` both map to the "Unsafe to perform" exception (the flat set had
 * no "unavailable" concept) — provisional, confirm against SOP.
 */
export function fromLegacyOutcome(o: LegacyOutcome): {
  outcome: CareOutcome;
  exception?: ExceptionReason;
  finding?: ClinicalFinding;
} {
  switch (o) {
    case "Completed":
    case "Not Required":
      return { outcome: "Completed as planned" };
    case "Refused":
      return { outcome: "Not completed", exception: "Resident declined" };
    case "Unable":
    case "Unsafe":
      return { outcome: "Not completed", exception: "Unsafe to perform" };
    case "Increased Assist":
      return { outcome: "Completed with variance", finding: "Increased assistance" };
    case "Frequency Variance":
      return { outcome: "Completed with variance", finding: "Frequency variance" };
    case "Clinical Change":
      return { outcome: "Completed with variance", finding: "Change from baseline" };
    case "Resident Away":
      return { outcome: "Not completed", exception: "Resident unavailable" };
    case "Condition Changed":
      // Care held pending a nurse review of the change. // ponytail: provisional per SOP.
      return { outcome: "Not completed", exception: "Clinical hold" };
    case "Other":
      // Catch-all — the real reason rides the note; "Missed" is the neutral store
      // value the strict occurrence vocab requires. // ponytail: provisional per SOP.
      return { outcome: "Not completed", exception: "Missed" };
  }
}
