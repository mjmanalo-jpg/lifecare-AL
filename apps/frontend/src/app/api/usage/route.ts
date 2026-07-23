import { NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/tenant";
import { getEntitlements, getUsage } from "@/lib/entitlements";

export async function GET() {
  const context = await requireTenantContext();
  if (!context?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [usage, subscription] = await Promise.all([getUsage(context), getEntitlements(context.organizationId)]);
  return NextResponse.json({ usage, limits: subscription?.plan || null });
}