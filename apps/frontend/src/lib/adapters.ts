/**
 * Adapters: map raw Prisma/Supabase rows (from /api/db) into the display
 * shapes the portal views already consume, so existing UI stays intact.
 * Inputs are untyped JSON from the API; outputs are stable view models.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export function residentName(r: any): string {
  if (!r) return "Unknown";
  return `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || "Unnamed Resident";
}

export function ageFromDob(dob: string | Date | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}

/** Incident.severity enum -> UI tier used across Nurse/Family views. */
export function severityTier(sev: string | undefined): "critical" | "high" | "medium" | "low" {
  switch (sev) {
    case "CRITICAL": return "critical";
    case "SEVERE": return "high";
    case "MODERATE": return "medium";
    default: return "low";
  }
}

/** Task.priority enum -> UI tier used across Caregiver views. */
export function priorityTier(p: string | undefined): "critical" | "high" | "medium" | "low" {
  switch (p) {
    case "URGENT": return "critical";
    case "HIGH": return "high";
    case "MEDIUM": return "medium";
    default: return "low";
  }
}

export function humanize(value: string | undefined | null): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Resident row (optionally with `incidents` included) -> basic card model. */
export function adaptResident(r: any) {
  const openAlerts = Array.isArray(r.incidents)
    ? r.incidents.filter((i: any) => !i.resolvedAt).length
    : 0;
  return {
    id: r.id,
    name: residentName(r),
    room: r.roomNumber ?? "—",
    age: ageFromDob(r.dateOfBirth),
    careLevel: (r.careLevel ?? "ASSISTED") as "INDEPENDENT" | "ASSISTED" | "MEMORY" | "SKILLED",
    status: "ACTIVE" as const,
    alertsCount: openAlerts,
    allergies: r.allergies ?? "",
    medicalHistory: r.medicalHistory ?? "",
    notes: r.notes ?? "",
    raw: r,
  };
}

/** Incident row (with `resident` included) -> Nurse/Family incident model. */
export function adaptIncident(i: any) {
  return {
    id: i.id,
    type: humanize(i.incidentType) || "Incident",
    severity: severityTier(i.severity),
    resident: residentName(i.resident),
    room: i.resident?.roomNumber ?? "—",
    timestamp: i.incidentDate ?? i.createdAt,
    status: (i.resolvedAt ? "closed" : "open") as "open" | "in-progress" | "closed",
    description: i.description ?? "",
    notes: i.followUpNotes ?? i.immediateActions ?? "",
    resolved: Boolean(i.resolvedAt),
    raw: i,
  };
}

/** Task row (with `resident` included) -> Caregiver task model. */
export function adaptTask(t: any) {
  return {
    id: t.id,
    title: t.title,
    resident: residentName(t.resident),
    room: t.resident?.roomNumber ?? "—",
    dueTime: t.dueDate
      ? new Date(t.dueDate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "",
    priority: priorityTier(t.priority),
    category: humanize(t.status) || "Task",
    completed: t.status === "COMPLETED",
    notes: t.description ?? "",
    raw: t,
  };
}

/** Staff row (with `user` included) -> SuperAdmin registry model. */
export function adaptStaff(s: any) {
  return {
    id: s.id,
    name: s.user?.name ?? "Unknown",
    position: s.position ?? "—",
    department: s.department ?? "—",
    email: s.user?.email ?? "—",
    phone: s.user?.phone ?? "—",
    status: (s.isActive ? "Active" : "Inactive") as "Active" | "Inactive",
    startDate: s.hireDate ? new Date(s.hireDate).toISOString().slice(0, 10) : "—",
    raw: s,
  };
}
