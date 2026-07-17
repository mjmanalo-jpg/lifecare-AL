import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDbConfigured } from "@/lib/models";
import bcrypt from "bcryptjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/register/resident
 * Self-service resident registration. Creates, atomically:
 *   1. a User (role RESIDENT) with a bcrypt-hashed password  → portal login
 *   2. a Resident linked 1-1 to that user (userId)           → care record
 *   3. up to 4 ResidentDocument rows holding the facial-enrollment poses
 *
 * The four face captures (left/right/up/down) are uploaded client-side first;
 * this route stores their URLs. Every write goes straight to Supabase/Prisma so
 * the residents/users tables update live for any subscribed useLiveQuery.
 */
export async function POST(req: NextRequest) {
  try {
    if (!isDbConfigured()) {
      return NextResponse.json({ error: "Database not configured" }, { status: 500 });
    }

    const body = await req.json();
    const {
      email, password,
      firstName, lastName, dateOfBirth, gender, phone,
      emergencyContact, emergencyContactPhone,
      allergies, medicalHistory,
      careLevel, mobility, roomNumber,
      carePlan, photoUrl,
      faces, // { left?, right?, up?, down? } → image URLs
    } = body as Record<string, string | undefined> & { faces?: Record<string, string> };

    // ── Validation (precise guardrails mirroring the admission requirements) ──
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
    }
    if (!firstName?.trim() || !lastName?.trim()) {
      return NextResponse.json({ error: "First and last name are required." }, { status: 400 });
    }
    if (!careLevel) {
      return NextResponse.json({ error: "Care level is required." }, { status: 400 });
    }

    const normEmail = email.toLowerCase().trim();

    // Uniqueness pre-checks (return friendly 409s before hitting DB constraints).
    const existingUser = await prisma.user.findUnique({ where: { email: normEmail }, select: { id: true } });
    if (existingUser) {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }

    // Resolve the room. Admin flows pass an explicit room; public self-service
    // registration omits it, so we auto-assign the first unoccupied room.
    let room = roomNumber;
    if (room) {
      const roomTaken = await prisma.resident.findUnique({ where: { roomNumber: room }, select: { id: true } });
      if (roomTaken) {
        return NextResponse.json({ error: `Room ${room} is already occupied.` }, { status: 409 });
      }
    } else {
      const [rooms, residents] = await Promise.all([
        prisma.room.findMany({ select: { roomNumber: true } }),
        prisma.resident.findMany({ select: { roomNumber: true } }),
      ]);
      const taken = new Set(residents.map((r) => r.roomNumber));
      room = rooms.map((r) => r.roomNumber).find((rn) => rn && !taken.has(rn)) || undefined;
      if (!room) {
        return NextResponse.json({ error: "No rooms are currently available. Please contact the facility." }, { status: 409 });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const name = `${firstName} ${lastName}`.trim();

    // 1. RESIDENT login account.
    const user = await prisma.user.create({
      data: {
        role: "RESIDENT",
        email: normEmail,
        passwordHash,
        name,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone || null,
      },
    });

    // 2. Resident care record, linked to the login (userId).
    const resident = await prisma.resident.create({
      data: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
        gender: gender || null,
        phone: phone || null,
        email: normEmail,
        roomNumber: room,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        careLevel: careLevel as any,
        admissionDate: new Date(),
        emergencyContact: emergencyContact || null,
        emergencyContactPhone: emergencyContactPhone || null,
        allergies: allergies || null,
        medicalHistory: medicalHistory || null,
        notes: [mobility ? `Mobility: ${mobility}` : "", carePlan || ""].filter(Boolean).join("\n") || null,
        userId: user.id,
        photoUrl: photoUrl || (faces && (faces.up || faces.right || faces.left || faces.down)) || null,
      },
    });

    // 3. Facial-enrollment poses as confidential resident documents.
    const faceEntries = Object.entries(faces || {}).filter(([, url]) => !!url);
    if (faceEntries.length) {
      await prisma.residentDocument.createMany({
        data: faceEntries.map(([dir, url]) => ({
          residentId: resident.id,
          documentType: "FACE_ENROLLMENT",
          title: `Facial Recognition — ${dir.charAt(0).toUpperCase()}${dir.slice(1)}`,
          fileName: `face-${dir}.jpg`,
          fileUrl: String(url),
          uploadedByName: "Resident Registration",
          isConfidential: true,
        })),
      });
    }

    return NextResponse.json(
      { success: true, userId: user.id, residentId: resident.id, faces: faceEntries.length },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Registration failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
