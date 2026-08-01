"use client";

import { useMemo, useState } from "react";
import { Download, PieChart, CheckCircle, Clock } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptServiceCharge, adaptInvoice } from "@/lib/adapters";
import { fmt, sourceMeta, downloadCsv } from "./shared";

type Charge = ReturnType<typeof adaptServiceCharge>;

const PERIODS = [
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "365", label: "Last 12 months", days: 365 },
  { key: "all", label: "All time", days: 0 },
] as const;

interface SourceRow {
  category: string;
  total: number;
  collected: number;
  outstanding: number;
  count: number;
}

/**
 * Revenue by Source — where the money comes from. Groups charges by their
 * source category and splits each into collected (on a paid invoice) vs
 * outstanding (unbilled or invoiced-unpaid), over a selectable period.
 */
export default function BillingRevenue() {
  const { data: chargeRows, loading } = useLiveQuery<Record<string, unknown>>("service-charges", {
    query: "include=resident,invoice&take=1000",
    tables: ["ServiceCharge", "Resident", "Invoice"],
  });
  const { data: invoiceRows } = useLiveQuery<Record<string, unknown>>("invoices", {
    query: "take=500",
    tables: ["Invoice"],
  });

  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("90");

  const paidInvoiceIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of invoiceRows) {
      const i = adaptInvoice(r);
      if (i.status === "PAID") s.add(i.id);
    }
    return s;
  }, [invoiceRows]);

  const charges = useMemo(() => chargeRows.map(adaptServiceCharge), [chargeRows]);

  const scoped = useMemo(() => {
    const days = PERIODS.find((p) => p.key === period)!.days;
    if (!days) return charges;
    const cutoff = Date.now() - days * 86_400_000;
    return charges.filter((c) => (c.serviceDate ? new Date(c.serviceDate).getTime() >= cutoff : false));
  }, [charges, period]);

  const isCollected = (c: Charge) => Boolean(c.invoiceId && paidInvoiceIds.has(c.invoiceId));

  const rows = useMemo<SourceRow[]>(() => {
    const map = new Map<string, SourceRow>();
    for (const c of scoped) {
      const row = map.get(c.category) ?? { category: c.category, total: 0, collected: 0, outstanding: 0, count: 0 };
      row.total += c.amount;
      row.count += 1;
      if (isCollected(c)) row.collected += c.amount;
      else row.outstanding += c.amount;
      map.set(c.category, row);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, paidInvoiceIds]);

  const grand = useMemo(() => {
    const total = rows.reduce((s, r) => s + r.total, 0);
    const collected = rows.reduce((s, r) => s + r.collected, 0);
    const outstanding = rows.reduce((s, r) => s + r.outstanding, 0);
    return { total, collected, outstanding, count: rows.reduce((s, r) => s + r.count, 0) };
  }, [rows]);

  const exportCsv = () => {
    const header = ["Source", "Transactions", "Total Revenue", "Collected", "Outstanding", "% of Revenue"];
    const body = rows.map((r) => [
      sourceMeta(r.category).label,
      r.count,
      Math.round(r.total),
      Math.round(r.collected),
      Math.round(r.outstanding),
      grand.total ? `${Math.round((r.total / grand.total) * 100)}%` : "0%",
    ]);
    body.push(["TOTAL", grand.count, Math.round(grand.total), Math.round(grand.collected), Math.round(grand.outstanding), "100%"]);
    downloadCsv(`revenue-by-source-${period}-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...body]);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2 flex items-center gap-3">
            <PieChart className="w-8 h-8 text-indigo-500" /> Revenue by Source
          </h1>
          <p className="text-gray-600">Where the money comes from — collected vs outstanding per revenue stream.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} className="px-4 py-2 border border-gray-300 rounded-lg bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400">
            {PERIODS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          <button onClick={exportCsv} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 transition">
            <Download className="w-4 h-4" /> CSV
          </button>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatChip label="Total Revenue" value={fmt(grand.total)} sub={`${grand.count} transactions`} icon={PieChart} color="indigo" />
        <StatChip label="Collected" value={fmt(grand.collected)} sub={grand.total ? `${Math.round((grand.collected / grand.total) * 100)}% of revenue` : undefined} icon={CheckCircle} color="green" />
        <StatChip label="Outstanding" value={fmt(grand.outstanding)} icon={Clock} color="amber" />
        <StatChip label="Revenue Streams" value={String(rows.length)} icon={PieChart} color="blue" />
      </div>

      {/* Per-source breakdown */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-bold text-gray-900 mb-5">Revenue Streams</h3>
        {loading && rows.length === 0 ? (
          <div className="py-8 text-center text-gray-500">
            <div className="inline-block w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mb-2" />
            <p>Loading revenue…</p>
          </div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-gray-500">No revenue recorded in this period.</p>
        ) : (
          <div className="space-y-5">
            {rows.map((r) => {
              const sm = sourceMeta(r.category);
              const pct = grand.total ? (r.total / grand.total) * 100 : 0;
              const collectedPct = r.total ? (r.collected / r.total) * 100 : 0;
              return (
                <div key={r.category}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="flex items-center gap-2">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${sm.badge}`}>{sm.label}</span>
                      <span className="text-xs text-gray-500">{r.count} txn · {Math.round(pct)}% of revenue</span>
                    </span>
                    <span className="font-semibold text-gray-900">{fmt(r.total)}</span>
                  </div>
                  {/* collected (solid) vs outstanding (light) split bar */}
                  <div className="w-full h-4 bg-gray-100 rounded-full overflow-hidden flex">
                    <div className="h-full bg-green-500 transition-all duration-500" style={{ width: `${collectedPct}%` }} title={`Collected ${fmt(r.collected)}`} />
                    <div className="h-full bg-amber-400/70 transition-all duration-500" style={{ width: `${100 - collectedPct}%` }} title={`Outstanding ${fmt(r.outstanding)}`} />
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-xs">
                    <span className="text-green-600 font-medium">● Collected {fmt(r.collected)}</span>
                    <span className="text-amber-600 font-medium">● Outstanding {fmt(r.outstanding)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatChip({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  color: "blue" | "green" | "amber" | "indigo";
}) {
  const ring: Record<string, string> = {
    blue: "text-blue-600 bg-blue-50",
    green: "text-green-600 bg-green-50",
    amber: "text-amber-600 bg-amber-50",
    indigo: "text-indigo-600 bg-indigo-50",
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${ring[color]}`}>
          <Icon className="w-4 h-4" />
        </span>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}
