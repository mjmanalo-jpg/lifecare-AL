import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext } from "@/lib/tenant";
import {
  BILLING_LIBRARY_KEY,
  parseTemplates,
  periodTag,
  recurringMarker,
  type ChargeTemplate,
} from "@/lib/billingLibrary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Recurring billing accrual — Automated Charge Capture (recurring side).
//
// For each ACTIVE resident, posts this month's recurring ServiceCharges (rent,
// monthly care fees) from the community's Charge Library templates that are
// flagged `recurring` and match the resident's care level ("ALL" = everyone).
// Idempotent: each recurring charge description carries a [auto:<tpl>:<period>]
// marker, so re-running never double-charges. Meant to run monthly (Vercel Cron)
// and is also pinged from the billing portal so it works in dev/demo.
// ─────────────────────────────────────────────────────────────

async function accrueForCommunity(organizationId: string, communityId: string) {
  const setting = await prisma.appSetting.findFirst({
    where: { key: BILLING_LIBRARY_KEY, organizationId, communityId },
    select: { value: true },
  });
  const templates = parseTemplates(setting?.value).filter((t) => t.recurring && t.amount > 0);
  if (!templates.length) return { created: 0, skipped: 0, residents: 0 };

  const residents = await prisma.resident.findMany({
    where: { communityId, status: "ACTIVE" },
    select: { id: true, careLevel: true },
  });
  if (!residents.length) return { created: 0, skipped: 0, residents: 0 };

  const now = new Date();
  const tag = periodTag(now);

  // Existing markers this month, so we never post a duplicate.
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const existing = await prisma.serviceCharge.findMany({
    where: { communityId, serviceDate: { gte: monthStart } },
    select: { description: true },
  });
  const seen = new Set(existing.map((c) => c.description));

  const toCreate: { organizationId: string; communityId: string; residentId: string; description: string; amount: number; category: string; serviceDate: Date }[] = [];
  let skipped = 0;

  for (const resident of residents) {
    const applicable = templates.filter(
      (t: ChargeTemplate) => t.careLevel === "ALL" || t.careLevel === String(resident.careLevel),
    );
    for (const t of applicable) {
      const marker = recurringMarker(t.id, tag);
      const description = `${t.name} ${marker}`;
      if (seen.has(description)) { skipped += 1; continue; }
      seen.add(description);
      toCreate.push({
        organizationId,
        communityId,
        residentId: resident.id,
        description,
        amount: t.amount,
        category: t.category,
        serviceDate: now,
      });
    }
  }

  if (toCreate.length) await prisma.serviceCharge.createMany({ data: toCreate });
  return { created: toCreate.length, skipped, residents: residents.length };
}

export async function POST(request: NextRequest) {
  // Vercel-cron (Bearer CRON_SECRET) accrues across all active communities.
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) {
    const communities = await prisma.community.findMany({ where: { isActive: true }, select: { id: true, organizationId: true } });
    let created = 0, skipped = 0;
    for (const c of communities) {
      if (!c.organizationId) continue;
      const r = await accrueForCommunity(c.organizationId, c.id).catch(() => ({ created: 0, skipped: 0, residents: 0 }));
      created += r.created; skipped += r.skipped;
    }
    return NextResponse.json({ ok: true, scope: "all", communities: communities.length, created, skipped });
  }

  // Signed-in billing/facility/super admin accrues their own community.
  const context = await requireTenantContext({ allowPlatform: true });
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["BILLING_ADMIN", "FACILITY_ADMIN", "SUPERADMIN", "ORGANIZATION_ADMIN"].includes(context.role) && !context.isPlatform) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!context.organizationId || !context.communityId) return NextResponse.json({ error: "Select a community" }, { status: 409 });

  const result = await accrueForCommunity(context.organizationId, context.communityId);
  return NextResponse.json({ ok: true, scope: "community", ...result });
}
