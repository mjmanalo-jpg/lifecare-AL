/**
 * Level-of-Care billing — server-side apply logic (prisma). Shared by the acuity
 * approval endpoint (`/api/billing/loc-charge`) and the monthly billing cron.
 */

import { prisma } from "@/lib/prisma";
import { LOC_PRICING_KEY, LOC_MARKER_PREFIX, parseLocPricing, locMarker, locNetAmount, clampPct, periodTag } from "./locBilling";

/**
 * Apply a resident's Level-of-Care monthly fee for the current period:
 *   • posts the fee for `level` (idempotent per resident/level/month), and
 *   • removes any *unbilled* loc fee already posted THIS month for a DIFFERENT
 *     level — so a re-assessment to a new level switches the charge instead of
 *     stacking. Already-invoiced charges are never touched.
 * Best-effort: callers should catch. Returns what happened.
 */
export async function applyResidentLocCharge(opts: {
  organizationId: string | null;
  communityId: string;
  residentId: string;
  level: number;
  now?: Date;
}): Promise<{ created: boolean; voided: number; skipped: boolean }> {
  const { organizationId, communityId, residentId, level } = opts;
  const now = opts.now ?? new Date();
  const tag = periodTag(now);

  const setting = await prisma.appSetting.findFirst({
    where: { key: LOC_PRICING_KEY, communityId },
    select: { value: true },
  });
  const pricing = parseLocPricing(setting?.value);
  const price = pricing.find((p) => p.level === level && p.active && p.amount > 0) ?? null;

  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const existing = await prisma.serviceCharge.findMany({
    where: { communityId, residentId, serviceDate: { gte: monthStart }, description: { contains: LOC_MARKER_PREFIX } },
    select: { id: true, description: true, invoiceId: true },
  });

  const wantMarker = locMarker(level, tag);
  const monthSuffix = `:${tag}]`;

  // Void this month's loc fees for a different level that haven't been invoiced.
  let voided = 0;
  for (const c of existing) {
    if (c.description.includes(wantMarker)) continue;   // correct-level fee — keep
    if (!c.description.includes(monthSuffix)) continue;  // a different month — leave
    if (c.invoiceId) continue;                           // already billed — don't touch
    await prisma.serviceCharge.delete({ where: { id: c.id } });
    voided++;
  }

  if (!price) return { created: false, voided, skipped: true };

  // Net fee after the level's percentage discount. A 100% discount (or ₱0 net)
  // posts no charge, same as an inactive level.
  const pct = clampPct(price.discountPct ?? 0);
  const net = locNetAmount(price);
  if (net <= 0) return { created: false, voided, skipped: true };

  // Marker-based idempotency (per resident/level/month) — robust even if the
  // label or discount changed after the fee was already posted this month.
  if (existing.some((c) => c.description.includes(wantMarker))) return { created: false, voided, skipped: true };

  const description = `${price.label}${pct > 0 ? ` (−${pct}% discount)` : ""} ${wantMarker}`;
  await prisma.serviceCharge.create({
    data: {
      organizationId: organizationId ?? undefined,
      communityId,
      residentId,
      description,
      amount: net,
      category: price.category,
      serviceDate: now,
    },
  });
  return { created: true, voided, skipped: false };
}
