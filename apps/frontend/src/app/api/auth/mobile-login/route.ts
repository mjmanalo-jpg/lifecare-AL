import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { isDbConfigured } from "@/lib/models";
import { createSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { normalizeMobile } from "@/lib/mobileAuth";
import type { Role as PortalRole } from "@/constants/roleConfig";

export const runtime = "nodejs";

// Company + mobile-number login (huma-style). Staff use the Employee portal,
// families/residents the Family portal. No Supabase / SMS — the password is
// verified against the bcrypt hash we store at provisioning, and the app's own
// signed session cookie is issued via createSession(). First-time accounts (no
// password yet) are asked to set one, then signed in.

const STAFF_ROLE_FALLBACK = "CAREGIVER";

export async function POST(request: NextRequest) {
  try {
    if (!isDbConfigured()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    const body = await request.json().catch(() => ({}));
    const company = String(body.company || "").trim();
    const mobile = normalizeMobile(String(body.mobile || ""));
    const password = String(body.password || "");
    const newPassword = String(body.newPassword || "");

    if (!company || !mobile) return NextResponse.json({ error: "Company and mobile number are required" }, { status: 400 });
    if (mobile.length < 7) return NextResponse.json({ error: "Enter a valid mobile number" }, { status: 400 });

    // 1) Company name → the communities under that org/community.
    const communities = await prisma.community.findMany({
      where: { OR: [{ name: { equals: company, mode: "insensitive" } }, { organization: { name: { equals: company, mode: "insensitive" } } }] },
      select: { id: true, organizationId: true },
    });
    if (!communities.length) return NextResponse.json({ error: "We couldn't find that company. Check the company name." }, { status: 401 });
    const communityIds = communities.map((c) => c.id);

    // 2) Members of those communities whose mobile matches, on the chosen portal.
    const memberships = await prisma.communityMembership.findMany({
      where: { communityId: { in: communityIds }, status: { in: ["ACTIVE", "INVITED"] } },
      select: {
        role: true, communityId: true,
        user: { select: { id: true, name: true, phone: true, passwordHash: true, isActive: true, role: true, platformRole: true } },
      },
    });
    const matches = memberships.filter((m) => m.user && normalizeMobile(m.user.phone || "") === mobile);
    // De-dupe to distinct users (someone could be in two communities of the org).
    const byUser = new Map(matches.map((m) => [m.user!.id, m]));
    const distinct = [...byUser.values()];

    if (distinct.length === 0) {
      return NextResponse.json({ error: "No account found for that company and number. Contact your administrator." }, { status: 401 });
    }
    if (distinct.length > 1) {
      return NextResponse.json({ error: "That number matches more than one account — contact your administrator." }, { status: 409 });
    }

    const match = distinct[0];
    const user = match.user!;
    if (!user.isActive) return NextResponse.json({ error: "This account is deactivated. Contact your administrator." }, { status: 403 });

    // 3) First-time activation: no password yet.
    if (!user.passwordHash) {
      if (!newPassword) return NextResponse.json({ needsFirstPassword: true }, { status: 200 });
      if (newPassword.length < 8) return NextResponse.json({ error: "Choose a password of at least 8 characters." }, { status: 400 });
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 10) } });
    } else {
      // Returning account — "Continue" (no password yet) → prompt for password.
      if (!password) return NextResponse.json({ needsPassword: true }, { status: 200 });
      if (!(await bcrypt.compare(password, user.passwordHash))) {
        return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
      }
    }

    // 4) Resolve role for the matched community + issue the session.
    const matchedCommunityId = match.communityId;
    const matchedOrgId = communities.find((c) => c.id === matchedCommunityId)?.organizationId ?? undefined;
    const orgMem = matchedOrgId
      ? await prisma.organizationMembership.findFirst({ where: { userId: user.id, organizationId: matchedOrgId }, select: { role: true } })
      : null;
    const role = (user.platformRole === "PLATFORM_ADMIN"
      ? "PLATFORM_ADMIN"
      : ["OWNER", "ADMIN"].includes(orgMem?.role || "")
        ? "ORGANIZATION_ADMIN"
        : (match.role || user.role || STAFF_ROLE_FALLBACK)) as PortalRole;

    const ok = await createSession(role, user.id, {
      platformRole: user.platformRole || undefined,
      organizationRole: orgMem?.role as never,
      activeOrganizationId: matchedOrgId,
      activeCommunityId: matchedCommunityId,
    });
    if (!ok) return NextResponse.json({ error: "Failed to create session" }, { status: 500 });

    prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } }).catch(() => undefined);
    logAudit({ actorId: user.id, actorRole: role, action: "LOGIN", entityType: "auth", entityId: user.id, reason: "Mobile login" });

    return NextResponse.json({
      success: true,
      session: { userId: user.id, role, activeOrganizationId: matchedOrgId, activeCommunityId: matchedCommunityId },
      redirectUrl: `/${String(role).toLowerCase()}/dashboard`,
    });
  } catch (error) {
    console.error("[mobile-login] failed:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Unable to sign in" }, { status: 500 });
  }
}
