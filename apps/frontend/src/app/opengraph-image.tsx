import { renderOgCard } from "@/lib/ogCard";

// Branded social-share card (Open Graph). Next.js injects this as og:image and
// twitter:image automatically, overriding any stale/placeholder preview.
export const runtime = "nodejs";
export const alt = "Senior Living Management System (SLMS) — Real-time Assisted Living Management";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return renderOgCard();
}
