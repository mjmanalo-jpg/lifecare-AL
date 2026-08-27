import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext } from "@/lib/tenant";
import { CAREGIVER_SCHEDULE_KEY, parseSchedules, assigneeForResidentToday } from "@/lib/caregiverSchedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Care-plan task MATERIALIZER.
//
// A care plan is a recurring TEMPLATE: its INTERVENTION items carry a frequency.
// This job creates each day's real caregiver Task instances from every ACTIVE
// (review-released) care plan and routes them to the caregiver SCHEDULED for that
// resident today. So a resident's tasks only appear when a caregiver is covering
// them, and they follow whoever is on the roster each day.
//
//   • No caregiver scheduled for the resident today → NO task that day. It
//     materializes automatically once a caregiver is scheduled (idempotent).
//   • Daily / per-shift / "per care plan" → one instance/day.
//   • Weekly → only on the plan's start weekday.
//   • PRN / as-needed → never auto-materialized (created on demand).
//
// Idempotent: a plan+intervention already materialized for today is skipped, so
// running hourly (and pinging on review-release) never duplicates.
//
// Auth mirrors /api/cron/alerts: a Vercel-cron request (Bearer CRON_SECRET) runs
// ALL communities; a signed-in NURSE / CARE_MANAGER / FACILITY_ADMIN / SUPERADMIN
// runs only their own community (used to materialize immediately on release).
// ─────────────────────────────────────────────────────────────

const TZ = "Asia/Manila"; // facility-local calendar day (matches the rest of the app)
const freqOf = (desc: string | null): string => (/Frequency:\s*([^·[]+)/.exec(desc || "")?.[1] || "Daily").trim();
const careTaskIdOf = (desc: string | null): string | null => /\[task:([^\]]+)\]/.exec(desc || "")?.[1]?.trim() || null;
const weekdayOf = (dateStr: string) => new Date(dateStr + "T00:00:00Z").getUTCDay();
const localDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);

// How many task cards a frequency yields per day, and when each is due (local hour).
// BID → 2, TID → 3, "Every shift" → 3 (AM/PM/NOC). Everything else (Daily / Per care
// plan / Weekly) → a single card. PRN & weekly-anchor are filtered before this.
type Occurrence = { label: string; hour: number };
function occurrencesFor(freq: string): Occurrence[] {
  const f = freq.toLowerCase();
  if (/every shift/.test(f)) return [{ label: "AM", hour: 8 }, { label: "PM", hour: 16 }, { label: "NOC", hour: 23 }];
  if (/\btid\b|three times/.test(f)) return [{ label: "Morning", hour: 8 }, { label: "Afternoon", hour: 14 }, { label: "Evening", hour: 20 }];
  if (/\bbid\b|twice/.test(f)) return [{ label: "AM", hour: 8 }, { label: "PM", hour: 18 }];
  return [{ label: "", hour: 0 }]; // single card (hour 0 → use end-of-day due)
}

async function materializeCommunity(communityId: string, organizationId: string | null): Promise<number> {
  const now = new Date();
  const todayStr = localDay(now);
  const dayStart = new Date(`${todayStr}T00:00:00+08:00`);
  const dayEnd = new Date(`${todayStr}T23:59:00+08:00`);
  const todayWd = weekdayOf(todayStr);

  // Active (released) plans + their intervention items.
  const plans = await prisma.carePlan.findMany({
    where: { communityId, status: "ACTIVE" },
    select: {
      id: true, residentId: true, startDate: true,
      carePlanItems: { where: { category: "INTERVENTION", status: "ACTIVE" }, select: { title: true, description: true } },
    },
  });
  if (!plans.length) return 0;
  const planIds = plans.map((p) => p.id);

  // Dedupe against tasks already materialized for these plans TODAY.
  const existing = await prisma.task.findMany({
    where: { communityId, generatedFrom: { in: planIds }, dueDate: { gte: dayStart, lte: dayEnd } },
    select: { generatedFrom: true, title: true },
  });
  const seen = new Set(existing.map((t) => `${t.generatedFrom}|${t.title}`));

  // Caregiver roster (migration-free app-setting).
  const sched = await prisma.appSetting.findFirst({ where: { communityId, key: CAREGIVER_SCHEDULE_KEY }, select: { value: true } });
  const schedules = parseSchedules(sched?.value);

  let created = 0;
  for (const plan of plans) {
    // The caregiver covering this resident today; none → no tasks materialize.
    const assignee = assigneeForResidentToday(schedules, plan.residentId, now, TZ);
    if (!assignee?.caregiverStaffId) continue;

    const startWd = weekdayOf(localDay(new Date(plan.startDate)));
    const dueAt = (hour: number) => new Date(`${todayStr}T${String(hour).padStart(2, "0")}:00:00+08:00`);
    for (const item of plan.carePlanItems) {
      const freq = freqOf(item.description);
      if (/PRN|as needed/i.test(freq)) continue;                 // on-demand only
      if (/Weekly/i.test(freq) && startWd !== todayWd) continue; // weekly anchor day
      const category = item.title.split(":")[0].trim() || "Care Plan";
      const careTaskId = careTaskIdOf(item.description);
      // One card per occurrence, each with its own shift-based due time. The occurrence
      // label is folded into the title so the per-(plan,title) dedup keeps each slot
      // distinct and idempotent across re-runs.
      for (const occ of occurrencesFor(freq)) {
        const title = occ.label ? `${item.title} · ${occ.label}` : item.title;
        const key = `${plan.id}|${title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          await prisma.task.create({
            data: {
              organizationId, communityId, residentId: plan.residentId,
              title,
              description: item.description ? `From care plan · ${item.description}` : `From care plan · ${freq}`,
              category,
              status: "PENDING", priority: "MEDIUM",
              dueDate: occ.label ? dueAt(occ.hour) : dayEnd, generatedFrom: plan.id,
              assignedToId: assignee.caregiverStaffId,
              // Governed care-event linkage — lets task completion resolve the routine's
              // Care Task Master archetype (doc template + escalation/reassessment).
              recurringPattern: careTaskId ? { careTaskId } : undefined,
            },
          });
          created++;
        } catch { /* FK / transient — skip this task, keep going */ }
      }
    }
  }
  return created;
}

async function run(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const isCron = Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;

  let communities: { id: string; organizationId: string | null }[] = [];
  if (isCron) {
    communities = await prisma.community.findMany({ where: { isActive: true }, select: { id: true, organizationId: true } });
  } else {
    const ctx = await requireTenantContext({});
    if (!ctx || ctx.isPlatform || !ctx.communityId || !["FACILITY_ADMIN", "SUPERADMIN", "NURSE", "CARE_MANAGER"].includes(ctx.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    communities = [{ id: ctx.communityId, organizationId: ctx.organizationId ?? null }];
  }

  let created = 0;
  for (const c of communities) {
    try { created += await materializeCommunity(c.id, c.organizationId); }
    catch (e) { console.error("care-plan-tasks materialize failed for community", c.id, e instanceof Error ? e.message : "unknown"); }
  }
  return NextResponse.json({ ok: true, communities: communities.length, created });
}

export async function GET(request: NextRequest) { return run(request); }
export async function POST(request: NextRequest) { return run(request); }
