import { NextRequest, NextResponse } from "next/server";
import { getModel, isDbConfigured } from "@/lib/models";
import { DEMO } from "@/lib/demoData";
import { scopeDemoRows } from "@/lib/scope";
import { requireTenantContext, isDeniedWhere, sanitizeTenantWrite, tenantWhere } from "@/lib/tenant";
import { assertMutationEntitled, EntitlementError } from "@/lib/entitlements";
import { logAudit, snapshot } from "@/lib/audit";
import { transactionDelegate, withTenantDb } from "@/lib/tenantDb";
import { prisma } from "@/lib/prisma";
import { invalidatePortalDataPrefix } from "@/lib/dataCache";
import { createMedTaskForSchedule } from "@/lib/medTaskSync";
import { canEditResidentProfile } from "@/lib/residentAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SELF_WRITABLE = new Set([
  "messages", "notifications", "visits", "call-bells", "tasks", "transport-requests",
  "resident-goals", "medication-logs", "service-requests", "concierge-bookings",
  "resident-preferences", "event-attendances", "dining-reservations",
  // Family/resident self-service: upload files + e-sign consent for their own
  // resident (the residentId guard scopes writes to their accessible resident).
  "resident-documents",
]);
const EXPLICIT_ADMIN_MODELS = new Set([
  "organizations", "communities", "users", "plans", "subscriptions",
  "organization-memberships", "community-memberships", "invitations",
]);

// Counts the org-admin overview derives from these tables (per-community
// residents / staff / rooms); drop the cached portal payload on changes so the
// Communities cards and usage stats reflect live data on the next poll.
const OVERVIEW_COUNT_MODELS = new Set(["residents", "rooms", "staff"]);

function buildQuery(url: URL, defaultOrderBy?: Record<string, unknown>) {
  const params = url.searchParams;
  const take = Math.min(Math.max(Number(params.get("take") || 200), 1), 500);
  const where: Record<string, unknown> = {};
  params.forEach((value, key) => {
    if (!key.startsWith("f_")) return;
    const field = key.slice(2);
    where[field] = value === "true" ? true : value === "false" ? false : value === "null" ? null : value;
  });
  const includeParam = params.get("include");
  const include = includeParam
    ? Object.fromEntries(includeParam.split(",").map((name) => name.trim()).filter((name) => /^[a-zA-Z][a-zA-Z0-9]*$/.test(name)).map((name) => [name, true]))
    : undefined;
  return { take, where, include, orderBy: defaultOrderBy };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ model: string }> }) {
  const context = await requireTenantContext({ allowPlatform: true });
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { model } = await params;
  const definition = getModel(model);
  if (!definition) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!isDbConfigured()) {
    const rows = scopeDemoRows(model, DEMO[model] || [], context.role, context.userId);
    return NextResponse.json({ data: rows, count: rows.length, demo: true });
  }

  const scope = tenantWhere(model, context);
  if (isDeniedWhere(scope)) return NextResponse.json({ data: [], count: 0 });
  const { take, where, include, orderBy } = buildQuery(new URL(request.url), definition.orderBy);
  try {
    const rows = await withTenantDb(context, async (tx) => transactionDelegate(definition, tx).findMany({
      where: scope ? { AND: [where, scope] } : where,
      take,
      ...(orderBy ? { orderBy } : {}),
      ...(include ? { include } : {}),
    }));
    // Never expose internal `__`-prefixed settings (e.g. signing-PIN hashes).
    const data = model === "app-settings"
      ? (rows as Array<{ key?: string; id: string }>).filter((r) => !String(r.key || r.id).startsWith("__"))
      : rows;
    return NextResponse.json({ data, count: data.length });
  } catch {
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

// Immediately notify the Care Manager + nurses of a SEVERE/CRITICAL incident so
// it appears in their Alert Center right away (with an SLA countdown), instead of
// waiting for the next alerts-cron tick. Best-effort — never blocks the create.
async function alertSevereIncident(
  context: NonNullable<Awaited<ReturnType<typeof requireTenantContext>>>,
  incident: Record<string, unknown>,
) {
  try {
    const severity = String(incident.severity ?? "");
    if (!context.communityId || !["SEVERE", "CRITICAL"].includes(severity)) return;
    const crit = severity === "CRITICAL";
    const recipients = await prisma.communityMembership.findMany({
      where: { communityId: context.communityId, status: "ACTIVE", role: { in: ["FACILITY_ADMIN", "NURSE"] } },
      select: { userId: true },
    });
    if (!recipients.length) return;
    const kind = String(incident.incidentType ?? "incident").replace(/_/g, " ").toLowerCase();
    await prisma.notification.createMany({
      data: recipients.map((m) => ({
        userId: m.userId,
        type: "INCIDENT_REPORT" as const,
        title: `${crit ? "Critical" : "Severe"} incident — ${kind}`,
        message: `A ${crit ? "critical" : "severe"} ${kind} incident was reported. Review immediately.`,
        // Both severe and critical incidents are alerted at CRITICAL level so
        // they surface prominently (top lane, 15-min SLA), not buried as warnings.
        severity: "CRITICAL",
        relatedEntityId: String(incident.id),
        relatedEntityType: "incident",
        organizationId: context.organizationId ?? null,
        communityId: context.communityId,
      })),
    });
  } catch (e) {
    console.error("[incident alert] failed:", e instanceof Error ? e.message : e);
  }
}

// When the fleet manager assigns a trip (creates a Trip with a driverId), ping
// the assigned driver so they know a new trip is waiting on their Trip Board.
// Drivers have no direct user link, so we resolve their login by matching the
// Driver's name (then email) to a community member. Best-effort — never blocks
// the create.
async function notifyDriverOfTrip(
  context: NonNullable<Awaited<ReturnType<typeof requireTenantContext>>>,
  trip: Record<string, unknown>,
) {
  try {
    const driverId = trip.driverId ? String(trip.driverId) : "";
    if (!driverId || !context.communityId) return;
    const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { name: true, email: true } });
    if (!driver) return;
    const dn = (driver.name ?? "").trim().toLowerCase();
    const de = (driver.email ?? "").trim().toLowerCase();
    if (!dn && !de) return;
    const members = await prisma.communityMembership.findMany({
      where: { communityId: context.communityId, status: "ACTIVE" },
      select: { user: { select: { id: true, name: true, email: true } } },
    });
    const target = members
      .map((m) => m.user)
      .find((u) => u && (((u.name ?? "").trim().toLowerCase() === dn) || (!!de && (u.email ?? "").trim().toLowerCase() === de)));
    if (!target) return;
    const when = trip.scheduledAt ? new Date(String(trip.scheduledAt)).toLocaleString() : "soon";
    await prisma.notification.create({
      data: {
        userId: target.id,
        type: "TRANSPORT_UPDATE" as const,
        title: "New trip assigned",
        message: `You've been assigned a trip to ${String(trip.destination ?? "a destination")} scheduled ${when}. Check your Trip Board.`,
        relatedEntityId: String(trip.id),
        relatedEntityType: "trip",
        organizationId: context.organizationId ?? null,
        communityId: context.communityId,
      },
    });
  } catch (e) {
    console.error("[trip assign notify] failed:", e instanceof Error ? e.message : e);
  }
}

