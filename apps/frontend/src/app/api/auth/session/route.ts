import { NextRequest, NextResponse } from "next/server";
import { createSession, clearSession, getSession } from "@/lib/auth";
import { ROLES, Role } from "@/constants/roleConfig";
import { prisma } from "@/lib/prisma";
import { isDbConfigured } from "@/lib/models";

export const runtime = "nodejs";

/**
 * POST /api/auth/session
 * Create a new session for a role.
 * Body: { role: "NURSE" | "SUPERADMIN" | "CAREGIVER" | "FAMILY", userId?: string }
 *
 * Every session is bound to a User so ownership/scoping works. For the demo role
 * bypass (no userId supplied), we resolve the first user with that role. This is
 * essential for FAMILY (sponsor) and RESIDENT (self) scoping in `scope.ts`.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { role, userId } = body as { role?: string; userId?: string };

    // Validate role
    if (!role || !Object.keys(ROLES).includes(role)) {
      return NextResponse.json(
        { error: "Invalid or missing role" },
        { status: 400 }
      );
    }

    // Resolve the bound user id from the DB when not supplied (demo bypass).
    let resolvedUserId = userId;
    if (!resolvedUserId && isDbConfigured()) {
      try {
        const user = await prisma.user.findFirst({
          where: { role: role as Role },
          select: { id: true },
          orderBy: { createdAt: "asc" },
        });
        resolvedUserId = user?.id;
      } catch (err) {
        console.warn(`[auth] could not resolve ${role} user:`, (err as Error).message);
      }
    }

    // Create session
    const success = await createSession(role as Role, resolvedUserId);
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

/**
 * GET /api/auth/session
 * Retrieve current active session info.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }
    return NextResponse.json({
      authenticated: true,
      role: session.role,
      userId: session.userId,
    });
  } catch (error) {
    console.error("Session fetch error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

