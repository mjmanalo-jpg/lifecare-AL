import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { canManageOrganization, requireTenantContext } from "@/lib/tenant";
import { isSupabaseAuthConfigured, createSupabaseUser, deleteSupabaseUser, SupabaseUserExistsError } from "@/lib/supabaseAuth";
import { logAudit } from "@/lib/audit";
import { invalidatePortalDataPrefix } from "@/lib/dataCache";
import { normalizeMobile } from "@/lib/mobileAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Org owners/admins create admin & manager accounts directly here — no email
// invitation. The account is provisioned already-confirmed and usable with the
// initial password set by the administrator. Restricted to the leadership roles
// an organization administrator is allowed to appoint.
const ALLOWED_ROLES = new Set(["FACILITY_ADMIN", "CARE_MANAGER", "RESIDENT_COORDINATOR", "SUPERADMIN", "NURSE", "CAREGIVER", "PHYSICIAN", "BILLING_ADMIN", "NUTRITIONIST", "KITCHEN", "HOUSEKEEPING", "MAINTENANCE", "SECURITY", "FLEET_MANAGEMENT", "DRIVER"]);

export async function POST(request: NextRequest) {
  const context = await requireTenantContext();
  if (!context || !context.organizationId || !canManageOrganization(context)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const emailInput = String(body.email || "").toLowerCase().trim();
  const password = String(body.password || "");
  const position = String(body.position || "").trim();
  const role = String(body.role || "");
  const communityId = String(body.communityId || "");
  const phone = String(body.phone || "").trim();
  const department = body.department ? String(body.department).trim() : null;
  const employeeCode = String(body.employeeCode || "").trim();
  const mobile = normalizeMobile(phone);

  // Mobile number is the unique login key for staff (company + mobile). Email is
  // optional — a synthetic address is generated when none is given.
  if (!name || !phone || !position || !role || !communityId) {
    return NextResponse.json({ error: "Full name, mobile number, position, community, and role are required" }, { status: 400 });
  }
  if (mobile.length < 7) {
    return NextResponse.json({ error: "Enter a valid mobile number" }, { status: 400 });
  }
  if (emailInput && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailInput)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Choose a valid staff role" }, { status: 422 });
  }
  if (password && password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const community = await prisma.community.findFirst({ where: { id: communityId, organizationId: context.organizationId, isActive: true } });
  if (!community) return NextResponse.json({ error: "Community not found" }, { status: 404 });

  // Mobile must be unique within the organization — it is the login identifier.
  const orgMembers = await prisma.communityMembership.findMany({
    where: { community: { organizationId: context.organizationId } },
    select: { user: { select: { phone: true } } },
  });
  if (orgMembers.some((m) => normalizeMobile(m.user?.phone || "") === mobile)) {
    return NextResponse.json({ error: "A staff member with this mobile number already exists" }, { status: 409 });
  }

  // Real email if given, else a unique synthetic one (mobile + org) to satisfy the
  // User.email unique constraint; sign-in is by company + mobile regardless.
  const email = emailInput || `staff.${mobile}@${context.organizationId}.slms.local`;
  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existingUser) return NextResponse.json({ error: emailInput ? "An account with this email already exists" : "A staff member with this mobile number already exists" }, { status: 409 });

  // Enforce the plan's staff-seat entitlement, mirroring the invitation flow.
  const subscription = await prisma.subscription.findUnique({ where: { organizationId: context.organizationId }, include: { plan: true } });
  const activeStaff = await prisma.staff.count({ where: { organizationId: context.organizationId, isActive: true } });
  if (subscription?.plan.maxStaffSeats && activeStaff >= subscription.plan.maxStaffSeats) {
    return NextResponse.json({ error: `Staff seat limit reached (${subscription.plan.maxStaffSeats})`, code: "STAFF_LIMIT" }, { status: 403 });
  }

  // Provision the identity first so the User row can link to it. No email is
  // sent — createSupabaseUser makes an already-confirmed account.
  // Only provision a Supabase identity when a password is set. Password-less
  // accounts activate on first login (company + mobile → set first-time password).
  let authUserId: string | undefined;
  if (password && emailInput && isSupabaseAuthConfigured()) {
    try {
      const created = await createSupabaseUser(email, password);
      authUserId = created.id;
    } catch (error) {
      if (error instanceof SupabaseUserExistsError) return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
      console.error("Supabase account provisioning failed", error instanceof Error ? error.message : "unknown");
      return NextResponse.json({ error: "Unable to create the account" }, { status: 502 });
    }
  }

  const passwordHash = password ? await bcrypt.hash(password, 10) : null;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, name, phone, role: role as never, authUserId, passwordHash: passwordHash ?? undefined, isActive: true },
      });
      // A VIEWER organization membership surfaces the account in People & Access
      // and lets sign-in resolve the active organization — without granting the
      // org-admin portal (which requires OWNER/ADMIN). The community membership
      // carries the real leadership role that routes them to the right portal.
      await tx.organizationMembership.create({ data: { userId: user.id, organizationId: context.organizationId!, role: "VIEWER", status: "ACTIVE" } });
      await tx.communityMembership.create({ data: { userId: user.id, communityId, role: role as never, status: "ACTIVE" } });
      const staff = await tx.staff.create({ data: { userId: user.id, organizationId: context.organizationId!, communityId, position, department, hireDate: new Date(), isActive: true, isApproved: true } });

      // Roster Employee ID → staffByCode, so the Staff Roster auto-matches this
      // person by their code (migration-free, in the community's roster_mappings).
      if (employeeCode) {
        const where = { organizationId_communityId_key: { organizationId: context.organizationId!, communityId, key: "roster_mappings" } };
        const existing = await tx.appSetting.findUnique({ where });
        let mapping: { staffByCode?: Record<string, string> } = {};
        try { mapping = JSON.parse(existing?.value || "{}"); } catch { mapping = {}; }
        mapping.staffByCode = { ...(mapping.staffByCode || {}), [employeeCode]: staff.id };
        await tx.appSetting.upsert({
          where,
          create: { id: `${context.organizationId}:${communityId}:roster_mappings`, key: "roster_mappings", value: JSON.stringify(mapping), organizationId: context.organizationId!, communityId },
          update: { value: JSON.stringify(mapping) },
        });
      }
      return { userId: user.id, staffId: staff.id };
    });

    logAudit({ actorId: context.userId, actorRole: context.role, action: "CREATE", entityType: "staff-account", entityId: result.userId, organizationId: context.organizationId, communityId, after: { role, email, employeeCode: employeeCode || undefined } });
    invalidatePortalDataPrefix(`org-admin:${context.organizationId}:`);
    return NextResponse.json({ success: true, userId: result.userId, staffId: result.staffId }, { status: 201 });
  } catch (error) {
    if (authUserId) await deleteSupabaseUser(authUserId).catch(() => undefined);
    console.error("Staff account provisioning failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Account provisioning failed" }, { status: 400 });
  }
}
