"use client";

import ChartContainer from "@/components/portal/widgets/ChartContainer";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { humanize } from "@/lib/adapters";
import { TabLoading, EmptyState, EMPTY_VITALS_TREND, type Row } from "./shared";

/** Health Timeline — chronological live vitals feed with trend chart. */
export default function FamilyTimeline() {
  const { data: vitalsRows, loading: vitalsLoading } = useLiveQuery("vitals", {
    query: "include=resident&take=50",
    tables: ["VitalsLog"],
  });

  const heartRateTrend = vitalsRows
    .filter((v: Row) => v.type === "HEART_RATE")
    .slice(0, 12)
    .reverse()
    .map((v: Row) => {
      const numeric = parseFloat(String(v.value));
      return {
        name: v.recordedAt
          ? new Date(String(v.recordedAt)).toLocaleDateString([], { month: "short", day: "numeric" })
          : "",
        value: isNaN(numeric) ? 0 : numeric,
      };
    });

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Health Timeline</h2>
      <ChartContainer
        title="Heart Rate (Recent)"
        type="line"
        data={heartRateTrend.length ? heartRateTrend : EMPTY_VITALS_TREND}
        dataKey="value"
        xAxisKey="name"
        colors={["#ef4444"]}
      />

      <div className="bg-white rounded-lg border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Recent Vitals</h3>
        </div>
        {vitalsLoading && vitalsRows.length === 0 ? (
          <TabLoading label="Loading vitals..." />
        ) : vitalsRows.length === 0 ? (
          <EmptyState message="No vital readings recorded yet." />
        ) : (
          <ul className="divide-y divide-gray-100">
            {vitalsRows.map((v: Row, i: number) => (
              <li key={(v.id as string) ?? i} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="font-medium text-gray-900">{humanize(v.type as string)}</p>
                  <p className="text-xs text-gray-500">
                    {v.recordedAt ? new Date(v.recordedAt as string).toLocaleString() : ""}
                  </p>
                </div>
                <span className="text-lg font-semibold text-gray-900">
                  {String(v.value)}
                  {v.unit ? ` ${String(v.unit)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
