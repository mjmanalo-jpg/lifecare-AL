/**
 * Shared metadata for the SBAR clinical escalation workflow. SLA windows drive
 * the live breach clock (computed from createdAt against `nowTs`, so it's always
 * real-time — no stored timers). Kept in one place so the nurse/caregiver
 * raiser view, the physician responder view, and the facility-admin oversight
 * view stay in lockstep with the Prisma enums.
 */

import { formatDurationHm } from "@/lib/utils";

export const PRIORITY_META: Record<string, { label: string; slaMin: number; pill: string; dot: string }> = {
  EMERGENCY: { label: "Emergency", slaMin: 5, pill: "bg-red-100 text-red-700 border border-red-300", dot: "bg-red-500" },
  URGENT: { label: "Urgent", slaMin: 30, pill: "bg-orange-50 text-orange-700 border border-orange-200", dot: "bg-orange-500" },
  ROUTINE: { label: "Routine", slaMin: 240, pill: "bg-blue-50 text-blue-700 border border-blue-200", dot: "bg-blue-500" },
};

export const STATUS_PILL: Record<string, string> = {
  OPEN: "bg-amber-100 text-amber-700",
  ACKNOWLEDGED: "bg-blue-100 text-blue-700",
  IN_PROGRESS: "bg-indigo-100 text-indigo-700",
  RESOLVED: "bg-green-100 text-green-700",
  ESCALATED: "bg-red-100 text-red-700",
  CANCELLED: "bg-gray-100 text-gray-600",
};

export const STATUS_LABEL: Record<string, string> = {
  OPEN: "Awaiting Acknowledgement",
  ACKNOWLEDGED: "Acknowledged",
  IN_PROGRESS: "In Progress",
  RESOLVED: "Resolved",
  ESCALATED: "Escalated (On-Call)",
  CANCELLED: "Cancelled",
};

export const PRIORITIES = ["EMERGENCY", "URGENT", "ROUTINE"];

// Statuses that are still "live" (SLA clock running / needs action).
export const OPEN_STATUSES = new Set(["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "ESCALATED"]);

export interface SlaState {
  overdue: boolean;
  elapsedMin: number;
  remainingMin: number;
  label: string;
}

/** Live SLA state for an escalation, computed against a ticking `nowTs`. */
export function slaState(createdAt: string, priority: string, status: string, nowTs: number): SlaState {
  const slaMin = PRIORITY_META[priority]?.slaMin ?? 30;
  const start = createdAt ? new Date(createdAt).getTime() : nowTs;
  const elapsedMin = Math.max(0, Math.round((nowTs - start) / 60000));
  const remainingMin = slaMin - elapsedMin;
  // A resolved/cancelled item no longer breaches.
  const live = OPEN_STATUSES.has(status);
  const overdue = live && remainingMin < 0;
  const label = !live
    ? "—"
    : overdue
    ? `SLA breached +${formatDurationHm(Math.abs(remainingMin))}`
    : `${formatDurationHm(remainingMin)} to SLA`;
  return { overdue, elapsedMin, remainingMin, label };
}
