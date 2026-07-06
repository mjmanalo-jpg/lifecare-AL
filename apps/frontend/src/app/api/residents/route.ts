import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface ResidentCreatePayload {
  name: string;
  careLevel: string;
  roomNumber: string;
  sponsorId: string;
}

interface ResidentUpdatePayload {
  name?: string;
  careLevel?: string;
  roomNumber?: string;
  sponsorId?: string;
}

const VALID_CARE_LEVELS = ["INDEPENDENT", "ASSISTED", "MEMORY", "SKILLED"];

function validateResidentPayload(data: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (data.name !== undefined && (!data.name || typeof data.name !== "string" || data.name.trim().length === 0)) {
    errors.push("name must be a non-empty string");
  }

  if (data.careLevel !== undefined && (!VALID_CARE_LEVELS.includes(data.careLevel))) {
    errors.push(`careLevel must be one of: ${VALID_CARE_LEVELS.join(", ")}`);
  }

  if (data.roomNumber !== undefined && (!data.roomNumber || typeof data.roomNumber !== "string" || data.roomNumber.trim().length === 0)) {
    errors.push("roomNumber must be a non-empty string");
  }

  if (data.sponsorId !== undefined && (!data.sponsorId || typeof data.sponsorId !== "string" || data.sponsorId.trim().length === 0)) {
    errors.push("sponsorId must be a non-empty string");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

async function validateSponsorExists(sponsorId: string): Promise<boolean> {
  const sponsor = await prisma.user.findUnique({
    where: { id: sponsorId },
  });
  return !!sponsor;
}

async function checkRoomNumberExists(roomNumber: string, excludeResidentId?: string): Promise<boolean> {
  const query: any = { roomNumber };
  if (excludeResidentId) {
    query.NOT = { id: excludeResidentId };
  }
  const resident = await prisma.resident.findFirst({ where: query });
  return !!resident;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const residentId = searchParams.get("id");

    if (residentId) {
      // Get single resident
      if (!residentId || residentId.trim().length === 0) {
        return NextResponse.json(
          { error: "Invalid resident ID" },
          { status: 400 }
        );
      }

      const resident = await prisma.resident.findUnique({
        where: { id: residentId },
        include: {
          sponsor: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
      });

      if (!resident) {
        return NextResponse.json(
          { error: "Resident not found" },
          { status: 404 }
        );
      }

      return NextResponse.json(resident, { status: 200 });
    }

    // Get all residents with optional filtering
    const careLevel = searchParams.get("careLevel");
    const sponsorId = searchParams.get("sponsorId");
    const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 1000);
    const offset = Math.max(parseInt(searchParams.get("offset") || "0"), 0);

    const where: any = {};
    if (careLevel && VALID_CARE_LEVELS.includes(careLevel)) {
      where.careLevel = careLevel;
    }
    if (sponsorId) {
      where.sponsorId = sponsorId;
    }

    const [residents, total] = await Promise.all([
      prisma.resident.findMany({
        where,
        include: {
          sponsor: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.resident.count({ where }),
    ]);

    return NextResponse.json(
      {
        data: residents,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[GET /api/residents]", err?.message ?? err);
    return NextResponse.json(
      { error: "Failed to fetch residents" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Validate required fields
    const requiredFields: (keyof ResidentCreatePayload)[] = ["name", "careLevel", "roomNumber", "sponsorId"];
    const missingFields = requiredFields.filter((field) => !body[field]);

    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Missing required fields: ${missingFields.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate payload
    const validation = validateResidentPayload(body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: "Validation failed", details: validation.errors },
        { status: 400 }
      );
    }

    // Check if sponsor exists
    const sponsorExists = await validateSponsorExists(body.sponsorId);
    if (!sponsorExists) {
      return NextResponse.json(
        { error: "Sponsor not found" },
        { status: 404 }
      );
    }

    // Check if room number already exists
    const roomExists = await checkRoomNumberExists(body.roomNumber);
    if (roomExists) {
      return NextResponse.json(
        { error: "Room number already in use" },
        { status: 409 }
      );
    }

    // Create resident
    const resident = await prisma.resident.create({
      data: {
        name: body.name.trim(),
        careLevel: body.careLevel,
        roomNumber: body.roomNumber.trim(),
        sponsorId: body.sponsorId,
      },
      include: {
        sponsor: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    return NextResponse.json(resident, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/residents]", err?.message ?? err);

    if (err?.code === "P2002") {
      return NextResponse.json(
        { error: "A resident with this room number already exists" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create resident" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const residentId = searchParams.get("id");

    if (!residentId || residentId.trim().length === 0) {
      return NextResponse.json(
        { error: "Invalid resident ID" },
        { status: 400 }
      );
    }

    const body = await req.json();

    // Validate payload (all fields are optional for update)
    const validation = validateResidentPayload(body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: "Validation failed", details: validation.errors },
        { status: 400 }
      );
    }

    // Check if resident exists
    const resident = await prisma.resident.findUnique({
      where: { id: residentId },
    });

    if (!resident) {
      return NextResponse.json(
        { error: "Resident not found" },
        { status: 404 }
      );
    }

    // Validate sponsor if provided
    if (body.sponsorId) {
      const sponsorExists = await validateSponsorExists(body.sponsorId);
      if (!sponsorExists) {
        return NextResponse.json(
          { error: "Sponsor not found" },
          { status: 404 }
        );
      }
    }

    // Check room number uniqueness if updating
    if (body.roomNumber && body.roomNumber !== resident.roomNumber) {
      const roomExists = await checkRoomNumberExists(body.roomNumber, residentId);
      if (roomExists) {
        return NextResponse.json(
          { error: "Room number already in use" },
          { status: 409 }
        );
      }
    }

    // Prepare update data
    const updateData: ResidentUpdatePayload = {};
    if (body.name !== undefined) updateData.name = body.name.trim();
    if (body.careLevel !== undefined) updateData.careLevel = body.careLevel;
    if (body.roomNumber !== undefined) updateData.roomNumber = body.roomNumber.trim();
    if (body.sponsorId !== undefined) updateData.sponsorId = body.sponsorId;

    // Update resident
    const updatedResident = await prisma.resident.update({
      where: { id: residentId },
      data: updateData,
      include: {
        sponsor: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    return NextResponse.json(updatedResident, { status: 200 });
  } catch (err: any) {
    console.error("[PUT /api/residents]", err?.message ?? err);

    if (err?.code === "P2002") {
      return NextResponse.json(
        { error: "Room number already in use" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Failed to update resident" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const residentId = searchParams.get("id");

    if (!residentId || residentId.trim().length === 0) {
      return NextResponse.json(
        { error: "Invalid resident ID" },
        { status: 400 }
      );
    }

    // Check if resident exists
    const resident = await prisma.resident.findUnique({
      where: { id: residentId },
    });

    if (!resident) {
      return NextResponse.json(
        { error: "Resident not found" },
        { status: 404 }
      );
    }

    // Delete resident (cascade delete handled by Prisma)
    await prisma.resident.delete({
      where: { id: residentId },
    });

    return NextResponse.json(
      { message: "Resident deleted successfully", id: residentId },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[DELETE /api/residents]", err?.message ?? err);
    return NextResponse.json(
      { error: "Failed to delete resident" },
      { status: 500 }
    );
  }
}
