"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * Renders a QR code (as an inline data-URI image) encoding `value` — usually the
 * resident-card URL that clinical staff scan. Generated fully client-side (no
 * external service), so it works under the app's strict CSP.
 */
export default function ResidentQR({ value, size = 176, className = "" }: { value: string; size?: number; className?: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => { if (alive) setSrc(url); })
      .catch(() => { if (alive) setSrc(""); });
    return () => { alive = false; };
  }, [value, size]);

  if (!src) return <div style={{ width: size, height: size }} className={`bg-gray-100 rounded animate-pulse ${className}`} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="Resident QR code" width={size} height={size} className={`rounded bg-white ${className}`} />;
}
