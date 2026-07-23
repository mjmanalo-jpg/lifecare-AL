import { NextResponse } from "next/server";
import { requireTenantContext, tenantWhere } from "@/lib/tenant";
import { withTenantDb } from "@/lib/tenantDb";

export async function GET() {
  const context = await requireTenantContext({ requireCommunity: true });
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const residents = await withTenantDb(context, (tx) => tx.resident.findMany({
    where: tenantWhere("residents", context),
    select: {
      id: true,
      firstName: true,
      lastName: true,
      roomNumber: true,
      careLevel: true,
      photoUrl: true,
      visits: { orderBy: { checkInTime: "desc" }, take: 5 },
      residentNotes: { orderBy: { createdAt: "desc" }, take: 5, select: { id: true, title: true, category: true, content: true, createdAt: true } },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  }));
  return NextResponse.json({ residents });
}