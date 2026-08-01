import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageOrganization, requireTenantContext, requiresPrivilegedMfa } from "@/lib/tenant";
import { createInvitation } from "@/lib/invitations";
import { logAudit } from "@/lib/audit";

const ORG_ROLES = new Set(["OWNER", "ADMIN", "BILLING_ADMIN", "VIEWER"]);
const COMMUNITY_ROLES = new Set(["FACILITY_ADMIN", "BILLING_ADMIN", "PHYSICIAN", "NURSE", "CAREGIVER", "FAMILY", "RESIDENT", "FLEET_MANAGEMENT", "DRIVER"]);
const STAFF_ROLES = new Set(["FACILITY_ADMIN", "BILLING_ADMIN", "PHYSICIAN", "NURSE", "CAREGIVER", "FLEET_MANAGEMENT", "DRIVER"]);
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireTenantContext();
  if (context && requiresPrivilegedMfa(context)) return NextResponse.json({ error: "MFA required", code: "MFA_REQUIRED" }, { status: 403 });
  const { id } = await params;
  const organizationManager = Boolean(context && canManageOrganization(context));
  const facilityManager = Boolean(context?.role === "FACILITY_ADMIN" && context.communityId);
  if (!context || context.organizationId !== id || (!organizationManager && !facilityManager)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json();
  const email = String(body.email || "").toLowerCase().trim();
  const organizationRole = body.organizationRole ? String(body.organizationRole) : undefined;
  const communityRole = body.communityRole ? String(body.communityRole) : undefined;
  const communityId = body.communityId ? String(body.communityId) : undefined;
  if (!email || (!organizationRole && !communityRole)) return NextResponse.json({ error: "Email and at least one role are required" }, { status: 400 });
  if (facilityManager && organizationRole) return NextResponse.json({ error: "Facility administrators cannot assign organization roles" }, { status: 403 });
  if (facilityManager && communityId !== context.communityId) return NextResponse.json({ error: "Facility administrators can only invite people to their active community" }, { status: 403 });
  if (facilityManager && communityRole === "FACILITY_ADMIN") return NextResponse.json({ error: "Only an organization owner or administrator can appoint a facility administrator" }, { status: 403 });
  if (organizationRole && !ORG_ROLES.has(organizationRole)) return NextResponse.json({ error: "Invalid organization role" }, { status: 422 });
  if (communityRole && !COMMUNITY_ROLES.has(communityRole)) return NextResponse.json({ error: "Invalid community role" }, { status: 422 });
  if (communityRole) {
    const community = await prisma.community.findFirst({ where: { id: communityId, organizationId: id, isActive: true } });
    if (!community) return NextResponse.json({ error: "Community not found" }, { status: 404 });
  }
  if (communityRole && STAFF_ROLES.has(communityRole)) {
    const name = String(body.name || "").trim();
    const position = String(body.position || "").trim();
    if (!name || !position) return NextResponse.json({ error: "Staff name and position are required" }, { status: 400 });
    const subscription = await prisma.subscription.findUnique({ where: { organizationId: id }, include: { plan: true } });
    const activeStaff = await prisma.staff.count({ where: { organizationId: id, isActive: true } });
    if (subscription?.plan.maxStaffSeats && activeStaff >= subscription.plan.maxStaffSeats) return NextResponse.json({ error: `Staff seat limit reached (${subscription.plan.maxStaffSeats})`, code: "STAFF_LIMIT" }, { status: 403 });
    const existingUser = await prisma.user.findUnique({ where: { email }, include: { staff: true } });
    if (existingUser?.staff?.organizationId && existingUser.staff.organizationId !== id) return NextResponse.json({ error: "This account already has a primary staff profile in another organization" }, { status: 409 });
    const user = await prisma.user.upsert({
      where: { email },
      create: { email, name, phone: body.phone || null, role: communityRole as never },
      update: { name, phone: body.phone || undefined, role: communityRole as never, isActive: true },
    });
    await prisma.staff.upsert({
      where: { userId: user.id },
      create: { userId: user.id, organizationId: id, communityId, position, department: body.department || null, hireDate: body.hireDate ? new Date(body.hireDate) : new Date(), isActive: true, isApproved: true },
      update: { organizationId: id, communityId, position, department: body.department || null, isActive: true, isApproved: true },
    });
  }
  await prisma.invitation.updateMany({ where: { email, organizationId: id, status: "PENDING" }, data: { status: "REVOKED" } });
  let result;
  try {
    result = await createInvitation({
      email, organizationId: id, communityId,
      organizationRole: organizationRole as never,
      communityRole: communityRole as never,
      createdById: context.userId,
      baseUrl: new URL(request.url).origin,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown delivery error";
    logAudit({ actorId: context.userId, actorRole: context.role, action: "DENY", entityType: "invitation", entityId: email, organizationId: id, communityId, reason: "Supabase invitation delivery failed" });
    return NextResponse.json({ error: process.env.NODE_ENV === "production" ? "Supabase could not deliver the invitation email. Contact the platform administrator." : `Supabase invitation failed: ${detail}`, code: "INVITATION_DELIVERY_FAILED" }, { status: 502 });
  }
  logAudit({ actorId: context.userId, actorRole: context.role, action: "CREATE", entityType: "invitation", entityId: result.invitation.id, organizationId: id, communityId, after: { status: "PENDING", role: communityRole || organizationRole } });
  return NextResponse.json({ invitation: { id: result.invitation.id, expiresAt: result.invitation.expiresAt, ...(process.env.NODE_ENV !== "production" ? { acceptUrl: result.acceptUrl } : {}) } }, { status: 201 });
}