// Real-time facility-operations alerts: when a resident/staff creates one of
// these operational records, notify facility admins immediately (instead of
// waiting for the alerts-cron tick). Same SYSTEM_ALERT + operational entity type
// the cron uses, so its dedup (type|id) won't double-fire. Best-effort.
const FACILITY_OPS_NOTIFY: Record<string, { entityType: string; build: (r: Record<string, unknown>) => { title: string; message: string } }> = {
  "dining-reservations": {
    entityType: "diningReservation",
    build: (r) => ({ title: "New dining reservation", message: `${String(r.mealType ?? "meal").toLowerCase()} · party of ${r.partySize ?? 1}${r.reservedAt ? ` — ${new Date(String(r.reservedAt)).toLocaleString()}` : ""}.` }),
  },
  "service-requests": {
    entityType: "serviceRequest",
    build: (r) => ({ title: "New service request", message: `${String(r.category ?? "service").replace(/_/g, " ").toLowerCase()} request submitted.` }),
  },
  "purchase-requests": {
    entityType: "purchaseRequest",
    build: (r) => ({ title: "Purchase request submitted", message: `${r.itemName ?? "Item"} ×${r.quantity ?? 1} is awaiting approval.` }),
  },
  "facility-maintenance": {
    entityType: "maintenance",
    build: (r) => ({ title: "New maintenance request", message: `${r.title ?? "Maintenance"}${r.scheduledDate ? ` — scheduled ${new Date(String(r.scheduledDate)).toLocaleDateString()}` : ""}.` }),
  },
  "concierge-bookings": {
    entityType: "conciergeBooking",
    build: (r) => ({ title: "New concierge booking", message: `${String(r.serviceType ?? r.category ?? "Booking")} requested.` }),
  },
};

