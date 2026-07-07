import { User, MapPin, AlertCircle } from "lucide-react";

interface ResidentCardProps {
  name: string;
  room: string;
  careLevel: "INDEPENDENT" | "ASSISTED" | "MEMORY" | "SKILLED";
  status: "ACTIVE" | "INACTIVE" | "DISCHARGED" | "DECEASED";
  alertsCount?: number;
  onClick?: () => void;
  isSelectable?: boolean;
}

const careLevelColor: Record<string, { bg: string; text: string }> = {
  INDEPENDENT: { bg: "bg-green-100", text: "text-green-800" },
  ASSISTED: { bg: "bg-blue-100", text: "text-blue-800" },
  MEMORY: { bg: "bg-purple-100", text: "text-purple-800" },
  SKILLED: { bg: "bg-orange-100", text: "text-orange-800" },
};

const statusColor: Record<string, { bg: string; text: string }> = {
  ACTIVE: { bg: "bg-green-100", text: "text-green-800" },
  INACTIVE: { bg: "bg-gray-100", text: "text-gray-800" },
  DISCHARGED: { bg: "bg-yellow-100", text: "text-yellow-800" },
  DECEASED: { bg: "bg-red-100", text: "text-red-800" },
};

export default function ResidentCard({
  name,
  room,
  careLevel,
  status,
  alertsCount = 0,
  onClick,
  isSelectable = false,
}: ResidentCardProps) {
  const careLevelStyle = careLevelColor[careLevel] || careLevelColor.INDEPENDENT;
  const statusStyle = statusColor[status] || statusColor.ACTIVE;

  return (
    <div
      onClick={onClick}
      className={`bg-surface rounded-lg p-4 border border-border shadow-sm hover:shadow-md transition ${
        isSelectable && "cursor-pointer hover:border-blue-300"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600 flex-shrink-0">
          <User className="w-5 h-5" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground truncate">{name}</h3>

          <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
            <MapPin className="w-3.5 h-3.5" />
            <span>Room {room}</span>
          </div>

          {/* Tags */}
          <div className="flex flex-wrap gap-2 mt-3">
            <span
              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${careLevelStyle.bg} ${careLevelStyle.text}`}
            >
              {careLevel.replace("_", " ")}
            </span>
            <span
              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}
            >
              {status}
            </span>
          </div>
        </div>

        {/* Alert Badge */}
        {alertsCount > 0 && (
          <div className="flex items-center justify-center w-8 h-8 bg-red-100 rounded-full text-red-600 text-xs font-bold flex-shrink-0">
            <AlertCircle className="w-4 h-4" />
          </div>
        )}
      </div>
    </div>
  );
}
