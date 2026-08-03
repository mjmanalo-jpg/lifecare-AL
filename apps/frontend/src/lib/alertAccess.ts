// ─────────────────────────────────────────────────────────────
// Module 09 — Alert Management: role-based access + SLA windows.
// Shared by the server (route enforcement + cron SLA escalation) and the UI
// (Alert Center + notification bell) so the rules are identical in both places.
// ─────────────────────────────────────────────────────────────

export type AlertAction = "acknowledge" | "snooze" | "resolve";

// Administrator, Care Manager and Nurse get full control (acknowledge, snooze,
// resolve). Everyone else — Caregiver, Receptionist and other staff — may only
// ACKNOWLEDGE. Mirrors the Module 09 RBAC matrix.
//   Administrator  → PLATFORM_ADMIN / ORGANIZATION_ADMIN / SUPERADMIN
//   Care Manager   → FACILITY_ADMIN
//   Nurse          → NURSE  (PHYSICIAN included as senior clinical authority)
const FULL_CONTROL_ROLES = new Set([
  "PLATFORM_ADMIN",
  "ORGANIZATION_ADMIN",
  "SUPERADMIN",
  "FACILITY_ADMIN",
  "NURSE",
  "PHYSICIAN",
]);

/** Whether a role may perform an alert action. Acknowledge is open to all staff. */
export function canAlertAction(role: string | null | undefined, action: AlertAction): boolean {
  if (action === "acknowledge") return true;
  return FULL_CONTROL_ROLES.has(String(role ?? ""));
}

export function hasFullAlertControl(role: string | null | undefined): boolean {
  return FULL_CONTROL_ROLES.has(String(role ?? ""));
}

// SLA response window per severity, in minutes. An alert not acknowledged within
// its window is "breached" and (for CRITICAL) auto-escalated by the cron.
export const ALERT_SLA_MINUTES: Record<string, number> = {
  CRITICAL: 15,
  WARNING: 60,
  INFO: 480,
};

export function slaMinutes(severity: string | null | undefined): number {
  return ALERT_SLA_MINUTES[String(severity ?? "INFO").toUpperCase()] ?? ALERT_SLA_MINUTES.INFO;
}

/**
 * SLA state for an alert given its creation time and severity.
 * `remainingMs` is negative once breached. `dueAt` is the deadline.
 */
export function slaState(createdAt: string | Date, severity: string | null | undefined, nowMs = Date.now()) {
  const created = new Date(createdAt).getTime();
  const windowMs = slaMinutes(severity) * 60_000;
  const dueAt = created + windowMs;
  const remainingMs = dueAt - nowMs;
  return { dueAt, remainingMs, breached: remainingMs <= 0, windowMs };
}

/** The notification types that count as "automatic alerts" in the Alert Center. */
export const ALERT_NOTIFICATION_TYPES = new Set([
  "VITAL_ALERT",
  "MEDICATION_REMINDER",
  "INCIDENT_REPORT",
  "CALL_BELL",
  "SYSTEM_ALERT",
  "SBAR_ESCALATION",
]);
