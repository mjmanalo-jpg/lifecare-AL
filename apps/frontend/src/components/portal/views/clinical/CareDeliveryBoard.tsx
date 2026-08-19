"use client";

/**
 * Care Delivery — KPIs from the governed Care Events captured when caregivers
 * complete (or vary) care-plan tasks. Facility roll-up + per-resident drill-down:
 * completion volume, clean-completion rate, exceptions/variances, escalations and
 * residents flagged for reassessment. Read-only; Nurse + Care Manager.
 *
 * Source: the CareEvent table (see lib/lifecare/careEvents + /api/care-events).
 */

import { useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Activity, AlertTriangle, ShieldAlert, RefreshCw, ChevronRight } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { type ClinicianRole } from "./useClinician";
import { ClinicalPage, ClinicalHeader, ClinicalCard, StatCard, DataState, SERIF } from "./clinical-ui";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const s = (v: unknown) => (v == null ? "" : String(v));
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
const fmtDate = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); };

const PERIODS = [{ key: "1", label: "Today", days: 1 }, { key: "7", label: "7 days", days: 7 }, { key: "30", label: "30 days", days: 30 }] as const;

interface Ev {
  residentId: string; residentName: string; outcome: string; domain: string;
  isException: boolean; isVariance: boolean; immediateEscalation: boolean; reviewAlertRaised: boolean;
  actorName: string; at: string;
}

