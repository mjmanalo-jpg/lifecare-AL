/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { EscalationStatus, TaskStatus, type Prisma } from "@prisma/client";
import {
  ASSESSMENTS_V42_KEY, assessmentValidationIssues, classifyAssessment, type AssessmentV42,
} from "@/lib/lifecare/assessment";
import {
  CAREGIVER_SCHEDULE_KEY, currentShiftKey, localDateStr, localMinutesOfDay, parseSchedules,
  shiftMeta, shiftWindow, type CaregiverSchedule,
} from "@/lib/caregiverSchedule";
import type { TenantContext } from "@/lib/tenant";
import { STAFF_CLOCK_KEY, onDutyFromClockLog, parseClockEvents } from "@/lib/staffClock";
import { resolveOnDuty, isCaregiver, isNurse } from "./presence";
import { countsAsCompleted, type CareOutcome } from "@/lib/lifecare/vocab";
import { isMissed, toMin } from "@/lib/lifecare/occurrenceStatus";
import { metric } from "./metrics";
import { compareQueueItems, priorityForEscalation, priorityForIncident, priorityForTask, stateForPriority } from "./priority";
import {
  CARE_MANAGER_DASHBOARD_SUBTITLE, CARE_MANAGER_DASHBOARD_TITLE,
  careManagerZone, type CareManagerDashboardZoneKey,
} from "./careManagerZones";
import {
  CAREGIVER_DASHBOARD_SUBTITLE, CAREGIVER_DASHBOARD_TITLE,
  caregiverDashboardArea, type CaregiverDashboardAreaKey,
} from "./caregiverZones";
import {
  NURSE_DASHBOARD_SUBTITLE, NURSE_DASHBOARD_TITLE,
  nurseDashboardZone, type NurseDashboardZoneKey,
} from "./nurseZones";
import {
  ADMIN_DASHBOARD_SUBTITLE, ADMIN_DASHBOARD_TITLE,
  adminZone,
} from "./administratorZones";
import {
  COORDINATOR_DASHBOARD_SUBTITLE, COORDINATOR_DASHBOARD_TITLE,
  coordinatorZone, type CoordinatorDashboardZoneKey,
} from "./coordinatorZones";
import type { ClinicalState, DashboardHuddle, DashboardMetric, DashboardPayload, DashboardPriority, DashboardQueueItem, DashboardRole, DashboardSection, DashboardSummary, DashboardWindowKey } from "./types";

const ENDORSEMENT_KEY = "shift_endorsements";
/** Task.generatedFrom prefix used by /api/routine/dispatch-care-task — a nurse
 *  explicitly sending an approved Care Task to today's caregivers. Distinguishes
 *  those from the auto-materialised care-plan duplicates, which are hidden. */
export const DISPATCHED_CARE_TASK_PREFIX = "caretask:";
const OPEN_ESCALATIONS: EscalationStatus[] = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "ESCALATED"];
/** §10 — aggregate KPI windows. Shift-first screens ignore the selector; care-manager/administrator honor it. */
const WINDOW_LABELS: Record<DashboardWindowKey, string> = {
  shift: "Current shift", "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days",
};
const WINDOW_DAYS: Record<Exclude<DashboardWindowKey, "shift">, number> = { "24h": 1, "7d": 7, "30d": 30 };
const TITLES: Record<DashboardRole, { title: string; subtitle: string }> = {
  nurse: { title: NURSE_DASHBOARD_TITLE, subtitle: NURSE_DASHBOARD_SUBTITLE },
  caregiver: { title: CAREGIVER_DASHBOARD_TITLE, subtitle: CAREGIVER_DASHBOARD_SUBTITLE },
  "care-manager": { title: CARE_MANAGER_DASHBOARD_TITLE, subtitle: CARE_MANAGER_DASHBOARD_SUBTITLE },
  "facility-admin": { title: ADMIN_DASHBOARD_TITLE, subtitle: ADMIN_DASHBOARD_SUBTITLE },
  "resident-coordinator": { title: COORDINATOR_DASHBOARD_TITLE, subtitle: COORDINATOR_DASHBOARD_SUBTITLE },
  professional: { title: "Professional Review", subtitle: "Discipline-appropriate resident review and follow-up from the governed care record." },
};

type Endorsement = {
  id: string; number?: string; date?: string; status?: "PENDING" | "SIGNED_OFF" | "ACKNOWLEDGED";
  carryOvers?: Array<{ id?: string; residentId?: string; concern?: string; priority?: string; role?: string; dueTime?: string; action?: string }>;
  createdAt?: string;
};

const parseJsonArray = <T>(raw?: string | null): T[] => {
  if (!raw) return [];
  try { const value = JSON.parse(raw); return Array.isArray(value) ? value : []; } catch { return []; }
};
const percentageLabel = (numerator: number, denominator: number) => denominator > 0
  ? Math.round((numerator / denominator) * 100) + "%"
  : "No prior denominator";
const residentLabel = (resident?: { firstName?: string | null; lastName?: string | null } | null) =>
  [resident?.firstName, resident?.lastName].filter(Boolean).join(" ") || "Resident";
const rolePath = (role: DashboardRole) => ({
  nurse: "nurse", caregiver: "caregiver", "care-manager": "care_manager",
  "facility-admin": "facility_admin", "resident-coordinator": "resident_coordinator", professional: "physician",
}[role]);
const moduleHref = (path: string, module: string) => {
  if (path === "caregiver" && module === "caredelivery") return "/caregiver/todayscare";
  if (path === "facility_admin") {
    const mapped: Record<string, string> = { taskassignment: "tasks", caredelivery: "tasks", caregiverschedule: "staff", shiftendorsements: "reports", callbells: "alertcenter", residentjourney: "residents" };
    return `/facility_admin/${mapped[module] || module}`;
  }
  if (path === "physician") {
    const mapped: Record<string, string> = { taskassignment: "reports", caredelivery: "reports", caregiverschedule: "reports", shiftendorsements: "reports", callbells: "incidents", residentjourney: "carehistory" };
    return `/physician/${mapped[module] || module}`;
  }
  return `/${path}/${module}`;
};

function shiftContext(now: Date, timeZone: string, assignment?: CaregiverSchedule) {
  const key = currentShiftKey(now);
  const date = localDateStr(now, timeZone);
  let startDate = date;
  if (key === "NOC" && now.getHours() < 6) {
    const previous = new Date(now); previous.setDate(previous.getDate() - 1);
    startDate = localDateStr(previous, timeZone);
  }
  const window = shiftWindow(startDate, key);
  const meta = shiftMeta(key);
  return {
    key, label: meta.label, range: meta.range,
    startsAt: window.start.toISOString(), endsAt: window.end.toISOString(),
    assignmentId: assignment?.id, assignmentAcknowledgedAt: assignment?.acknowledgedAt,
  } as const;
}

function section(key: string, title: string, description: string, items: DashboardQueueItem[], emptyTitle: string, emptyHint?: string): DashboardSection {
  // Dedupe by id: some sections merge overlapping pools (e.g. a task that is both
  // P2 and unassigned lands in clinicalTriage AND deploymentItems), which would
  // render two rows with the same React key. Keep the first occurrence.
  const seen = new Set<string>();
  const unique = items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
  return { key, title, description, items: unique.sort(compareQueueItems), emptyTitle, emptyHint };
}

type AssessmentSignal = {
  assessment: AssessmentV42;
  classification: ReturnType<typeof classifyAssessment> | null;
  issues: ReturnType<typeof assessmentValidationIssues>;
};

/** Classify + validate each saved v4.2 assessment once; shared by the Care Manager and Administrator dashboards. */
function buildAssessmentSignals(records: AssessmentV42[]): AssessmentSignal[] {
  return records.map((assessment) => {
    try {
      return {
        assessment,
        classification: classifyAssessment(assessment),
        issues: assessmentValidationIssues({ ...assessment, layer3: assessment.layer3 || {} }),
      };
    } catch {
      return { assessment, classification: null, issues: [] };
    }
  });
}

