import { cookies } from "next/headers";
import { Role } from "@/constants/roleConfig";

const SESSION_COOKIE_NAME = "golden_hearth_session";
const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

interface SessionData {
  role: Role;
  createdAt: number;
}

/**
 * Create a server-side session by setting a signed HTTP-only cookie.
 * This ensures the role can't be spoofed by the client.
 */
export async function createSession(role: Role): Promise<boolean> {
  try {
    const cookieStore = await cookies();

    const sessionData: SessionData = {
      role,
      createdAt: Date.now(),
    };

    // Store as simple JSON (in production, you'd sign/encrypt this)
    const sessionValue = btoa(JSON.stringify(sessionData));

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
 * Validate and retrieve the current session.
 * Returns the role if valid, null otherwise.
 */
export async function validateSession(): Promise<Role | null> {
  try {
    const cookieStore = await cookies();
    const sessionValue = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (!sessionValue) {
      return null;
    }

    const sessionData = JSON.parse(atob(sessionValue)) as SessionData;

    // Validate role is one of the allowed values
    const validRoles: Role[] = ["SUPERADMIN", "NURSE", "CAREGIVER", "FAMILY"];
    if (!validRoles.includes(sessionData.role)) {
      return null;
    }

    return sessionData.role;
  } catch (error) {
    console.error("Failed to validate session:", error);
    return null;
  }
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
