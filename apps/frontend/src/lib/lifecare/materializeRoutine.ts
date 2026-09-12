// Materialize a care day's routine occurrences from APPROVED definitions.
//
// This used to live only in GET /api/routine/occurrences, which runs for ONE resident
// when somebody opens their board. So a resident's scheduled care did not exist until
// a human looked at it — and every facility-wide read (Care Delivery reliability, the
// dashboard's delivery metrics) counts RoutineOccurrence rows. Care nobody had opened
// was invisible, which quietly shrank the denominator to the residents that happened to
// be viewed and reported a completion rate for a fraction of the facility.
//
// Same rule, one implementation: the per-resident read still calls it, and a scheduled
// sweep calls it for everyone so the record does not depend on who browsed what.

import { prisma } from "@/lib/prisma";
import { eligibleForCareDay, materializeCareDay } from "./routineDefinitions.ts";

/** Insert any missing occurrences for `residentId` on `careDateISO`. Idempotent:
 *  skipDuplicates on the unique occId, so an existing (possibly charted) row is never
 *  touched. Returns how many rows were newly created. */
export async function materializeResidentDay(
  communityId: string, residentId: string, careDateISO: string,
): Promise<number> {
  const approved = await prisma.routineEventDefinition.findMany({
    where: { residentId, communityId, status: "APPROVED" },
    select: {
      id: true, version: true, residentId: true, communityId: true,
      frequencyMethod: true, schedule: true, effectiveDate: true, stopDate: true, status: true,
    },
  });
  const rows = materializeCareDay(
    eligibleForCareDay(approved, careDateISO).map((d) => ({
      id: d.id, version: d.version, residentId: d.residentId, communityId: d.communityId,
      frequencyMethod: d.frequencyMethod, schedule: d.schedule as never,
    })),
    careDateISO,
  );
  if (!rows.length) return 0;
  const careDate = new Date(`${careDateISO}T00:00:00+08:00`);
  const result = await prisma.routineOccurrence.createMany({
    data: rows.map((o) => ({
      occId: o.occId, definitionId: o.definitionId, definitionVersion: o.definitionVersion,
      residentId: o.residentId, communityId: o.communityId, careDate,
      scheduledTime: o.scheduledTime, workflowState: o.workflowState, escalationState: o.escalationState,
    })),
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * Materialize the care day for EVERY resident in the community that has an approved
 * routine. Driven off the definitions themselves (not the resident list) so residents
 * without a routine cost nothing.
 *
 * ponytail: sequential per resident — a community is tens of residents and this runs on
 * a schedule, so the simple loop beats fighting connection-pool limits for a few ms.
 */
export async function materializeCommunityDay(communityId: string, careDateISO: string): Promise<{
  residents: number; created: number;
}> {
  const withRoutines = await prisma.routineEventDefinition.findMany({
    where: { communityId, status: "APPROVED" },
    select: { residentId: true },
    distinct: ["residentId"],
  });
  let created = 0;
  for (const { residentId } of withRoutines) {
    try {
      created += await materializeResidentDay(communityId, residentId, careDateISO);
    } catch (error) {
      // One resident's bad schedule must not stop the rest of the facility's day.
      console.error(`[materialize] resident ${residentId} on ${careDateISO} failed:`, error);
    }
  }
  return { residents: withRoutines.length, created };
}
