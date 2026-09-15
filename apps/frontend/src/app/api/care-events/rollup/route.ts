import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext } from "@/lib/tenant";
import { countsAsCompleted, type CareOutcome } from "@/lib/lifecare/vocab";
import { chartingDeadlineMin, deriveState, isMissed, manilaMinutesNow, shiftOfTime } from "@/lib/lifecare/occurrenceStatus";
import { CAREGIVER_SCHEDULE_KEY, localDateStr, parseSchedules } from "@/lib/caregiverSchedule";
import type { RoutineShift } from "@/lib/lifecare/carePlanRoutine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Care Delivery roll-up — the ACCURATE completion figures for the board.
//
// Why this route exists rather than counting rows in the client: completion is
// `completed / SCHEDULED`, and the scheduled set lives in RoutineOccurrence. A task
// that was never charted produces no CareEvent at all, so a CareEvent-only count can
// only ever report 100% — it cannot see the misses. The generic /api/db reader also
// hard-caps `take` at 500, which silently truncates any real facility's period.
//
// So: aggregate both tables server-side, over the whole period, and return the exact
// roll-up the board renders. Completion/missed come from the occurrences (the plan);
// exceptions/escalations/reassessment flags come from the governed CareEvents.
//
// Read-only. Nurse + Care Manager (+ SuperAdmin) see the facility; the tenant context
// scopes every query to the active community.
// ─────────────────────────────────────────────────────────────

const READ_ROLES = new Set(["NURSE", "CARE_MANAGER", "SUPERADMIN", "FACILITY_ADMIN"]);
const FACILITY_TZ = process.env.FACILITY_TZ || "Asia/Manila";
const MANILA_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;
const SHIFTS: RoutineShift[] = ["AM", "PM", "NOC"];

/** Manila-midnight instant of the care day containing `ms`. careDate is stored this way. */
const manilaMidnight = (ms: number): number =>
  Math.floor((ms + MANILA_OFFSET_MS) / DAY_MS) * DAY_MS - MANILA_OFFSET_MS;

/** CareEvent.shift is free text (AM/PM/NOC, or a definition's shiftOwner label). */
function normalizeShift(raw: string | null): RoutineShift | null {
  const v = (raw || "").trim().toUpperCase();
  if (!v) return null;
  if (v.startsWith("NOC") || v.startsWith("NIGHT")) return "NOC";
  if (v.startsWith("AM") || v.startsWith("MORN")) return "AM";
  if (v.startsWith("PM") || v.startsWith("AFTERNOON") || v.startsWith("EVE")) return "PM";
  return null;
}

type ShiftCounts = Record<RoutineShift, number>;
const zeroShifts = (): ShiftCounts => ({ AM: 0, PM: 0, NOC: 0 });

interface Bucket {
  id: string;
  name: string;
  /** Resident buckets only: nobody is rostered to this resident today, so their
   *  scheduled care has no one to deliver it. Explains a 0% row. */
  uncoveredToday?: boolean;
  scheduled: number;
  due: number;
  /** In its window RIGHT NOW and not charted. Not yet `due` (the grace has not run
   *  out), so a 100% row can still have live work a manager should see. */
  dueNow: number;
  completed: number;
  missed: number;
  exceptions: number;
  escalations: number;
  reassess: boolean;
  onTime: number;
  timed: number;
  charted: number;
  last: string;
  shifts: ShiftCounts;
}

const bucket = (id: string, name: string): Bucket => ({
  id, name, scheduled: 0, due: 0, dueNow: 0, completed: 0, missed: 0, exceptions: 0,
  escalations: 0, reassess: false, onTime: 0, timed: 0, charted: 0, last: "", shifts: zeroShifts(),
});

const take = (m: Map<string, Bucket>, id: string, name: string): Bucket => {
  const cur = m.get(id);
  if (cur) { if (!cur.name && name) cur.name = name; return cur; }
  const b = bucket(id, name);
  m.set(id, b);
  return b;
};

const bumpLast = (b: Bucket, iso: string) => { if (iso > b.last) b.last = iso; };

