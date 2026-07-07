import { NextRequest, NextResponse } from "next/server";
import { createSession, clearSession } from "@/lib/auth";
import { ROLES, Role } from "@/constants/roleConfig";

/**
 * POST /api/auth/session
 * Create a new session for a role.
 * Body: { role: "NURSE" | "SUPERADMIN" | "CAREGIVER" | "FAMILY" }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { role } = body as { role?: string };

    // Validate role
    if (!role || !Object.keys(ROLES).includes(role)) {
      return NextResponse.json(
        { error: "Invalid or missing role" },
        { status: 400 }
      );
    }

    // Create session
    const success = await createSession(role as Role);
    if (!success) {
      return NextResponse.json(
        { error: "Failed to create session" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        role,
        redirectUrl: `/${role.toLowerCase()}/dashboard`,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Session creation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/auth/session
 * Clear the current session (logout).
 */
export async function DELETE(request: NextRequest) {
  try {
    const success = await clearSession();
    if (!success) {
      return NextResponse.json(
        { error: "Failed to clear session" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: true, redirectUrl: "/login" },
      { status: 200 }
    );
  } catch (error) {
    console.error("Session deletion error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
