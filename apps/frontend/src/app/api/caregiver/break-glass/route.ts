import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import {
  CAREGIVER_BREAKGLASS_KEY, parseBreakglass, currentShiftEnd,
  newScheduleId, type BreakGlassGrant,
} from "@/lib/caregiverSchedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Break-glass — a caregiver's emergency access to a resident NOT on their
 * active shift schedule. The grant is server-authored (never a client-writable
 * app-setting), lives only until the end of the current shift, and notifies the
 * nursing team so the override is visible and accountable.
 *
 *  GET  → residents in the community (id/name/room) for the break-glass picker.
 *  POST → grant emergency access to one resident; notify Nurse + Care Manager.
 *
 * Only a CAREGIVER breaks glass — every other clinical role already sees the
 * whole community.
 */

async function scopedSetting(orgId: string | undefined, communityId: string | undefined) {
  return prisma.appSetting.findFirst({
    where: { organizationId: orgId, communityId, key: CAREGIVER_BREAKGLASS_KEY },
    select: { id: true, value: true },
  });
}

export async function GET() {
  const context = await requireTenantContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (context.role !== "CAREGIVER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!context.communityId) return NextResponse.json({ error: "Select a community" }, { status: 409 });

  const residents = await prisma.resident.findMany({
    where: { communityId: context.communityId },
    select: { id: true, firstName: true, lastName: true, roomNumber: true },
    orderBy: [{ roomNumber: "asc" }, { lastName: "asc" }],
  });
  const assigned = new Set(context.caregiverResidentIds ?? []);
  const data = residents.map((r) => ({
    id: r.id,
    name: `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || "Resident",
    room: r.roomNumber ?? "",
    assigned: assigned.has(r.id),
  }));
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const context = await requireTenantContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (context.role !== "CAREGIVER") return NextResponse.json({ error: "Only caregivers break glass." }, { status: 403 });
  if (!context.communityId || !context.organizationId) return NextResponse.json({ error: "Select a community" }, { status: 409 });

  const body = await request.json().catch(() => null);
  const residentId = String((body as { residentId?: unknown } | null)?.residentId ?? "").trim();
  const reason = String((body as { reason?: unknown } | null)?.reason ?? "").trim();
  if (!residentId) return NextResponse.json({ error: "A resident is required" }, { status: 422 });
  if (reason.length < 4) return NextResponse.json({ error: "A reason is required" }, { status: 422 });

  // The resident must exist in this community (community-scoped, deliberately not
  // caregiver-scoped — the whole point is to reach a resident off your roster).
  const resident = await prisma.resident.findFirst({
    where: { id: residentId, communityId: context.communityId },
    select: { id: true, firstName: true, lastName: true, roomNumber: true },
  });
  if (!resident) return NextResponse.json({ error: "Resident not found" }, { status: 404 });

  const me = await prisma.user.findUnique({ where: { id: context.userId }, select: { name: true } });
  const now = new Date();
  const residentName = `${resident.firstName ?? ""} ${resident.lastName ?? ""}`.trim() || "Resident";
  const grant: BreakGlassGrant = {
    id: newScheduleId(),
    caregiverUserId: context.userId,
    caregiverName: me?.name ?? undefined,
    residentId,
    residentName,
    reason,
    at: now.toISOString(),
    expiresAt: currentShiftEnd(now).toISOString(),
  };

  // Append to the (server-only) break-glass setting, pruning expired grants.
  const existing = await scopedSetting(context.organizationId, context.communityId);
  const kept = parseBreakglass(existing?.value).filter((g) => new Date(g.expiresAt) > now);
  const next = [grant, ...kept];
  const settingId = `${context.organizationId}:${context.communityId}:${CAREGIVER_BREAKGLASS_KEY}`;
  await prisma.appSetting.upsert({
    where: { id: settingId },
    create: {
      id: settingId, key: CAREGIVER_BREAKGLASS_KEY, value: JSON.stringify(next),
      organizationId: context.organizationId, communityId: context.communityId,
    },
    update: { value: JSON.stringify(next) },
  });

  // Notify the nursing team — break-glass must be visible and accountable.
  const recipients = await prisma.communityMembership.findMany({
    where: { communityId: context.communityId, status: "ACTIVE", role: { in: ["NURSE", "CARE_MANAGER"] } },
    select: { userId: true },
  });
  if (recipients.length) {
    const roomTag = resident.roomNumber ? ` (Rm ${resident.roomNumber})` : "";
    await prisma.notification.createMany({
      data: recipients.map((m) => ({
        userId: m.userId,
        type: "SYSTEM_ALERT" as const,
        title: "Break-glass access used",
        message: `${grant.caregiverName ?? "A caregiver"} opened emergency access to ${residentName}${roomTag} — "${reason}". Access expires at end of shift.`,
        severity: "WARNING",
        relatedEntityId: residentId,
        relatedEntityType: "resident",
        organizationId: context.organizationId,
        communityId: context.communityId,
      })),
    }).catch(() => null);
  }

  logAudit({
    actorId: context.userId, actorRole: context.role, action: "UPDATE",
    entityType: "caregiver-break-glass", entityId: residentId,
    organizationId: context.organizationId, communityId: context.communityId,
    after: { residentId, residentName, reason, expiresAt: grant.expiresAt },
  });

  return NextResponse.json({ ok: true, expiresAt: grant.expiresAt, residentName });
}
