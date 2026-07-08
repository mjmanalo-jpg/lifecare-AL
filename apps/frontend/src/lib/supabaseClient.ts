"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Lazily-created browser Supabase client used ONLY for realtime subscriptions
 * (postgres_changes). All reads/writes go through the /api/db routes + Prisma,
 * so the anon key never needs table privileges beyond realtime.
 *
 * Returns null when the public env vars are absent — callers then rely purely
 * on the polling fallback in useLiveQuery.
 */
let client: SupabaseClient | null = null;
let initFailed = false;

/** A usable value: present, not an unfilled `<PLACEHOLDER>`, and a valid URL. */
function validUrl(value: string | undefined): value is string {
  if (!value || value.includes("<")) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function validKey(value: string | undefined): value is string {
  return Boolean(value) && !value!.includes("<");
}

export function getSupabase(): SupabaseClient | null {
  if (typeof window === "undefined" || initFailed) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!validUrl(url) || !validKey(key)) return null; // → polling fallback
  if (!client) {
    try {
      client = createClient(url, key, {
        auth: { persistSession: false },
        realtime: { params: { eventsPerSecond: 5 } },
      });
    } catch (err) {
      // Bad config should never crash the app — just disable realtime.
      initFailed = true;
      console.warn("Supabase realtime disabled (invalid config):", err);
      return null;
    }
  }
  return client;
}

export function realtimeEnabled(): boolean {
  return validUrl(process.env.NEXT_PUBLIC_SUPABASE_URL) && validKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
