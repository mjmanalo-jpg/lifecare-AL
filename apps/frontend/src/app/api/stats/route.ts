import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateSession } from "@/lib/auth";
import { isDbConfigured } from "@/lib/models";
import { DEMO_STATS } from "@/lib/demoData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Aggregated dashboard counters computed server-side in one round trip.
 * GET /api/stats
 */
export async function GET() {
  const role = await validateSession();
  if (!role) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isDbConfigured()) {
    return NextResponse.json({ ...DEMO_STATS, demo: true });
  }

  try {
    const [
      residents,
      activeIncidents,
      activeStaff,
      openTasks,
      pendingCallBells,
      overdueInvoices,
    ] = await Promise.all([
      prisma.resident.count(),
      prisma.incident.count({ where: { resolvedAt: null } }),
      prisma.staff.count({ where: { isActive: true } }),
      prisma.task.count({ where: { status: { in: ["PENDING", "IN_PROGRESS"] } } }),
      prisma.callBell.count({ where: { status: "PENDING" } }),
      prisma.invoice.count({ where: { status: "OVERDUE" } }),
    ]);

    return NextResponse.json({
      residents,
      activeIncidents,
      activeStaff,
      openTasks,
      pendingCallBells,
      overdueInvoices,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stats failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
