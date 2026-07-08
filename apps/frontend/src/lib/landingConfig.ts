"use client";

/**
 * Landing Page Customization Store
 * --------------------------------
 * Single source of truth for the Super Admin "Landing Studio".
 *
 * Persistence is intentionally isolated in this module (localStorage +
 * an in-page/cross-tab event bus). To move to a backend later, only
 * `loadConfig` / `saveConfig` need to change — every consumer uses the
 * hook or the subscribe API and is agnostic to where the data lives.
 */

import { useState, useCallback, useSyncExternalStore } from "react";

export type BackgroundType = "default" | "solid" | "gradient" | "image";
export type BaseTheme = "dark" | "light";

export interface LandingBackground {
  type: BackgroundType;
  color: string; // solid fill
  gradientFrom: string;
  gradientTo: string;
  gradientAngle: number; // degrees
  imageUrl: string; // data URL (uploaded) or public path
  overlay: number; // 0..1 dark scrim over the background
  blur: number; // px, softens busy photos behind text
}

export interface LandingConfig {
  baseTheme: BaseTheme;
  accent: string; // hex, drives --lp-accent on the live site
  background: LandingBackground;
}

export interface LandingPreset {
  id: string;
  name: string;
  swatch: string; // dot shown in the UI
  config: LandingConfig;
}

const STORAGE_KEY = "gh_landing_config_v1";
const EVENT_NAME = "gh-landing-config";

export const DEFAULT_CONFIG: LandingConfig = {
  baseTheme: "dark",
  accent: "#f59e0b",
  background: {
    type: "default",
    color: "#09090b",
    gradientFrom: "#0b1120",
    gradientTo: "#020617",
    gradientAngle: 135,
    imageUrl: "",
    overlay: 0.5,
    blur: 0,
  },
};

export const PRESETS: LandingPreset[] = [
  {
    id: "hearth",
    name: "Golden Hearth",
    swatch: "#f59e0b",
    config: {
      baseTheme: "dark",
      accent: "#f59e0b",
      background: { ...DEFAULT_CONFIG.background, type: "default" },
    },
  },
  {
    id: "midnight",
    name: "Midnight Amber",
    swatch: "#fbbf24",
    config: {
      baseTheme: "dark",
      accent: "#fbbf24",
      background: {
        ...DEFAULT_CONFIG.background,
        type: "gradient",
        gradientFrom: "#1c1917",
        gradientTo: "#000000",
        gradientAngle: 160,
      },
    },
  },
  {
    id: "ocean",
    name: "Deep Ocean",
    swatch: "#38bdf8",
    config: {
      baseTheme: "dark",
      accent: "#38bdf8",
      background: {
        ...DEFAULT_CONFIG.background,
        type: "gradient",
        gradientFrom: "#0f172a",
        gradientTo: "#082f49",
        gradientAngle: 135,
      },
    },
  },
  {
    id: "emerald",
    name: "Emerald Calm",
    swatch: "#34d399",
    config: {
      baseTheme: "dark",
      accent: "#34d399",
      background: {
        ...DEFAULT_CONFIG.background,
        type: "gradient",
        gradientFrom: "#022c22",
        gradientTo: "#0b0f0d",
        gradientAngle: 145,
      },
    },
  },
  {
    id: "linen",
    name: "Soft Linen",
    swatch: "#d97706",
    config: {
      baseTheme: "light",
      accent: "#d97706",
      background: {
        ...DEFAULT_CONFIG.background,
        type: "gradient",
        gradientFrom: "#fefce8",
        gradientTo: "#f5f5f4",
        gradientAngle: 135,
        overlay: 0,
      },
    },
  },
  {
    id: "royal",
    name: "Royal Violet",
    swatch: "#a78bfa",
    config: {
      baseTheme: "dark",
      accent: "#a78bfa",
      background: {
        ...DEFAULT_CONFIG.background,
        type: "gradient",
        gradientFrom: "#1e1b4b",
        gradientTo: "#0b0713",
        gradientAngle: 150,
      },
    },
  },
];

