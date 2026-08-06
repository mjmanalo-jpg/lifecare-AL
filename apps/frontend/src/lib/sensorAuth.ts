import crypto from "node:crypto";
import { prisma } from "./prisma";

/**
 * Shared API-key auth for external device endpoints (sensor events, camera
 * heartbeats). A key maps to a community either via a per-community
 * `sensor_ingest_key` AppSetting (preferred) or the global SENSOR_INGEST_API_KEY
 * env (in which case the caller must name the community).
 */
export interface SensorKeyMatch {
  communityId: string;
  organizationId: string | null;
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export async function resolveSensorKey(apiKey: string, bodyCommunityId?: string): Promise<SensorKeyMatch | null> {
  if (!apiKey) return null;
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
  // 2) Global env key — the caller must name the community it's for.
  const envKey = process.env.SENSOR_INGEST_API_KEY;
  if (envKey && timingSafeEqual(envKey, apiKey) && bodyCommunityId) {
    const comm = await prisma.community.findUnique({ where: { id: bodyCommunityId }, select: { id: true, organizationId: true } });
    if (comm) return { communityId: comm.id, organizationId: comm.organizationId ?? null };
  }
  return null;
}
