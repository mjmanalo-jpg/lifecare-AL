// Minimal in-memory fixed-window rate limiter for abuse-sensitive endpoints
// (auth brute-force / credential stuffing).
//
// ponytail: per-INSTANCE only. On Vercel Fluid Compute instances are reused, so
// this meaningfully blocks naive brute-force, but it is NOT globally consistent
// across instances or cold starts. Production-grade distributed limiting →
// Vercel Firewall/BotID, or an Upstash/@vercel/kv shared store keyed the same way.

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number; // seconds until the window resets
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();

  // Opportunistic cleanup so a long-lived instance can't grow the map unbounded.
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k);
  }

  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfter: 0 };
  }
  b.count += 1;
  if (b.count > limit) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  }
  return { allowed: true, remaining: limit - b.count, retryAfter: 0 };
}

/** Best-effort client IP from the proxy headers Vercel sets. */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}
