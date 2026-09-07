import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// SLMS v4.2 Routine — return a DRAFT for revision (sub-project #3, §4).
// DRAFT → RETURNED with a reason. Returned rows generate nothing (Rule 14).
// ─────────────────────────────────────────────────────────────

const WRITE_ROLES = new Set(["NURSE", "CARE_MANAGER", "SUPERADMIN"]);

export async function POST(request: NextRequest) {
  const ctx = await requireTenantContext({});
  if (!ctx || ctx.isPlatform || !ctx.communityId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!WRITE_ROLES.has(ctx.role)) {
    logAudit({ actorId: ctx.userId, actorRole: ctx.role, action: "DENY", entityType: "routine-definitions", entityId: "return", organizationId: ctx.organizationId, communityId: ctx.communityId, reason: "Forbidden — role cannot return a routine draft" });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const communityId = ctx.communityId;

  let body: { id?: unknown; reason?: unknown } = {};
  try { body = (await request.json()) as typeof body; } catch { body = {}; }

  const id = body.id ? String(body.id) : "";
  const reason = body.reason ? String(body.reason) : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Scope the row to this community before mutating it.
  const def = await prisma.routineEventDefinition.findFirst({
    where: { id, communityId },
    select: { id: true, residentId: true },
  });
  if (!def) return NextResponse.json({ error: "Routine definition not found" }, { status: 404 });

  try {
    await prisma.routineEventDefinition.update({
      where: { id: def.id },
      data: { status: "RETURNED", revisionReason: reason || null },
    });
  } catch (err) {
    console.error("[routine return] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not return the routine." }, { status: 500 });
  }

  logAudit({
    actorId: ctx.userId,
    actorRole: ctx.role,
    action: "UPDATE",
    entityType: "routine-definitions",
    entityId: def.id,
    organizationId: ctx.organizationId,
    communityId,
    after: { residentId: def.residentId, status: "RETURNED" },
    reason: `Returned routine for revision${reason ? `: ${reason}` : ""}`,
  });

  return NextResponse.json({ ok: true });
}
