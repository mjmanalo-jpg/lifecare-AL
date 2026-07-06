import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");

    const where = status ? { status } : {};
    const callBells = await prisma.callBell.findMany({
      where,
      include: { resident: true },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(callBells);
  } catch (err: any) {
    console.error("[GET /api/callbells]", err?.message);
    return NextResponse.json({ error: "Failed to fetch call bells" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { residentId } = await req.json();

    if (!residentId) {
      return NextResponse.json({ error: "Resident ID required" }, { status: 400 });
    }

    const callBell = await prisma.callBell.create({
      data: { residentId },
      include: { resident: true },
    });

    return NextResponse.json(callBell, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/callbells]", err?.message);
    return NextResponse.json({ error: "Failed to create call bell" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { id, acknowledgedBy } = await req.json();

    if (!id) {
      return NextResponse.json({ error: "Call bell ID required" }, { status: 400 });
    }

    const callBell = await prisma.callBell.update({
      where: { id },
      data: {
        status: "acknowledged",
        acknowledgedBy,
        acknowledgedAt: new Date(),
      },
      include: { resident: true },
    });

    return NextResponse.json(callBell);
  } catch (err: any) {
    console.error("[PUT /api/callbells]", err?.message);
    return NextResponse.json({ error: "Failed to update call bell" }, { status: 500 });
  }
}
