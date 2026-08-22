import type { ClinicalState, DashboardPriority } from "./types";

const rank: Record<DashboardPriority, number> = { P1: 1, P2: 2, P3: 3, P4: 4 };

export function priorityForIncident(severity: string): DashboardPriority {
  if (severity === "CRITICAL") return "P1";
  if (severity === "SEVERE") return "P2";
  if (severity === "MODERATE") return "P3";
  return "P4";
}

export function priorityForEscalation(priority: string): DashboardPriority {
  if (priority === "EMERGENCY") return "P1";
  if (priority === "URGENT") return "P2";
  return "P3";
}

export function priorityForTask(priority: string, dueAt: Date, now: Date): DashboardPriority {
  const overdueMinutes = (now.getTime() - dueAt.getTime()) / 60_000;
  if (overdueMinutes > 0 && priority === "URGENT") return "P1";
  if (overdueMinutes > 0 || priority === "URGENT") return "P2";
  if (priority === "HIGH" || dueAt.getTime() <= now.getTime() + 2 * 60 * 60 * 1000) return "P3";
  return "P4";
}

export function stateForPriority(priority: DashboardPriority): ClinicalState {
  if (priority === "P1" || priority === "P2") return "ESCALATED";
  if (priority === "P3") return "WATCH";
  return "STABLE";
}

export function compareQueueItems(
  a: { priority: DashboardPriority; dueAt?: string; occurredAt?: string },
  b: { priority: DashboardPriority; dueAt?: string; occurredAt?: string },
) {
  const priorityDelta = rank[a.priority] - rank[b.priority];
  if (priorityDelta) return priorityDelta;
  const aTime = new Date(a.dueAt || a.occurredAt || 0).getTime();
  const bTime = new Date(b.dueAt || b.occurredAt || 0).getTime();
  return aTime - bTime;
}

