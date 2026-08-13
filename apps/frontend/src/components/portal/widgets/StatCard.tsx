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
    <div className="bg-surface rounded-lg p-3 sm:p-5 md:p-6 border border-border shadow-sm hover:shadow-md transition">
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-xs sm:text-sm font-medium text-muted-foreground leading-tight">{title}</h3>
          <div className={`mt-1.5 sm:mt-2 flex items-baseline gap-1 ${textColor}`}>
            <span className="text-lg sm:text-xl md:text-2xl font-bold leading-none">{value}</span>
            {unit && <span className="text-xs sm:text-sm font-medium">{unit}</span>}
          </div>

          {trend && (
            <div className={`mt-1.5 sm:mt-2 flex items-center gap-1 text-xs sm:text-sm ${
              trend.direction === "up" ? "text-green-600" : "text-red-600"
            }`}>
              {trend.direction === "up" ? (
                <TrendingUp size={14} className="sm:w-4 sm:h-4" />
              ) : (
                <TrendingDown size={14} className="sm:w-4 sm:h-4" />
              )}
              <span className="truncate">{trend.percent}% from last period</span>
            </div>
          )}
        </div>

        <div className={`p-1.5 sm:p-2 md:p-3 rounded-lg bg-background ${iconColor} flex-shrink-0`}>
          <Icon className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6" />
        </div>
      </div>
    </div>
  );
}
