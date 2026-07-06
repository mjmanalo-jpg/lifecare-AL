import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const residentId = searchParams.get("residentId");

    const where = residentId ? { residentId } : {};
    const vitals = await prisma.vitalsLog.findMany({
      where,
      include: { resident: true },
      orderBy: { recordedAt: "desc" },
      take: 50,
    });

    return NextResponse.json(vitals);
  } catch (err: any) {
    console.error("[GET /api/vitals]", err?.message);
    return NextResponse.json({ error: "Failed to fetch vitals" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { residentId, type, value, loggedById } = await req.json();

    if (!residentId || !type || !value || !loggedById) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const vital = await prisma.vitalsLog.create({
      data: { residentId, type, value, loggedById },
      include: { resident: true },
    });

    return NextResponse.json(vital, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/vitals]", err?.message);
    return NextResponse.json({ error: "Failed to create vital" }, { status: 500 });
  }
}