export default function CareDeliveryBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const router = useRouter();
  const pathname = usePathname();
  const roleSeg = (pathname || "").split("/").filter(Boolean)[0] || clinicianRole.toLowerCase();
  const { data, loading, error, refetch } = useLiveQuery<Row>("care-events", { query: "take=2000", tables: ["CareEvent"] });
  const [periodKey, setPeriodKey] = useState<string>("7");

  const period = PERIODS.find((p) => p.key === periodKey) ?? PERIODS[1];
  const cutoff = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - period.days + 1); d.setHours(0, 0, 0, 0); return d.getTime(); }, [period.days]);

  const events = useMemo<Ev[]>(() => (data || [])
    .map((r) => ({
      residentId: s(r.residentId), residentName: s(r.residentName) || "Resident", outcome: s(r.outcome) || "Completed", domain: s(r.domain),
      isException: !!r.isException, isVariance: !!r.isVariance, immediateEscalation: !!r.immediateEscalation, reviewAlertRaised: !!r.reviewAlertRaised,
      actorName: s(r.actorName), at: s(r.createdAt || r.occurredAt),
    }))
    .filter((e) => { const t = new Date(e.at).getTime(); return !isNaN(t) && t >= cutoff; })
    .sort((a, b) => (b.at || "").localeCompare(a.at || "")), [data, cutoff]);

  // Facility KPIs.
  const k = useMemo(() => {
    const total = events.length;
    const exceptions = events.filter((e) => e.isException).length;
    const escalations = events.filter((e) => e.immediateEscalation).length;
    const reassess = new Set(events.filter((e) => e.reviewAlertRaised).map((e) => e.residentId)).size;
    return { total, exceptions, escalations, reassess, cleanRate: pct(total - exceptions, total) };
  }, [events]);

  // Outcome breakdown.
  const byOutcome = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events) m.set(e.outcome, (m.get(e.outcome) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [events]);

  // Per-resident roll-up.
  const byResident = useMemo(() => {
    const m = new Map<string, { id: string; name: string; total: number; exceptions: number; escalations: number; reassess: boolean; last: string }>();
    for (const e of events) {
      const cur = m.get(e.residentId) ?? { id: e.residentId, name: e.residentName, total: 0, exceptions: 0, escalations: 0, reassess: false, last: e.at };
      cur.total++; if (e.isException) cur.exceptions++; if (e.immediateEscalation) cur.escalations++; if (e.reviewAlertRaised) cur.reassess = true;
      if ((e.at || "") > cur.last) cur.last = e.at;
      m.set(e.residentId, cur);
    }
    return [...m.values()].sort((a, b) => (b.exceptions - a.exceptions) || (b.total - a.total));
  }, [events]);

  return (
    <ClinicalPage>
      <ClinicalHeader title="Care Delivery" subtitle="Task-completion KPIs from governed care events — completion, variances, escalations and reassessment flags." />

      <div className="mt-4 mb-5 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--clinical-muted)]">Period</span>
        <div className="inline-flex rounded-lg p-0.5" style={{ backgroundColor: "var(--clinical-surface-2)" }}>
          {PERIODS.map((p) => (
            <button key={p.key} onClick={() => setPeriodKey(p.key)} className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${periodKey === p.key ? "bg-[var(--clinical-surface)] shadow-sm text-[var(--clinical-ink)]" : "text-[var(--clinical-muted)] hover:text-[var(--clinical-ink)]"}`}>{p.label}</button>
          ))}
        </div>
        <button onClick={() => void refetch()} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold text-[var(--clinical-ink-soft)] transition hover:bg-[var(--clinical-surface-2)]" style={{ borderColor: "var(--clinical-line)" }}><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
      </div>

      <DataState loading={loading && (data || []).length === 0} error={error} empty={false} onRetry={() => void refetch()} skeletonRows={4}>
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard value={k.total} label="Tasks documented" accent="ink" />
          <StatCard value={`${k.cleanRate}%`} label="Clean completion" accent={k.cleanRate >= 85 ? "green" : "amber"} />
          <StatCard value={k.exceptions} label="Exceptions / variances" accent={k.exceptions > 0 ? "amber" : "ink"} />
          <StatCard value={k.escalations} label="Escalations raised" accent={k.escalations > 0 ? "coral" : "ink"} />
          <StatCard value={k.reassess} label="Flagged for reassessment" accent={k.reassess > 0 ? "coral" : "ink"} />
        </div>

        {events.length === 0 ? (
          <div className="rounded-2xl border p-10 text-center text-sm text-[var(--clinical-muted)]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
            No care events documented in this period. As caregivers complete care-plan tasks, their outcomes appear here.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_2fr]">
            {/* Outcome breakdown */}
            <ClinicalCard className="p-5">
              <p className="mb-3 font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>Outcomes</p>
              <div className="space-y-2.5">
                {byOutcome.map(([o, n]) => {
                  const clean = o === "Completed" || o === "Not Required";
                  const color = clean ? "var(--clinical-green)" : o === "Unsafe" || o === "Clinical Change" ? "var(--clinical-coral)" : "var(--clinical-amber)";
                  return (
                    <div key={o}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-medium text-[var(--clinical-ink-soft)]">{o}</span>
                        <span className="tabular-nums text-[var(--clinical-muted)]">{n} · {pct(n, k.total)}%</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: "var(--clinical-line)" }}>
                        <div className="h-full rounded-full" style={{ width: `${pct(n, k.total)}%`, backgroundColor: color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </ClinicalCard>

            {/* Per-resident roll-up */}
            <ClinicalCard className="p-0 overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3.5 border-b" style={{ borderColor: "var(--clinical-line)" }}>
                <Activity className="h-4 w-4 text-[var(--clinical-panel)]" />
                <p className="font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>By resident</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead><tr className="border-b text-left text-[var(--clinical-muted)]" style={{ borderColor: "var(--clinical-line)" }}>
                    <th className="px-5 py-2.5 font-semibold">Resident</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Done</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Exceptions</th>
                    <th className="px-3 py-2.5 font-semibold">Flags</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Last</th>
                    <th className="px-3 py-2.5" />
                  </tr></thead>
                  <tbody>
                    {byResident.map((r) => (
                      <tr key={r.id} className="border-b last:border-0 transition hover:bg-[var(--clinical-surface-2)]" style={{ borderColor: "var(--clinical-line)" }}>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold" style={{ backgroundColor: "var(--clinical-surface-2)", color: "var(--clinical-ink-soft)" }}>{initials(r.name)}</span>
                            <span className="font-semibold text-[var(--clinical-ink)]">{r.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums font-semibold text-[var(--clinical-ink)]">{r.total}</td>
                        <td className="px-3 py-3 text-right tabular-nums" style={{ color: r.exceptions > 0 ? "var(--clinical-amber)" : "var(--clinical-muted)" }}>{r.exceptions}{r.total ? ` · ${pct(r.exceptions, r.total)}%` : ""}</td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1">
                            {r.escalations > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-[var(--clinical-coral)] px-2 py-0.5 text-[10px] font-bold text-white"><ShieldAlert className="h-3 w-3" /> {r.escalations}</span>}
                            {r.reassess && <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: "var(--clinical-panel)" }}><RefreshCw className="h-3 w-3" /> Reassess</span>}
                            {r.escalations === 0 && !r.reassess && <span className="text-[var(--clinical-muted)]">—</span>}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right text-xs tabular-nums text-[var(--clinical-muted)]">{fmtDate(r.last)}</td>
                        <td className="px-3 py-3 text-right">
                          <button onClick={() => router.push(`/${roleSeg}/residentjourney`)} title="Open resident journey" className="text-[var(--clinical-panel)] hover:underline"><ChevronRight className="h-4 w-4" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ClinicalCard>
          </div>
        )}

        {(k.escalations > 0 || k.reassess > 0) && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm" style={{ borderColor: "var(--clinical-amber)", backgroundColor: "color-mix(in srgb, var(--clinical-amber) 8%, transparent)" }}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--clinical-amber)]" />
            <span className="text-[var(--clinical-ink-soft)]">{k.escalations > 0 ? `${k.escalations} escalation${k.escalations === 1 ? "" : "s"} raised from care during this period. ` : ""}{k.reassess > 0 ? `${k.reassess} resident${k.reassess === 1 ? "" : "s"} flagged for reassessment — review their care plan (no automatic level/fee change).` : ""}</span>
          </div>
        )}
      </DataState>
    </ClinicalPage>
  );
}
