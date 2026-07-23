import { NextRequest, NextResponse } from "next/server";
import { createSession, clearSession, getSession, getSupabaseTokens, setSupabaseTokens } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isDbConfigured } from "@/lib/models";
import { isSupabaseAuthConfigured, signInWithSupabase, signOutSupabase } from "@/lib/supabaseAuth";
import { listWorkspaces } from "@/lib/tenant";
import bcrypt from "bcryptjs";
import { logAudit } from "@/lib/audit";
import type { Role as PortalRole } from "@/constants/roleConfig";

export const runtime = "nodejs";

function assuranceLevel(accessToken?: string): "aal1" | "aal2" | undefined {
  if (!accessToken) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"));
    return payload.aal === "aal2" ? "aal2" : "aal1";
  } catch { return undefined; }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = String(body.email || "").toLowerCase().trim();
    const password = String(body.password || "");
    if (!email || !password) return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    if (!isDbConfigured()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

    let authUserId: string | undefined;
    let tokens: { access_token: string; refresh_token: string; expires_in: number } | undefined;
    if (isSupabaseAuthConfigured()) {
      try {
        const result = await signInWithSupabase(email, password);
        authUserId = result.user.id;
        tokens = result;
      } catch {
        return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
      }
    }

    const user = await prisma.user.findFirst({
      where: authUserId ? { OR: [{ authUserId }, { email }] } : { email },
      select: { id: true, authUserId: true, role: true, platformRole: true, passwordHash: true, isActive: true, communityMemberships: { select: { status: true } } },
    });
    if (!user) return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    if (!user.isActive) return NextResponse.json({ error: "Account is deactivated" }, { status: 403 });
    if (!user.platformRole && user.communityMemberships.some((membership) => membership.status === "INVITED") && !user.communityMemberships.some((membership) => membership.status === "ACTIVE")) {
      return NextResponse.json({ error: "Account is pending approval" }, { status: 403 });
    }

    if (!authUserId) {
      if (process.env.NODE_ENV === "production" || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
        return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
      }
    } else if (!user.authUserId) {
      await prisma.user.update({ where: { id: user.id }, data: { authUserId } });
    } else if (user.authUserId !== authUserId) {
      return NextResponse.json({ error: "Identity does not match this account" }, { status: 403 });
    }

    const workspaces = await listWorkspaces(user.id);
    const organization = workspaces?.organizations[0];
    const community = organization?.communities[0];
    const databaseRole = community?.role || user.role;
    const role = (user.platformRole === "PLATFORM_ADMIN"
      ? "PLATFORM_ADMIN"
      : ["OWNER", "ADMIN"].includes(organization?.role || "")
        ? "ORGANIZATION_ADMIN"
        : databaseRole) as PortalRole;
    const success = await createSession(role, user.id, {
      authUserId,
      authAssuranceLevel: assuranceLevel(tokens?.access_token),
      platformRole: user.platformRole || undefined,
      organizationRole: organization?.role,
      activeOrganizationId: organization?.id,
      activeCommunityId: community?.id,
    });
    if (!success) return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
    if (tokens) await setSupabaseTokens(tokens.access_token, tokens.refresh_token, tokens.expires_in);

    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
    logAudit({ actorId: user.id, actorRole: role, action: "LOGIN", entityType: "auth", entityId: user.id });

    return NextResponse.json({
      success: true,
      session: {
        userId: user.id,
        role,
        platformRole: user.platformRole,
        mfaRequired: Boolean((user.platformRole || ["OWNER", "ADMIN"].includes(organization?.role || "")) && assuranceLevel(tokens?.access_token) !== "aal2"),
        activeOrganizationId: organization?.id,
        activeCommunityId: community?.id,
      },
      redirectUrl: `/${String(role).toLowerCase()}/dashboard`,
    });
  } catch (error) {
    console.error("Session creation failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Unable to sign in" }, { status: 500 });
  }
}

export async function DELETE() {
  const session = await getSession();
  const { accessToken } = await getSupabaseTokens();
  if (accessToken) await signOutSupabase(accessToken).catch(() => undefined);
  const success = await clearSession();
  if (session) logAudit({ actorId: session.userId, actorRole: session.role, action: "LOGOUT", entityType: "auth", entityId: session.userId || "unknown" });
  return NextResponse.json({ success, redirectUrl: "/" }, { status: success ? 200 : 500 });
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ authenticated: false }, { status: 401 });
  const workspaces = await listWorkspaces(session.userId!);
  return NextResponse.json({ authenticated: true, session, workspaces });
}
