import { NextRequest, NextResponse } from "next/server";
import { getModel, isDbConfigured } from "@/lib/models";
import { DEMO } from "@/lib/demoData";
import { scopeDemoRows } from "@/lib/scope";
import { requireTenantContext, isDeniedWhere, sanitizeTenantWrite, tenantWhere } from "@/lib/tenant";
import { assertMutationEntitled, EntitlementError } from "@/lib/entitlements";
import { logAudit, snapshot } from "@/lib/audit";
import { transactionDelegate, withTenantDb } from "@/lib/tenantDb";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SELF_WRITABLE = new Set([
  "messages", "notifications", "visits", "call-bells", "tasks", "transport-requests",
  "resident-goals", "medication-logs", "service-requests", "concierge-bookings",
  "resident-preferences", "event-attendances", "dining-reservations",
]);
const EXPLICIT_ADMIN_MODELS = new Set([
  "organizations", "communities", "users", "plans", "subscriptions",
  "organization-memberships", "community-memberships", "invitations",
]);

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
    const data = await withTenantDb(context, async (tx) => transactionDelegate(definition, tx).findMany({
      where: scope ? { AND: [where, scope] } : where,
      take,
      ...(orderBy ? { orderBy } : {}),
      ...(include ? { include } : {}),
    }));
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

  const input = await request.json();
  if (typeof input !== "object" || !input || Array.isArray(input)) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  const data = sanitizeTenantWrite(model, input, context);
  if (data.residentId && !context.isPlatform) {
    const residentScope = tenantWhere("residents", context);
    const residentDefinition = getModel("residents")!;
    const resident = await withTenantDb(context, async (tx) => transactionDelegate(residentDefinition, tx).findFirst({ where: { AND: [{ id: String(data.residentId) }, residentScope] }, select: { id: true } }));
    if (!resident) return NextResponse.json({ error: "Related resident not found" }, { status: 422 });
  }
  if (!isDbConfigured()) return NextResponse.json({ data: { id: `demo-${Date.now()}`, ...data }, demo: true }, { status: 201 });

  try {
    if (context.organizationId) await assertMutationEntitled(context, model);
    const created = await withTenantDb(context, async (tx) => transactionDelegate(definition, tx).create({ data }));
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
    return NextResponse.json({ data: created }, { status: 201 });
  } catch (error) {
    if (error instanceof EntitlementError) return NextResponse.json({ error: error.message, code: error.code }, { status: 403 });
    console.error(`[db POST ${model}] create failed:`, error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Create failed", detail }, { status: 400 });
  }
}