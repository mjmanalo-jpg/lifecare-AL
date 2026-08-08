import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDbConfigured } from "@/lib/models";
import { readPlanMeta, DEFAULT_PLAN_META } from "@/lib/planMeta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public (unauthenticated) read of the subscription plans the platform admin
// has created, so the marketing landing page can render a live Plans section.
// Only active + publicly-visible plans are returned, with public-safe fields.
export async function GET() {
  if (!isDbConfigured()) return NextResponse.json({ plans: [] });
  try {
    const [plans, meta] = await Promise.all([
      prisma.plan.findMany({ where: { isActive: true }, include: { entitlements: true }, orderBy: { name: "asc" } }),
      readPlanMeta(),
    ]);
    const out = plans
      .map((plan) => ({ plan, m: meta[plan.id] || DEFAULT_PLAN_META }))
      .filter(({ m }) => m.public)
      .sort((a, b) => a.m.order - b.m.order || a.plan.name.localeCompare(b.plan.name))
      .map(({ plan, m }) => ({
        id: plan.id,
        key: plan.key,
        name: plan.name,
        description: plan.description,
        maxCommunities: plan.maxCommunities,
        maxActiveResidents: plan.maxActiveResidents,
        maxStaffSeats: plan.maxStaffSeats,
        modules: plan.entitlements.filter((entitlement) => entitlement.enabled).length,
        priceMonthly: m.priceMonthly,
        currency: m.currency,
        tagline: m.tagline,
        highlight: m.highlight,
      }));
    return NextResponse.json({ plans: out });
  } catch {
    return NextResponse.json({ plans: [] });
  }
}
