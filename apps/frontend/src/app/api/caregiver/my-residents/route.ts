import { NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/caregiver/my-residents
 *
 * Returns only the residents assigned to the current caregiver from the
 * active shift roster. Caregivers cannot see residents outside their assignment.
 */
export async function GET() {
  try {
    const context = await requireTenantContext({ requireCommunity: true });
    if (!context?.communityId || !context.organizationId) {
      return NextResponse.json({ error: "Select an active community." }, { status: 401 });
    }
    if (context.role !== "CAREGIVER") {
      return NextResponse.json({ error: "This endpoint is for caregivers only." }, { status: 403 });
    }

    const assignedIds = context.caregiverResidentIds ?? [];
    if (assignedIds.length === 0) {
      return NextResponse.json({ residents: [], assignedIds: [] });
    }

    const residents = await prisma.resident.findMany({
      where: {
        organizationId: context.organizationId,
        communityId: context.communityId,
        status: "ACTIVE",
        id: { in: assignedIds },
      },
      orderBy: [{ roomNumber: "asc" }, { lastName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        roomNumber: true,
        careLevel: true,
        careDependencyLevel: true,
        allergies: true,
        dietRestriction: true,
        codeStatus: true,
        notes: true,
        photoUrl: true,
        medicalHistory: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ residents, assignedIds });
  } catch (error) {
    console.error("[caregiver/my-residents]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
