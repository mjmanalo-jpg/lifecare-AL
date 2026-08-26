import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext, tenantWhere, isDeniedWhere } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { invalidatePortalDataPrefix } from "@/lib/dataCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dedicated administration API for a staff member's LINKED-USER contact fields
// (name / email / phone). The generic /api/db/users gateway is deliberately
// closed (EXPLICIT_ADMIN_MODELS) so nobody can flip role/isActive/org via the
// generic writer. This endpoint exposes only the harmless contact fields, and
// authorizes with the very same tenant scope that already lets these portals
// PATCH the staff row — no extra privilege.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireTenantContext({ allowPlatform: true });
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const scope = tenantWhere("staff", context);
  if (isDeniedWhere(scope)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const staff = await prisma.staff.findFirst({ where: scope ? { AND: [{ id }, scope] } : { id }, include: { user: true } });
  if (!staff) return NextResponse.json({ error: "Staff record not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const name = body.name !== undefined ? String(body.name).trim() : staff.user.name;
  const phone = body.phone !== undefined ? String(body.phone).trim() : (staff.user.phone ?? "");
  const emailInput = body.email !== undefined ? String(body.email).toLowerCase().trim() : "";

  if (!name) return NextResponse.json({ error: "Full name is required" }, { status: 400 });
  if (emailInput && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailInput)) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  // Only change the stored email when a real one is given; a blank field keeps
  // the existing address (which may be an internal synthetic placeholder).
  if (emailInput && emailInput !== staff.user.email) {
    const dup = await prisma.user.findUnique({ where: { email: emailInput }, select: { id: true } });
    if (dup && dup.id !== staff.userId) return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
  }

  await prisma.user.update({ where: { id: staff.userId }, data: { name, phone, ...(emailInput ? { email: emailInput } : {}) } });

  logAudit({ actorId: context.userId, actorRole: context.role, action: "UPDATE", entityType: "staff-contact", entityId: staff.userId, organizationId: context.organizationId, communityId: context.communityId, after: { name, email: emailInput || staff.user.email, phone } });
  if (context.organizationId) invalidatePortalDataPrefix(`org-admin:${context.organizationId}:`);
  return NextResponse.json({ success: true });
}
