import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/models";
import { canManageOrganization, requireTenantContext } from "@/lib/tenant";
import { withTenantDb } from "@/lib/tenantDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const context = await requireTenantContext({ requireCommunity: true });
  if (!context?.organizationId || !context.communityId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ data: {}, demo: true });
  const rows = await withTenantDb(context, (tx) => tx.appSetting.findMany({ where: { OR: [{ organizationId: context.organizationId, communityId: null }, { organizationId: context.organizationId, communityId: context.communityId }] } }));
  return NextResponse.json({ data: Object.fromEntries(rows.map((row) => [row.key || row.id, row.value])) });
}

export async function POST(request: NextRequest) {
  const context = await requireTenantContext({ requireCommunity: true });
  if (!context?.organizationId || !context.communityId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageOrganization(context) && context.role !== "FACILITY_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const key = String(body.key || "").trim();
  if (!key || key.length > 100) return NextResponse.json({ error: "Invalid setting key" }, { status: 400 });
  if (!isDbConfigured()) return NextResponse.json({ data: { key, value: body.value }, demo: true });
  const id = `${context.organizationId}:${context.communityId}:${key}`;
  const data = await withTenantDb(context, (tx) => tx.appSetting.upsert({ where: { id }, update: { value: String(body.value ?? "") }, create: { id, key, value: String(body.value ?? ""), organizationId: context.organizationId, communityId: context.communityId } }));
  return NextResponse.json({ data });
}