import { NextRequest, NextResponse } from "next/server";
import { getSession, getSupabaseTokens } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { updateSupabasePassword } from "@/lib/supabaseAuth";
import { logAudit } from "@/lib/audit";

export async function GET() {
  const session = await getSession();
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, email: true, role: true, platformRole: true },
  });
  if (!user) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  return NextResponse.json({ user });
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  const password = typeof body.password === "string" ? body.password : undefined;
  if (name !== undefined && (name.length < 2 || name.length > 100)) {
    return NextResponse.json({ error: "Name must be between 2 and 100 characters" }, { status: 400 });
  }
  if (password !== undefined && (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password))) {
    return NextResponse.json({ error: "Password must be at least 12 characters and include uppercase, lowercase, number, and symbol" }, { status: 400 });
  }
  if (password !== undefined) {
    const { accessToken } = await getSupabaseTokens();
    if (!accessToken) return NextResponse.json({ error: "Sign in with Supabase Auth before changing your password" }, { status: 409 });
    await updateSupabasePassword(accessToken, password);
    logAudit({ actorId: session.userId, actorRole: session.role, action: "UPDATE", entityType: "account_password", entityId: session.userId });
  }
  const user = name !== undefined
    ? await prisma.user.update({ where: { id: session.userId }, data: { name }, select: { id: true, name: true, email: true, role: true, platformRole: true } })
    : await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true, name: true, email: true, role: true, platformRole: true } });
  if (name !== undefined) logAudit({ actorId: session.userId, actorRole: session.role, action: "UPDATE", entityType: "account_profile", entityId: session.userId });
  return NextResponse.json({ user, passwordChanged: password !== undefined });
}
