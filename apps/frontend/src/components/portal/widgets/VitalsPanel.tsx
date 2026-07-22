import { Activity, Thermometer, Wind, Droplet, AlertCircle } from "lucide-react";

export interface VitalReading {
  type: "HEART_RATE" | "TEMPERATURE" | "BLOOD_PRESSURE" | "OXYGEN";
  value: number;
  unit: string;
  normal: boolean;
  lastUpdated: Date;
}

interface VitalsPanelProps {
  vitals: VitalReading[];
  resident?: string;
  isLoading?: boolean;
}

const vitalConfig: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; range: [number, number] }> = {
  HEART_RATE: {
    icon: Activity,
    color: "text-red-600",
    range: [60, 100],
  },
  TEMPERATURE: {
    icon: Thermometer,
    color: "text-orange-600",
    range: [36.1, 37.2],
  },
  BLOOD_PRESSURE: {
    icon: Activity,
    color: "text-blue-600",
    range: [90, 140],
  },
  OXYGEN: {
    icon: Wind,
    color: "text-cyan-600",
    range: [95, 100],
  },
};

export default function VitalsPanel({
  vitals,
  resident,
  isLoading = false,
}: VitalsPanelProps) {
  if (isLoading) {
    return (
      <div className="bg-surface rounded-lg p-3 sm:p-5 md:p-6 border border-border shadow-sm">
        <div className="animate-pulse space-y-3 sm:space-y-4">
          <div className="h-3 sm:h-4 bg-gray-200 rounded w-24"></div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 md:gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 sm:h-20 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-lg p-3 sm:p-5 md:p-6 border border-border shadow-sm container-type-[inline-size]">
      <div className="flex items-center justify-between mb-3 sm:mb-4 gap-2">
        <h3 className="text-sm sm:text-base md:text-lg font-semibold text-foreground">Vital Signs</h3>
        {resident && (
          <span className="text-xs sm:text-sm text-gray-600 truncate">{resident}</span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 md:gap-4">
        {vitals.map((vital) => {
          const config = vitalConfig[vital.type];
          const Icon = config.icon;
          const statusColor = vital.normal
            ? "bg-green-50 border-green-200"
            : "bg-red-50 border-red-200";

          return (
            <div
              key={vital.type}
              className={`${statusColor} border rounded-lg p-2.5 sm:p-3 md:p-4 transition hover:shadow-md`}
            >
              <div className="flex items-center justify-between mb-1.5 sm:mb-2">
                <div className={`p-1.5 sm:p-2 rounded-lg bg-background ${config.color}`}>
                  <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 md:w-4.5 md:h-4.5" />
                </div>
                {!vital.normal && (
                  <AlertCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-red-600" />
                )}
              </div>

              <div className="mt-2 sm:mt-3">
                <div className="flex items-baseline gap-0.5 sm:gap-1">
                  <span className="text-lg sm:text-xl md:text-2xl font-bold text-foreground">
                    {vital.value}
                  </span>
                  <span className="text-xs sm:text-sm text-muted-foreground ml-0.5 sm:ml-1">{vital.unit}</span>
                </div>
                <p className="text-[10px] sm:text-xs text-gray-600 mt-0.5 sm:mt-1">
                  {vital.type.replace("_", " ")}
                </p>
                <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1">
                  {new Date(vital.lastUpdated).toLocaleTimeString()}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {vitals.length === 0 && (
        <div className="flex items-center justify-center py-8 text-gray-500">
          <p className="text-sm">No vital readings available</p>
        </div>
      )}
    </div>
  );
}
