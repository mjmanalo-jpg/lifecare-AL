import { NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/tenant";
import { getEntitlements } from "@/lib/entitlements";

export async function GET() {
  const context = await requireTenantContext();
  if (!context?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const subscription = await getEntitlements(context.organizationId);
  return subscription ? NextResponse.json(subscription) : NextResponse.json({ error: "Subscription not configured" }, { status: 404 });
}