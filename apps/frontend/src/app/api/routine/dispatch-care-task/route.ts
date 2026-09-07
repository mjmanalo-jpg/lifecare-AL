import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { CAREGIVER_SCHEDULE_KEY, parseSchedules, caregiversForResidentToday } from "@/lib/caregiverSchedule";
import { CARE_TASK_KEY, parseCareTask } from "@/lib/lifecare/careTask";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Send the resident's APPROVED Care Task to ALL caregivers covering them today.
// One task per care-task row per covering caregiver (deduped by staff id → each
// caregiver gets the FULL list once). No caregiver rostered → one unassigned pool
// card per row (claimable from the Board View). Idempotent: re-sending only fills
// gaps for today (keyed by generatedFrom + assignee + title).
// ─────────────────────────────────────────────────────────────

const WRITE_ROLES = new Set(["NURSE", "CARE_MANAGER", "FACILITY_ADMIN", "SUPERADMIN"]);
const TZ = "Asia/Manila";
const localDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const rowMinutes = (t: string): number => {
  const d = (t || "").replace(":", "").padStart(4, "0").slice(0, 4);
  return /^\d{4}$/.test(d) ? (+d.slice(0, 2)) * 60 + (+d.slice(2)) : 12 * 60; // no time → midday
};

export async function POST(request: NextRequest) {
  const ctx = await requireTenantContext({});
  if (!ctx || ctx.isPlatform || !ctx.communityId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!WRITE_ROLES.has(ctx.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const communityId = ctx.communityId;

  let body: { residentId?: unknown } = {};
  try { body = (await request.json()) as typeof body; } catch { body = {}; }
  const residentId = body.residentId ? String(body.residentId) : "";
  if (!residentId) return NextResponse.json({ error: "residentId required" }, { status: 400 });

  const resident = await prisma.resident.findFirst({ where: { id: residentId, communityId }, select: { firstName: true, lastName: true } });
  if (!resident) return NextResponse.json({ error: "Related resident not found" }, { status: 422 });
  const residentName = `${resident.firstName ?? ""} ${resident.lastName ?? ""}`.trim() || undefined;

  // The resident's approved Care Task rows.
  const setting = await prisma.appSetting.findFirst({ where: { key: CARE_TASK_KEY, communityId }, select: { value: true } });
  const rows = (parseCareTask(setting?.value)[residentId]?.rows ?? []).filter((r) => (r.activity || "").trim());
  if (!rows.length) return NextResponse.json({ error: "No Care Task rows to send — approve a Care Task first." }, { status: 422 });

  const now = new Date();
  const todayStr = localDay(now);
  const dayStart = new Date(`${todayStr}T00:00:00+08:00`);
  const dayEnd = new Date(`${todayStr}T23:59:00+08:00`);
  const dueAt = (min: number) => new Date(`${todayStr}T${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00+08:00`);
  const generatedFrom = `caretask:${residentId}`;

  // Caregivers covering the resident today, deduped by staff id (each gets the list once).
  const sched = await prisma.appSetting.findFirst({ where: { communityId, key: CAREGIVER_SCHEDULE_KEY }, select: { value: true } });
  const cover = caregiversForResidentToday(parseSchedules(sched?.value), residentId, now, TZ);
  const staffIds = [...new Set(cover.map((c) => c.caregiverStaffId).filter(Boolean))];
  const assignees: (string | null)[] = staffIds.length ? staffIds : [null]; // null → unassigned pool card

  // Idempotent: skip rows already dispatched to that assignee today.
  const existing = await prisma.task.findMany({
    where: { communityId, generatedFrom, dueDate: { gte: dayStart, lte: dayEnd } },
    select: { title: true, assignedToId: true },
  });
  const seen = new Set(existing.map((t) => `${t.assignedToId ?? ""}|${t.title}`));

  let created = 0;
  for (const row of rows) {
    const title = row.activity.trim();
    const due = dueAt(rowMinutes(row.time));
    const description = `From approved Care Task${row.assistance ? ` · ${row.assistance}` : ""}${row.assistedBy ? ` · ${row.assistedBy}` : ""}`;
    for (const staffId of assignees) {
      const key = `${staffId ?? ""}|${title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        await prisma.task.create({
          data: {
            organizationId: ctx.organizationId ?? null, communityId, residentId,
            title, description, category: "Routine", status: "PENDING", priority: "MEDIUM",
            dueDate: due, generatedFrom,
            assignedToId: staffId ?? undefined,
            recurringPattern: { careTaskRow: true, time: row.time },
          },
        });
        created++;
      } catch { /* FK / transient — skip this task, keep going */ }
    }
  }

  logAudit({
    actorId: ctx.userId, actorRole: ctx.role, action: "CREATE",
    entityType: "care-task-dispatch", entityId: residentId,
    organizationId: ctx.organizationId, communityId,
    after: { residentId, residentName, caregivers: staffIds.length, created },
    reason: `Sent ${created} care task(s) to ${staffIds.length || "the unassigned pool of"} caregiver(s)${residentName ? ` for ${residentName}` : ""}`,
  });

  return NextResponse.json({ created, caregivers: staffIds.length });
}
