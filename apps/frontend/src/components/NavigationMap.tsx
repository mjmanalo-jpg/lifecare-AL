"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/* ── Fix default marker icons for bundled builds ── */
if (typeof window !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
}

/* ── Custom marker icons ── */
const FACILITY_ICON = L.divIcon({
  className: "",
  html: `<div style="width:32px;height:32px;border-radius:50%;background:#f59e0b;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.3);border:3px solid #fff"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -36],
});

const DESTINATION_ICON = L.divIcon({
  className: "",
  html: `<div style="width:32px;height:32px;border-radius:50%;background:#ef4444;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.3);border:3px solid #fff"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -36],
});

const VEHICLE_ICON = L.divIcon({
  className: "",
  html: `<div style="width:36px;height:36px;border-radius:50%;background:#3b82f6;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(59,130,246,0.5);border:3px solid #fff"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg></div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  popupAnchor: [0, -40],
});

/* ── Types ── */
export interface MapPoint {
  lat: number;
  lng: number;
  label?: string;
}

export interface NavigationMapProps {
  origin?: MapPoint;
  destination?: MapPoint | { text: string };
  vehiclePosition?: MapPoint;
  height?: string;
  showRoute?: boolean;
  className?: string;
  zoom?: number;
}

const FACILITY_LAT = Number(process.env.NEXT_PUBLIC_FACILITY_LAT) || 14.5547;
const FACILITY_LNG = Number(process.env.NEXT_PUBLIC_FACILITY_LNG) || 121.0244;

/* ── OSRM route fetching ── */
async function fetchRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): Promise<L.LatLngExpression[]> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.routes?.length > 0) {
      return data.routes[0].geometry.coordinates.map(
        (c: [number, number]) => [c[1], c[0]] as L.LatLngExpression
      );
    }
  } catch { /* fallback to straight line */ }
  return [
    [from.lat, from.lng],
    [to.lat, to.lng],
  ];
}

/* ── Nominatim geocoding ── */
async function geocodeDestination(text: string): Promise<MapPoint | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&limit=1`;
    const res = await fetch(url, { headers: { "User-Agent": "AssistedLivingPlatform/1.0" } });
    const data = await res.json();
    if (data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), label: text };
    }
  } catch { /* geocoding failed */ }
  return null;
}

/* ── Leaflet map styles injected once ── */
const LEAFLET_STYLE_ID = "navigation-map-styles";
function injectLeafletStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(LEAFLET_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = LEAFLET_STYLE_ID;
  style.textContent = `
    .nav-popup .leaflet-popup-content-wrapper {
      border-radius: 12px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.15);
      border: 1px solid rgba(255,255,255,0.1);
      background: var(--card-bg, #fff);
      color: var(--foreground, #18181b);
    }
    .nav-popup .leaflet-popup-tip {
      box-shadow: 0 4px 10px rgba(0,0,0,0.1);
      background: var(--card-bg, #fff);
    }
    .route-dash-animation {
      animation: dashMove 1.5s linear infinite;
    }
    @keyframes dashMove {
      to { stroke-dashoffset: -20; }
    }
    @keyframes navPulse {
      0%, 100% { box-shadow: 0 2px 10px rgba(59,130,246,0.5); }
      50% { box-shadow: 0 2px 20px rgba(59,130,246,0.8); }
    }
    .leaflet-container {
      background: #1a1a2e;
      font-family: inherit;
    }
    .leaflet-control-attribution {
      font-size: 9px !important;
      background: rgba(0,0,0,0.5) !important;
      color: rgba(255,255,255,0.5) !important;
    }
    .leaflet-control-attribution a {
      color: rgba(255,255,255,0.7) !important;
    }
  `;
  document.head.appendChild(style);
}

