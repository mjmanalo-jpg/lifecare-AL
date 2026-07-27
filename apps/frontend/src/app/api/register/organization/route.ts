import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { isDbConfigured } from "@/lib/models";
import { createSession, setSupabaseTokens } from "@/lib/auth";
import {
  isSupabaseAuthConfigured,
  createSupabaseUser,
  deleteSupabaseUser,
  signInWithSupabase,
  SupabaseUserExistsError,
} from "@/lib/supabaseAuth";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function assuranceLevel(accessToken?: string): "aal1" | "aal2" | undefined {
  if (!accessToken) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"));
    return payload.aal === "aal2" ? "aal2" : "aal1";
  } catch {
    return undefined;
  }
}

// Resolves the plan a self-serve organization is placed on. Prefers the
// configured public plan, then any active plan, and finally provisions a
// default self-serve trial plan so signup works even on a fresh database.
async function resolveSignupPlan() {
  const key = (process.env.PUBLIC_SIGNUP_PLAN_KEY || "STARTER").toUpperCase();
  const byKey = await prisma.plan.findFirst({ where: { key, isActive: true } });
  if (byKey) return byKey;
  const anyActive = await prisma.plan.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
  if (anyActive) return anyActive;
  return prisma.plan.upsert({
    where: { key: "STARTER" },
    update: {},
    create: {
      key: "STARTER",
      name: "Starter Trial",
      description: "Self-serve trial plan for new organizations.",
      maxCommunities: 1,
      maxActiveResidents: 25,
      maxStaffSeats: 10,
      isActive: true,
    },
  });
}

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base) || "organization";
  let candidate = root;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await prisma.organization.findUnique({ where: { slug: candidate } });
    if (!existing) return candidate;
    candidate = `${root}-${crypto.randomBytes(3).toString("hex")}`;
  }
  return `${root}-${crypto.randomBytes(4).toString("hex")}`;
}

export async function POST(request: NextRequest) {
  if (process.env.ENABLE_PUBLIC_ORG_SIGNUP === "false") {
    return NextResponse.json({ error: "Public organization signup is disabled" }, { status: 403 });
  }
  if (!isDbConfigured()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const body = await request.json().catch(() => ({}));
  const companyName = String(body.companyName || "").trim();
  const ownerName = String(body.ownerName || "").trim();
  const email = String(body.email || "").toLowerCase().trim();
  const password = String(body.password || "");
  const communityName = String(body.communityName || "").trim() || "Main Community";

  if (!companyName || !ownerName || !email) {
    return NextResponse.json({ error: "Company name, your name, and email are required" }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existingUser) return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });

  const plan = await resolveSignupPlan();

  // Create the identity first so the User row can be linked to it. No email is
  // sent — the Supabase user is created already-confirmed via the admin API.
  let authUserId: string | undefined;
  const supabaseConfigured = isSupabaseAuthConfigured();
  if (supabaseConfigured) {
    try {
      const created = await createSupabaseUser(email, password);
      authUserId = created.id;
    } catch (error) {
      if (error instanceof SupabaseUserExistsError) {
        return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
      }
      console.error("Supabase account provisioning failed", error instanceof Error ? error.message : "unknown");
      return NextResponse.json({ error: "Unable to create your account" }, { status: 502 });
    }
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const slug = await uniqueSlug(companyName);

  let provisioned: { organizationId: string; communityId: string; userId: string };
  try {
    provisioned = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: companyName,
          slug,
          email,
          status: "ACTIVE",
          communities: {
            create: { name: communityName, timezone: "America/New_York" },
          },
          subscription: {
            create: {
              planId: plan.id,
              status: "TRIALING",
              trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
          },
        },
        include: { communities: true },
      });
      const community = organization.communities[0];
      const user = await tx.user.create({
        data: {
          email,
          name: ownerName,
          role: "FACILITY_ADMIN",
          authUserId,
          passwordHash,
          isActive: true,
        },
      });
      await tx.organizationMembership.create({
        data: { userId: user.id, organizationId: organization.id, role: "OWNER", status: "ACTIVE" },
      });
      await tx.communityMembership.create({
        data: { userId: user.id, communityId: community.id, role: "FACILITY_ADMIN", status: "ACTIVE" },
      });
      return { organizationId: organization.id, communityId: community.id, userId: user.id };
    });
  } catch (error) {
    if (authUserId) await deleteSupabaseUser(authUserId).catch(() => undefined);
    const message = error instanceof Error && error.message.includes("Unique constraint")
      ? "An organization with these details already exists"
      : "Organization provisioning failed";
    return NextResponse.json({ error: message }, { status: 409 });
  }

  // Auto sign-in the new owner. Owners resolve to the ORGANIZATION_ADMIN portal
  // role — the same derivation used by the login route.
  let tokens: { access_token: string; refresh_token: string; expires_in: number } | undefined;
  if (supabaseConfigured) {
    try {
      tokens = await signInWithSupabase(email, password);
    } catch (error) {
      console.error("Auto sign-in after signup failed", error instanceof Error ? error.message : "unknown");
    }
  }

  const role = "ORGANIZATION_ADMIN" as const;
  const success = await createSession(role, provisioned.userId, {
    authUserId,
    authAssuranceLevel: assuranceLevel(tokens?.access_token),
    organizationRole: "OWNER",
    activeOrganizationId: provisioned.organizationId,
    activeCommunityId: provisioned.communityId,
  });
  if (!success) return NextResponse.json({ error: "Account created, but sign-in failed. Please sign in." }, { status: 500 });
  if (tokens) await setSupabaseTokens(tokens.access_token, tokens.refresh_token, tokens.expires_in);

  await prisma.user.update({ where: { id: provisioned.userId }, data: { lastLogin: new Date() } });
  logAudit({ actorId: provisioned.userId, actorRole: role, action: "CREATE", entityType: "organization", entityId: provisioned.organizationId, organizationId: provisioned.organizationId, communityId: provisioned.communityId });
  logAudit({ actorId: provisioned.userId, actorRole: role, action: "LOGIN", entityType: "auth", entityId: provisioned.userId, organizationId: provisioned.organizationId });

  return NextResponse.json({ success: true, redirectUrl: `/${role.toLowerCase()}/dashboard` }, { status: 201 });
}
