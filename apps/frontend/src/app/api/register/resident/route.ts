import { NextRequest, NextResponse } from "next/server";
import { CareLevel } from "@prisma/client";
import { requireTenantContext, canManageOrganization } from "@/lib/tenant";
import { withTenantDb } from "@/lib/tenantDb";
import { assertMutationEntitled, EntitlementError } from "@/lib/entitlements";
import { createInvitation } from "@/lib/invitations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const context = await requireTenantContext({ requireCommunity: true });
  if (!context?.organizationId || !context.communityId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageOrganization(context) && !["FACILITY_ADMIN", "SUPERADMIN"].includes(context.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json();
  const email = String(body.email || "").toLowerCase().trim();
  const firstName = String(body.firstName || "").trim();
  const lastName = String(body.lastName || "").trim();
  const careLevel = String(body.careLevel || "");
  if (!email || !firstName || !lastName || !Object.values(CareLevel).includes(careLevel as CareLevel)) return NextResponse.json({ error: "Email, name, and valid care level are required" }, { status: 400 });

  try {
    await assertMutationEntitled(context, "residents");
    const resident = await withTenantDb(context, async (tx) => {
      let roomNumber = body.roomNumber ? String(body.roomNumber) : "";
      if (roomNumber) {
        const occupied = await tx.resident.findFirst({ where: { communityId: context.communityId, roomNumber } });
        if (occupied) throw new Error("ROOM_OCCUPIED");
      } else {
        const [rooms, residents] = await Promise.all([
          tx.room.findMany({ where: { communityId: context.communityId, status: "AVAILABLE" }, select: { roomNumber: true } }),
          tx.resident.findMany({ where: { communityId: context.communityId }, select: { roomNumber: true } }),
        ]);
        const occupied = new Set(residents.map((item) => item.roomNumber));
        roomNumber = rooms.map((item) => item.roomNumber).find((number) => !occupied.has(number)) || "";
        if (!roomNumber) throw new Error("NO_ROOM");
      }
      const created = await tx.resident.create({
        data: {
          organizationId: context.organizationId,
          communityId: context.communityId,
          firstName,
          lastName,
          email,
          dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
          gender: body.gender || null,
          phone: body.phone || null,
          roomNumber,
          careLevel: careLevel as CareLevel,
          admissionDate: new Date(),
          emergencyContact: body.emergencyContact || null,
          emergencyContactPhone: body.emergencyContactPhone || null,
          allergies: body.allergies || null,
          medicalHistory: body.medicalHistory || null,
          diagnosis: body.diagnosis || null,
          photoUrl: body.photoUrl || null,
        },
      });
      const faces = Object.entries((body.faces || {}) as Record<string, string>).filter(([, url]) => Boolean(url));
      if (faces.length) await tx.residentDocument.createMany({ data: faces.map(([direction, url]) => ({ organizationId: context.organizationId, communityId: context.communityId, residentId: created.id, documentType: "FACE_ENROLLMENT", title: `Facial enrollment — ${direction}`, fileName: `face-${direction}.jpg`, fileUrl: String(url), uploadedByName: "Admissions", isConfidential: true })) });
      return created;
    });
    const invitation = await createInvitation({ email, organizationId: context.organizationId, communityId: context.communityId, residentId: resident.id, communityRole: "RESIDENT", createdById: context.userId, baseUrl: new URL(request.url).origin });
    return NextResponse.json({ residentId: resident.id, invitationId: invitation.invitation.id, ...(process.env.NODE_ENV !== "production" ? { acceptUrl: invitation.acceptUrl } : {}) }, { status: 201 });
  } catch (error) {
    if (error instanceof EntitlementError) return NextResponse.json({ error: error.message }, { status: 403 });
    const code = error instanceof Error ? error.message : "";
    if (code === "ROOM_OCCUPIED") return NextResponse.json({ error: "Room is already occupied" }, { status: 409 });
    if (code === "NO_ROOM") return NextResponse.json({ error: "No room is available" }, { status: 409 });
    return NextResponse.json({ error: "Resident registration failed" }, { status: 400 });
  }
}