/* ── Inner map component ── */
function MapInner({
  origin,
  destination,
  vehiclePosition,
  showRoute = true,
  zoom = 13,
}: Omit<NavigationMapProps, "height" | "className">) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const [routeCoords, setRouteCoords] = useState<L.LatLngExpression[]>([]);
  const [resolvedDest, setResolvedDest] = useState<MapPoint | null>(null);

  const originPoint: MapPoint = origin || { lat: FACILITY_LAT, lng: FACILITY_LNG, label: "Facility" };

  /* Resolve destination if it's text */
  useEffect(() => {
    if (destination && "text" in destination && destination.text) {
      geocodeDestination(destination.text).then(point => {
        if (point) setResolvedDest(point);
      });
    } else if (destination && "lat" in destination) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResolvedDest(destination as MapPoint);
    }
  }, [destination]);

  /* Fetch route */
  useEffect(() => {
    if (showRoute && resolvedDest) {
      fetchRoute(
        { lat: originPoint.lat, lng: originPoint.lng },
        { lat: resolvedDest.lat, lng: resolvedDest.lng }
      ).then(setRouteCoords);
    }
  }, [originPoint.lat, originPoint.lng, resolvedDest, showRoute]);

  /* Initialize map */
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    injectLeafletStyles();

    const map = L.map(mapRef.current, {
      zoomControl: false,
      attributionControl: true,
    });

    L.control.zoom({ position: "topright" }).addTo(map);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://osm.org/copyright">OSM</a>',
      maxZoom: 19,
    }).addTo(map);

    layersRef.current = L.layerGroup().addTo(map);
    mapInstance.current = map;

    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, []);

  /* Update markers and route */
  useEffect(() => {
    const map = mapInstance.current;
    const layers = layersRef.current;
    if (!map || !layers) return;

    layers.clearLayers();
    const bounds: L.LatLngExpression[] = [];

    /* Origin marker */
    const originMarker = L.marker([originPoint.lat, originPoint.lng], { icon: FACILITY_ICON })
      .bindPopup(`<div style="font-weight:700;font-size:13px">${originPoint.label || "Facility"}</div><div style="font-size:11px;opacity:0.6">Origin</div>`, {
        className: "nav-popup",
      });
    layers.addLayer(originMarker);
    bounds.push([originPoint.lat, originPoint.lng]);

    /* Destination marker */
    if (resolvedDest) {
      const destMarker = L.marker([resolvedDest.lat, resolvedDest.lng], { icon: DESTINATION_ICON })
        .bindPopup(`<div style="font-weight:700;font-size:13px">${resolvedDest.label || "Destination"}</div><div style="font-size:11px;opacity:0.6">Drop-off Point</div>`, {
          className: "nav-popup",
        });
      layers.addLayer(destMarker);
      bounds.push([resolvedDest.lat, resolvedDest.lng]);
    }

    /* Vehicle position */
    if (vehiclePosition) {
      const vMarker = L.marker([vehiclePosition.lat, vehiclePosition.lng], { icon: VEHICLE_ICON })
        .bindPopup(`<div style="font-weight:700;font-size:13px">Vehicle Location</div><div style="font-size:11px;opacity:0.6">Live Position</div>`, {
          className: "nav-popup",
        });
      layers.addLayer(vMarker);
      bounds.push([vehiclePosition.lat, vehiclePosition.lng]);
    }

    /* Route polyline */
    if (routeCoords.length > 0) {
      L.polyline(routeCoords, {
        color: "#000",
        weight: 8,
        opacity: 0.15,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(layers);

      L.polyline(routeCoords, {
        color: "#3b82f6",
        weight: 5,
        opacity: 0.9,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(layers);

      L.polyline(routeCoords, {
        color: "#60a5fa",
        weight: 3,
        opacity: 0.6,
        dashArray: "12 8",
        lineCap: "round",
        lineJoin: "round",
        className: "route-dash-animation",
      } as L.PolylineOptions).addTo(layers);
    } else if (resolvedDest) {
      L.polyline(
        [
          [originPoint.lat, originPoint.lng],
          [resolvedDest.lat, resolvedDest.lng],
        ],
        {
          color: "#3b82f6",
          weight: 3,
          opacity: 0.5,
          dashArray: "8 6",
        }
      ).addTo(layers);
    }

    /* Fit bounds */
    if (bounds.length > 0) {
      const pad = vehiclePosition ? 0.15 : 0.25;
      map.fitBounds(L.latLngBounds(bounds), { padding: [50, 50], maxZoom: 15 });
    }
  }, [originPoint, resolvedDest, vehiclePosition, routeCoords]);

  /* Resize observer */
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    const observer = new ResizeObserver(() => map.invalidateSize());
    if (mapRef.current) observer.observe(mapRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={mapRef} className="w-full h-full rounded-xl" />
      {/* Floating route info badge */}
      <div className="absolute top-3 left-3 z-[1000] bg-[var(--card-bg)] border border-[var(--border)] rounded-lg px-3 py-1.5 shadow-lg">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-blue-500" style={{ animation: "navPulse 2s infinite" }} />
          <span className="text-[10px] font-bold text-[var(--foreground)] uppercase tracking-wider">
            {routeCoords.length > 0 ? "Route Calculated" : resolvedDest ? "Destination Found" : "Map Ready"}
          </span>
        </div>
      </div>
    </>
  );
}

/* ── Loading placeholder ── */
function MapPlaceholder({ height }: { height: string }) {
  return (
    <div
      style={{ height }}
      className="w-full rounded-xl bg-[var(--surface)] border border-[var(--border)] flex flex-col items-center justify-center gap-2"
    >
      <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center" style={{ animation: "navPulse 2s infinite" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
      </div>
      <span className="text-xs font-semibold text-[var(--muted-foreground)]">Loading map...</span>
    </div>
  );
}

/* ── Main exported component ── */
function NavigationMapInner({
  origin,
  destination,
  vehiclePosition,
  height = "320px",
  showRoute = true,
  className = "",
  zoom = 13,
}: NavigationMapProps) {
  const [ready, setReady] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setReady(true); }, []);

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-[var(--border)] ${className}`}
      style={{ height }}
    >
      {ready ? (
        <MapInner
          origin={origin}
          destination={destination}
          vehiclePosition={vehiclePosition}
          showRoute={showRoute}
          zoom={zoom}
        />
      ) : (
        <MapPlaceholder height={height} />
      )}
    </div>
  );
}

export default dynamic(() => Promise.resolve(NavigationMapInner), { ssr: false });
