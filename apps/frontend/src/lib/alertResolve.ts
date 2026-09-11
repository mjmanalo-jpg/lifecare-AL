import { prisma } from "@/lib/prisma";
import { occIdFromRoutineAlertKey, routineAlertKeys } from "@/lib/alertAccess";

/**
 * Auto-resolution of alerts whose source condition has healed.
 *
 * An alert is a Notification keyed by (relatedEntityType, relatedEntityId) — the
 * same key /api/cron/alerts dedupes on. Nothing used to clear that Notification
 * when the underlying work got done, so a completed task kept showing in the
 * Alert Center as permanently overdue.
 *
 * Deleting (rather than marking read) matches what the Alert Center's "Resolve"
 * button does, and it frees the dedupe key so a genuinely NEW breach on the same
 * entity can raise a fresh alert later.
 */

/**
 * Drop every recipient's copy of the alerts raised for these entities.
 * Best-effort: never throws, so it can't fail the write that triggered it.
 * Returns how many notification rows were removed.
 */
export async function clearEntityAlerts(
  relatedEntityType: string,
  relatedEntityIds: string[],
  communityId?: string | null,
): Promise<number> {
  const ids = [...new Set(relatedEntityIds.filter(Boolean))];
  if (!ids.length) return 0;
  try {
    const { count } = await prisma.notification.deleteMany({
      where: { relatedEntityType, relatedEntityId: { in: ids }, ...(communityId ? { communityId } : {}) },
    });
    return count;
  } catch (e) {
    console.error("[alerts] clearEntityAlerts failed:", e instanceof Error ? e.message : e);
    return 0;
  }
}

/**
 * Reconcile a community's open task/routine alerts against current state and
 * clear the ones whose work is already finished. The write paths clear their own
 * alerts immediately; this is the backstop that catches alerts raised before that
 * existed, plus any out-of-band state change. Returns the rows removed.
 */
export async function reconcileStaleAlerts(communityId: string): Promise<number> {
  const open = await prisma.notification.findMany({
    where: { communityId, relatedEntityType: { in: ["task", "routineOccurrence"] }, relatedEntityId: { not: null } },
    select: { relatedEntityId: true, relatedEntityType: true },
  });
  if (!open.length) return 0;

  const taskIds = [...new Set(open.filter((n) => n.relatedEntityType === "task").map((n) => n.relatedEntityId!))];
  // Routine alert ids carry a "routinedue:" / "routinelate:" prefix over the occId.
  const occIds = [...new Set(open.filter((n) => n.relatedEntityType === "routineOccurrence")
    .map((n) => occIdFromRoutineAlertKey(n.relatedEntityId!)))];

  let cleared = 0;

  if (taskIds.length) {
    // Anything not still outstanding is settled — including a task that was
    // deleted outright (its id simply won't come back from this query).
    const stillOpen = new Set((await prisma.task.findMany({
      where: { id: { in: taskIds }, status: { in: ["PENDING", "IN_PROGRESS"] } },
      select: { id: true },
    })).map((t) => t.id));
    cleared += await clearEntityAlerts("task", taskIds.filter((id) => !stillOpen.has(id)), communityId);
  }

  if (occIds.length) {
    const settled = (await prisma.routineOccurrence.findMany({
      where: { communityId, occId: { in: occIds }, workflowState: { in: ["Closed", "Cancelled"] } },
      select: { occId: true },
    })).map((o) => o.occId);
    cleared += await clearEntityAlerts("routineOccurrence", settled.flatMap(routineAlertKeys), communityId);
  }

  return cleared;
}
