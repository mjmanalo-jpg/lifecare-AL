import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext, requiresPrivilegedMfa } from "@/lib/tenant";
import { readPlanMeta, writePlanMeta, DEFAULT_PLAN_META } from "@/lib/planMeta";

export async function GET() {
  const context = await requireTenantContext({ allowPlatform: true });
  if (context && requiresPrivilegedMfa(context)) return NextResponse.json({ error: "MFA required", code: "MFA_REQUIRED" }, { status: 403 });
  if (!context?.platformRole) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [plans, meta] = await Promise.all([
    prisma.plan.findMany({ where: { isActive: true }, include: { entitlements: true }, orderBy: { name: "asc" } }),
    readPlanMeta(),
  ]);
  return NextResponse.json({ plans: plans.map((plan) => ({ ...plan, maxStorageBytes: plan.maxStorageBytes?.toString() || null, meta: meta[plan.id] || DEFAULT_PLAN_META })) });
}

export async function POST(request: NextRequest) {
  const context = await requireTenantContext({ allowPlatform: true });
  if (context && requiresPrivilegedMfa(context)) return NextResponse.json({ error: "MFA required", code: "MFA_REQUIRED" }, { status: 403 });
  if (context?.platformRole !== "PLATFORM_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json();
  const key = String(body.key || "").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  const name = String(body.name || "").trim();
  if (!key || !name) return NextResponse.json({ error: "Plan key and name are required" }, { status: 400 });
  try {
    const plan = await prisma.plan.create({ data: { key, name, description: body.description || null, maxCommunities: body.maxCommunities ?? null, maxActiveResidents: body.maxActiveResidents ?? null, maxStaffSeats: body.maxStaffSeats ?? null, maxStorageBytes: body.maxStorageBytes ? BigInt(body.maxStorageBytes) : null, entitlements: { create: Array.isArray(body.entitlements) ? body.entitlements.map((item: { featureKey: string; enabled?: boolean; limit?: number }) => ({ featureKey: item.featureKey, enabled: item.enabled !== false, limit: item.limit ?? null })) : [] } }, include: { entitlements: true } });
    // Persist the public-facing metadata (price, visibility, order, …) that the
    // landing page uses. Stored separately so it needs no schema migration.
    await writePlanMeta(plan.id, { priceMonthly: body.priceMonthly, currency: body.currency, public: body.public, order: body.order, tagline: body.tagline, highlight: body.highlight });
    return NextResponse.json({ plan: { ...plan, maxStorageBytes: plan.maxStorageBytes?.toString() || null, meta: { ...DEFAULT_PLAN_META, priceMonthly: body.priceMonthly ?? null } } }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Plan key already exists" }, { status: 409 });
  }
}