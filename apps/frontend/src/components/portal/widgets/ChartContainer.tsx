import {
  LineChart,
  Line,
  BarChart,
  Bar,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";

export type ChartType = "line" | "bar" | "radar" | "area";

interface ChartContainerProps {
  title: string;
  type: ChartType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[];
  dataKey: string;
  xAxisKey?: string;
  colors?: string[];
  height?: number;
}

export default function ChartContainer({
  title,
  type,
  data,
  dataKey,
  xAxisKey = "name",
  colors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444"],
  height = 300,
}: ChartContainerProps) {
  return (
    <div className="bg-surface rounded-lg p-3 sm:p-5 md:p-6 border border-border shadow-sm container-type-[inline-size]">
      <h3 className="text-sm sm:text-base md:text-lg font-semibold text-foreground mb-3 sm:mb-4">{title}</h3>

      <ResponsiveContainer width="100%" height={height}>
        {type === "line" && (
          <LineChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey={xAxisKey} stroke="#6b7280" />
            <YAxis stroke="#6b7280" />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                color: "var(--foreground)",
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={colors[0]}
              strokeWidth={2}
              dot={{ fill: colors[0], r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        )}

        {type === "bar" && (
          <BarChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey={xAxisKey} stroke="#6b7280" />
            <YAxis stroke="#6b7280" />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                color: "var(--foreground)",
              }}
            />
            <Legend />
            <Bar dataKey={dataKey} fill={colors[0]} radius={[8, 8, 0, 0]} />
          </BarChart>
        )}

        {type === "area" && (
          <AreaChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey={xAxisKey} stroke="#6b7280" />
            <YAxis stroke="#6b7280" />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                color: "var(--foreground)",
              }}
            />
            <Legend />
            <Area
              type="monotone"
              dataKey={dataKey}
              fill={colors[0]}
              stroke={colors[0]}
              fillOpacity={0.3}
            />
          </AreaChart>
        )}

        {type === "radar" && (
          <RadarChart data={data}>
            <PolarGrid stroke="#e5e7eb" />
            <PolarAngleAxis dataKey="name" stroke="#6b7280" />
            <PolarRadiusAxis stroke="#6b7280" />
            <Radar
              name={dataKey}
              dataKey={dataKey}
              stroke={colors[0]}
              fill={colors[0]}
              fillOpacity={0.5}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                color: "var(--foreground)",
              }}
            />
            <Legend />
          </RadarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
