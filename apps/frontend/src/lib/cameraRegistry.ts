/**
 * Camera registry — the set of room cameras a facility has installed, stored
 * migration-free as JSON in the AppSetting `camera_registry` (tenant-scoped).
 * Each camera maps to a room and a browser-loadable stream URL, and carries
 * health fields updated by a live "Test connection" or an edge heartbeat.
 */
export const CAMERA_REGISTRY_KEY = "camera_registry";

export type CameraType = "tapo" | "rtsp" | "local" | "edge";
export type CameraHealth = "online" | "offline" | "unknown";

export interface CameraDevice {
  id: string;
  name: string;
  roomNumber: string;
  type: CameraType;
  /** Browser-loadable stream (MJPEG/HLS/WebRTC) used for viewing + connection tests. */
  streamUrl: string;
  /** Optional server-side RTSP URL (rtsp://…) for the backend 24/7 fall watchdog.
   *  `tapo` cameras don't need this (the backend uses its configured Tapo RTSP);
   *  set it for other IP cameras so they can be monitored server-side too. */
  rtspUrl?: string;
  notes?: string;
  enabled: boolean;
  lastSeenAt?: string;   // ISO — last successful test or edge heartbeat
  lastEventAt?: string;  // ISO — last detection event forwarded from this camera
  lastStatus?: string;   // free-form status note (e.g. "error", HTTP code)
  /** When true, staff are alerted if this camera stops checking in (needs a
   *  heartbeat source). Off by default so cameras without a heartbeat wired
   *  don't nuisance-alert. */
  healthAlerts?: boolean;
  offlineNotifiedAt?: string; // ISO — last offline alert sent (for dedup)
}

/** A camera counts as offline (UI badge) if it hasn't checked in within this window. */
export const CAMERA_STALE_MS = 3 * 60 * 1000;
/** Grace before the cron *alerts* staff a monitored camera is offline. */
export const CAMERA_OFFLINE_ALERT_MS = 10 * 60 * 1000;

export function parseCameras(raw: string | null | undefined): CameraDevice[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((c) => c && typeof c.id === "string");
  } catch {
    return [];
  }
}

export function cameraHealth(cam: CameraDevice, nowTs: number): CameraHealth {
  if (!nowTs || !cam.lastSeenAt) return "unknown";
  const seen = new Date(cam.lastSeenAt).getTime();
  if (!Number.isFinite(seen)) return "unknown";
  return nowTs - seen <= CAMERA_STALE_MS ? "online" : "offline";
}

export function newCameraId(): string {
  return `cam_${Math.abs(Math.floor(performance.now() * 1000)).toString(36)}_${Math.floor(performance.now()).toString(36)}`;
}
