"use client";

/**
 * Dynamic background layer for the public landing page.
 * Reads the live config saved by the Super Admin Landing Studio and paints
 * the chosen solid / gradient / uploaded-image background behind the page,
 * plus exposes the chosen accent as the `--lp-accent` CSS variable and keeps
 * the site's base light/dark theme in sync.
 *
 * When the background type is "default" it renders nothing, preserving the
 * original hand-tuned design until an admin customizes it.
 */

import { useEffect } from "react";
import { useLiveLandingConfig, backgroundStyle } from "@/lib/landingConfig";

export default function LandingBackground() {
  const config = useLiveLandingConfig();
  const { background: bg, accent, baseTheme } = config;

  // Publish accent + base theme to the document so the whole page reacts.
  useEffect(() => {
    document.documentElement.style.setProperty("--lp-accent", accent);
    if (baseTheme === "light") {
      document.documentElement.classList.add("light");
      document.documentElement.style.colorScheme = "light";
    } else {
      document.documentElement.classList.remove("light");
      document.documentElement.style.colorScheme = "dark";
    }
  }, [accent, baseTheme]);

  if (bg.type === "default") return null;

  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      {/* Base paint (scaled/blurred for image type) */}
      <div className="absolute inset-0" style={backgroundStyle(bg)} />
      {/* Readability scrim */}
      {bg.overlay > 0 && (
        <div
          className="absolute inset-0"
          style={{ background: `rgba(0,0,0,${bg.overlay})` }}
        />
      )}
    </div>
  );
}
