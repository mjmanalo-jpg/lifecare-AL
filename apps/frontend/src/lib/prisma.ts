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

/**
 * Transient DB errors seen on Vercel serverless + Supabase's pgbouncer
 * (transaction-mode) pooler. Under a cold start or a brief concurrency spike
 * the pooler can refuse/drop a connection; these clear on a quick retry.
 *   P2024 — "Timed out fetching a new connection from the connection pool"
 *   P1001 — can't reach the database server
 *   P1002 — the database server was reached but timed out
 *   P1008 — operations timed out
 *   P1017 — server has closed the connection
 */
const TRANSIENT_DB_CODES = new Set(["P2024", "P1001", "P1002", "P1008", "P1017"]);

export function isTransientDbError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const code = (e as { code?: string }).code;
  if (code && TRANSIENT_DB_CODES.has(code)) return true;
  if ((e as { name?: string }).name === "PrismaClientInitializationError") return true;
  const msg = (e as { message?: string }).message || "";
  return /connection pool|Timed out fetching|Can't reach database|ECONNRESET|ECHECKOUTTIMEOUT|Closed the connection/i.test(msg);
}

/**
 * Run a DB operation, retrying a few times with exponential backoff when the
 * failure is a transient pooler/connection error. Non-transient errors (bad
 * query, constraint violations…) are re-thrown immediately. Keeps a cold or
 * momentarily-saturated pooler from surfacing as a hard page crash.
 */
export async function withDbRetry<T>(fn: () => Promise<T>, retries = 3, baseDelayMs = 150): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isTransientDbError(e) || attempt === retries) throw e;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }
  throw lastErr;
}
