import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { careDay } from "@/lib/lifecare/routineCompletions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// SLMS v4.2 Routine — approve DRAFT → APPROVED (sub-project #3, §4).
// The PIN is verified client-side (SignatureModal); the server records the
// approver, timestamp and effective date. BLOCKED rows (a blockReason set by
// the assembly engine — missing order / unresolved conflict, Rule 9/11) are
// NEVER approved; their count is returned so the board can surface them.
// ─────────────────────────────────────────────────────────────

const WRITE_ROLES = new Set(["NURSE", "CARE_MANAGER", "SUPERADMIN"]);

export async function POST(request: NextRequest) {
  const ctx = await requireTenantContext({});
  if (!ctx || ctx.isPlatform || !ctx.communityId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!WRITE_ROLES.has(ctx.role)) {
    logAudit({ actorId: ctx.userId, actorRole: ctx.role, action: "DENY", entityType: "routine-definitions", entityId: "approve", organizationId: ctx.organizationId, communityId: ctx.communityId, reason: "Forbidden — role cannot approve a routine" });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const communityId = ctx.communityId;

  let body: { residentId?: unknown; effectiveDate?: unknown } = {};
  try { body = (await request.json()) as typeof body; } catch { body = {}; }

  const residentId = body.residentId ? String(body.residentId) : "";
  if (!residentId) return NextResponse.json({ error: "residentId required" }, { status: 400 });
  const effectiveOverride = body.effectiveDate ? String(body.effectiveDate) : "";

  const resident = await prisma.resident.findFirst({
    where: { id: residentId, communityId },
    select: { firstName: true, lastName: true },
  });
  if (!resident) return NextResponse.json({ error: "Related resident not found" }, { status: 422 });
  const residentName = `${resident.firstName ?? ""} ${resident.lastName ?? ""}`.trim() || undefined;

  // approvedBy — SessionData carries no name, so resolve it (fallback to userId),
  // matching how logAudit backfills the actor name.
  const user = ctx.userId
    ? await prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } }).catch(() => null)
    : null;
  const approvedBy = user?.name || ctx.userId || "Approver";

  const today = careDay();
  const now = new Date();
  const overrideDate = effectiveOverride ? new Date(`${effectiveOverride}T00:00:00+08:00`) : null;

  const drafts = await prisma.routineEventDefinition.findMany({
    where: { residentId, communityId, status: "DRAFT" },
    select: { id: true, blockReason: true, effectiveDate: true, name: true },
  });
  const blocked = drafts.filter((d) => d.blockReason).length;
  const approvable = drafts.filter((d) => !d.blockReason);

  let approved = 0;
  for (const d of approvable) {
    const effectiveDate = overrideDate ?? d.effectiveDate ?? new Date(`${today}T00:00:00+08:00`);
    try {
      await prisma.routineEventDefinition.update({
        where: { id: d.id },
        data: { status: "APPROVED", approvedBy, approvedAt: now, effectiveDate },
      });
      approved += 1;
      logAudit({
        actorId: ctx.userId,
        actorName: approvedBy,
        actorRole: ctx.role,
        action: "UPDATE",
        entityType: "routine-definitions",
        entityId: d.id,
        organizationId: ctx.organizationId,
        communityId,
        after: { residentId, residentName, status: "APPROVED" },
        reason: `Approved routine event "${d.name}"${residentName ? ` for ${residentName}` : ""}`,
      });
    } catch (err) {
      console.error("[routine approve] update failed:", err);
    }
  }

  return NextResponse.json({ approved, blocked });
}
