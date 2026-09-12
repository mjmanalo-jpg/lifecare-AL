import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireTenantContext } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { MODEL_VERSION } from "@/lib/lifecare/dataset";
import { classifyOutcome, evaluateVariance, VARIANCE_REVIEW_THRESHOLD, OUTCOMES, type Outcome } from "@/lib/lifecare/careEvents";
import {
  CARE_OUTCOME, CLINICAL_FINDING, fromLegacyOutcome,
  type CareOutcome, type ExceptionReason, type ClinicalFinding, type LegacyOutcome,
} from "@/lib/lifecare/vocab";
import { applyOccurrenceState, escalationStateFromStatus, type OccurrenceState } from "@/lib/lifecare/occurrenceLifecycle";
import { isChartable, manilaMinutesNow, toMin } from "@/lib/lifecare/occurrenceStatus";
import { assistedByLabel, canChartOccurrence } from "@/lib/lifecare/chartingAuthority";
import { validateResult } from "@/lib/lifecare/resultSchema";
import { clearEntityAlerts } from "@/lib/alertResolve";
import { routineAlertKeys } from "@/lib/alertAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// SLMS v4.2 Routine — atomic occurrence completion (sub-project #4, §1).
//
// A caregiver (or nurse/CM) closes ONE RoutineOccurrence. The five controlled-
// vocab state fields are written ONLY through applyOccurrenceState (throws on any
// invalid/cross-field value → 400). Record&Complete events must pass validateResult
// before they can close. Closing one occId never touches another.
//
// After persisting the occurrence, this route fires the SAME governed feedback as
// /api/care-events — a CareEvent, and (when the outcome/finding qualifies) an
// Escalation + a community-scoped Notification — so an atomic exception still
// reaches the clinical chain of command. The occurrence's escalationId +
// escalationState are stamped from the Escalation it raised.
// ─────────────────────────────────────────────────────────────

const WRITE_ROLES = new Set(["CAREGIVER", "NURSE", "CARE_MANAGER", "SUPERADMIN"]);
const str = (v: unknown) => (v == null ? undefined : String(v));

/** Map the request outcome onto the separated v4.2 fields. A canonical CareOutcome
 *  passes through; a legacy flat outcome (careEvents.ts) is bridged via fromLegacyOutcome. */
function resolveOutcome(raw: string | undefined, exceptionReason?: string, clinicalFinding?: ClinicalFinding[]): {
  outcome: CareOutcome; exception?: ExceptionReason; finding?: ClinicalFinding; legacyForClassify: Outcome;
} {
  const r = raw || "Completed as planned";
  if ((CARE_OUTCOME as readonly string[]).includes(r)) {
    // Canonical outcome given directly. Derive a legacy outcome for classifyOutcome
    // (the escalation matrix keys off the flat set): a finding/exception picks the
    // matching legacy bucket, else a plain completion.
    const co = r as CareOutcome;
    let legacy: Outcome = "Completed";
    if (co === "Not completed") {
      legacy = exceptionReason === "Unsafe to perform" ? "Unsafe" : "Refused";
    } else if (co === "Completed with variance") {
      const f = clinicalFinding?.[0];
      legacy = f === "Change from baseline" || f === "Swallowing concern" ? "Clinical Change"
        : f === "Frequency variance" ? "Frequency Variance" : "Increased Assist";
    }
    return { outcome: co, exception: exceptionReason as ExceptionReason | undefined, finding: clinicalFinding?.[0], legacyForClassify: legacy };
  }
  // Legacy flat outcome → bridge to the separated fields.
  const legacy = ((OUTCOMES as readonly string[]).includes(r) ? r : "Completed") as LegacyOutcome;
  const b = fromLegacyOutcome(legacy);
  return { outcome: b.outcome, exception: b.exception, finding: b.finding, legacyForClassify: legacy as Outcome };
}

