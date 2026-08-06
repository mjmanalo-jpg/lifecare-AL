import { cookies } from "next/headers";
import crypto from "node:crypto";
import { Role } from "@/constants/roleConfig";

const SESSION_COOKIE_NAME = "lcms_session";
const LEGACY_COOKIE_NAME = "golden_hearth_session";
const ACCESS_TOKEN_COOKIE = "lcms_sb_access";
const REFRESH_TOKEN_COOKIE = "lcms_sb_refresh";
const SESSION_COOKIE_MAX_AGE = 8 * 60 * 60;
const SESSION_SECRET = process.env.SESSION_SECRET || "golden-hearth-dev-secret-change-me";

// Fail closed in production if the secret was never configured — but NOT during
// `next build`, where env-only-at-runtime secrets aren't present and a
// module-load throw would abort page-data collection and fail the whole
// deployment. At build time (NEXT_PHASE === "phase-production-build") we skip
// the check; at runtime the throw still guards a misconfigured server.
if (
  process.env.NODE_ENV === "production" &&
  SESSION_SECRET.endsWith("change-me") &&
  process.env.NEXT_PHASE !== "phase-production-build"
) {
  throw new Error("SESSION_SECRET must be configured in production");
}

export interface SessionData {
  role: Role;
  userId?: string;
  authUserId?: string;
  authAssuranceLevel?: "aal1" | "aal2";
  platformRole?: "PLATFORM_ADMIN" | "PLATFORM_SUPPORT" | "PLATFORM_AUDITOR";
  organizationRole?: "OWNER" | "ADMIN" | "BILLING_ADMIN" | "VIEWER";
  activeOrganizationId?: string;
  activeCommunityId?: string;
  createdAt: number;
  expiresAt: number;
}

const VALID_ROLES: Role[] = [
  "PLATFORM_ADMIN", "ORGANIZATION_ADMIN", "SUPERADMIN", "FACILITY_ADMIN", "CARE_MANAGER", "BILLING_ADMIN", "PHYSICIAN", "NURSE", "CAREGIVER",
  "FAMILY", "RESIDENT", "FLEET_MANAGEMENT", "DRIVER", "SECURITY", "NUTRITIONIST", "KITCHEN",
  "HOUSEKEEPING", "MAINTENANCE",
];

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}
function unb64url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}
function sign(payload: string): string {
  return crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
}
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
function encodeSession(session: SessionData): string {
  const payload = b64url(JSON.stringify(session));
  return `${payload}.${sign(payload)}`;
}

async function writeSession(session: SessionData): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, encodeSession(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_COOKIE_MAX_AGE,
    path: "/",
  });
}

export async function createSession(
  role: Role,
  userId?: string,
  context: Partial<Omit<SessionData, "role" | "userId" | "createdAt" | "expiresAt">> = {}
): Promise<boolean> {
  try {
    const now = Date.now();
    await writeSession({
      role,
      userId,
      ...context,
      createdAt: now,
      expiresAt: now + SESSION_COOKIE_MAX_AGE * 1000,
    });
    return true;
  } catch (error) {
    console.error("Failed to create session", error instanceof Error ? error.message : "unknown");
    return false;
  }
}

export async function updateWorkspaceSession(
  current: SessionData,
  context: Pick<SessionData, "activeOrganizationId" | "activeCommunityId"> &
    Partial<Pick<SessionData, "role" | "organizationRole">>
): Promise<void> {
  const now = Date.now();
  await writeSession({ ...current, ...context, createdAt: now, expiresAt: now + SESSION_COOKIE_MAX_AGE * 1000 });
}

export async function elevateSessionMfa(current: SessionData): Promise<void> {
  await writeSession({ ...current, authAssuranceLevel: "aal2" });
}
export async function setSupabaseTokens(accessToken: string, refreshToken: string, expiresIn: number): Promise<void> {
  const store = await cookies();
  const options = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };
  store.set(ACCESS_TOKEN_COOKIE, accessToken, { ...options, maxAge: Math.max(60, expiresIn) });
  store.set(REFRESH_TOKEN_COOKIE, refreshToken, { ...options, maxAge: 30 * 24 * 60 * 60 });
}

export async function getSupabaseTokens(): Promise<{ accessToken?: string; refreshToken?: string }> {
  const store = await cookies();
  return {
    accessToken: store.get(ACCESS_TOKEN_COOKIE)?.value,
    refreshToken: store.get(REFRESH_TOKEN_COOKIE)?.value,
  };
}

export async function getSession(): Promise<SessionData | null> {
  try {
    const store = await cookies();
    const value = store.get(SESSION_COOKIE_NAME)?.value;
    if (!value) return null;
    const dot = value.lastIndexOf(".");
    if (dot < 0) return null;
    const payload = value.slice(0, dot);
    const signature = value.slice(dot + 1);
    if (!safeEqual(signature, sign(payload))) return null;
    const session = JSON.parse(unb64url(payload)) as SessionData;
    if (!VALID_ROLES.includes(session.role) || !session.userId || session.expiresAt <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export async function validateSession(): Promise<Role | null> {
  return (await getSession())?.role ?? null;
}

export async function clearSession(): Promise<boolean> {
  try {
    const store = await cookies();
    for (const name of [SESSION_COOKIE_NAME, LEGACY_COOKIE_NAME, ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]) {
      store.delete(name);
    }
    return true;
  } catch {
    return false;
  }
}

export async function requireSession(): Promise<Role> {
  const role = await validateSession();
  if (!role) throw new Error("Unauthorized");
  return role;
}
