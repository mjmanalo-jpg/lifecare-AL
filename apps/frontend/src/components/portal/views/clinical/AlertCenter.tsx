"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BellRing, Heart, Pill, AlertTriangle, ClipboardList, Siren, Clock,
  Check, MoonStar, X, ShieldAlert,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { updateRecord, deleteRecord } from "@/lib/api";
import {
  ALERT_NOTIFICATION_TYPES, canAlertAction, hasFullAlertControl, slaState, slaMinutes,
} from "@/lib/alertAccess";

type Alert = {
  id: string;
  type: string;
  title: string;
  message: string;
  severity?: string | null;
  isRead: boolean;
  readAt?: string | null;
  snoozedUntil?: string | null;
  createdAt: string;
};

const SEVERITY = {
  CRITICAL: { label: "Critical", chip: "bg-red-100 text-red-700 border-red-200", dot: "bg-red-500", bar: "#DC2626", note: "Immediate action" },
  WARNING: { label: "Warning", chip: "bg-amber-100 text-amber-700 border-amber-200", dot: "bg-amber-500", bar: "#D97706", note: "Timely response" },
  INFO: { label: "Info", chip: "bg-blue-100 text-blue-700 border-blue-200", dot: "bg-blue-500", bar: "#2563EB", note: "For awareness" },
} as const;
type Sev = keyof typeof SEVERITY;
const sevKey = (s: string | null | undefined): Sev => {
  const up = String(s ?? "INFO").toUpperCase();
  return up === "CRITICAL" || up === "WARNING" ? up : "INFO";
};

const TYPE_ICON: Record<string, typeof Heart> = {
  VITAL_ALERT: Heart,
  MEDICATION_REMINDER: Pill,
  INCIDENT_REPORT: AlertTriangle,
  CALL_BELL: BellRing,
  SYSTEM_ALERT: ClipboardList,
  SBAR_ESCALATION: Siren,
};

