import { PrismaClient } from "@prisma/client";

/**
 * Prisma singleton. In dev, Next.js hot-reload would otherwise spawn a new
 * client (and a new connection pool) on every reload, exhausting Supabase's
 * connection limit. Reuse one instance across reloads.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
