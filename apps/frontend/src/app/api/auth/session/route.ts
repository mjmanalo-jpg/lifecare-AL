import { NextRequest, NextResponse } from "next/server";
import { createSession, clearSession, getSession } from "@/lib/auth";
import { Role } from "@/constants/roleConfig";
import { prisma } from "@/lib/prisma";
import { isDbConfigured } from "@/lib/models";
import bcrypt from "bcryptjs";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * POST /api/auth/session
 * Create a new session from email/password credentials only.
 * Validates against the DB; every session is bound to a User so
 * ownership/scoping works. (The former role-only demo bypass was removed.)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body as { email?: string; password?: string };

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 }
      );
    }

    if (!isDbConfigured()) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 500 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: { id: true, role: true, passwordHash: true, isActive: true },
    });

    if (!user || !user.passwordHash) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    if (!user.isActive) {
      return NextResponse.json(
        { error: "Account is deactivated" },
        { status: 403 }
      );
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Update lastLogin
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const sessionRole = user.role as Role;
    const success = await createSession(sessionRole, user.id);
    if (!success) {
      return NextResponse.json(
        { error: "Failed to create session" },
        { status: 500 }
      );
    }

    // Audit log — fire-and-forget
    logAudit({
      actorId: user.id,
      actorRole: sessionRole,
      action: "LOGIN",
      entityType: "auth",
      entityId: user.id,
      reason: `User logged in as ${sessionRole}`,
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    });

    return NextResponse.json({
      success: true,
      role: sessionRole,
      userId: user.id,
      redirectUrl: `/${sessionRole.toLowerCase()}/dashboard`,
    });
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
    // Capture session info before clearing
    const session = await getSession();

    const success = await clearSession();
    if (!success) {
      return NextResponse.json(
        { error: "Failed to clear session" },
        { status: 500 }
      );
    }

    // Audit log — fire-and-forget
    if (session) {
      logAudit({
        actorId: session.userId,
        actorRole: session.role,
        action: "LOGOUT",
        entityType: "auth",
        entityId: session.userId || "unknown",
        reason: `User logged out (${session.role})`,
        ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
        userAgent: request.headers.get("user-agent") || undefined,
      });
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

