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
  return NextResponse.json({ data: Object.fromEntries(rows.filter((row) => !String(row.key || row.id).startsWith("__")).map((row) => [row.key || row.id, row.value])) });
}

// Roles allowed to write community-scoped app settings (assistant personality,
// voice, etc.) beyond org owners/admins: the facility-level admins who own these
// settings screens. Mirrors ai-assistant's ADMIN_STAFF so a Super Admin can save
// the very personality they're editing on /superadmin/assistant.
const SETTINGS_ADMIN_ROLES = new Set(["FACILITY_ADMIN", "SUPERADMIN"]);

export async function POST(request: NextRequest) {
  const context = await requireTenantContext({ requireCommunity: true, allowPlatform: true });
  if (!context?.organizationId || !context.communityId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Check both the resolved tenant role and the authoritative session role — a
  // Super Admin's community-membership role can shadow context.role, so we must
  // not rely on it alone or the owner of this settings page still gets a 403.
  const canWrite = canManageOrganization(context) || SETTINGS_ADMIN_ROLES.has(context.role) || SETTINGS_ADMIN_ROLES.has(context.session.role);
  if (!canWrite) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const key = String(body.key || "").trim();
  if (!key || key.length > 100) return NextResponse.json({ error: "Invalid setting key" }, { status: 400 });
  if (!isDbConfigured()) return NextResponse.json({ data: { key, value: body.value }, demo: true });
  const id = `${context.organizationId}:${context.communityId}:${key}`;
  const data = await withTenantDb(context, (tx) => tx.appSetting.upsert({ where: { id }, update: { value: String(body.value ?? "") }, create: { id, key, value: String(body.value ?? ""), organizationId: context.organizationId, communityId: context.communityId } }));
  return NextResponse.json({ data });
}