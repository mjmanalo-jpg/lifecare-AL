import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext, requiresPrivilegedMfa } from "@/lib/tenant";
import { readPlanMeta, writePlanMeta, deletePlanMeta, DEFAULT_PLAN_META } from "@/lib/planMeta";
import { invalidatePortalData } from "@/lib/dataCache";

function invalidatePlanCaches() {
  invalidatePortalData("platform:plans");
  invalidatePortalData("platform:insights");
}

async function guard() {
  const context = await requireTenantContext({ allowPlatform: true });
  if (context && requiresPrivilegedMfa(context)) return { error: NextResponse.json({ error: "MFA required", code: "MFA_REQUIRED" }, { status: 403 }) };
  if (context?.platformRole !== "PLATFORM_ADMIN") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { context };
}

const numberOrNull = (value: unknown): number | null => (value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await guard();
  if (error) return error;
  const { id } = await params;
  const existing = await prisma.plan.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  const body = await request.json().catch(() => ({}));

  // Only apply the plan scalar fields that were actually supplied.
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if ("description" in body) data.description = body.description ? String(body.description) : null;
  if ("maxCommunities" in body) data.maxCommunities = numberOrNull(body.maxCommunities);
  if ("maxActiveResidents" in body) data.maxActiveResidents = numberOrNull(body.maxActiveResidents);
  if ("maxStaffSeats" in body) data.maxStaffSeats = numberOrNull(body.maxStaffSeats);
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;

  const plan = await prisma.plan.update({ where: { id }, data, include: { entitlements: true } });

  // Merge public metadata onto whatever is stored so a partial edit does not
  // wipe untouched fields.
  const current = (await readPlanMeta())[id] || DEFAULT_PLAN_META;
  await writePlanMeta(id, {
    priceMonthly: "priceMonthly" in body ? numberOrNull(body.priceMonthly) : current.priceMonthly,
    currency: "currency" in body ? body.currency : current.currency,
    public: "public" in body ? body.public : current.public,
    order: "order" in body ? numberOrNull(body.order) ?? current.order : current.order,
    tagline: "tagline" in body ? body.tagline : current.tagline,
    highlight: "highlight" in body ? body.highlight : current.highlight,
  });

  const meta = (await readPlanMeta())[id] || DEFAULT_PLAN_META;
  invalidatePlanCaches();
  return NextResponse.json({ plan: { ...plan, maxStorageBytes: plan.maxStorageBytes?.toString() || null, meta } });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await guard();
  if (error) return error;
  const { id } = await params;
  const plan = await prisma.plan.findUnique({ where: { id }, include: { _count: { select: { subscriptions: true } } } });
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  if (plan._count.subscriptions > 0) {
    return NextResponse.json({ error: `Cannot delete — ${plan._count.subscriptions} customer(s) are on this plan. Hide it from the landing page instead.`, code: "PLAN_IN_USE" }, { status: 409 });
  }
  await prisma.plan.delete({ where: { id } });
  await deletePlanMeta(id);
  invalidatePlanCaches();
  return NextResponse.json({ success: true });
}
