import { prisma } from "./prisma";
import { Prisma } from "@prisma/client";

interface AuditLogEntry {
  actorId?: string;
  actorName?: string;
  actorRole: string;
  action: "CREATE" | "UPDATE" | "DELETE" | "LOGIN" | "LOGOUT" | "VIEW" | "EXPORT";
  entityType: string;
  entityId: string;
  reason?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Write an audit log entry. Fire-and-forget — never blocks the caller.
 * If actorName is omitted, it is resolved from the User table via actorId.
 */
export function logAudit(entry: AuditLogEntry): void {
  const resolveAndWrite = async () => {
    let actorName = entry.actorName || "";
    if (!actorName && entry.actorId) {
      try {
        const user = await prisma.user.findUnique({
          where: { id: entry.actorId },
          select: { name: true },
        });
        actorName = user?.name || entry.actorId;
      } catch {
        actorName = entry.actorId;
      }
    }

    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId || null,
        actorName: actorName || "System",
        actorRole: entry.actorRole,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        reason: entry.reason || null,
        before: entry.before ? (entry.before as Prisma.InputJsonValue) : Prisma.JsonNull,
        after: entry.after ? (entry.after as Prisma.InputJsonValue) : Prisma.JsonNull,
        ipAddress: entry.ipAddress || null,
        userAgent: entry.userAgent || null,
      },
    });
  };

  resolveAndWrite().catch((err) => console.error("[audit] write failed:", err));
}

/**
 * Snapshot a record's current state (pick only safe, readable fields).
 * Returns a flat object suitable for the `before`/`after` JSON columns.
 */
export function snapshot(record: Record<string, unknown>): Record<string, unknown> {
  if (!record) return {};
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (k === "password" || k === "token" || k === "secret") continue;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) continue;
    safe[k] = v;
  }
  return safe;
}