const fmtLeft = (ms: number) => {
  const abs = Math.abs(ms);
  const m = Math.floor(abs / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    if (h >= 24) return h % 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${Math.floor(h / 24)}d`;
    return `${h}h ${m % 60}m`;
  }
  return `${m}m ${String(s).padStart(2, "0")}s`;
};

export default function AlertCenter() {
  const [session, setSession] = useState<{ userId: string | null; role: string | null }>({ userId: null, role: null });
  useEffect(() => {
    fetch("/api/auth/session").then((r) => r.json()).then((d) => {
      if (d?.authenticated) setSession({ userId: d.session?.userId ?? null, role: d.session?.role ?? null });
    }).catch(() => {});
  }, []);

  const { data: rows, refetch } = useLiveQuery<Alert>("notifications", {
    query: session.userId ? `f_userId=${session.userId}` : undefined,
    tables: ["Notification"],
  });

  // Live clock for the SLA countdowns.
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const canSnooze = canAlertAction(session.role, "snooze");
  const canResolve = canAlertAction(session.role, "resolve");
  const fullControl = hasFullAlertControl(session.role);

  const alerts = useMemo(() => {
    const isSnoozed = (n: Alert) => Boolean(n.snoozedUntil) && new Date(String(n.snoozedUntil)).getTime() >= (nowMs || Date.now());
    return rows
      .filter((n) => ALERT_NOTIFICATION_TYPES.has(String(n.type)) && !isSnoozed(n))
      .sort((a, b) => {
        // Unacknowledged first, then newest alert first (most recently reported).
        if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [rows, nowMs]);

  const lanes = useMemo(() => {
    const g: Record<Sev, Alert[]> = { CRITICAL: [], WARNING: [], INFO: [] };
    for (const a of alerts) g[sevKey(a.severity)].push(a);
    return g;
  }, [alerts]);

  const unacked = alerts.filter((a) => !a.isRead);
  const breached = unacked.filter((a) => slaState(a.createdAt, a.severity, nowMs || Date.now()).breached);

  const acknowledge = async (a: Alert) => {
    try {
      await updateRecord("notifications", a.id, { isRead: true, readAt: new Date().toISOString() });
      await refetch();
    } catch (e) { Swal.fire("Couldn't acknowledge", e instanceof Error ? e.message : "Try again.", "error"); }
  };
  const snooze = async (a: Alert) => {
    try {
      await updateRecord("notifications", a.id, { snoozedUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
      await refetch();
      Swal.fire({ toast: true, position: "top-end", icon: "info", title: "Snoozed for 1 hour", showConfirmButton: false, timer: 2000 });
    } catch (e) { Swal.fire("Couldn't snooze", e instanceof Error ? e.message : "Your role may not allow this.", "error"); }
  };
  const resolve = async (a: Alert) => {
    const res = await Swal.fire({ title: "Resolve this alert?", text: "It will be removed from the queue (recorded in the audit log).", icon: "question", showCancelButton: true, confirmButtonColor: "#2E4A48", confirmButtonText: "Resolve" });
    if (!res.isConfirmed) return;
    try {
      await deleteRecord("notifications", a.id);
      await refetch();
      Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Alert resolved", showConfirmButton: false, timer: 1600 });
    } catch (e) { Swal.fire("Couldn't resolve", e instanceof Error ? e.message : "Your role may not allow this.", "error"); }
  };

  const AlertCard = ({ a }: { a: Alert }) => {
    const sev = sevKey(a.severity);
    const meta = SEVERITY[sev];
    const Icon = TYPE_ICON[String(a.type)] ?? BellRing;
    const sla = slaState(a.createdAt, a.severity, nowMs || Date.now());
    const Tone = a.isRead
      ? "border-gray-200 bg-white opacity-80"
      : sla.breached ? "border-red-300 bg-red-50/40" : "border-gray-200 bg-white";
    return (
      <div className={`rounded-xl border p-3.5 ${Tone}`} style={{ borderLeft: `4px solid ${meta.bar}` }}>
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0`} style={{ background: meta.bar }}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${meta.chip}`}>{meta.label}</span>
              {a.isRead && <span className="text-[11px] font-semibold text-emerald-600 inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Acknowledged</span>}
            </div>
            <p className="text-sm font-bold text-gray-900 mt-1">{a.title}</p>
            <p className="text-sm text-gray-600 leading-snug">{a.message}</p>

            {/* SLA countdown */}
            <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold">
              <Clock className="w-3.5 h-3.5" />
              {a.isRead ? (
                <span className="text-gray-400">Acknowledged{a.readAt ? ` · ${new Date(a.readAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
              ) : sla.breached ? (
                <span className="text-red-600 inline-flex items-center gap-1"><ShieldAlert className="w-3.5 h-3.5" /> SLA breached {fmtLeft(sla.remainingMs)} ago{fullControl ? " — escalated" : ""}</span>
              ) : (
                <span className={sla.remainingMs < 5 * 60000 ? "text-amber-600" : "text-gray-500"}>Respond within {fmtLeft(sla.remainingMs)} ({slaMinutes(a.severity)}m SLA)</span>
              )}
            </div>
          </div>
        </div>

        {/* RBAC-gated actions */}
        <div className="flex flex-wrap items-center justify-end gap-2 mt-3 pt-2 border-t border-gray-100">
          {!a.isRead && (
            <button onClick={() => void acknowledge(a)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition">
              <Check className="w-4 h-4" /> Acknowledge
            </button>
          )}
          {canSnooze && (
            <button onClick={() => void snooze(a)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition">
              <MoonStar className="w-4 h-4" /> Snooze
            </button>
          )}
          {canResolve && (
            <button onClick={() => void resolve(a)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition">
              <X className="w-4 h-4" /> Resolve
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-1 sm:px-2 py-2 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 flex items-center gap-2">
            <BellRing className="w-7 h-7 text-red-500" /> Alert Center
          </h1>
          <p className="text-gray-600 text-sm mt-0.5">Automatic clinical &amp; operational alerts — acknowledge, snooze, or resolve. Nothing critical goes unnoticed.</p>
        </div>
        {!fullControl && (
          <span className="text-xs font-semibold text-gray-500 bg-gray-100 rounded-lg px-3 py-2 self-start">Your role can acknowledge alerts only</span>
        )}
      </div>

      {/* Severity summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        {(["CRITICAL", "WARNING", "INFO"] as Sev[]).map((s) => {
          const meta = SEVERITY[s];
          const open = lanes[s].filter((a) => !a.isRead).length;
          return (
            <div key={s} className="rounded-xl border border-gray-200 bg-white p-3 sm:p-4">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${meta.dot}`} />
                <span className="text-sm font-bold text-gray-700">{meta.label}</span>
              </div>
              <div className="text-3xl font-extrabold text-gray-900 mt-1">{open}</div>
              <div className="text-[11px] text-gray-400 font-medium">{meta.note}</div>
            </div>
          );
        })}
      </div>

      {breached.length > 0 && (
        <div className="rounded-xl border-2 border-red-300 bg-red-50 px-4 py-3 flex items-center gap-2 text-red-800 font-semibold text-sm">
          <ShieldAlert className="w-5 h-5" /> {breached.length} alert{breached.length > 1 ? "s have" : " has"} breached its SLA and need immediate attention.
        </div>
      )}

      {/* Lanes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {(["CRITICAL", "WARNING", "INFO"] as Sev[]).map((s) => {
          const meta = SEVERITY[s];
          const list = lanes[s];
          return (
            <div key={s} className="rounded-2xl border border-gray-200 bg-gray-50/60">
              <div className="flex items-center justify-between px-4 py-2.5 rounded-t-2xl text-white" style={{ background: meta.bar }}>
                <span className="text-sm font-bold uppercase tracking-wide">{meta.label}</span>
                <span className="text-xs font-bold bg-white/25 rounded-full px-2 py-0.5">{list.length}</span>
              </div>
              <div className="p-3 space-y-3 max-h-[70vh] overflow-y-auto">
                {list.length === 0
                  ? <p className="text-center text-sm text-gray-400 py-8">No {meta.label.toLowerCase()} alerts.</p>
                  : list.map((a) => <AlertCard key={a.id} a={a} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
