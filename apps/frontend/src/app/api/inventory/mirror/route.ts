import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mirror a GENERAL-supply item from a clinical board (Med Inventory / Mini
// Pharmacy) into the shared Facility Inventory (Prisma InventoryItem), so the
// Facility portal sees the whole supply inventory. One-way: the clinical board
// stays the source of truth and holds the returned `facilityItemId` to keep the
// mirror updated (create → update → remove). Medications are never mirrored.

type InvCat = "MEDICAL_SUPPLIES" | "PERSONAL_CARE" | "LINEN" | "FOOD" | "CLEANING" | "OFFICE" | "FURNITURE" | "EQUIPMENT" | "PPE" | "OTHER";

// Clinical categories are free text; map them to the facility inventory enum.
function toCategory(text?: string): InvCat {
  const t = (text || "").toLowerCase();
  if (/glove|mask|ppe|gown|face ?shield|apron|goggle/.test(t)) return "PPE";
  if (/linen|sheet|towel|blanket|pillow/.test(t)) return "LINEN";
  if (/food|meal|nutrition|dietary|snack/.test(t)) return "FOOD";
  if (/clean|sanitiz|disinfect|detergent|bleach/.test(t)) return "CLEANING";
  if (/diaper|hygiene|personal|bath|wipe|incontinence/.test(t)) return "PERSONAL_CARE";
  if (/office|paper|pen|stationery|printer/.test(t)) return "OFFICE";
  if (/equip|device|machine|monitor|pump|wheelchair/.test(t)) return "EQUIPMENT";
  if (/furniture|bed frame|chair|table/.test(t)) return "FURNITURE";
  return "MEDICAL_SUPPLIES";
}

export async function POST(request: NextRequest) {
  const ctx = await requireTenantContext({});
  if (!ctx || ctx.isPlatform || !ctx.communityId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["NURSE", "CARE_MANAGER", "FACILITY_ADMIN", "SUPERADMIN"].includes(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    facilityItemId?: string;
    remove?: boolean;
    name?: string;
    category?: string;
    quantity?: number;
    unit?: string;
    reorder?: number;
    location?: string;
    supplier?: string;
    expiry?: string;
    notes?: string;
    unitCost?: number;
    source?: string;
  };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }

  const communityId = ctx.communityId;

  // Removal (e.g. a mirrored item was retyped to a medication) — scoped to community.
  if (body.remove) {
    if (body.facilityItemId) {
      await prisma.inventoryItem.deleteMany({ where: { id: body.facilityItemId, communityId } });
    }
    return NextResponse.json({ ok: true, facilityItemId: null });
  }

  const name = String(body.name || "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const source = body.source ? ` (synced from ${String(body.source)})` : " (synced from clinical inventory)";
  const noteBase = String(body.notes || "").trim();
  const data = {
    itemName: name,
    category: toCategory(body.category),
    quantity: Number.isFinite(Number(body.quantity)) ? Math.trunc(Number(body.quantity)) : 0,
    unit: String(body.unit || "pcs"),
    minimumStock: Number.isFinite(Number(body.reorder)) ? Math.trunc(Number(body.reorder)) : 0,
    reorderPoint: Number.isFinite(Number(body.reorder)) ? Math.trunc(Number(body.reorder)) : null,
    location: body.location ? String(body.location) : null,
    supplier: body.supplier ? String(body.supplier) : null,
    expiryDate: body.expiry && /^\d{4}-\d{2}-\d{2}$/.test(body.expiry) ? new Date(body.expiry + "T00:00:00") : null,
    unitCost: Number.isFinite(Number(body.unitCost)) && Number(body.unitCost) > 0 ? Number(body.unitCost) : null,
    notes: (noteBase ? noteBase + " " : "") + source.trim(),
    lastRestocked: new Date(),
  };

  // Update the existing mirror if it still exists; otherwise create a fresh one.
  if (body.facilityItemId) {
    const existing = await prisma.inventoryItem.findFirst({ where: { id: body.facilityItemId, communityId }, select: { id: true } });
    if (existing) {
      await prisma.inventoryItem.update({ where: { id: existing.id }, data });
      return NextResponse.json({ ok: true, facilityItemId: existing.id });
    }
  }

  const created = await prisma.inventoryItem.create({
    data: { ...data, organizationId: ctx.organizationId ?? undefined, communityId },
    select: { id: true },
  });
  return NextResponse.json({ ok: true, facilityItemId: created.id });
}
