import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageOrganization, requireTenantContext, requiresPrivilegedMfa } from "@/lib/tenant";

const FIELDS = ["name", "code", "address", "city", "state", "zip", "phone", "email", "timezone", "licenseNumber", "licenseExpiry", "bedsTotal", "logoUrl", "primaryColor", "secondaryColor", "configuration"] as const;
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireTenantContext();
  if (context && requiresPrivilegedMfa(context)) return NextResponse.json({ error: "MFA required", code: "MFA_REQUIRED" }, { status: 403 });
  const { id } = await params;
  if (!context || (context.communityId !== id && !context.isOrganizationAdmin)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const community = await prisma.community.findFirst({ where: { id, organizationId: context.organizationId } });
  return community ? NextResponse.json({ community }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireTenantContext();
  if (context && requiresPrivilegedMfa(context)) return NextResponse.json({ error: "MFA required", code: "MFA_REQUIRED" }, { status: 403 });
  const { id } = await params;
  if (!context || !canManageOrganization(context)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const existing = await prisma.community.findFirst({ where: { id, organizationId: context.organizationId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await request.json();
  const data = Object.fromEntries(FIELDS.filter((key) => key in body).map((key) => [key, body[key]]));
  const community = await prisma.community.update({ where: { id }, data });
  return NextResponse.json({ community });
}