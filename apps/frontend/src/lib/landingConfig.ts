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
export type LoginTemplateId = "split" | "centered" | "sidebar" | "frosted";

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

export interface LoginConfig {
  templateId: LoginTemplateId;
  baseTheme: BaseTheme;
  accent: string;
  background: LandingBackground;
}

export interface LandingConfig {
  baseTheme: BaseTheme;
  accent: string; // hex, drives --lp-accent on the live site
  background: LandingBackground;
  login: LoginConfig;
}

export interface LandingPreset {
  id: string;
  name: string;
  swatch: string; // dot shown in the UI
  config: LandingConfig;
}

const STORAGE_KEY = "gh_landing_config_v1";
const EVENT_NAME = "gh-landing-config";

export const DEFAULT_LOGIN_CONFIG: LoginConfig = {
  templateId: "split",
  baseTheme: "dark",
  accent: "#f59e0b",
  background: {
    type: "default",
    color: "#09090b",
    gradientFrom: "#0b1120",
    gradientTo: "#020617",
    gradientAngle: 135,
    imageUrl: "",
    overlay: 0.35,
    blur: 0,
  },
};

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
  login: DEFAULT_LOGIN_CONFIG,
};

export const PRESETS: LandingPreset[] = [
  {
    id: "hearth",
    name: "LifeCare",
    swatch: "#f59e0b",
    config: {
      baseTheme: "dark",
      accent: "#f59e0b",
      background: { ...DEFAULT_CONFIG.background, type: "default" },
      login: { ...DEFAULT_LOGIN_CONFIG, templateId: "split", accent: "#f59e0b" },
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
        gradientFrom: "#b45309",
        gradientTo: "#171310",
        gradientAngle: 160,
      },
      login: {
        ...DEFAULT_LOGIN_CONFIG,
        templateId: "centered",
        accent: "#fbbf24",
        background: {
          ...DEFAULT_LOGIN_CONFIG.background,
          type: "gradient",
          gradientFrom: "#b45309",
          gradientTo: "#171310",
          gradientAngle: 160,
        },
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
        gradientFrom: "#0369a1",
        gradientTo: "#08131f",
        gradientAngle: 135,
      },
      login: {
        ...DEFAULT_LOGIN_CONFIG,
        templateId: "sidebar",
        accent: "#38bdf8",
        background: {
          ...DEFAULT_LOGIN_CONFIG.background,
          type: "gradient",
          gradientFrom: "#0369a1",
          gradientTo: "#08131f",
          gradientAngle: 135,
        },
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
        gradientFrom: "#047857",
        gradientTo: "#08130f",
        gradientAngle: 145,
      },
      login: {
        ...DEFAULT_LOGIN_CONFIG,
        templateId: "frosted",
        accent: "#34d399",
        background: {
          ...DEFAULT_LOGIN_CONFIG.background,
          type: "gradient",
          gradientFrom: "#047857",
          gradientTo: "#08130f",
          gradientAngle: 145,
        },
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
        gradientFrom: "#fef3c7",
        gradientTo: "#e7e5e4",
        gradientAngle: 135,
        overlay: 0,
      },
      login: {
        ...DEFAULT_LOGIN_CONFIG,
        templateId: "split",
        baseTheme: "light",
        accent: "#d97706",
        background: {
          ...DEFAULT_LOGIN_CONFIG.background,
          type: "gradient",
          gradientFrom: "#fef3c7",
          gradientTo: "#e7e5e4",
          gradientAngle: 135,
          overlay: 0,
        },
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
        gradientFrom: "#6d28d9",
        gradientTo: "#140f26",
        gradientAngle: 150,
      },
      login: {
        ...DEFAULT_LOGIN_CONFIG,
        templateId: "centered",
        accent: "#a78bfa",
        background: {
          ...DEFAULT_LOGIN_CONFIG.background,
          type: "gradient",
          gradientFrom: "#6d28d9",
          gradientTo: "#140f26",
          gradientAngle: 150,
        },
      },
    },
  },
  {
    id: "rose",
    name: "Rose Blush",
    swatch: "#fb7185",
    config: {
      baseTheme: "dark",
      accent: "#fb7185",
      background: {
        ...DEFAULT_CONFIG.background,
        type: "gradient",
        gradientFrom: "#be123c",
        gradientTo: "#1a0e12",
        gradientAngle: 150,
      },
      login: {
        ...DEFAULT_LOGIN_CONFIG,
        templateId: "sidebar",
        accent: "#fb7185",
        background: {
          ...DEFAULT_LOGIN_CONFIG.background,
          type: "gradient",
          gradientFrom: "#be123c",
          gradientTo: "#1a0e12",
          gradientAngle: 150,
        },
      },
    },
  },
];

/** Deep-merge stored config over defaults so new fields never break old data. */
function normalize(raw: Partial<LandingConfig> | null): LandingConfig {
  if (!raw) return DEFAULT_CONFIG;

  const rawLogin: Partial<LoginConfig> = raw.login || {};
  const loginBg: Partial<LandingBackground> = rawLogin.background || {};
  const normalizedLogin: LoginConfig = {
    templateId: (["split", "centered", "sidebar", "frosted"].includes(rawLogin.templateId as any)) // eslint-disable-line @typescript-eslint/no-explicit-any
      ? (rawLogin.templateId as LoginTemplateId)
      : DEFAULT_LOGIN_CONFIG.templateId,
    baseTheme: rawLogin.baseTheme === "light" ? "light" : "dark",
    accent: typeof rawLogin.accent === "string" ? rawLogin.accent : DEFAULT_LOGIN_CONFIG.accent,
    background: {
      type: (["default", "solid", "gradient", "image"].includes(loginBg.type as any)) // eslint-disable-line @typescript-eslint/no-explicit-any
        ? (loginBg.type as BackgroundType)
        : DEFAULT_LOGIN_CONFIG.background.type,
      color: typeof loginBg.color === "string" ? loginBg.color : DEFAULT_LOGIN_CONFIG.background.color,
      gradientFrom: typeof loginBg.gradientFrom === "string" ? loginBg.gradientFrom : DEFAULT_LOGIN_CONFIG.background.gradientFrom,
      gradientTo: typeof loginBg.gradientTo === "string" ? loginBg.gradientTo : DEFAULT_LOGIN_CONFIG.background.gradientTo,
      gradientAngle: typeof loginBg.gradientAngle === "number" ? loginBg.gradientAngle : DEFAULT_LOGIN_CONFIG.background.gradientAngle,
      imageUrl: typeof loginBg.imageUrl === "string" ? loginBg.imageUrl : DEFAULT_LOGIN_CONFIG.background.imageUrl,
      overlay: typeof loginBg.overlay === "number" ? loginBg.overlay : DEFAULT_LOGIN_CONFIG.background.overlay,
      blur: typeof loginBg.blur === "number" ? loginBg.blur : DEFAULT_LOGIN_CONFIG.background.blur,
    },
  };

  return {
    baseTheme: raw.baseTheme === "light" ? "light" : "dark",
    accent: typeof raw.accent === "string" ? raw.accent : DEFAULT_CONFIG.accent,
    background: { ...DEFAULT_CONFIG.background, ...(raw.background || {}) },
    login: normalizedLogin,
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
