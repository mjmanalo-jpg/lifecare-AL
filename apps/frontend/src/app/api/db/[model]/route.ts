import { NextRequest, NextResponse } from "next/server";
import { getModel, isDbConfigured } from "@/lib/models";
import { getSession } from "@/lib/auth";
import { scopeWhere, scopeDemoRows } from "@/lib/scope";
import { DEMO } from "@/lib/demoData";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Generic collection endpoint backed by Prisma.
 *   GET  /api/db/:model?take=100&include=resident&f_status=ACTIVE&order=asc
 *   POST /api/db/:model            (body = record to create)
 *
 * Filters: any query param prefixed `f_` becomes an equality `where` clause.
 * Includes: comma-separated relation names via `include`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildQuery(url: URL, defaultOrderBy?: Record<string, any>) {
  const sp = url.searchParams;
  const take = Math.min(Math.max(Number(sp.get("take") ?? 200), 1), 1000);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {};
  sp.forEach((value, key) => {
    if (key.startsWith("f_")) {
      const field = key.slice(2);
      if (value === "true" || value === "false") where[field] = value === "true";
      else if (value === "null") where[field] = null;
      else where[field] = value;
    }
  });

  const includeParam = sp.get("include");
  const include = includeParam
    ? Object.fromEntries(includeParam.split(",").map((r) => [r.trim(), true]))
    : undefined;

  const orderDir = sp.get("order");
  const orderBy =
    orderDir && defaultOrderBy
      ? Object.fromEntries(Object.keys(defaultOrderBy).map((k) => [k, orderDir]))
      : defaultOrderBy;

  return { take, where, include, orderBy };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ model: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { model } = await params;
  const def = getModel(model);
  if (!def) return NextResponse.json({ error: `Unknown model '${model}'` }, { status: 404 });

  // No real database yet → serve demo data so the UI is fully populated.
  // Self-service roles are still scoped to the demo relative so the boundary shows.
  if (!isDbConfigured()) {
    const rows = scopeDemoRows(model, DEMO[model] ?? [], session.role, session.userId);
    return NextResponse.json({ data: rows, demo: true });
  }

  try {
    const { take, where, include, orderBy } = buildQuery(new URL(req.url), def.orderBy);

    // Self-service roles (FAMILY/RESIDENT) are restricted to their own resident(s).
    // AND the scope clause into whatever filters the client requested.
    const scope = await scopeWhere(model, session);
    const scopedWhere = scope ? { AND: [where, scope] } : where;

    let data = await def.delegate.findMany({
      where: scopedWhere,
      orderBy,
      take,
      ...(include ? { include } : {}),
    });

    // Auto-seed notifications for new/empty users to show active, dynamic interface
    if (model === "notifications" && data.length === 0 && session.userId) {
      const seeds = getSeedsForRole(session.role, session.userId);
      if (seeds.length > 0) {
        await prisma.notification.createMany({
          data: seeds,
        });
        // Refetch to get the newly created notifications
        data = await def.delegate.findMany({
          where: scopedWhere,
          orderBy,
          take,
          ...(include ? { include } : {}),
        });
      }
    }

    return NextResponse.json({ data, count: data.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ model: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = session.role;

  const { model } = await params;
  const def = getModel(model);
  if (!def) return NextResponse.json({ error: `Unknown model '${model}'` }, { status: 404 });

  // Self-service roles (FAMILY/RESIDENT) may only create the records their portal
  // legitimately produces (messages to staff, visit requests). Rest is staff-only.
  const SELF_SERVICE = role === "FAMILY" || role === "RESIDENT";
  const SELF_WRITABLE = new Set(["messages", "visits", "call-bells", "tasks", "transport-requests", "resident-goals", "medication-logs", "service-requests", "concierge-bookings", "resident-preferences", "event-attendances", "dining-reservations"]);
  if (SELF_SERVICE && !SELF_WRITABLE.has(model)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  // Demo mode: echo the payload back so the UI flow succeeds without a DB.
  if (!isDbConfigured()) {
    return NextResponse.json({ data: { id: `demo-${Date.now()}`, ...body }, demo: true }, { status: 201 });
  }

  try {
    const data = await def.delegate.create({ data: body });
    // Process auto-notifications asynchronously so it doesn't block the API response
    handleAutoNotification(model, data).catch((e) =>
      console.error("[route.ts:autoNotifyError]", e)
    );
    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Create failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// ── Seed Helpers ─────────────────────────────────────────────────────────────

function getSeedsForRole(role: string, userId: string) {
  const baseDate = new Date();
  const getPastTime = (msAgo: number) => new Date(baseDate.getTime() - msAgo);

  const H = 60 * 60 * 1000;
  const D = 24 * H;

  // Exact type strings matching NotificationType enum in schema
  switch (role) {
    case "SUPERADMIN":
      return [
        {
          userId,
          type: "SYSTEM_ALERT" as const,
          title: "System Health Optimal",
          message: "All microservices and database engines responding at optimal speed (45ms).",
          isRead: false,
          createdAt: getPastTime(10 * 1000),
          updatedAt: getPastTime(10 * 1000),
        },
        {
          userId,
          type: "SYSTEM_ALERT" as const,
          title: "Supabase Connection Healthy",
          message: "Realtime subscription pool contains 8 active channels.",
          isRead: false,
          createdAt: getPastTime(12 * H),
          updatedAt: getPastTime(12 * H),
        },
        {
          userId,
          type: "CALL_BELL" as const,
          title: "Emergency System Checked",
          message: "Successfully verified emergency call bell route and response protocols.",
          isRead: true,
          createdAt: getPastTime(1 * D),
          updatedAt: getPastTime(1 * D),
        },
      ];
    case "FACILITY_ADMIN":
      return [
        {
          userId,
          type: "SYSTEM_ALERT" as const,
          title: "Admissions Verification Pending",
          message: "Dorothy Hale is waiting for room allocation to complete step 8.",
          isRead: false,
          createdAt: getPastTime(15 * 1000),
          updatedAt: getPastTime(15 * 1000),
        },
        {
          userId,
          type: "INCIDENT_REPORT" as const,
          title: "Incident Logged",
          message: "Caregiver Caleb Randall logged a call bell response event in Room 305.",
          isRead: false,
          createdAt: getPastTime(2 * H),
          updatedAt: getPastTime(2 * H),
        },
        {
          userId,
          type: "TASK_ASSIGNMENT" as const,
          title: "Staff Shift Roster",
          message: "12 active care professionals have successfully clocked in for today's shifts.",
          isRead: true,
          createdAt: getPastTime(18 * H),
          updatedAt: getPastTime(18 * H),
        },
      ];
    case "PHYSICIAN":
      // Physician notifications are unique to the medical-authority role: orders
      // to approve & sign, care-team notes to co-sign, consults to answer, and
      // patients needing a physician assessment — not the nurse's bedside alerts.
      return [
        {
          userId,
          type: "MEDICATION_REMINDER" as const,
          title: "Order Awaiting Approval",
          message: "Apixaban 5mg for Margaret Wilson (Room 312) is pending your approval & e-signature.",
          isRead: false,
          createdAt: getPastTime(20 * 1000),
          updatedAt: getPastTime(20 * 1000),
        },
        {
          userId,
          type: "MESSAGE" as const,
          title: "Clinical Note to Co-sign",
          message: "Sarah Jenkins, RN submitted a clinical note for Arthur Pendelton (Room 302) awaiting your co-signature.",
          isRead: false,
          createdAt: getPastTime(2 * H),
          updatedAt: getPastTime(2 * H),
        },
        {
          userId,
          type: "SYSTEM_ALERT" as const,
          title: "New Consult Request",
          message: "Swallowing-assessment consult raised for Eleanor Fitzroy (Room 305) — awaiting your response.",
          isRead: false,
          createdAt: getPastTime(3 * H),
          updatedAt: getPastTime(3 * H),
        },
        {
          userId,
          type: "VITAL_ALERT" as const,
          title: "Patient Needs Assessment",
          message: "Margaret Wilson (Room 312) BP elevated at 165/95 — please review and direct care.",
          isRead: true,
          createdAt: getPastTime(6 * H),
          updatedAt: getPastTime(6 * H),
        },
      ];
    case "NURSE":
      return [
        {
          userId,
          type: "CALL_BELL" as const,
          title: "Emergency Call Bell: Room 302",
          message: "Arthur Pendelton triggered the room call bell. Assistance needed.",
          isRead: false,
          createdAt: getPastTime(8 * 1000),
          updatedAt: getPastTime(8 * 1000),
        },
        {
          userId,
          type: "VITAL_ALERT" as const,
          title: "Arthur SpO2 Dropped",
          message: "Oxygen saturation level dipped below 95% temporarily.",
          isRead: false,
          createdAt: getPastTime(1.5 * H),
          updatedAt: getPastTime(1.5 * H),
        },
        {
          userId,
          type: "INCIDENT_REPORT" as const,
          title: "Fall Heuristics Alert",
          message: "Room 305 vision feed triggered a potential balance loss warning.",
          isRead: true,
          createdAt: getPastTime(4 * H),
          updatedAt: getPastTime(4 * H),
        },
      ];
    case "CAREGIVER":
      return [
        {
          userId,
          type: "CALL_BELL" as const,
          title: "Call Bell: Room 302 Assistance",
          message: "Help requested with repositioning and physical comfort checks.",
          isRead: false,
          createdAt: getPastTime(12 * 1000),
          updatedAt: getPastTime(12 * 1000),
        },
        {
          userId,
          type: "TASK_ASSIGNMENT" as const,
          title: "Checklist Pending",
          message: "3 morning wellness and dietary tasks remain incomplete.",
          isRead: false,
          createdAt: getPastTime(1 * H),
          updatedAt: getPastTime(1 * H),
        },
        {
          userId,
          type: "SHIFT_REMINDER" as const,
          title: "Clock-In Reminder",
          message: "Afternoon shift starts in 30 minutes. Please prepare for shift handover.",
          isRead: true,
          createdAt: getPastTime(3 * H),
          updatedAt: getPastTime(3 * H),
        },
      ];
    case "FAMILY":
      return [
        {
          userId,
          type: "VITAL_ALERT" as const,
          title: "Relative Vitals Stable",
          message: "Arthur Pendelton's morning vitals registered healthy (BP 120/80).",
          isRead: false,
          createdAt: getPastTime(25 * 1000),
          updatedAt: getPastTime(25 * 1000),
        },
        {
          userId,
          type: "MEDICATION_REMINDER" as const,
          title: "Medications Administered",
          message: "Head Nurse Sarah Jenkins successfully administered daily blood pressure pills.",
          isRead: false,
          createdAt: getPastTime(2 * H),
          updatedAt: getPastTime(2 * H),
        },
        {
          userId,
          type: "MESSAGE" as const,
          title: "Daily Comfort Report",
          message: "Caleb Randall reports Arthur slept comfortably and participated in social games.",
          isRead: true,
          createdAt: getPastTime(5 * H),
          updatedAt: getPastTime(5 * H),
        },
      ];
    case "FLEET_MANAGEMENT":
      return [
        {
          userId,
          type: "TRANSPORT_UPDATE" as const,
          title: "New Transport Request",
          message: "Arthur Pendelton requested a dialysis run for tomorrow 8:00 AM — pending dispatcher review.",
          isRead: false,
          createdAt: getPastTime(12 * 1000),
          updatedAt: getPastTime(12 * 1000),
        },
        {
          userId,
          type: "SYSTEM_ALERT" as const,
          title: "Registration Expiring",
          message: "Wheelchair Van WV-001 registration expires in 14 days. Renew to stay compliant.",
          isRead: false,
          createdAt: getPastTime(3 * H),
          updatedAt: getPastTime(3 * H),
        },
        {
          userId,
          type: "TASK_ASSIGNMENT" as const,
          title: "Preventive Maintenance Due",
          message: "Shuttle SH-001 hits its 5,000 km service interval this week.",
          isRead: true,
          createdAt: getPastTime(1 * D),
          updatedAt: getPastTime(1 * D),
        },
      ];
    case "RESIDENT":
      return [
        {
          userId,
          type: "TASK_ASSIGNMENT" as const,
          title: "Physical Therapy Scheduled",
          message: "Your PT session with Caleb is scheduled for 2:00 PM today.",
          isRead: false,
          createdAt: getPastTime(35 * 1000),
          updatedAt: getPastTime(35 * 1000),
        },
        {
          userId,
          type: "MEDICATION_REMINDER" as const,
          title: "Medications Reminder",
          message: "Afternoon pills are scheduled in 15 minutes.",
          isRead: false,
          createdAt: getPastTime(50 * 1000),
          updatedAt: getPastTime(50 * 1000),
        },
        {
          userId,
          type: "MESSAGE" as const,
          title: "New Message from Sponsor",
          message: "John Pendelton shared a photo and message with your care dashboard.",
          isRead: true,
          createdAt: getPastTime(8 * H),
          updatedAt: getPastTime(8 * H),
        },
      ];
    default:
      return [];
  }
}

// ── Auto Notification Triggers ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleAutoNotification(model: string, data: any) {
  try {
    // 1. Call Bells Trigger
    if (model === "call-bells") {
      const staffUsers = await prisma.user.findMany({
        where: {
          role: { in: ["FACILITY_ADMIN", "NURSE", "CAREGIVER"] },
          isActive: true,
        },
        select: { id: true },
      });

      const resident = await prisma.resident.findUnique({
        where: { id: data.residentId },
        select: { firstName: true, lastName: true, roomNumber: true },
      });
      const name = resident ? `${resident.firstName} ${resident.lastName}` : "A resident";
      const room = resident ? `Room ${resident.roomNumber}` : "their room";

      await prisma.notification.createMany({
        data: staffUsers.map((u) => ({
          userId: u.id,
          type: "CALL_BELL",
          title: `Call Bell: ${name}`,
          message: `${name} in ${room} triggered the call bell: "${data.reason || "Assistance requested"}".`,
          relatedEntityId: data.id,
          relatedEntityType: "CallBell",
        })),
      });
    }

    // 2. Incidents Trigger
    if (model === "incidents") {
      const staffUsers = await prisma.user.findMany({
        where: {
          role: { in: ["SUPERADMIN", "FACILITY_ADMIN", "PHYSICIAN", "NURSE"] },
          isActive: true,
        },
        select: { id: true },
      });

      const resident = await prisma.resident.findUnique({
        where: { id: data.residentId },
        select: { firstName: true, lastName: true, roomNumber: true },
      });
      const name = resident ? `${resident.firstName} ${resident.lastName}` : "A resident";
      const room = resident ? `Room ${resident.roomNumber}` : "their room";

      await prisma.notification.createMany({
        data: staffUsers.map((u) => ({
          userId: u.id,
          type: "INCIDENT_REPORT",
          title: `Incident: ${data.incidentType} (${data.severity})`,
          message: `An incident was logged for ${name} in ${room}: "${data.description}".`,
          relatedEntityId: data.id,
          relatedEntityType: "Incident",
        })),
      });
    }

    // 3. Tasks Trigger
    if (model === "tasks" && data.assignedToId) {
      const staffMember = await prisma.staff.findUnique({
        where: { id: data.assignedToId },
        select: { userId: true },
      });

      if (staffMember?.userId) {
        const resident = await prisma.resident.findUnique({
          where: { id: data.residentId },
          select: { firstName: true, lastName: true },
        });
        const residentName = resident ? ` for ${resident.firstName} ${resident.lastName}` : "";

        await prisma.notification.create({
          data: {
            userId: staffMember.userId,
            type: "TASK_ASSIGNMENT",
            title: `New Task Assigned`,
            message: `You have been assigned a task: "${data.title}"${residentName}.`,
            relatedEntityId: data.id,
            relatedEntityType: "Task",
          },
        });
      }
    }

    // 4. Messages Trigger
    if (model === "messages") {
      const sender = await prisma.user.findUnique({
        where: { id: data.senderId },
        select: { name: true },
      });
      const senderName = sender?.name || "Someone";

      await prisma.notification.create({
        data: {
          userId: data.recipientId,
          type: "MESSAGE",
          title: `New Message from ${senderName}`,
          message: data.content.length > 80 ? `${data.content.substring(0, 80)}...` : data.content,
          relatedEntityId: data.id,
          relatedEntityType: "Message",
        },
      });
    }

    // 5. Transport Requests Trigger — alert dispatchers (fleet + facility admin)
    if (model === "transport-requests") {
      const dispatchUsers = await prisma.user.findMany({
        where: {
          role: { in: ["FLEET_MANAGEMENT", "FACILITY_ADMIN"] },
          isActive: true,
        },
        select: { id: true },
      });

      const resident = await prisma.resident.findUnique({
        where: { id: data.residentId },
        select: { firstName: true, lastName: true },
      });
      const name = resident ? `${resident.firstName} ${resident.lastName}` : "A resident";
      const isEmergency = data.priority === "EMERGENCY" || data.type === "EMERGENCY_TRANSFER";

      await prisma.notification.createMany({
        data: dispatchUsers.map((u) => ({
          userId: u.id,
          type: "TRANSPORT_UPDATE" as const,
          title: isEmergency
            ? `EMERGENCY Transport: ${name}`
            : `New Transport Request: ${name}`,
          message: `${name} requested ${String(data.type || "transport").replace(/_/g, " ").toLowerCase()} to "${data.destination}" — pending dispatcher review.`,
          relatedEntityId: data.id,
          relatedEntityType: "TransportRequest",
        })),
      });
    }

    // 6. Trips Trigger — notify the resident's sponsor + resident login of the schedule
    if (model === "trips") {
      const resident = await prisma.resident.findUnique({
        where: { id: data.residentId },
        select: { firstName: true, lastName: true, sponsorId: true, userId: true },
      });
      if (resident) {
        const name = `${resident.firstName} ${resident.lastName}`;
        const recipients = [resident.sponsorId, resident.userId].filter(Boolean) as string[];
        if (recipients.length) {
          const when = data.scheduledAt ? new Date(data.scheduledAt).toLocaleString() : "soon";
          await prisma.notification.createMany({
            data: recipients.map((uid) => ({
              userId: uid,
              type: "TRANSPORT_UPDATE" as const,
              title: `Transport Scheduled: ${name}`,
              message: `A trip to "${data.destination}" has been scheduled for ${when}. You'll be notified when the vehicle departs.`,
              relatedEntityId: data.id,
              relatedEntityType: "Trip",
            })),
          });
        }
      }
    }

    // 7. Service Requests Trigger — alert the hotel-services desk (facility admin + super admin)
    if (model === "service-requests") {
      const staffUsers = await prisma.user.findMany({
        where: {
          role: { in: ["FACILITY_ADMIN", "SUPERADMIN"] },
          isActive: true,
        },
        select: { id: true },
      });

      const resident = await prisma.resident.findUnique({
        where: { id: data.residentId },
        select: { firstName: true, lastName: true, roomNumber: true },
      });
      const name = resident ? `${resident.firstName} ${resident.lastName}` : "A resident";
      const room = resident?.roomNumber ? `Room ${resident.roomNumber}` : "their room";
      const isEmergency = data.priority === "EMERGENCY";
      const category = String(data.category || "service").replace(/_/g, " ").toLowerCase();

      await prisma.notification.createMany({
        data: staffUsers.map((u) => ({
          userId: u.id,
          type: "SERVICE_UPDATE" as const,
          title: isEmergency
            ? `EMERGENCY Service Ticket: ${name}`
            : `New Service Request: ${name}`,
          message: `${name} in ${room} requested ${category}${data.subType ? ` — ${data.subType}` : ""} (${String(data.priority || "ROUTINE").toLowerCase()} priority).`,
          relatedEntityId: data.id,
          relatedEntityType: "ServiceRequest",
        })),
      });
    }

    // 8. Concierge Bookings Trigger — alert the concierge desk (facility admin)
    if (model === "concierge-bookings") {
      const staffUsers = await prisma.user.findMany({
        where: {
          role: { in: ["FACILITY_ADMIN", "SUPERADMIN"] },
          isActive: true,
        },
        select: { id: true },
      });

      const resident = await prisma.resident.findUnique({
        where: { id: data.residentId },
        select: { firstName: true, lastName: true, roomNumber: true },
      });
      const name = resident ? `${resident.firstName} ${resident.lastName}` : "A resident";
      const when = data.scheduledAt ? new Date(data.scheduledAt).toLocaleString() : "soon";

      await prisma.notification.createMany({
        data: staffUsers.map((u) => ({
          userId: u.id,
          type: "SERVICE_UPDATE" as const,
          title: `Concierge Booking: ${name}`,
          message: `${name} requested "${data.serviceName || "a concierge service"}" for ${when} — pending confirmation.`,
          relatedEntityId: data.id,
          relatedEntityType: "ConciergeBooking",
        })),
      });
    }

    // 9. Announcements Trigger — fan out to the target audience live.
    if (model === "announcements" && data.autoNotify !== false && data.published !== false) {
      const audience = String(data.audience || "ALL");
      const roleMap: Record<string, string[]> = {
        ALL: ["SUPERADMIN", "FACILITY_ADMIN", "PHYSICIAN", "NURSE", "CAREGIVER", "FAMILY", "RESIDENT", "FLEET_MANAGEMENT", "DRIVER"],
        RESIDENTS: ["RESIDENT"],
        FAMILIES: ["FAMILY"],
        STAFF: ["SUPERADMIN", "FACILITY_ADMIN", "PHYSICIAN", "NURSE", "CAREGIVER"],
      };
      const roles = roleMap[audience] ?? roleMap.ALL;
      const users = await prisma.user.findMany({
        where: { role: { in: roles as never }, isActive: true },
        select: { id: true },
      });
      if (users.length) {
        await prisma.notification.createMany({
          data: users.map((u) => ({
            userId: u.id,
            type: "ANNOUNCEMENT" as const,
            title: String(data.title || "Announcement"),
            message: String(data.body || "").slice(0, 160),
            relatedEntityId: data.id,
            relatedEntityType: "Announcement",
          })),
        });
      }
    }

    // 10. Community Event Trigger — invite residents + their sponsors to new events.
    if (model === "community-events" && data.published !== false) {
      const users = await prisma.user.findMany({
        where: { role: { in: ["RESIDENT", "FAMILY"] }, isActive: true },
        select: { id: true },
      });
      if (users.length) {
        const when = data.startTime ? new Date(data.startTime).toLocaleString() : "soon";
        await prisma.notification.createMany({
          data: users.map((u) => ({
            userId: u.id,
            type: "EVENT_INVITE" as const,
            title: `New Event: ${data.title}`,
            message: `${data.title} — ${when}${data.location ? ` at ${data.location}` : ""}. RSVP in the Community tab.`,
            relatedEntityId: data.id,
            relatedEntityType: "CommunityEvent",
          })),
        });
      }
    }

    // 11. Dining Reservation Trigger — notify the kitchen/front desk (facility admin).
    if (model === "dining-reservations") {
      const staffUsers = await prisma.user.findMany({
        where: { role: { in: ["FACILITY_ADMIN", "SUPERADMIN"] }, isActive: true },
        select: { id: true },
      });
      const resident = await prisma.resident.findUnique({
        where: { id: data.residentId },
        select: { firstName: true, lastName: true },
      });
      const name = resident ? `${resident.firstName} ${resident.lastName}` : "A resident";
      const when = data.reservedAt ? new Date(data.reservedAt).toLocaleString() : "soon";
      if (staffUsers.length) {
        await prisma.notification.createMany({
          data: staffUsers.map((u) => ({
            userId: u.id,
            type: "SERVICE_UPDATE" as const,
            title: `Dining Reservation: ${name}`,
            message: `${name} reserved ${String(data.mealType || "a meal").toLowerCase()} for ${data.partySize || 1} at ${data.venue || "the dining room"} — ${when}.`,
            relatedEntityId: data.id,
            relatedEntityType: "DiningReservation",
          })),
        });
      }
    }

    // 12. Front Desk Arrival Trigger — alert the front desk (facility admin).
    if (model === "front-desk-visits") {
      const staffUsers = await prisma.user.findMany({
        where: { role: { in: ["FACILITY_ADMIN", "SUPERADMIN"] }, isActive: true },
        select: { id: true },
      });
      if (staffUsers.length) {
        const kind = String(data.visitType || "guest").replace(/_/g, " ").toLowerCase();
        await prisma.notification.createMany({
          data: staffUsers.map((u) => ({
            userId: u.id,
            type: "SERVICE_UPDATE" as const,
            title: `Front Desk: ${data.visitorName}`,
            message: `${data.visitorName} arrived (${kind})${data.roomNumber ? ` for Room ${data.roomNumber}` : ""} — awaiting check-in.`,
            relatedEntityId: data.id,
            relatedEntityType: "FrontDeskVisit",
          })),
        });
      }
    }

    // 13. SBAR Escalation Trigger — route to the assigned clinical role.
    if (model === "escalations") {
      const target = String(data.assignedToRole || "PHYSICIAN");
      // On-call escalations also loop in facility admins for coverage.
      const roles = target === "FACILITY_ADMIN"
        ? ["FACILITY_ADMIN", "SUPERADMIN"]
        : ["PHYSICIAN", "FACILITY_ADMIN"];
      const staffUsers = await prisma.user.findMany({
        where: { role: { in: roles as never }, isActive: true },
        select: { id: true },
      });
      const resident = await prisma.resident.findUnique({
        where: { id: data.residentId },
        select: { firstName: true, lastName: true, roomNumber: true },
      });
      const name = resident ? `${resident.firstName} ${resident.lastName}` : "A resident";
      const room = resident?.roomNumber ? `Room ${resident.roomNumber}` : "their room";
      const isEmergency = data.priority === "EMERGENCY";
      if (staffUsers.length) {
        await prisma.notification.createMany({
          data: staffUsers.map((u) => ({
            userId: u.id,
            type: "SBAR_ESCALATION" as const,
            title: isEmergency ? `EMERGENCY Escalation: ${name}` : `SBAR Escalation: ${name}`,
            message: `${data.raisedBy || "A clinician"} escalated ${name} (${room}), ${String(data.priority || "URGENT").toLowerCase()} priority: "${String(data.situation || "").slice(0, 120)}".`,
            relatedEntityId: data.id,
            relatedEntityType: "Escalation",
          })),
        });
      }
    }

    // 14. Vitals Trigger
    if (model === "vitals") {
      const staffUsers = await prisma.user.findMany({
        where: {
          role: { in: ["PHYSICIAN", "NURSE"] },
          isActive: true,
        },
        select: { id: true },
      });

      const resident = await prisma.resident.findUnique({
        where: { id: data.residentId },
        select: { firstName: true, lastName: true },
      });
      const name = resident ? `${resident.firstName} ${resident.lastName}` : "A resident";

      let isAbnormal = false;
      let alertMsg = "";
      if (data.type === "HEART_RATE") {
        const hr = parseInt(data.value);
        if (!isNaN(hr) && (hr > 100 || hr < 60)) {
          isAbnormal = true;
          alertMsg = `${name}'s heart rate is abnormal: ${data.value} bpm.`;
        }
      } else if (data.type === "OXYGEN") {
        const ox = parseInt(data.value);
        if (!isNaN(ox) && ox < 95) {
          isAbnormal = true;
          alertMsg = `${name}'s oxygen saturation is low: ${data.value}%.`;
        }
      } else if (data.type === "BLOOD_PRESSURE") {
        const parts = data.value.split("/");
        const sys = parseInt(parts[0]);
        if (!isNaN(sys) && (sys > 140 || sys < 90)) {
          isAbnormal = true;
          alertMsg = `${name}'s blood pressure is out of normal range: ${data.value}.`;
        }
      }

      if (isAbnormal) {
        await prisma.notification.createMany({
          data: staffUsers.map((u) => ({
            userId: u.id,
            type: "VITAL_ALERT",
            title: `Vitals Alert: ${name}`,
            message: alertMsg,
            relatedEntityId: data.id,
            relatedEntityType: "VitalsLog",
          })),
        });
      }
    }
  } catch (err) {
    console.error("Auto-notification error:", err);
  }
}

