import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/tenant";
import { canOpenDashboard } from "@/lib/dashboard/authorization";
import { buildMetricDrilldown } from "@/lib/dashboard/drilldown";
import type { DashboardRole } from "@/lib/dashboard/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DASHBOARD_ROLES = new Set<DashboardRole>(["nurse", "caregiver", "care-manager", "facility-admin", "resident-coordinator", "professional"]);

export async function GET(request: NextRequest, { params }: { params: Promise<{ metricKey: string }> }) {
  const context = await requireTenantContext({ requireCommunity: true });
  if (!context?.organizationId || !context.communityId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = request.nextUrl.searchParams.get("role") as DashboardRole;
  if (!DASHBOARD_ROLES.has(role) || !canOpenDashboard(context.role, role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { metricKey } = await params;
  const result = await buildMetricDrilldown(context, role, metricKey);
  if (!result) return NextResponse.json({ error: "Metric drill-down is not available." }, { status: 404 });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
