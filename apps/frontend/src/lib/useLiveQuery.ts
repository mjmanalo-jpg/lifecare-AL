"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabaseClient";

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

  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState<boolean>(() => enabled);
  const [error, setError] = useState<string | null>(null);

  // fetchData closes over the current `url`; it re-creates when the url changes.
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || res.statusText);
      setData((json.data ?? []) as T[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const run = () => {
      if (!cancelled) fetchData();
    };

    run(); // initial load
    const interval = setInterval(run, pollMs); // polling fallback

    // Realtime: refetch on any change to the watched tables.
    const supabase = getSupabase();
    const watch = tablesKey ? tablesKey.split(",") : [];
    const channel =
      supabase && watch.length ? supabase.channel(`live:${model}`) : null;
    if (channel) {
      watch.forEach((table) =>
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          run
        )
      );
      channel.subscribe();
    }

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (supabase && channel) supabase.removeChannel(channel);
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

/** Live dashboard counters from /api/stats with the same polling cadence. */
export function useStats(pollMs = 20000) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || res.statusText);
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
