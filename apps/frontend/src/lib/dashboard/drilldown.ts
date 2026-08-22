import { prisma } from "@/lib/prisma";
import {
  CAREGIVER_SCHEDULE_KEY, currentShiftKey, localDateStr, parseSchedules, shiftWindow,
} from "@/lib/caregiverSchedule";
import type { TenantContext } from "@/lib/tenant";
import type { DashboardRole } from "./types";

export interface DrilldownRecord {
  id: string;
  label: string;
  detail?: string;
  occurredAt?: string;
  href: string;
  inNumerator: boolean;
}

export interface DashboardDrilldown {
  metricKey: string;
  asOf: string;
  numerator: number;
  denominator: number;
  records: DrilldownRecord[];
  truncated: boolean;
}

const pathFor = (role: DashboardRole) => ({
  nurse: "nurse", caregiver: "caregiver", "care-manager": "care_manager",
  "facility-admin": "facility_admin", "resident-coordinator": "resident_coordinator", professional: "physician",
}[role]);
const sourceBoard = (path: string, module: string) => {
  if (path === "caregiver" && module === "caredelivery") return "/caregiver/todayscare";
  if (path === "facility_admin") return `/facility_admin/${({ caredelivery: "tasks", caregiverschedule: "staff" } as Record<string, string>)[module] || module}`;
  if (path === "physician") return `/physician/${({ caredelivery: "reports", caregiverschedule: "reports" } as Record<string, string>)[module] || module}`;
  return `/${path}/${module}`;
};

const residentName = (resident: { firstName: string; lastName: string }) => `${resident.firstName} ${resident.lastName}`.trim();

