import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { assembleRoutine, type AssembleInput } from "@/lib/lifecare/assembleRoutine";
import { draftEventToDefinitionRow } from "@/lib/lifecare/routineDefinitions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// SLMS v4.2 Routine — generate DRAFT (sub-project #3, §2).
// Runs the pure #2 assembly engine and atomically REPLACES the resident's
// unapproved draft: delete all DRAFT/RETURNED rows, insert the fresh v1 DRAFT
// set. APPROVED/EXPIRED/CANCELLED history is never touched (Rule 14).
// ─────────────────────────────────────────────────────────────

const WRITE_ROLES = new Set(["NURSE", "CARE_MANAGER", "SUPERADMIN"]);

export async function POST(request: NextRequest) {
  const ctx = await requireTenantContext({});
  if (!ctx || ctx.isPlatform || !ctx.communityId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!WRITE_ROLES.has(ctx.role)) {
    logAudit({ actorId: ctx.userId, actorRole: ctx.role, action: "DENY", entityType: "routine-definitions", entityId: "generate-draft", organizationId: ctx.organizationId, communityId: ctx.communityId, reason: "Forbidden — role cannot generate a routine draft" });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const communityId = ctx.communityId;

  let body: Partial<AssembleInput> = {};
  try { body = (await request.json()) as Partial<AssembleInput>; } catch { body = {}; }

  const residentId = body.residentId ? String(body.residentId) : "";
  if (!residentId) return NextResponse.json({ error: "residentId required" }, { status: 400 });
  if (!body.finalLoc) return NextResponse.json({ error: "finalLoc required" }, { status: 400 });

  // Guard the resident is in this community (mirrors care-events route).
  const resident = await prisma.resident.findFirst({
    where: { id: residentId, communityId },
    select: { firstName: true, lastName: true },
  });
  if (!resident) return NextResponse.json({ error: "Related resident not found" }, { status: 422 });
  const residentName = `${resident.firstName ?? ""} ${resident.lastName ?? ""}`.trim() || undefined;

  // Default the missing arrays/objects so the pure engine never NPEs on a thin body.
  const input: AssembleInput = {
    residentId,
    finalLoc: body.finalLoc,
    assessmentVersion: body.assessmentVersion ?? "v4.2",
    approvedBy: body.approvedBy,
    domains: Array.isArray(body.domains) ? body.domains : [],
    activeConditions: Array.isArray(body.activeConditions) ? body.activeConditions : [],
    memoryIntensity: body.memoryIntensity,
    orders: body.orders ?? {},
    preferences: body.preferences,
    effectiveDate: body.effectiveDate ?? new Date().toISOString().slice(0, 10),
  };

  let count = 0;
  try {
    const drafted = assembleRoutine(input);
    const rows = drafted.map((e) => draftEventToDefinitionRow(e, residentId, communityId));
    await prisma.$transaction(async (tx) => {
      await tx.routineEventDefinition.deleteMany({
        where: { residentId, communityId, status: { in: ["DRAFT", "RETURNED"] } },
      });
      if (rows.length) {
        const res = await tx.routineEventDefinition.createMany({ data: rows as never });
        count = res.count;
      }
    });
  } catch (err) {
    console.error("[routine generate-draft] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not generate the routine draft." }, { status: 500 });
  }

  logAudit({
    actorId: ctx.userId,
    actorRole: ctx.role,
    action: "CREATE",
    entityType: "routine-definitions",
    entityId: residentId,
    organizationId: ctx.organizationId,
    communityId,
    after: { residentId, residentName },
    reason: `Generated ${count} draft routine event(s)${residentName ? ` for ${residentName}` : ""}`,
  });

  return NextResponse.json({ count });
}
