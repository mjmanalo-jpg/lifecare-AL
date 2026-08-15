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
import { ACUITY_ASSESSMENTS_KEY, parseAcuityItems, latestApprovedAcuityLevel } from "@/lib/locBilling";
import { applyResidentLocCharge } from "@/lib/locBillingServer";
import { PRIVATE_CARE_KEY, parsePrivateCare } from "@/lib/privateCaregiver";
import { applyPrivateCareCharge } from "@/lib/privateCaregiverServer";

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
  const residents = await prisma.resident.findMany({
    where: { communityId, status: "ACTIVE" },
    select: { id: true, careLevel: true },
  });
  if (!residents.length) return { created: 0, skipped: 0, residents: 0, loc: 0, pcg: 0 };

  const now = new Date();
  const tag = periodTag(now);

  // 1) Charge Library — recurring templates matched to each resident's care level.
  const setting = await prisma.appSetting.findFirst({
    where: { key: BILLING_LIBRARY_KEY, organizationId, communityId },
    select: { value: true },
  });
  const templates = parseTemplates(setting?.value).filter((t) => t.recurring && t.amount > 0);

  let created = 0;
  let skipped = 0;

  if (templates.length) {
    // Existing markers this month, so we never post a duplicate.
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const existing = await prisma.serviceCharge.findMany({
      where: { communityId, serviceDate: { gte: monthStart } },
      select: { description: true },
    });
    const seen = new Set(existing.map((c) => c.description));

    const toCreate: { organizationId: string; communityId: string; residentId: string; description: string; amount: number; category: string; serviceDate: Date }[] = [];
    for (const resident of residents) {
      const applicable = templates.filter(
        (t: ChargeTemplate) => t.careLevel === "ALL" || t.careLevel === String(resident.careLevel),
      );
      for (const t of applicable) {
        const marker = recurringMarker(t.id, tag);
        const description = `${t.name} ${marker}`;
        if (seen.has(description)) { skipped += 1; continue; }
        seen.add(description);
        toCreate.push({ organizationId, communityId, residentId: resident.id, description, amount: t.amount, category: t.category, serviceDate: now });
      }
    }
    if (toCreate.length) await prisma.serviceCharge.createMany({ data: toCreate });
    created = toCreate.length;
  }

  // 2) Level-of-Care fee — each resident's latest APPROVED acuity level → its
  //    monthly price. Idempotent per resident/level/month (shares the same marker
  //    as the approval-time post), and switches the fee if the level changed.
  let loc = 0;
  const acuitySetting = await prisma.appSetting.findFirst({
    where: { key: ACUITY_ASSESSMENTS_KEY, communityId },
    select: { value: true },
  });
  const acuityItems = parseAcuityItems(acuitySetting?.value);
  if (acuityItems.length) {
    for (const resident of residents) {
      const level = latestApprovedAcuityLevel(acuityItems, resident.id);
      if (level == null) continue;
      const r = await applyResidentLocCharge({ organizationId, communityId, residentId: resident.id, level, now }).catch(() => ({ created: false, voided: 0, skipped: true }));
      if (r.created) loc += 1;
    }
  }

  // 3) Private (1:1) caregiver — recurring flat fee for each ACTIVE assignment,
  //    billed to the resident (→ family sponsor by resident.sponsorId scoping).
  //    Idempotent per assignment/month via the [pcg:<id>:<period>] marker, so the
  //    same monthly charge posts once regardless of how often the cron runs.
  //    Per-day rates bill their 30-day monthly equivalent.
  let pcg = 0;
  const pcgSetting = await prisma.appSetting.findFirst({
    where: { key: PRIVATE_CARE_KEY, communityId },
    select: { value: true },
  });
  const pcgActive = parsePrivateCare(pcgSetting?.value).filter((a) => a.status === "ACTIVE");
  for (const assignment of pcgActive) {
    const posted = await applyPrivateCareCharge({ organizationId, communityId, assignment, now }).catch(() => false);
    if (posted) pcg += 1;
  }

  return { created, skipped, residents: residents.length, loc, pcg };
}

export async function POST(request: NextRequest) {
  // Vercel-cron (Bearer CRON_SECRET) accrues across all active communities.
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) {
    const communities = await prisma.community.findMany({ where: { isActive: true }, select: { id: true, organizationId: true } });
    let created = 0, skipped = 0, loc = 0, pcg = 0;
    for (const c of communities) {
      if (!c.organizationId) continue;
      const r = await accrueForCommunity(c.organizationId, c.id).catch(() => ({ created: 0, skipped: 0, residents: 0, loc: 0, pcg: 0 }));
      created += r.created; skipped += r.skipped; loc += r.loc; pcg += r.pcg;
    }
    return NextResponse.json({ ok: true, scope: "all", communities: communities.length, created, skipped, loc, pcg });
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
