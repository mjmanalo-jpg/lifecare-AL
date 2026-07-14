import { NextRequest, NextResponse } from "next/server";
import { getModel, isDbConfigured } from "@/lib/models";
import { getSession, validateSession } from "@/lib/auth";
import { DEMO } from "@/lib/demoData";
import { prisma } from "@/lib/prisma";
import { residentBelongsToSession } from "@/lib/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Single-record endpoint.
 *   GET    /api/db/:model/:id?include=resident
 *   PATCH  /api/db/:model/:id   (body = partial update)
 *   DELETE /api/db/:model/:id
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ model: string; id: string }> }
) {
  const role = await validateSession();
  if (!role) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { model, id } = await params;
  const def = getModel(model);
  if (!def) return NextResponse.json({ error: `Unknown model '${model}'` }, { status: 404 });

  if (!isDbConfigured()) {
    const row = (DEMO[model] ?? []).find((r) => r.id === id);
    return row
      ? NextResponse.json({ data: row, demo: true })
      : NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const includeParam = new URL(req.url).searchParams.get("include");
    const include = includeParam
      ? Object.fromEntries(includeParam.split(",").map((r) => [r.trim(), true]))
      : undefined;
    const data = await def.delegate.findUnique({ where: { id }, ...(include ? { include } : {}) });
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ model: string; id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = session.role;

  const { model, id } = await params;
  const def = getModel(model);
  if (!def) return NextResponse.json({ error: `Unknown model '${model}'` }, { status: 404 });

  // Self-service roles may only update messages (mark-as-read), cancel their
  // own call bells, confirm & rate their own service requests, and cancel
  // their own concierge bookings; no other edits.
  const SELF_SERVICE = role === "FAMILY" || role === "RESIDENT";
  const SELF_PATCHABLE = new Set([
    "messages", "call-bells", "service-requests", "concierge-bookings",
    // Phase 7 PMS engagement — residents manage their own profile & bookings.
    "resident-preferences", "event-attendances", "dining-reservations",
  ]);
  if (SELF_SERVICE && !SELF_PATCHABLE.has(model)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  if (!isDbConfigured()) {
    return NextResponse.json({ data: { id, ...body }, demo: true });
  }

  // Self-service call-bell updates: cancel-only, and only for a bell that
  // belongs to the caller's own resident (or a sponsored resident for FAMILY).
  if (SELF_SERVICE && model === "call-bells") {
    if (String(body.status ?? "") !== "CANCELLED") {
      return NextResponse.json(
        { error: "Residents may only cancel their own call bells" },
        { status: 403 }
      );
    }
    try {
      const bell = await prisma.callBell.findUnique({ where: { id }, select: { residentId: true } });
      if (!bell) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const owned = await prisma.resident.findFirst({
        where: {
          id: bell.residentId,
          ...(role === "RESIDENT" ? { userId: session.userId } : { sponsorId: session.userId }),
        },
        select: { id: true },
      });
      if (!owned) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const data = await prisma.callBell.update({
        where: { id },
        data: { status: "CANCELLED", resolvedAt: new Date() },
      });
      return NextResponse.json({ data });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Update failed";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  // Self-service service-request updates: confirm & rate a COMPLETED ticket
  // only, and only for the caller's own resident (or a sponsored resident).
  if (SELF_SERVICE && model === "service-requests") {
    const rating = Number(body.rating ?? 0);
    if (String(body.status ?? "") !== "CONFIRMED" || !(rating >= 1 && rating <= 5)) {
      return NextResponse.json(
        { error: "Residents may only confirm and rate (1–5) their own completed requests" },
        { status: 403 }
      );
    }
    try {
      const ticket = await prisma.serviceRequest.findUnique({ where: { id }, select: { residentId: true, status: true } });
      if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (ticket.status !== "COMPLETED") {
        return NextResponse.json({ error: "Only completed requests can be confirmed" }, { status: 400 });
      }
      const owned = await prisma.resident.findFirst({
        where: {
          id: ticket.residentId,
          ...(role === "RESIDENT" ? { userId: session.userId } : { sponsorId: session.userId }),
        },
        select: { id: true },
      });
      if (!owned) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const data = await prisma.serviceRequest.update({
        where: { id },
        data: {
          status: "CONFIRMED",
          rating,
          ratingComment: body.ratingComment ? String(body.ratingComment) : null,
          confirmedAt: new Date(),
        },
      });
      return NextResponse.json({ data });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Update failed";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  // Self-service concierge-booking updates: cancel-only, own bookings only.
  if (SELF_SERVICE && model === "concierge-bookings") {
    if (String(body.status ?? "") !== "CANCELLED") {
      return NextResponse.json(
        { error: "Residents may only cancel their own concierge bookings" },
        { status: 403 }
      );
    }
    try {
      const booking = await prisma.conciergeBooking.findUnique({ where: { id }, select: { residentId: true } });
      if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const owned = await prisma.resident.findFirst({
        where: {
          id: booking.residentId,
          ...(role === "RESIDENT" ? { userId: session.userId } : { sponsorId: session.userId }),
        },
        select: { id: true },
      });
      if (!owned) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const data = await prisma.conciergeBooking.update({
        where: { id },
        data: { status: "CANCELLED" },
      });
      return NextResponse.json({ data });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Update failed";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  // Self-service PMS engagement: residents may edit only their own preference,
  // event-attendance (RSVP/rating), and dining-reservation rows.
  if (SELF_SERVICE && ["resident-preferences", "event-attendances", "dining-reservations"].includes(model)) {
    try {
      const existing = await def.delegate.findUnique({ where: { id }, select: { residentId: true } });
      if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const owned = await residentBelongsToSession(String(existing.residentId), session);
      if (!owned) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      // Never allow a self-service caller to reassign a row to another resident.
      const safe = { ...body };
      delete safe.residentId;
      const data = await def.delegate.update({ where: { id }, data: safe });
      return NextResponse.json({ data });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Update failed";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  try {
    const data = await def.delegate.update({ where: { id }, data: body });
    // Staff completed a service ticket → ask the resident (and sponsor) live to
    // confirm & rate. Fire-and-forget so the API response is never blocked.
    if (model === "service-requests" && body.status === "COMPLETED") {
      notifyServiceCompleted(data).catch((e) =>
        console.error("[id/route.ts:serviceCompletedNotifyError]", e)
      );
    }
    // A resolved SBAR escalation → notify the resident's family/self of the outcome.
    if (model === "escalations" && body.status === "RESOLVED") {
      notifyEscalationResolved(data).catch((e) =>
        console.error("[id/route.ts:escalationResolvedNotifyError]", e)
      );
    }
    return NextResponse.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function notifyServiceCompleted(data: any) {
  const resident = await prisma.resident.findUnique({
    where: { id: data.residentId },
    select: { firstName: true, lastName: true, sponsorId: true, userId: true },
  });
  if (!resident) return;
  const recipients = [resident.sponsorId, resident.userId].filter(Boolean) as string[];
  if (!recipients.length) return;
  const category = String(data.category || "service").replace(/_/g, " ").toLowerCase();
  await prisma.notification.createMany({
    data: recipients.map((uid) => ({
      userId: uid,
      type: "SERVICE_UPDATE" as const,
      title: "Service Request Completed",
      message: `Your ${category}${data.subType ? ` — ${data.subType}` : ""} request is done${data.photoProofUrl ? " (photo proof attached)" : ""}. Please confirm and rate the service (1–5 ★).`,
      relatedEntityId: data.id,
      relatedEntityType: "ServiceRequest",
    })),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function notifyEscalationResolved(data: any) {
  const resident = await prisma.resident.findUnique({
    where: { id: data.residentId },
    select: { firstName: true, lastName: true, sponsorId: true, userId: true },
  });
  if (!resident) return;
  const recipients = [resident.sponsorId, resident.userId].filter(Boolean) as string[];
  if (!recipients.length) return;
  const name = `${resident.firstName} ${resident.lastName}`;
  await prisma.notification.createMany({
    data: recipients.map((uid) => ({
      userId: uid,
      type: "SBAR_ESCALATION" as const,
      title: "Clinical Concern Resolved",
      message: `The care team resolved a clinical concern for ${name}${data.resolvedBy ? ` — reviewed by ${data.resolvedBy}` : ""}.${data.response ? ` Plan: ${String(data.response).slice(0, 120)}` : ""}`,
      relatedEntityId: data.id,
      relatedEntityType: "Escalation",
    })),
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ model: string; id: string }> }
) {
  const role = await validateSession();
  if (!role) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { model, id } = await params;
  const def = getModel(model);
  if (!def) return NextResponse.json({ error: `Unknown model '${model}'` }, { status: 404 });

  // Self-service logins (FAMILY/RESIDENT) can never delete.
  if (role === "FAMILY" || role === "RESIDENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isDbConfigured()) {
    return NextResponse.json({ ok: true, demo: true });
  }

  try {
    await def.delegate.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
