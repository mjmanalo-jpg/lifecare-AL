import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDbConfigured } from "@/lib/models";
import { buildIcsCalendar, type IcsEvent } from "@/lib/ics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public iCalendar subscription feed for a resident's appointment schedule.
 *
 *   GET /api/calendar/<token>/appointments.ics
 *
 * The user copies this URL (or its webcal:// form) into Google / Apple / Outlook
 * as a subscribed calendar, so appointments show up alongside their own events
 * and refresh automatically.
 *
 * It is unauthenticated on purpose — calendar clients fetch it without cookies —
 * so authorization is carried by an unguessable random `token`. The token is
 * minted client-side and stored in an AppSetting row keyed `__cal_feed:<token>`
 * (the `__` prefix hides it from the generic /api/db reads). Its value is the
 * resident scope: { residentId }. Migration-free.
 *
 * Appointments are stored on the `Visit` model with the type encoded in
 * `purpose` as "[TYPE] Title" (see AppointmentCalendar.tsx).
 */

const TYPE_LABELS: Record<string, string> = {
  FAMILY_MEETING: "Family Meeting",
  DOCTOR: "Doctor Visit",
  CARE_CONFERENCE: "Care Conference",
  TOUR: "Tour",
  ACTIVITY: "Activity / Event",
  OTHER: "Appointment",
};

function parsePurpose(purpose: string): { type: string; title: string } {
  const m = purpose.match(/^\[([A-Z_]+)\]\s*(.*)$/);
  if (m) return { type: m[1], title: m[2] || TYPE_LABELS[m[1]] || "Appointment" };
  return { type: "OTHER", title: purpose || "Appointment" };
}

function icsResponse(ics: string) {
  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="appointments.ics"',
      "Cache-Control": "no-cache, must-revalidate",
    },
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || !/^[A-Za-z0-9_-]{16,}$/.test(token)) {
    return NextResponse.json({ error: "Invalid calendar token" }, { status: 404 });
  }

  // No DB configured (demo): return an empty but valid calendar so subscriptions
  // still succeed rather than erroring in the calendar client.
  if (!isDbConfigured()) {
    return icsResponse(buildIcsCalendar([], "Appointments"));
  }

  try {
    const feed = await prisma.appSetting.findFirst({
      where: { key: `__cal_feed:${token}` },
      select: { value: true },
    });
    if (!feed) return NextResponse.json({ error: "Calendar not found" }, { status: 404 });

    let residentId = "";
    try {
      const parsed = JSON.parse(feed.value) as { residentId?: string };
      residentId = String(parsed.residentId ?? "");
    } catch {
      residentId = "";
    }
    if (!residentId) return NextResponse.json({ error: "Calendar not found" }, { status: 404 });

    const resident = await prisma.resident.findUnique({
      where: { id: residentId },
      select: { firstName: true, lastName: true, roomNumber: true },
    });
    const residentName = resident ? `${resident.firstName} ${resident.lastName}`.trim() : "Resident";
    const room = resident?.roomNumber ? `Room ${resident.roomNumber}` : "";

    const visits = await prisma.visit.findMany({
      where: { residentId },
      orderBy: { checkInTime: "asc" },
      take: 500,
      select: { id: true, purpose: true, checkInTime: true, checkOutTime: true, visitorName: true, notes: true },
    });

    const events: IcsEvent[] = visits
      .filter((v) => v.checkInTime)
      .map((v) => {
        const { type, title } = parsePurpose(v.purpose ?? "");
        const label = TYPE_LABELS[type] ?? "Appointment";
        const withWhom = v.visitorName && v.visitorName !== "—" ? `With: ${v.visitorName}` : "";
        const descParts = [label, `Resident: ${residentName}`, withWhom, v.notes ?? ""].filter(Boolean);
        return {
          uid: `visit-${v.id}@assisted-living`,
          start: v.checkInTime,
          end: v.checkOutTime ?? null,
          summary: `${title} — ${residentName}`,
          description: descParts.join("\n"),
          location: room,
        };
      });

    return icsResponse(buildIcsCalendar(events, `${residentName} — Appointments`));
  } catch (err) {
    console.error("[calendar feed] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Calendar feed failed" }, { status: 500 });
  }
}
