import { TrendingUp, TrendingDown } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  unit?: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: {
    direction: "up" | "down";
    percent: number;
  };
  backgroundColor?: string;
  textColor?: string;
  iconColor?: string;
}

export default function StatCard({
  title,
  value,
  unit = "",
  icon: Icon,
  trend,
  backgroundColor = "bg-blue-50",
  textColor = "text-blue-900",
  iconColor = "text-blue-500",
}: StatCardProps) {
  return (
    <div className={`bg-surface rounded-lg p-6 border border-border shadow-sm hover:shadow-md transition`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
          <div className={`mt-2 flex items-baseline gap-1 ${textColor}`}>
            <span className="text-2xl font-bold">{value}</span>
            {unit && <span className="text-sm font-medium">{unit}</span>}
          </div>

          {trend && (
            <div className={`mt-2 flex items-center gap-1 text-sm ${
              trend.direction === "up" ? "text-green-600" : "text-red-600"
            }`}>
              {trend.direction === "up" ? (
                <TrendingUp size={16} />
              ) : (
                <TrendingDown size={16} />
              )}
              <span>{trend.percent}% from last period</span>
            </div>
          )}
        </div>

        <div className={`p-3 rounded-lg bg-background ${iconColor}`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
}
