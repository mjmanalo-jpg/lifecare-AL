import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { applyRevision, assertAssistanceLevel, type RoutineDefinitionRow } from "@/lib/lifecare/routineDefinitions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// SLMS v4.2 Routine — revise an APPROVED definition (sub-project #3, §6, Rule 18).
// Never mutates the live row: builds the next-version DRAFT via the pure
// applyRevision() helper and inserts it (version+1, supersedesVersion). The
// prior version and its pinned historical occurrences are untouched, which is
// what keeps past charting immutable.
// ─────────────────────────────────────────────────────────────

const WRITE_ROLES = new Set(["NURSE", "CARE_MANAGER", "SUPERADMIN"]);

export async function POST(request: NextRequest) {
  const ctx = await requireTenantContext({});
  if (!ctx || ctx.isPlatform || !ctx.communityId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!WRITE_ROLES.has(ctx.role)) {
    logAudit({ actorId: ctx.userId, actorRole: ctx.role, action: "DENY", entityType: "routine-definitions", entityId: "revise", organizationId: ctx.organizationId, communityId: ctx.communityId, reason: "Forbidden — role cannot revise a routine" });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const communityId = ctx.communityId;

  let body: { id?: unknown; edits?: unknown; revisionReason?: unknown } = {};
  try { body = (await request.json()) as typeof body; } catch { body = {}; }

  const id = body.id ? String(body.id) : "";
  const revisionReason = body.revisionReason ? String(body.revisionReason) : "";
  const edits = (body.edits && typeof body.edits === "object" && !Array.isArray(body.edits))
    ? (body.edits as Partial<RoutineDefinitionRow>)
    : {};
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // An assistance-level edit must be a canonical ASSISTANCE value (Rule 9).
  if (edits.assistanceLevel != null) {
    try { assertAssistanceLevel(String(edits.assistanceLevel)); }
    catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid assistance level" }, { status: 400 }); }
  }

  const prev = await prisma.routineEventDefinition.findFirst({
    where: { id, communityId, status: "APPROVED" },
  });
  if (!prev) return NextResponse.json({ error: "Approved routine definition not found" }, { status: 404 });

  // Build the next-version DRAFT row (pure — never mutates prev), then strip the
  // relation/scalar fields Prisma create does not accept from the loaded row.
  const nextRow = applyRevision(prev as RoutineDefinitionRow & { version: number; id?: string }, edits, revisionReason);
  const { id: _id, createdAt: _c, updatedAt: _u, ...createData } = nextRow as Record<string, unknown>;
  void _id; void _c; void _u;

  let newId = "";
  try {
    const created = await prisma.routineEventDefinition.create({ data: createData as never, select: { id: true } });
    newId = created.id;
  } catch (err) {
    console.error("[routine revise] create failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not create the revision." }, { status: 500 });
  }

  logAudit({
    actorId: ctx.userId,
    actorRole: ctx.role,
    action: "CREATE",
    entityType: "routine-definitions",
    entityId: newId,
    organizationId: ctx.organizationId,
    communityId,
    after: { residentId: prev.residentId, status: "DRAFT", supersedesVersion: prev.version },
    reason: `Revised routine "${prev.name}" → v${prev.version + 1}${revisionReason ? `: ${revisionReason}` : ""}`,
  });

  return NextResponse.json({ id: newId });
}
