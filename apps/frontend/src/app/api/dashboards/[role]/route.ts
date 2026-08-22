import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/tenant";
import { buildDashboard } from "@/lib/dashboard/server";
import { canOpenDashboard } from "@/lib/dashboard/authorization";
import type { DashboardRole, DashboardWindowKey } from "@/lib/dashboard/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DASHBOARD_ROLES = new Set<DashboardRole>([
  "nurse", "caregiver", "care-manager", "facility-admin", "resident-coordinator", "professional",
]);

const WINDOWS: Set<string> = new Set(["shift", "24h", "7d", "30d"]);

export async function GET(request: NextRequest, { params }: { params: Promise<{ role: string }> }) {
  const context = await requireTenantContext({ requireCommunity: true });
  if (!context?.communityId || !context.organizationId) {
    return NextResponse.json({ error: "Select an active community to open this dashboard." }, { status: 401 });
  }
  const { role: value } = await params;
  const role = value as DashboardRole;
  if (!DASHBOARD_ROLES.has(role)) return NextResponse.json({ error: "Unknown dashboard role." }, { status: 404 });
  if (!canOpenDashboard(context.role, role)) return NextResponse.json({ error: "This dashboard is not available to your role." }, { status: 403 });
  const requestedWindow = request.nextUrl.searchParams.get("window") || "shift";
  const windowKey = (WINDOWS.has(requestedWindow) ? requestedWindow : "shift") as DashboardWindowKey;
  try {
    const payload = await buildDashboard(context, role, { window: windowKey });
    return NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[dashboard] build failed", error);
    return NextResponse.json({ error: "The dashboard could not load its governed sources. Try again." }, { status: 500 });
  }
}

