import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { appendCorrection, isEditableOccurrence, type Correction } from "@/lib/lifecare/occurrenceLifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// SLMS v4.2 Routine — append-only correction of a CLOSED/CANCELLED occurrence
// (sub-project #5, Correction unit). Once frozen, an occurrence's result/outcome
// are NEVER overwritten; an amendment is appended to `corrections` (who, when,
// original vs amended value, reason). An OPEN occurrence is edited via the normal
// complete/return flow, not here.
// ─────────────────────────────────────────────────────────────

const WRITE_ROLES = new Set(["NURSE", "CARE_MANAGER", "SUPERADMIN"]);
// The occurrence fields an amendment may reference (the frozen clinical record).
const CORRECTABLE = new Set([
  "careDeliveryOutcome", "exceptionReason", "clinicalFinding", "results",
  "escalationState", "workflowState",
]);

export async function POST(request: NextRequest) {
  const ctx = await requireTenantContext({});
  if (!ctx || ctx.isPlatform || !ctx.communityId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!WRITE_ROLES.has(ctx.role)) {
    logAudit({ actorId: ctx.userId, actorRole: ctx.role, action: "DENY", entityType: "routine-occurrences", entityId: "correct", organizationId: ctx.organizationId, communityId: ctx.communityId, reason: "Forbidden — role cannot correct an occurrence" });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const communityId = ctx.communityId;

  let body: { occId?: unknown; field?: unknown; amendedValue?: unknown; reason?: unknown } = {};
  try { body = (await request.json()) as typeof body; } catch { body = {}; }

  const occId = body.occId ? String(body.occId) : "";
  const field = body.field ? String(body.field) : "";
  const reason = body.reason ? String(body.reason) : "";
  if (!occId) return NextResponse.json({ error: "occId required" }, { status: 400 });
  if (!field || !CORRECTABLE.has(field)) return NextResponse.json({ error: "a correctable field is required" }, { status: 400 });
  if (!reason) return NextResponse.json({ error: "reason required" }, { status: 400 });

  const occ = await prisma.routineOccurrence.findFirst({ where: { occId, communityId } });
  if (!occ) return NextResponse.json({ error: "Occurrence not found" }, { status: 404 });

  // Corrections are the ONLY post-Closed write. An OPEN occurrence must be edited
  // in place instead — refuse rather than silently branch.
  if (isEditableOccurrence(occ)) {
    return NextResponse.json({ error: "edit the open occurrence instead" }, { status: 400 });
  }

  const originalValue = (occ as Record<string, unknown>)[field] ?? null;
  const entry: Correction = {
    field,
    originalValue,
    amendedValue: body.amendedValue ?? null,
    reason,
    userId: ctx.userId ?? "",
    at: new Date().toISOString(),
  };
  const corrections = appendCorrection((occ.corrections as unknown as Correction[] | null | undefined), entry);

  let updated;
  try {
    // NEVER overwrite the frozen result/outcome — only append to `corrections`.
    updated = await prisma.routineOccurrence.update({
      where: { id: occ.id },
      data: { corrections: corrections as never },
    });
  } catch (err) {
    console.error("[routine correct] update failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not record the correction." }, { status: 500 });
  }

  logAudit({
    actorId: ctx.userId,
    actorRole: ctx.role,
    action: "UPDATE",
    entityType: "routine-occurrences",
    entityId: occ.id,
    organizationId: ctx.organizationId,
    communityId,
    before: { field, originalValue },
    after: { field, amendedValue: entry.amendedValue },
    reason: `Correction on ${field} — ${reason}`,
  });

  return NextResponse.json({ occurrence: updated });
}
