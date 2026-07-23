import { PrismaClient } from "@prisma/client";

// Clean up environment variables to resolve Vercel double quotes or spaces issues
if (process.env.APP_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.APP_DATABASE_URL;
}

if (process.env.DATABASE_URL) {
  let url = process.env.DATABASE_URL.trim();
  if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
    url = url.slice(1, -1).trim();
  }
  process.env.DATABASE_URL = url;
}

if (process.env.DIRECT_URL) {
  let url = process.env.DIRECT_URL.trim();
  if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
    url = url.slice(1, -1).trim();
  }
  process.env.DIRECT_URL = url;
}

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
