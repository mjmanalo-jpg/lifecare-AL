"use client";

import { useMemo } from "react";
import { TrendingUp, UserPlus, Percent, Clock } from "lucide-react";
import { LEAD_STAGES, OPEN_STAGES, STAGE_META, LEAD_SOURCES, avgDaysToWin, type Lead } from "@/lib/crmLeads";
import type { CrmApi } from "@/lib/useCrmLeads";

/** Occupancy-growth reporting, computed client-side from the lead set. */
export default function LeadAnalyticsBoard({ api }: { api: CrmApi }) {
  const a = useMemo(() => {
    const leads = api.leads;
    const won = leads.filter((l) => l.stage === "MOVE_IN");
    const lost = leads.filter((l) => l.stage === "LOST");
    const open = leads.filter((l) => OPEN_STAGES.includes(l.stage));
    const closed = won.length + lost.length;

    const bySource = LEAD_SOURCES.map((src) => {
      const all = leads.filter((l) => (l.source || "Other") === src);
      const w = all.filter((l) => l.stage === "MOVE_IN").length;
      const c = w + all.filter((l) => l.stage === "LOST").length;
      return { src, total: all.length, won: w, conv: c ? Math.round((w / c) * 100) : 0 };
    }).filter((s) => s.total > 0).sort((x, y) => y.total - x.total);

    const lostReasons = Object.entries(lost.reduce<Record<string, number>>((m, l) => { const k = l.lostReason || "Unspecified"; m[k] = (m[k] || 0) + 1; return m; }, {})).sort((x, y) => y[1] - x[1]);

    const funnel = LEAD_STAGES.filter((s) => s !== "LOST").map((s) => ({ stage: s, count: leads.filter((l) => l.stage === s).length }));

    const months: { key: string; label: string; count: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      months.push({ key, label: d.toLocaleDateString(undefined, { month: "short" }), count: leads.filter((l) => (l.createdAt || "").slice(0, 7) === key).length });
    }

    return { total: leads.length, open: open.length, won: won.length, lost: lost.length, conv: closed ? Math.round((won.length / closed) * 100) : 0, avgWin: avgDaysToWin(leads), bySource, lostReasons, funnel, months };
  }, [api.leads]);

  const maxFunnel = Math.max(1, ...a.funnel.map((f) => f.count));
  const maxMonth = Math.max(1, ...a.months.map((m) => m.count));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Open Pipeline" value={a.open} icon={TrendingUp} tone="text-blue-600" />
        <Kpi label="Moved In (Won)" value={a.won} icon={UserPlus} tone="text-emerald-600" />
        <Kpi label="Conversion" value={`${a.conv}%`} icon={Percent} tone="text-teal-600" />
        <Kpi label="Avg days to move-in" value={a.avgWin ?? "—"} icon={Clock} tone="text-slate-700" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Pipeline funnel">
          <div className="space-y-2">
            {a.funnel.map((f) => (
              <div key={f.stage} className="flex items-center gap-2">
                <span className="w-28 text-xs text-slate-600 shrink-0 truncate">{STAGE_META[f.stage].label}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                  <div className="h-full rounded-full bg-blue-500 flex items-center justify-end px-2" style={{ width: `${Math.max(6, (f.count / maxFunnel) * 100)}%` }}>
                    <span className="text-[10px] font-bold text-white">{f.count}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="New leads by month">
          <div className="flex items-end justify-between gap-2 h-40 pt-2">
            {a.months.map((m) => (
              <div key={m.key} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                <span className="text-xs font-bold text-slate-700">{m.count}</span>
                <div className="w-full rounded-t bg-teal-500" style={{ height: `${(m.count / maxMonth) * 100}%`, minHeight: m.count ? 6 : 2 }} />
                <span className="text-[11px] text-slate-400">{m.label}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Conversion by source">
          {a.bySource.length === 0 ? <Empty /> : (
            <div className="space-y-2.5">
              {a.bySource.map((s) => (
                <div key={s.src}>
                  <div className="flex items-center justify-between text-xs mb-0.5"><span className="text-slate-600">{s.src}</span><span className="text-slate-400">{s.won}/{s.total} · <span className="font-semibold text-slate-700">{s.conv}%</span></span></div>
                  <div className="bg-slate-100 rounded-full h-2"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${s.conv}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title={`Lost reasons · ${a.lost}`}>
          {a.lostReasons.length === 0 ? <Empty label="No lost leads" /> : (
            <div className="space-y-1.5">
              {a.lostReasons.map(([reason, n]) => (
                <div key={reason} className="flex items-center justify-between text-sm">
                  <span className="text-slate-600 truncate">{reason}</span>
                  <span className="text-xs font-semibold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">{n}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, icon: Icon, tone }: { label: string; value: string | number; icon: typeof TrendingUp; tone: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between"><p className="text-xs font-semibold text-slate-500">{label}</p><Icon className={`w-4 h-4 ${tone}`} /></div>
      <p className={`text-2xl font-bold mt-1 ${tone}`}>{value}</p>
    </div>
  );
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="text-sm font-bold text-slate-800 mb-3">{title}</h3>{children}</div>;
}
function Empty({ label = "No data yet" }: { label?: string }) {
  return <p className="text-xs text-slate-400 py-4 text-center">{label}</p>;
}
