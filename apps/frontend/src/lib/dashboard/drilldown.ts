import { prisma } from "@/lib/prisma";
import {
  CAREGIVER_SCHEDULE_KEY, currentShiftKey, localDateStr, parseSchedules, shiftWindow,
} from "@/lib/caregiverSchedule";
import {
  ASSESSMENTS_V42_KEY, assessmentValidationIssues, classifyAssessment, type AssessmentV42,
} from "@/lib/lifecare/assessment";
import type { TenantContext } from "@/lib/tenant";
import type { DashboardRole } from "./types";

const parseAssessments = (raw?: string | null): AssessmentV42[] => {
  if (!raw) return [];
  try { const value = JSON.parse(raw); return Array.isArray(value) ? value : []; } catch { return []; }
};

type AssessmentSignalMeta = {
  assessment: AssessmentV42;
  classification: ReturnType<typeof classifyAssessment> | null;
  issues: ReturnType<typeof assessmentValidationIssues>;
};

/** Mirror of server.ts buildAssessmentSignals: classify + validate once per record. */
const buildSignals = (records: AssessmentV42[]): AssessmentSignalMeta[] =>
  records.map((assessment) => {
    try {
      return {
        assessment,
        classification: classifyAssessment(assessment),
        issues: assessmentValidationIssues({ ...assessment, layer3: assessment.layer3 || {} }),
      };
    } catch {
      return { assessment, classification: null, issues: [] as ReturnType<typeof assessmentValidationIssues> };
    }
  });

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

  if (metricKey === "care_delivery_on_time" || metricKey === "care_delivery_reliability") {
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
  } else if (metricKey === "care_plan_current") {
    const plans = await prisma.carePlan.findMany({
      where: { ...tenant, status: { in: ["ACTIVE", "DRAFT", "UNDER_REVIEW"] } }, take: 1000,
      orderBy: { updatedAt: "desc" }, include: { resident: { select: { firstName: true, lastName: true } } },
    });
    records = plans.map((plan) => ({
      id: plan.id, label: `${residentName(plan.resident)} · ${plan.title}`,
      detail: plan.nextReviewDate ? `Review ${plan.nextReviewDate.toISOString()}` : String(plan.status),
      occurredAt: plan.updatedAt.toISOString(), href: "/care_manager/careplans",
      inNumerator: plan.status === "ACTIVE" && (!plan.nextReviewDate || plan.nextReviewDate > now),
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
  } else if (metricKey === "assessment_current" || metricKey === "reassessment_on_time") {
    const [residents, setting] = await Promise.all([
      prisma.resident.findMany({ where: { ...tenant, status: "ACTIVE" }, take: 1000, orderBy: { roomNumber: "asc" }, select: { id: true, firstName: true, lastName: true, roomNumber: true } }),
      prisma.appSetting.findFirst({ where: { ...tenant, key: ASSESSMENTS_V42_KEY }, select: { value: true } }),
    ]);
    const signals = buildSignals(parseAssessments(setting?.value));
    const board = path === "facility_admin" ? "/facility_admin/rounds" : sourceBoard(path, "prescreen");
    if (metricKey === "assessment_current") {
      const validated = new Set(signals
        .filter(({ assessment }) => assessment.status === "VALIDATED" && assessment.layer1?.residentId)
        .map(({ assessment }) => assessment.layer1!.residentId as string));
      records = residents.map((resident) => ({
        id: resident.id, label: residentName(resident),
        detail: [resident.roomNumber ? `Room ${resident.roomNumber}` : "", validated.has(resident.id) ? "Validated v4.2 assessment on file" : "No current validated assessment"].filter(Boolean).join(" · "),
        href: board, inNumerator: validated.has(resident.id),
      }));
    } else {
      records = signals.flatMap(({ assessment }) => {
        const due = assessment.layer3?.nextReviewDate ? new Date(assessment.layer3.nextReviewDate) : null;
        if (!due || Number.isNaN(due.getTime())) return [];
        return [{
          id: assessment.id, label: assessment.layer1?.residentName || "Resident assessment",
          detail: `Reassessment due ${due.toISOString()}`, occurredAt: assessment.updatedAt || assessment.createdAt,
          href: board, inNumerator: due >= now,
        }];
      });
    }
  } else if (metricKey === "care_plan_current" || metricKey === "care_plan_backlog") {
    const plans = await prisma.carePlan.findMany({
      where: { ...tenant, status: { in: ["ACTIVE", "DRAFT", "UNDER_REVIEW"] } }, take: 1000,
      orderBy: { updatedAt: "desc" }, include: { resident: { select: { firstName: true, lastName: true } } },
    });
    const planBoard = sourceBoard(path, "careplans");
    if (metricKey === "care_plan_backlog") {
      records = plans.filter((plan) => plan.status !== "ACTIVE").map((plan) => ({
        id: plan.id, label: `${residentName(plan.resident)} · ${plan.title}`,
        detail: String(plan.status).toLowerCase().replaceAll("_", " "), occurredAt: plan.updatedAt.toISOString(),
        href: planBoard, inNumerator: true,
      }));
    } else {
      const covered = new Set(plans
        .filter((plan) => plan.status === "ACTIVE" && (!plan.nextReviewDate || plan.nextReviewDate >= now))
        .map((plan) => plan.residentId));
      const residents = await prisma.resident.findMany({ where: { ...tenant, status: "ACTIVE" }, take: 1000, orderBy: { roomNumber: "asc" }, select: { id: true, firstName: true, lastName: true, roomNumber: true } });
      records = residents.map((resident) => ({
        id: resident.id, label: residentName(resident),
        detail: [resident.roomNumber ? `Room ${resident.roomNumber}` : "", covered.has(resident.id) ? "Active plan within review date" : "No active plan within review date"].filter(Boolean).join(" · "),
        href: planBoard, inNumerator: covered.has(resident.id),
      }));
    }
  } else if (metricKey === "overdue_care_rate" || metricKey === "unassigned_care") {
    const tasks = await prisma.task.findMany({
      where: {
        ...tenant, status: { notIn: ["COMPLETED", "CANCELLED"] },
        OR: [{ status: { in: ["PENDING", "IN_PROGRESS"] } }, { dueDate: { gte: window.start, lt: window.end } }],
      },
      take: 1000, orderBy: { dueDate: "asc" },
      include: { resident: { select: { firstName: true, lastName: true } }, assignedTo: { include: { user: { select: { name: true } } } } },
    });
    const rows = metricKey === "unassigned_care"
      ? tasks.filter((task) => !task.assignedTo?.user?.name)
      : tasks;
    records = rows.map((task) => ({
      id: task.id, label: `${residentName(task.resident)} · ${task.title}`,
      detail: [`Owner ${task.assignedTo?.user?.name || "Unassigned"}`, `Due ${task.dueDate.toISOString()}`, String(task.status).toLowerCase().replaceAll("_", " ")].join(" · "),
      occurredAt: task.dueDate.toISOString(), href: sourceBoard(path, "caredelivery"),
      inNumerator: metricKey === "overdue_care_rate" ? task.dueDate < now : true,
    }));
  } else if (metricKey === "exception_event_rate") {
    const events = await prisma.careEvent.findMany({
      where: { ...tenant, occurredAt: { gte: window.start, lt: window.end } }, take: 1000, orderBy: { occurredAt: "desc" },
    });
    records = events.map((event) => ({
      id: event.id, label: `${event.residentName || "Resident"} · ${event.eventName || event.taskId || "Care event"}`,
      detail: event.exceptionDetail || event.observation || undefined, occurredAt: event.occurredAt.toISOString(),
      href: sourceBoard(path, "caredelivery"), inNumerator: Boolean(event.isVariance || event.isException),
    }));
  } else if (metricKey === "open_aged_escalations" || metricKey === "open_clinical_escalations") {
    const escalations = await prisma.escalation.findMany({
      where: { ...tenant, status: { in: ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "ESCALATED"] } }, take: 1000, orderBy: { createdAt: "desc" },
      include: { resident: { select: { firstName: true, lastName: true } } },
    });
    const board = path === "facility_admin" ? "/facility_admin/alertcenter" : sourceBoard(path, "escalations");
    records = escalations.map((item) => ({
      id: item.id, label: `${residentName(item.resident)} · ${item.situation}`,
      detail: `${String(item.priority).toLowerCase()} · ${String(item.status).toLowerCase().replaceAll("_", " ")}${item.acknowledgedAt ? "" : " · not acknowledged"}`,
      occurredAt: item.createdAt.toISOString(), href: board, inNumerator: true,
    }));
  } else if (metricKey === "safety_incidents") {
    const incidents = await prisma.incident.findMany({
      where: { ...tenant, resolvedAt: null }, take: 1000, orderBy: { incidentDate: "desc" },
      include: { resident: { select: { firstName: true, lastName: true } } },
    });
    records = incidents.map((incident) => ({
      id: incident.id, label: `${residentName(incident.resident)} · ${incident.title || String(incident.incidentType).toLowerCase().replaceAll("_", " ")}`,
      detail: incident.description || undefined, occurredAt: incident.incidentDate.toISOString(),
      href: sourceBoard(path, "incidents"), inNumerator: true,
    }));
  } else if (["hospital_ed", "hospital_ed_count", "dt013_utilization", "dt014_utilization", "dt013_review_load", "dt014_review_load"].includes(metricKey)) {
    const setting = await prisma.appSetting.findFirst({ where: { ...tenant, key: ASSESSMENTS_V42_KEY }, select: { value: true } });
    const signals = buildSignals(parseAssessments(setting?.value));
    const board = path === "facility_admin" ? "/facility_admin/rounds" : sourceBoard(path, "prescreen");
    if (metricKey === "hospital_ed" || metricKey === "hospital_ed_count") {
      // Care-manager hospital/ED tile links to the resident journey; facility to rounds.
      const href = metricKey === "hospital_ed_count" ? `/${path}/residentjourney` : board;
      records = signals.filter(({ assessment }) => Boolean(assessment.context?.recentHospitalization)).map(({ assessment }) => ({
        id: assessment.id, label: assessment.layer1?.residentName || "Resident",
        detail: "Recent hospitalization · post-return monitoring required", occurredAt: assessment.updatedAt || assessment.createdAt,
        href, inNumerator: true,
      }));
    } else {
      const isDt013 = metricKey === "dt013_utilization" || metricKey === "dt013_review_load";
      const href = metricKey === "dt013_review_load" ? `/${path}/privatecare`
        : metricKey === "dt014_review_load" ? `/${path}/additionalservices`
        : sourceBoard(path, "careplans");
      records = signals
        .filter(({ classification }: AssessmentSignalMeta) => (isDt013 ? classification?.dt013?.recommendReview : classification?.dt014?.recommendReview))
        .map(({ assessment }) => ({
          id: assessment.id, label: assessment.layer1?.residentName || "Resident",
          detail: isDt013 ? "Dedicated-support review indicated (DT-013)" : "Additional-service review indicated (DT-014)",
          occurredAt: assessment.updatedAt || assessment.createdAt, href, inNumerator: true,
        }));
    }
  } else if (metricKey === "shared_staffing_exceptions") {
    const setting = await prisma.appSetting.findFirst({ where: { ...tenant, key: CAREGIVER_SCHEDULE_KEY }, select: { value: true } });
    records = parseSchedules(setting?.value)
      .filter((item) => item.date === today && item.shift === shiftKey && item.residentIds.length > 6)
      .map((item) => ({
        id: item.id, label: `${item.caregiverName || "Caregiver"} · ${item.residentIds.length} residents`,
        detail: `${item.private ? "PCG / dedicated" : "Shared"} assignment exceeds the 1:6 reference`,
        href: sourceBoard(path, "staff"), inNumerator: true,
      }));
  } else if (metricKey === "audit_exceptions") {
    const [setting, escalations] = await Promise.all([
      prisma.appSetting.findFirst({ where: { ...tenant, key: ASSESSMENTS_V42_KEY }, select: { value: true } }),
      prisma.escalation.findMany({
        where: { ...tenant, status: { in: ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "ESCALATED"] }, acknowledgedAt: null },
        take: 500, orderBy: { createdAt: "desc" },
        include: { resident: { select: { firstName: true, lastName: true } } },
      }),
    ]);
    const governanceRecords: DrilldownRecord[] = buildSignals(parseAssessments(setting?.value))
      .filter(({ assessment, issues }) => issues.length > 0 || assessment.status === "COMPLETED")
      .map(({ assessment, issues }) => ({
        id: assessment.id, label: assessment.layer1?.residentName || "Resident assessment",
        detail: [
          assessment.status === "COMPLETED" ? "Final LOC awaiting authorized sign-off" : "",
          issues.length ? `${issues.length} validation gate${issues.length === 1 ? "" : "s"} open` : "",
        ].filter(Boolean).join(" · ") || "Governance exception",
        occurredAt: assessment.updatedAt || assessment.createdAt, href: sourceBoard(path, "auditlog"), inNumerator: true,
      }));
    const escalationRecords: DrilldownRecord[] = escalations.map((item) => ({
      id: item.id, label: `${residentName(item.resident)} · ${item.situation}`,
      detail: "Open escalation not yet acknowledged", occurredAt: item.createdAt.toISOString(),
      href: path === "facility_admin" ? "/facility_admin/alertcenter" : sourceBoard(path, "escalations"), inNumerator: true,
    }));
    records = [...governanceRecords, ...escalationRecords];
  } else if (metricKey === "loc_mix") {
    // §7.1 — per-resident Final LOC coverage behind the LOC-mix tile.
    const [residents, setting] = await Promise.all([
      prisma.resident.findMany({ where: { ...tenant, status: "ACTIVE" }, take: 1000, orderBy: { roomNumber: "asc" }, select: { id: true, firstName: true, lastName: true, roomNumber: true } }),
      prisma.appSetting.findFirst({ where: { ...tenant, key: ASSESSMENTS_V42_KEY }, select: { value: true } }),
    ]);
    const finalLevels = new Map<string, string>();
    for (const signal of buildSignals(parseAssessments(setting?.value))) {
      const residentId = signal.assessment.layer1?.residentId;
      const level = signal.assessment.layer3?.finalLevel;
      if (residentId && level) finalLevels.set(String(residentId), String(level));
    }
    const board = path === "facility_admin" ? "/facility_admin/rounds" : sourceBoard(path, "prescreen");
    records = residents.map((resident) => {
      const level = finalLevels.get(resident.id);
      return {
        id: resident.id, label: residentName(resident),
        detail: [
          resident.roomNumber ? `Room ${resident.roomNumber}` : "",
          level ? `Final LOC ${level}` : "No Final LOC on file",
        ].filter(Boolean).join(" · "),
        href: board, inNumerator: Boolean(level),
      };
    });
  } else if (metricKey === "census_occupancy") {
    // §7.1 — occupied beds vs approved capacity behind the census tile.
    const [residents, rooms] = await Promise.all([
      prisma.resident.findMany({ where: { ...tenant, status: "ACTIVE" }, take: 1000, orderBy: { roomNumber: "asc" }, select: { id: true, firstName: true, lastName: true, roomNumber: true } }),
      prisma.room.findMany({ where: tenant, select: { id: true, roomNumber: true, capacity: true } }),
    ]);
    const board = path === "facility_admin" ? "/facility_admin/occupancy" : sourceBoard(path, "residents");
    const occupied: DrilldownRecord[] = residents.map((resident) => ({
      id: resident.id, label: residentName(resident),
      detail: [resident.roomNumber ? `Room ${resident.roomNumber}` : "", "Occupied"].filter(Boolean).join(" · "),
      href: board, inNumerator: true,
    }));
    const capacity = rooms.reduce((sum, room) => sum + (room.capacity || 0), 0);
    const vacantBeds = Math.max(0, capacity - residents.length);
    const vacancies: DrilldownRecord[] = Array.from({ length: vacantBeds }, (_, index) => ({
      id: `vacant-bed-${index + 1}`, label: `Vacant bed ${index + 1}`,
      detail: "Approved capacity not filled", href: board, inNumerator: false,
    }));
    records = [...occupied, ...vacancies];
  } else if (metricKey === "active_coc") {
    // §6.1 — residents flagged with acute instability (temporary COC monitoring).
    const setting = await prisma.appSetting.findFirst({ where: { ...tenant, key: ASSESSMENTS_V42_KEY }, select: { value: true } });
    records = buildSignals(parseAssessments(setting?.value))
      .filter(({ assessment }) => Boolean(assessment.context?.acuteInstability))
      .map(({ assessment }) => ({
        id: assessment.id, label: assessment.layer1?.residentName || "Resident",
        detail: "Acute instability · temporary change-of-condition monitoring",
        occurredAt: assessment.updatedAt || assessment.createdAt,
        href: path === "facility_admin" ? "/facility_admin/rounds" : `/${path}/caredelivery`, inNumerator: true,
      }));
  } else if (metricKey === "repeated_variance_rate") {
    // §6.1 — residents with ≥2 variances on the same care task ÷ residents with any variance.
    const events = await prisma.careEvent.findMany({
      where: { ...tenant, OR: [{ isVariance: true }, { isException: true }, { reviewAlertRaised: true }, { immediateEscalation: true }] },
      take: 2000, orderBy: { occurredAt: "desc" },
      select: { id: true, residentId: true, residentName: true, taskId: true, bundle: true, domain: true },
    });
    const buckets = new Map<string, number>();
    const byResident = new Map<string, { name: string; total: number }>();
    for (const ev of events) {
      if (!ev.residentId) continue;
      const info = byResident.get(ev.residentId) || { name: ev.residentName || "Resident", total: 0 };
      info.total += 1; byResident.set(ev.residentId, info);
      const key = `${ev.residentId}:${ev.taskId || ev.bundle || ev.domain || "unattributed"}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    const repeatResidents = new Set([...buckets].filter(([, count]) => count >= 2).map(([key]) => key.split(":")[0]));
    records = [...byResident].map(([residentId, info]) => ({
      id: residentId, label: info.name,
      detail: `${info.total} variance event${info.total === 1 ? "" : "s"}${repeatResidents.has(residentId) ? " · repeats on the same care task" : ""}`,
      href: `/${path}/caredelivery`, inNumerator: repeatResidents.has(residentId),
    }));
  } else if (metricKey === "burden_variance") {
    // §6.1 — observed care-event variance (numerator) against active approved plans
    // (denominator context). Review alert only; never auto-changes LOC/fees.
    const [plans, events] = await Promise.all([
      prisma.carePlan.findMany({ where: { ...tenant, status: "ACTIVE" }, take: 1000, orderBy: { updatedAt: "desc" }, include: { resident: { select: { firstName: true, lastName: true } } } }),
      prisma.careEvent.findMany({ where: { ...tenant, occurredAt: { gte: window.start, lt: window.end }, OR: [{ isVariance: true }, { isException: true }] }, take: 1000, orderBy: { occurredAt: "desc" } }),
    ]);
    const observed: DrilldownRecord[] = events.map((ev) => ({
      id: `event-${ev.id}`, label: `${ev.residentName || "Resident"} · ${ev.eventName || ev.taskId || "Care event"}`,
      detail: `Observed delivery variance${ev.outcome ? ` · ${ev.outcome}` : ""}`, occurredAt: ev.occurredAt.toISOString(),
      href: `/${path}/caredelivery`, inNumerator: true,
    }));
    const planned: DrilldownRecord[] = plans.map((plan) => ({
      id: `plan-${plan.id}`, label: `${residentName(plan.resident)} · ${plan.title}`,
      detail: "Active approved plan (planned burden)", occurredAt: plan.updatedAt.toISOString(),
      href: `/${path}/careplans`, inNumerator: false,
    }));
    records = [...observed, ...planned];
  } else if (metricKey === "competency_currency") {
    // §6.1 — staff competencies that are unverified or past expiry (assignment-gating).
    const comps = await prisma.staffCompetency.findMany({
      where: { staff: tenant }, take: 2000, orderBy: { expiryDate: "asc" },
      include: { staff: { include: { user: { select: { name: true } } } }, competency: { select: { name: true } } },
    });
    records = comps.map((comp) => {
      const expired = comp.expiryDate ? comp.expiryDate < now : false;
      return {
        id: comp.id, label: `${comp.staff?.user?.name || "Staff"} · ${comp.competency?.name || "Competency"}`,
        detail: [!comp.verified ? "Unverified" : "", expired ? `Expired ${comp.expiryDate!.toISOString().slice(0, 10)}` : comp.expiryDate ? `Valid to ${comp.expiryDate.toISOString().slice(0, 10)}` : "No expiry recorded"].filter(Boolean).join(" · "),
        href: `/${path}/staffprofiles`, inNumerator: !comp.verified || expired,
      };
    });
  } else if (metricKey === "review_turnaround") {
    // §6.1 — routed review triggers with elapsed time to nurse acknowledgement.
    const escalations = await prisma.escalation.findMany({
      where: { ...tenant, status: { in: ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "ESCALATED"] } },
      take: 1000, orderBy: { createdAt: "desc" }, include: { resident: { select: { firstName: true, lastName: true } } },
    });
    records = escalations.map((item) => {
      const acknowledged = Boolean(item.acknowledgedAt);
      const hours = acknowledged ? Math.round((new Date(item.acknowledgedAt as Date).getTime() - new Date(item.createdAt).getTime()) / 3600_000) : null;
      return {
        id: item.id, label: `${residentName(item.resident)} · ${item.situation}`,
        detail: acknowledged ? `${hours}h from trigger to acknowledgement` : "Awaiting nurse acknowledgement",
        occurredAt: item.createdAt.toISOString(), href: `/${path}/escalations`, inNumerator: acknowledged,
      };
    });
  } else {
    return null;
  }

  return {
    metricKey, asOf: now.toISOString(), numerator: records.filter((item) => item.inNumerator).length,
    denominator: records.length, records: records.slice(0, 500), truncated: records.length > 500,
  };
}
