import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { CRM_LEADS_KEY, parseLeads, newId, type Lead } from "@/lib/crmLeads";

// Inbound integration: another system (initially SLMS Home) refers a prospective
// resident into this facility's CRM pipeline. Authenticated by a per-community
// API key stored (hashed) as a server-only AppSetting; the key resolves the
// tenant, so the caller never picks the community by trusting the request body.

export const SLMS_INTEGRATION_KEY_SETTING = "__slms_integration_key";
export const SLMS_LEAD_SOURCE = "SLMS Home";

export interface SlmsLeadPayload {
  name: string;
  contact?: string;
  email?: string;
  notes?: string;
  prospectiveResident?: string;
  externalId?: string;
}

export interface IngestResult {
  leadId: string;
  deduped: boolean;
  notified: number;
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key.trim()).digest("hex");
}

/** Resolve {organizationId, communityId} for a presented API key, or null. */
export async function resolveTenantByKey(
  key: string,
): Promise<{ organizationId: string; communityId: string } | null> {
  const hash = hashKey(key);
  const rows = await prisma.appSetting.findMany({
    where: { key: SLMS_INTEGRATION_KEY_SETTING },
    select: { value: true, organizationId: true, communityId: true },
  });
  // Constant-work scan (community count is small); match by hash equality.
  const match = rows.find((r) => r.value === hash && r.organizationId && r.communityId);
  if (!match) return null;
  return { organizationId: match.organizationId!, communityId: match.communityId! };
}

/**
 * Append a referral to the community's crm_leads pipeline (stage NEW) and notify
 * the community's Care Managers. Idempotent on externalId: a repeat referral for
 * the same source record returns the existing lead instead of duplicating it.
 */
export async function ingestSlmsLead(
  tenant: { organizationId: string; communityId: string },
  payload: SlmsLeadPayload,
): Promise<IngestResult> {
  const settingId = `${tenant.organizationId}:${tenant.communityId}:${CRM_LEADS_KEY}`;
  const existingSetting = await prisma.appSetting.findFirst({
    where: { organizationId: tenant.organizationId, communityId: tenant.communityId, key: CRM_LEADS_KEY },
    select: { id: true, value: true },
  });
  const leads = parseLeads(existingSetting?.value);

  if (payload.externalId) {
    const dupe = leads.find((l) => l.externalId === payload.externalId);
    if (dupe) return { leadId: dupe.id, deduped: true, notified: 0 };
  }

  const nowIso = new Date().toISOString();
  const lead: Lead = {
    id: newId(),
    name: payload.name.trim(),
    contact: payload.contact?.trim() || undefined,
    email: payload.email?.trim() || undefined,
    source: SLMS_LEAD_SOURCE,
    prospectiveResident: payload.prospectiveResident?.trim() || undefined,
    stage: "NEW",
    notes: payload.notes?.trim() || undefined,
    createdAt: nowIso,
    externalId: payload.externalId,
    activity: [{ at: nowIso, by: SLMS_LEAD_SOURCE, note: "Referral received from SLMS Home — resident needs more care." }],
  };
  const nextValue = JSON.stringify([lead, ...leads]);

  // Upsert the crm_leads AppSetting (id is the tenant-composite, matching the
  // app-settings write path in the generic model gateway).
  await prisma.appSetting.upsert({
    where: { id: existingSetting?.id ?? settingId },
    update: { value: nextValue },
    create: { id: settingId, key: CRM_LEADS_KEY, value: nextValue, organizationId: tenant.organizationId, communityId: tenant.communityId },
  });

  // Notify the community's Care Managers so the referral is surfaced to a
  // clinical decision-maker rather than only sitting on the CRM board.
  const managers = await prisma.communityMembership.findMany({
    where: { communityId: tenant.communityId, status: "ACTIVE", role: "CARE_MANAGER" },
    select: { userId: true },
  });
  const recipientIds = [...new Set(managers.map((m) => m.userId))];
  if (recipientIds.length) {
    await prisma.notification.createMany({
      data: recipientIds.map((userId) => ({
        userId,
        organizationId: tenant.organizationId,
        communityId: tenant.communityId,
        type: "ANNOUNCEMENT" as const,
        severity: "WARNING",
        title: "New care referral (SLMS Home)",
        message: `${lead.name} was referred from SLMS Home — review in CRM & Leads.`,
        relatedEntityId: lead.id,
        relatedEntityType: "CrmLead",
      })),
    });
  }

  return { leadId: lead.id, deduped: false, notified: recipientIds.length };
}
