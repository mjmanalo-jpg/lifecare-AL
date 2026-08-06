import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { isDbConfigured } from "@/lib/models";
import type { IncidentType, IncidentSeverity } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sensor event ingestion — a device-agnostic doorway for EXTERNAL detectors
 * (WiFi-CSI fall sensors, bed pressure mats, radar, wearables) to feed the same
 * fall/safety pipeline the in-app camera detector uses. There is no user
 * session, so it authenticates with an API key, resolves the resident from the
 * room/id, records an Incident, and alerts the care team.
 *
 *   POST /api/sensors/event
 *   headers: { "x-api-key": "<facility ingest key>" }
 *   body: { event, roomNumber? | residentId?, confidence?, source?, note?, communityId? }
 *
 * The key is matched to a community two ways:
 *   1) a per-community AppSetting `sensor_ingest_key` (preferred — the key maps
 *      to its own community, so nothing else is needed in the body); or
 *   2) the global env SENSOR_INGEST_API_KEY, in which case the body must name
 *      the `communityId` to attach the event to.
 */

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// External event → (incidentType, severity, title). Unknown events log as OTHER.
const EVENT_MAP: Record<string, { type: IncidentType; severity: IncidentSeverity; title: string }> = {
  FALL: { type: "FALL", severity: "CRITICAL", title: "Fall detected by sensor" },
  FALL_LIKE: { type: "FALL", severity: "SEVERE", title: "Possible fall detected by sensor" },
  BED_EXIT: { type: "SAFETY_HAZARD", severity: "MODERATE", title: "Bed exit detected by sensor" },
  LEAVING_BED: { type: "SAFETY_HAZARD", severity: "MODERATE", title: "Leaving bed detected by sensor" },
  PROLONGED_INACTIVITY: { type: "SAFETY_HAZARD", severity: "MODERATE", title: "Prolonged inactivity detected by sensor" },
  WANDERING: { type: "BEHAVIORAL", severity: "MODERATE", title: "Wandering detected by sensor" },
};

interface KeyMatch { communityId: string; organizationId: string | null; }

async function resolveKey(apiKey: string, bodyCommunityId?: string): Promise<KeyMatch | null> {
  // 1) Per-community key stored in app-settings.
  const rows = await prisma.appSetting.findMany({
    where: { key: "sensor_ingest_key" },
    select: { value: true, communityId: true, organizationId: true },
  });
  for (const r of rows) {
    if (r.value && r.communityId && timingSafeEqual(r.value, apiKey)) {
      return { communityId: r.communityId, organizationId: r.organizationId ?? null };
    }
  }
  // 2) Global env key — the body must name the community it's for.
  const envKey = process.env.SENSOR_INGEST_API_KEY;
  if (envKey && timingSafeEqual(envKey, apiKey) && bodyCommunityId) {
    const comm = await prisma.community.findUnique({ where: { id: bodyCommunityId }, select: { id: true, organizationId: true } });
    if (comm) return { communityId: comm.id, organizationId: comm.organizationId ?? null };
  }
  return null;
}

export async function POST(request: NextRequest) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const apiKey = request.headers.get("x-api-key") || "";
  if (!apiKey) return NextResponse.json({ error: "Missing x-api-key" }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const match = await resolveKey(apiKey, body.communityId ? String(body.communityId) : undefined);
  if (!match) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const eventKey = String(body.event ?? "").trim().toUpperCase();
  if (!eventKey) return NextResponse.json({ error: "Missing event" }, { status: 400 });
  const mapped = EVENT_MAP[eventKey] ?? { type: "OTHER" as IncidentType, severity: "MODERATE" as IncidentSeverity, title: `Sensor event: ${eventKey}` };

  // Resolve the resident this event belongs to, within the key's community.
  const residentId = body.residentId ? String(body.residentId).trim() : "";
  const roomNumber = body.roomNumber ? String(body.roomNumber).trim() : "";
  let resident: { id: string; firstName: string | null; lastName: string | null; roomNumber: string | null } | null = null;
  try {
    if (residentId) {
      resident = await prisma.resident.findFirst({ where: { id: residentId, communityId: match.communityId }, select: { id: true, firstName: true, lastName: true, roomNumber: true } });
    } else if (roomNumber) {
      resident = await prisma.resident.findFirst({ where: { communityId: match.communityId, roomNumber, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true, roomNumber: true } });
    }
  } catch { /* fall through to 422 */ }
  if (!resident) {
    return NextResponse.json({ error: "No matching resident for the given residentId/roomNumber in this community" }, { status: 422 });
  }

  const confidence = typeof body.confidence === "number" ? body.confidence : Number(body.confidence);
  const source = body.source ? String(body.source) : "external sensor";
  const note = body.note ? String(body.note) : "";
  const who = `${resident.firstName ?? ""} ${resident.lastName ?? ""}`.trim() || "Resident";
  const confPct = Number.isFinite(confidence) ? ` (${Math.round(confidence * 100)}% confidence)` : "";

  try {
    const incident = await prisma.incident.create({
      data: {
        residentId: resident.id,
        communityId: match.communityId,
        organizationId: match.organizationId,
        incidentType: mapped.type,
        severity: mapped.severity,
        title: mapped.title,
        description: `${mapped.title} for ${who}${resident.roomNumber ? ` in Room ${resident.roomNumber}` : ""} via ${source}${confPct}.${note ? ` ${note}` : ""}`,
        location: resident.roomNumber ? `Room ${resident.roomNumber}` : null,
        followUpRequired: mapped.type === "FALL",
        incidentDate: new Date(),
      },
    });

    // Alert the care team — mirrors the in-app severe-incident auto-alert.
    try {
      const staff = await prisma.communityMembership.findMany({
        where: { communityId: match.communityId, status: "ACTIVE", role: { in: ["FACILITY_ADMIN", "CARE_MANAGER", "NURSE", "CAREGIVER"] } },
        select: { userId: true },
      });
      const critical = mapped.severity === "CRITICAL" || mapped.severity === "SEVERE";
      if (staff.length) {
        await prisma.notification.createMany({
          data: staff.map((s) => ({
            userId: s.userId,
            type: "INCIDENT_REPORT" as const,
            title: mapped.title,
            message: `${who}${resident.roomNumber ? ` (Room ${resident.roomNumber})` : ""}: ${mapped.title.toLowerCase()} via ${source}${confPct}. Review immediately.`,
            severity: critical ? "CRITICAL" : "WARNING",
            relatedEntityId: incident.id,
            relatedEntityType: "incident",
            organizationId: match.organizationId,
            communityId: match.communityId,
          })),
        });
      }
    } catch (e) {
      console.error("[sensor ingest] alert failed:", e instanceof Error ? e.message : e);
    }

    return NextResponse.json({ ok: true, incidentId: incident.id, residentId: resident.id, event: eventKey }, { status: 201 });
  } catch (error) {
    console.error("[sensor ingest] create failed:", error);
    return NextResponse.json({ error: "Failed to record event", detail: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
