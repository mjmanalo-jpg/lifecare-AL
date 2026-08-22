/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { EscalationStatus, TaskStatus, type Prisma } from "@prisma/client";
import {
  ASSESSMENTS_V42_KEY, assessmentValidationIssues, classifyAssessment, type AssessmentV42,
} from "@/lib/lifecare/assessment";
import {
  CAREGIVER_SCHEDULE_KEY, currentShiftKey, localDateStr, parseSchedules,
  shiftMeta, shiftWindow, type CaregiverSchedule,
} from "@/lib/caregiverSchedule";
import type { TenantContext } from "@/lib/tenant";
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
import type { ClinicalState, DashboardMetric, DashboardPayload, DashboardPriority, DashboardQueueItem, DashboardRole, DashboardSection } from "./types";

const ENDORSEMENT_KEY = "shift_endorsements";
const OPEN_ESCALATIONS: EscalationStatus[] = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "ESCALATED"];
const TITLES: Record<DashboardRole, { title: string; subtitle: string }> = {
  nurse: { title: NURSE_DASHBOARD_TITLE, subtitle: NURSE_DASHBOARD_SUBTITLE },
  caregiver: { title: CAREGIVER_DASHBOARD_TITLE, subtitle: CAREGIVER_DASHBOARD_SUBTITLE },
  "care-manager": { title: CARE_MANAGER_DASHBOARD_TITLE, subtitle: CARE_MANAGER_DASHBOARD_SUBTITLE },
  "facility-admin": { title: "Facility Care Oversight", subtitle: "Aggregate care quality, safety, staffing, responsiveness, and continuity with accountable drill-downs." },
  "resident-coordinator": { title: "Resident Coordination", subtitle: "Appointments, transport, admissions, requests, activities, and non-clinical follow-up." },
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
  return { key, title, description, items: [...items].sort(compareQueueItems), emptyTitle, emptyHint };
}

