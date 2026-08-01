"use client";

import { useMemo } from "react";
import { Download, AlertTriangle, Clock, Layers, TrendingDown } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptServiceCharge, adaptInvoice } from "@/lib/adapters";
import { fmt, sourceMeta, downloadCsv, dayDiff, bucketOf, AGING_ORDER, BUCKET_STYLE, type AgingBucket } from "./shared";

interface Receivable {
  kind: "Invoice" | "Unbilled";
  id: string;
  resident: string;
  reference: string;
  source?: string;
  amount: number;
  ageDays: number;
  bucket: AgingBucket;
  pastDue: boolean;
}

/**
 * Receivables & Aging — the "not paid yet / pending" picture. Combines
 * outstanding invoices (sent/overdue with a balance, aged by due date) and
 * unbilled charges (accrued but not yet invoiced, aged by service date) into
 * standard aging buckets, with no double counting.
 */
export default function BillingReceivables() {
  const { data: invoiceRows, loading: invLoading } = useLiveQuery<Record<string, unknown>>("invoices", {
    query: "include=resident&take=500",
    tables: ["Invoice", "Resident"],
  });
  const { data: chargeRows, loading: chargeLoading } = useLiveQuery<Record<string, unknown>>("service-charges", {
    query: "include=resident&take=500",
    tables: ["ServiceCharge", "Resident"],
  });

  const now = Date.now();

  const items = useMemo<Receivable[]>(() => {
    const invoices = invoiceRows.map(adaptInvoice);
    const charges = chargeRows.map(adaptServiceCharge);

    const outstandingInvoices: Receivable[] = invoices
      .filter((i) => (i.status === "SENT" || i.status === "OVERDUE") && i.balance > 0)
      .map((i) => {
        const due = i.dueDate ?? i.billingPeriodEnd ?? null;
        const ageDays = due ? dayDiff(due, now) : 0;
        return {
          kind: "Invoice" as const,
          id: i.id,
          resident: i.residentName,
          reference: i.invoiceNumber,
          amount: i.balance,
          ageDays,
          bucket: bucketOf(ageDays),
          pastDue: ageDays > 0,
        };
      });

    // Unbilled = accrued charges not yet attached to an invoice.
    const unbilled: Receivable[] = charges
      .filter((c) => !c.invoiceId)
      .map((c) => {
        const ageDays = c.serviceDate ? dayDiff(c.serviceDate, now) : 0;
        return {
          kind: "Unbilled" as const,
          id: c.id,
          resident: c.residentName,
          reference: c.description,
          source: c.category,
          amount: c.amount,
          ageDays,
          bucket: bucketOf(ageDays),
          pastDue: false,
        };
      });

    return [...outstandingInvoices, ...unbilled].sort((a, b) => b.ageDays - a.ageDays);
  }, [invoiceRows, chargeRows, now]);

  const kpis = useMemo(() => {
    const total = items.reduce((s, i) => s + i.amount, 0);
    const unbilled = items.filter((i) => i.kind === "Unbilled").reduce((s, i) => s + i.amount, 0);
    const invoiced = items.filter((i) => i.kind === "Invoice").reduce((s, i) => s + i.amount, 0);
    const overdue = items.filter((i) => i.kind === "Invoice" && i.pastDue).reduce((s, i) => s + i.amount, 0);
    return { total, unbilled, invoiced, overdue };
  }, [items]);

  const aging = useMemo(() => {
    const map = new Map<AgingBucket, { amount: number; count: number }>();
    for (const b of AGING_ORDER) map.set(b, { amount: 0, count: 0 });
    for (const i of items) {
      const cell = map.get(i.bucket)!;
      cell.amount += i.amount;
      cell.count += 1;
    }
    return map;
  }, [items]);

  const loading = invLoading || chargeLoading;
  const maxBucket = Math.max(1, ...AGING_ORDER.map((b) => aging.get(b)!.amount));

  const exportCsv = () => {
    const header = ["Type", "Resident", "Reference", "Source", "Amount", "Age (days)", "Aging Bucket", "Past Due"];
    const body = items.map((i) => [i.kind, i.resident, i.reference, i.source ?? "", Math.round(i.amount), i.ageDays, i.bucket, i.pastDue ? "Yes" : "No"]);
    downloadCsv(`receivables-aging-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...body]);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2 flex items-center gap-3">
            <TrendingDown className="w-8 h-8 text-amber-500" /> Receivables &amp; Aging
          </h1>
          <p className="text-gray-600">What&apos;s owed but not yet paid — unbilled charges and outstanding invoices, aged.</p>
        </div>
        <button
          onClick={exportCsv}
          className="self-start inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
        >
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatChip label="Total Receivable" value={fmt(kpis.total)} icon={Layers} color="indigo" />
        <StatChip label="Unbilled (Pending)" value={fmt(kpis.unbilled)} icon={Clock} color="amber" />
        <StatChip label="Invoiced (Unpaid)" value={fmt(kpis.invoiced)} icon={Layers} color="blue" />
        <StatChip label="Overdue (Past Due)" value={fmt(kpis.overdue)} icon={AlertTriangle} color="red" />
      </div>

      {/* Aging summary */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Aging Summary</h3>
        <div className="space-y-3">
          {AGING_ORDER.map((b) => {
            const cell = aging.get(b)!;
            return (
              <div key={b} className="flex items-center gap-3">
                <span className={`w-20 shrink-0 text-center inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-semibold border ${BUCKET_STYLE[b]}`}>{b}</span>
                <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-blue-400 to-indigo-500 transition-all duration-500" style={{ width: `${(cell.amount / maxBucket) * 100}%` }} />
                </div>
                <span className="w-28 shrink-0 text-right font-semibold text-gray-900">{fmt(cell.amount)}</span>
                <span className="w-14 shrink-0 text-right text-xs text-gray-500">{cell.count} item{cell.count === 1 ? "" : "s"}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-gray-600 font-semibold">
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Resident</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-right">Age</th>
                <th className="px-4 py-3">Bucket</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                    <div className="inline-block w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mb-2" />
                    <p>Loading receivables…</p>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-500">Nothing outstanding — all charges are billed and paid. 🎉</td>
                </tr>
              ) : (
                items.map((i) => (
                  <tr key={`${i.kind}-${i.id}`} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${i.kind === "Invoice" ? "bg-blue-100 text-blue-700 border-blue-200" : "bg-amber-100 text-amber-700 border-amber-200"}`}>
                        {i.kind === "Invoice" ? "Invoice" : "Unbilled"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{i.resident}</td>
                    <td className="px-4 py-3 text-gray-700 max-w-xs truncate">
                      {i.reference}
                      {i.source && <span className={`ml-2 text-xs ${sourceMeta(i.source).text}`}>· {sourceMeta(i.source).label}</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">{fmt(i.amount)}</td>
                    <td className="px-4 py-3 text-right text-gray-600 whitespace-nowrap">{Math.max(0, i.ageDays)}d</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${BUCKET_STYLE[i.bucket]}`}>{i.bucket}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatChip({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  color: "blue" | "amber" | "indigo" | "red";
}) {
  const ring: Record<string, string> = {
    blue: "text-blue-600 bg-blue-50",
    amber: "text-amber-600 bg-amber-50",
    indigo: "text-indigo-600 bg-indigo-50",
    red: "text-red-600 bg-red-50",
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
    </div>
  );
}
