import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateSession } from "@/lib/auth";
import { isDbConfigured } from "@/lib/models";
import { DEMO } from "@/lib/demoData";
import { VitalType } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/vitals?residentId=<resident-id>
 * POST /api/vitals (body = { residentId, type, value, loggedById })
 */

export async function GET(request: NextRequest) {
  const role = await validateSession();
  if (!role) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const residentId = searchParams.get("residentId");

  if (!residentId) {
    return NextResponse.json({ error: "Missing residentId" }, { status: 400 });
  }

  if (!isDbConfigured()) {
    // Return demo vitals matching the resident room or resident ID.
    const demoResident = DEMO.residents.find((r) => r.id === residentId);
    if (!demoResident) {
      return NextResponse.json({ data: [] });
    }
    const filteredDemoVitals = DEMO.vitals.filter(
      (v) => v.resident.roomNumber === demoResident.roomNumber
    );
    return NextResponse.json({ data: filteredDemoVitals, demo: true });
  }

  try {
    const vitals = await prisma.vitalsLog.findMany({
      where: { residentId },
      orderBy: { recordedAt: "desc" },
    });
    return NextResponse.json({ data: vitals });
  } catch (error) {
    console.error("Failed to fetch vitals:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch vitals";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const role = await validateSession();
  if (!role) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { residentId, type, value, loggedById } = body;

    if (!residentId || !type || !value) {
      return NextResponse.json(
        { error: "Missing required fields: residentId, type, value" },
        { status: 400 }
      );
    }

    // Validate vital type
    const validTypes = Object.values(VitalType);
    if (!validTypes.includes(type as VitalType)) {
      return NextResponse.json(
        { error: `Invalid vital type. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    const recordedAt = new Date();

    if (!isDbConfigured()) {
      return NextResponse.json(
        {
          data: {
            id: `demo-${Date.now()}`,
            residentId,
            type,
            value,
            recordedAt: recordedAt.toISOString(),
            recordedBy: loggedById || null,
          },
          demo: true,
        },
        { status: 201 }
      );
    }

    const vitalLog = await prisma.vitalsLog.create({
      data: {
        residentId,
        type: type as VitalType,
        value: String(value),
        recordedAt,
        recordedBy: loggedById || null,
      },
    });

    return NextResponse.json({ data: vitalLog }, { status: 201 });
  } catch (error) {
    console.error("Failed to log vital:", error);
    const message = error instanceof Error ? error.message : "Failed to log vital";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
