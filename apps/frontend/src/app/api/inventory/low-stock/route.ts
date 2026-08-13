import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Real-time low / out-of-stock alert for a resident-medication inventory item.
 * Fired from the MAR when a dose drops stock below reorder. Keyed by the item so
 * it SUPERSEDES any prior alert (update-in-place) — the notification always shows
 * the CURRENT quantity rather than a stale periodic-cron snapshot. Delivered to the
 * care team (nurse / care manager / facility admin) of the caller's community.
 */
export async function POST(request: NextRequest) {
  const context = await requireTenantContext({});
  if (!context || !context.communityId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const itemId = String(body?.itemId || "");
  if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });

  const itemName = String(body?.itemName || "Item");
  const who = body?.residentName ? ` (${String(body.residentName)})` : "";
  const quantity = Number(body?.quantity) || 0;
  const unit = String(body?.unit || "");
  const reorder = Number(body?.reorder) || 0;
  const out = Boolean(body?.out) || quantity <= 0;
  const communityId = context.communityId;
  const relatedEntityId = `appinv:${itemId}`;

  const title = out ? "Out of stock" : "Low stock";
  const message = out
    ? `${itemName}${who} is OUT OF STOCK (reorder at ${reorder}). A purchase request has been auto-queued.`
    : `${itemName}${who} is low — ${quantity} ${unit || "left"} (reorder at ${reorder}).`;
  const severity = out ? "CRITICAL" : "WARNING";

  // Update the existing per-item alert in place (keeps ONE current notification and
  // re-surfaces it with the latest count); create it the first time it goes low.
  const updated = await prisma.notification.updateMany({
    where: { communityId, relatedEntityType: "inventoryItem", relatedEntityId },
    data: { title, message, severity, isRead: false, snoozedUntil: null },
  });
  if (updated.count === 0) {
    const recipients = await prisma.communityMembership.findMany({
      where: { communityId, status: "ACTIVE", role: { in: ["NURSE", "CARE_MANAGER", "FACILITY_ADMIN"] } },
      select: { userId: true },
    });
    const userIds = [...new Set(recipients.map((r) => r.userId))];
    if (userIds.length) {
      await prisma.notification.createMany({
        data: userIds.map((userId) => ({
          userId, type: "SYSTEM_ALERT" as never, title, message, severity,
          relatedEntityId, relatedEntityType: "inventoryItem",
          organizationId: context.organizationId, communityId,
        })),
      });
    }
  }
  return NextResponse.json({ ok: true });
}