async function notifyFacilityOps(
  context: NonNullable<Awaited<ReturnType<typeof requireTenantContext>>>,
  model: string,
  record: Record<string, unknown>,
) {
  try {
    const cfg = FACILITY_OPS_NOTIFY[model];
    if (!cfg || !context.communityId) return;
    const recipients = await prisma.communityMembership.findMany({
      where: { communityId: context.communityId, status: "ACTIVE", role: "FACILITY_ADMIN" },
      select: { userId: true },
    });
    if (!recipients.length) return;
    const { title, message } = cfg.build(record);
    await prisma.notification.createMany({
      data: recipients.map((m) => ({
        userId: m.userId,
        type: "SYSTEM_ALERT" as const,
        title,
        message,
        severity: "INFO",
        relatedEntityId: String(record.id),
        relatedEntityType: cfg.entityType,
        organizationId: context.organizationId ?? null,
        communityId: context.communityId,
      })),
    });
  } catch (e) {
    console.error("[facility ops notify] failed:", e instanceof Error ? e.message : e);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ model: string }> }) {
  const context = await requireTenantContext({ allowPlatform: true });
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { model } = await params;
  const definition = getModel(model);
  if (!definition) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (EXPLICIT_ADMIN_MODELS.has(model)) return NextResponse.json({ error: "Use the dedicated administration API" }, { status: 403 });
  const selfService = context.role === "FAMILY" || context.role === "RESIDENT";
  if (selfService && !SELF_WRITABLE.has(model)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!context.isPlatform && !context.communityId && model !== "app-settings") return NextResponse.json({ error: "Select a community" }, { status: 409 });
  // Module 01 — admitting a resident creates the master profile, so it is limited
  // to the profile-edit roles (Care Manager / Administrator).
  if (model === "residents" && !canEditResidentProfile(context.role, context.isPlatform)) {
    return NextResponse.json({ error: "Only a Care Manager or Administrator can admit or edit residents." }, { status: 403 });
  }

  const input = await request.json();
  if (typeof input !== "object" || !input || Array.isArray(input)) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  const data = sanitizeTenantWrite(model, input, context);
  // A present-but-empty residentId ("") is falsy, so the old truthiness check
  // skipped validation and let Prisma raise a raw foreign-key error. Validate
  // whenever a value is actually supplied (null/undefined still mean "omitted"),
  // and reject empties up front with a clean message.
  if (data.residentId !== undefined && data.residentId !== null && !context.isPlatform) {
    const residentId = String(data.residentId).trim();
    if (!residentId) return NextResponse.json({ error: "A resident must be selected" }, { status: 422 });
    const residentScope = tenantWhere("residents", context);
    const residentDefinition = getModel("residents")!;
    const resident = await withTenantDb(context, async (tx) => transactionDelegate(residentDefinition, tx).findFirst({ where: { AND: [{ id: residentId }, residentScope] }, select: { id: true } }));
    if (!resident) return NextResponse.json({ error: "Related resident not found" }, { status: 422 });
  }
  if (!isDbConfigured()) return NextResponse.json({ data: { id: `demo-${Date.now()}`, ...data }, demo: true }, { status: 201 });

  try {
    if (context.organizationId) await assertMutationEntitled(context, model);
    const created = await withTenantDb(context, async (tx) => transactionDelegate(definition, tx).create({ data }));
    if (OVERVIEW_COUNT_MODELS.has(model) && context.organizationId) invalidatePortalDataPrefix(`org-admin:${context.organizationId}:`);
    logAudit({
      actorId: context.userId,
      actorRole: context.role,
      action: "CREATE",
      entityType: model,
      entityId: created.id,
      organizationId: context.organizationId,
      communityId: context.communityId,
      after: snapshot(created),
    });
    // Severe/Critical incidents auto-alert the Care Manager (+ nurses) the moment
    // they're reported — they surface in the Alert Center with an SLA countdown.
    // The alerts cron dedups on INCIDENT_REPORT|<id>, so it won't double-fire.
    if (model === "incidents") await alertSevereIncident(context, created);
    // Assigning a trip to a driver notifies that driver of their new trip.
    if (model === "trips") await notifyDriverOfTrip(context, created);
    // Operational records (dining/service/purchase/maintenance/concierge)
    // notify facility admins in real time.
    if (FACILITY_OPS_NOTIFY[model]) await notifyFacilityOps(context, model, created);
    // A SCHEDULED dose opens an unassigned task for on-duty caregivers/nurses;
    // completing that task records the dose as GIVEN (see [id] PATCH hook).
    if (model === "medication-administrations") await createMedTaskForSchedule(context, created);
    return NextResponse.json({ data: created }, { status: 201 });
  } catch (error) {
    if (error instanceof EntitlementError) return NextResponse.json({ error: error.message, code: error.code }, { status: 403 });
    console.error(`[db POST ${model}] create failed:`, error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Create failed", detail }, { status: 400 });
  }
}