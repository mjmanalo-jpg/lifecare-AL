"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, Eye, EyeOff, Moon, Activity } from "lucide-react";

/* ── Data contracts (mirror of /api/monitoring) ─────────────────────── */

interface SleepResident {
  id: string;
  name: string;
  room: string;
  sleeping: boolean;
  /** 0..1 sleep confidence score. */
  sleepScore: number;
  position: string;
  lastUpdate: string;
  alerts: number;
}

interface MonitoringResponse {
  residents: SleepResident[];
  summary?: {
    total: number;
    sleeping: number;
    awake: number;
    alerts: number;
  };
}

const POLL_INTERVAL_MS = 5000;

/* ── Component ───────────────────────────────────────────────────────── */

export default function SleepMonitoring() {
  const [residents, setResidents] = useState<SleepResident[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchResidents = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/monitoring");
      if (!res.ok) throw new Error(`Monitoring API error: ${res.status}`);
      const data: MonitoringResponse = await res.json();
      setResidents(data.residents ?? []);
    } catch (err) {
      console.error("Failed to load monitoring data:", err);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/monitoring");
        if (!res.ok) throw new Error(`Monitoring API error: ${res.status}`);
        const data: MonitoringResponse = await res.json();
        if (active) setResidents(data.residents ?? []);
      } catch (err) {
        console.error("Failed to load monitoring data:", err);
      } finally {
        if (active) setLoading(false);
      }
    })();

    const interval = setInterval(() => void fetchResidents(), POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [fetchResidents]);

  if (loading) {
    return <div className="p-4 text-center">Loading monitoring data...</div>;
  }

  const sleepingCount = residents.filter((r) => r.sleeping).length;
  const totalAlerts = residents.reduce((sum, r) => sum + r.alerts, 0);

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Moon className="w-6 h-6 text-purple-400" />
        Sleep Monitoring
      </h2>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel p-4 rounded-xl"
        >
          <p className="text-sm text-muted-foreground">Total Residents</p>
          <p className="text-3xl font-bold text-foreground">{residents.length}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-panel p-4 rounded-xl"
        >
          <p className="text-sm text-muted-foreground">Currently Sleeping</p>
          <p className="text-3xl font-bold text-purple-400">{sleepingCount}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-panel p-4 rounded-xl"
        >
          <p className="text-sm text-muted-foreground">Alerts</p>
          <p className="text-3xl font-bold text-red-400">{totalAlerts}</p>
        </motion.div>
      </div>

      {/* Resident Sleep Status */}
      <div className="space-y-3">
        {residents.map((resident, idx) => (
          <motion.div
            key={resident.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.1 }}
            className={`p-4 rounded-lg border ${
              resident.sleeping
                ? "bg-purple-500/10 border-purple-500/30"
                : "bg-green-500/10 border-green-500/30"
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">{resident.name}</h3>
                <p className="text-sm text-muted-foreground">
                  Room {resident.room} • {resident.position}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                {/* Sleep Status */}
                <div className="flex items-center gap-2">
                  {resident.sleeping ? (
                    <>
                      <EyeOff className="w-4 h-4 text-purple-400" />
                      <span className="text-sm font-bold text-purple-400">Sleeping</span>
                    </>
                  ) : (
                    <>
                      <Eye className="w-4 h-4 text-green-400" />
                      <span className="text-sm font-bold text-green-400">Awake</span>
                    </>
                  )}
                </div>

                {/* Sleep Score Bar */}
                <div className="w-32">
                  <div className="w-full h-2 bg-foreground/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-green-500 to-purple-500 transition-all"
                      style={{ width: `${resident.sleepScore * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {(resident.sleepScore * 100).toFixed(0)}%
                  </p>
                </div>

                {/* Alert Badge */}
                {resident.alerts > 0 && (
                  <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-red-500/20 text-red-400"
                  >
                    <AlertCircle className="w-3 h-3" />
                    <span className="text-xs font-bold">{resident.alerts}</span>
                  </motion.div>
                )}

                {/* Last Update */}
                <p className="text-xs text-muted-foreground w-20">
                  {new Date(resident.lastUpdate).toLocaleTimeString()}
                </p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Sleep Detection Info */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="mt-6 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20"
      >
        <p className="text-sm text-blue-300">
          <Activity className="w-4 h-4 inline mr-2" />
          Sleep detection analyzes: eye position • head tilt • body position • motion level
        </p>
      </motion.div>
    </div>
  );
}
