"use client";

/**
 * Best-effort client helper to record a semantic audit line for staff actions
 * that persist outside /api/db (clock in/out, ADL, weight). Fire-and-forget —
 * a failure here must NEVER block the action the caregiver just completed.
 * The server (/api/audit) ignores any actor sent from the client and always
 * attributes the entry to the authenticated user.
 */

export type ClientAuditAction = "CREATE" | "UPDATE" | "DELETE" | "LOGIN" | "LOGOUT";

// Must stay in sync with ALLOWED_ENTITIES in src/app/api/audit/route.ts.
export type ClientAuditEntity =
  | "attendance" | "weight-logs" | "adl-logs"
  | "med-inventory" | "pharmacy-inventory" | "pharmacy-dispense"
  | "shift-endorsements" | "physician-communications"
  | "admissions" | "assessments"
  | "staff-profiles" | "caregiver-schedules";

export function recordAudit(entry: {
  action: ClientAuditAction;
  entityType: ClientAuditEntity;
  entityId: string;
  reason?: string;
  // When the action concerns a specific resident, pass these so the Audit Trail
  // can show a Resident column (stored in the audit `after` snapshot — there is
  // no residentId column on AuditLog).
  residentId?: string;
  residentName?: string;
}): void {
  try {
    void fetch("/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    }).catch(() => undefined);
  } catch {
    /* never block UX */
  }
}
