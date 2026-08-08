import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext, requiresPrivilegedMfa } from "@/lib/tenant";
import { createInvitation } from "@/lib/invitations";

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function GET() {
  const context = await requireTenantContext({ allowPlatform: true });
  if (context && requiresPrivilegedMfa(context)) return NextResponse.json({ error: "MFA required", code: "MFA_REQUIRED" }, { status: 403 });
  if (!context?.platformRole) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const organizations = await prisma.organization.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      subscription: { include: { plan: true } },
      _count: { select: { communities: true, residents: true, staff: true } },
      // Leadership account(s) for each customer workspace (owner or org admin).
      memberships: {
        where: { status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } },
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, status: true, user: { select: { id: true, name: true, email: true, isActive: true, lastLogin: true } } },
      },
    },
  });
  return NextResponse.json({ organizations });
}
export async function POST(request: NextRequest) {
  const context = await requireTenantContext({ allowPlatform: true });
  if (context && requiresPrivilegedMfa(context)) return NextResponse.json({ error: "MFA required", code: "MFA_REQUIRED" }, { status: 403 });
  if (context?.platformRole !== "PLATFORM_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json();
  const name = String(body.name || "").trim();
  const ownerEmail = String(body.ownerEmail || "").toLowerCase().trim();
  const communityName = String(body.community?.name || "").trim();
  const planId = String(body.planId || "");
  if (!name || !ownerEmail || !communityName || !planId) return NextResponse.json({ error: "Name, owner email, initial community, and plan are required" }, { status: 400 });
  const plan = await prisma.plan.findFirst({ where: { id: planId, isActive: true } });
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  try {
    const organization = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name,
          slug: slugify(String(body.slug || name)),
          legalName: body.legalName || null,
          email: body.email || ownerEmail,
          phone: body.phone || null,
          primaryColor: body.primaryColor || null,
          secondaryColor: body.secondaryColor || null,
          communities: {
            create: {
              name: communityName,
              code: body.community.code || null,
              timezone: body.community.timezone || "America/New_York",
              address: body.community.address || null,
              city: body.community.city || null,
              state: body.community.state || null,
              zip: body.community.zip || null,
              bedsTotal: body.community.bedsTotal ? Number(body.community.bedsTotal) : null,
            },
          },
          subscription: {
            create: {
              planId,
              status: body.subscriptionStatus || "TRIALING",
              trialEndsAt: body.trialEndsAt ? new Date(body.trialEndsAt) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
          },
        },
        include: { communities: true, subscription: { include: { plan: true } } },
      });
      return org;
    });
    const invitation = await createInvitation({
      email: ownerEmail,
      organizationId: organization.id,
      organizationRole: "OWNER",
      createdById: context.userId,
      baseUrl: new URL(request.url).origin,
    });
    return NextResponse.json({
      organization,
      invitation: { id: invitation.invitation.id, expiresAt: invitation.invitation.expiresAt, ...(process.env.NODE_ENV !== "production" ? { acceptUrl: invitation.acceptUrl } : {}) },
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error && error.message.includes("Unique constraint") ? "Organization slug already exists" : "Organization provisioning failed";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}