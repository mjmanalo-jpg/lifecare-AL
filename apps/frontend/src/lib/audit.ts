import { prisma } from "./prisma";
import { Prisma } from "@prisma/client";

interface AuditLogEntry {
  actorId?: string;
  actorName?: string;
  actorRole: string;
  action: "CREATE" | "UPDATE" | "DELETE" | "LOGIN" | "LOGOUT" | "VIEW" | "EXPORT" | "DENY";
  entityType: string;
  entityId: string;
  organizationId?: string;
  communityId?: string;
  reason?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ipAddress?: string;
  userAgent?: string;
}

export function logAudit(entry: AuditLogEntry): void {
  void (async () => {
    let actorName = entry.actorName || "System";
    if (!entry.actorName && entry.actorId) {
      const user = await prisma.user.findUnique({ where: { id: entry.actorId }, select: { name: true } }).catch(() => null);
      actorName = user?.name || "Authenticated user";
    }
    const actor = entry.actorId ? await prisma.user.findUnique({ where: { id: entry.actorId }, select: { platformRole: true } }).catch(() => null) : null;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${entry.actorId || ""}, true)`;
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${entry.organizationId || ""}, true)`;
      await tx.$executeRaw`SELECT set_config('app.community_id', ${entry.communityId || ""}, true)`;
      await tx.$executeRaw`SELECT set_config('app.is_platform', ${actor?.platformRole ? "true" : "false"}, true)`;
      await tx.auditLog.create({
        data: {
          actorId: entry.actorId || null,
          actorName,
          actorRole: entry.actorRole,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          organizationId: entry.organizationId || null,
          communityId: entry.communityId || null,
          reason: entry.reason || null,
          before: entry.before ? entry.before as Prisma.InputJsonValue : Prisma.JsonNull,
          after: entry.after ? entry.after as Prisma.InputJsonValue : Prisma.JsonNull,
          ipAddress: entry.ipAddress || null,
          userAgent: entry.userAgent || null,
        },
      });
    });
  })().catch((error) => console.error("[audit] write failed", error instanceof Error ? error.message : "unknown"));
}

const SAFE_FIELDS = new Set([
  "id", "status", "role", "type", "priority", "severity", "isActive", "isApproved",
  "communityId", "organizationId", "residentId", "staffId", "assignedToId", "createdAt", "updatedAt",
  "dueDate", "completedAt", "resolvedAt", "isRead",
]);

export function snapshot(record: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record || {})) {
    if (SAFE_FIELDS.has(key) && (value === null || ["string", "number", "boolean"].includes(typeof value) || value instanceof Date)) safe[key] = value;
  }
  return safe;
}