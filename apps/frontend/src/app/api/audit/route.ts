import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Semantic audit for client-driven staff actions that DON'T flow through
// /api/db — clock in/out, ADL and weight entries (all stored in app-settings).
// Those writes would otherwise land in the trail as an opaque "System setting"
// update. This records a meaningful, per-action line instead.
//
// The actor is ALWAYS the authenticated user (never trusted from the client),
// so a caregiver can only ever attribute activity to themselves — and their
// name is backfilled from the user record by logAudit().
// ─────────────────────────────────────────────────────────────

const ALLOWED_ACTIONS = new Set(["CREATE", "UPDATE", "DELETE", "LOGIN", "LOGOUT"]);
// Semantic entities for clinical/operational actions that persist outside
// /api/db (mostly app-settings or dedicated routes). The actor is always the
// authenticated user, so an entry can only ever be attributed to whoever made
// the request — never forged onto another staff member.
const ALLOWED_ENTITIES = new Set([
  "attendance", "weight-logs", "adl-logs",
  "med-inventory", "pharmacy-inventory", "pharmacy-dispense",
  "shift-endorsements", "physician-communications",
  "admissions", "assessments",
  "staff-profiles", "caregiver-schedules",
]);

export async function POST(request: NextRequest) {
  const ctx = await requireTenantContext({});
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try { body = (await request.json()) as Record<string, unknown>; } catch { body = {}; }

  const action = String(body.action || "");
  const entityType = String(body.entityType || "");
  const entityId = String(body.entityId || "");
  if (!ALLOWED_ACTIONS.has(action) || !ALLOWED_ENTITIES.has(entityType) || !entityId) {
    return NextResponse.json({ error: "Invalid audit entry" }, { status: 400 });
  }

  // Resident context (optional) is stashed in `after` so the Audit Trail can
  // render a Resident column — AuditLog has no residentId column of its own.
  const residentId = body.residentId != null ? String(body.residentId) : undefined;
  const residentName = body.residentName != null ? String(body.residentName) : undefined;
  const after = residentId || residentName ? { residentId, residentName } : undefined;

  logAudit({
    actorId: ctx.userId,
    actorRole: ctx.role,
    action: action as "CREATE" | "UPDATE" | "DELETE" | "LOGIN" | "LOGOUT",
    entityType,
    entityId,
    organizationId: ctx.organizationId ?? undefined,
    communityId: ctx.communityId ?? undefined,
    reason: body.reason != null ? String(body.reason) : undefined,
    after,
  });

  return NextResponse.json({ ok: true });
}
