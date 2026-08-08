import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext, requiresPrivilegedMfa } from "@/lib/tenant";
import { readPaymentDetails, writePaymentDetails } from "@/lib/paymentDetails";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const context = await requireTenantContext({ allowPlatform: true });
  if (context && requiresPrivilegedMfa(context)) return NextResponse.json({ error: "MFA required", code: "MFA_REQUIRED" }, { status: 403 });
  if (!context?.platformRole) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ paymentDetails: await readPaymentDetails() });
}

export async function PUT(request: NextRequest) {
  const context = await requireTenantContext({ allowPlatform: true });
  if (context && requiresPrivilegedMfa(context)) return NextResponse.json({ error: "MFA required", code: "MFA_REQUIRED" }, { status: 403 });
  if (context?.platformRole !== "PLATFORM_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const saved = await writePaymentDetails(body);
  logAudit({ actorId: context.userId, actorRole: context.role, action: "UPDATE", entityType: "payment-details", entityId: "platform", after: { provider: saved.provider, methods: saved.methods.length } });
  return NextResponse.json({ paymentDetails: saved });
}
