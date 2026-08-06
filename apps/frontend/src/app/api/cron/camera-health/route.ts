import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext } from "@/lib/tenant";
import { scanCameraHealth } from "@/lib/cameraHealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Camera health watchdog endpoint. The scan also runs inside the main alerts
 * cron (every 15 min) so no separate Vercel cron entry is required; this route
 * lets a Facility Admin / Super Admin trigger it on demand for their community,
 * or a Vercel cron hit it directly (Bearer CRON_SECRET → all communities).
 */
async function run(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const isCron = Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;

  let communities: { id: string; organizationId: string | null }[] = [];
  if (isCron) {
    communities = await prisma.community.findMany({ where: { isActive: true }, select: { id: true, organizationId: true } });
  } else {
    const ctx = await requireTenantContext({});
    if (!ctx || ctx.isPlatform || !ctx.communityId || !["FACILITY_ADMIN", "SUPERADMIN"].includes(ctx.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    communities = [{ id: ctx.communityId, organizationId: ctx.organizationId ?? null }];
  }

  let alerted = 0;
  for (const c of communities) {
    try { alerted += await scanCameraHealth(c.id, c.organizationId); }
    catch (e) { console.error("[camera-health] scan failed for", c.id, e instanceof Error ? e.message : e); }
  }
  return NextResponse.json({ ok: true, communities: communities.length, offlineAlertsSent: alerted });
}

export async function GET(request: NextRequest) { return run(request); }
export async function POST(request: NextRequest) { return run(request); }
