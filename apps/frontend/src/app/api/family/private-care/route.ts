import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/models";
import { requireTenantContext, type TenantContext } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { PRIVATE_CARE_KEY, parsePrivateCare, type PrivateCareAssignment } from "@/lib/privateCaregiver";
import { applyPrivateCareCharge } from "@/lib/privateCaregiverServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Family-sponsor approval for Private (1:1) Caregiver requests.
 *   GET  → the pending/decided assignments where the caller is the family sponsor.
 *   POST → approve (→ ACTIVE, posts the first recurring charge) or decline the request.
 * Authz is sponsor-scoped: a family user can only act on assignments whose
 * `sponsorId` is their own user id. Assignments live in the community-scoped
 * app-setting `private_caregiver_assignments`.
 */

const settingId = (ctx: TenantContext) => `${ctx.organizationId}:${ctx.communityId}:${PRIVATE_CARE_KEY}`;

async function readAssignments(ctx: TenantContext): Promise<PrivateCareAssignment[]> {
  const row = await prisma.appSetting.findUnique({ where: { id: settingId(ctx) } });
  return parsePrivateCare(row?.value);
}

export async function GET() {
  const ctx = await requireTenantContext({ requireCommunity: true });
  if (!ctx?.organizationId || !ctx.communityId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ assignments: [] });
  const mine = (await readAssignments(ctx)).filter((a) => a.sponsorId && a.sponsorId === ctx.userId);
  return NextResponse.json({ assignments: mine });
}

export async function POST(request: NextRequest) {
  const ctx = await requireTenantContext({ requireCommunity: true });
  if (!ctx?.organizationId || !ctx.communityId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  const decision = String(body.decision || "");
  const reason = String(body.reason || "").slice(0, 500);
  if (!id || (decision !== "APPROVE" && decision !== "DECLINE")) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const assignments = await readAssignments(ctx);
  const idx = assignments.findIndex((a) => a.id === id);
  if (idx < 0) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  const a = assignments[idx];

  // Only the resident's family sponsor may decide, and only while still pending.
  if (a.sponsorId !== ctx.userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (a.status !== "PENDING_FAMILY") return NextResponse.json({ error: "This request was already decided" }, { status: 409 });

  const now = new Date().toISOString();
  const decidedBy = a.sponsorName || "Family sponsor";
  const updated: PrivateCareAssignment = decision === "APPROVE"
    ? { ...a, status: "ACTIVE", decidedBy, decidedAt: now, startDate: now }
    : { ...a, status: "DECLINED", decidedBy, decidedAt: now, declineReason: reason || "Declined by family" };
  const next = assignments.map((x, i) => (i === idx ? updated : x));

  const sid = settingId(ctx);
  await prisma.appSetting.upsert({
    where: { id: sid },
    update: { value: JSON.stringify(next) },
    create: { id: sid, key: PRIVATE_CARE_KEY, value: JSON.stringify(next), organizationId: ctx.organizationId, communityId: ctx.communityId },
  });

  // On approval, post the first month's recurring charge (idempotent per month).
  if (decision === "APPROVE") {
    try {
      await applyPrivateCareCharge({ organizationId: ctx.organizationId, communityId: ctx.communityId, assignment: updated });
    } catch { /* best-effort — the cron re-attempts monthly */ }
  }

  // Notify the assigned caregiver's user account of the decision, if linked.
  try {
    const staff = await prisma.staff.findUnique({ where: { id: a.caregiverId }, select: { userId: true } });
    if (staff?.userId) {
      await prisma.notification.create({
        data: {
          organizationId: ctx.organizationId, communityId: ctx.communityId,
          userId: staff.userId,
          type: "TASK_ASSIGNMENT",
          title: decision === "APPROVE" ? "Private caregiver approved" : "Private caregiver declined",
          message: decision === "APPROVE"
            ? `${decidedBy} approved your 1:1 assignment for ${a.residentName}. It is now active.`
            : `${decidedBy} declined the 1:1 assignment for ${a.residentName}.`,
          relatedEntityType: "approval",
          severity: "INFO",
        },
      });
    }
  } catch { /* best-effort */ }

  return NextResponse.json({ ok: true, assignment: updated });
}
