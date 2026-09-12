import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext } from "@/lib/tenant";
import { careDay } from "@/lib/lifecare/routineCompletions";
import { materializeResidentDay } from "@/lib/lifecare/materializeRoutine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// SLMS v4.2 Routine — on-demand idempotent occurrence materialization
// (sub-project #3, §5). First read of a care day inserts the day's occurrences,
// keyed by the unique occId; a second read creates nothing new and NEVER
// overwrites an existing occurrence (createMany skipDuplicates) — a completed
// row is preserved. Only APPROVED + effective + not-past-stop defs generate
// anything (Rule 14, via eligibleForCareDay). Caregivers may read.
// ─────────────────────────────────────────────────────────────

const READ_ROLES = new Set(["NURSE", "CARE_MANAGER", "SUPERADMIN", "CAREGIVER"]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const ctx = await requireTenantContext({});
  if (!ctx || ctx.isPlatform || !ctx.communityId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!READ_ROLES.has(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const communityId = ctx.communityId;

  const url = new URL(request.url);
  const residentId = url.searchParams.get("residentId") || "";
  if (!residentId) return NextResponse.json({ error: "residentId required" }, { status: 400 });
  const careParam = url.searchParams.get("careDate") || "";
  const careDateISO = ISO_DATE.test(careParam) ? careParam : careDay();

  // Guard the resident is in this community.
  const resident = await prisma.resident.findFirst({ where: { id: residentId, communityId }, select: { id: true } });
  if (!resident) return NextResponse.json({ error: "Related resident not found" }, { status: 422 });

  try {
    // Approved + eligible defs → concrete occurrences, idempotently. Shared with the
    // scheduled community sweep so a resident's care day is identical whether it was
    // created by someone opening this board or by the cron.
    await materializeResidentDay(communityId, residentId, careDateISO);

    // Return the day's occurrences WITH their pinned definition (#4 caregiver
    //    card needs name/instructions/assistance/role/schema/criticality on-row).
    const careDate = new Date(`${careDateISO}T00:00:00+08:00`);
    const data = await prisma.routineOccurrence.findMany({
      where: { residentId, communityId, careDate },
      orderBy: { scheduledTime: "asc" },
      include: { definition: true },
    });
    return NextResponse.json({ data, count: data.length });
  } catch (err) {
    console.error("[routine occurrences] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not materialize the care day." }, { status: 500 });
  }
}
