import type { NextConfig } from "next";

// Content-Security-Policy starts in REPORT-ONLY mode: it logs violations to the
// browser console without blocking anything, so it cannot break the clinical app.
// Review real violations, tighten (drop 'unsafe-inline'/'unsafe-eval', pin hosts),
// then switch the header name below to "Content-Security-Policy" to enforce.
const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:", // Next.js + TensorFlow.js need these until tightened
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:", // Supabase (REST/Realtime), AI providers
  "worker-src 'self' blob:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app legitimately uses camera (monitoring / face enroll), microphone, and
  // geolocation (geofenced clock-in) — allow them for same-origin, deny the rest.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self), payment=()" },
  { key: "Content-Security-Policy-Report-Only", value: CSP },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
