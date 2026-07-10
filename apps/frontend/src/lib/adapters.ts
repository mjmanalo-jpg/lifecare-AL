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

/** Room row -> Room view model. */
export function adaptRoom(r: any) {
  return {
    id: r.id,
    roomNumber: r.roomNumber ?? "—",
    floor: r.floor ?? "—",
    wing: r.wing ?? "—",
    roomType: (r.roomType ?? "SEMI_PRIVATE") as "PRIVATE" | "SEMI_PRIVATE" | "WARD" | "SUITE",
    capacity: r.capacity ?? 1,
    status: (r.status ?? "AVAILABLE") as "AVAILABLE" | "OCCUPIED" | "MAINTENANCE" | "RESERVED",
    features: r.features ?? "",
    rateMonthly: r.rateMonthly,
    notes: r.notes ?? "",
    raw: r,
  };
}

/** Inventory item row -> Inventory view model. */
export function adaptInventoryItem(i: any) {
  return {
    id: i.id,
    itemName: i.itemName ?? "—",
    category: humanize(i.category) || "Other",
    quantity: i.quantity ?? 0,
    unit: i.unit ?? "pcs",
    minimumStock: i.minimumStock ?? 5,
    location: i.location ?? "—",
    supplier: i.supplier ?? "—",
    expiryDate: i.expiryDate ?? null,
    notes: i.notes ?? "",
    lowStock: (i.quantity ?? 0) <= (i.minimumStock ?? 5),
    raw: i,
  };
}

/** Invoice row (with `resident` included) -> Billing view model. */
export function adaptInvoice(inv: any) {
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber ?? "—",
    residentName: inv.resident ? residentName(inv.resident) : "—",
    room: inv.resident?.roomNumber ?? "—",
    totalAmount: inv.totalAmount ?? 0,
    amountPaid: inv.amountPaid ?? 0,
    balance: (inv.totalAmount ?? 0) - (inv.amountPaid ?? 0),
    dueDate: inv.dueDate ?? null,
    status: (inv.status ?? "DRAFT") as "DRAFT" | "SENT" | "PAID" | "OVERDUE" | "CANCELLED",
    description: inv.description ?? "",
    billingPeriodStart: inv.billingPeriodStart ?? null,
    billingPeriodEnd: inv.billingPeriodEnd ?? null,
    sentAt: inv.sentAt ?? null,
    paidAt: inv.paidAt ?? null,
    serviceCharges: Array.isArray(inv.serviceCharges) ? inv.serviceCharges.map(adaptServiceCharge) : [],
    payments: Array.isArray(inv.payments) ? inv.payments.map(adaptPayment) : [],
    raw: inv,
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
    active: (s.isActive ? "Active" : "Inactive") as "Active" | "Inactive",
    approved: (s.isApproved ? "Approved" : "Disapproved") as "Approved" | "Disapproved",
    avatarUrl: s.avatarUrl ?? null,
    experience: s.experience ?? "",
    documents: Array.isArray(s.documents) ? s.documents : [],
    startDate: s.hireDate ? new Date(s.hireDate).toISOString().slice(0, 10) : "—",
    raw: s,
  };
}

/** ServiceCharge row -> View model. */
export function adaptServiceCharge(sc: any) {
  return {
    id: sc.id,
    residentId: sc.residentId,
    residentName: sc.resident ? residentName(sc.resident) : "—",
    description: sc.description ?? "",
    amount: sc.amount ?? 0,
    serviceDate: sc.serviceDate ?? null,
    category: sc.category ?? "Care Services",
    invoiceId: sc.invoiceId ?? null,
    invoiceNumber: sc.invoice?.invoiceNumber ?? null,
    raw: sc,
  };
}

/** InsuranceValidation row -> View model. */
export function adaptInsuranceValidation(iv: any) {
  return {
    id: iv.id,
    residentId: iv.residentId,
    residentName: iv.resident ? residentName(iv.resident) : "—",
    provider: iv.provider ?? "",
    policyNumber: iv.policyNumber ?? "",
    groupNumber: iv.groupNumber ?? "",
    status: iv.status ?? "PENDING",
    verifiedAt: iv.verifiedAt ?? null,
    verifiedBy: iv.verifiedBy ?? null,
    coverageDetails: iv.coverageDetails ?? "",
    notes: iv.notes ?? "",
    raw: iv,
  };
}

/** Payment row -> View model. */
export function adaptPayment(p: any) {
  return {
    id: p.id,
    invoiceId: p.invoiceId,
    invoiceNumber: p.invoice?.invoiceNumber ?? "—",
    residentName: p.invoice?.resident ? residentName(p.invoice.resident) : "—",
    amount: p.amount ?? 0,
    paymentDate: p.paymentDate ?? null,
    paymentMethod: p.paymentMethod ?? "",
    transactionId: p.transactionId ?? "",
    notes: p.notes ?? "",
    raw: p,
  };
}
