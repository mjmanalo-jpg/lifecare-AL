import type { DashboardRole } from "./types";

export function permittedDashboardRole(sessionRole: string): DashboardRole | null {
  if (sessionRole === "NURSE") return "nurse";
  if (sessionRole === "CAREGIVER") return "caregiver";
  if (sessionRole === "CARE_MANAGER") return "care-manager";
  if (sessionRole === "FACILITY_ADMIN" || sessionRole === "SUPERADMIN") return "facility-admin";
  if (sessionRole === "RESIDENT_COORDINATOR") return "resident-coordinator";
  if (sessionRole === "PHYSICIAN") return "professional";
  return null;
}

export function canOpenDashboard(sessionRole: string, requested: DashboardRole): boolean {
  if (sessionRole === "SUPERADMIN") return true;
  return permittedDashboardRole(sessionRole) === requested;
}
