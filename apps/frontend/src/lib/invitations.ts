import crypto from "node:crypto";
import { prisma } from "./prisma";
import { sendSupabaseInvitation } from "./supabaseAuth";

export function hashInvitationToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createInvitation(input: {
  email: string;
  organizationId: string;
  communityId?: string;
  residentId?: string;
  organizationRole?: "OWNER" | "ADMIN" | "BILLING_ADMIN" | "VIEWER";
  communityRole?: "FACILITY_ADMIN" | "PHYSICIAN" | "NURSE" | "CAREGIVER" | "FAMILY" | "RESIDENT" | "FLEET_MANAGEMENT" | "DRIVER";
  createdById?: string;
  baseUrl: string;
}) {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const invitation = await prisma.invitation.create({
    data: {
      tokenHash: hashInvitationToken(rawToken),
      email: input.email.toLowerCase().trim(),
      organizationId: input.organizationId,
      communityId: input.communityId,
      residentId: input.residentId,
      organizationRole: input.organizationRole,
      communityRole: input.communityRole,
      createdById: input.createdById,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  const acceptUrl = `${input.baseUrl}/invite/${rawToken}`;
  try {
    await sendSupabaseInvitation(invitation.email, acceptUrl);
  } catch (error) {
    await prisma.invitation.update({ where: { id: invitation.id }, data: { status: "REVOKED" } });
    throw error;
  }
  return { invitation, rawToken, acceptUrl };
}
