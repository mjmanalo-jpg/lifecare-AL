import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext, requiresPrivilegedMfa } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { invalidatePortalDataPrefix } from "@/lib/dataCache";

function code(value: string) { return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, ""); }

export async function POST(request: NextRequest) {
  const context = await requireTenantContext();
  if (!context?.organizationId || !["OWNER", "ADMIN"].includes(context.organizationRole || "")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (requiresPrivilegedMfa(context)) return NextResponse.json({ error: "MFA required", code: "MFA_REQUIRED" }, { status: 403 });
  const body = await request.json();
  const name = String(body.name || "").trim();
  const communityCode = code(String(body.code || name));
  if (!name || !communityCode) return NextResponse.json({ error: "Community name and code are required" }, { status: 400 });
  const subscription = await prisma.subscription.findUnique({ where: { organizationId: context.organizationId }, include: { plan: true } });
  const activeCount = await prisma.community.count({ where: { organizationId: context.organizationId, isActive: true } });
  if (subscription?.plan.maxCommunities && activeCount >= subscription.plan.maxCommunities) return NextResponse.json({ error: `Plan limit reached (${subscription.plan.maxCommunities} communities)`, code: "COMMUNITY_LIMIT" }, { status: 403 });
  try {
    const community = await prisma.community.create({ data: { organizationId: context.organizationId, name, code: communityCode, timezone: String(body.timezone || "America/New_York"), address: body.address || null, city: body.city || null, state: body.state || null, zip: body.zip || null, phone: body.phone || null, email: body.email || null, bedsTotal: body.bedsTotal ? Number(body.bedsTotal) : null } });
    logAudit({ actorId: context.userId, actorRole: context.role, action: "CREATE", entityType: "community", entityId: community.id, organizationId: context.organizationId, communityId: community.id });
    invalidatePortalDataPrefix(`org-admin:${context.organizationId}:`);
    return NextResponse.json({ community }, { status: 201 });
  } catch { return NextResponse.json({ error: "Community code already exists in this organization" }, { status: 409 }); }
}
