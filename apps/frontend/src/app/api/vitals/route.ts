import { NextRequest, NextResponse } from "next/server";
import { VitalType } from "@prisma/client";
import { requireTenantContext, tenantWhere } from "@/lib/tenant";
import { withTenantDb } from "@/lib/tenantDb";
import { isDbConfigured } from "@/lib/models";
import { DEMO } from "@/lib/demoData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function canAccessResident(context: NonNullable<Awaited<ReturnType<typeof requireTenantContext>>>, residentId: string) {
  return withTenantDb(context, (tx) => tx.resident.findFirst({ where: { AND: [{ id: residentId }, tenantWhere("residents", context)] }, select: { id: true } }));
}

export async function GET(request: NextRequest) {
  const context = await requireTenantContext({ requireCommunity: true });
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const residentId = new URL(request.url).searchParams.get("residentId");
  if (!residentId) return NextResponse.json({ error: "Missing residentId" }, { status: 400 });
  if (!isDbConfigured()) return NextResponse.json({ data: DEMO.vitals.filter((item) => item.residentId === residentId), demo: true });
  if (!(await canAccessResident(context, residentId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const data = await withTenantDb(context, (tx) => tx.vitalsLog.findMany({ where: { residentId, communityId: context.communityId }, orderBy: { recordedAt: "desc" } }));
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const context = await requireTenantContext({ requireCommunity: true });
  if (!context?.organizationId || !context.communityId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  const residentId = String(body.residentId || "");
  const type = String(body.type || "");
  if (!residentId || !Object.values(VitalType).includes(type as VitalType) || body.value === undefined) return NextResponse.json({ error: "Resident, vital type, and value are required" }, { status: 400 });
  if (!(await canAccessResident(context, residentId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isDbConfigured()) return NextResponse.json({ data: { id: `demo-${Date.now()}`, residentId, type, value: String(body.value) }, demo: true }, { status: 201 });
  const data = await withTenantDb(context, (tx) => tx.vitalsLog.create({ data: { organizationId: context.organizationId, communityId: context.communityId, residentId, type: type as VitalType, value: String(body.value), unit: body.unit || null, notes: body.notes != null ? String(body.notes) : null, recordedAt: new Date(), recordedBy: context.userId } }));
  return NextResponse.json({ data }, { status: 201 });
}