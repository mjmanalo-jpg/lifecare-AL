import { renderOgCard } from "@/lib/ogCard";

// Same branded card for Twitter/X previews. Route-segment config is declared
// statically here (it must not be re-exported from another route file).
export const runtime = "nodejs";
export const alt = "LifeCare CMS (LCMS) — Real-time Assisted Living Management";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return renderOgCard();
}
