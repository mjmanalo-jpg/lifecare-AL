import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDbConfigured } from "@/lib/models";
import { requireTenantContext } from "@/lib/tenant";
import type { IncidentType, IncidentSeverity } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * In-app camera fall/pre-fall → Incident + notifications. The browser camera
 * detector (CameraVisionFeed) already logs to the Camera Activity Log and raises
 * an SBAR escalation; this closes the loop by recording an Incident (so it lands
 * in Incident Reports and the family's Incident Alerts) and alerting BOTH the
 * care team AND the resident's family sponsor.
 *
 *   POST /api/monitoring/fall
 *   body: { residentId, kind: "FALL" | "PRE_FALL", confidence?, summary?, reason? }
 *
 * Authenticated (session). A family/resident caller may only raise for their own
 * resident; staff may raise for any resident in their community. Deduped so the
 * same fall detected by multiple open feeds records a single incident.
 */

const KIND_MAP: Record<string, { type: IncidentType; severity: IncidentSeverity; title: string }> = {
  FALL: { type: "FALL", severity: "CRITICAL", title: "Fall detected by camera" },
  PRE_FALL: { type: "SAFETY_HAZARD", severity: "MODERATE", title: "Pre-fall risk detected by camera" },
};
const DEDUPE_WINDOW_MS = 90_000; // one incident per resident+type per 90s

export async function POST(request: NextRequest) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const ctx = await requireTenantContext({ requireCommunity: true });
  if (!ctx?.communityId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const residentId = String(body.residentId || "").trim();
  const kind = String(body.kind || "FALL").toUpperCase();
  const mapped = KIND_MAP[kind] ?? KIND_MAP.FALL;
  if (!residentId) return NextResponse.json({ error: "Missing residentId" }, { status: 400 });

  const resident = await prisma.resident.findFirst({
    where: { id: residentId, communityId: ctx.communityId },
    select: { id: true, firstName: true, lastName: true, roomNumber: true, sponsorId: true, userId: true },
  });
  if (!resident) return NextResponse.json({ error: "Resident not found in your community" }, { status: 404 });

  // Authz: a family/resident caller may only raise for their own resident.
  const selfService = ctx.role === "FAMILY" || ctx.role === "RESIDENT";
  if (selfService && resident.sponsorId !== ctx.userId && resident.userId !== ctx.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const who = `${resident.firstName ?? ""} ${resident.lastName ?? ""}`.trim() || "Resident";
  const room = resident.roomNumber ? ` (Room ${resident.roomNumber})` : "";
  const conf = Number(body.confidence);
  const confPct = Number.isFinite(conf) && conf > 0 ? ` (confidence ${Math.round(conf * 100)}%)` : "";
  const detail = String(body.summary || body.reason || "").trim();

  // Dedupe: if the same incident type was recorded for this resident very
  // recently (another open feed already caught it), reuse it instead of stacking.
  const existing = await prisma.incident.findFirst({
    where: { residentId: resident.id, incidentType: mapped.type, incidentDate: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) } },
    select: { id: true },
    orderBy: { incidentDate: "desc" },
  });
  if (existing) return NextResponse.json({ ok: true, deduped: true, incidentId: existing.id });

  const description = kind === "FALL"
    ? `Fall detected for ${who}${room} by AI camera monitoring${confPct}. Immediate in-person assistance required.${detail ? ` ${detail}` : ""}`
    : `Pre-fall risk detected for ${who}${room} by AI camera monitoring. ${detail || "Check the resident before a fall occurs."}`;

  const numOrNull = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) !== 0 ? Number(v) : null);

  const incident = await prisma.incident.create({
    data: {
      organizationId: ctx.organizationId,
      communityId: ctx.communityId,
      residentId: resident.id,
      incidentType: mapped.type,
      severity: mapped.severity,
      title: mapped.title,
      description,
      location: resident.roomNumber ? `Room ${resident.roomNumber}` : null,
      followUpRequired: kind === "FALL",
      incidentDate: new Date(),
    },
  });

  // Camera Activity Log entry (the browser feed can't write this for family/
  // resident callers, so it's authored here so every fall shows in the log).
  try {
    await prisma.cameraMonitoringLog.create({
      data: {
        organizationId: ctx.organizationId,
        communityId: ctx.communityId,
        residentId: resident.id,
        residentName: who,
        roomNumber: resident.roomNumber,
        logType: kind === "FALL" ? "FALL_DETECTION" : "ANALYSIS",
        alert: true,
        alertReason: kind === "FALL" ? "Fall detected — resident requires immediate assistance." : "Pre-fall risk — check the resident.",
        summary: description,
        emotion: body.emotion ? String(body.emotion) : null,
        behavior: body.behavior ? String(body.behavior) : null,
        posture: body.posture ? String(body.posture) : null,
        sleepState: body.sleepState ? String(body.sleepState) : null,
        heartRate: numOrNull(body.heartRate),
        temperature: numOrNull(body.temperature),
        oxygen: numOrNull(body.oxygen),
        cameraId: "hybrid",
      },
    });
  } catch (e) {
    console.error("[monitoring/fall] camera log failed:", e instanceof Error ? e.message : e);
  }

  // SBAR escalation (EMERGENCY) — for confirmed falls only.
  if (kind === "FALL") {
    try {
      await prisma.escalation.create({
        data: {
          organizationId: ctx.organizationId,
          communityId: ctx.communityId,
          residentId: resident.id,
          situation: `Automated fall detection — ${who}${room} appears to have fallen and is on the floor${confPct}.`,
          background: "Detected on-device by camera vision (pose + motion): the resident went horizontal on the floor and stayed still through the confirmation window.",
          assessment: "Possible fall with risk of injury — needs an immediate in-person check.",
          recommendation: "Dispatch a caregiver/nurse to the room now to assess the resident and take vitals.",
          priority: "EMERGENCY",
          status: "OPEN",
          raisedBy: "Automated Fall Detection",
          raisedByRole: "SYSTEM",
          assignedToRole: "NURSE",
          relatedIncidentId: incident.id,
        },
      });
    } catch (e) {
      console.error("[monitoring/fall] escalation failed:", e instanceof Error ? e.message : e);
    }
  }

  // Fan out notifications: care team + family sponsor + resident.
  try {
    const critical = mapped.severity === "CRITICAL" || mapped.severity === "SEVERE";
    const staff = await prisma.communityMembership.findMany({
      where: { communityId: ctx.communityId, status: "ACTIVE", role: { in: ["FACILITY_ADMIN", "CARE_MANAGER", "NURSE", "CAREGIVER"] } },
      select: { userId: true },
    });
    const staffMsg = `${who}${room}: ${mapped.title.toLowerCase()}${confPct}. Review immediately.`;
    const familyMsg = kind === "FALL"
      ? `A fall was detected for ${who}${room} by camera monitoring. Care staff have been alerted and are responding.`
      : `A pre-fall risk was detected for ${who}${room}. Care staff have been notified to check in.`;

    const recipients = new Map<string, string>(); // userId -> message (dedupe users)
    for (const s of staff) if (s.userId) recipients.set(s.userId, staffMsg);
    if (resident.sponsorId) recipients.set(resident.sponsorId, familyMsg);
    if (resident.userId) recipients.set(resident.userId, familyMsg);

    if (recipients.size) {
      await prisma.notification.createMany({
        data: [...recipients].map(([userId, message]) => ({
          userId,
          type: "INCIDENT_REPORT" as const,
          title: mapped.title,
          message,
          severity: critical ? "CRITICAL" : "WARNING",
          relatedEntityId: incident.id,
          relatedEntityType: "incident",
          organizationId: ctx.organizationId,
          communityId: ctx.communityId,
        })),
      });
    }
  } catch (e) {
    console.error("[monitoring/fall] notify failed:", e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ ok: true, incidentId: incident.id, residentId: resident.id, kind }, { status: 201 });
}