async function buildCoordinatorDashboard(
  now: Date,
  timeZone: string,
  tenant: { organizationId: string; communityId: string },
): Promise<DashboardPayload> {
  const [transports, serviceRequests, communityEvents, admissions, residents, conciergeBookings] = await Promise.all([
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
  const sections = [
    section("urgent", "Urgent Coordination", "Non-clinical items requiring immediate coordination; clinical changes route to the nurse.", items.filter((item) => ["P1", "P2"].includes(item.priority)), "No urgent coordination items"),
    section("residents", "Resident Snapshot", "Room, coordination status, and non-clinical preferences for active residents.", residentItems, "No active resident coordination profiles"),
    section("today", "Today", "Transport, requests, admissions, and activities due today.", items.filter((item) => { const at = new Date(item.dueAt || item.occurredAt || 0); return item.priority === "P3" && at < startOfTomorrow; }), "No coordination items due today"),
    section("upcoming", "Upcoming", "Future appointments, transport, and community activity.", items.filter((item) => item.priority === "P4" || Boolean(item.dueAt && new Date(item.dueAt) >= startOfTomorrow)), "No upcoming coordination items"),
    section("awaiting", "Awaiting Another Owner", "Open requests with no responsible owner or an external dependency.", items.filter((item) => item.ownerLabel === "Unassigned"), "No unowned coordination items"),
    section("admissions", "Admissions & Returns", "Move-in and return coordination in progress.", items.filter((item) => item.sourceType === "Admission"), "No admissions in progress"),
    section("family-contacts", "Family Contacts & Update Preferences", "Authorized representatives and recorded non-clinical communication preferences.", familyContactItems, "No resident contact profiles"),
    section("endorsement", "Coordination Endorsement", "Unresolved non-clinical items that need an owner or carry-forward note.", endorsementItems, "No coordination items to carry forward"),
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
    sourceType: "Task", sourceId: task.id, sourceHref: path === "caregiver" ? "/caregiver/todayscare" : moduleHref(path, "taskassignment"), isNew,
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

function careEventItem(event: any, path: string, shiftStart: Date): DashboardQueueItem {
  const priority: DashboardPriority = event.immediateEscalation ? "P1" : event.reviewAlertRaised ? "P2" : "P3";
  return {
    id: `care-event:${event.id}`, kind: "Care variance", priority, state: stateForPriority(priority),
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

export async function buildDashboard(context: TenantContext, role: DashboardRole): Promise<DashboardPayload> {
  const now = new Date();
  const timeZone = process.env.FACILITY_TZ || "Asia/Manila";
  const today = localDateStr(now, timeZone);
  const currentShift = currentShiftKey(now);
  if (!context.organizationId || !context.communityId) throw new Error("Dashboard requires an active organization and community");
  const tenant = { organizationId: context.organizationId, communityId: context.communityId };
  if (role === "resident-coordinator") return buildCoordinatorDashboard(now, timeZone, tenant);
  const residentScope = role === "caregiver" ? (context.caregiverResidentIds ?? []) : undefined;

  const settings = await prisma.appSetting.findMany({
    where: { ...tenant, key: { in: [CAREGIVER_SCHEDULE_KEY, ENDORSEMENT_KEY, ASSESSMENTS_V42_KEY] } },
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

  const staffRecord = role === "caregiver"
    ? await prisma.staff.findFirst({ where: { ...tenant, userId: context.userId }, select: { id: true } })
    : null;
  const residentWhere = { ...tenant, status: "ACTIVE" as const, ...(residentScope ? { id: { in: residentScope } } : {}) };
  const taskWhere: Prisma.TaskWhereInput = {
    ...tenant,
    ...(residentScope ? { residentId: { in: residentScope }, assignedToId: staffRecord?.id || "__none__" } : {}),
    OR: [
      { status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] } },
      { dueDate: { gte: previousShiftStart, lt: shiftEnd } },
    ],
  };

  const [residents, tasks, incidents, bells, events, escalations, attendance, carePlans, physicianCommunications, activeAdmissions] = await Promise.all([
    prisma.resident.findMany({ where: residentWhere, orderBy: { roomNumber: "asc" }, select: { id: true, firstName: true, lastName: true, roomNumber: true, careLevel: true, allergies: true, dietRestriction: true, careDependencyLevel: true, codeStatus: true, notes: true, photoUrl: true, updatedAt: true } }),
    prisma.task.findMany({ where: taskWhere, take: 1000, orderBy: { dueDate: "asc" }, include: { resident: { select: { firstName: true, lastName: true, roomNumber: true } }, assignedTo: { include: { user: { select: { name: true } } } } } }),
    prisma.incident.findMany({ where: { ...tenant, ...(residentScope ? { residentId: { in: residentScope } } : {}), resolvedAt: null }, take: 500, orderBy: { incidentDate: "desc" }, include: { resident: { select: { firstName: true, lastName: true, roomNumber: true } } } }),
    prisma.callBell.findMany({ where: { ...tenant, ...(residentScope ? { residentId: { in: residentScope } } : {}), status: { in: ["PENDING", "RESPONDED"] } }, take: 300, orderBy: { createdAt: "desc" }, include: { resident: { select: { firstName: true, lastName: true, roomNumber: true } } } }),
    prisma.careEvent.findMany({ where: { ...tenant, ...(residentScope ? { residentId: { in: residentScope } } : {}), occurredAt: { gte: new Date(now.getTime() - 7 * 86400_000) } }, take: 2000, orderBy: { occurredAt: "desc" } }),
    prisma.escalation.findMany({ where: { ...tenant, ...(residentScope ? { residentId: { in: residentScope } } : {}), status: { in: OPEN_ESCALATIONS } }, take: 500, orderBy: { createdAt: "desc" }, include: { resident: { select: { firstName: true, lastName: true, roomNumber: true } } } }),
    prisma.timeTracking.findMany({
      where: { staff: tenant, startTime: { lt: shiftEnd }, OR: [{ endTime: null }, { endTime: { gte: shiftStart } }] },
      take: 500,
      select: { staffId: true, status: true, endTime: true, staff: { select: { position: true, user: { select: { name: true } } } } },
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
    role === "nurse"
      ? prisma.admission.findMany({
          where: { ...tenant, status: "IN_PROGRESS" },
          take: 200,
          orderBy: { updatedAt: "desc" },
          select: { id: true, firstName: true, lastName: true, currentStep: true, updatedAt: true },
        })
      : Promise.resolve([]),
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
  const shiftEvents = events.filter((item) => item.occurredAt >= shiftStart && item.occurredAt < shiftEnd);
  const varianceEvents = shiftEvents.filter((item) => item.isVariance || item.isException);
  const previousEvents = events.filter((item) => item.occurredAt >= previousShiftStart && item.occurredAt < shiftStart);
  const previousVariances = previousEvents.filter((item) => item.isVariance || item.isException);
  const previousMoment = new Date(shiftStart.getTime() - 1);
  const previousSchedules = schedules.filter((item) => item.date === localDateStr(previousMoment, timeZone) && item.shift === currentShiftKey(previousMoment));
  const previousCovered = new Set(previousSchedules.flatMap((item) => item.residentIds));
  const assessmentRecords = parseJsonArray<AssessmentV42>(settings.find((item) => item.key === ASSESSMENTS_V42_KEY)?.value);
  const planReviews = carePlans.filter((item) => item.status !== "ACTIVE" || (item.nextReviewDate && item.nextReviewDate <= new Date(now.getTime() + 7 * 86400_000)));

  const taskItems = openTasks.map((item) => taskItem(item, now, path, item.createdAt >= shiftStart));
  const incidentItems = incidents.map((item) => incidentItem(item, path, shiftStart));
  const escalationItems = escalations.map((item) => escalationItem(item, path, shiftStart, role === "nurse"));
  const bellItems = bells.map((item) => bellItem(item, path, shiftStart));
  const varianceItems = events.filter((item) => item.isVariance || item.reviewAlertRaised || item.immediateEscalation).map((item) => careEventItem(item, path, shiftStart));
  const residentWatch = watchItems(residents, incidents, escalations, events, path);
  const unassigned = taskItems.filter((item) => item.ownerLabel === "Unassigned");
  const activeAttendance = attendance.filter((item) => !item.endTime && item.status !== "ABSENT");

  const commonMetrics: DashboardMetric[] = [
    metric({ key: "care_delivery_on_time", label: "Care delivered this shift", numerator: completedShift.length, denominator: dueShift.length, numeratorLabel: "completed governed tasks", denominatorLabel: "tasks due in the active shift", definition: "Governed care tasks completed during the active shift divided by all governed tasks due in that shift.", window: shift.label, baseline: "Previous shift: " + percentageLabel(previousCompleted.length, previousDue.length), exclusions: ["Cancelled tasks"], sourceModels: ["Task"], href: moduleHref(path, "caredelivery") }),
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
  const summary = {
    activeResidents: residents.length, staffedNow: new Set(activeAttendance.map((item) => item.staffId)).size,
    caregiversPresent: new Set(activeAttendance
      .filter((item) => /caregiver|care aide|care assistant/i.test(item.staff.position))
      .map((item) => item.staffId)).size,
    pcgAssignments: shiftSchedules.filter((item) => item.private).length,
    newOrReturningResidents: activeAdmissions.length,
    nurseOnDuty: activeAttendance.find((item) => /nurse|clinical/i.test(item.staff.position))?.staff.user?.name,
    residentsCovered: Math.min(coveredIds.size, residents.length), residentsUncovered: Math.max(0, residents.length - coveredIds.size),
    openEscalations: escalations.length, overdueWork: overdueTasks.length,
    handoverStatus: latestHandover?.status || "NOT_STARTED", handoverId: latestHandover?.id, handoverLabel: latestHandover?.number,
  } as const;

  let sections: DashboardSection[] = [];
  let metrics = commonMetrics;

  if (role === "nurse") {
    const nurseSection = (key: NurseDashboardZoneKey, items: DashboardQueueItem[]) => {
      const copy = nurseDashboardZone(key);
      return section(copy.key, copy.title, copy.description, items, copy.emptyTitle, copy.emptyHint);
    };
    const presentStaffIds = new Set(activeAttendance.map((item) => item.staffId));
    const deploymentAssignments: DashboardQueueItem[] = shiftSchedules.map((assignment) => {
      const present = presentStaffIds.has(assignment.caregiverStaffId);
      const highCaseload = !assignment.private && assignment.residentIds.length > 6;
      const residentPreview = (assignment.residents || []).slice(0, 4).map((resident) =>
        resident.room ? `${resident.name} (Room ${resident.room})` : resident.name);
      const remaining = Math.max(0, assignment.residentIds.length - residentPreview.length);
      return {
        id: `deployment:${assignment.id}`, kind: assignment.private ? "Dedicated caregiver assignment" : "Caregiver assignment",
        priority: !present || highCaseload ? "P2" : "P3",
        state: !present || highCaseload ? "WATCH" : "STABLE",
        title: assignment.caregiverName || "Assigned caregiver",
        detail: [
          residentPreview.join(", "),
          remaining ? `+${remaining} more` : "",
          assignment.private ? "PCG / dedicated" : "Shared assignment",
        ].filter(Boolean).join(" · "),
        ownerLabel: assignment.caregiverName || "Assigned caregiver",
        reason: !present
          ? "The assigned caregiver is not confirmed present in the active attendance window."
          : highCaseload
            ? "The shared assignment exceeds the 1:6 reference and requires nurse review."
            : "Caregiver is present with an active resident assignment.",
        sourceType: "CaregiverSchedule", sourceId: assignment.id,
        sourceHref: "/nurse/caregiverschedule",
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
        sourceHref: "/nurse/caregiverschedule",
      }));
    const caregiverHelpIds = new Set(escalations
      .filter((item) => item.raisedByRole === "CAREGIVER" && item.assignedToRole === "NURSE")
      .map((item) => item.id));
    const helpRequests = escalationItems.filter((item) => caregiverHelpIds.has(item.sourceId));
    const deploymentItems = [...helpRequests, ...uncoveredResidents, ...unassigned, ...deploymentAssignments];
    const admissionWatchItems: DashboardQueueItem[] = activeAdmissions.map((admission) => ({
      id: `admission-watch:${admission.id}`, kind: "New admission / return", priority: "P3", state: "WATCH",
      title: [admission.firstName, admission.lastName].filter(Boolean).join(" ") || "Admission in progress",
      occurredAt: admission.updatedAt.toISOString(),
      detail: `Move-in workflow step ${admission.currentStep} of 8`,
      reason: "A new admission or return remains in progress and requires shift awareness.",
      sourceType: "Admission", sourceId: admission.id, sourceHref: "/nurse/prescreen",
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
    sections = [
      nurseSection("clinical-triage", clinicalTriage),
      nurseSection("caregiver-deployment", deploymentItems),
      nurseSection("shift-watchlist", [...residentWatch, ...admissionWatchItems]),
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
    const assessmentSignals = assessmentRecords.map((assessment) => {
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
    metrics = [commonMetrics[0], commonMetrics[1], commonMetrics[2], metric({
      key: "reviews_current", label: "Care plans current",
      numerator: Math.max(0, carePlans.length - planReviews.length), denominator: carePlans.length,
      numeratorLabel: "active plans not due for review", denominatorLabel: "active/draft plans in scope",
      definition: "Care plans that are active and not due for review within seven days.",
      window: "Current + next 7 days", sourceModels: ["CarePlan"], href: "/care_manager/careplans",
    })];
  } else if (role === "facility-admin") {
    sections = [
      section("facility-status", "Facility Status", "Highest-priority resident care and coverage exceptions.", [...bellItems, ...incidentItems, ...escalationItems].filter((item) => ["P1", "P2"].includes(item.priority)), "No critical facility exceptions"),
      section("care-quality", "Care Quality", "Delivery variances and overdue governed care.", [...varianceItems, ...taskItems.filter((item) => ["P1", "P2"].includes(item.priority))], "No care-quality exceptions"),
      section("safety", "Safety", "Open incidents and escalations by severity.", [...incidentItems, ...escalationItems], "No open safety events"),
      section("workforce", "Workforce Operations", "Unassigned work and coverage exceptions.", unassigned, "All active work has an owner"),
      section("continuity", "Handover & Continuity", "Carry-over and acceptance state across shifts.", carryOverItems, "No carried work in the latest handover"),
    ];
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

  return {
    role, ...TITLES[role], asOf: now.toISOString(), freshnessSeconds: 30, serviceContext: "FACILITY",
    shift, summary, metrics, sections,
    residentChoices: role === "caregiver" ? residents.map((resident) => ({ id: resident.id, label: residentLabel(resident), room: resident.roomNumber })) : undefined,
    warnings,
  };
}
