"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let initFailed = false;

function validUrl(value: string | undefined): value is string {
  if (!value || value.includes("<") || value.includes("[")) return false;
  try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; }
}
function validKey(value: string | undefined): value is string { return Boolean(value) && !value!.includes("<") && !value!.includes("["); }

export async function getTenantRealtime(): Promise<{ client: SupabaseClient; communityId: string } | null> {
  if (typeof window === "undefined" || initFailed || process.env.NEXT_PUBLIC_ENABLE_TENANT_REALTIME !== "true") return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!validUrl(url) || !validKey(key)) return null;
  try {
    const response = await fetch("/api/auth/realtime-token", { cache: "no-store" });
    if (!response.ok) return null;
    const { accessToken, communityId } = await response.json();
    if (!accessToken || !communityId) return null;
    if (!client) client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    client.realtime.setAuth(accessToken);
    return { client, communityId };
  } catch {
    initFailed = true;
    return null;
  }
}

export function realtimeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_TENANT_REALTIME === "true" && validUrl(process.env.NEXT_PUBLIC_SUPABASE_URL) && validKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}