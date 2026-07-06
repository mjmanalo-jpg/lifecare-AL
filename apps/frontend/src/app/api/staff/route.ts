import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const role = searchParams.get("role");

    const where = role ? { role } : {};
    const staff = await prisma.staff.findMany({
      where,
      orderBy: { name: "asc" },
    });

    return NextResponse.json(staff);
  } catch (err: any) {
    console.error("[GET /api/staff]", err?.message);
    return NextResponse.json({ error: "Failed to fetch staff" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { name, email, role, department, phone, hireDate } = await req.json();

    if (!name || !email || !role || !hireDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const staff = await prisma.staff.create({
      data: { name, email, role, department, phone, hireDate: new Date(hireDate) },
    });

    return NextResponse.json(staff, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/staff]", err?.message);
    return NextResponse.json({ error: "Failed to create staff" }, { status: 500 });
  }
}