export async function GET(request: NextRequest) {
  const ctx = await requireTenantContext({});
  if (!ctx || ctx.isPlatform || !ctx.communityId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!READ_ROLES.has(String(ctx.role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const communityId = ctx.communityId;

  const params = new URL(request.url).searchParams;
  // Capped at the widest period the board offers, so the occurrence scan stays bounded.
  const days = Math.min(Math.max(Number(params.get("days") || 7), 1), 31);
  const shiftParam = String(params.get("shift") || "ALL").toUpperCase();
  const shiftFilter = (SHIFTS as string[]).includes(shiftParam) ? (shiftParam as RoutineShift) : null;

  const nowMs = Date.now();
  const todayMidnight = manilaMidnight(nowMs);
  const startMs = todayMidnight - (days - 1) * DAY_MS;
  const start = new Date(startMs);
  const nowMin = manilaMinutesNow(new Date(nowMs));

  const [occurrences, events, residents, rosterSetting] = await Promise.all([
    // `lte` today matters: the materialiser pre-creates future care days, and counting
    // them as scheduled-in-this-period would pad the denominator with work not yet owed.
    prisma.routineOccurrence.findMany({
      where: { communityId, careDate: { gte: start, lte: new Date(todayMidnight) } },
      select: {
        residentId: true, careDate: true, scheduledTime: true, workflowState: true,
        careDeliveryOutcome: true, completionUserId: true, completionAt: true,
        // Drives the charting window: nurse-owned rows are +30 min, hands-on care
        // has the rest of its shift (chartingDeadlineMin).
        definition: { select: { responsibleRole: true } },
      },
    }),
    prisma.careEvent.findMany({
      where: { communityId, createdAt: { gte: start } },
      select: {
        residentId: true, residentName: true, shift: true,
        isException: true, immediateEscalation: true, reviewAlertRaised: true,
        actorId: true, actorName: true, createdAt: true,
      },
    }),
    prisma.resident.findMany({
      where: { communityId },
      select: { id: true, firstName: true, lastName: true },
    }),
    // Today's roster, so a resident sitting at 0% can say WHY: scheduled care with
    // nobody rostered to deliver it. The uncovered resident is never filtered out —
    // dropping them would inflate completion by hiding the failure.
    prisma.appSetting.findFirst({
      where: { communityId, key: CAREGIVER_SCHEDULE_KEY },
      select: { value: true },
    }),
  ]);
  const todayStr = localDateStr(new Date(nowMs), FACILITY_TZ);
  const coveredToday = new Set(
    parseSchedules(rosterSetting?.value).filter((s) => s.date === todayStr).flatMap((s) => s.residentIds),
  );

  // Name lookups. Residents come from the roster; caregivers from the CareEvent actor
  // (RoutineOccurrence stores only completionUserId) — the two are written together by
  // /api/routine/complete, so actorId === completionUserId for the same close.
  const residentName = new Map(
    residents.map((r) => [r.id, `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || "Resident"]),
  );
  const staffName = new Map<string, string>();
  for (const e of events) if (e.actorId && e.actorName) staffName.set(e.actorId, e.actorName);

  const byResident = new Map<string, Bucket>();
  const byCaregiver = new Map<string, Bucket>();
  const outcomes = new Map<string, number>();

  let scheduled = 0, due = 0, completed = 0, missed = 0;

  for (const o of occurrences) {
    const shift = shiftOfTime(o.scheduledTime);
    if (shiftFilter && shift !== shiftFilter) continue;
    if (o.workflowState === "Cancelled") continue; // withdrawn from the plan, not a miss

    const dayMs = manilaMidnight(o.careDate.getTime());
    const dayCmp = Math.sign(dayMs - todayMidnight);
    const done = !!o.careDeliveryOutcome && countsAsCompleted(o.careDeliveryOutcome as CareOutcome);
    const gone = isMissed(o, nowMin, dayCmp);
    // OWED care only. A task later today whose window has not opened is scheduled but
    // not yet due, so it must not count against completion — otherwise the rate reads
    // as a failure every morning. Anything already charted is due by definition.
    const owed = gone || o.workflowState === "Closed";

    scheduled += 1;
    if (owed) due += 1;
    if (done) completed += 1;
    if (gone) missed += 1;
    // The breakdown covers the whole plan, so an uncharted task is visible as
    // "Not documented" instead of vanishing and inflating the completion rate.
    const label = o.careDeliveryOutcome || (gone ? "Not documented" : "Still open");
    outcomes.set(label, (outcomes.get(label) || 0) + 1);

    // Live work: inside its window today and still open. It is deliberately NOT in
    // `due` (the grace has not expired, so it is not a miss) — but a row reading 100%
    // while care is actively waiting needs to say so.
    const liveNow = dayCmp === 0 && o.workflowState !== "Closed" && deriveState(o, nowMin) === "Due";

    const r = take(byResident, o.residentId, residentName.get(o.residentId) || "Resident");
    r.scheduled += 1;
    r.shifts[shift] += 1;
    if (owed) r.due += 1;
    if (liveNow) r.dueNow += 1;
    if (done) r.completed += 1;
    if (gone) r.missed += 1;
    if (o.completionAt) bumpLast(r, o.completionAt.toISOString());

    // Punctuality is only measurable on occurrence closes — those are the tasks with a
    // scheduled time. Task-based charting (/api/care-events from CaregiverTasks) has no
    // schedule, so it lands in `charted` below but never in `timed`.
    if (o.completionUserId && o.completionAt) {
      const c = take(byCaregiver, o.completionUserId, staffName.get(o.completionUserId) || "Caregiver");
      c.timed += 1;
      if (done) c.completed += 1;
      // On time = closed inside the charting window on that care day (rest of the
      // shift for hands-on care; +30 min for nurse-owned medication rows). Charting
      // at the caregiver's designated charting time is on time, not late.
      const dueMs = dayMs + (chartingDeadlineMin(o) + 1) * 60_000;
      if (o.completionAt.getTime() < dueMs) c.onTime += 1;
      bumpLast(c, o.completionAt.toISOString());
    }
  }

  // Exceptions / escalations / reassessment flags — the governed CareEvent layer. Every
  // charting path writes one (routine closes AND Task-based work), so it is also the
  // honest measure of a caregiver's documented volume.
  let exceptions = 0, escalations = 0, charted = 0;
  const reassessResidents = new Set<string>();
  for (const e of events) {
    const shift = normalizeShift(e.shift);
    if (shiftFilter && shift !== shiftFilter) continue;
    charted += 1;
    if (e.isException) exceptions += 1;
    if (e.immediateEscalation) escalations += 1;
    if (e.reviewAlertRaised) reassessResidents.add(e.residentId);

    const r = take(byResident, e.residentId, e.residentName || residentName.get(e.residentId) || "Resident");
    if (e.isException) r.exceptions += 1;
    if (e.immediateEscalation) r.escalations += 1;
    if (e.reviewAlertRaised) r.reassess = true;
    bumpLast(r, e.createdAt.toISOString());

    if (e.actorId) {
      const c = take(byCaregiver, e.actorId, e.actorName || "Caregiver");
      c.charted += 1;
      if (shift) c.shifts[shift] += 1;
      if (e.isException) c.exceptions += 1;
      if (e.immediateEscalation) c.escalations += 1;
      if (e.reviewAlertRaised) c.reassess = true;
      bumpLast(c, e.createdAt.toISOString());
    }
  }

  // Worst first — a resident with misses is the one the nurse must see.
  const rank = (a: Bucket, b: Bucket) =>
    (b.missed - a.missed) || (b.exceptions - a.exceptions) || (b.due - a.due) || (b.charted - a.charted);

  const rollup = {
    days,
    shift: shiftFilter ?? "ALL",
    scheduled,
    due,
    completed,
    missed,
    exceptions,
    escalations,
    reassessResidents: reassessResidents.size,
    charted,
    outcomes: [...outcomes.entries()].map(([outcome, n]) => ({ outcome, n })).sort((a, b) => b.n - a.n),
    byResident: [...byResident.values()]
      .map((b) => ({ ...b, uncoveredToday: !coveredToday.has(b.id) }))
      .sort(rank),
    byCaregiver: [...byCaregiver.values()].sort(rank),
  };

  // `data: [row]` matches the generic /api/db envelope so useLiveQuery's caching,
  // polling and realtime plumbing is reused unchanged.
  return NextResponse.json({ data: [rollup] });
}