async function buildCoordinatorDashboard(
  now: Date,
  timeZone: string,
  tenant: { organizationId: string; communityId: string },
  userId: string,
): Promise<DashboardPayload> {
  const [transports, serviceRequests, communityEvents, admissions, residents, conciergeBookings, routedEscalations, notifications] = await Promise.all([
    prisma.transportRequest.findMany({
      where: { ...tenant, status: { notIn: ["COMPLETED", "CANCELLED", "DECLINED"] } },
      take: 300, orderBy: { requestedDate: "asc" },
      include: { resident: { select: { firstName: true, lastName: true, roomNumber: true } } },
    }),
    prisma.serviceRequest.findMany({
      where: { ...tenant, status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS"] } },
      take: 300, orderBy: { createdAt: "desc" },
      include: { resident: { select: { firstName: true, lastName: true, roomNumber: true } } },
    }),
    prisma.communityEvent.findMany({
      where: { ...tenant, published: true, startTime: { gte: now } },
      take: 100, orderBy: { startTime: "asc" },
    }),
    prisma.admission.findMany({
      where: { ...tenant, status: "IN_PROGRESS" },
      take: 100, orderBy: { updatedAt: "desc" },
    }),
    prisma.resident.findMany({
      where: { ...tenant, status: "ACTIVE" },
      take: 300,
      orderBy: [{ roomNumber: "asc" }, { lastName: "asc" }],
      select: {
        id: true, firstName: true, lastName: true, roomNumber: true, status: true,
        emergencyContact: true, emergencyContactPhone: true,
        sponsor: { select: { name: true, email: true, phone: true } },
        preferences: {
          take: 5,
          orderBy: { updatedAt: "desc" },
          select: { category: true, preference: true, value: true },
        },
      },
    }),
    prisma.conciergeBooking.findMany({
      where: {
        ...tenant,
        status: { notIn: ["COMPLETED", "CANCELLED"] },
        scheduledAt: { gte: now },
      },
      take: 100,
      orderBy: { scheduledAt: "asc" },
      include: { resident: { select: { firstName: true, lastName: true, roomNumber: true } } },
    }),
    // Alerts for Action — only items explicitly routed to coordination (non-clinical).
    prisma.escalation.findMany({
      where: { ...tenant, assignedToRole: "RESIDENT_COORDINATOR", status: { in: OPEN_ESCALATIONS } },
      take: 100, orderBy: { createdAt: "desc" },
      include: { resident: { select: { firstName: true, lastName: true, roomNumber: true } } },
    }),
    prisma.notification.findMany({
      where: { ...tenant, userId, isRead: false, OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: now } }] },
      take: 50, orderBy: { createdAt: "desc" },
    }),
  ]);

  const items: DashboardQueueItem[] = [
    ...transports.map((item) => ({
      id: "transport:" + item.id, kind: "Transport",
      priority: item.priority === "EMERGENCY" ? "P1" as const : item.priority === "HIGH" ? "P2" as const : "P3" as const,
      state: item.priority === "EMERGENCY" ? "ESCALATED" as const : "WATCH" as const,
      title: item.purpose || String(item.type).replaceAll("_", " "),
      residentId: item.residentId, residentLabel: residentLabel(item.resident), roomLabel: item.resident.roomNumber,
      dueAt: item.requestedDate.toISOString(), detail: item.destination,
      reason: "Transport is " + String(item.status).toLowerCase().replaceAll("_", " ") + ".",
      sourceType: "TransportRequest", sourceId: item.id, sourceHref: "/resident_coordinator/schedule",
    })),
    ...serviceRequests.map((item) => ({
      id: "service:" + item.id, kind: "Resident request",
      priority: item.priority === "EMERGENCY" ? "P1" as const : item.priority === "URGENT" ? "P2" as const : "P3" as const,
      state: item.priority === "EMERGENCY" ? "ESCALATED" as const : "WATCH" as const,
      title: item.subType || String(item.category).replaceAll("_", " "), detail: item.details || undefined,
      residentId: item.residentId, residentLabel: residentLabel(item.resident), roomLabel: item.resident.roomNumber,
      occurredAt: item.createdAt.toISOString(), ownerLabel: item.assignedTo || String(item.assignedTeam || "Unassigned").replaceAll("_", " "),
      reason: "Request is " + String(item.status).toLowerCase().replaceAll("_", " ") + ".",
      sourceType: "ServiceRequest", sourceId: item.id, sourceHref: "/resident_coordinator/coordination",
    })),
    ...admissions.map((item) => ({
      id: "admission:" + item.id, kind: "Admission / return", priority: "P3" as const, state: "WATCH" as const,
      title: [item.firstName, item.lastName].filter(Boolean).join(" "), detail: "Step " + item.currentStep + " of 8",
      occurredAt: item.updatedAt.toISOString(), reason: "Admission coordination remains in progress.",
      sourceType: "Admission", sourceId: item.id, sourceHref: "/resident_coordinator/coordination",
    })),
    ...communityEvents.map((item) => ({
      id: "event:" + item.id, kind: "Community activity", priority: "P4" as const, state: "STABLE" as const,
      title: item.title, detail: [item.location, item.host].filter(Boolean).join(" · ") || undefined,
      dueAt: item.startTime.toISOString(), reason: "Published resident activity is upcoming.",
      sourceType: "CommunityEvent", sourceId: item.id, sourceHref: "/resident_coordinator/schedule",
    })),
    ...conciergeBookings.map((item) => ({
      id: "booking:" + item.id, kind: "Resident appointment", priority: "P4" as const, state: "STABLE" as const,
      title: item.serviceName, detail: [item.location, item.staffName].filter(Boolean).join(" · ") || undefined,
      residentId: item.residentId, residentLabel: residentLabel(item.resident), roomLabel: item.resident.roomNumber,
      dueAt: item.scheduledAt.toISOString(), reason: "A non-clinical resident appointment is scheduled.",
      sourceType: "ConciergeBooking", sourceId: item.id, sourceHref: "/resident_coordinator/schedule",
    })),
  ];
  const startOfTomorrow = new Date(now);
  startOfTomorrow.setHours(24, 0, 0, 0);
  const residentItems: DashboardQueueItem[] = residents.map((resident) => {
    const preferences = resident.preferences
      .slice(0, 2)
      .map((item) => `${item.preference}: ${item.value}`)
      .join(" · ");
    return {
      id: "resident:" + resident.id,
      kind: "Resident snapshot",
      priority: "P4",
      state: "STABLE",
      title: `${resident.firstName} ${resident.lastName}`,
      residentId: resident.id,
      residentLabel: `${resident.firstName} ${resident.lastName}`,
      roomLabel: resident.roomNumber,
      detail: preferences || "No coordination preferences recorded.",
      reason: "Active resident · coordination summary only.",
      sourceType: "Resident",
      sourceId: resident.id,
      sourceHref: "/resident_coordinator/residents",
    };
  });
  const familyContactItems: DashboardQueueItem[] = residents.map((resident) => {
    const contactName = resident.emergencyContact || resident.sponsor?.name;
    const contactDetails = [
      resident.emergencyContactPhone || resident.sponsor?.phone,
      resident.sponsor?.email,
    ].filter(Boolean).join(" · ");
    const updatePreferences = resident.preferences
      .filter((item) => item.category.toLowerCase().includes("communication"))
      .map((item) => `${item.preference}: ${item.value}`)
      .join(" · ");
    return {
      id: "family-contact:" + resident.id,
      kind: "Family / representative contact",
      priority: contactName ? "P4" : "P3",
      state: contactName ? "STABLE" : "WATCH",
      title: `${resident.firstName} ${resident.lastName}`,
      residentId: resident.id,
      residentLabel: `${resident.firstName} ${resident.lastName}`,
      roomLabel: resident.roomNumber,
      ownerLabel: contactName || "No authorized contact recorded",
      detail: contactDetails || undefined,
      reason: updatePreferences || (contactName
        ? "No family update preference is recorded."
        : "Record an authorized representative before routine coordination updates."),
      sourceType: "ResidentContact",
      sourceId: resident.id,
      sourceHref: "/resident_coordinator/familycontacts",
    };
  });
  const endorsementItems = items
    .filter((item) => item.state !== "STABLE" || item.ownerLabel === "Unassigned")
    .map((item) => ({ ...item, id: "endorsement:" + item.id, kind: "Coordination carry-forward" }));
  const alertItems: DashboardQueueItem[] = [
    ...routedEscalations.map((item) => ({
      id: "alert-escalation:" + item.id, kind: "Routed alert",
      priority: item.priority === "EMERGENCY" ? "P1" as const : item.priority === "URGENT" ? "P2" as const : "P3" as const,
      state: "WATCH" as const,
      title: item.situation, detail: item.recommendation || undefined,
      residentId: item.residentId, residentLabel: residentLabel(item.resident), roomLabel: item.resident?.roomNumber || undefined,
      occurredAt: item.createdAt.toISOString(),
      reason: "Routed to coordination by the clinical team for a non-clinical action.",
      sourceType: "Escalation", sourceId: item.id, sourceHref: "/resident_coordinator/alerts",
    })),
    ...notifications.map((item) => ({
      id: "alert-notification:" + item.id, kind: "Notification",
      priority: item.severity === "CRITICAL" ? "P2" as const : "P3" as const, state: "WATCH" as const,
      title: item.title, detail: item.message || undefined,
      occurredAt: item.createdAt.toISOString(),
      reason: "Alert routed to your coordination queue.",
      sourceType: "Notification", sourceId: item.id, sourceHref: "/resident_coordinator/alerts",
    })),
  ];
  const scheduleItems = items.filter((item) => ["Community activity", "Resident appointment", "Transport"].includes(item.kind)
    || (item.dueAt && new Date(item.dueAt) < startOfTomorrow));
  const openCoordinationItems = items.filter((item) =>
    item.sourceType === "ServiceRequest" || item.sourceType === "TransportRequest" || item.ownerLabel === "Unassigned" || ["P1", "P2"].includes(item.priority));
  const zone = (key: CoordinatorDashboardZoneKey, sectionItems: DashboardQueueItem[]) => {
    const copy = coordinatorZone(key);
    return section(copy.key, copy.title, copy.description, sectionItems, copy.emptyTitle, copy.emptyHint);
  };
  const sections = [
    zone("resident-snapshot", residentItems),
    zone("today-schedule", scheduleItems),
    zone("admissions-returns", items.filter((item) => item.sourceType === "Admission")),
    zone("open-coordination", openCoordinationItems),
    zone("family-preferences", familyContactItems),
    zone("alerts-for-action", alertItems),
    zone("endorsement-notes", endorsementItems),
  ];
  const metrics = [
    metric({ key: "coordination_owned", label: "Requests with an owner", numerator: serviceRequests.filter((item) => item.assignedTo || item.assignedTeam).length, denominator: serviceRequests.length, numeratorLabel: "open requests with an owner", denominatorLabel: "open resident requests", definition: "Open resident service requests assigned to a team or named owner.", window: "Current open queue", baseline: "Baseline starts with the first saved queue snapshot", sourceModels: ["ServiceRequest"], href: "/resident_coordinator/coordination" }),
    metric({ key: "transport_ready", label: "Transport ready", numerator: transports.filter((item) => item.status !== "PENDING").length, denominator: transports.length, numeratorLabel: "transport requests beyond pending", denominatorLabel: "active transport requests", definition: "Active transport requests that have progressed beyond initial pending status.", window: "Upcoming active requests", baseline: "Baseline starts with the first saved queue snapshot", sourceModels: ["TransportRequest"], href: "/resident_coordinator/schedule" }),
    metric({ key: "admissions_in_progress", label: "Admissions in progress", numerator: admissions.length, denominator: admissions.length, numeratorLabel: "active admissions", denominatorLabel: "active admissions", definition: "Admissions currently moving through the governed eight-step onboarding workflow.", window: "Current", baseline: "Current open admission cohort", format: "COUNT", sourceModels: ["Admission"], href: "/resident_coordinator/coordination", state: admissions.length ? "WATCH" : "GOOD" }),
  ];
  const shift = shiftContext(now, timeZone);
  return {
    role: "resident-coordinator", ...TITLES["resident-coordinator"], asOf: now.toISOString(), freshnessSeconds: 30,
    serviceContext: "FACILITY", shift,
    summary: { activeResidents: residents.length, staffedNow: 0, residentsCovered: 0, residentsUncovered: 0, openEscalations: 0, overdueWork: items.filter((item) => item.dueAt && new Date(item.dueAt) < now).length, handoverStatus: "NOT_STARTED" },
    metrics, sections,
    warnings: ["Clinical decisions and clinical record access remain with the nurse and care-management roles."],
  };
}

function taskItem(task: any, now: Date, path: string, isNew = false): DashboardQueueItem {
  const dueAt = new Date(task.dueDate);
  const priority = priorityForTask(String(task.priority), dueAt, now);
  return {
    id: `task:${task.id}`, kind: "Care work", priority, state: stateForPriority(priority),
    title: task.title, detail: task.description || undefined, residentId: task.residentId,
    residentLabel: residentLabel(task.resident), roomLabel: task.resident?.roomNumber || undefined,
    ownerLabel: task.assignedTo?.user?.name || "Unassigned", dueAt: dueAt.toISOString(),
    reason: dueAt < now ? "Past its documented due time." : "Scheduled care due in this shift window.",
    // Care work opens Today's Approved Care — the routine board is where a resident's
    // day is charted now, for every role. It used to send clinicians to the Task
    // Assignment card, which is a dispatch screen, not somewhere care gets recorded.
    // `?resident=` focuses that resident so the nurse lands on their routine rather
    // than on a facility-wide list they then have to search.
    sourceType: "Task", sourceId: task.id,
    sourceHref: `${moduleHref(path, "todayscare")}${task.residentId ? `?resident=${encodeURIComponent(String(task.residentId))}` : ""}`,
    isNew,
  };
}

function incidentItem(incident: any, path: string, shiftStart: Date): DashboardQueueItem {
  const priority = priorityForIncident(String(incident.severity));
  return {
    id: `incident:${incident.id}`, kind: "Incident", priority, state: stateForPriority(priority),
    title: incident.title || String(incident.incidentType).replaceAll("_", " "), detail: incident.description,
    residentId: incident.residentId, residentLabel: residentLabel(incident.resident), roomLabel: incident.resident?.roomNumber || undefined,
    occurredAt: incident.incidentDate.toISOString(), reason: `${String(incident.severity).toLowerCase()} incident awaiting resolution`,
    sourceType: "Incident", sourceId: incident.id, sourceHref: moduleHref(path, "incidents"), isNew: incident.createdAt >= shiftStart,
  };
}

function escalationItem(escalation: any, path: string, shiftStart: Date, canAcknowledge: boolean): DashboardQueueItem {
  const priority = priorityForEscalation(String(escalation.priority));
  return {
    id: `escalation:${escalation.id}`, kind: "Clinical escalation", priority, state: stateForPriority(priority),
    title: escalation.situation, detail: escalation.recommendation || escalation.assessment || undefined,
    residentId: escalation.residentId, residentLabel: residentLabel(escalation.resident), roomLabel: escalation.resident?.roomNumber || undefined,
    ownerLabel: escalation.acknowledgedBy || escalation.assignedToRole, occurredAt: escalation.createdAt.toISOString(),
    reason: `${String(escalation.priority).toLowerCase()} escalation is ${String(escalation.status).toLowerCase().replaceAll("_", " ")}`,
    sourceType: "Escalation", sourceId: escalation.id, sourceHref: moduleHref(path, "escalations"), isNew: escalation.createdAt >= shiftStart,
    action: canAcknowledge && escalation.status === "OPEN" ? { type: "ACKNOWLEDGE_ESCALATION", label: "Acknowledge", entityId: escalation.id } : undefined,
  };
}

function bellItem(bell: any, path: string, shiftStart: Date): DashboardQueueItem {
  return {
    id: `bell:${bell.id}`, kind: "Call bell", priority: "P1", state: "ESCALATED",
    title: bell.reason || "Resident requested assistance", residentId: bell.residentId,
    residentLabel: residentLabel(bell.resident), roomLabel: bell.resident?.roomNumber || undefined,
    occurredAt: bell.createdAt.toISOString(), reason: "Active resident call requires an immediate response.",
    sourceType: "CallBell", sourceId: bell.id, sourceHref: moduleHref(path, "callbells"), isNew: bell.createdAt >= shiftStart,
  };
}

// §4 Care Delivery Status — governed care-event exception vocabulary from
// lib/lifecare/careEvents.ts. Surfaced as the queue item kind so the nurse can
// scan Refused / Unable / Unsafe / Increased Assist / Frequency Variance /
// Clinical Change without opening each record.
const GOVERNED_EXCEPTION_OUTCOMES = ["Refused", "Unable", "Unsafe", "Increased Assist", "Frequency Variance", "Clinical Change"];

function careEventItem(event: any, path: string, shiftStart: Date): DashboardQueueItem {
  const priority: DashboardPriority = event.immediateEscalation ? "P1" : event.reviewAlertRaised ? "P2" : "P3";
  const outcome = typeof event.outcome === "string" ? event.outcome : "";
  const isGovernedException = GOVERNED_EXCEPTION_OUTCOMES.includes(outcome);
  return {
    id: `care-event:${event.id}`, kind: isGovernedException ? outcome : "Care variance", priority, state: stateForPriority(priority),
    title: event.eventName || event.taskId || "Care event review", detail: event.exceptionDetail || event.observation || undefined,
    residentId: event.residentId, residentLabel: event.residentName || "Resident", occurredAt: event.occurredAt.toISOString(),
    reason: event.immediateEscalation ? "Immediate escalation required." : event.reviewAlertRaised ? "Nurse review was raised." : "Observed delivery varied from the approved plan.",
    sourceType: "CareEvent", sourceId: event.id, sourceHref: moduleHref(path, "caredelivery"), isNew: event.createdAt >= shiftStart,
  };
}

