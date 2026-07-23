import { NextRequest, NextResponse } from "next/server";
import { bpSimulator, type ResidentBPProfile } from "@/lib/bpSimulator";
import { requireTenantContext, tenantWhere } from "@/lib/tenant";
import { withTenantDb } from "@/lib/tenantDb";
import { isDbConfigured } from "@/lib/models";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bpProfiles = new Map<string, ResidentBPProfile>();
const EMOTIONAL_STATES = new Set(["calm", "anxious", "stressed"]);

export async function GET(request: NextRequest) {
  const context = await requireTenantContext({ requireCommunity: true });
  if (!context?.communityId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  try {
    const { searchParams } = new URL(request.url);
    const residentId = searchParams.get("residentId");
    const requestedState = searchParams.get("emotionalState") || "calm";
    if (!EMOTIONAL_STATES.has(requestedState)) return NextResponse.json({ error: "Invalid emotional state" }, { status: 400 });
    const emotionalState = requestedState as "calm" | "anxious" | "stressed";

    const residents = await withTenantDb(context, (tx) => tx.resident.findMany({
      where: {
        AND: [
          tenantWhere("residents", context),
          ...(residentId ? [{ id: residentId }] : []),
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        medicalHistory: true,
        medications: { where: { status: "ACTIVE" }, select: { name: true } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }));

    if (residentId && residents.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (residentId && !residents[0].dateOfBirth) return NextResponse.json({ error: "Resident date of birth is required for simulation" }, { status: 422 });

    const readings = residents.filter((resident) => resident.dateOfBirth).map((resident) => {
      let profile = bpProfiles.get(resident.id);
      if (!profile) {
        profile = bpSimulator.createProfile(resident);
        bpProfiles.set(resident.id, profile);
      }
      const current = bpSimulator.generateBPReading(profile, emotionalState, new Date().getHours());
      return {
        residentId: resident.id,
        firstName: resident.firstName,
        lastName: resident.lastName,
        current,
        severity: bpSimulator.getAlertSeverity(current),
        history: residentId ? bpSimulator.getHistory(resident.id).slice(-12) : undefined,
      };
    });

    if (residentId) return NextResponse.json({ ...readings[0], profile: bpProfiles.get(residentId) });
    return NextResponse.json({ readings });
  } catch (error) {
    console.error("[vitals-bp] tenant-scoped simulation failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Failed to generate blood pressure readings" }, { status: 500 });
  }
}