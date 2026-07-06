import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Typeless GET - accepts any parameters
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const careLevel = searchParams.get("careLevel");
    const limit = parseInt(searchParams.get("limit") || "100");
    const offset = parseInt(searchParams.get("offset") || "0");
    const id = searchParams.get("id");

    // Single resident by ID
    if (id) {
      const resident = await prisma.resident.findUnique({
        where: { id },
        include: { sponsor: true }
      });
      return NextResponse.json(resident || { error: "Not found" }, { status: resident ? 200 : 404 });
    }

    // All residents with optional filters
    const where = careLevel ? { careLevel } : {};
    const [residents, total] = await Promise.all([
      prisma.resident.findMany({ where, skip: offset, take: limit, include: { sponsor: true }, orderBy: { createdAt: "desc" } }),
      prisma.resident.count({ where })
    ]);

    return NextResponse.json({
      data: residents,
      pagination: { total, limit, offset, hasMore: offset + limit < total }
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Typeless POST - accepts any data structure
export async function POST(req) {
  try {
    const body = await req.json();
    const { name, careLevel, roomNumber, sponsorId } = body;

    if (!name || !careLevel || !roomNumber || !sponsorId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const resident = await prisma.resident.create({
      data: { name, careLevel, roomNumber, sponsorId },
      include: { sponsor: true }
    });

    return NextResponse.json(resident, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Typeless PUT - updates any fields
export async function PUT(req) {
  try {
    const body = await req.json();
    const { id, ...updateData } = body;

    if (!id) {
      return NextResponse.json({ error: "ID required" }, { status: 400 });
    }

    const resident = await prisma.resident.update({
      where: { id },
      data: updateData,
      include: { sponsor: true }
    });

    return NextResponse.json(resident);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Typeless DELETE - flexible parameter passing
export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID required" }, { status: 400 });
    }

    await prisma.resident.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
