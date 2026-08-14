import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext } from "@/lib/tenant";
import { applyResidentLocCharge } from "@/lib/locBillingServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Apply a resident's Level-of-Care monthly fee immediately when their acuity
// level is approved or changed (called best-effort from the Care Acuity board).
// The same fee is also re-applied monthly by the billing cron; both share the
// `[loc:<level>:<month>]` marker so they never double-post.
export async function POST(request: NextRequest) {
  const context = await requireTenantContext({});
  if (!context || context.isPlatform || !context.communityId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Roles that own the acuity approval workflow.
  if (!["NURSE", "CARE_MANAGER", "FACILITY_ADMIN", "SUPERADMIN"].includes(context.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { residentId?: string; level?: number };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const residentId = String(body.residentId || "");
  const level = Number(body.level);
  if (!residentId || !(level >= 1 && level <= 5)) {
    return NextResponse.json({ error: "residentId and level (1–5) are required" }, { status: 400 });
  }

  // Confirm the resident belongs to the caller's community.
  const resident = await prisma.resident.findFirst({ where: { id: residentId, communityId: context.communityId }, select: { id: true } });
  if (!resident) return NextResponse.json({ error: "Resident not found" }, { status: 404 });

  const result = await applyResidentLocCharge({
    organizationId: context.organizationId ?? null,
    communityId: context.communityId,
    residentId,
    level,
  });
  return NextResponse.json({ ok: true, ...result });
}
