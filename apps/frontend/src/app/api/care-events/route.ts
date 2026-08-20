import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { OUTCOMES, classifyOutcome, evaluateVariance, VARIANCE_REVIEW_THRESHOLD, type Outcome } from "@/lib/lifecare/careEvents";
import { MODEL_VERSION } from "@/lib/lifecare/dataset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Care Events — the governed feedback layer that fires the signals.
//
// A caregiver completing (or varying) a care-plan task posts a Care Event here.
// classifyOutcome() (Care Event Master + Today's-Care escalation matrix) decides
// the archetype + escalation action; this route persists the event AND acts on it:
//   • immediateEscalation → SBAR escalation into the clinical chain of command,
//   • an exception → nurse / care-manager notification,
//   • repeat material variances → a reassessment REVIEW alert (never auto-changes
//     level or fee — a human authorises any change).
// ─────────────────────────────────────────────────────────────

const str = (v: unknown) => (v == null ? undefined : String(v));

export async function POST(request: NextRequest) {
  const ctx = await requireTenantContext({});
  if (!ctx || ctx.isPlatform || !ctx.communityId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const communityId = ctx.communityId;
  const organizationId = ctx.organizationId ?? undefined;

  let body: Record<string, unknown> = {};
  try { body = (await request.json()) as Record<string, unknown>; } catch { body = {}; }

  const residentId = str(body.residentId);
  if (!residentId) return NextResponse.json({ error: "residentId required" }, { status: 400 });
  const rawOutcome = str(body.outcome) || "Completed";
  const outcome: Outcome = (OUTCOMES as readonly string[]).includes(rawOutcome) ? (rawOutcome as Outcome) : "Completed";
  const careTaskId = str(body.careTaskId) ?? null;   // Care Task Master id (routine linkage)
  const carePlanId = str(body.carePlanId);
  const actorName = str(body.actorName) || "Caregiver";
  const observation = str(body.observation);

  const c = classifyOutcome(outcome);

  // Resident (name/room) — also guards the resident is in this community.
  const resident = await prisma.resident.findFirst({
    where: { id: residentId, communityId },
    select: { firstName: true, lastName: true, roomNumber: true },
  });
  const residentName = resident ? `${resident.firstName ?? ""} ${resident.lastName ?? ""}`.trim() || undefined : undefined;
  const room = resident?.roomNumber ?? "—";

  const memberships = await prisma.communityMembership.findMany({
    where: { communityId, status: "ACTIVE", role: { in: ["NURSE", "CARE_MANAGER"] } },
    select: { userId: true },
  });
  const nurseIds = [...new Set(memberships.map((m) => m.userId))];

  // Repeat-variance → reassessment review. Count this resident's recent variances
  // (scoped to the same routine when known); this event tips the counter over.
  let reviewAlertRaised = false;
  if (c.isVariance) {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const prior = await prisma.careEvent.count({
      where: { communityId, residentId, isVariance: true, createdAt: { gte: since }, ...(careTaskId ? { taskId: careTaskId } : {}) },
    });
    reviewAlertRaised = evaluateVariance(prior + 1).raiseReviewAlert;
  }

  const escalate = c.immediateEscalation;
  const emergency = c.emergencyPathway;
  const notifyNurse = c.escalationAction !== "none" || reviewAlertRaised;

  // 1) Persist the governed care event.
  const created = await prisma.careEvent.create({
    data: {
      organizationId, communityId, residentId, residentName,
      eventName: c.outcome, domain: str(body.domain), eventType: c.isExpected ? "Expected" : "Exception",
      archetype: c.archetype, modelVersion: MODEL_VERSION as unknown as string,
      taskId: careTaskId ?? undefined, carePlanId,
      outcome,
      assistanceDelivered: str(body.assistanceDelivered),
      quantValue: str(body.quantValue),
      residentResponse: str(body.residentResponse),
      observation,
      exceptionDetail: str(body.exceptionDetail),
      isException: c.isException,
      isVariance: c.isVariance,
      varianceType: c.isVariance ? outcome : undefined,
      immediateEscalation: escalate,
      linkedDecisionTree: c.linkedDecisionTree,
      escalationAction: c.escalationAction,
      reviewAlertRaised,
      shift: str(body.shift),
      actorId: ctx.userId, actorName,
    },
    select: { id: true },
  });

  // 2) Safety escalation (SBAR) — unsafe/critical events enter the chain of
  //    command. Acute events flagged for the emergency pathway direct the nurse
  //    to the emergency protocol (DT-010) — never delayed or gated by revenue.
  if (escalate) {
    try {
      await prisma.escalation.create({
        data: {
          organizationId, communityId, residentId,
          situation: `${emergency ? "EMERGENCY PATHWAY — " : ""}${residentName || "Resident"} (Room ${room}) — care task outcome "${outcome}"${c.linkedDecisionTree ? ` (${c.linkedDecisionTree})` : ""}.${observation ? ` ${observation}` : ""}`,
          recommendation: emergency
            ? `Assess the resident immediately. Initiate the emergency protocol (${c.emergencyProtocol ?? "DT-010"}) and call emergency services if clinically indicated; then review the care plan.`
            : "Assess the resident and intervene per protocol; review the care plan.",
          priority: "URGENT", status: "OPEN",
          raisedBy: actorName, raisedByRole: "CAREGIVER", assignedToRole: "NURSE",
        },
      });
    } catch { /* best-effort */ }
  }

  // 3) Notify the clinical team (exception / escalation / reassessment).
  if (notifyNurse && nurseIds.length) {
    const title = escalate ? `Care event — ${outcome}` : reviewAlertRaised ? "Reassessment recommended" : `Care variance — ${outcome}`;
    const message = reviewAlertRaised
      ? `${residentName || "A resident"} (Room ${room}) has ${VARIANCE_REVIEW_THRESHOLD}+ material variances in the last 30 days — review the care plan / level of care (no automatic change).`
      : `${residentName || "A resident"} (Room ${room}): "${outcome}" on a care-plan task, logged by ${actorName}.${observation ? ` ${observation}` : ""}`;
    try {
      await prisma.notification.createMany({
        data: nurseIds.map((userId) => ({
          userId, type: "SYSTEM_ALERT" as never, title, message,
          severity: escalate ? "CRITICAL" : "WARNING",
          relatedEntityId: created.id, relatedEntityType: "careEvent",
          organizationId, communityId,
        })),
      });
    } catch { /* best-effort */ }
  }

  // Audit trail — the caregiver's care delivery (task completion / variance)
  // recorded against their name, visible to Nurse + Care Manager.
  logAudit({
    actorId: ctx.userId,
    actorName: actorName,
    actorRole: ctx.role,
    action: "CREATE",
    entityType: "care-events",
    entityId: created.id,
    organizationId,
    communityId,
    after: { residentId, residentName },
    reason: `Care delivered${residentName ? ` for ${residentName}` : ""} — "${outcome}"${c.isVariance ? " (variance)" : ""}${observation ? `: ${observation}` : ""}`,
  });

  return NextResponse.json({ ok: true, eventId: created.id, escalated: escalate, emergency, notified: notifyNurse && nurseIds.length > 0, reviewAlertRaised });
}
