import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const residentId = searchParams.get("residentId");
    const type = searchParams.get("type");

    const where: any = {};
    if (residentId) where.residentId = residentId;

    const notes = await Promise.all([
      type !== "resident" ? prisma.medicalNote.findMany({
        where,
        orderBy: { createdAt: "desc" },
      }) : Promise.resolve([]),
      type !== "medical" ? prisma.residentNote.findMany({
        where,
        orderBy: { createdAt: "desc" },
      }) : Promise.resolve([]),
    ]);

    return NextResponse.json({
      medicalNotes: notes[0],
      residentNotes: notes[1],
    });
  } catch (err: any) {
    console.error("[GET /api/notes]", err?.message);
    return NextResponse.json({ error: "Failed to fetch notes" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { residentId, note, createdBy, type } = await req.json();

    if (!residentId || !note || !createdBy) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (type === "medical") {
      const medicalNote = await prisma.medicalNote.create({
        data: { residentId, note, createdBy },
      });
      return NextResponse.json(medicalNote, { status: 201 });
    } else {
      const residentNote = await prisma.residentNote.create({
        data: { residentId, note, createdBy },
      });
      return NextResponse.json(residentNote, { status: 201 });
    }
  } catch (err: any) {
    console.error("[POST /api/notes]", err?.message);
    return NextResponse.json({ error: "Failed to create note" }, { status: 500 });
  }
}
