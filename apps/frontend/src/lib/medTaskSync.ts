// ─────────────────────────────────────────────────────────────
// Scheduled medication ↔ task sync (migration-free).
//
// When a dose is logged as SCHEDULED in the MAR, we open an UNASSIGNED task so
// any on-duty caregiver or nurse can claim and administer it. The task links
// back to the dose through the existing Task.generatedFrom column; completing
// the task records the dose as GIVEN in the MAR. Both directions are wired as
// best-effort side effects in the generic DB API (POST create + PATCH update)
// so they fire no matter which UI path triggers them, and never block the
// primary write.
// ─────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import type { requireTenantContext } from "@/lib/tenant";
import { classifyMedication, medFlagLabels } from "@/lib/medSafety";

type TenantContext = NonNullable<Awaited<ReturnType<typeof requireTenantContext>>>;

/**
 * On a SCHEDULED MedicationAdministration create, open an unassigned "Medication"
 * task for on-duty staff. The task carries the dose's id in `generatedFrom` and
 * its due time in `dueDate`. Best-effort — swallows errors so the MAR write
 * always succeeds.
 */
export async function createMedTaskForSchedule(
  context: TenantContext,
  mar: Record<string, unknown>,
): Promise<void> {
  try {
    if (String(mar.status) !== "SCHEDULED") return;
    const residentId = mar.residentId ? String(mar.residentId) : "";
    if (!residentId) return;

    const medicationId = mar.medicationId ? String(mar.medicationId) : "";
    const med = medicationId
      ? await prisma.medication.findUnique({ where: { id: medicationId }, select: { name: true, dosage: true, route: true } })
      : null;
    const name = (med?.name ?? "").trim() || "medication";
    const dose = String(mar.dosage ?? "").trim() || (med?.dosage ?? "").trim();
    const route = String(mar.route ?? "").trim() || (med?.route ?? "").trim();
    const due = mar.scheduledTime ? new Date(String(mar.scheduledTime)) : new Date();

    // Surface the medication's safety classification in the task itself so the
    // caregiver sees "Vitals required / Vitals first / Controlled / Psychotropic
    // / Hazardous" before administering — same flags the MAR shows as badges.
    const flags = classifyMedication(med?.name);
    const flagLabels = medFlagLabels(med?.name).map((f) => f.label);
    const flagLine = flagLabels.length ? ` Safety flags: ${flagLabels.join(", ")}.` : "";
    const vitalsLine = flags.highRiskVitals
      ? " ⚠ Vitals are REQUIRED before administering — record them first."
      : flags.needsVitals
      ? " Check vitals before administering."
      : "";

    const organizationId = (mar.organizationId as string | undefined) ?? context.organizationId ?? null;
    const communityId = (mar.communityId as string | undefined) ?? context.communityId ?? null;

    // Attribute the task to whoever logged the dose in the MAR — shown as
    // "Assigned By" in the task view. The MAR stores a User id (recordedById),
    // but Task.createdById is a Staff id (resolved to a name via Staff→user), so
    // translate User → Staff here. Falls back to null ("—") if no Staff record.
    const recordedById = mar.recordedById ? String(mar.recordedById) : "";
    const createdById = recordedById
      ? (await prisma.staff.findFirst({
          where: { userId: recordedById, ...(communityId ? { communityId } : {}) },
          select: { id: true },
        }))?.id ?? null
      : null;

    const task = await prisma.task.create({
      data: {
        organizationId,
        communityId,
        residentId,
        title: `Administer ${name}${dose ? ` ${dose}` : ""}`,
        description: `Scheduled medication dose${route ? ` · ${route}` : ""}, due ${due.toLocaleString()}.${flagLine}${vitalsLine} Unassigned — any on-duty caregiver or nurse may claim it. Completing this task records the dose as given in the MAR.`,
        category: "Medication",
        status: "PENDING",
        priority: "HIGH",
        dueDate: due,
        assignedToId: null,
        createdById,
        generatedFrom: String(mar.id),
      },
    });

    // Fan the incoming request out to on-duty staff (approximated as active
    // caregivers + nurses in the community). Clicking the notification routes to
    // the task board — relatedEntityType "task" is mapped there in PortalShell.
    // The scheduler is excluded so they don't get pinged for their own entry.
    if (communityId) {
      const recipients = await prisma.communityMembership.findMany({
        where: { communityId, status: "ACTIVE", role: { in: ["CAREGIVER", "NURSE"] } },
        select: { userId: true },
      });
      const targets = recipients.filter((m) => m.userId && m.userId !== context.userId);
      if (targets.length) {
        await prisma.notification.createMany({
          data: targets.map((m) => ({
            userId: m.userId,
            type: "TASK_ASSIGNMENT" as const,
            title: `Medication due — ${name}${dose ? ` ${dose}` : ""}`,
            message: `A scheduled dose is waiting to be administered (due ${due.toLocaleString()}). Open the task checklist to claim and complete it.`,
            severity: "WARNING",
            relatedEntityId: task.id,
            relatedEntityType: "task",
            organizationId,
            communityId,
          })),
        });
      }
    }
  } catch (e) {
    console.error("[med schedule → task] failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * On a scheduled dose being deleted from the MAR, remove the OPEN task it
 * generated (and the bell notifications pointing at it) so caregivers aren't
 * left with a task for a dose that no longer exists. A task that's already been
 * COMPLETED is left as a work record. Best-effort.
 */
export async function deleteMedTaskForSchedule(
  context: TenantContext,
  mar: Record<string, unknown>,
): Promise<void> {
  try {
    const marId = mar.id ? String(mar.id) : "";
    if (!marId) return;
    const tasks = await prisma.task.findMany({
      where: { generatedFrom: marId, category: "Medication", status: { in: ["PENDING", "IN_PROGRESS"] } },
      select: { id: true },
    });
    if (!tasks.length) return;
    const taskIds = tasks.map((t) => t.id);
    // Drop the incoming-request notifications first (they deep-link to the task),
    // then the tasks themselves.
    await prisma.notification.deleteMany({ where: { relatedEntityType: "task", relatedEntityId: { in: taskIds } } });
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
  } catch (e) {
    console.error("[med delete → task cleanup] failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * On a task being completed, record its linked scheduled dose as GIVEN. Only a
 * still-SCHEDULED dose is touched, so a deliberate REFUSED/HELD/GIVEN is never
 * overridden, and it's idempotent if the task is completed more than once.
 * Best-effort.
 */
export async function syncMarFromCompletedTask(
  context: TenantContext,
  task: Record<string, unknown>,
  completedById?: string | null,
): Promise<void> {
  try {
    if (String(task.category) !== "Medication") return;
    const marId = task.generatedFrom ? String(task.generatedFrom) : "";
    if (!marId) return;

    await prisma.medicationAdministration.updateMany({
      where: { id: marId, status: "SCHEDULED", ...(context.communityId ? { communityId: context.communityId } : {}) },
      data: { status: "GIVEN", actualTime: new Date(), ...(completedById ? { recordedById: completedById } : {}) },
    });
  } catch (e) {
    console.error("[task complete → MAR given] failed:", e instanceof Error ? e.message : e);
  }
}
