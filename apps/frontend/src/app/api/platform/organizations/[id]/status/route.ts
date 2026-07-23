import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext, requiresPrivilegedMfa } from "@/lib/tenant";

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
  return NextResponse.json({ organization });
}