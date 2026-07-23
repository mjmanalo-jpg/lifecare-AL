import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageOrganization, requireTenantContext, requiresPrivilegedMfa } from "@/lib/tenant";

const FIELDS = ["logoUrl", "primaryColor", "secondaryColor", "emailFromName", "branding"] as const;
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireTenantContext();
  if (context && requiresPrivilegedMfa(context)) return NextResponse.json({ error: "MFA required", code: "MFA_REQUIRED" }, { status: 403 });
  const { id } = await params;
  if (!context || context.organizationId !== id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const organization = await prisma.organization.findUnique({ where: { id }, select: { id: true, name: true, logoUrl: true, primaryColor: true, secondaryColor: true, emailFromName: true, branding: true } });
  return NextResponse.json({ organization });
}
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireTenantContext();
  if (context && requiresPrivilegedMfa(context)) return NextResponse.json({ error: "MFA required", code: "MFA_REQUIRED" }, { status: 403 });
  const { id } = await params;
  if (!context || context.organizationId !== id || !canManageOrganization(context)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json();
  const data = Object.fromEntries(FIELDS.filter((key) => key in body).map((key) => [key, body[key]]));
  const organization = await prisma.organization.update({ where: { id }, data });
  return NextResponse.json({ organization });
}