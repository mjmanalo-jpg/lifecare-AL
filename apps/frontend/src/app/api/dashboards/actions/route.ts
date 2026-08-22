import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { CAREGIVER_SCHEDULE_KEY, parseSchedules } from "@/lib/caregiverSchedule";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HELP_CATEGORIES = new Set([
  "CLINICAL_CHANGE", "UNSAFE", "SECOND_ASSIST", "REFUSAL",
  "BEHAVIOR_CONCERN", "MEDICATION_CONCERN", "OTHER",
]);

async function actorName(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  return user?.name?.trim() || "Staff member";
}

export async function POST(request: NextRequest) {
  const context = await requireTenantContext({ requireCommunity: true });
  if (!context?.communityId || !context.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");
  const name = await actorName(context.userId);

  if (action === "ACKNOWLEDGE_ASSIGNMENT") {
    if (context.role !== "CAREGIVER") return NextResponse.json({ error: "Only the assigned caregiver can acknowledge this assignment." }, { status: 403 });
    const setting = await prisma.appSetting.findFirst({
      where: { organizationId: context.organizationId, communityId: context.communityId, key: CAREGIVER_SCHEDULE_KEY },
      select: { id: true, value: true },
    });
    if (!setting) return NextResponse.json({ error: "The assignment roster was not found." }, { status: 404 });
    const assignmentId = String(body.assignmentId || "");
    const schedules = parseSchedules(setting.value);
    const assignment = schedules.find((item) => item.id === assignmentId);
    if (!assignment || assignment.caregiverUserId !== context.userId) {
      return NextResponse.json({ error: "This assignment is not assigned to your account." }, { status: 403 });
    }
    const acknowledgedAt = new Date().toISOString();
    const next = schedules.map((item) => item.id === assignmentId
      ? { ...item, acknowledgedAt, acknowledgedByUserId: context.userId }
      : item);
    await prisma.appSetting.update({ where: { id: setting.id }, data: { value: JSON.stringify(next) } });
    // Dual-write during the migration window. The legacy JSON roster remains
    // authoritative until the relational backfill is deployed and reconciled.
    await Promise.allSettled([
      prisma.$executeRaw`UPDATE "ShiftStaffAssignment" SET "acknowledgement" = 'ACKNOWLEDGED', "acknowledgedAt" = ${new Date(acknowledgedAt)}, "updatedAt" = NOW() WHERE "organizationId" = ${context.organizationId} AND "communityId" = ${context.communityId} AND "sourceLegacyId" = ${assignmentId}`,
      prisma.$executeRaw`UPDATE "ShiftResidentAssignment" SET "acknowledgement" = 'ACKNOWLEDGED', "acknowledgedAt" = ${new Date(acknowledgedAt)}, "updatedAt" = NOW() WHERE "organizationId" = ${context.organizationId} AND "communityId" = ${context.communityId} AND "sourceLegacyId" = ${assignmentId}`,
    ]);
    logAudit({
      actorId: context.userId, actorRole: context.role, action: "UPDATE",
      entityType: "caregiver-schedules", entityId: assignmentId,
      organizationId: context.organizationId, communityId: context.communityId,
      reason: "Caregiver acknowledged the current assignment version.",
      after: { acknowledgedAt, changeVersion: assignment.changeVersion || 1 },
    });
    return NextResponse.json({ ok: true, acknowledgedAt });
  }

  if (action === "REQUEST_HELP") {
    if (context.role !== "CAREGIVER") return NextResponse.json({ error: "Only a caregiver can raise this shift help request." }, { status: 403 });
    const residentId = String(body.residentId || "");
    if (!context.caregiverResidentIds?.includes(residentId)) {
      return NextResponse.json({ error: "Choose a resident in your current assignment." }, { status: 403 });
    }
    const category = HELP_CATEGORIES.has(String(body.category)) ? String(body.category) : "OTHER";
    const detail = String(body.detail || "").trim();
    if (detail.length < 4) return NextResponse.json({ error: "Describe what the nurse or second staff member needs to know." }, { status: 422 });
    const priority = ["CLINICAL_CHANGE", "UNSAFE", "MEDICATION_CONCERN"].includes(category) ? "URGENT" : "ROUTINE";
    const resident = await prisma.resident.findFirst({
      where: { id: residentId, organizationId: context.organizationId, communityId: context.communityId },
      select: { id: true },
    });
    if (!resident) return NextResponse.json({ error: "Resident not found." }, { status: 404 });
    const escalation = await prisma.escalation.create({
      data: {
        organizationId: context.organizationId, communityId: context.communityId, residentId,
        situation: category.replaceAll("_", " "), background: detail,
        assessment: body.observation ? String(body.observation).trim() : null,
        recommendation: category === "SECOND_ASSIST" ? "Second staff member requested." : "Nurse review requested.",
        priority, status: "OPEN", raisedBy: name, raisedByRole: "CAREGIVER", assignedToRole: "NURSE",
      },
    });
    try {
      const helpKind = category === "SECOND_ASSIST" ? "NEED_HELP" : "NEED_NURSE";
      const helpId = randomUUID();
      const observation = body.observation ? String(body.observation).trim() : null;
      await prisma.$executeRaw`INSERT INTO "StaffHelpRequest" ("id", "organizationId", "communityId", "residentId", "kind", "category", "detail", "observation", "priority", "requestedById", "recipientRole", "status", "escalationId", "createdAt", "updatedAt") VALUES (${helpId}, ${context.organizationId}, ${context.communityId}, ${residentId}, CAST(${helpKind} AS "HelpRequestKind"), ${category}, ${detail}, ${observation}, ${priority}, ${context.userId}, 'NURSE', 'OPEN', ${escalation.id}, NOW(), NOW())`;
    } catch (mirrorError) {
      // Safe before the migration is applied: the authoritative Escalation was
      // created and remains visible to the nurse; migration parity can retry.
      console.warn("[dashboard] relational help-request mirror unavailable", mirrorError instanceof Error ? mirrorError.message : mirrorError);
    }
    logAudit({
      actorId: context.userId, actorRole: context.role, action: "CREATE",
      entityType: "escalations", entityId: escalation.id,
      organizationId: context.organizationId, communityId: context.communityId,
      reason: "Caregiver raised Need Nurse / Need Help from My Shift.",
      after: { residentId, category, priority, assignedToRole: "NURSE" },
    });
    return NextResponse.json({ ok: true, escalationId: escalation.id }, { status: 201 });
  }

  if (action === "ACKNOWLEDGE_ESCALATION") {
    if (!["NURSE", "CARE_MANAGER", "FACILITY_ADMIN", "SUPERADMIN"].includes(context.role)) {
      return NextResponse.json({ error: "Your role cannot acknowledge clinical escalations." }, { status: 403 });
    }
    const escalationId = String(body.escalationId || "");
    const escalation = await prisma.escalation.findFirst({
      where: { id: escalationId, organizationId: context.organizationId, communityId: context.communityId },
      select: { id: true, status: true },
    });
    if (!escalation) return NextResponse.json({ error: "Escalation not found." }, { status: 404 });
    if (escalation.status !== "OPEN") return NextResponse.json({ ok: true, unchanged: true });
    const acknowledgedAt = new Date();
    await prisma.escalation.update({
      where: { id: escalation.id },
      data: { status: "ACKNOWLEDGED", acknowledgedBy: name, acknowledgedAt },
    });
    logAudit({
      actorId: context.userId, actorRole: context.role, action: "UPDATE",
      entityType: "escalations", entityId: escalation.id,
      organizationId: context.organizationId, communityId: context.communityId,
      reason: "Clinical escalation acknowledged from the role dashboard.",
      before: { status: escalation.status }, after: { status: "ACKNOWLEDGED", acknowledgedAt },
    });
    return NextResponse.json({ ok: true, acknowledgedAt });
  }

  return NextResponse.json({ error: "Unknown dashboard action." }, { status: 400 });
}
