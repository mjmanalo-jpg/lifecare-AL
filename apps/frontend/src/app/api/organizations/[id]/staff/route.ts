import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { canManageOrganization, requireTenantContext, requiresPrivilegedMfa } from "@/lib/tenant";
import {
  isSupabaseAuthConfigured,
  createSupabaseUser,
  deleteSupabaseUser,
  SupabaseUserExistsError,
} from "@/lib/supabaseAuth";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Community roles a staff account can hold. Mirrors the invitation route so the
// two entry points stay consistent.
const STAFF_ROLES = new Set(["FACILITY_ADMIN", "PHYSICIAN", "NURSE", "CAREGIVER", "FLEET_MANAGEMENT", "DRIVER"]);

// Creates a staff account directly with an admin-set password — no invitation,
// no email. The staff member can sign in immediately and change their password
// later from Settings. This is the no-SMTP counterpart to the invitation flow.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireTenantContext();
  if (context && requiresPrivilegedMfa(context)) return NextResponse.json({ error: "MFA required", code: "MFA_REQUIRED" }, { status: 403 });
  const { id } = await params;
  const organizationManager = Boolean(context && canManageOrganization(context));
  const facilityManager = Boolean(context?.role === "FACILITY_ADMIN" && context.communityId);
  if (!context || context.organizationId !== id || (!organizationManager && !facilityManager)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").toLowerCase().trim();
  const name = String(body.name || "").trim();
  const position = String(body.position || "").trim();
  const communityRole = String(body.communityRole || "").trim();
  const password = String(body.password || "");
  const communityId = body.communityId ? String(body.communityId) : context.communityId;

  if (!email || !name || !position || !communityRole) {
    return NextResponse.json({ error: "Name, email, position, and role are required" }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }
  if (!STAFF_ROLES.has(communityRole)) {
    return NextResponse.json({ error: "Invalid staff role" }, { status: 422 });
  }
  if (!communityId) {
    return NextResponse.json({ error: "An active community is required" }, { status: 400 });
  }
  // Facility administrators are scoped to their own community and cannot mint peers.
  if (facilityManager && communityId !== context.communityId) {
    return NextResponse.json({ error: "Facility administrators can only add staff to their active community" }, { status: 403 });
  }
  if (facilityManager && communityRole === "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Only an organization owner or administrator can appoint a facility administrator" }, { status: 403 });
  }

  const community = await prisma.community.findFirst({ where: { id: communityId, organizationId: id, isActive: true } });
  if (!community) return NextResponse.json({ error: "Community not found" }, { status: 404 });

  // Plan seat limit.
  const subscription = await prisma.subscription.findUnique({ where: { organizationId: id }, include: { plan: true } });
  const activeStaff = await prisma.staff.count({ where: { organizationId: id, isActive: true } });
  if (subscription?.plan.maxStaffSeats && activeStaff >= subscription.plan.maxStaffSeats) {
    return NextResponse.json({ error: `Staff seat limit reached (${subscription.plan.maxStaffSeats})`, code: "STAFF_LIMIT" }, { status: 403 });
  }

  // New staff only — existing accounts are managed through the edit flow.
  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existingUser) return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });

  // Create the confirmed Supabase identity (no email). bcrypt hash kept for dev-login parity.
  let authUserId: string | undefined;
  if (isSupabaseAuthConfigured()) {
    try {
      const created = await createSupabaseUser(email, password);
      authUserId = created.id;
    } catch (error) {
      if (error instanceof SupabaseUserExistsError) {
        return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
      }
      console.error("Supabase staff provisioning failed", error instanceof Error ? error.message : "unknown");
      return NextResponse.json({ error: "Unable to create the staff account" }, { status: 502 });
    }
  }
  const passwordHash = await bcrypt.hash(password, 10);

  let staffId: string;
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Establish RLS context so tenant-scoped membership rows pass their policies.
      await tx.$executeRaw`SELECT set_config('app.user_id', ${context.userId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${id}, true)`;
      await tx.$executeRaw`SELECT set_config('app.community_id', ${communityId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.is_platform', ${context.platformRole ? "true" : "false"}, true)`;

      const user = await tx.user.create({
        data: {
          email,
          name,
          phone: body.phone || null,
          role: communityRole as never,
          authUserId,
          passwordHash,
          isActive: true,
        },
      });
      const staff = await tx.staff.create({
        data: {
          userId: user.id,
          organizationId: id,
          communityId,
          position,
          department: body.department || null,
          hireDate: body.hireDate ? new Date(body.hireDate) : new Date(),
          isActive: true,
          isApproved: true,
        },
      });
      // Login memberships — the invitation flow only created these on acceptance.
      await tx.organizationMembership.create({
        data: { userId: user.id, organizationId: id, role: "VIEWER", status: "ACTIVE" },
      });
      await tx.communityMembership.create({
        data: { userId: user.id, communityId, role: communityRole as never, status: "ACTIVE" },
      });
      // Retire any leftover pending invitations for this email.
      await tx.invitation.updateMany({ where: { email, organizationId: id, status: "PENDING" }, data: { status: "REVOKED" } });
      return { userId: user.id, staffId: staff.id };
    });
    staffId = result.staffId;
  } catch (error) {
    if (authUserId) await deleteSupabaseUser(authUserId).catch(() => undefined);
    console.error("Staff provisioning failed", error instanceof Error ? error.message : "unknown");
    const message = error instanceof Error && error.message.includes("Unique constraint")
      ? "An account with this email already exists"
      : "Staff account creation failed";
    return NextResponse.json({ error: message }, { status: 409 });
  }

  logAudit({ actorId: context.userId, actorRole: context.role, action: "CREATE", entityType: "staff", entityId: staffId, organizationId: id, communityId, after: { role: communityRole } });
  return NextResponse.json({ staffId, success: true }, { status: 201 });
}
