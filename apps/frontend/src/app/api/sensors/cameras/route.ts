import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDbConfigured } from "@/lib/models";
import { resolveSensorKey } from "@/lib/sensorAuth";
import { CAMERA_REGISTRY_KEY, parseCameras } from "@/lib/cameraRegistry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Camera registry for the always-on backend fall watchdog.
 *
 *   GET /api/sensors/cameras
 *   headers: { "x-api-key": "<facility ingest key>" }
 *   -> { cameras: [{ id, name, roomNumber, type, streamUrl, rtspUrl, enabled }] }
 *
 * Authenticated with the same sensor-ingest key as /api/sensors/event, so the
 * headless backend can discover which cameras (and rooms) it should monitor
 * without a user session. Returns only ENABLED cameras for the key's community.
 */
export async function GET(request: NextRequest) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const apiKey = request.headers.get("x-api-key") || "";
  if (!apiKey) return NextResponse.json({ error: "Missing x-api-key" }, { status: 401 });

  const communityId = request.nextUrl.searchParams.get("communityId") || undefined;
  const match = await resolveSensorKey(apiKey, communityId);
  if (!match) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const row = await prisma.appSetting.findFirst({
    where: { key: CAMERA_REGISTRY_KEY, communityId: match.communityId },
    select: { value: true },
  });
  const cameras = parseCameras(row?.value)
    .filter((c) => c.enabled)
    .map((c) => ({
      id: c.id,
      name: c.name,
      roomNumber: c.roomNumber,
      type: c.type,
      streamUrl: c.streamUrl,
      rtspUrl: c.rtspUrl ?? null,
      enabled: c.enabled,
    }));

  return NextResponse.json({ ok: true, communityId: match.communityId, cameras });
}
