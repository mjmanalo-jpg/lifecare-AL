"use client";

/**
 * Dynamic background layer for the public landing page.
 * Reads the live config saved by the Super Admin Landing Studio and paints
 * the chosen solid / gradient / uploaded-image background behind the page,
 * exposes the chosen accent as the `--lp-accent` CSS variable, and keeps the
 * site's base light/dark theme in sync.
 *
 * The layer is rendered via a portal into <body> — NOT inside <main> — because
 * the Lenis SmoothScroll wrapper applies a transform, which would make a fixed,
 * negatively-stacked child resolve against that wrapper and hide behind it.
 * Portaling to <body> guarantees it paints behind the page content and above
 * the base page background.
 *
 * When the background type is "default" it renders nothing, preserving the
 * original hand-tuned design until an admin customizes it.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLiveLandingConfig, backgroundStyle } from "@/lib/landingConfig";

export default function LandingBackground() {
  const config = useLiveLandingConfig();
  const { background: bg, accent, baseTheme } = config;
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Publish accent + base theme to the document so the whole page reacts.
  useEffect(() => {
    document.documentElement.style.setProperty("--lp-accent", accent);
    // Translucent variations (hex with opacity suffix)
    document.documentElement.style.setProperty("--lp-accent-10", `${accent}1a`); // 10% opacity
    document.documentElement.style.setProperty("--lp-accent-20", `${accent}33`); // 20% opacity
    document.documentElement.style.setProperty("--lp-accent-30", `${accent}4d`); // 30% opacity
    document.documentElement.style.setProperty("--lp-accent-80", `${accent}cc`); // 80% opacity
    
    if (baseTheme === "light") {
      document.documentElement.classList.add("light");
      document.documentElement.style.colorScheme = "light";
    } else {
      document.documentElement.classList.remove("light");
      document.documentElement.style.colorScheme = "dark";
    }
  }, [accent, baseTheme]);

  // Manage html class when custom background is active to prevent stacking-context occlusion
  useEffect(() => {
    if (bg.type !== "default") {
      document.documentElement.classList.add("has-custom-bg");
      if (baseTheme === "light") {
        document.documentElement.classList.add("theme-light");
        document.documentElement.classList.remove("theme-dark");
      } else {
        document.documentElement.classList.add("theme-dark");
        document.documentElement.classList.remove("theme-light");
      }
    } else {
      document.documentElement.classList.remove("has-custom-bg", "theme-light", "theme-dark");
    }
    return () => {
      document.documentElement.classList.remove("has-custom-bg", "theme-light", "theme-dark");
    };
  }, [bg.type, baseTheme]);

  if (!mounted || bg.type === "default") return null;

  return createPortal(
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
      {/* Light/Dark mode transition scrim */}
      <div className="custom-bg-scrim" />
    </div>,
    document.body
  );
}
