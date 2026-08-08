import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { canManageOrganization, requireTenantContext } from "@/lib/tenant";
import { isSupabaseAuthConfigured, createSupabaseUser, deleteSupabaseUser, SupabaseUserExistsError } from "@/lib/supabaseAuth";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Org owners/admins create admin & manager accounts directly here — no email
// invitation. The account is provisioned already-confirmed and usable with the
// initial password set by the administrator. Restricted to the leadership roles
// an organization administrator is allowed to appoint.
const ALLOWED_ROLES = new Set(["FACILITY_ADMIN", "CARE_MANAGER", "SUPERADMIN"]);

export async function POST(request: NextRequest) {
  const context = await requireTenantContext();
  if (!context || !context.organizationId || !canManageOrganization(context)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const email = String(body.email || "").toLowerCase().trim();
  const password = String(body.password || "");
  const position = String(body.position || "").trim();
  const role = String(body.role || "");
  const communityId = String(body.communityId || "");
  const phone = body.phone ? String(body.phone).trim() : null;
  const department = body.department ? String(body.department).trim() : null;

  if (!name || !email || !position || !role || !communityId) {
    return NextResponse.json({ error: "Name, email, position, community, and role are required" }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Role must be Facility Admin, Care Manager, or Super Admin" }, { status: 422 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const community = await prisma.community.findFirst({ where: { id: communityId, organizationId: context.organizationId, isActive: true } });
  if (!community) return NextResponse.json({ error: "Community not found" }, { status: 404 });

  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existingUser) return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });

  // Enforce the plan's staff-seat entitlement, mirroring the invitation flow.
  const subscription = await prisma.subscription.findUnique({ where: { organizationId: context.organizationId }, include: { plan: true } });
  const activeStaff = await prisma.staff.count({ where: { organizationId: context.organizationId, isActive: true } });
  if (subscription?.plan.maxStaffSeats && activeStaff >= subscription.plan.maxStaffSeats) {
    return NextResponse.json({ error: `Staff seat limit reached (${subscription.plan.maxStaffSeats})`, code: "STAFF_LIMIT" }, { status: 403 });
  }

  // Provision the identity first so the User row can link to it. No email is
  // sent — createSupabaseUser makes an already-confirmed account.
  let authUserId: string | undefined;
  if (isSupabaseAuthConfigured()) {
    try {
      const created = await createSupabaseUser(email, password);
      authUserId = created.id;
    } catch (error) {
      if (error instanceof SupabaseUserExistsError) return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
      console.error("Supabase account provisioning failed", error instanceof Error ? error.message : "unknown");
      return NextResponse.json({ error: "Unable to create the account" }, { status: 502 });
    }
  }

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const userId = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, name, phone, role: role as never, authUserId, passwordHash, isActive: true },
      });
      // A VIEWER organization membership surfaces the account in People & Access
      // and lets sign-in resolve the active organization — without granting the
      // org-admin portal (which requires OWNER/ADMIN). The community membership
      // carries the real leadership role that routes them to the right portal.
      await tx.organizationMembership.create({ data: { userId: user.id, organizationId: context.organizationId!, role: "VIEWER", status: "ACTIVE" } });
      await tx.communityMembership.create({ data: { userId: user.id, communityId, role: role as never, status: "ACTIVE" } });
      await tx.staff.create({ data: { userId: user.id, organizationId: context.organizationId!, communityId, position, department, hireDate: new Date(), isActive: true, isApproved: true } });
      return user.id;
    });

    logAudit({ actorId: context.userId, actorRole: context.role, action: "CREATE", entityType: "staff-account", entityId: userId, organizationId: context.organizationId, communityId, after: { role, email } });
    return NextResponse.json({ success: true, userId }, { status: 201 });
  } catch (error) {
    if (authUserId) await deleteSupabaseUser(authUserId).catch(() => undefined);
    console.error("Staff account provisioning failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Account provisioning failed" }, { status: 400 });
  }
}
