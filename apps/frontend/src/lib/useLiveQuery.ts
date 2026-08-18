"use client";

import { useCallback, useEffect, useState } from "react";
import { getTenantRealtime } from "./supabaseClient";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { cacheQuery, readCachedQuery, snapshotAppSettings } from "./offline/cache";
import { pendingForModel } from "./offline/outbox";
import { applyOutboxToRows, applyOutboxToAppSettings } from "./offline/merge";
import { subscribeSync } from "./offline/sync";
import type { Rec } from "./offline/types";

/** Fold pending offline writes for `model` into a rowset (optimistic display). */
async function mergeOutbox(model: string, rows: Rec[]): Promise<Rec[]> {
  const ops = await pendingForModel(model);
  if (!ops.length) return rows;
  return model === "app-settings" ? applyOutboxToAppSettings(rows, ops) : applyOutboxToRows(rows, ops);
}

// Monotonic counter so every hook instance gets a UNIQUE realtime channel
// topic. Supabase throws if two channels share a topic and `.on()` is called
// after `.subscribe()`, which happens whenever two components watch the same
// model at once (e.g. a portal shell + a child module both reading "tasks").
let channelSeq = 0;

// In-flight request coalescer. A dashboard mounts many useLiveQuery hooks at
// once, and several often read the SAME endpoint (e.g. the shell + a child both
// read "app-settings"). Each fetch hits a remote DB (~150ms/round-trip), so
// firing duplicates is pure waste. When an identical GET is already in flight,
// new callers await the same promise instead of opening another request.
const inFlight = new Map<string, Promise<unknown>>();

// Stale-while-revalidate cache of the last SUCCESSFUL response per url. Without it,
// every mount (each tab switch, and returning to a tab already viewed) starts from
// `data: []` + `loading: true` and re-fetches from the remote DB — a visible delay.
// With it, a re-mounted hook paints the cached rows instantly (no skeleton) and
// revalidates in the background. refetch()/polling/realtime keep the cache current.
const responseCache = new Map<string, unknown[]>();

function coalescedFetch(url: string): Promise<unknown> {
  const existing = inFlight.get(url);
  if (existing) return existing;
  const promise = fetch(url, { cache: "no-store" })
    .then(async (res) => {
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || res.statusText);
      return json;
    })
    .finally(() => {
      inFlight.delete(url);
    });
  inFlight.set(url, promise);
  return promise;
}

interface LiveQueryOptions {
  /** Query string appended to /api/db/:model, e.g. "include=resident&take=50". */
  query?: string;
  /** Postgres tables to watch for realtime changes (PascalCase). */
  tables?: string[];
  /** Polling fallback interval in ms (default 20s). */
  pollMs?: number;
  /** Skip fetching entirely when false. */
  enabled?: boolean;
}

interface LiveQueryResult<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Live collection reader.
 *  1. Fetches once on mount from /api/db/:model.
 *  2. Subscribes to Supabase postgres_changes on `tables` — any insert/update/
 *     delete triggers an immediate refetch (instant realtime).
 *  3. Always runs a slow polling interval as a fallback for when realtime is
 *     not configured/available, so data is never stale.
 */
export function useLiveQuery<T = Record<string, unknown>>(
  model: string,
  options: LiveQueryOptions = {}
): LiveQueryResult<T> {
  const { query, tables, pollMs = 20000, enabled = true } = options;
  const url = `/api/db/${model}${query ? `?${query}` : ""}`;
  const tablesKey = (tables ?? []).join(",");

  // Seed from the SWR cache so a re-mounted hook paints instantly (no skeleton).
  const [data, setData] = useState<T[]>(() => (responseCache.get(url) as T[]) ?? []);
  const [loading, setLoading] = useState<boolean>(() => enabled && !responseCache.has(url));
  const [error, setError] = useState<string | null>(null);

  // fetchData closes over the current `url`; it re-creates when the url changes.
  const fetchData = useCallback(async () => {
    try {
      const json = (await coalescedFetch(url)) as { data?: T[] };
      const server = (json.data ?? []) as Rec[];
      // Persist a durable snapshot so reads survive a server outage.
      void cacheQuery(url, server);
      if (model === "app-settings") void snapshotAppSettings(server);
      const merged = (await mergeOutbox(model, server)) as T[];
      responseCache.set(url, merged);
      setData(merged);
      setError(null);
    } catch (err) {
      // Server unreachable → serve the last-known snapshot + queued offline writes.
      const cached = await readCachedQuery(url);
      if (cached) {
        const merged = (await mergeOutbox(model, cached)) as T[];
        responseCache.set(url, merged);
        setData(merged);
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : "Request failed");
      }
    } finally {
      setLoading(false);
    }
  }, [url, model]);

  // When the url changes (e.g. a new filter), reset to that url's cached rows —
  // only show a spinner when nothing is cached yet. This is React's "adjust state
  // during render on a prop change" pattern (guarded by prevUrl), which avoids a
  // spinner flash and does not trip the no-setState-in-effect rule.
  const [prevUrl, setPrevUrl] = useState(url);
  if (url !== prevUrl) {
    setPrevUrl(url);
    setData((responseCache.get(url) as T[]) ?? []);
    setLoading(enabled && !responseCache.has(url));
  }

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const run = () => {
      if (!cancelled) fetchData();
    };

    run(); // initial load
    const interval = setInterval(run, pollMs); // polling fallback

    // Re-run when the offline outbox changes (a queued write appears, or a sync
    // drains) so optimistic rows show immediately and reconcile after sync.
    let lastPending = -1;
    const unsubSync = subscribeSync((st) => {
      if (st.pending !== lastPending || !st.syncing) { lastPending = st.pending; run(); }
    });

    // Realtime is opt-in and authenticated. The channel is filtered to the
    // active workspace; polling remains the safe fallback.
    let realtimeClient: SupabaseClient | null = null;
    let channel: RealtimeChannel | null = null;
    void getTenantRealtime().then((realtime) => {
      if (!realtime || cancelled) return;
      realtimeClient = realtime.client;
      const watch = tablesKey ? tablesKey.split(",") : [];
      if (!watch.length) return;
      channel = realtime.client.channel(`live:${model}:${(channelSeq += 1)}`);
      watch.forEach((table) => channel!.on("postgres_changes", { event: "*", schema: "public", table, filter: `communityId=eq.${realtime.communityId}` }, run));
      channel.subscribe();
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubSync();
      if (realtimeClient && channel) realtimeClient.removeChannel(channel);
    };
  }, [fetchData, enabled, pollMs, model, tablesKey]);

  return { data, loading, error, refetch: fetchData };
}

interface DashboardStats {
  residents: number;
  activeIncidents: number;
  activeStaff: number;
  openTasks: number;
  pendingCallBells: number;
  overdueInvoices: number;
}

// SWR cache for the dashboard counters — same rationale as responseCache above.
let statsCache: DashboardStats | null = null;

/** Live dashboard counters from /api/stats with the same polling cadence. */
export function useStats(pollMs = 20000) {
  const [stats, setStats] = useState<DashboardStats | null>(() => statsCache);
  const [loading, setLoading] = useState(() => statsCache === null);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || res.statusText);
      statsCache = json as DashboardStats;
      setStats(json as DashboardStats);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (!cancelled) fetchStats();
    };
    run();
    const interval = setInterval(run, pollMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [fetchStats, pollMs]);

  return { stats, loading, error, refetch: fetchStats };
}
