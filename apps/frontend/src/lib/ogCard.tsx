import { ImageResponse } from "next/og";

// Shared renderer for the Open Graph / Twitter share card. Route files
// (opengraph-image.tsx, twitter-image.tsx) declare their own static route
// config and call this — route-segment config must NOT be re-exported, so it
// can't live here.

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_ALT = "Senior Living Management System (SLMS) — Real-time Assisted Living Management";

// SLMS heart mark (matches components/LcmsLogo) as an inline SVG data URI.
const LOGO = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3b82f6"/><stop offset="100%" stop-color="#1d4ed8"/>
    </linearGradient></defs>
    <path d="M50 88C50 88 15 58 15 36C15 19 28 8 44 8C50 8 50 14 50 14C50 14 50 8 56 8C72 8 85 19 85 36C85 58 50 88 50 88Z" fill="url(#g)"/>
    <path d="M50 80C50 80 23 54 23 36C23 23 33 14 46 14C50 14 50 18 50 18C50 18 50 14 54 14C67 14 77 23 77 36C77 54 50 80 50 80Z" fill="#ffffff"/>
    <path d="M50 28 L50 52 M38 40 L62 40" stroke="#1d4ed8" stroke-width="7" stroke-linecap="round"/>
  </svg>`,
)}`;

export function renderOgCard(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0B1524 0%, #12263F 55%, #16386B 100%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO} width={188} height={188} alt="" style={{ marginBottom: 30 }} />
        <div style={{ fontSize: 92, fontWeight: 800, letterSpacing: 4, display: "flex" }}>
          SLMS
        </div>
        <div style={{ fontSize: 36, marginTop: 8, color: "#C7DBF5", display: "flex" }}>
          Senior Living Management System
        </div>
        <div style={{ fontSize: 24, marginTop: 6, color: "#8FA9CC", display: "flex" }}>
          Real-time Assisted Living Management
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 40,
            padding: "10px 24px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.16)",
            fontSize: 24,
            color: "#CBD9EC",
          }}
        >
          assisted-living.resoluteaiph.com
        </div>
      </div>
    ),
    { ...OG_SIZE },
  );
}
