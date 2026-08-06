import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDbConfigured } from "@/lib/models";
import { resolveSensorKey } from "@/lib/sensorAuth";
import { CAMERA_REGISTRY_KEY, parseCameras } from "@/lib/cameraRegistry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Camera / sensor liveness heartbeat. An edge box (or the camera backend) POSTs
 * this on an interval so the registry shows each device online/offline without
 * anyone being logged in.
 *
 *   POST /api/sensors/heartbeat
 *   headers: { "x-api-key": "<facility ingest key>" }
 *   body: { cameraId? | roomNumber?, status?, communityId? }
 */
export async function POST(request: NextRequest) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const apiKey = request.headers.get("x-api-key") || "";
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const match = await resolveSensorKey(apiKey, body.communityId ? String(body.communityId) : undefined);
  if (!match) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const row = await prisma.appSetting.findFirst({
    where: { key: CAMERA_REGISTRY_KEY, communityId: match.communityId },
    select: { id: true, value: true },
  });
  if (!row) return NextResponse.json({ error: "No camera registry for this community" }, { status: 404 });

  const cams = parseCameras(row.value);
  const camId = body.cameraId ? String(body.cameraId) : "";
  const room = body.roomNumber ? String(body.roomNumber) : "";
  const cam = cams.find((c) => (camId && c.id === camId) || (room && c.roomNumber === room));
  if (!cam) return NextResponse.json({ error: "Camera not found in registry" }, { status: 404 });

  cam.lastSeenAt = new Date().toISOString();
  cam.lastStatus = body.status ? String(body.status) : "online";
  try {
    await prisma.appSetting.update({ where: { id: row.id }, data: { value: JSON.stringify(cams) } });
  } catch (e) {
    return NextResponse.json({ error: "Failed to record heartbeat", detail: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  return NextResponse.json({ ok: true, cameraId: cam.id, lastSeenAt: cam.lastSeenAt });
}
