import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { careDay } from "@/lib/lifecare/routineCompletions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// SLMS v4.2 Routine — discontinue an APPROVED definition (sub-project #3, §6).
// Sets status CANCELLED + stopDate today; cancels ALREADY-GENERATED future
// occurrences (careDate > today). Past occurrences are retained unchanged.
// ─────────────────────────────────────────────────────────────

const WRITE_ROLES = new Set(["NURSE", "CARE_MANAGER", "SUPERADMIN"]);

export async function POST(request: NextRequest) {
  const ctx = await requireTenantContext({});
  if (!ctx || ctx.isPlatform || !ctx.communityId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!WRITE_ROLES.has(ctx.role)) {
    logAudit({ actorId: ctx.userId, actorRole: ctx.role, action: "DENY", entityType: "routine-definitions", entityId: "discontinue", organizationId: ctx.organizationId, communityId: ctx.communityId, reason: "Forbidden — role cannot discontinue a routine" });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const communityId = ctx.communityId;

  let body: { id?: unknown; reason?: unknown } = {};
  try { body = (await request.json()) as typeof body; } catch { body = {}; }

  const id = body.id ? String(body.id) : "";
  const reason = body.reason ? String(body.reason) : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const def = await prisma.routineEventDefinition.findFirst({
    where: { id, communityId },
    select: { id: true, residentId: true, name: true },
  });
  if (!def) return NextResponse.json({ error: "Routine definition not found" }, { status: 404 });

  const today = careDay();
  const stopDate = new Date(`${today}T00:00:00+08:00`);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.routineEventDefinition.update({
        where: { id: def.id },
        data: { status: "CANCELLED", revisionReason: reason || null, stopDate },
      });
      // Future occurrences only (careDate strictly after today's care day). Past
      // and today's charting is retained unchanged.
      await tx.routineOccurrence.updateMany({
        where: { definitionId: def.id, careDate: { gt: stopDate } },
        data: { workflowState: "Cancelled", exceptionReason: "Authorized cancellation" },
      });
    });
  } catch (err) {
    console.error("[routine discontinue] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not discontinue the routine." }, { status: 500 });
  }

  logAudit({
    actorId: ctx.userId,
    actorRole: ctx.role,
    action: "UPDATE",
    entityType: "routine-definitions",
    entityId: def.id,
    organizationId: ctx.organizationId,
    communityId,
    after: { residentId: def.residentId, status: "CANCELLED" },
    reason: `Discontinued routine "${def.name}"${reason ? `: ${reason}` : ""}`,
  });

  return NextResponse.json({ ok: true });
}
