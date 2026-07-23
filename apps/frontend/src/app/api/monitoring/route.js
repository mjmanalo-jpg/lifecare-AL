import { NextResponse } from "next/server";
import { requireTenantContext, tenantWhere } from "@/lib/tenant";
import { withTenantDb } from "@/lib/tenantDb";
import { assertMutationEntitled } from "@/lib/entitlements";

export async function GET() {
  const context = await requireTenantContext({ requireCommunity: true });
  if (!context?.communityId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const residents = await withTenantDb(context, (tx) => tx.resident.findMany({
    where: tenantWhere("residents", context),
    select: {
      id: true,
      firstName: true,
      lastName: true,
      roomNumber: true,
      cameraMonitoringLogs: { orderBy: { createdAt: "desc" }, take: 1, select: { behavior: true, posture: true, alert: true, createdAt: true } },
    },
    orderBy: { roomNumber: "asc" },
  }));
  const data = residents.map((resident) => {
    const latest = resident.cameraMonitoringLogs[0];
    return { id: resident.id, name: `${resident.firstName} ${resident.lastName}`, room: resident.roomNumber, sleeping: latest?.behavior === "SLEEPING", position: latest?.posture || "unknown", lastUpdate: latest?.createdAt || null, alerts: latest?.alert ? 1 : 0 };
  });
  return NextResponse.json({ residents: data, summary: { total: data.length, sleeping: data.filter((item) => item.sleeping).length, awake: data.filter((item) => !item.sleeping).length, alerts: data.reduce((sum, item) => sum + item.alerts, 0) } });
}

export async function POST(req) {
  const context = await requireTenantContext({ requireCommunity: true });
  if (!context?.organizationId || !context.communityId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await assertMutationEntitled(context, "camera-monitoring-logs");
  const body = await req.json();
  const residentId = String(body.residentId || "");
  const resident = await withTenantDb(context, (tx) => tx.resident.findFirst({ where: { AND: [tenantWhere("residents", context), { id: residentId }] }, select: { id: true, firstName: true, lastName: true, roomNumber: true } }));
  if (!resident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const created = await withTenantDb(context, (tx) => tx.cameraMonitoringLog.create({ data: { organizationId: context.organizationId, communityId: context.communityId, residentId, residentName: `${resident.firstName} ${resident.lastName}`, roomNumber: resident.roomNumber, behavior: body.sleeping ? "SLEEPING" : "AWAKE", posture: String(body.position || "unknown"), alert: Boolean(body.sleeping), logType: "ANALYSIS" } }));
  return NextResponse.json(created, { status: 201 });
}