"use client";

import { useMemo } from "react";
import {
  Wallet, Activity, HeartPulse, MessageSquare, Calendar,
  AlertTriangle, ClipboardList, ShieldCheck, Thermometer, Wind, CheckCircle2, Circle, type LucideIcon,
} from "lucide-react";
import type { VitalReading } from "@/components/portal/widgets/VitalsPanel";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptIncident, humanize } from "@/lib/adapters";
import AppointmentCalendar from "@/components/portal/AppointmentCalendar";
import {
  useRelative, Panel, LiveBadge, type Row,
} from "./shared";

/** Family Dashboard — the live overview that ties every module together. */
export default function FamilyDashboard() {
  const { relative, displayName } = useRelative();

  const { data: vitalsRows } = useLiveQuery("vitals", {
    query: "include=resident&take=50",
    tables: ["VitalsLog"],
  });
  const { data: incidentRows } = useLiveQuery("incidents", {
    query: "include=resident&take=50",
    tables: ["Incident"],
  });
  const { data: messageRows } = useLiveQuery("messages", {
    query: "include=sender&take=100",
    tables: ["Message"],
  });
  const { data: invoiceRows } = useLiveQuery("invoices", {
    query: "include=resident&take=100",
    tables: ["Invoice"],
  });
  const { data: visitRows } = useLiveQuery("visits", {
    query: "take=100",
    tables: ["Visit"],
  });
  // Care Team Activity updates near-realtime as tasks are created/completed.
  const { data: taskRows } = useLiveQuery("tasks", {
    query: "take=50",
    tables: ["Task"],
    pollMs: 5000,
  });

  const incidents = useMemo(() => incidentRows.map(adaptIncident), [incidentRows]);

  // Live vitals panel readings derived from the latest of each vital type.
  const liveVitals = useMemo<VitalReading[]>(() => {
    const wanted: VitalReading["type"][] = ["HEART_RATE", "TEMPERATURE", "BLOOD_PRESSURE", "OXYGEN"];
    const unitFor: Record<string, string> = {
      HEART_RATE: "bpm", TEMPERATURE: "°C", BLOOD_PRESSURE: "mmHg", OXYGEN: "%",
    };
    const readings: VitalReading[] = [];
    for (const type of wanted) {
      const row = vitalsRows.find((v: Row) => v.type === type);
      if (!row) continue;
      const numeric = parseFloat(String(row.value));
      readings.push({
        type,
        value: isNaN(numeric) ? 0 : numeric,
        unit: (row.unit as string) ?? unitFor[type] ?? "",
        normal: true,
        lastUpdated: row.recordedAt ? new Date(row.recordedAt as string) : new Date(),
      });
    }
    return readings;
  }, [vitalsRows]);

  const unreadMessages = messageRows.filter((m: Row) => !m.isRead).length;

  const balanceDue = invoiceRows.reduce((sum: number, inv: Row) => {
    if (String(inv.status ?? "") === "PAID") return sum;
    const total = parseFloat(String(inv.totalAmount ?? 0)) || 0;
    const paid = parseFloat(String(inv.amountPaid ?? 0)) || 0;
    return sum + Math.max(0, total - paid);
  }, 0);

  const tasks = relative ? taskRows.filter((t) => !t.residentId || t.residentId === relative.id) : taskRows;
  const openTasks = tasks.filter((t) => String(t.status) !== "COMPLETED" && String(t.status) !== "CANCELLED");

  const completedTasks = tasks.filter((t) => String(t.status) === "COMPLETED").length;
  const recentTasks = [...tasks]
    .sort((a, b) => String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? "")))
    .slice(0, 4);
  const upcomingVisits = visitRows.slice(0, 3);
  const topAlerts = incidents.slice(0, 4);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Hero — the answer to "is my relative okay right now?" up top:
          a plain-language status plus their live vitals, for families watching from afar. */}
      {(() => {
        const stable = !relative || relative.alertsCount === 0;
        const first = ((relative?.name || displayName || "").split(" ")[0]) || "Your relative";
        const chips = [
          { key: "HEART_RATE", label: "Heart rate", unit: "bpm", icon: HeartPulse, tint: "text-rose-600", bg: "bg-rose-50" },
          { key: "TEMPERATURE", label: "Temperature", unit: "°C", icon: Thermometer, tint: "text-amber-600", bg: "bg-amber-50" },
          { key: "BLOOD_PRESSURE", label: "Blood pressure", unit: "mmHg", icon: Activity, tint: "text-sky-600", bg: "bg-sky-50" },
          { key: "OXYGEN", label: "Oxygen", unit: "%", icon: Wind, tint: "text-teal-600", bg: "bg-teal-50" },
        ] as const;
        return (
          <section className="relative overflow-hidden rounded-3xl border border-teal-100 bg-gradient-to-br from-teal-50 via-white to-rose-50/40 p-5 sm:p-7 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_40px_-20px_rgba(13,148,136,0.28)]">
            <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Welcome — {relative?.name || displayName}</h1>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
                  <LiveBadge />
                  {relative ? `Room ${relative.room} · ${humanize(relative.careLevel)} Care${relative.age != null ? ` · Age ${relative.age}` : ""}` : "Your family member's care overview"}
                </p>
                <div className={`mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${stable ? "bg-teal-600/10 text-teal-800" : "bg-amber-500/15 text-amber-900"}`}>
                  {stable ? <ShieldCheck className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                  {stable
                    ? `${first} is resting comfortably — vitals in normal range`
                    : `${relative?.alertsCount} active alert${relative?.alertsCount === 1 ? "" : "s"} — the care team has been notified`}
                </div>
              </div>

              {/* Live vitals */}
              <div className="grid w-full shrink-0 grid-cols-2 gap-2.5 sm:gap-3 lg:w-[360px]">
                {chips.map((c) => {
                  const v = liveVitals.find((x) => x.type === c.key);
                  const Icon = c.icon;
                  return (
                    <div key={c.key} className="rounded-2xl border border-white bg-white/70 p-3 shadow-sm backdrop-blur-sm">
                      <div className="flex items-center gap-2">
                        <span className={`grid h-7 w-7 place-items-center rounded-lg ${c.bg} ${c.tint}`}><Icon className="h-4 w-4" /></span>
                        <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">{c.label}</span>
                      </div>
                      <p className="mt-1.5 text-xl font-bold text-slate-900">{v ? v.value : "—"}<span className="ml-1 text-xs font-medium text-slate-400">{v ? c.unit : ""}</span></p>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        );
      })()}

      {/* Quick metrics */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4 lg:gap-4">
        <KpiCard icon={MessageSquare} label="Unread messages" value={String(unreadMessages)} tint="text-blue-600" bg="bg-blue-50" />
        <KpiCard icon={Calendar} label="Appointments" value={String(visitRows.length)} tint="text-teal-600" bg="bg-teal-50" />
        <KpiCard icon={ClipboardList} label="Open care tasks" value={String(openTasks.length)} tint="text-emerald-600" bg="bg-emerald-50" />
        <KpiCard icon={Wallet} label="Balance due" value={`₱${balanceDue.toFixed(0)}`} tint="text-amber-600" bg="bg-amber-50" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-3">
        {/* Main column: care profile, alerts, live care-team activity */}
        <div className="space-y-4 sm:space-y-6 xl:col-span-2">
          {relative && (relative.allergies || relative.medicalHistory) && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Care profile</h3>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-rose-50/70 p-3">
                  <p className="text-xs font-semibold text-rose-700">Allergies</p>
                  <p className="mt-0.5 text-sm text-slate-900">{relative.allergies || "None recorded"}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-600">Medical history</p>
                  <p className="mt-0.5 text-sm text-slate-900">{relative.medicalHistory || "None recorded"}</p>
                </div>
              </div>
            </div>
          )}

          <Panel title="Recent Alerts" icon={AlertTriangle} count={incidents.length}>
            {topAlerts.length > 0 ? (
              <div className="space-y-2">
                {topAlerts.map((inc) => (
                  <div key={inc.id} className={`p-2.5 rounded-lg border ${inc.severity === "critical" || inc.severity === "high" ? "bg-red-50 border-red-100" : "bg-gray-50 border-gray-200"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-gray-900 text-sm truncate">{inc.type}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold flex-shrink-0 ${
                        inc.severity === "critical" ? "bg-red-100 text-red-700" : inc.severity === "high" ? "bg-orange-100 text-orange-700" : inc.severity === "medium" ? "bg-yellow-100 text-yellow-700" : "bg-blue-100 text-blue-700"
                      }`}>{inc.severity.toUpperCase()}</span>
                    </div>
                    <p className="text-xs text-gray-600 truncate">{inc.description || "Incident recorded"}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg p-3">All vitals stable — no active alerts.</p>
            )}
          </Panel>

          <Panel title="Care Team Activity" icon={ClipboardList} count={openTasks.length}>
            {tasks.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${Math.round((completedTasks / tasks.length) * 100)}%` }} />
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-slate-600">{completedTasks} / {tasks.length} done</span>
                </div>
                <div className="space-y-2">
                  {recentTasks.map((t: Row, i: number) => {
                    const status = String(t.status ?? "PENDING").toUpperCase();
                    const done = status === "COMPLETED";
                    const meta = done ? { label: "Completed", cls: "bg-emerald-100 text-emerald-700" }
                      : status === "IN_PROGRESS" ? { label: "In progress", cls: "bg-blue-100 text-blue-700" }
                      : status === "CANCELLED" ? { label: "Cancelled", cls: "bg-slate-100 text-slate-500" }
                      : { label: "Pending", cls: "bg-amber-100 text-amber-700" };
                    return (
                      <div key={(t.id as string) ?? i} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5">
                        {done ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" /> : <Circle className="h-5 w-5 shrink-0 text-slate-300" />}
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-sm font-medium ${done ? "text-slate-400 line-through" : "text-slate-900"}`}>{String(t.title ?? "Care task")}</p>
                          <p className="truncate text-xs text-slate-400">Due {t.dueDate ? new Date(String(t.dueDate)).toLocaleDateString() : "—"}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`}>{meta.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500 py-4 text-center">No care tasks scheduled.</p>
            )}
          </Panel>
        </div>

        {/* Side column: schedule */}
        <div className="space-y-4 sm:space-y-6">
          {relative && <AppointmentCalendar residentId={relative.id} residentName={relative.name} title="Calendar" />}

          <Panel title="Upcoming Appointments" icon={Calendar} count={visitRows.length}>
            {upcomingVisits.length > 0 ? (
              <div className="space-y-2">
                {upcomingVisits.map((v: Row, i: number) => (
                  <div key={(v.id as string) ?? i} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-gray-900 text-sm truncate">{(v.visitorName as string) ?? "Visit"}</span>
                      <span className="text-xs text-gray-500 flex-shrink-0">{v.checkInTime ? new Date(v.checkInTime as string).toLocaleDateString() : "—"}</span>
                    </div>
                    <p className="text-xs text-gray-500 truncate">{(v.relationship as string) ?? ""}{v.purpose ? ` • ${String(v.purpose)}` : ""}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 py-4 text-center">No appointments scheduled.</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** Compact metric tile — cohesive palette, real depth, subtle hover lift. */
function KpiCard({ icon: Icon, label, value, tint, bg }: { icon: LucideIcon; label: string; value: string; tint: string; bg: string }) {
  return (
    <div className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_22px_-16px_rgba(15,23,42,0.18)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_30px_-16px_rgba(15,23,42,0.22)]">
      <span className={`grid h-9 w-9 place-items-center rounded-xl ${bg} ${tint}`}><Icon className="h-[18px] w-[18px]" /></span>
      <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
      <p className="mt-0.5 text-xs font-medium text-slate-500">{label}</p>
    </div>
  );
}
