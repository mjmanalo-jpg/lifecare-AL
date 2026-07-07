import { AlertTriangle, AlertCircle, Info, CheckCircle, X } from "lucide-react";

export type AlertType = "error" | "warning" | "info" | "success";

interface AlertBannerProps {
  type: AlertType;
  title: string;
  message: string;
  onClose?: () => void;
  action?: {
    label: string;
    onClick: () => void;
  };
  resident?: string;
  timestamp?: Date;
}

const alertConfig: Record<AlertType, { bg: string; border: string; icon: React.ComponentType<{ className?: string }> }> = {
  error: {
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    icon: AlertTriangle,
  },
  warning: {
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/20",
    icon: AlertCircle,
  },
  info: {
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    icon: Info,
  },
  success: {
    bg: "bg-green-500/10",
    border: "border-green-500/20",
    icon: CheckCircle,
  },
};

const textConfig: Record<AlertType, string> = {
  error: "text-red-500",
  warning: "text-yellow-600",
  info: "text-blue-500",
  success: "text-green-500",
};

const iconConfig: Record<AlertType, string> = {
  error: "text-red-500",
  warning: "text-yellow-600",
  info: "text-blue-500",
  success: "text-green-500",
};

export default function AlertBanner({
  type,
  title,
  message,
  onClose,
  action,
  resident,
  timestamp,
}: AlertBannerProps) {
  const config = alertConfig[type];
  const Icon = config.icon;
  const textClass = textConfig[type];
  const iconClass = iconConfig[type];

  return (
    <div
      className={`${config.bg} ${config.border} border rounded-lg p-4 flex items-start gap-3 mb-4`}
    >
      <div className={`flex-shrink-0 mt-0.5 ${iconClass}`}>
        <Icon className="w-5 h-5" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h4 className={`font-semibold ${textClass}`}>{title}</h4>
            <p className={`text-sm mt-1 ${textClass}`}>{message}</p>

            {resident && (
              <p className={`text-xs mt-1 ${textClass} opacity-75`}>
                Resident: {resident}
              </p>
            )}

            {timestamp && (
              <p className={`text-xs mt-1 ${textClass} opacity-75`}>
                {new Date(timestamp).toLocaleString()}
              </p>
            )}
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className={`flex-shrink-0 p-1 rounded hover:bg-black/10 transition ${textClass}`}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {action && (
          <button
            onClick={action.onClick}
            className={`mt-3 text-sm font-medium ${textClass} hover:underline`}
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
