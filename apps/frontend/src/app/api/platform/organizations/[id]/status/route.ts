import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext, requiresPrivilegedMfa } from "@/lib/tenant";
import { readSubscriptionBilling, writeSubscriptionBilling } from "@/lib/subscriptionBilling";

const ALLOWED = new Set(["ACTIVE", "SUSPENDED", "ARCHIVED"]);
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireTenantContext({ allowPlatform: true });
  if (context && requiresPrivilegedMfa(context)) return NextResponse.json({ error: "MFA required", code: "MFA_REQUIRED" }, { status: 403 });
  if (context?.platformRole !== "PLATFORM_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const { status } = await request.json();
  if (!ALLOWED.has(status)) return NextResponse.json({ error: "Invalid organization status" }, { status: 422 });
  const organization = await prisma.organization.update({ where: { id }, data: { status, isActive: status === "ACTIVE" } }).catch(() => null);
  if (!organization) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  if (status === "SUSPENDED") await prisma.subscription.updateMany({ where: { organizationId: id }, data: { status: "SUSPENDED", suspendedAt: new Date() } });
  // Reactivating the org must also lift a subscription suspension, otherwise the
  // tenant gate keeps the org locked out despite an ACTIVE org status. Clear the
  // store's dunning/cancellation anchors too, or the next lifecycle cron would
  // immediately re-suspend or re-cancel the just-reactivated org.
  if (status === "ACTIVE") {
    await prisma.subscription.updateMany({ where: { organizationId: id, status: "SUSPENDED" }, data: { status: "ACTIVE", suspendedAt: null } });
    const store = await readSubscriptionBilling(id);
    if (store.pastDueSince || store.cancelScheduledFor) {
      store.pastDueSince = null;
      store.cancelScheduledFor = null;
      await writeSubscriptionBilling(id, store);
    }
  }
  return NextResponse.json({ organization });
}