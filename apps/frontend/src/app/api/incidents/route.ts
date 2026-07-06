import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const residentId = searchParams.get("residentId");
    const severity = searchParams.get("severity");

    const where: any = {};
    if (residentId) where.residentId = residentId;
    if (severity) where.severity = severity;

    const incidents = await prisma.incident.findMany({
      where,
      include: { resident: true },
      orderBy: { triggeredAt: "desc" },
    });

    return NextResponse.json(incidents);
  } catch (err: any) {
    console.error("[GET /api/incidents]", err?.message);
    return NextResponse.json({ error: "Failed to fetch incidents" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { residentId, type, description, severity } = await req.json();

    if (!residentId || !type || !severity) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const incident = await prisma.incident.create({
      data: { residentId, type, description, severity },
      include: { resident: true },
    });

    return NextResponse.json(incident, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/incidents]", err?.message);
    return NextResponse.json({ error: "Failed to create incident" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Incident ID required" }, { status: 400 });
    }

    await prisma.incident.delete({ where: { id } });
    return NextResponse.json({ message: "Incident deleted" });
  } catch (err: any) {
    console.error("[DELETE /api/incidents]", err?.message);
    return NextResponse.json({ error: "Failed to delete incident" }, { status: 500 });
  }
}
