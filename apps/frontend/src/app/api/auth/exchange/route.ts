import { NextRequest, NextResponse } from "next/server";
import { createSession, setSupabaseTokens } from "@/lib/auth";
import { getSupabaseIdentity } from "@/lib/supabaseAuth";
import { hashInvitationToken } from "@/lib/invitations";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const accessToken = String(body.accessToken || "");
  const refreshToken = String(body.refreshToken || "");
  const invitationToken = String(body.invitationToken || "");
  if (!accessToken || !refreshToken || !invitationToken) return NextResponse.json({ error: "Invalid invitation session" }, { status: 400 });
  try {
    const identity = await getSupabaseIdentity(accessToken);
    const invitation = await prisma.invitation.findUnique({ where: { tokenHash: hashInvitationToken(invitationToken) } });
    if (!invitation || invitation.status !== "PENDING" || invitation.expiresAt <= new Date() || invitation.email !== identity.email) return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
    const role = invitation.communityRole || "FAMILY";
    const user = await prisma.user.upsert({
      where: { email: identity.email },
      create: { email: identity.email, authUserId: identity.id, name: identity.email.split("@")[0], role },
      update: { authUserId: identity.id, isActive: true },
    });
    await createSession(role, user.id, { authUserId: identity.id });
    await setSupabaseTokens(accessToken, refreshToken, 3600);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Unable to verify invitation identity" }, { status: 401 });
  }
}