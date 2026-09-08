import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { PUSH_SUBSCRIPTIONS_KEY, parsePushSubs, type StoredPushSub } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Web-push subscription registry (migration-free).
 *   POST   → register/refresh this device's PushSubscription for the current user.
 *   DELETE → remove a device (by endpoint) — used when the user turns push off.
 *
 * Stored per community in the `__push_subscriptions` app-setting, keyed by endpoint
 * so re-subscribing the same browser replaces (never duplicates) its entry.
 */

async function scoped(orgId: string, communityId: string) {
  const row = await prisma.appSetting.findFirst({
    where: { organizationId: orgId, communityId, key: PUSH_SUBSCRIPTIONS_KEY },
    select: { id: true, value: true },
  });
  return { id: row?.id ?? `${orgId}:${communityId}:${PUSH_SUBSCRIPTIONS_KEY}`, subs: parsePushSubs(row?.value) };
}

async function write(settingId: string, orgId: string, communityId: string, subs: StoredPushSub[]) {
  await prisma.appSetting.upsert({
    where: { id: settingId },
    create: { id: settingId, key: PUSH_SUBSCRIPTIONS_KEY, value: JSON.stringify(subs), organizationId: orgId, communityId },
    update: { value: JSON.stringify(subs) },
  });
}

export async function POST(request: NextRequest) {
  const context = await requireTenantContext();
  if (!context?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!context.communityId || !context.organizationId) return NextResponse.json({ error: "Select a community" }, { status: 409 });

  const body = await request.json().catch(() => null) as { subscription?: { endpoint?: string }; ua?: string } | null;
  const subscription = body?.subscription;
  const endpoint = subscription?.endpoint;
  if (!subscription || typeof endpoint !== "string" || !endpoint) {
    return NextResponse.json({ error: "A valid subscription is required" }, { status: 422 });
  }

  const { id, subs } = await scoped(context.organizationId, context.communityId);
  // Replace any existing entry for this endpoint (same device re-subscribing).
  const kept = subs.filter((s) => s.endpoint !== endpoint);
  kept.push({
    userId: context.userId,
    endpoint,
    subscription: subscription as StoredPushSub["subscription"],
    ua: typeof body?.ua === "string" ? body.ua.slice(0, 300) : undefined,
    at: new Date().toISOString(),
  });
  await write(id, context.organizationId, context.communityId, kept);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const context = await requireTenantContext();
  if (!context?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!context.communityId || !context.organizationId) return NextResponse.json({ error: "Select a community" }, { status: 409 });

  const body = await request.json().catch(() => null) as { endpoint?: string } | null;
  const endpoint = body?.endpoint;
  if (!endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 422 });

  const { id, subs } = await scoped(context.organizationId, context.communityId);
  // Only remove the caller's own device.
  const kept = subs.filter((s) => !(s.endpoint === endpoint && s.userId === context.userId));
  await write(id, context.organizationId, context.communityId, kept);
  return NextResponse.json({ ok: true });
}
