import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Assignment safety gate (§1 guardrail / §4.2).
 *
 * Before a caregiver is assigned a task, verify they hold every competency the
 * task's SOP requires — VERIFIED and not expired — and every piece of equipment
 * the SOP requires — present, VERIFIED and not past expiry/calibration. Returns
 * human-readable issue strings; an empty array means the assignment may proceed.
 *
 * Requirement chains:
 *   Task.sopId → CommunitySop.competencyRequired (Json) → Competency
 *     (matched by id or name within the community) → StaffCompetency (verified + expiryDate)
 *   Task.sopId → CommunitySop.equipmentRequired (Json) → Equipment
 *     (matched by id or name, isActive) → StaffEquipment (verified + expiryDate)
 */

export interface AssignmentIssue {
  kind?: "competency" | "equipment";
  competency: string;
  reason: "MISSING" | "UNVERIFIED" | "EXPIRED";
}

type Db = Pick<Prisma.TransactionClient, "communitySop" | "competency" | "staffCompetency" | "equipment" | "staffEquipment"> | typeof prisma;

/** competencyRequired/equipmentRequired entries may be names, ids, or objects — accept all shapes. */
function requiredNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim()) out.push(entry.trim());
    else if (entry && typeof entry === "object") {
      const o = entry as Record<string, unknown>;
      const name = [o.name, o.competency, o.equipment, o.title].find((v) => typeof v === "string" && v.trim());
      const id = typeof o.id === "string" ? o.id : undefined;
      if (name) out.push(String(name).trim());
      else if (id) out.push(id.trim());
    }
  }
  return [...new Set(out)];
}

type CatalogItem = { id: string; name: string };

/** A required entry matches when it resolves to a catalog item by id or case-insensitive name. */
function matchCatalog(required: string[], catalog: CatalogItem[]): Map<string, CatalogItem> {
  const byNameOrId = new Map<string, CatalogItem>();
  for (const item of catalog) {
    byNameOrId.set(item.name.toLowerCase(), item);
    byNameOrId.set(item.id, item);
  }
  const matched = new Map<string, CatalogItem>();
  for (const req of required) {
    const hit = byNameOrId.get(req.toLowerCase()) ?? byNameOrId.get(req);
    if (hit) matched.set(hit.id, hit);
  }
  return matched;
}

async function sopsRequirement(
  db: Db,
  sopIds: string[],
  field: "competencyRequired" | "equipmentRequired",
): Promise<string[]> {
  const sops = await db.communitySop.findMany({
    where: { id: { in: sopIds }, isActive: true },
    select: { [field]: true },
  });
  return [...new Set(sops.flatMap((sop) => requiredNames(sop[field])))];
}

interface HeldRecord {
  key: string;
  verified: boolean;
  expiryDate: Date | null;
}

/** Shared MISSING/UNVERIFIED/EXPIRED evaluation over a matched requirement set. */
function evaluateHoldings(
  matched: Map<string, CatalogItem>,
  held: HeldRecord[],
  kind: "competency" | "equipment",
): AssignmentIssue[] {
  const now = Date.now();
  const heldByKey = new Map(held.map((h) => [h.key, h]));
  const issues: AssignmentIssue[] = [];
  for (const item of matched.values()) {
    const rec = heldByKey.get(item.id);
    if (!rec) issues.push({ kind, competency: item.name, reason: "MISSING" });
    else if (!rec.verified) issues.push({ kind, competency: item.name, reason: "UNVERIFIED" });
    else if (rec.expiryDate && rec.expiryDate.getTime() < now) {
      issues.push({ kind, competency: item.name, reason: "EXPIRED" });
    }
  }
  return issues.sort((a, b) => a.competency.localeCompare(b.competency));
}

export async function assignmentCompetencyIssues(
  db: Db,
  input: { communityId?: string | null; staffId: string; sopIds: string[] },
): Promise<AssignmentIssue[]> {
  const { staffId, sopIds } = input;
  if (!staffId || !sopIds.length) return [];

  const required = await sopsRequirement(db, sopIds, "competencyRequired");
  if (!required.length) return [];

  const competencies = await db.competency.findMany({
    where: { OR: [{ id: { in: required } }, { name: { in: required } }] },
    select: { id: true, name: true },
  });
  const matched = matchCatalog(required, competencies);
  if (!matched.size) return [];

  const held = await db.staffCompetency.findMany({
    where: { staffId, competencyId: { in: [...matched.keys()] } },
    select: { competencyId: true, verified: true, expiryDate: true },
  });
  return evaluateHoldings(
    matched,
    held.map((h) => ({ key: h.competencyId, verified: h.verified, expiryDate: h.expiryDate })),
    "competency",
  );
}

export async function assignmentEquipmentIssues(
  db: Db,
  input: { communityId?: string | null; staffId: string; sopIds: string[] },
): Promise<AssignmentIssue[]> {
  const { staffId, sopIds } = input;
  if (!staffId || !sopIds.length) return [];

  const required = await sopsRequirement(db, sopIds, "equipmentRequired");
  if (!required.length) return [];

  // Only active catalog items count as requirements; unknown entries fail open
  // (a requirement that does not resolve to a real item cannot be enforced).
  const items = await db.equipment.findMany({
    where: { isActive: true, OR: [{ id: { in: required } }, { name: { in: required } }] },
    select: { id: true, name: true },
  });
  const matched = matchCatalog(required, items);
  if (!matched.size) return [];

  const held = await db.staffEquipment.findMany({
    where: { staffId, equipmentId: { in: [...matched.keys()] } },
    select: { equipmentId: true, verified: true, expiryDate: true },
  });
  return evaluateHoldings(
    matched,
    held.map((h) => ({ key: h.equipmentId, verified: h.verified, expiryDate: h.expiryDate })),
    "equipment",
  );
}

const REASON_TEXT: Record<AssignmentIssue["reason"], string> = {
  MISSING: "not on file",
  UNVERIFIED: "recorded but not verified",
  EXPIRED: "expired",
};

const KIND_LABEL: Record<"competency" | "equipment", string> = {
  competency: "competency",
  equipment: "equipment",
};

export function assignmentGateMessage(issues: AssignmentIssue[]): string {
  return issues
    .map((i) => `${KIND_LABEL[i.kind ?? "competency"]} "${i.competency}" ${REASON_TEXT[i.reason]}`)
    .join(", ");
}
