import { NextRequest, NextResponse } from "next/server";
import { getModel, isDbConfigured } from "@/lib/models";
import { DEMO } from "@/lib/demoData";
import { requireTenantContext, isDeniedWhere, sanitizeTenantWrite, tenantWhere } from "@/lib/tenant";
import { assertMutationEntitled, EntitlementError } from "@/lib/entitlements";
import { logAudit, snapshot } from "@/lib/audit";
import { transactionDelegate, withTenantDb } from "@/lib/tenantDb";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPLICIT_ADMIN_MODELS = new Set(["organizations", "communities", "users", "plans", "subscriptions", "organization-memberships", "community-memberships", "invitations"]);
const SELF_PATCH_FIELDS: Record<string, Set<string>> = {
  messages: new Set(["isRead", "readAt"]),
  notifications: new Set(["isRead", "readAt"]),
  "call-bells": new Set(["status"]),
  "service-requests": new Set(["status", "rating", "ratingComment"]),
  "concierge-bookings": new Set(["status"]),
  "resident-preferences": new Set(["value", "notes", "isActive"]),
  "event-attendances": new Set(["status", "rating", "feedback"]),
  "dining-reservations": new Set(["status", "guestCount", "notes"]),
};

async function scopedRecord(model: string, id: string, context: Awaited<ReturnType<typeof requireTenantContext>>, include?: Record<string, boolean>) {
  if (!context) return null;
  const definition = getModel(model);
  const scope = tenantWhere(model, context);
  if (!definition || isDeniedWhere(scope)) return null;
  return withTenantDb(context, async (tx) => transactionDelegate(definition, tx).findFirst({ where: scope ? { AND: [{ id }, scope] } : { id }, ...(include ? { include } : {}) }));
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ model: string; id: string }> }) {
  const context = await requireTenantContext({ allowPlatform: true });
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { model, id } = await params;
  if (!getModel(model)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isDbConfigured()) {
    const row = (DEMO[model] || []).find((item) => item.id === id);
    return row ? NextResponse.json({ data: row, demo: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const includeParam = new URL(request.url).searchParams.get("include");
  const include = includeParam ? Object.fromEntries(includeParam.split(",").map((name) => name.trim()).filter((name) => /^[a-zA-Z][a-zA-Z0-9]*$/.test(name)).map((name) => [name, true])) : undefined;
  const data = await scopedRecord(model, id, context, include);
  return data ? NextResponse.json({ data }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ model: string; id: string }> }) {
  const context = await requireTenantContext({ allowPlatform: true });
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { model, id } = await params;
  const definition = getModel(model);
  if (!definition) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (EXPLICIT_ADMIN_MODELS.has(model)) return NextResponse.json({ error: "Use the dedicated administration API" }, { status: 403 });
  const existing = await scopedRecord(model, id, context);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json();
  let data = sanitizeTenantWrite(model, body, context);
  delete data.id;
  delete data.residentId;
  const selfService = context.role === "FAMILY" || context.role === "RESIDENT";
  if (selfService) {
    const allowed = SELF_PATCH_FIELDS[model];
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    data = Object.fromEntries(Object.entries(data).filter(([key]) => allowed.has(key)));
    if (model === "call-bells" && data.status !== "CANCELLED") return NextResponse.json({ error: "Only cancellation is allowed" }, { status: 403 });
    if (model === "concierge-bookings" && data.status !== "CANCELLED") return NextResponse.json({ error: "Only cancellation is allowed" }, { status: 403 });
    if (model === "service-requests") {
      const rating = Number(data.rating || 0);
      if (data.status !== "CONFIRMED" || rating < 1 || rating > 5 || existing.status !== "COMPLETED") return NextResponse.json({ error: "Only completed requests can be confirmed with a 1-5 rating" }, { status: 422 });
      data.rating = rating;
      data.confirmedAt = new Date();
    }
  }
  if (!Object.keys(data).length) return NextResponse.json({ error: "No permitted fields" }, { status: 422 });
  if (!isDbConfigured()) return NextResponse.json({ data: { id, ...data }, demo: true });

  try {
    if (context.organizationId) await assertMutationEntitled(context, model);
    const updated = await withTenantDb(context, async (tx) => transactionDelegate(definition, tx).update({ where: { id }, data }));

    // Approving/disapproving a staff member must also flip their login access:
    // the login gate + tenant context key off membership STATUS, not Staff.isApproved.
    // Without this, an "Approved" staff member is still told the account is pending.
    if (model === "staff" && "isApproved" in data) {
      const status = data.isApproved === true ? "ACTIVE" : "INVITED";
      const staffUserId = (updated as { userId?: string }).userId;
      if (staffUserId) {
        if (context.communityId) await prisma.communityMembership.updateMany({ where: { userId: staffUserId, communityId: context.communityId }, data: { status } });
        if (context.organizationId) await prisma.organizationMembership.updateMany({ where: { userId: staffUserId, organizationId: context.organizationId }, data: { status } });
      }
    }

    logAudit({ actorId: context.userId, actorRole: context.role, action: "UPDATE", entityType: model, entityId: id, organizationId: context.organizationId, communityId: context.communityId, before: snapshot(existing), after: snapshot(updated) });
    return NextResponse.json({ data: updated });
  } catch (error) {
    if (error instanceof EntitlementError) return NextResponse.json({ error: error.message, code: error.code }, { status: 403 });
    return NextResponse.json({ error: "Update failed" }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ model: string; id: string }> }) {
  const context = await requireTenantContext({ allowPlatform: true });
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (context.role === "FAMILY" || context.role === "RESIDENT") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { model, id } = await params;
  const definition = getModel(model);
  if (!definition || EXPLICIT_ADMIN_MODELS.has(model)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const existing = await scopedRecord(model, id, context);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isDbConfigured()) return NextResponse.json({ ok: true, demo: true });
  try {
    if (context.organizationId) await assertMutationEntitled(context, model);
    await withTenantDb(context, async (tx) => transactionDelegate(definition, tx).delete({ where: { id } }));
    logAudit({ actorId: context.userId, actorRole: context.role, action: "DELETE", entityType: model, entityId: id, organizationId: context.organizationId, communityId: context.communityId, before: snapshot(existing) });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof EntitlementError) return NextResponse.json({ error: error.message, code: error.code }, { status: 403 });
    return NextResponse.json({ error: "Delete failed" }, { status: 400 });
  }
}