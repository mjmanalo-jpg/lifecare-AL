import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const staffId = searchParams.get("staffId");

    const where = staffId ? { staffId } : {};
    const timeTracking = await prisma.timeTracking.findMany({
      where,
      orderBy: { clockIn: "desc" },
      take: 30,
    });

    return NextResponse.json(timeTracking);
  } catch (err: any) {
    console.error("[GET /api/timetracking]", err?.message);
    return NextResponse.json({ error: "Failed to fetch time tracking" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { staffId } = await req.json();

    if (!staffId) {
      return NextResponse.json({ error: "Staff ID required" }, { status: 400 });
    }

    const timeTracking = await prisma.timeTracking.create({
      data: { staffId, clockIn: new Date(), status: "clocked-in" },
    });

    return NextResponse.json(timeTracking, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/timetracking]", err?.message);
    return NextResponse.json({ error: "Failed to create time tracking" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { id, action } = await req.json();

    if (!id || !action) {
      return NextResponse.json({ error: "ID and action required" }, { status: 400 });
    }

    if (action === "clockOut") {
      const timeTracking = await prisma.timeTracking.update({
        where: { id },
        data: { clockOut: new Date(), status: "clocked-out" },
      });
      return NextResponse.json(timeTracking);
    }

    if (action === "startBreak") {
      const timeTracking = await prisma.timeTracking.update({
        where: { id },
        data: { breakStart: new Date(), status: "on-break" },
      });
      return NextResponse.json(timeTracking);
    }

    if (action === "endBreak") {
      const timeTracking = await prisma.timeTracking.update({
        where: { id },
        data: { breakEnd: new Date(), status: "clocked-in" },
      });
      return NextResponse.json(timeTracking);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    console.error("[PUT /api/timetracking]", err?.message);
    return NextResponse.json({ error: "Failed to update time tracking" }, { status: 500 });
  }
}
