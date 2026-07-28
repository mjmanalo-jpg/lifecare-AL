import { NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/tenant";
import { isDbConfigured } from "@/lib/models";
import { DEMO_STATS } from "@/lib/demoData";
import { withTenantDb } from "@/lib/tenantDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const context = await requireTenantContext({ requireCommunity: true });
  if (!context?.communityId) return NextResponse.json({ error: "Select a community" }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ ...DEMO_STATS, demo: true });
  const communityId = context.communityId;
  try {
    const [residents, activeIncidents, activeStaff, openTasks, pendingCallBells, overdueInvoices] = await withTenantDb(context, async (tx) => Promise.all([
      tx.resident.count({ where: { communityId } }),
      tx.incident.count({ where: { resolvedAt: null, resident: { communityId } } }),
      tx.staff.count({ where: { communityId, isActive: true } }),
      tx.task.count({ where: { communityId, status: { in: ["PENDING", "IN_PROGRESS"] } } }),
      tx.callBell.count({ where: { status: { in: ["PENDING", "RESPONDED"] }, resident: { communityId } } }),
      tx.invoice.count({ where: { status: "OVERDUE", resident: { communityId } } }),
    ]));
    return NextResponse.json({ residents, activeIncidents, activeStaff, openTasks, pendingCallBells, overdueInvoices });
  } catch {
    return NextResponse.json({ error: "Stats failed" }, { status: 500 });
  }
}