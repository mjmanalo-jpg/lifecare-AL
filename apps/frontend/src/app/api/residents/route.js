import { NextResponse } from "next/server";

// Mock data
const mockResidents = [
  { id: "1", name: "John Doe", careLevel: "ASSISTED", roomNumber: "101", sponsorId: "s1" },
  { id: "2", name: "Jane Smith", careLevel: "MEMORY", roomNumber: "102", sponsorId: "s2" },
  { id: "3", name: "Bob Wilson", careLevel: "SKILLED", roomNumber: "103", sponsorId: "s3" }
];

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const limit = parseInt(searchParams.get("limit") || "100");
    const offset = parseInt(searchParams.get("offset") || "0");

    if (id) {
      const resident = mockResidents.find(r => r.id === id);
      return NextResponse.json(resident || { error: "Not found" }, { status: resident ? 200 : 404 });
    }

    return NextResponse.json({
      data: mockResidents.slice(offset, offset + limit),
      pagination: { total: mockResidents.length, limit, offset, hasMore: offset + limit < mockResidents.length }
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const newResident = { id: Date.now().toString(), ...body };
    mockResidents.push(newResident);
    return NextResponse.json(newResident, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req) {
  try {
    const body = await req.json();
    const { id, ...updateData } = body;

    const index = mockResidents.findIndex(r => r.id === id);
    if (index === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });

    mockResidents[index] = { ...mockResidents[index], ...updateData };
    return NextResponse.json(mockResidents[index]);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    const index = mockResidents.findIndex(r => r.id === id);
    if (index === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });

    mockResidents.splice(index, 1);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
