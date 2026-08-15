import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDbConfigured } from "@/lib/models";
import { requireTenantContext } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Family-sponsor approval for specialist appointments / referrals raised with
 * "Family Notified" toggled on. Migration-free: a family-pending appointment is
 * a HospitalReferral that is REQUESTED, not yet decided (approvedAt null), and
 * carries the "Family Notified: Yes" flag in its notes.
 *   GET  → the pending/decided appointments where the caller is the family sponsor.
 *   POST → approve (→ SCHEDULED, appears on the Appointment Calendar) or decline
 *          (→ CANCELLED) the appointment. Sponsor-scoped authz.
 * A 24h no-response auto-approve is handled by the alerts cron.
 */

export const FAMILY_FLAG = "Family Notified: Yes";

const noteLine = (notes: string | null, label: string) => {
  const m = (notes || "").match(new RegExp(`^${label}:\\s*(.*)$`, "m"));
  return m ? m[1].trim() : "";
};

type Ref = {
  id: string; status: string; notes: string | null; approvedAt: Date | null; approvedByName: string | null;
  facilityName: string; reason: string; scheduledDate: Date | null; referredByName: string | null; createdAt: Date;
  resident: { firstName: string | null; lastName: string | null; roomNumber: string | null } | null;
};

function shape(r: Ref) {
  return {
    id: r.id,
    residentName: `${r.resident?.firstName ?? ""} ${r.resident?.lastName ?? ""}`.trim() || "Resident",
    room: r.resident?.roomNumber ?? "",
    appointmentType: noteLine(r.notes, "Appointment Type") || "Appointment",
    specialist: noteLine(r.notes, "Specialist"),
    facilityName: r.facilityName,
    reason: r.reason,
    scheduledDate: r.scheduledDate ? r.scheduledDate.toISOString() : null,
    requestedBy: r.referredByName || "Care team",
    requestedAt: r.createdAt.toISOString(),
    status: r.status,
    decidedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    decidedBy: r.approvedByName || "",
  };
}

const SELECT = {
  id: true, status: true, notes: true, approvedAt: true, approvedByName: true,
  facilityName: true, reason: true, scheduledDate: true, referredByName: true, createdAt: true,
  resident: { select: { firstName: true, lastName: true, roomNumber: true, sponsorId: true } },
} as const;

export async function GET() {
  const ctx = await requireTenantContext({ requireCommunity: true });
  if (!ctx?.communityId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ pending: [], decided: [] });

  const referrals = await prisma.hospitalReferral.findMany({
    where: { communityId: ctx.communityId, resident: { sponsorId: ctx.userId }, notes: { contains: FAMILY_FLAG } },
    select: SELECT,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const mapped = referrals.map((r) => shape(r as unknown as Ref));
  const pending = mapped.filter((a) => a.status === "REQUESTED" && !a.decidedAt);
  const decided = mapped.filter((a) => !(a.status === "REQUESTED" && !a.decidedAt));
  return NextResponse.json({ pending, decided });
}

export async function POST(request: NextRequest) {
  const ctx = await requireTenantContext({ requireCommunity: true });
  if (!ctx?.communityId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const body = await request.json().catch(() => ({}));
  const referralId = String(body.referralId || "");
  const decision = String(body.decision || "");
  const reason = String(body.reason || "").slice(0, 500);
  if (!referralId || (decision !== "APPROVE" && decision !== "DECLINE")) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const referral = await prisma.hospitalReferral.findFirst({
    where: { id: referralId, communityId: ctx.communityId, resident: { sponsorId: ctx.userId } },
    select: { ...SELECT, organizationId: true, communityId: true, residentId: true },
  });
  if (!referral) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  // Must be genuinely awaiting the family.
  if (!(referral.status === "REQUESTED" && !referral.approvedAt && (referral.notes || "").includes(FAMILY_FLAG))) {
    return NextResponse.json({ error: "This appointment was already decided" }, { status: 409 });
  }

  const now = new Date();
  const who = `${referral.resident?.firstName ?? ""} ${referral.resident?.lastName ?? ""}`.trim() || "Resident";
  await prisma.hospitalReferral.update({
    where: { id: referral.id },
    data: decision === "APPROVE"
      ? { status: "SCHEDULED", approvedById: ctx.userId, approvedByName: "Family sponsor", approvedAt: now }
      : { status: "CANCELLED", approvedById: ctx.userId, approvedByName: "Family sponsor", approvedAt: now, rejectionReason: reason || "Declined by family" },
  });

  // Notify the care team of the family's decision.
  try {
    const staff = await prisma.communityMembership.findMany({
      where: { communityId: ctx.communityId, status: "ACTIVE", role: { in: ["FACILITY_ADMIN", "CARE_MANAGER", "NURSE"] } },
      select: { userId: true },
    });
    if (staff.length) {
      await prisma.notification.createMany({
        data: staff.filter((s) => s.userId).map((s) => ({
          userId: s.userId,
          type: "SERVICE_UPDATE" as const,
          title: decision === "APPROVE" ? "Appointment approved by family" : "Appointment declined by family",
          message: decision === "APPROVE"
            ? `The family approved ${who}'s ${noteLine(referral.notes, "Appointment Type") || "appointment"} — it's now scheduled.`
            : `The family declined ${who}'s ${noteLine(referral.notes, "Appointment Type") || "appointment"}.${reason ? ` Reason: ${reason}` : ""}`,
          severity: "INFO",
          relatedEntityId: referral.id,
          relatedEntityType: "referral",
          organizationId: referral.organizationId,
          communityId: referral.communityId,
        })),
      });
    }
  } catch { /* best-effort */ }

  return NextResponse.json({ ok: true, status: decision === "APPROVE" ? "SCHEDULED" : "CANCELLED" });
}