function watchItems(residents: any[], incidents: any[], escalations: any[], events: any[], path: string): DashboardQueueItem[] {
  return residents.flatMap((resident) => {
    const ri = incidents.filter((item) => item.residentId === resident.id);
    const re = escalations.filter((item) => item.residentId === resident.id);
    const rv = events.filter((item) => item.residentId === resident.id && (item.isVariance || item.reviewAlertRaised));
    const escalated = ri.some((item) => ["CRITICAL", "SEVERE"].includes(String(item.severity)))
      || re.some((item) => ["EMERGENCY", "URGENT"].includes(String(item.priority)));
    const state: ClinicalState = escalated ? "ESCALATED" : (ri.length || re.length || rv.length ? "WATCH" : "STABLE");
    if (state === "STABLE") return [];
    const reasons = [
      re.length ? `${re.length} open escalation${re.length === 1 ? "" : "s"}` : "",
      ri.length ? `${ri.length} open incident${ri.length === 1 ? "" : "s"}` : "",
      rv.length ? `${rv.length} care variance${rv.length === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    return [{
      id: `watch:${resident.id}`, kind: "Resident state", priority: state === "ESCALATED" ? "P2" as const : "P3" as const,
      state, title: residentLabel(resident), detail: reasons.join(" · "), residentId: resident.id,
      residentLabel: residentLabel(resident), roomLabel: resident.roomNumber, reason: reasons.join(", "),
      sourceType: "Resident", sourceId: resident.id, sourceHref: moduleHref(path, "residentjourney"),
    }];
  });
}

export async function buildDashboard(
  context: TenantContext,
  role: DashboardRole,
  opts: { window?: DashboardWindowKey } = {},
): Promise<DashboardPayload> {
  const now = new Date();
  const timeZone = process.env.FACILITY_TZ || "Asia/Manila";
  const today = localDateStr(now, timeZone);
  const currentShift = currentShiftKey(now);
  if (!context.organizationId || !context.communityId) throw new Error("Dashboard requires an active organization and community");
  const tenant = { organizationId: context.organizationId, communityId: context.communityId };
  if (role === "resident-coordinator") return buildCoordinatorDashboard(now, timeZone, tenant, context.userId);
  const residentScope = role === "caregiver" ? (context.caregiverResidentIds ?? []) : undefined;

  const settings = await prisma.appSetting.findMany({
    where: { ...tenant, key: { in: [CAREGIVER_SCHEDULE_KEY, ENDORSEMENT_KEY, ASSESSMENTS_V42_KEY, STAFF_CLOCK_KEY] } },
    select: { key: true, value: true, updatedAt: true },
  });
  const schedules = parseSchedules(settings.find((item) => item.key === CAREGIVER_SCHEDULE_KEY)?.value);
  const myAssignment = role === "caregiver"
    ? schedules.find((item) => item.date === today && item.shift === currentShift && item.caregiverUserId === context.userId)
    : undefined;
  const shift = shiftContext(now, timeZone, myAssignment);
  const shiftStart = new Date(shift.startsAt);
  const shiftEnd = new Date(shift.endsAt);
  const shiftSchedules = schedules.filter((item) => item.date === today && item.shift === currentShift);
  const previousShiftStart = new Date(shiftStart.getTime() - (shiftEnd.getTime() - shiftStart.getTime()));
  const path = rolePath(role);
  const windowKey: DashboardWindowKey =
    opts.window && opts.window in WINDOW_DAYS ? opts.window : "shift";
  const periodStart =
    windowKey === "shift" ? shiftStart : new Date(now.getTime() - WINDOW_DAYS[windowKey] * 86400_000);

  const staffRecord = role === "caregiver"
    ? await prisma.staff.findFirst({ where: { ...tenant, userId: context.userId }, select: { id: true } })
    : null;
  const residentWhere = { ...tenant, status: "ACTIVE" as const, ...(residentScope ? { id: { in: residentScope } } : {}) };
  const taskWhere: Prisma.TaskWhereInput = {
    ...tenant,
    ...(residentScope ? { residentId: { in: residentScope }, assignedToId: staffRecord?.id || "__none__" } : {}),
    AND: [
      {
        OR: [
          { status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] } },
          { dueDate: { gte: previousShiftStart, lt: shiftEnd } },
        ],
      },
      // Care-plan-derived Tasks are EXCLUDED. The routine engine (RoutineOccurrence,
      // charted in Today's Approved Care) is the system of record for planned care, and
      // cron/care-plan-tasks writes a second Task copy of the same work — which is what
      // flooded this queue with hundreds of duplicated, permanently-overdue rows.
      // Filtered in the query, not after, so the duplicates don't consume the `take`
      // budget and crowd out real manual tasks.
      //
      // Kept visible: manually assigned tasks (generatedFrom null) and nurse-dispatched
      // Care Tasks (`caretask:<residentId>`) — both are deliberate acts, not duplicates.
      { OR: [{ generatedFrom: null }, { generatedFrom: { startsWith: DISPATCHED_CARE_TASK_PREFIX } }] },
      // Assigned work only. An unassigned card is a staffing/dispatch matter, not a
      // clinical action a nurse can take from this queue — those belong in the Task
      // Assignment pool where a manager claims or hands them off. Kept in the AND
      // array so it composes with (never overwrites) the caregiver's own
      // assignedToId scope applied above.
      { assignedToId: { not: null } },
    ],
  };

  // Shift-scoped governed occurrences (care actually charted through the routine
  // engine) + the staff roster that bridges clock-log userIds to Staff ids.
  const occurrenceFrom = new Date(previousShiftStart.getTime() - 86400_000);
  const [residents, tasks, incidents, bells, events, escalations, attendance, carePlans, physicianCommunications, activeAdmissions, staffRoster, shiftOccurrences, routineDefCounts] = await Promise.all([
    prisma.resident.findMany({ where: residentWhere, orderBy: { roomNumber: "asc" }, select: { id: true, firstName: true, lastName: true, roomNumber: true, careLevel: true, allergies: true, dietRestriction: true, careDependencyLevel: true, codeStatus: true, notes: true, photoUrl: true, updatedAt: true } }),
    prisma.task.findMany({ where: taskWhere, take: 1000, orderBy: { dueDate: "asc" }, include: { resident: { select: { firstName: true, lastName: true, roomNumber: true } }, assignedTo: { include: { user: { select: { name: true } } } } } }),
    prisma.incident.findMany({ where: { ...tenant, ...(residentScope ? { residentId: { in: residentScope } } : {}), resolvedAt: null }, take: 500, orderBy: { incidentDate: "desc" }, include: { resident: { select: { firstName: true, lastName: true, roomNumber: true } } } }),
    prisma.callBell.findMany({ where: { ...tenant, ...(residentScope ? { residentId: { in: residentScope } } : {}), status: { in: ["PENDING", "RESPONDED"] } }, take: 300, orderBy: { createdAt: "desc" }, include: { resident: { select: { firstName: true, lastName: true, roomNumber: true } } } }),
    prisma.careEvent.findMany({ where: { ...tenant, ...(residentScope ? { residentId: { in: residentScope } } : {}), occurredAt: { gte: new Date(now.getTime() - 7 * 86400_000) } }, take: 2000, orderBy: { occurredAt: "desc" } }),
    prisma.escalation.findMany({ where: { ...tenant, ...(residentScope ? { residentId: { in: residentScope } } : {}), status: { in: OPEN_ESCALATIONS } }, take: 500, orderBy: { createdAt: "desc" }, include: { resident: { select: { firstName: true, lastName: true, roomNumber: true } } } }),
    prisma.timeTracking.findMany({
      where: { staff: tenant, startTime: { lt: shiftEnd }, OR: [{ endTime: null }, { endTime: { gte: shiftStart } }] },
      take: 500,
      select: { staffId: true, status: true, endTime: true, staff: { select: { position: true, user: { select: { name: true, role: true } } } } },
    }),
    prisma.carePlan.findMany({ where: { ...tenant, ...(residentScope ? { residentId: { in: residentScope } } : {}), status: { in: ["ACTIVE", "DRAFT", "UNDER_REVIEW"] } }, take: 500, orderBy: { updatedAt: "desc" }, include: { resident: { select: { firstName: true, lastName: true, roomNumber: true } } } }),
    prisma.physicianCommunication.findMany({
      where: {
        ...tenant,
        ...(residentScope ? { residentId: { in: residentScope } } : {}),
        followUpRequired: true,
        followUpCompletedAt: null,
      },
      take: 500,
      orderBy: [{ followUpDeadline: "asc" }, { occurredAt: "desc" }],
      include: { resident: { select: { firstName: true, lastName: true, roomNumber: true } } },
    }),
    role === "nurse" || role === "facility-admin"
      ? prisma.admission.findMany({
          where: { ...tenant, status: "IN_PROGRESS" },
          take: 200,
          orderBy: { updatedAt: "desc" },
          select: { id: true, firstName: true, lastName: true, currentStep: true, updatedAt: true },
        })
      : Promise.resolve([]),
    prisma.staff.findMany({
      where: tenant,
      take: 500,
      select: { id: true, userId: true, position: true, user: { select: { name: true, role: true } } },
    }),
    prisma.routineOccurrence.findMany({
      where: {
        communityId: tenant.communityId,
        careDate: { gte: occurrenceFrom },
        ...(residentScope ? { residentId: { in: residentScope } } : {}),
      },
      take: 5000,
      select: { residentId: true, careDate: true, scheduledTime: true, workflowState: true, careDeliveryOutcome: true, completionUserId: true, completionAt: true },
    }),
    // Routine coverage. Occurrences only materialise from APPROVED definitions, so a
    // resident on an active care plan with none has NO planned care in the routine
    // engine at all. Grouped rather than fetched so this stays one cheap aggregate.
    prisma.routineEventDefinition.groupBy({
      by: ["residentId", "status"],
      where: { communityId: tenant.communityId, ...(residentScope ? { residentId: { in: residentScope } } : {}) },
      _count: { _all: true },
    }),
  ]);

  const endorsements = parseJsonArray<Endorsement>(settings.find((item) => item.key === ENDORSEMENT_KEY)?.value)
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  const latestHandover = endorsements.find((item) => item.date === today) || endorsements[0];
  const coveredIds = new Set(shiftSchedules.flatMap((item) => item.residentIds));
  const openTasks = tasks.filter((item) => !["COMPLETED", "CANCELLED"].includes(String(item.status)));
  const overdueTasks = openTasks.filter((item) => item.dueDate < now);
  const dueShift = tasks.filter((item) => item.status !== "CANCELLED" && item.dueDate >= shiftStart && item.dueDate < shiftEnd);
  const completedShift = dueShift.filter((item) => item.status === "COMPLETED");
  const previousDue = tasks.filter((item) => item.status !== "CANCELLED" && item.dueDate >= previousShiftStart && item.dueDate < shiftStart);
  const previousCompleted = previousDue.filter((item) => item.status === "COMPLETED");
  // ── Governed care delivery ─────────────────────────────────────────────────
  // Care reaches the record by two paths: Task completion (CaregiverTasks) and
  // RoutineOccurrence closes (Today's Care, the v4.2 routine engine). Counting Tasks
  // alone reported "Care delivered this shift 0%" for any facility running its care
  // off the routine, which is the governed path. Count both.
  //
  // An occurrence belongs to a shift by its scheduled INSTANT (care day + HH:MM), and
  // counts toward the denominator only once owed — window passed, or already closed.
  // A task later this shift is not yet a failure.
  // careDate is stored as the care day's FACILITY midnight (an instant), so its UTC
  // date prefix is the previous day — always resolve the day in the facility zone
  // (localDateStr), then rebuild the scheduled instant the same way shiftWindow does
  // (date parts + wall-clock hour). Using raw local getters on careDate would land a
  // day early on a UTC server.
  const nowMinutes = localMinutesOfDay(now, timeZone);
  const occurrenceSlot = (careDay: string, scheduledTime: string) => {
    const [y, mo, d] = careDay.split("-").map(Number);
    const mins = toMin(scheduledTime);
    return new Date(y, (mo || 1) - 1, d || 1, Math.floor(mins / 60), mins % 60, 0, 0).getTime();
  };
  const occurrenceDelivery = (from: Date, to: Date) => {
    let due = 0, completed = 0;
    for (const o of shiftOccurrences) {
      if (o.workflowState === "Cancelled") continue;
      const careDay = localDateStr(o.careDate, timeZone);
      const slot = occurrenceSlot(careDay, o.scheduledTime);
      if (slot < from.getTime() || slot >= to.getTime()) continue;
      // Owed only: window passed (or already charted). Day comparison is a plain
      // string compare of facility calendar days — no clock arithmetic to drift.
      const dayCmp = careDay === today ? 0 : careDay < today ? -1 : 1;
      const owed = isMissed(o, nowMinutes, dayCmp) || o.workflowState === "Closed";
      if (!owed) continue;
      due += 1;
      if (o.careDeliveryOutcome && countsAsCompleted(o.careDeliveryOutcome as CareOutcome)) completed += 1;
    }
    return { due, completed };
  };
  const shiftOccDelivery = occurrenceDelivery(shiftStart, shiftEnd);
  const previousOccDelivery = occurrenceDelivery(previousShiftStart, shiftStart);
  const shiftEvents = events.filter((item) => item.occurredAt >= shiftStart && item.occurredAt < shiftEnd);
  // Who has actually charted something this shift. With clock-in optional, this is
  // the real signal that a rostered caregiver has started work — far more useful
  // than an attendance flag nobody is required to set.
  const chartedThisShift = new Set<string>();
  for (const item of shiftEvents) if (item.actorId) chartedThisShift.add(item.actorId);
  for (const o of shiftOccurrences) {
    if (!o.completionUserId || !o.completionAt) continue;
    if (o.completionAt >= shiftStart && o.completionAt < shiftEnd) chartedThisShift.add(o.completionUserId);
  }
  const varianceEvents = shiftEvents.filter((item) => item.isVariance || item.isException);
  const previousEvents = events.filter((item) => item.occurredAt >= previousShiftStart && item.occurredAt < shiftStart);
  const previousVariances = previousEvents.filter((item) => item.isVariance || item.isException);
  const previousMoment = new Date(shiftStart.getTime() - 1);
  const previousSchedules = schedules.filter((item) => item.date === localDateStr(previousMoment, timeZone) && item.shift === currentShiftKey(previousMoment));
  const previousCovered = new Set(previousSchedules.flatMap((item) => item.residentIds));
  const assessmentRecords = parseJsonArray<AssessmentV42>(settings.find((item) => item.key === ASSESSMENTS_V42_KEY)?.value);
  // Governed v4.2 assessment signals (LOC, DT-013/014, hospitalization, acuity).
  // Computed once so both the nurse watchlist and Care Manager governance reuse them.
  const assessmentSignals = buildAssessmentSignals(assessmentRecords);
  const planReviews = carePlans.filter((item) => item.status !== "ACTIVE" || (item.nextReviewDate && item.nextReviewDate <= new Date(now.getTime() + 7 * 86400_000)));

  // ── Routine coverage gaps ──────────────────────────────────────────────────
  // A resident on an ACTIVE care plan whose routine is not APPROVED has no planned
  // care in the routine engine — nothing materialises into Today's Approved Care.
  // Two distinct fixes, so they are reported distinctly: never generated (generate
  // the routine) vs generated but unapproved (approve it).
  const approvedDefs = new Map<string, number>();
  const totalDefs = new Map<string, number>();
  for (const row of routineDefCounts) {
    const n = row._count._all;
    totalDefs.set(row.residentId, (totalDefs.get(row.residentId) || 0) + n);
    if (row.status === "APPROVED") approvedDefs.set(row.residentId, (approvedDefs.get(row.residentId) || 0) + n);
  }
  const activePlanResidentIds = new Set(carePlans.filter((p) => p.status === "ACTIVE").map((p) => p.residentId));
  const routineGaps: DashboardQueueItem[] = residents
    .filter((resident) => activePlanResidentIds.has(resident.id) && !(approvedDefs.get(resident.id) ?? 0))
    .map((resident) => {
      const drafted = totalDefs.get(resident.id) ?? 0;
      return {
        id: `routine-gap:${resident.id}`,
        kind: "Routine coverage gap",
        priority: "P2" as DashboardPriority,
        state: "WATCH" as ClinicalState,
        title: residentLabel(resident),
        residentId: resident.id,
        residentLabel: residentLabel(resident),
        roomLabel: resident.roomNumber || undefined,
        detail: drafted
          ? `${drafted} routine event${drafted === 1 ? "" : "s"} drafted · none approved`
          : "No routine has been generated from the care plan",
        reason: drafted
          ? "The care plan is active but its routine is not approved, so no care occurrences are generated. Approve the routine to put it into effect."
          : "The care plan is active but no routine has been generated from it, so no care occurrences exist for this resident.",
        sourceType: "RoutineEventDefinition",
        sourceId: resident.id,
        sourceHref: moduleHref(path, "routinegenerator"),
      };
    });

  const taskItems = openTasks.map((item) => taskItem(item, now, path, item.createdAt >= shiftStart));
  const incidentItems = incidents.map((item) => incidentItem(item, path, shiftStart));
  const escalationItems = escalations.map((item) => escalationItem(item, path, shiftStart, role === "nurse"));
  const bellItems = bells.map((item) => bellItem(item, path, shiftStart));
  const varianceItems = events.filter((item) => item.isVariance || item.reviewAlertRaised || item.immediateEscalation).map((item) => careEventItem(item, path, shiftStart));
  const residentWatch = watchItems(residents, incidents, escalations, events, path);
  const unassigned = taskItems.filter((item) => item.ownerLabel === "Unassigned");
  const activeAttendance = attendance.filter((item) => !item.endTime && item.status !== "ABSENT");

  const commonMetrics: DashboardMetric[] = [
    metric({ key: "care_delivery_on_time", label: "Care delivered this shift", numerator: completedShift.length + shiftOccDelivery.completed, denominator: dueShift.length + shiftOccDelivery.due, numeratorLabel: "completed governed tasks + routine occurrences", denominatorLabel: "tasks and routine occurrences owed in the active shift", definition: "Care completed during the active shift divided by all care owed in that shift, across both charting paths: assigned Tasks and RoutineOccurrence closes from Today's Care. An occurrence whose window has not opened yet is not counted as owed.", window: shift.label, baseline: "Previous shift: " + percentageLabel(previousCompleted.length + previousOccDelivery.completed, previousDue.length + previousOccDelivery.due), exclusions: ["Cancelled tasks and occurrences", "Occurrences not yet due"], sourceModels: ["Task", "RoutineOccurrence"], href: moduleHref(path, "caredelivery") }),
    metric({ key: "variance_free_delivery", label: "Variance-free delivery", numerator: Math.max(0, shiftEvents.length - varianceEvents.length), denominator: shiftEvents.length, numeratorLabel: "care events without variance", denominatorLabel: "documented care events", definition: "Documented care events without an exception or delivery variance.", window: shift.label, baseline: "Previous shift: " + percentageLabel(Math.max(0, previousEvents.length - previousVariances.length), previousEvents.length), sourceModels: ["CareEvent"], href: moduleHref(path, "caredelivery") }),
    metric({ key: "assignment_coverage", label: "Resident assignment coverage", numerator: Math.min(coveredIds.size, residents.length), denominator: residents.length, numeratorLabel: "residents with a current-shift caregiver", denominatorLabel: "active residents", definition: "Active residents with at least one caregiver assignment in the current shift.", window: shift.label, baseline: "Previous shift: " + percentageLabel(Math.min(previousCovered.size, residents.length), residents.length), sourceModels: ["AppSetting", "Resident"], href: moduleHref(path, "caregiverschedule") }),
    metric({ key: "escalation_acknowledgement", label: "Escalations acknowledged", numerator: escalations.filter((item) => item.acknowledgedAt).length, denominator: escalations.length, numeratorLabel: "acknowledged open escalations", denominatorLabel: "open escalations", definition: "Open escalations explicitly acknowledged by the receiving role.", window: "Current open queue", baseline: "No historical snapshot available", sourceModels: ["Escalation"], href: moduleHref(path, "escalations") }),
  ];

  const carryOverItems: DashboardQueueItem[] = (latestHandover?.carryOvers || []).map((item, index) => ({
    id: `handover:${latestHandover?.id}:${item.id || index}`, kind: "Handover",
    priority: item.priority === "Urgent" ? "P2" : "P3", state: item.priority === "Urgent" ? "ESCALATED" : "WATCH",
    title: item.concern || "Carry-over item", detail: item.action || undefined, residentId: item.residentId,
    ownerLabel: item.role || "Incoming shift", dueAt: item.dueTime ? `${today}T${item.dueTime}:00` : undefined,
    reason: "Outstanding item was explicitly carried into the incoming shift.",
    sourceType: "ShiftEndorsement", sourceId: latestHandover?.id || ENDORSEMENT_KEY, sourceHref: moduleHref(path, "shiftendorsements"),
  }));

  const warnings: string[] = [];
  if (!settings.find((item) => item.key === CAREGIVER_SCHEDULE_KEY)) warnings.push("No caregiver roster has been published for this community.");
  if (!latestHandover) warnings.push("No shift handover has been started.");

  // ── Who is on duty ─────────────────────────────────────────────────────────
  // Roster-first, clock-in as a bonus signal — see lib/dashboard/presence.ts for why.
  const clockEvents = parseClockEvents(settings.find((item) => item.key === STAFF_CLOCK_KEY)?.value);
  const staffById = new Map(staffRoster.map((s) => [s.id, s]));
  const onDutyByUserId = onDutyFromClockLog(clockEvents, previousShiftStart);
  const presentList = resolveOnDuty({
    rostered: shiftSchedules,
    timeTracking: activeAttendance.map((item) => ({
      staffId: item.staffId, name: item.staff.user?.name, role: item.staff.user?.role, position: item.staff.position,
    })),
    clockedIn: [...onDutyByUserId.entries()].map(([userId, ev]) => ({ userId, name: ev.name, role: ev.role })),
    staff: staffRoster,
  });
  const summary = {
    activeResidents: residents.length, staffedNow: presentList.length,
    caregiversPresent: presentList.filter(isCaregiver).length,
    pcgAssignments: shiftSchedules.filter((item) => item.private).length,
    newOrReturningResidents: activeAdmissions.length,
    nurseOnDuty: presentList.find(isNurse)?.name ?? undefined,
    residentsCovered: Math.min(coveredIds.size, residents.length), residentsUncovered: Math.max(0, residents.length - coveredIds.size),
    openEscalations: escalations.length, overdueWork: overdueTasks.length,
    handoverStatus: latestHandover?.status || "NOT_STARTED", handoverId: latestHandover?.id, handoverLabel: latestHandover?.number,
  } as const;

  let sections: DashboardSection[] = [];
  let metrics = commonMetrics;
  let summaryExtra: Partial<DashboardSummary> = {};
  let huddle: DashboardHuddle | undefined;

  if (role === "nurse") {
    const nurseSection = (key: NurseDashboardZoneKey, items: DashboardQueueItem[]) => {
      const copy = nurseDashboardZone(key);
      return section(copy.key, copy.title, copy.description, items, copy.emptyTitle, copy.emptyHint);
    };
    const deploymentAssignments: DashboardQueueItem[] = shiftSchedules.map((assignment) => {
      // Being rostered IS the duty authority here, so presence is not the question —
      // whether they have started charting is. A rostered caregiver with no
      // documentation once the shift is underway is the real thing to chase.
      const assignmentUserId = assignment.caregiverUserId
        || staffById.get(assignment.caregiverStaffId)?.userId
        || undefined;
      const hasCharted = !!assignmentUserId && chartedThisShift.has(assignmentUserId);
      // Grace before "nothing charted yet" is meaningful — a caregiver an hour into
      // an 8-hour shift may legitimately have nothing recorded.
      const shiftUnderway = now.getTime() - shiftStart.getTime() > 2 * 3600_000;
      const idle = shiftUnderway && !hasCharted;
      const highCaseload = !assignment.private && assignment.residentIds.length > 6;
      const residentPreview = (assignment.residents || []).slice(0, 4).map((resident) =>
        resident.room ? `${resident.name} (Room ${resident.room})` : resident.name);
      const remaining = Math.max(0, assignment.residentIds.length - residentPreview.length);
      return {
        id: `deployment:${assignment.id}`, kind: assignment.private ? "Dedicated caregiver assignment" : "Caregiver assignment",
        priority: idle || highCaseload ? "P2" : "P3",
        state: idle || highCaseload ? "WATCH" : "STABLE",
        title: assignment.caregiverName || "Assigned caregiver",
        detail: [
          residentPreview.join(", "),
          remaining ? `+${remaining} more` : "",
          assignment.private ? "PCG / dedicated" : "Shared assignment",
        ].filter(Boolean).join(" · "),
        ownerLabel: assignment.caregiverName || "Assigned caregiver",
        reason: idle
          ? "On the roster for this shift but nothing documented yet — confirm they have started."
          : highCaseload
            ? "The shared assignment exceeds the 1:6 reference and requires nurse review."
            : hasCharted
              ? "On duty for this shift and documenting care."
              : "On duty for this shift with an active resident assignment.",
        sourceType: "CaregiverSchedule", sourceId: assignment.id,
        sourceHref: `${moduleHref(path, "staffinghub")}?hub=caregiverschedule`,
      };
    });
    const uncoveredResidents: DashboardQueueItem[] = residents
      .filter((resident) => !coveredIds.has(resident.id))
      .map((resident) => ({
        id: `nurse-coverage:${resident.id}`, kind: "Coverage gap", priority: "P2", state: "WATCH",
        title: residentLabel(resident), residentId: resident.id, residentLabel: residentLabel(resident),
        roomLabel: resident.roomNumber || undefined,
        reason: "No primary caregiver assignment covers this resident in the active shift roster.",
        sourceType: "CaregiverSchedule", sourceId: CAREGIVER_SCHEDULE_KEY,
        // Staffing → Schedule: the roster is the only place a coverage gap is fixed.
        // Caregiver Schedule now lives inside the Staffing hub, so link to the hub and
        // name the pane; the bare /nurse/caregiverschedule route still resolves but
        // drops the nurse in without the hub's tab bar.
        sourceHref: `${moduleHref(path, "staffinghub")}?hub=caregiverschedule`,
      }));
    const caregiverHelpIds = new Set(escalations
      .filter((item) => item.raisedByRole === "CAREGIVER" && item.assignedToRole === "NURSE")
      .map((item) => item.id));
    const helpRequests = escalationItems.filter((item) => caregiverHelpIds.has(item.sourceId));
    const deploymentItems = [...helpRequests, ...uncoveredResidents, ...unassigned, ...deploymentAssignments];
    // §4 Shift Watchlist categories derived from governed v4.2 signals that the
    // incident/escalation/variance watch does not cover: post-hospital monitoring
    // and DT-013 / DT-014 review. Scoped to currently active residents.
    const activeResidentIds = new Set(residents.map((resident) => resident.id));
    const postHospitalWatch: DashboardQueueItem[] = assessmentSignals
      .filter(({ assessment }) => assessment.context?.recentHospitalization && assessment.layer1?.residentId && activeResidentIds.has(assessment.layer1.residentId as string))
      .map(({ assessment }) => ({
        id: `watch-posthospital:${assessment.layer1!.residentId}`, kind: "Post-hospital monitoring", priority: "P3", state: "WATCH",
        title: assessment.layer1?.residentName || "Resident", residentId: assessment.layer1!.residentId as string,
        residentLabel: assessment.layer1?.residentName || "Resident",
        detail: "Recent hospitalization — post-return monitoring required",
        reason: "Resident returned from hospital/ED and remains under post-return monitoring.",
        // Monitoring, not the journey timeline: post-return surveillance is an action
        // (observations, vitals, domain scoring), and the journey is read-only history.
        sourceType: "Assessment", sourceId: assessment.id,
        sourceHref: `${moduleHref(path, "monitoringhub")}?resident=${encodeURIComponent(assessment.layer1!.residentId as string)}`,
      }));
    const dedicatedSupportWatch: DashboardQueueItem[] = assessmentSignals
      .filter(({ classification, assessment }) => (classification?.dt013?.recommendReview || classification?.dt014?.recommendReview) && assessment.layer1?.residentId && activeResidentIds.has(assessment.layer1.residentId as string))
      .map(({ classification, assessment }) => {
        const kinds = [classification?.dt013?.recommendReview ? "DT-013" : "", classification?.dt014?.recommendReview ? "DT-014" : ""].filter(Boolean).join(" / ");
        return {
          id: `watch-dedicated:${assessment.layer1!.residentId}`, kind: `${kinds} review`, priority: "P3" as const, state: "WATCH" as const,
          title: assessment.layer1?.residentName || "Resident", residentId: assessment.layer1!.residentId as string,
          residentLabel: assessment.layer1?.residentName || "Resident",
          detail: classification?.dt013?.recommendReview && classification?.dt014?.recommendReview
            ? "Dedicated-support and additional-service review indicated"
            : classification?.dt013?.recommendReview ? "Dedicated-support review indicated (DT-013)" : "Additional-service review indicated (DT-014)",
          reason: "A governed dedicated-staffing or additional-service review is indicated for this resident.",
          // DT-013 / DT-014 are resolved on the Dedicated Staffing / PCG board — that
          // is where the recommendation is assessed and a 1:1 assignment authorised.
          sourceType: "Assessment", sourceId: assessment.id,
          sourceHref: `${moduleHref(path, "privatecare")}?resident=${encodeURIComponent(assessment.layer1!.residentId as string)}`,
        };
      });
    const admissionWatchItems: DashboardQueueItem[] = activeAdmissions.map((admission) => ({
      id: `admission-watch:${admission.id}`, kind: "New admission / return", priority: "P3", state: "WATCH",
      title: [admission.firstName, admission.lastName].filter(Boolean).join(" ") || "Admission in progress",
      occurredAt: admission.updatedAt.toISOString(),
      detail: `Move-in workflow step ${admission.currentStep} of 8`,
      reason: "A new admission or return remains in progress and requires shift awareness.",
      // Move-in, not Pre-Admission: the detail reads "Move-in workflow step N of 8",
      // and that 8-step wizard is the Move-in board. `prescreen` is the separate
      // Stage-2 Pre-Admission Assessment, so this row used to land on the wrong form.
      sourceType: "Admission", sourceId: admission.id,
      sourceHref: `${moduleHref(path, "movein")}?admission=${encodeURIComponent(admission.id)}`,
    }));
    const nurseFollowUps: DashboardQueueItem[] = physicianCommunications.map((communication) => {
      const overdue = Boolean(communication.followUpDeadline && communication.followUpDeadline < now);
      return {
        id: `nurse-communication:${communication.id}`, kind: "Provider communication follow-up",
        priority: overdue ? "P2" : "P4", state: overdue ? "WATCH" : "STABLE",
        title: `${residentLabel(communication.resident)} · ${communication.physicianName}`,
        residentId: communication.residentId, residentLabel: residentLabel(communication.resident),
        roomLabel: communication.resident?.roomNumber || undefined,
        dueAt: communication.followUpDeadline?.toISOString(), occurredAt: communication.occurredAt.toISOString(),
        detail: communication.reason,
        reason: overdue
          ? "The documented provider communication follow-up deadline has passed."
          : "Verified coordination or lower-priority follow-up remains open.",
        sourceType: "PhysicianCommunication", sourceId: communication.id,
        sourceHref: "/nurse/physiciancomms",
        isNew: communication.occurredAt >= shiftStart,
      };
    });
    const nurseVarianceItems = varianceItems.filter((item) =>
      Boolean(item.occurredAt && new Date(item.occurredAt) >= shiftStart));
    const clinicalTriage = [
      ...bellItems, ...incidentItems, ...escalationItems, ...nurseVarianceItems, ...taskItems, ...nurseFollowUps,
    ];
    const careDeliveryItems = [
      // Coverage gaps lead: a resident with no approved routine has no care being
      // delivered at all, which outranks any individual task in this zone.
      ...routineGaps,
      ...taskItems.filter((item) => item.dueAt && new Date(item.dueAt) <= shiftEnd),
      ...nurseVarianceItems,
    ];
    const nextTwoHours = taskItems.filter((item) =>
      item.dueAt && new Date(item.dueAt) > now && new Date(item.dueAt) <= new Date(now.getTime() + 2 * 3600_000));
    const newSinceShift = [
      ...bellItems, ...incidentItems, ...escalationItems, ...nurseVarianceItems, ...taskItems, ...nurseFollowUps,
      ...deploymentAssignments.filter((item) => {
        const source = shiftSchedules.find((assignment) => assignment.id === item.sourceId);
        return source?.updatedAt && new Date(source.updatedAt) >= shiftStart;
      }),
    ].filter((item) => item.isNew || item.id.startsWith("deployment:"));
    const endorsementItems = [
      ...carryOverItems,
      ...clinicalTriage.filter((item) => ["P1", "P2"].includes(item.priority)),
      ...deploymentItems.filter((item) => item.priority === "P2"),
    ];
    // §11 step 4 — shift huddle: a concise generated briefing of what the
    // incoming shift must know, derived from the same governed data as the
    // zones (never invented): watch residents, care changes, safety risks,
    // staffing notes.
    const priorityTriage = clinicalTriage.filter((item) => ["P1", "P2"].includes(item.priority));
    const unacknowledgedCritical = escalationItems.filter((item) => ["P1", "P2"].includes(item.priority) && !item.action);
    const presentCaregiverNames = presentList.filter(isCaregiver).map((d) => d.name).filter((n): n is string => !!n);
    const assignedCaregiverNotes = shiftSchedules.map((assignment) =>
      `${assignment.caregiverName || "Assigned caregiver"} — ${assignment.residentIds.length} resident${assignment.residentIds.length === 1 ? "" : "s"}`
      + `${assignment.private ? " (dedicated)" : ""}`);
    huddle = {
      headline: `${residents.length} residents · ${priorityTriage.length} priority item${priorityTriage.length === 1 ? "" : "s"} · ${uncoveredResidents.length} uncovered`,
      generatedAt: now.toISOString(),
      residentsToWatch: residentWatch.slice(0, 3).map((item) =>
        `${item.title}${item.roomLabel ? ` · Rm ${item.roomLabel}` : ""} — ${item.reason}`),
      careChanges: [
        ...nurseVarianceItems.slice(0, 3).map((item) => `${item.title}${item.residentLabel ? ` (${item.residentLabel})` : ""} — ${item.kind.toLowerCase()}`),
        ...(activeAdmissions.length ? [`${activeAdmissions.length} new admission/return workflow${activeAdmissions.length === 1 ? "" : "s"} in progress`] : []),
        ...carryOverItems.slice(0, 2).map((item) => `Carry-over from previous shift: ${item.title}`),
      ],
      safetyRisks: [
        ...(incidentItems.length ? [`${incidentItems.length} unresolved incident${incidentItems.length === 1 ? "" : "s"} on file`] : []),
        ...(bellItems.length ? [`${bellItems.length} active call bell${bellItems.length === 1 ? "" : "s"}`] : []),
        ...(unacknowledgedCritical.length ? [`${unacknowledgedCritical.length} P1/P2 escalation${unacknowledgedCritical.length === 1 ? "" : "s"} awaiting acknowledgement`] : []),
        ...(overdueTasks.length ? [`${overdueTasks.length} overdue care task${overdueTasks.length === 1 ? "" : "s"}`] : []),
        ...(routineGaps.length ? [`${routineGaps.length} resident${routineGaps.length === 1 ? "" : "s"} on an active care plan with no approved routine — no care occurrences are being generated`] : []),
      ],
      staffingNotes: [
        // Name who is on duty and who holds residents — the two things a nurse
        // taking the shift actually needs, rather than a bare count.
        presentCaregiverNames.length
          ? `On duty: ${presentCaregiverNames.slice(0, 4).join(", ")}${presentCaregiverNames.length > 4 ? ` +${presentCaregiverNames.length - 4} more` : ""}`
          : "No caregiver is rostered to this shift.",
        ...(assignedCaregiverNotes.length ? assignedCaregiverNotes.slice(0, 4) : [`${shiftSchedules.length} assignment${shiftSchedules.length === 1 ? "" : "s"} published this shift`]),
        ...deploymentAssignments.filter((item) => item.state === "WATCH").slice(0, 3).map((item) => `${item.ownerLabel}: ${item.reason}`),
        ...(uncoveredResidents.length ? [`${uncoveredResidents.length} resident${uncoveredResidents.length === 1 ? "" : "s"} without a current-shift caregiver`] : []),
        ...(unassigned.length ? [`${unassigned.length} open task${unassigned.length === 1 ? "" : "s"} still unassigned`] : []),
      ],
    };
    sections = [
      nurseSection("clinical-triage", clinicalTriage),
      nurseSection("caregiver-deployment", deploymentItems),
      nurseSection("shift-watchlist", [...residentWatch, ...postHospitalWatch, ...dedicatedSupportWatch, ...admissionWatchItems]),
      nurseSection("care-delivery-status", careDeliveryItems),
      nurseSection("next-two-hours", nextTwoHours),
      nurseSection("new-since-shift", newSinceShift),
      nurseSection("shift-endorsement", endorsementItems),
    ];
  } else if (role === "caregiver") {
    const caregiverSection = (key: CaregiverDashboardAreaKey, items: DashboardQueueItem[]) => {
      const copy = caregiverDashboardArea(key);
      return section(copy.key, copy.title, copy.description, items, copy.emptyTitle, copy.emptyHint);
    };
    const assignedNames = residents.map((resident) => residentLabel(resident));
    const assignmentNotice: DashboardQueueItem[] = myAssignment ? [{
      id: `assignment:${myAssignment.id}`, kind: "Assignment update",
      priority: myAssignment.acknowledgedAt ? "P4" : "P2", state: myAssignment.acknowledgedAt ? "STABLE" : "WATCH",
      title: `${myAssignment.residentIds.length} assigned resident${myAssignment.residentIds.length === 1 ? "" : "s"}`,
      detail: [assignedNames.slice(0, 5).join(", "), myAssignment.note].filter(Boolean).join(" - ") || undefined,
      reason: myAssignment.acknowledgedAt
        ? "The current assignment has been acknowledged."
        : "Acknowledge this assignment or helper-support change before continuing the shift.",
      sourceType: "CaregiverSchedule", sourceId: myAssignment.id, sourceHref: "/caregiver/caregiverschedule",
      action: myAssignment.acknowledgedAt ? undefined : { type: "ACKNOWLEDGE_ASSIGNMENT", label: "Acknowledge assignment", entityId: myAssignment.id },
    }] : [];
    const residentCards: DashboardQueueItem[] = residents.map((resident) => {
      const details = [
        `Approved assistance: ${String(resident.careDependencyLevel || resident.careLevel).replaceAll("_", " ")}`,
        resident.allergies ? `Allergies: ${resident.allergies}` : "",
        resident.dietRestriction ? `Diet: ${resident.dietRestriction}` : "",
        resident.codeStatus ? `Code status: ${String(resident.codeStatus).replaceAll("_", " ")}` : "",
        resident.notes ? `Care notes: ${resident.notes}` : "",
      ].filter(Boolean);
      return {
        id: `resident:${resident.id}`, kind: "Assigned resident",
        priority: details.length > 1 ? "P3" as const : "P4" as const,
        state: details.length > 1 ? "WATCH" as const : "STABLE" as const,
        title: residentLabel(resident), detail: details.join(" · "), residentId: resident.id,
        residentLabel: residentLabel(resident), roomLabel: resident.roomNumber, photoUrl: resident.photoUrl || undefined,
        reason: "Assigned to you for this shift. Review assistance, precautions, and notes before care.", sourceType: "Resident",
        sourceId: resident.id, sourceHref: "/caregiver/carehistory",
      };
    });
    const helpEscalationIds = new Set(escalations
      .filter((item) => item.raisedByRole === "CAREGIVER")
      .map((item) => item.id));
    const helpItems = escalationItems.filter((item) => helpEscalationIds.has(item.sourceId));
    const documentCareItems: DashboardQueueItem[] = taskItems.map((item) => ({
      ...item,
      id: `document:${item.sourceId}`,
      kind: "Document care",
      title: `Document ${item.title}`,
      reason: "Record Completed or Not Required with actual assistance and observation; use a standardized exception reason when care was not delivered as planned.",
      sourceHref: "/caregiver/todayscare",
    }));
    const shiftCloseItems: DashboardQueueItem[] = [
      ...taskItems.map((item) => ({
        ...item,
        id: `close:${item.sourceId}`,
        reason: "Complete the care item or record the reason it could not be completed before shift close.",
      })),
      ...helpItems,
      ...carryOverItems,
    ];
    sections = [
      caregiverSection("my-residents", residentCards),
      caregiverSection("my-care-now", taskItems.filter((item) => ["P1", "P2"].includes(item.priority))),
      caregiverSection("my-care-next", taskItems.filter((item) => item.priority === "P3")),
      caregiverSection("my-care-later", taskItems.filter((item) => item.priority === "P4")),
      caregiverSection("document-care", documentCareItems),
      caregiverSection("need-nurse-help", helpItems),
      caregiverSection("assignment-update", assignmentNotice),
      caregiverSection("shift-close", shiftCloseItems),
    ];
    metrics = commonMetrics.slice(0, 2);
  } else if (role === "care-manager") {
    const governanceSection = (key: CareManagerDashboardZoneKey, items: DashboardQueueItem[]) => {
      const copy = careManagerZone(key);
      return section(copy.key, copy.title, copy.description, items, copy.emptyTitle, copy.emptyHint);
    };
    const assessmentGovernance = assessmentSignals.filter(({ assessment, issues }) => {
      const nextReview = assessment.layer3?.nextReviewDate ? new Date(assessment.layer3.nextReviewDate) : null;
      const dueSoon = nextReview && !Number.isNaN(nextReview.getTime()) && nextReview <= new Date(now.getTime() + 7 * 86400_000);
      return assessment.status !== "VALIDATED" || issues.length > 0 || Boolean(dueSoon);
    });
    const reviewItems: DashboardQueueItem[] = planReviews.map((plan) => ({
      id: `care-plan:${plan.id}`, kind: "Care-plan governance",
      priority: plan.nextReviewDate && plan.nextReviewDate < now ? "P2" : plan.status === "ACTIVE" ? "P3" : "P2",
      state: "WATCH",
      title: `${residentLabel(plan.resident)} · ${plan.title}`, residentId: plan.residentId,
      residentLabel: residentLabel(plan.resident), roomLabel: plan.resident?.roomNumber,
      dueAt: plan.nextReviewDate?.toISOString(),
      reason: plan.nextReviewDate && plan.nextReviewDate < now
        ? "The governed plan review date has passed."
        : plan.status === "ACTIVE"
          ? "Review is due within seven days."
          : `Plan is ${String(plan.status).toLowerCase().replaceAll("_", " ")} and requires governance review.`,
      sourceType: "CarePlan", sourceId: plan.id, sourceHref: "/care_manager/careplans",
    }));
    const assessmentItems: DashboardQueueItem[] = assessmentGovernance.slice(0, 100).map(({ assessment, classification, issues }) => {
      const nextReview = assessment.layer3?.nextReviewDate ? new Date(assessment.layer3.nextReviewDate) : null;
      const overdue = Boolean(nextReview && !Number.isNaN(nextReview.getTime()) && nextReview < now);
      const waitingForAuthorization = assessment.status === "COMPLETED";
      const details = [
        assessment.layer3?.finalLevel ? `Final LOC ${assessment.layer3.finalLevel}` : "Final LOC not confirmed",
        classification?.mlrFloor ? `MLR floor ${classification.mlrFloor}` : "",
        issues.length ? `${issues.length} validation gate${issues.length === 1 ? "" : "s"} open` : "",
      ].filter(Boolean);
      return {
        id: `assessment:${assessment.id}`, kind: "Assessment & LOC governance",
        priority: overdue || waitingForAuthorization ? "P2" : "P3", state: "WATCH",
        title: assessment.layer1?.residentName || "Resident assessment", residentId: assessment.layer1?.residentId,
        residentLabel: assessment.layer1?.residentName, occurredAt: assessment.updatedAt || assessment.createdAt,
        dueAt: nextReview && !Number.isNaN(nextReview.getTime()) ? nextReview.toISOString() : undefined,
        detail: details.join(" · "),
        reason: overdue
          ? "The reassessment review date has passed."
          : waitingForAuthorization
            ? "Final LOC is awaiting authorized clinical review."
            : issues.length
              ? "Modifier, MLR, capability, or Final LOC validation remains incomplete."
              : `Assessment is ${String(assessment.status).toLowerCase().replaceAll("_", " ")}.`,
        sourceType: "AssessmentV42", sourceId: assessment.id,
        sourceHref: `/care_manager/prescreen${assessment.layer1?.residentId ? `?resident=${encodeURIComponent(assessment.layer1.residentId)}` : ""}`,
      };
    });
    const transitionItems: DashboardQueueItem[] = assessmentSignals
      .filter(({ assessment }) => assessment.context?.recentHospitalization)
      .map(({ assessment }) => ({
        id: `transition:${assessment.id}`, kind: "Post-hospital transition", priority: "P2", state: "WATCH",
        title: assessment.layer1?.residentName || "Resident return",
        residentId: assessment.layer1?.residentId, residentLabel: assessment.layer1?.residentName,
        occurredAt: assessment.updatedAt || assessment.createdAt,
        reason: "Recent hospitalization requires active transition monitoring and clinical review.",
        sourceType: "AssessmentV42", sourceId: assessment.id,
        sourceHref: `/care_manager/prescreen${assessment.layer1?.residentId ? `?resident=${encodeURIComponent(assessment.layer1.residentId)}` : ""}`,
      }));
    const uncoveredResidents: DashboardQueueItem[] = residents
      .filter((resident) => !coveredIds.has(resident.id))
      .map((resident) => ({
        id: `coverage:${resident.id}`, kind: "Coverage gap", priority: "P2", state: "WATCH",
        title: residentLabel(resident), residentId: resident.id, residentLabel: residentLabel(resident),
        roomLabel: resident.roomNumber || undefined,
        reason: "No caregiver assignment covers this resident in the current shift roster.",
        sourceType: "CaregiverSchedule", sourceId: CAREGIVER_SCHEDULE_KEY,
        sourceHref: "/care_manager/caregiverschedule",
      }));
    const sharedCaseloadConcerns: DashboardQueueItem[] = shiftSchedules
      .filter((assignment) => assignment.residentIds.length > 6)
      .map((assignment) => ({
        id: `caseload:${assignment.id}`, kind: "Shared caseload review", priority: "P2", state: "WATCH",
        title: `${assignment.caregiverName || "Caregiver"} · ${assignment.residentIds.length} residents`,
        ownerLabel: assignment.caregiverName || "Assigned caregiver",
        reason: "The shared assignment exceeds the 1:6 reference and requires a capability review.",
        sourceType: "CaregiverSchedule", sourceId: assignment.id,
        sourceHref: "/care_manager/caregiverschedule",
      }));
    const decisionAssessmentItems: DashboardQueueItem[] = assessmentSignals.flatMap(({ assessment, classification, issues }) => {
      const decisions = [
        classification?.dt013.recommendReview ? "DT-013 / PCG review" : "",
        classification?.dt014.recommendReview ? "DT-014 additional clinical services review" : "",
        assessment.status === "COMPLETED" ? "Final LOC authorization" : "",
        issues.some((issue) => ["G2", "G3", "G4", "G5"].includes(issue.gate)) ? "Assessment governance decision" : "",
      ].filter(Boolean);
      if (!decisions.length) return [];
      return [{
        id: `decision-assessment:${assessment.id}`, kind: "Open clinical decision",
        priority: "P2" as const, state: "WATCH" as const,
        title: assessment.layer1?.residentName || "Resident assessment",
        residentId: assessment.layer1?.residentId, residentLabel: assessment.layer1?.residentName,
        occurredAt: assessment.updatedAt || assessment.createdAt, detail: decisions.join(" · "),
        reason: "A governed clinical decision remains open; the dashboard does not auto-apply a level, service, or fee.",
        sourceType: "AssessmentV42", sourceId: assessment.id,
        sourceHref: `/care_manager/prescreen${assessment.layer1?.residentId ? `?resident=${encodeURIComponent(assessment.layer1.residentId)}` : ""}`,
      }];
    });
    const overdueDelivery = taskItems.filter((item) => item.dueAt && new Date(item.dueAt) < now);
    const clinicalRisk = [...residentWatch, ...transitionItems];
    const safetyItems = [
      ...incidentItems,
      ...escalationItems.filter((item) => ["P1", "P2"].includes(item.priority)),
      ...transitionItems,
    ];
    const staffingItems = [...uncoveredResidents, ...sharedCaseloadConcerns, ...unassigned];
    const communicationItems: DashboardQueueItem[] = physicianCommunications.map((communication) => {
      const overdue = Boolean(communication.followUpDeadline && communication.followUpDeadline < now);
      return {
        id: `communication:${communication.id}`, kind: "Provider communication follow-up",
        priority: overdue ? "P2" : "P3", state: "WATCH",
        title: `${residentLabel(communication.resident)} · ${communication.physicianName}`,
        residentId: communication.residentId, residentLabel: residentLabel(communication.resident),
        roomLabel: communication.resident?.roomNumber || undefined,
        dueAt: communication.followUpDeadline?.toISOString(), occurredAt: communication.occurredAt.toISOString(),
        detail: communication.reason,
        reason: overdue
          ? "The documented provider communication follow-up deadline has passed."
          : "Provider communication has an unresolved documented follow-up.",
        sourceType: "PhysicianCommunication", sourceId: communication.id,
        sourceHref: "/care_manager/physiciancomms",
      };
    });
    const openDecisionItems = [
      ...decisionAssessmentItems,
      ...communicationItems,
      ...escalationItems.filter((item) => !item.ownerLabel || item.priority !== "P3"),
      ...varianceItems.filter((item) => ["P1", "P2"].includes(item.priority)),
      ...carryOverItems,
    ];
    sections = [
      governanceSection("clinical-risk", clinicalRisk),
      governanceSection("assessment-loc", assessmentItems),
      governanceSection("care-plan-governance", [...reviewItems, ...varianceItems.filter((item) => item.residentId)]),
      governanceSection("care-delivery-reliability", [...overdueDelivery, ...varianceItems]),
      governanceSection("safety-transitions", safetyItems),
      governanceSection("staffing-team-quality", staffingItems),
      governanceSection("open-decisions", openDecisionItems),
    ];
    const validatedResidentIds = new Set(
      assessmentSignals
        .filter(({ assessment }) => assessment.status === "VALIDATED" && assessment.layer1?.residentId)
        .map(({ assessment }) => assessment.layer1!.residentId as string),
    );
    const dueReassessments = assessmentSignals.filter(({ assessment }) => {
      const date = assessment.layer3?.nextReviewDate ? new Date(assessment.layer3.nextReviewDate) : null;
      return date && !Number.isNaN(date.getTime());
    });
    const onTimeReassessments = dueReassessments.filter(({ assessment }) => new Date(assessment.layer3!.nextReviewDate as string) >= now);
    const planBacklog = carePlans.filter((plan) => plan.status === "DRAFT" || plan.status === "UNDER_REVIEW");
    // §6.1 KPIs — repeated-variance, hospital/ED count, DT-013/014 review load,
    // escalation acknowledgement turnaround, and competency currency.
    const varianceBuckets = new Map<string, number>();
    const residentsWithVariance = new Set<string>();
    for (const item of events) {
      if (!item.isVariance && !item.reviewAlertRaised && !item.immediateEscalation) continue;
      if (!item.residentId) continue;
      residentsWithVariance.add(item.residentId);
      const bucket = `${item.residentId}:${item.taskId || item.bundle || item.domain || "unattributed"}`;
      varianceBuckets.set(bucket, (varianceBuckets.get(bucket) ?? 0) + 1);
    }
    const residentsWithRepeatVariance = new Set(
      [...varianceBuckets].filter(([, count]) => count >= 2).map(([bucket]) => bucket.split(":")[0]),
    );
    const cmHospitalSignals = assessmentSignals.filter(({ assessment }) => assessment.context?.recentHospitalization);
    const cmDt013Signals = assessmentSignals.filter(({ classification }) => classification?.dt013?.recommendReview);
    const cmDt014Signals = assessmentSignals.filter(({ classification }) => classification?.dt014?.recommendReview);
    const acknowledgementHours = escalations
      .filter((item) => item.acknowledgedAt)
      .map((item) => (new Date(item.acknowledgedAt as Date).getTime() - new Date(item.createdAt).getTime()) / 3600_000)
      .sort((a, b) => a - b);
    const medianAcknowledgementHours = acknowledgementHours.length
      ? Math.round(acknowledgementHours[Math.floor(acknowledgementHours.length / 2)])
      : null;
    const [competencyTotal, competencyExceptions] = await Promise.all([
      prisma.staffCompetency.count({ where: { staff: tenant } }),
      prisma.staffCompetency.count({ where: { staff: tenant, OR: [{ verified: false }, { expiryDate: { lt: now } }] } }),
    ]);
    // §6.1 — Active COC: residents flagged with acute instability on their v4.2
    // assessment, indicating temporary change-of-condition monitoring.
    const activeCocCount = assessmentSignals.filter(
      ({ assessment }) => assessment.context?.acuteInstability,
    ).length;
    // §6.1 — Care Delivery Reliability: expected care events completed within the
    // allowed window ÷ expected care events (task-based approximation; full
    // CareEvent query available for deeper drill-down).
    const deliveryExpected = dueShift.length;
    const deliveryCompleted = completedShift.length;
    // §6.1 — Observed vs Planned Burden Variance: difference between approved care
    // plan count (proxy for planned burden) and observed variance events (proxy for
    // actual delivery deviation). A positive variance signals under- or over-delivery.
    const plannedBurden = carePlans.filter((plan) => plan.status === "ACTIVE").length;
    const observedVariance = varianceItems.length;
    const burdenVariance = observedVariance - plannedBurden;
    // §6.1 — Safety Incident Trend: open/unresolved safety incidents in the selected
    // period (falls, unsafe events, medication safety).
    const periodIncidents = windowKey === "shift"
      ? incidentItems.length
      : incidents.filter((item) => item.incidentDate >= periodStart).length;
    metrics = [
      // §6.1 — Clinical Delivery (shared nurse / care-manager KPIs)
      commonMetrics[0], commonMetrics[1], commonMetrics[2],
      // §6.1 — Care Delivery Reliability %
      metric({
        key: "care_delivery_reliability", label: "Care delivery reliability",
        numerator: deliveryCompleted, denominator: deliveryExpected,
        numeratorLabel: "completed care events within allowed window",
        denominatorLabel: "expected care events",
        definition: "Care events completed within the governed time window as a share of all expected care events — excludes only events marked Not Required per approved plan.",
        window: shift.label, sourceModels: ["Task", "CareEvent"], href: "/care_manager/caredelivery",
      }),
      // §6.1 — Assessment & LOC
      metric({
        key: "assessment_current", label: "Assessment current",
        numerator: residents.filter((resident) => validatedResidentIds.has(resident.id)).length, denominator: residents.length,
        numeratorLabel: "residents with a current finalized assessment",
        denominatorLabel: "active residents",
        definition: "Active residents with a current validated v4.2 assessment on file.",
        window: "Current", sourceModels: ["AppSetting", "Resident"], href: "/care_manager/prescreen",
      }),
      metric({
        key: "reassessment_on_time", label: "Reassessment on-time",
        numerator: onTimeReassessments.length, denominator: dueReassessments.length,
        numeratorLabel: "reassessments not past review date",
        denominatorLabel: "assessments with a scheduled review date",
        definition: "Assessments whose next scheduled reassessment date has not yet passed.",
        window: "Current", sourceModels: ["AppSetting"], href: "/care_manager/prescreen",
      }),
      // §6.1 — Care Plan Governance
      metric({
        key: "care_plan_current", label: "Care plans current",
        numerator: carePlans.filter((plan) => plan.status === "ACTIVE" && (!plan.nextReviewDate || plan.nextReviewDate > now)).length,
        denominator: residents.length,
        numeratorLabel: "residents with active nursing-approved care plans",
        denominatorLabel: "active residents",
        definition: "Residents with a current active, nursing-approved care plan whose review date has not yet passed, as a share of all active residents.",
        window: "Current", sourceModels: ["CarePlan", "Resident"], href: "/care_manager/careplans",
      }),
      metric({
        key: "care_plan_backlog", label: "Care-plan approval backlog",
        numerator: planBacklog.length, denominator: planBacklog.length,
        numeratorLabel: "plans awaiting nursing approval",
        denominatorLabel: "plans awaiting nursing approval",
        definition: "Individualized care-plan drafts awaiting nursing approval.",
        window: "Current", format: "COUNT", sourceModels: ["CarePlan"], href: "/care_manager/careplans",
        state: planBacklog.length ? "WATCH" : "GOOD",
      }),
      // §6.1 — Open Clinical Escalations
      metric({
        key: "open_clinical_escalations", label: "Open clinical escalations",
        numerator: escalations.length, denominator: escalations.length,
        numeratorLabel: "unresolved clinical escalations",
        denominatorLabel: "unresolved clinical escalations",
        definition: "Unresolved clinical review and escalation items.",
        window: "Current open queue", format: "COUNT", sourceModels: ["Escalation"], href: "/care_manager/escalations",
        state: escalations.length ? "WATCH" : "GOOD",
      }),
      // §6.1 — Active Change-of-Condition
      metric({
        key: "active_coc", label: "Active change-of-condition",
        numerator: activeCocCount, denominator: activeCocCount,
        numeratorLabel: "residents under temporary COC monitoring",
        denominatorLabel: "residents under temporary COC monitoring",
        definition: "Residents with an active temporary change-of-condition flag on their v4.2 assessment, requiring clinical monitoring with review/stop date.",
        window: "Current", format: "COUNT", sourceModels: ["AppSetting"], href: "/care_manager/caredelivery",
        state: activeCocCount ? "WATCH" : "GOOD",
      }),
      // §6.1 — Repeated Variance Rate
      metric({
        key: "repeated_variance_rate", label: "Repeated-variance residents",
        numerator: residentsWithRepeatVariance.size, denominator: residentsWithVariance.size,
        numeratorLabel: "residents with ≥2 variances on the same care task",
        denominatorLabel: "residents with any variance event",
        definition: "Residents whose care variances repeat on the same care task — a systemic delivery signal rather than a one-off.",
        window: "Last 7 days", sourceModels: ["CareEvent"], href: "/care_manager/caredelivery",
        state: residentsWithRepeatVariance.size ? "ACTION" : residentsWithVariance.size ? "WATCH" : "GOOD",
      }),
      // §6.1 — Observed vs Planned Burden Variance
      metric({
        key: "burden_variance", label: "Observed vs planned burden",
        numerator: burdenVariance, denominator: Math.max(Math.abs(burdenVariance), 1),
        numeratorLabel: "observed variance events minus active care plans",
        denominatorLabel: "absolute variance delta",
        definition: "Difference between observed care-event variance count and active approved care plans — a positive value signals delivery deviation beyond the approved plan scope.",
        window: shift.label, format: "COUNT", sourceModels: ["CarePlan", "CareEvent"], href: "/care_manager/caredelivery",
        state: burdenVariance > 0 ? "WATCH" : "GOOD",
      }),
      // §6.1 — Safety / Transitions
      metric({
        key: "hospital_ed_count", label: "Hospital / ED transfers",
        numerator: cmHospitalSignals.length, denominator: cmHospitalSignals.length,
        numeratorLabel: "residents under post-hospital monitoring",
        denominatorLabel: "residents under post-hospital monitoring",
        definition: "Residents flagged with a recent hospitalization on their v4.2 assessment, requiring transition monitoring.",
        window: "Current", format: "COUNT", sourceModels: ["AppSetting"], href: "/care_manager/residentjourney",
        state: cmHospitalSignals.length ? "WATCH" : "GOOD",
      }),
      metric({
        key: "safety_incidents", label: "Safety incident trend",
        numerator: periodIncidents, denominator: periodIncidents,
        numeratorLabel: "safety incidents in period",
        denominatorLabel: "safety incidents in period",
        definition: "Open or unresolved safety incidents (falls, unsafe events, medication safety) in the selected time window.",
        window: WINDOW_LABELS[windowKey], format: "COUNT", sourceModels: ["Incident"], href: "/care_manager/incidents",
        state: periodIncidents ? "WATCH" : "GOOD",
      }),
      // §6.1 — Staffing / Team Quality
      metric({
        key: "dt013_review_load", label: "DT-013 review load",
        numerator: cmDt013Signals.length, denominator: cmDt013Signals.length,
        numeratorLabel: "residents with an indicated dedicated-support review",
        denominatorLabel: "residents with an indicated dedicated-support review",
        definition: "Assessment-indicated DT-013 dedicated-support / PCG reviews awaiting decision; separate from Final LOC.",
        window: "Current", format: "COUNT", sourceModels: ["AppSetting"], href: "/care_manager/privatecare",
        state: "GOOD",
      }),
      metric({
        key: "dt014_review_load", label: "DT-014 review load",
        numerator: cmDt014Signals.length, denominator: cmDt014Signals.length,
        numeratorLabel: "residents with an indicated additional-service review",
        denominatorLabel: "residents with an indicated additional-service review",
        definition: "Assessment-indicated DT-014 additional-clinical-services reviews or stop-dates due; separate from LOC / package.",
        window: "Current", format: "COUNT", sourceModels: ["AppSetting"], href: "/care_manager/additionalservices",
        state: "GOOD",
      }),
      metric({
        key: "competency_currency", label: "Competency currency exceptions",
        numerator: competencyExceptions, denominator: Math.max(competencyTotal, competencyExceptions),
        numeratorLabel: "expired or unverified staff competencies",
        denominatorLabel: "tracked staff competencies",
        definition: "Staff competency records that are unverified or past expiry — assignments gated by these must be resolved before scheduling.",
        window: "Current", format: "COUNT", sourceModels: ["StaffCompetency"], href: "/care_manager/staffprofiles",
        state: competencyExceptions ? "WATCH" : "GOOD",
      }),
      // §6.1 — Open Decisions (Nursing Review Turnaround)
      metric({
        key: "review_turnaround", label: "Nursing review turnaround",
        numerator: medianAcknowledgementHours ?? 0, denominator: medianAcknowledgementHours === null ? 0 : medianAcknowledgementHours,
        numeratorLabel: "median hours from trigger to documented disposition",
        denominatorLabel: "median hours from trigger to documented disposition",
        definition: "Median elapsed hours from the routed review trigger (escalation or variance alert) to documented nurse acknowledgement — pilot metric, target to be calibrated.",
        window: "Current", format: "COUNT", sourceModels: ["Escalation"], href: "/care_manager/escalations",
        state: medianAcknowledgementHours === null || medianAcknowledgementHours <= 1 ? "GOOD" : medianAcknowledgementHours <= 4 ? "WATCH" : "ACTION",
      }),
    ];
  } else if (role === "facility-admin") {
    // Administrator (§7) — aggregate-first community oversight. Reuses the shared
    // governed items; adds capacity + admissions + assessment-governance rollups.
    const [rooms, dischargesRecent] = await Promise.all([
      prisma.room.findMany({ where: tenant, select: { capacity: true } }),
      prisma.resident.count({
        where: { ...tenant, status: { in: ["DISCHARGED", "ON_LEAVE"] }, updatedAt: { gte: new Date(now.getTime() - 30 * 86400_000) } },
      }),
    ]);
    const capacity = rooms.reduce((sum, room) => sum + (room.capacity || 0), 0);
    const census = residents.length;
    const occupancyPct = capacity > 0 ? Math.round((census / capacity) * 100) : 0;

    const signals = buildAssessmentSignals(assessmentRecords);
    const validatedResidentIds = new Set(
      signals.filter(({ assessment }) => assessment.status === "VALIDATED" && assessment.layer1?.residentId)
        .map(({ assessment }) => assessment.layer1!.residentId as string),
    );
    const dueReassessments = signals.filter(({ assessment }) => {
      const date = assessment.layer3?.nextReviewDate ? new Date(assessment.layer3.nextReviewDate) : null;
      return date && !Number.isNaN(date.getTime());
    });
    const onTimeReassessments = dueReassessments.filter(({ assessment }) => new Date(assessment.layer3!.nextReviewDate as string) >= now);
    const residentsWithLoc = signals.filter(({ assessment }) => assessment.layer3?.finalLevel).length;
    const dt013Signals = signals.filter(({ classification }) => classification?.dt013?.recommendReview);
    const dt014Signals = signals.filter(({ classification }) => classification?.dt014?.recommendReview);
    const hospitalSignals = signals.filter(({ assessment }) => assessment.context?.recentHospitalization);
    // ponytail: audit/governance exceptions derived from existing governed gates
    // (validation issues + awaiting Final-LOC authorization + unacknowledged
    // escalations). Upgrade path: a dedicated audit-exception source.
    const governanceExceptionSignals = signals.filter(({ assessment, issues }) => issues.length > 0 || assessment.status === "COMPLETED");
    const auditExceptionCount = governanceExceptionSignals.length + escalations.filter((item) => !item.acknowledgedAt).length;

    const activePlans = carePlans.filter((plan) => plan.status === "ACTIVE");
    const currentPlans = activePlans.filter((plan) => !plan.nextReviewDate || plan.nextReviewDate >= now);

    // Zone item builders (reuse shared governed items where possible).
    const uncoveredResidents: DashboardQueueItem[] = residents
      .filter((resident) => !coveredIds.has(resident.id))
      .map((resident) => ({
        id: `admin-coverage:${resident.id}`, kind: "Coverage gap", priority: "P2", state: "WATCH",
        title: residentLabel(resident), residentId: resident.id, residentLabel: residentLabel(resident),
        roomLabel: resident.roomNumber || undefined,
        reason: "No caregiver assignment covers this resident in the current shift roster.",
        sourceType: "CaregiverSchedule", sourceId: CAREGIVER_SCHEDULE_KEY, sourceHref: "/facility_admin/staff",
      }));
    const sharedCaseloadConcerns: DashboardQueueItem[] = shiftSchedules
      .filter((assignment) => assignment.residentIds.length > 6)
      .map((assignment) => ({
        id: `admin-caseload:${assignment.id}`, kind: "Shared staffing capability exception", priority: "P2", state: "WATCH",
        title: `${assignment.caregiverName || "Caregiver"} · ${assignment.residentIds.length} residents`,
        ownerLabel: assignment.caregiverName || "Assigned caregiver",
        reason: "The shared assignment exceeds the 1:6 reference; approved care may not be reliably delivered under shared staffing.",
        sourceType: "CaregiverSchedule", sourceId: assignment.id, sourceHref: "/facility_admin/staff",
      }));
    const admissionItems: DashboardQueueItem[] = activeAdmissions.map((admission) => ({
      id: `admin-admission:${admission.id}`, kind: "Admission / return", priority: "P3", state: "WATCH",
      title: [admission.firstName, admission.lastName].filter(Boolean).join(" ") || "Admission in progress",
      detail: `Move-in workflow step ${admission.currentStep} of 8`, occurredAt: admission.updatedAt.toISOString(),
      reason: "A new admission or return is in progress and requires operational awareness.",
      sourceType: "Admission", sourceId: admission.id, sourceHref: "/facility_admin/residents",
    }));
    const transitionItems: DashboardQueueItem[] = hospitalSignals.map(({ assessment }) => ({
      id: `admin-transition:${assessment.id}`, kind: "Post-hospital monitoring", priority: "P2", state: "WATCH",
      title: assessment.layer1?.residentName || "Resident return", residentId: assessment.layer1?.residentId,
      residentLabel: assessment.layer1?.residentName, occurredAt: assessment.updatedAt || assessment.createdAt,
      reason: "Recent hospitalization requires active change-of-condition and post-hospital monitoring.",
      sourceType: "AssessmentV42", sourceId: assessment.id,
      sourceHref: `/facility_admin/rounds${assessment.layer1?.residentId ? `?resident=${encodeURIComponent(assessment.layer1.residentId)}` : ""}`,
    }));
    const governanceItems: DashboardQueueItem[] = governanceExceptionSignals.slice(0, 100).map(({ assessment, issues }) => ({
      id: `admin-governance:${assessment.id}`, kind: "Governance exception",
      priority: assessment.status === "COMPLETED" ? "P2" : "P3", state: "WATCH",
      title: assessment.layer1?.residentName || "Resident assessment", residentId: assessment.layer1?.residentId,
      residentLabel: assessment.layer1?.residentName, occurredAt: assessment.updatedAt || assessment.createdAt,
      detail: [
        assessment.status === "COMPLETED" ? "Final LOC awaiting authorized sign-off" : "",
        issues.length ? `${issues.length} validation gate${issues.length === 1 ? "" : "s"} open` : "",
      ].filter(Boolean).join(" · "),
      reason: "Missing required evidence, approval, or authorized sign-off on a governed workflow.",
      sourceType: "AssessmentV42", sourceId: assessment.id,
      sourceHref: `/facility_admin/rounds${assessment.layer1?.residentId ? `?resident=${encodeURIComponent(assessment.layer1.residentId)}` : ""}`,
    }));
    const dt013Items: DashboardQueueItem[] = dt013Signals.map(({ assessment }) => ({
      id: `admin-dt013:${assessment.id}`, kind: "DT-013 dedicated support", priority: "P3", state: "WATCH",
      title: assessment.layer1?.residentName || "Resident", residentId: assessment.layer1?.residentId,
      residentLabel: assessment.layer1?.residentName, occurredAt: assessment.updatedAt || assessment.createdAt,
      reason: "Dedicated staffing (DT-013 / PCG) review is indicated; keep separate from Final LOC.",
      sourceType: "AssessmentV42", sourceId: assessment.id, sourceHref: "/facility_admin/careplans",
    }));
    const dt014Items: DashboardQueueItem[] = dt014Signals.map(({ assessment }) => ({
      id: `admin-dt014:${assessment.id}`, kind: "DT-014 additional services", priority: "P3", state: "WATCH",
      title: assessment.layer1?.residentName || "Resident", residentId: assessment.layer1?.residentId,
      residentLabel: assessment.layer1?.residentName, occurredAt: assessment.updatedAt || assessment.createdAt,
      reason: "Additional clinical services (DT-014) review or stop-date is due; keep separate from LOC / package.",
      sourceType: "AssessmentV42", sourceId: assessment.id, sourceHref: "/facility_admin/careplans",
    }));
    const agedEscalations = escalationItems.filter((item) => {
      const at = item.occurredAt ? new Date(item.occurredAt) : null;
      return item.priority === "P1" || item.priority === "P2" || Boolean(at && at < new Date(now.getTime() - 24 * 3600_000));
    });
    const overdueReviewItems = planReviews
      .filter((plan) => plan.nextReviewDate && plan.nextReviewDate < now)
      .map((plan) => ({
        id: `admin-review:${plan.id}`, kind: "Overdue review", priority: "P2" as const, state: "WATCH" as const,
        title: `${residentLabel(plan.resident)} · ${plan.title}`, residentId: plan.residentId,
        residentLabel: residentLabel(plan.resident), roomLabel: plan.resident?.roomNumber,
        dueAt: plan.nextReviewDate?.toISOString(), reason: "The governed care-plan review date has passed.",
        sourceType: "CarePlan", sourceId: plan.id, sourceHref: "/facility_admin/careplans",
      }));

    sections = [
      section(adminZone("community-snapshot").key, adminZone("community-snapshot").title, adminZone("community-snapshot").description, [...residentWatch, ...admissionItems], adminZone("community-snapshot").emptyTitle, adminZone("community-snapshot").emptyHint),
      section(adminZone("staffing-coverage").key, adminZone("staffing-coverage").title, adminZone("staffing-coverage").description, [...uncoveredResidents, ...sharedCaseloadConcerns, ...unassigned], adminZone("staffing-coverage").emptyTitle, adminZone("staffing-coverage").emptyHint),
      section(adminZone("care-delivery-reliability").key, adminZone("care-delivery-reliability").title, adminZone("care-delivery-reliability").description, [...taskItems.filter((item) => item.dueAt && new Date(item.dueAt) < now), ...varianceItems], adminZone("care-delivery-reliability").emptyTitle, adminZone("care-delivery-reliability").emptyHint),
      section(adminZone("clinical-quality-safety").key, adminZone("clinical-quality-safety").title, adminZone("clinical-quality-safety").description, [...bellItems, ...incidentItems, ...escalationItems.filter((item) => ["P1", "P2"].includes(item.priority)), ...transitionItems], adminZone("clinical-quality-safety").emptyTitle, adminZone("clinical-quality-safety").emptyHint),
      section(adminZone("care-governance-compliance").key, adminZone("care-governance-compliance").title, adminZone("care-governance-compliance").description, [...governanceItems, ...overdueReviewItems], adminZone("care-governance-compliance").emptyTitle, adminZone("care-governance-compliance").emptyHint),
      section(adminZone("service-utilization").key, adminZone("service-utilization").title, adminZone("service-utilization").description, [...dt013Items, ...dt014Items], adminZone("service-utilization").emptyTitle, adminZone("service-utilization").emptyHint),
      section(adminZone("management-action-queue").key, adminZone("management-action-queue").title, adminZone("management-action-queue").description, [...agedEscalations, ...overdueReviewItems, ...sharedCaseloadConcerns, ...carryOverItems], adminZone("management-action-queue").emptyTitle, adminZone("management-action-queue").emptyHint),
    ];
    metrics = [
      metric({ key: "census_occupancy", label: "Census / occupancy", numerator: census, denominator: capacity, numeratorLabel: "active residents", denominatorLabel: "approved room capacity", definition: "Active residents divided by approved capacity when capacity is stored.", window: "Current", baseline: `Census ${census}${capacity ? ` of ${capacity}` : " · capacity not stored"}`, sourceModels: ["Resident", "Room"], href: "/facility_admin/occupancy", state: "GOOD" }),
      metric({ key: "loc_mix", label: "LOC mix (Final LOC on file)", numerator: residentsWithLoc, denominator: census, numeratorLabel: "residents with a Final LOC", denominatorLabel: "active residents", definition: "Residents with a nurse-confirmed Final Level of Care recorded; drill to the per-level breakdown.", window: "Current", format: "COUNT", sourceModels: ["AppSetting", "Resident"], href: "/facility_admin/rounds", state: "GOOD" }),
      { ...commonMetrics[2], label: "Staffing coverage %" },
      { ...commonMetrics[0], label: "Care delivery reliability %" },
      metric({ key: "overdue_care_rate", label: "Overdue care rate", numerator: overdueTasks.length, denominator: openTasks.length, numeratorLabel: "overdue governed tasks", denominatorLabel: "open governed tasks", definition: "Open governed care tasks past their documented due time.", window: "Current open work", sourceModels: ["Task"], href: "/facility_admin/tasks", state: overdueTasks.length ? "ACTION" : "GOOD" }),
      metric({ key: "exception_event_rate", label: "Exception event rate", numerator: varianceEvents.length, denominator: shiftEvents.length, numeratorLabel: "exception / variance events", denominatorLabel: "documented care events this shift", definition: "Standard exception events over documented care events for the active shift.", window: shift.label, sourceModels: ["CareEvent"], href: "/facility_admin/tasks", state: varianceEvents.length ? "WATCH" : "GOOD" }),
      metric({ key: "assessment_current", label: "Assessment current", numerator: residents.filter((resident) => validatedResidentIds.has(resident.id)).length, denominator: census, numeratorLabel: "residents with a current finalized assessment", denominatorLabel: "active residents", definition: "Active residents with a current validated v4.2 assessment on file.", window: "Current", sourceModels: ["AppSetting", "Resident"], href: "/facility_admin/rounds" }),
      metric({ key: "reassessment_on_time", label: "Reassessment on-time", numerator: onTimeReassessments.length, denominator: dueReassessments.length, numeratorLabel: "reassessments not past review date", denominatorLabel: "assessments with a scheduled review date", definition: "Assessments whose next scheduled reassessment date has not yet passed.", window: "Current", sourceModels: ["AppSetting"], href: "/facility_admin/rounds" }),
      metric({ key: "care_plan_current", label: "Care plan current", numerator: currentPlans.length, denominator: census, numeratorLabel: "residents with an active plan within review date", denominatorLabel: "active residents", definition: "Residents with an active, approved care plan within its review date.", window: "Current", sourceModels: ["CarePlan", "Resident"], href: "/facility_admin/careplans" }),
      metric({ key: "open_aged_escalations", label: "Open / aged escalations", numerator: escalations.length, denominator: escalations.length, numeratorLabel: "unresolved escalations", denominatorLabel: "unresolved escalations", definition: "Unresolved safety, clinical, or operational escalations; prioritize aging and high-risk items.", window: "Current open queue", format: "COUNT", sourceModels: ["Escalation"], href: "/facility_admin/alertcenter", state: escalations.length ? "WATCH" : "GOOD" }),
      metric({ key: "safety_incidents", label: "Safety incidents", numerator: incidents.length, denominator: incidents.length, numeratorLabel: "open governed incidents", denominatorLabel: "open governed incidents", definition: "Governed incident and safety events awaiting resolution.", window: "Current open queue", format: "COUNT", sourceModels: ["Incident"], href: "/facility_admin/incidents", state: incidents.length ? "WATCH" : "GOOD" }),
      metric({ key: "hospital_ed", label: "Hospital / ED transfers", numerator: hospitalSignals.length, denominator: hospitalSignals.length, numeratorLabel: "residents under post-hospital monitoring", denominatorLabel: "residents under post-hospital monitoring", definition: "Residents flagged with a recent hospitalization requiring post-return monitoring.", window: "Current", format: "COUNT", sourceModels: ["AppSetting"], href: "/facility_admin/rounds", state: hospitalSignals.length ? "WATCH" : "GOOD" }),
      metric({ key: "dt013_utilization", label: "DT-013 utilization", numerator: dt013Signals.length, denominator: dt013Signals.length, numeratorLabel: "residents with dedicated-support review", denominatorLabel: "residents with dedicated-support review", definition: "Residents with an indicated DT-013 dedicated-support review; separate from Final LOC.", window: "Current", format: "COUNT", sourceModels: ["AppSetting"], href: "/facility_admin/careplans", state: "GOOD" }),
      metric({ key: "dt014_utilization", label: "DT-014 utilization", numerator: dt014Signals.length, denominator: dt014Signals.length, numeratorLabel: "residents with additional-service review", denominatorLabel: "residents with additional-service review", definition: "Residents with an indicated DT-014 additional-service review; separate from LOC / package.", window: "Current", format: "COUNT", sourceModels: ["AppSetting"], href: "/facility_admin/careplans", state: "GOOD" }),
      metric({ key: "unassigned_care", label: "Unassigned care", numerator: unassigned.length, denominator: unassigned.length, numeratorLabel: "active tasks without an owner", denominatorLabel: "active tasks without an owner", definition: "Active governed tasks without a valid responsible role or assignment when due.", window: "Current", format: "COUNT", sourceModels: ["Task"], href: "/facility_admin/tasks", state: unassigned.length ? "ACTION" : "GOOD" }),
      metric({ key: "shared_staffing_exceptions", label: "Shared staffing exceptions", numerator: sharedCaseloadConcerns.length, denominator: sharedCaseloadConcerns.length, numeratorLabel: "assignments over the 1:6 reference", denominatorLabel: "assignments over the 1:6 reference", definition: "Shifts where approved care could not be reliably delivered under shared staffing and a DT-013 review is indicated.", window: shift.label, format: "COUNT", sourceModels: ["AppSetting"], href: "/facility_admin/staff", state: sharedCaseloadConcerns.length ? "WATCH" : "GOOD" }),
      metric({ key: "audit_exceptions", label: "Audit / governance exceptions", numerator: auditExceptionCount, denominator: auditExceptionCount, numeratorLabel: "records missing required evidence or sign-off", denominatorLabel: "records missing required evidence or sign-off", definition: "Missing required evidence, approval, effective/review date, or authorized sign-off on governed workflows.", window: "Current", format: "COUNT", sourceModels: ["AppSetting", "CarePlan", "Escalation"], href: "/facility_admin/auditlog", state: auditExceptionCount ? "WATCH" : "GOOD" }),
    ];
    // Enrich the summary bar with Administrator snapshot fields.
    summaryExtra = {
      capacity, occupancyPct, admissionsInProgress: activeAdmissions.length,
      dischargesRecent, watchEscalated: residentWatch.length,
    };
  } else if (role === "professional") {
    sections = [
      section("professional-review", "Items for Professional Review", "Escalations, incidents, and care-plan changes requiring discipline review.", [...escalationItems, ...incidentItems, ...varianceItems], "No professional review items"),
      section("care-plan-review", "Care Plans", "Upcoming and overdue plan reviews.", planReviews.map((plan) => ({
        id: `care-plan:${plan.id}`, kind: "Care plan", priority: "P3", state: "WATCH",
        title: `${residentLabel(plan.resident)} · ${plan.title}`, residentId: plan.residentId,
        residentLabel: residentLabel(plan.resident), roomLabel: plan.resident?.roomNumber,
        dueAt: plan.nextReviewDate?.toISOString(), reason: "Professional review may be relevant to the resident's current plan.",
        sourceType: "CarePlan", sourceId: plan.id, sourceHref: "/physician/careplans",
      })), "No plan reviews due"),
    ];
  }

  // §10 — when a reporting window is selected on an aggregate dashboard, re-derive
  // the period-based KPIs from the database instead of the shift snapshot. State /
  // display are recomputed through metric() so the tile stays internally consistent.
  let payloadMetrics = metrics;
  if ((role === "care-manager" || role === "facility-admin") && windowKey !== "shift") {
    const [dueTotal, dueDone, eventTotal, eventExceptions, incidentCount] = await Promise.all([
      prisma.task.count({ where: { ...tenant, dueDate: { gte: periodStart, lt: now }, status: { not: TaskStatus.CANCELLED } } }),
      prisma.task.count({ where: { ...tenant, dueDate: { gte: periodStart, lt: now }, status: TaskStatus.COMPLETED } }),
      prisma.careEvent.count({ where: { ...tenant, occurredAt: { gte: periodStart, lt: now } } }),
      prisma.careEvent.count({
        where: { ...tenant, occurredAt: { gte: periodStart, lt: now }, OR: [{ isVariance: true }, { reviewAlertRaised: true }, { immediateEscalation: true }] },
      }),
      prisma.incident.count({ where: { ...tenant, incidentDate: { gte: periodStart } } }),
    ]);
    const label = WINDOW_LABELS[windowKey];
    payloadMetrics = metrics.map((item) => {
      switch (item.key) {
        case "care_delivery_on_time":
          return metric({ ...item, numerator: dueDone, denominator: dueTotal, window: label, state: undefined });
        case "care_delivery_reliability":
          return metric({ ...item, numerator: dueDone, denominator: dueTotal, window: label, state: undefined });
        case "variance_free_delivery":
          return metric({ ...item, numerator: Math.max(0, eventTotal - eventExceptions), denominator: eventTotal, window: label, state: undefined });
        case "burden_variance":
          return metric({ ...item, numerator: eventExceptions - eventTotal, denominator: Math.max(Math.abs(eventExceptions - eventTotal), 1), window: label, state: eventExceptions > eventTotal ? "WATCH" : "GOOD" });
        case "exception_event_rate":
          return metric({ ...item, numerator: eventExceptions, denominator: eventTotal, window: label, state: eventExceptions > 0 ? "WATCH" : "GOOD" });
        case "safety_incidents":
          return metric({ ...item, numerator: incidentCount, denominator: Math.max(incidentCount, 1), window: label, state: incidentCount > 0 ? "WATCH" : "GOOD" });
        default:
          return item;
      }
    });
  }

  return {
    role, ...TITLES[role], asOf: now.toISOString(), freshnessSeconds: 30, serviceContext: "FACILITY",
    shift, summary: { ...summary, ...summaryExtra }, metrics: payloadMetrics, sections,
    residentChoices: role === "caregiver" ? residents.map((resident) => ({ id: resident.id, label: residentLabel(resident), room: resident.roomNumber })) : undefined,
    huddle,
    window: { key: windowKey, label: WINDOW_LABELS[windowKey] },
    warnings,
  };
}
