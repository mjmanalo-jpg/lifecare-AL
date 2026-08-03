// Shared helpers for the Billing & Finance consolidated views
// (Transactions Ledger, Receivables & Aging, Revenue by Source).

/** Money formatter — matches the `$` convention used across the billing UI. */
export const fmt = (n: number) => `₱${Math.round(n).toLocaleString()}`;

export interface SourceMeta {
  label: string;
  badge: string;
  bar: string;
  text: string;
}

/**
 * Revenue sources. The `category` written onto each ServiceCharge by the
 * originating portal (see ServiceRequestsBoard/ConciergeBoard/FrontDeskBoard/
 * FleetTrips) maps to a colour + label here. Unknown categories fall back.
 */
const SOURCE_META: Record<string, SourceMeta> = {
  "Care Services": { label: "Care Services", badge: "bg-blue-100 text-blue-700 border-blue-200", bar: "bg-blue-500", text: "text-blue-600" },
  "Hotel Services": { label: "Hotel Services", badge: "bg-violet-100 text-violet-700 border-violet-200", bar: "bg-violet-500", text: "text-violet-600" },
  "Concierge Services": { label: "Concierge", badge: "bg-amber-100 text-amber-700 border-amber-200", bar: "bg-amber-500", text: "text-amber-600" },
  "Dining Services": { label: "Dining", badge: "bg-emerald-100 text-emerald-700 border-emerald-200", bar: "bg-emerald-500", text: "text-emerald-600" },
  Transport: { label: "Transport", badge: "bg-cyan-100 text-cyan-700 border-cyan-200", bar: "bg-cyan-500", text: "text-cyan-600" },
};

export const sourceMeta = (category: string): SourceMeta =>
  SOURCE_META[category] ?? {
    label: category || "Other",
    badge: "bg-gray-100 text-gray-600 border-gray-200",
    bar: "bg-gray-400",
    text: "text-gray-600",
  };

/** Whole-day difference between a date and now (positive = in the past). */
export const dayDiff = (from: Date | string | number, now: number = Date.now()): number =>
  Math.floor((now - new Date(from).getTime()) / 86_400_000);

export type AgingBucket = "Current" | "1–30" | "31–60" | "61–90" | "90+";
export const AGING_ORDER: AgingBucket[] = ["Current", "1–30", "31–60", "61–90", "90+"];

export function bucketOf(days: number): AgingBucket {
  if (days <= 0) return "Current";
  if (days <= 30) return "1–30";
  if (days <= 60) return "31–60";
  if (days <= 90) return "61–90";
  return "90+";
}

export const BUCKET_STYLE: Record<AgingBucket, string> = {
  Current: "bg-green-100 text-green-700 border-green-200",
  "1–30": "bg-blue-100 text-blue-700 border-blue-200",
  "31–60": "bg-amber-100 text-amber-700 border-amber-200",
  "61–90": "bg-orange-100 text-orange-700 border-orange-200",
  "90+": "bg-red-100 text-red-700 border-red-200",
};

/** Build + download a CSV client-side (quotes/escapes cells). */
export function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const csv = rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? "");
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