export async function POST(request: NextRequest) {
  const ctx = await requireTenantContext({});
  if (!ctx || ctx.isPlatform || !ctx.communityId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!WRITE_ROLES.has(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const communityId = ctx.communityId;
  const organizationId = ctx.organizationId ?? undefined;

  let body: Record<string, unknown> = {};
  try { body = (await request.json()) as Record<string, unknown>; } catch { body = {}; }

  const occId = str(body.occId);
  if (!occId) return NextResponse.json({ error: "occId required" }, { status: 400 });

  // Load the occurrence (scoped to this community) + its pinned definition.
  const occ = await prisma.routineOccurrence.findFirst({
    where: { occId, communityId },
    include: { definition: true },
  });
  if (!occ) return NextResponse.json({ error: "Occurrence not found" }, { status: 404 });
  const def = occ.definition;

  // ── Offline replay safety ────────────────────────────────────────────────────
  // The caregiver's client queues this POST when the facility has no signal and
  // replays it on reconnect — and can resend an op whose response was lost. So:
  //
  //  1. Dedupe on the caller's `clientOpId`, stamped into the occurrence's existing
  //     `results` JSON (no schema change). Without it a replay writes a SECOND
  //     CareEvent, Escalation and nurse notification for one act of care. Note this
  //     also fixes a plain double-tap online: Closed→Closed skips the terminal-state
  //     guard in applyOccurrenceState, so a repeat POST used to sail through.
  //  2. Trust the caller's `chartedAt` for WHEN care happened. Care given at 08:04
  //     and synced at 14:00 must read 08:04 — stamping sync time falsifies the
  //     clinical record.
  const clientOpId = str(body.clientOpId);
  const priorResults = (occ.results && typeof occ.results === "object" && !Array.isArray(occ.results))
    ? (occ.results as Record<string, unknown>)
    : undefined;
  if (clientOpId && priorResults?.__clientOpId === clientOpId) {
    return NextResponse.json({ ok: true, deduped: true, occurrence: occ });
  }

  // A client clock can be wrong or hostile: accept only a plausible past instant
  // (small forward skew tolerated, no older than the queue could plausibly hold)
  // and fall back to server time otherwise.
  const chartedAt = (() => {
    const raw = str(body.chartedAt);
    if (!raw) return new Date();
    const t = new Date(raw);
    if (Number.isNaN(t.getTime())) return new Date();
    const age = Date.now() - t.getTime();
    return age >= -5 * 60_000 && age <= 7 * 86_400_000 ? t : new Date();
  })();

  // Care is charted by the role that DELIVERS it (definition.responsibleRole — the
  // "Assisted By" column). A nurse charts nurse-owned (NOD) work such as medication and
  // vitals; clinical oversight roles read the record and never sign for care they did
  // not give. Enforced here, not just in the UI — hiding a button is not authorization.
  if (!canChartOccurrence(ctx.role, def?.responsibleRole)) {
    return NextResponse.json({
      error: `This care is charted by ${assistedByLabel(def?.responsibleRole)}. Your role has read-only access to it.`,
    }, { status: 403 });
  }

  // Caregivers may only chart a chartable (Due/Overdue) occurrence — same gate the
  // UI enforces, re-checked server-side so a stale client can't chart ahead of time.
  // Judged at the moment care was GIVEN (chartedAt), not at sync time — otherwise a
  // completion queued inside its window is rejected purely because the connection
  // came back later, and the caregiver's work is thrown away.
  if (ctx.role === "CAREGIVER" && !isChartable({ scheduledTime: occ.scheduledTime, workflowState: occ.workflowState }, manilaMinutesNow(chartedAt))) {
    return NextResponse.json({ error: "This occurrence is not open for charting yet." }, { status: 409 });
  }

  // ── Resolve the separated-vocab outcome ──────────────────────────────────────
  const clinicalFindingIn = Array.isArray(body.clinicalFinding)
    ? (body.clinicalFinding as unknown[]).map(String).filter((f) => (CLINICAL_FINDING as readonly string[]).includes(f)) as ClinicalFinding[]
    : undefined;
  const exceptionIn = str(body.exceptionReason);
  const { outcome, exception, finding, legacyForClassify } = resolveOutcome(str(body.outcome), exceptionIn, clinicalFindingIn);

  // ── Result-field gate ─────────────────────────────────────────────────────────
  // Two-button caregiver execution: DONE is one tap and finished (no result form) —
  // a bare completion closes without requiring schema fields. We still VALIDATE a
  // structured result when a caller actually submits one (e.g. a nurse recording
  // readings), so a provided payload can't be malformed. Exceptions never require it.
  const results = (body.results && typeof body.results === "object" && !Array.isArray(body.results))
    ? (body.results as Record<string, unknown>) : undefined;
  if (outcome !== "Not completed" && def.resultSchemaKey && results) {
    const v = validateResult(def.resultSchemaKey, results);
    if (!v.ok) {
      // `detail` duplicates missing/invalid as text: the client now posts through the
      // offline outbox helper, which surfaces only `error`/`detail`.
      return NextResponse.json({
        error: "Result is incomplete.",
        detail: [...(v.missing ?? []), ...(v.invalid ?? [])].join(", ") || undefined,
        missing: v.missing, invalid: v.invalid,
      }, { status: 400 });
    }
  }

  // ── Compute the new state through the ONE validated write path ────────────────
  const prevState: OccurrenceState = {
    workflowState: (occ.workflowState as OccurrenceState["workflowState"]) || "Upcoming",
    careDeliveryOutcome: (occ.careDeliveryOutcome as CareOutcome | null) ?? null,
    exceptionReason: (occ.exceptionReason as ExceptionReason | null) ?? null,
    clinicalFinding: (occ.clinicalFinding as ClinicalFinding[] | null) ?? null,
    escalationState: (occ.escalationState as OccurrenceState["escalationState"]) || "Not required",
  };
  let nextState: OccurrenceState;
  let changes;
  try {
    ({ state: nextState, changes } = applyOccurrenceState(prevState, {
      workflowState: "Closed",
      careDeliveryOutcome: outcome,
      exceptionReason: exception ?? null,
      clinicalFinding: finding ? [finding] : (clinicalFindingIn ?? null),
    }));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid state transition." }, { status: 400 });
  }

  // ── Governed feedback (mirror /api/care-events) ──────────────────────────────
  const c = classifyOutcome(legacyForClassify);
  const resident = await prisma.resident.findFirst({
    where: { id: occ.residentId, communityId },
    select: { firstName: true, lastName: true, roomNumber: true },
  });
  const residentName = resident ? `${resident.firstName ?? ""} ${resident.lastName ?? ""}`.trim() || undefined : undefined;
  const room = resident?.roomNumber ?? "—";
  const actorName = str(body.actorName) || "Caregiver";
  const observation = str(body.observation);

  // Repeat-variance → reassessment review (scoped to this resident's routine).
  let reviewAlertRaised = false;
  if (c.isVariance) {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const prior = await prisma.careEvent.count({
      where: { communityId, residentId: occ.residentId, isVariance: true, createdAt: { gte: since }, ...(def.sourceTaskId ? { taskId: def.sourceTaskId } : {}) },
    });
    reviewAlertRaised = evaluateVariance(prior + 1).raiseReviewAlert;
  }

  const escalate = c.immediateEscalation;
  const emergency = c.emergencyPathway;
  const notifyNurse = c.escalationAction !== "none" || reviewAlertRaised;

  // ── Persist the occurrence FIRST (the atomic close) ──────────────────────────
  // `now` is the care time (chartedAt), which equals the request time online.
  const now = chartedAt;
  // Carry the idempotency key alongside any structured result so a replay of this
  // exact op is recognised above and becomes a no-op.
  const resultsToStore = clientOpId
    ? { ...(priorResults ?? {}), ...(results ?? {}), __clientOpId: clientOpId }
    : results;
  try {
    await prisma.routineOccurrence.update({
      where: { id: occ.id },
      data: {
        workflowState: nextState.workflowState,
        careDeliveryOutcome: nextState.careDeliveryOutcome ?? null,
        exceptionReason: nextState.exceptionReason ?? null,
        clinicalFinding: nextState.clinicalFinding ? (nextState.clinicalFinding as Prisma.InputJsonValue) : undefined,
        results: resultsToStore ? (resultsToStore as Prisma.InputJsonValue) : undefined,
        actualTime: now,
        completionUserId: ctx.userId,
        completionAt: now,
      },
    });
  } catch (err) {
    console.error("[routine complete] occurrence update failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not close the occurrence." }, { status: 500 });
  }

  // ── Close the dispatched Care Task copy of this same care ────────────────────
  // The nurse's "Send Care Task to caregivers" action writes a Task row per care-task
  // row (/api/routine/dispatch-care-task). That Task is a SECOND record of the care
  // this occurrence represents, and closing the occurrence never touched it — so once
  // a caregiver charted here, the duplicate sat PENDING forever and kept reappearing
  // in the nurse's triage queue as permanently past-due.
  //
  // No id links the two (dispatch stores only `{ careTaskRow, time }`), so match on
  // two independent keys that must BOTH agree: the exact due instant (care day +
  // HH:MM, which is how dispatch computed dueDate) and the activity title. A miss
  // just leaves the old behaviour; requiring both keys makes closing the WRONG task
  // implausible. Best-effort: the occurrence is already closed and authoritative.
  try {
    const scheduledMinutes = toMin(occ.scheduledTime);
    const expectedDue = new Date(occ.careDate.getTime() + scheduledMinutes * 60_000);
    if (def.name) {
      const copies = await prisma.task.findMany({
        where: {
          communityId,
          residentId: occ.residentId,
          generatedFrom: `caretask:${occ.residentId}`,
          title: def.name,
          dueDate: expectedDue,
          status: { in: ["PENDING", "IN_PROGRESS"] },
        },
        select: { id: true },
      });
      if (copies.length) {
        // Every copy closes: the care happened once, however many caregivers it was
        // dispatched to.
        await prisma.task.updateMany({
          where: { id: { in: copies.map((t) => t.id) } },
          data: { status: "COMPLETED", completedAt: now },
        });
        await clearEntityAlerts("task", copies.map((t) => t.id), communityId);
      }
    }
  } catch (err) {
    console.error("[routine complete] care-task copy close failed:", err);
  }

  // The occurrence is Closed, so its own due/overdue reminders are stale too.
  await clearEntityAlerts("routineOccurrence", routineAlertKeys(occId), communityId);

  // ── Governed CareEvent ───────────────────────────────────────────────────────
  let eventId: string | undefined;
  try {
    const created = await prisma.careEvent.create({
      data: {
        organizationId, communityId, residentId: occ.residentId, residentName,
        eventName: def.name || c.outcome, domain: str(def.sourceAsDomain), eventType: c.isExpected ? "Expected" : "Exception",
        archetype: c.archetype, modelVersion: `${MODEL_VERSION.assessmentVersion}/${MODEL_VERSION.careModelVersion}`,
        taskId: def.sourceTaskId ?? undefined,
        outcome: legacyForClassify,
        observation,
        isException: c.isException,
        isVariance: c.isVariance,
        varianceType: c.isVariance ? legacyForClassify : undefined,
        immediateEscalation: escalate,
        linkedDecisionTree: c.linkedDecisionTree,
        escalationAction: c.escalationAction,
        reviewAlertRaised,
        shift: str(body.shift) || def.shiftOwner || undefined,
        actorId: ctx.userId, actorName,
        // Care time, not sync time — keeps the clinical timeline (and the 30-day
        // variance lookback above) honest for work charted offline.
        createdAt: now,
      },
      select: { id: true },
    });
    eventId = created.id;
  } catch (err) {
    // The occurrence is already closed; the CareEvent is best-effort feedback.
    console.error("[routine complete] care event create failed:", err);
  }

  // ── Escalation + occurrence escalationState stamp ────────────────────────────
  let escalationId: string | undefined;
  if (escalate) {
    try {
      const esc = await prisma.escalation.create({
        data: {
          organizationId, communityId, residentId: occ.residentId,
          situation: `${emergency ? "EMERGENCY PATHWAY — " : ""}${residentName || "Resident"} (Room ${room}) — routine "${def.name}" outcome "${outcome}"${c.linkedDecisionTree ? ` (${c.linkedDecisionTree})` : ""}.${observation ? ` ${observation}` : ""}`,
          recommendation: emergency
            ? `Assess the resident immediately. Initiate the emergency protocol (${c.emergencyProtocol ?? "DT-010"}) and call emergency services if clinically indicated; then review the care plan.`
            : "Assess the resident and intervene per protocol; review the care plan.",
          priority: "URGENT", status: "OPEN",
          raisedBy: actorName, raisedByRole: ctx.role, assignedToRole: "NURSE",
        },
        select: { id: true, status: true },
      });
      escalationId = esc.id;
      // Stamp the occurrence's escalation linkage + derived state (best-effort).
      try {
        const { state: withEsc } = applyOccurrenceState(nextState, { escalationState: escalationStateFromStatus(esc.status) });
        await prisma.routineOccurrence.update({
          where: { id: occ.id },
          data: { escalationId, escalationState: withEsc.escalationState },
        });
      } catch { /* keep default escalationState if the stamp fails */ }
    } catch { /* best-effort */ }
  }

  // ── Community-scoped nurse/CM notification ────────────────────────────────────
  let notified = false;
  if (notifyNurse) {
    const memberships = await prisma.communityMembership.findMany({
      where: { communityId, status: "ACTIVE", role: { in: ["NURSE", "CARE_MANAGER"] } },
      select: { userId: true },
    });
    const nurseIds = [...new Set(memberships.map((m) => m.userId))];
    if (nurseIds.length) {
      const title = escalate ? `Care event — ${outcome}` : reviewAlertRaised ? "Reassessment recommended" : `Care variance — ${outcome}`;
      const message = reviewAlertRaised
        ? `${residentName || "A resident"} (Room ${room}) has ${VARIANCE_REVIEW_THRESHOLD}+ material variances in the last 30 days — review the care plan / level of care (no automatic change).`
        : `${residentName || "A resident"} (Room ${room}): "${outcome}" on "${def.name}", logged by ${actorName}.${observation ? ` ${observation}` : ""}`;
      try {
        await prisma.notification.createMany({
          data: nurseIds.map((userId) => ({
            userId, type: "SYSTEM_ALERT" as never, title, message,
            severity: escalate ? "CRITICAL" : "WARNING",
            relatedEntityId: eventId ?? occ.id, relatedEntityType: "careEvent",
            organizationId, communityId,
          })),
        });
        notified = true;
      } catch { /* best-effort */ }
    }
  }

  logAudit({
    actorId: ctx.userId,
    actorName,
    actorRole: ctx.role,
    action: "UPDATE",
    entityType: "routine-occurrences",
    entityId: occ.id,
    organizationId,
    communityId,
    after: { occId, residentId: occ.residentId, residentName, workflowState: nextState.workflowState, outcome },
    reason: `Charted routine "${def.name}"${residentName ? ` for ${residentName}` : ""} — "${outcome}"${c.isVariance ? " (variance)" : ""}${observation ? `: ${observation}` : ""}`,
  });

  const updated = await prisma.routineOccurrence.findUnique({ where: { id: occ.id }, include: { definition: true } });
  return NextResponse.json({ ok: true, occurrence: updated, eventId, escalated: escalate, emergency, notified, reviewAlertRaised, escalationId, changes });
}