/** Deep-merge stored config over defaults so new fields never break old data. */
function normalize(raw: Partial<LandingConfig> | null): LandingConfig {
  if (!raw) return DEFAULT_CONFIG;
  return {
    baseTheme: raw.baseTheme === "light" ? "light" : "dark",
    accent: typeof raw.accent === "string" ? raw.accent : DEFAULT_CONFIG.accent,
    background: { ...DEFAULT_CONFIG.background, ...(raw.background || {}) },
  };
}

export function loadConfig(): LandingConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return normalize(raw ? (JSON.parse(raw) as LandingConfig) : null);
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: LandingConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    // Same-tab listeners (the live landing page in another mounted tree)
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: config }));
  } catch (err) {
    console.error("Failed to save landing config:", err);
  }
}

export function resetConfig(): LandingConfig {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: DEFAULT_CONFIG }));
  }
  return DEFAULT_CONFIG;
}

/** Subscribe to config changes from this tab (save/reset) or other tabs (storage). */
export function subscribe(cb: (config: LandingConfig) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onEvent = () => cb(loadConfig());
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb(loadConfig());
  };
  window.addEventListener(EVENT_NAME, onEvent);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT_NAME, onEvent);
    window.removeEventListener("storage", onStorage);
  };
}

// Cache the parsed snapshot so useSyncExternalStore gets a stable reference
// (it only changes identity when the stored string actually changes).
let snapshotCache: { raw: string | null; value: LandingConfig } | null = null;

function getSnapshot(): LandingConfig {
  const raw = typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY);
  if (!snapshotCache || snapshotCache.raw !== raw) {
    let parsed: LandingConfig | null = null;
    try {
      parsed = raw ? (JSON.parse(raw) as LandingConfig) : null;
    } catch {
      parsed = null;
    }
    snapshotCache = { raw, value: normalize(parsed) };
  }
  return snapshotCache.value;
}

/** Read-only live config that re-renders whenever it is saved anywhere. */
export function useLiveLandingConfig(): LandingConfig {
  return useSyncExternalStore(
    (onChange) => subscribe(onChange),
    getSnapshot,
    () => DEFAULT_CONFIG
  );
}

/**
 * Editable draft state for the customizer. Returns the draft plus helpers
 * to mutate, persist, reset, and a `dirty` flag comparing against storage.
 */
export function useLandingDraft() {
  // The customizer only renders client-side (behind the portal loader), so
  // reading storage during lazy init is safe and avoids a hydration mismatch.
  const [draft, setDraft] = useState<LandingConfig>(loadConfig);
  const [saved, setSaved] = useState<LandingConfig>(loadConfig);

  const patch = useCallback((partial: Partial<LandingConfig>) => {
    setDraft((d) => ({ ...d, ...partial }));
  }, []);

  const patchBackground = useCallback((partial: Partial<LandingBackground>) => {
    setDraft((d) => ({ ...d, background: { ...d.background, ...partial } }));
  }, []);

  const apply = useCallback((config: LandingConfig) => setDraft(config), []);

  const save = useCallback(() => {
    saveConfig(draft);
    setSaved(draft);
  }, [draft]);

  const reset = useCallback(() => {
    const fresh = resetConfig();
    setDraft(fresh);
    setSaved(fresh);
  }, []);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  return { draft, patch, patchBackground, apply, save, reset, dirty };
}

/** Convert a background config into the CSS for the base paint layer. */
export function backgroundStyle(bg: LandingBackground): React.CSSProperties {
  switch (bg.type) {
    case "solid":
      return { background: bg.color };
    case "gradient":
      return {
        background: `linear-gradient(${bg.gradientAngle}deg, ${bg.gradientFrom}, ${bg.gradientTo})`,
      };
    case "image":
      return bg.imageUrl
        ? {
            backgroundImage: `url("${bg.imageUrl}")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            // scale hides the soft edges introduced by blur
            transform: bg.blur > 0 ? "scale(1.06)" : undefined,
            filter: bg.blur > 0 ? `blur(${bg.blur}px)` : undefined,
          }
        : {};
    default:
      return {};
  }
}

/**
 * Downscale + compress an uploaded image to a JPEG data URL that fits
 * comfortably inside the localStorage budget. Returns the data URL.
 */
export function compressImage(
  file: File,
  maxWidth = 1920,
  quality = 0.82
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error("Invalid image file"));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas not supported"));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
