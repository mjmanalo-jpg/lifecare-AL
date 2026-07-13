import { cookies } from "next/headers";
import crypto from "node:crypto";
import { Role } from "@/constants/roleConfig";

const SESSION_COOKIE_NAME = "golden_hearth_session";
const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

/**
 * Secret used to HMAC-sign the session cookie so the client can't forge a role
 * or a userId. Set SESSION_SECRET in the environment for production; the dev
 * fallback keeps local/demo flows working but is intentionally not secret.
 */
const SESSION_SECRET =
  process.env.SESSION_SECRET || "golden-hearth-dev-secret-change-me";
if (
  process.env.NODE_ENV === "production" &&
  SESSION_SECRET === "golden-hearth-dev-secret-change-me"
) {
  console.warn(
    "[auth] SESSION_SECRET is unset in production — set it to a strong random value."
  );
}

export interface SessionData {
  role: Role;
  /** The signed-in User.id. Present for FAMILY (their sponsor id); optional for staff roles. */
  userId?: string;
  createdAt: number;
}

const VALID_ROLES: Role[] = [
  "SUPERADMIN",
  "FACILITY_ADMIN",
  "PHYSICIAN",
  "NURSE",
  "CAREGIVER",
  "FAMILY",
  "RESIDENT",
  "FLEET_MANAGEMENT",
  "DRIVER",
];

// URL-safe base64 helpers (btoa/atob exist in the Node runtime used by route handlers).
function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}
function unb64url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
}

/** Constant-time comparison to avoid signature-timing leaks. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Create a server-side session by setting a signed HTTP-only cookie.
 * The payload is HMAC-signed so the role/userId can't be spoofed by the client.
 */
export async function createSession(role: Role, userId?: string): Promise<boolean> {
  try {
    const cookieStore = await cookies();

    const sessionData: SessionData = { role, userId, createdAt: Date.now() };
    const payload = b64url(JSON.stringify(sessionData));
    const sessionValue = `${payload}.${sign(payload)}`;

    cookieStore.set(SESSION_COOKIE_NAME, sessionValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: SESSION_COOKIE_MAX_AGE,
      path: "/",
    });

    return true;
  } catch (error) {
    console.error("Failed to create session:", error);
    return false;
  }
}

/**
 * Validate and retrieve the full session (role + userId), verifying the signature.
 * Returns null if the cookie is missing, tampered with, or malformed.
 */
export async function getSession(): Promise<SessionData | null> {
  try {
    const cookieStore = await cookies();
    const sessionValue = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!sessionValue) return null;

    const dot = sessionValue.lastIndexOf(".");
    if (dot < 0) return null;
    const payload = sessionValue.slice(0, dot);
    const signature = sessionValue.slice(dot + 1);

    // Reject any cookie whose signature doesn't match our secret (forgery/tamper).
    if (!safeEqual(signature, sign(payload))) return null;

    const sessionData = JSON.parse(unb64url(payload)) as SessionData;
    if (!VALID_ROLES.includes(sessionData.role)) return null;

    return sessionData;
  } catch (error) {
    console.error("Failed to validate session:", error);
    return null;
  }
}

/**
 * Validate and retrieve the current session role.
 * Returns the role if valid, null otherwise. (Back-compat wrapper over getSession.)
 */
export async function validateSession(): Promise<Role | null> {
  const session = await getSession();
  return session?.role ?? null;
}

/**
 * Clear the session (logout).
 */
export async function clearSession(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    cookieStore.delete(SESSION_COOKIE_NAME);
    return true;
  } catch (error) {
    console.error("Failed to clear session:", error);
    return false;
  }
}

/**
 * Server-side wrapper to protect API routes.
 * Returns role if authenticated, throws 401 otherwise.
 */
export async function requireSession(): Promise<Role> {
  const role = await validateSession();
  if (!role) {
    throw new Error("Unauthorized");
  }
  return role;
}
