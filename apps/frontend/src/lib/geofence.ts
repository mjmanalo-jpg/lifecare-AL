/**
 * Facility geofences — the physical boundaries a caregiver/nurse must be inside
 * to clock in. Super Admin can define MULTIPLE locations, each with its own
 * radius and assigned staff. Migration-free in the app-setting `geofence_config`.
 * Enforcement is client-side at clock-in (browser Geolocation).
 */

export const GEOFENCE_KEY = "geofence_config";

export interface GeofenceLocation {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  /** Staff (User ids) assigned to this location. Empty = applies to everyone. */
  assignedUserIds: string[];
}

export interface GeofenceConfig {
  enabled: boolean;
  locations: GeofenceLocation[];
}

export const DEFAULT_GEOFENCE: GeofenceConfig = { enabled: false, locations: [] };

let seq = 0;
export function newLocationId(): string {
  seq += 1;
  return `loc-${Date.now().toString(36)}-${seq}`;
}

export function newLocation(): GeofenceLocation {
  return { id: newLocationId(), label: "", latitude: 0, longitude: 0, radiusMeters: 150, assignedUserIds: [] };
}

function sanitizeLocation(v: Partial<GeofenceLocation>, i: number): GeofenceLocation {
  return {
    id: typeof v.id === "string" && v.id ? v.id : `loc-${i}`,
    label: typeof v.label === "string" ? v.label : "",
    latitude: Number(v.latitude) || 0,
    longitude: Number(v.longitude) || 0,
    radiusMeters: Number(v.radiusMeters) > 0 ? Number(v.radiusMeters) : 150,
    assignedUserIds: Array.isArray(v.assignedUserIds) ? v.assignedUserIds.map(String) : [],
  };
}

export function parseGeofence(raw: string | null | undefined): GeofenceConfig {
  if (!raw) return { ...DEFAULT_GEOFENCE };
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (Array.isArray(v.locations)) {
      return { enabled: !!v.enabled, locations: (v.locations as Partial<GeofenceLocation>[]).map(sanitizeLocation) };
    }
    // Back-compat: the old single-location shape → one location.
    if (v.latitude != null || v.longitude != null || v.label != null) {
      return { enabled: !!v.enabled, locations: [sanitizeLocation(v as Partial<GeofenceLocation>, 0)] };
    }
    return { ...DEFAULT_GEOFENCE };
  } catch {
    return { ...DEFAULT_GEOFENCE };
  }
}

export const hasCoords = (l: GeofenceLocation): boolean => !!(l.latitude || l.longitude);

/** Great-circle distance between two lat/lng points, in metres. */
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Locations that govern a given user: assigned to them, or open to everyone. */
export function locationsForUser(cfg: GeofenceConfig, userId: string): GeofenceLocation[] {
  return cfg.locations.filter((l) => hasCoords(l) && (l.assignedUserIds.length === 0 || l.assignedUserIds.includes(userId)));
}

/** Geofence is enforced for a user when it's on AND at least one location governs them. */
export function geofenceRequired(cfg: GeofenceConfig, userId: string): boolean {
  return cfg.enabled && locationsForUser(cfg, userId).length > 0;
}

export interface GeoCheck { ok: boolean; distanceM: number; location?: GeofenceLocation }

/** Pass if the point is inside ANY location that governs the user (nearest reported). */
export function checkAgainstLocations(cfg: GeofenceConfig, userId: string, lat: number, lng: number): GeoCheck {
  const applicable = locationsForUser(cfg, userId);
  if (applicable.length === 0) return { ok: true, distanceM: 0 };
  let best: GeoCheck = { ok: false, distanceM: Infinity };
  for (const l of applicable) {
    const distanceM = haversineMeters(l.latitude, l.longitude, lat, lng);
    if (distanceM < best.distanceM) best = { ok: distanceM <= l.radiusMeters, distanceM, location: l };
    if (distanceM <= l.radiusMeters) return { ok: true, distanceM, location: l };
  }
  return best;
}

/** Promisified geolocation with a timeout (browser only). */
export function getCurrentPosition(timeoutMs = 12_000): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Location is not available on this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 });
  });
}
