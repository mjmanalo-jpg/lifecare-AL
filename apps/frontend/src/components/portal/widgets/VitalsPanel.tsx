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
      <div className="bg-surface rounded-lg p-6 border border-border shadow-sm">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-24"></div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-lg p-6 border border-border shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground">Vital Signs</h3>
        {resident && (
          <span className="text-sm text-gray-600">{resident}</span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {vitals.map((vital) => {
          const config = vitalConfig[vital.type];
          const Icon = config.icon;
          const statusColor = vital.normal
            ? "bg-green-50 border-green-200"
            : "bg-red-50 border-red-200";

          return (
            <div
              key={vital.type}
              className={`${statusColor} border rounded-lg p-4 transition hover:shadow-md`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className={`p-2 rounded-lg bg-background ${config.color}`}>
                  <Icon className="w-4.5 h-4.5" />
                </div>
                {!vital.normal && (
                  <AlertCircle className="w-4 h-4 text-red-600" />
                )}
              </div>

              <div className="mt-3">
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-foreground">
                    {vital.value}
                  </span>
                  <span className="text-sm text-muted-foreground ml-1">{vital.unit}</span>
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  {vital.type.replace("_", " ")}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
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