export async function buildMetricDrilldown(
  context: TenantContext,
  role: DashboardRole,
  metricKey: string,
): Promise<DashboardDrilldown | null> {
  if (!context.organizationId || !context.communityId) return null;
  const now = new Date();
  const timeZone = process.env.FACILITY_TZ || "Asia/Manila";
  const shiftKey = currentShiftKey(now);
  const today = localDateStr(now, timeZone);
  let shiftDate = today;
  if (shiftKey === "NOC" && now.getHours() < 6) {
    const previous = new Date(now); previous.setDate(previous.getDate() - 1);
    shiftDate = localDateStr(previous, timeZone);
  }
  const window = shiftWindow(shiftDate, shiftKey);
  const tenant = { organizationId: context.organizationId, communityId: context.communityId };
  const path = pathFor(role);
  const residentScope = role === "caregiver" ? (context.caregiverResidentIds ?? []) : undefined;
  let records: DrilldownRecord[] = [];

  if (metricKey === "care_delivery_on_time") {
    const staff = role === "caregiver"
      ? await prisma.staff.findFirst({ where: { ...tenant, userId: context.userId }, select: { id: true } })
      : null;
    const tasks = await prisma.task.findMany({
      where: {
        ...tenant, status: { not: "CANCELLED" }, dueDate: { gte: window.start, lt: window.end },
        ...(residentScope ? { residentId: { in: residentScope }, assignedToId: staff?.id || "__none__" } : {}),
      },
      take: 1000, orderBy: { dueDate: "asc" },
      include: { resident: { select: { firstName: true, lastName: true } } },
    });
    records = tasks.map((task) => ({
      id: task.id, label: `${residentName(task.resident)} · ${task.title}`,
      detail: `Due ${task.dueDate.toISOString()} · ${String(task.status).toLowerCase().replaceAll("_", " ")}`,
      occurredAt: task.completedAt?.toISOString(), href: path === "caregiver" ? "/caregiver/todayscare" : sourceBoard(path, "caredelivery"),
      inNumerator: task.status === "COMPLETED",
    }));
  } else if (metricKey === "variance_free_delivery") {
    const events = await prisma.careEvent.findMany({
      where: { ...tenant, occurredAt: { gte: window.start, lt: window.end }, ...(residentScope ? { residentId: { in: residentScope } } : {}) },
      take: 1000, orderBy: { occurredAt: "desc" },
    });
    records = events.map((event) => ({
      id: event.id, label: `${event.residentName || "Resident"} · ${event.eventName || event.taskId || "Care event"}`,
      detail: event.outcome, occurredAt: event.occurredAt.toISOString(), href: sourceBoard(path, "caredelivery"),
      inNumerator: !event.isVariance && !event.isException,
    }));
  } else if (metricKey === "assignment_coverage") {
    const [residents, setting] = await Promise.all([
      prisma.resident.findMany({ where: { ...tenant, status: "ACTIVE" }, take: 1000, orderBy: { roomNumber: "asc" }, select: { id: true, firstName: true, lastName: true, roomNumber: true } }),
      prisma.appSetting.findFirst({ where: { ...tenant, key: CAREGIVER_SCHEDULE_KEY }, select: { value: true } }),
    ]);
    const covered = new Set(parseSchedules(setting?.value).filter((item) => item.date === today && item.shift === shiftKey).flatMap((item) => item.residentIds));
    records = residents.map((resident) => ({
      id: resident.id, label: residentName(resident), detail: resident.roomNumber ? `Room ${resident.roomNumber}` : undefined,
      href: sourceBoard(path, "caregiverschedule"), inNumerator: covered.has(resident.id),
    }));
  } else if (metricKey === "escalation_acknowledgement") {
    const escalations = await prisma.escalation.findMany({
      where: { ...tenant, status: { in: ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "ESCALATED"] } },
      take: 1000, orderBy: { createdAt: "desc" },
      include: { resident: { select: { firstName: true, lastName: true } } },
    });
    records = escalations.map((item) => ({
      id: item.id, label: `${residentName(item.resident)} · ${item.situation}`,
      detail: String(item.status).toLowerCase().replaceAll("_", " "), occurredAt: item.createdAt.toISOString(),
      href: `/${path}/escalations`, inNumerator: Boolean(item.acknowledgedAt),
    }));
  } else if (metricKey === "reviews_current") {
    const plans = await prisma.carePlan.findMany({
      where: { ...tenant, status: { in: ["ACTIVE", "DRAFT", "UNDER_REVIEW"] } }, take: 1000,
      orderBy: { updatedAt: "desc" }, include: { resident: { select: { firstName: true, lastName: true } } },
    });
    const reviewLimit = new Date(now.getTime() + 7 * 86400_000);
    records = plans.map((plan) => ({
      id: plan.id, label: `${residentName(plan.resident)} · ${plan.title}`,
      detail: plan.nextReviewDate ? `Review ${plan.nextReviewDate.toISOString()}` : String(plan.status),
      occurredAt: plan.updatedAt.toISOString(), href: "/care_manager/careplans",
      inNumerator: plan.status === "ACTIVE" && (!plan.nextReviewDate || plan.nextReviewDate > reviewLimit),
    }));
  } else if (role === "resident-coordinator" && metricKey === "coordination_owned") {
    const requests = await prisma.serviceRequest.findMany({
      where: { ...tenant, status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS"] } }, take: 1000,
      orderBy: { createdAt: "desc" }, include: { resident: { select: { firstName: true, lastName: true } } },
    });
    records = requests.map((item) => ({ id: item.id, label: `${residentName(item.resident)} · ${item.subType || item.category}`,
      detail: String(item.status), occurredAt: item.createdAt.toISOString(), href: "/resident_coordinator/coordination",
      inNumerator: Boolean(item.assignedTo || item.assignedTeam) }));
  } else if (role === "resident-coordinator" && metricKey === "transport_ready") {
    const transports = await prisma.transportRequest.findMany({
      where: { ...tenant, status: { notIn: ["COMPLETED", "CANCELLED", "DECLINED"] } }, take: 1000,
      orderBy: { requestedDate: "asc" }, include: { resident: { select: { firstName: true, lastName: true } } },
    });
    records = transports.map((item) => ({ id: item.id, label: `${residentName(item.resident)} · ${item.purpose || item.type}`,
      detail: String(item.status), occurredAt: item.requestedDate.toISOString(), href: "/resident_coordinator/schedule",
      inNumerator: item.status !== "PENDING" }));
  } else if (role === "resident-coordinator" && metricKey === "admissions_in_progress") {
    const admissions = await prisma.admission.findMany({ where: { ...tenant, status: "IN_PROGRESS" }, take: 1000, orderBy: { updatedAt: "desc" } });
    records = admissions.map((item) => ({ id: item.id, label: `${item.firstName} ${item.lastName}`,
      detail: `Step ${item.currentStep} of 8`, occurredAt: item.updatedAt.toISOString(), href: "/resident_coordinator/coordination", inNumerator: true }));
  } else {
    return null;
  }

  return {
    metricKey, asOf: now.toISOString(), numerator: records.filter((item) => item.inNumerator).length,
    denominator: records.length, records: records.slice(0, 500), truncated: records.length > 500,
  };
}
