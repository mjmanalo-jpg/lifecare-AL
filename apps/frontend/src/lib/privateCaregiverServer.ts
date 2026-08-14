/**
 * Private Caregiver billing — server-side (prisma). Posts the recurring flat fee
 * for an ACTIVE assignment, idempotent per assignment/month via a
 * `[pcg:<id>:<YYYY-MM>]` marker. Shared by the family-approval endpoint and the
 * monthly billing cron. Charge → resident → family sponsor (existing pipeline).
 */

import { prisma } from "@/lib/prisma";
import { RATE_UNIT_LABEL, monthlyEquivalent, type PrivateCareAssignment } from "./privateCaregiver";
import { periodTag } from "./billingLibrary";

const CATEGORY = "Care Services";

export async function applyPrivateCareCharge(opts: {
  organizationId: string | null;
  communityId: string;
  assignment: PrivateCareAssignment;
  now?: Date;
}): Promise<boolean> {
  const { organizationId, communityId, assignment } = opts;
  if (assignment.status !== "ACTIVE") return false;
  const amount = monthlyEquivalent(assignment);
  if (!(amount > 0)) return false;

  const now = opts.now ?? new Date();
  const tag = periodTag(now);
  const marker = `[pcg:${assignment.id}:${tag}]`;
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // Idempotent: one private-care charge per assignment per month.
  const existing = await prisma.serviceCharge.findFirst({
    where: { communityId, residentId: assignment.residentId, serviceDate: { gte: monthStart }, description: { contains: marker } },
    select: { id: true },
  });
  if (existing) return false;

  const description = `Private caregiver — ${assignment.caregiverName} for ${assignment.residentName} (${RATE_UNIT_LABEL[assignment.rateUnit]}) ${marker}`;
  await prisma.serviceCharge.create({
    data: { organizationId: organizationId ?? undefined, communityId, residentId: assignment.residentId, description, amount, category: CATEGORY, serviceDate: now },
  });
  return true;
}
