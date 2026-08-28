import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext, tenantWhere, isDeniedWhere } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { invalidatePortalDataPrefix } from "@/lib/dataCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Staff-account admin actions that must not go through the generic /api/db writer
// (the `users` model is closed there). Same tenant scope that already lets these
// portals PATCH the staff row — plus platform (Super Admin) — so no extra privilege.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireTenantContext({ allowPlatform: true });
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const scope = tenantWhere("staff", context);
  if (isDeniedWhere(scope)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const staff = await prisma.staff.findFirst({ where: scope ? { AND: [{ id }, scope] } : { id }, include: { user: true } });
  if (!staff) return NextResponse.json({ error: "Staff record not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));

  // Reset to first-time setup: clear the stored password (and any Supabase link)
  // so the next login prompts the staff to set their own password (company name +
  // mobile number → first-time setup). Mirrors the Org Admin reset action.
  if (body.resetPassword) {
    await prisma.user.update({ where: { id: staff.userId }, data: { passwordHash: null, authUserId: null } });
    logAudit({ actorId: context.userId, actorRole: context.role, action: "UPDATE", entityType: "staff-account", entityId: staff.userId, organizationId: context.organizationId, communityId: staff.communityId ?? undefined, reason: `Reset ${staff.user.name || "staff"}'s password — they set a new one on next login` });
    if (context.organizationId) invalidatePortalDataPrefix(`org-admin:${context.organizationId}:`);
    return NextResponse.json({ success: true, reset: true });
  }

  return NextResponse.json({ error: "No supported action in request" }, { status: 400 });
}
