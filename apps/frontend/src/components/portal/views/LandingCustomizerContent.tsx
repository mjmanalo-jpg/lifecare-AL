"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import {
  Palette,
  Sparkles,
  Sun,
  Moon,
  Image as ImageIcon,
  Upload,
  Trash2,
  RotateCcw,
  Save,
  Check,
  Droplet,
  Layers,
  Paintbrush,
  ExternalLink,
  ChevronDown,
  LogIn,
  LayoutDashboard,
  FileText,
  Newspaper,
  FilePlus,
  Plus,
  Pencil,
  X,
  Eye,
  EyeOff,
  GripVertical,
  Calendar,
  User,
  type LucideIcon,
} from "lucide-react";
import Swal from "sweetalert2";
import {
  useLandingDraft,
  backgroundStyle,
  compressImage,
  PRESETS,
  type BackgroundType,
} from "@/lib/landingConfig";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";

const ACCENT_SWATCHES = [
  "#f59e0b", "#fbbf24", "#f97316", "#ef4444", "#ec4899",
  "#a78bfa", "#6366f1", "#38bdf8", "#14b8a6", "#34d399",
];

const BG_TABS: { id: BackgroundType; label: string; icon: typeof Droplet }[] = [
  { id: "default", label: "Default", icon: Sparkles },
  { id: "solid", label: "Solid", icon: Droplet },
  { id: "gradient", label: "Gradient", icon: Layers },
  { id: "image", label: "Image", icon: ImageIcon },
];

type StudioTab = "landing" | "login" | "content" | "blog" | "pages";

const STUDIO_TABS: { id: StudioTab; label: string; icon: LucideIcon }[] = [
  { id: "landing", label: "Landing", icon: LayoutDashboard },
  { id: "login", label: "Login", icon: LogIn },
  { id: "content", label: "Content", icon: FileText },
  { id: "blog", label: "Blog", icon: Newspaper },
  { id: "pages", label: "Pages", icon: FilePlus },
];

interface BlogPost {
  id: string;
  title: string;
  description: string;
  content?: string;
  imageUrl?: string;
  author: string;
  publishedAt: string;
  published: boolean;
}

interface SiteContentRow {
  id: string;
  value: string;
}

interface CustomPageRow {
  id: string;
  title: string;
  slug: string;
  content: string;
  published: boolean;
  sortOrder: number;
  description?: string;
  imageUrl?: string;
  pagePurpose?: string;
  parcelType?: string;
}

const CONTENT_FIELDS: { id: string; label: string; multiline?: boolean }[] = [
  { id: "hero_title", label: "Hero Title" },
  { id: "hero_subtitle", label: "Hero Subtitle" },
  { id: "hero_description", label: "Hero Description", multiline: true },
  { id: "feature_1_title", label: "Feature 1 — Title" },
  { id: "feature_1_desc", label: "Feature 1 — Description", multiline: true },
  { id: "feature_2_title", label: "Feature 2 — Title" },
  { id: "feature_2_desc", label: "Feature 2 — Description", multiline: true },
  { id: "feature_3_title", label: "Feature 3 — Title" },
  { id: "feature_3_desc", label: "Feature 3 — Description", multiline: true },
  { id: "contact_address", label: "Contact Address", multiline: true },
  { id: "contact_phone", label: "Contact Phone Number" },
  { id: "contact_email", label: "Contact Email Address" },
  { id: "contact_map_url", label: "Google Maps Embed URL", multiline: true },
  { id: "footer_text", label: "Footer Text" },
];



/** Rough byte size of a base64 data URL. */
function dataUrlBytes(url: string): number {
  const i = url.indexOf(",");
  return i === -1 ? 0 : Math.round((url.length - i - 1) * 0.75);
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      {children}
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof Droplet;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="p-2 bg-yellow-100 rounded-lg">
        <Icon className="w-5 h-5 text-yellow-600" />
      </div>
      <div>
        <h2 className="text-base font-bold text-gray-900">{title}</h2>
        {hint && <p className="text-xs text-gray-500">{hint}</p>}
      </div>
    </div>
  );
}

export default function LandingCustomizerContent() {
  const { draft, patch, patchBackground, apply, save, reset, dirty } =
    useLandingDraft();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [activeTab, setActiveTab] = useState<StudioTab>("landing");

  const patchLogin = (partial: Partial<import("@/lib/landingConfig").LoginConfig>) => {
    patch({ login: { ...draft.login, ...partial } });
  };

  const patchLoginBackground = (partial: Partial<import("@/lib/landingConfig").LandingBackground>) => {
    patch({
      login: {
        ...draft.login,
        background: { ...draft.login.background, ...partial },
      },
    });
  };

  const bg = activeTab === "login" ? draft.login.background : draft.background;
  const patchBg = activeTab === "login" ? patchLoginBackground : patchBackground;

  const handleFiles = async (files: FileList | null) => {
    setUploadError("");
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setUploadError("Please choose an image file.");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setUploadError("Image is larger than 12MB. Pick a smaller file.");
      return;
    }
    try {
      setUploading(true);
      const dataUrl = await compressImage(file);
      if (dataUrlBytes(dataUrl) > 4 * 1024 * 1024) {
        setUploadError("Compressed image is still too large to store. Try a simpler image.");
        return;
      }
      patchBg({ type: "image", imageUrl: dataUrl });
    } catch {
      setUploadError("Could not process that image.");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = () => {
    save();
    Swal.fire({
      title: "Landing page updated",
      text: "Your changes are now live on the public site.",
      icon: "success",
      timer: 1600,
      showConfirmButton: false,
      confirmButtonColor: "#fbbf24",
    });
  };

  const handleReset = async () => {
    const res = await Swal.fire({
      title: "Reset to default?",
      text: "This restores the original Golden Hearth landing design.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Reset",
      cancelButtonText: "Cancel",
    });
    if (res.isConfirmed) reset();
  };

  // Preview colors follow the *landing* base theme, not the portal theme.
  const previewDark = draft.baseTheme === "dark";
  const previewText = previewDark ? "#fafafa" : "#18181b";
  const previewMuted = previewDark ? "rgba(250,250,250,0.7)" : "rgba(24,24,27,0.65)";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent mb-1">
            Landing Studio
          </h1>
          <p className="text-gray-600 text-sm">
            Customize the public landing page — themes, backgrounds, and imagery. Changes apply live.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition text-sm font-medium"
          >
            <ExternalLink className="w-4 h-4" /> View site
          </a>
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition text-sm font-medium"
          >
            <RotateCcw className="w-4 h-4" /> Reset
          </button>
          <button
            onClick={handleSave}
            disabled={!dirty}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg font-semibold text-sm transition active:scale-95 ${
              dirty
                ? "bg-gradient-to-r from-yellow-400 to-yellow-500 text-black hover:shadow-lg"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}
          >
            {dirty ? <Save className="w-4 h-4" /> : <Check className="w-4 h-4" />}
            {dirty ? "Save & Publish" : "Saved"}
          </button>
        </div>
      </div>

      {/* Studio tab switcher */}
      <div className="inline-flex p-1 bg-gray-100 rounded-xl flex-wrap gap-1">
        {STUDIO_TABS.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
                active
                  ? "bg-white shadow text-gray-900"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          );
        })}
      </div>

      {(activeTab === "landing" || activeTab === "login") && (
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* ---------------- Controls ---------------- */}
        <div className="xl:col-span-3 space-y-6">
          {/* Presets — only shown on Landing tab */}
          {activeTab === "landing" && (
          <Card>
            <SectionTitle icon={Sparkles} title="Theme Presets" hint="One click applies a full look." />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {PRESETS.map((preset) => {
                const p = preset.config.background;
                const previewBg =
                  p.type === "gradient"
                    ? `linear-gradient(${p.gradientAngle}deg, ${p.gradientFrom}, ${p.gradientTo})`
                    : p.type === "solid"
                    ? p.color
                    : preset.config.baseTheme === "light"
                    ? "#f5f5f4"
                    : "#0b0b0f";
                return (
                  <button
                    key={preset.id}
                    onClick={() => apply(preset.config)}
                    className="group text-left rounded-xl border border-gray-200 overflow-hidden hover:border-yellow-400 hover:shadow-md transition"
                  >
                    <div className="h-14 w-full relative" style={{ background: previewBg }}>
                      <span
                        className="absolute bottom-2 right-2 w-4 h-4 rounded-full ring-2 ring-white/70"
                        style={{ background: preset.swatch }}
                      />
                    </div>
                    <div className="px-3 py-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-800 truncate">
                        {preset.name}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>
          )}

          {/* Login Page customization — only shown on Login tab */}
          {activeTab === "login" && (
          <>
          {/* Login Color Theme */}
          <Card>
            <SectionTitle icon={Palette} title="Login Theme" hint="Base mode and accent for the login page." />
            {/* Login base theme */}
            <div className="mb-5">
              <label className="block text-xs font-semibold text-gray-600 mb-2">Base Mode</label>
              <div className="inline-flex p-1 bg-gray-100 rounded-lg">
                {(["dark", "light"] as const).map((mode) => {
                  const active = draft.login.baseTheme === mode;
                  const Icon = mode === "dark" ? Moon : Sun;
                  return (
                    <button
                      key={mode}
                      onClick={() => patchLogin({ baseTheme: mode })}
                      className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium capitalize transition ${
                        active ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      <Icon className="w-4 h-4" /> {mode}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Login accent */}
            <label className="block text-xs font-semibold text-gray-600 mb-2">Accent Color</label>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {ACCENT_SWATCHES.map((c) => (
                <button
                  key={c}
                  onClick={() => patchLogin({ accent: c })}
                  className={`w-8 h-8 rounded-full transition hover:scale-110 ${
                    draft.login.accent.toLowerCase() === c.toLowerCase()
                      ? "ring-2 ring-offset-2 ring-gray-900"
                      : ""
                  }`}
                  style={{ background: c }}
                  aria-label={`Login accent ${c}`}
                />
              ))}
            </div>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={draft.login.accent}
                onChange={(e) => patchLogin({ accent: e.target.value })}
                className="w-10 h-10 rounded cursor-pointer border border-gray-200 bg-white p-0.5"
              />
              <input
                type="text"
                value={draft.login.accent}
                onChange={(e) => patchLogin({ accent: e.target.value })}
                className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-yellow-400 outline-none"
              />
            </div>
          </Card>
          </>
          )}

          {/* Base theme + accent — only shown on Landing tab */}
          {activeTab === "landing" && (
          <Card>
            <SectionTitle icon={Palette} title="Color Theme" hint="Base mode and accent color." />
            {/* Base theme toggle */}
            <div className="mb-5">
              <label className="block text-xs font-semibold text-gray-600 mb-2">Base Mode</label>
              <div className="inline-flex p-1 bg-gray-100 rounded-lg">
                {(["dark", "light"] as const).map((mode) => {
                  const active = draft.baseTheme === mode;
                  const Icon = mode === "dark" ? Moon : Sun;
                  return (
                    <button
                      key={mode}
                      onClick={() => patch({ baseTheme: mode })}
                      className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium capitalize transition ${
                        active ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      <Icon className="w-4 h-4" /> {mode}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Accent */}
            <label className="block text-xs font-semibold text-gray-600 mb-2">Accent Color</label>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {ACCENT_SWATCHES.map((c) => (
                <button
                  key={c}
                  onClick={() => patch({ accent: c })}
                  className={`w-8 h-8 rounded-full transition hover:scale-110 ${
                    draft.accent.toLowerCase() === c.toLowerCase()
                      ? "ring-2 ring-offset-2 ring-gray-900"
                      : ""
                  }`}
                  style={{ background: c }}
                  aria-label={`Accent ${c}`}
                />
              ))}
            </div>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={draft.accent}
                onChange={(e) => patch({ accent: e.target.value })}
                className="w-10 h-10 rounded cursor-pointer border border-gray-200 bg-white p-0.5"
              />
              <input
                type="text"
                value={draft.accent}
                onChange={(e) => patch({ accent: e.target.value })}
                className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-yellow-400 outline-none"
              />
            </div>
          </Card>
          )}

          {/* Background */}
          <Card>
            <SectionTitle icon={Paintbrush} title="Background" hint="Solid, gradient, or an uploaded image." />
            {/* Tabs */}
            <div className="grid grid-cols-4 gap-2 mb-5">
              {BG_TABS.map((t) => {
                const active = bg.type === t.id;
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    onClick={() => patchBg({ type: t.id })}
                    className={`flex flex-col items-center gap-1 py-3 rounded-lg border text-xs font-medium transition ${
                      active
                        ? "border-yellow-400 bg-yellow-50 text-yellow-700"
                        : "border-gray-200 text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    <Icon className="w-4 h-4" /> {t.label}
                  </button>
                );
              })}
            </div>

            {bg.type === "default" && (
              <p className="text-sm text-gray-500 bg-gray-50 rounded-lg p-4">
                Using the original hand-tuned Golden Hearth design. Pick another option to customize the background.
              </p>
            )}

            {bg.type === "solid" && (
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={bg.color}
                  onChange={(e) => patchBg({ color: e.target.value })}
                  className="w-12 h-12 rounded cursor-pointer border border-gray-200 bg-white p-0.5"
                />
                <input
                  type="text"
                  value={bg.color}
                  onChange={(e) => patchBg({ color: e.target.value })}
                  className="w-36 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-yellow-400 outline-none"
                />
              </div>
            )}

            {bg.type === "gradient" && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-6">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-2">From</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={bg.gradientFrom}
                        onChange={(e) => patchBg({ gradientFrom: e.target.value })}
                        className="w-10 h-10 rounded cursor-pointer border border-gray-200 bg-white p-0.5"
                      />
                      <span className="text-xs font-mono text-gray-500">{bg.gradientFrom}</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-2">To</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={bg.gradientTo}
                        onChange={(e) => patchBg({ gradientTo: e.target.value })}
                        className="w-10 h-10 rounded cursor-pointer border border-gray-200 bg-white p-0.5"
                      />
                      <span className="text-xs font-mono text-gray-500">{bg.gradientTo}</span>
                    </div>
                  </div>
                </div>
                <div>
                  <label className="flex items-center justify-between text-xs font-semibold text-gray-600 mb-2">
                    <span>Angle</span>
                    <span className="font-mono text-gray-400">{bg.gradientAngle}°</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    value={bg.gradientAngle}
                    onChange={(e) => patchBg({ gradientAngle: Number(e.target.value) })}
                    className="w-full accent-yellow-500"
                  />
                </div>
                <div
                  className="h-12 rounded-lg border border-gray-200"
                  style={{
                    background: `linear-gradient(${bg.gradientAngle}deg, ${bg.gradientFrom}, ${bg.gradientTo})`,
                  }}
                />
              </div>
            )}

            {bg.type === "image" && (
              <div className="space-y-4">
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    handleFiles(e.dataTransfer.files);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`relative rounded-xl border-2 border-dashed cursor-pointer transition overflow-hidden ${
                    dragOver ? "border-yellow-400 bg-yellow-50" : "border-gray-300 hover:border-gray-400"
                  }`}
                >
                  {bg.imageUrl ? (
                    <div className="relative h-40">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={bg.imageUrl}
                        alt="Background preview"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/30 opacity-0 hover:opacity-100 transition flex items-center justify-center text-white text-sm font-medium">
                        <Upload className="w-4 h-4 mr-2" /> Replace image
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-10 text-gray-500">
                      <Upload className="w-8 h-8 mb-2" />
                      <p className="text-sm font-medium">
                        {uploading ? "Processing…" : "Drop an image or click to upload"}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">JPG or PNG · auto-compressed</p>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleFiles(e.target.files)}
                  />
                </div>

                {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}

                {bg.imageUrl && (
                  <>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>Stored size ≈ {(dataUrlBytes(bg.imageUrl) / 1024).toFixed(0)} KB</span>
                      <button
                        onClick={() => patchBg({ imageUrl: "" })}
                        className="flex items-center gap-1 text-red-500 hover:text-red-600 font-medium"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Remove
                      </button>
                    </div>

                    <div>
                      <label className="flex items-center justify-between text-xs font-semibold text-gray-600 mb-2">
                        <span>Darken overlay</span>
                        <span className="font-mono text-gray-400">{Math.round(bg.overlay * 100)}%</span>
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(bg.overlay * 100)}
                        onChange={(e) => patchBg({ overlay: Number(e.target.value) / 100 })}
                        className="w-full accent-yellow-500"
                      />
                    </div>
                    <div>
                      <label className="flex items-center justify-between text-xs font-semibold text-gray-600 mb-2">
                        <span>Blur</span>
                        <span className="font-mono text-gray-400">{bg.blur}px</span>
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={24}
                        value={bg.blur}
                        onChange={(e) => patchBg({ blur: Number(e.target.value) })}
                        className="w-full accent-yellow-500"
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* ---------------- Live Preview ---------------- */}
        <div className="xl:col-span-2">
          <div className="xl:sticky xl:top-6 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900">Live Preview</h2>
              <span className="text-xs text-gray-400">
                {activeTab === "login" ? "Login page" : "Landing hero"}
              </span>
            </div>
            <div className="relative rounded-2xl overflow-hidden border border-gray-200 shadow-lg aspect-[4/5] sm:aspect-video xl:aspect-[3/4]">
              {/* Background layers mirror LandingBackground */}
              {bg.type === "default" ? (
                <div className="absolute inset-0" style={{ background: previewDark ? "#09090b" : "#fafafa" }} />
              ) : (
                <>
                  <div className="absolute inset-0" style={backgroundStyle(bg)} />
                  {bg.overlay > 0 && (
                    <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${bg.overlay})` }} />
                  )}
                </>
              )}

              {/* Preview content — changes based on active tab */}
              {activeTab === "login" ? (() => {
                const isDk = draft.login.baseTheme === "dark";
                const acnt = draft.login.accent;
                const fg = isDk ? "#fafafa" : "#18181b";
                const muted = isDk ? "#a1a1aa" : "#71717a";

                return (
                <div className="relative h-full w-full">
                  {/* BG image overlay — matches actual login page gradient */}
                  <div className="absolute inset-0" style={{
                    background: isDk
                      ? "linear-gradient(to top right, rgba(9,9,11,0.95), rgba(9,9,11,0.80), rgba(120,53,15,0.40))"
                      : "linear-gradient(to top right, rgba(255,255,255,0.95), rgba(255,255,255,0.80), rgba(255,251,235,0.40))",
                  }} />

                  {/* Top-left: ← Back Home */}
                  <div className="absolute top-2.5 left-3 z-20 flex items-center gap-0.5">
                    <span className="text-[5px]" style={{ color: muted }}>← Back Home</span>
                  </div>
                  {/* Top-right: Theme toggle */}
                  <div className="absolute top-2.5 right-3 z-20">
                    <div className="w-4 h-4 rounded-lg flex items-center justify-center" style={{
                      background: isDk ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)",
                      border: `1px solid ${isDk ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)"}`,
                    }}>
                      <div className="w-2 h-2 rounded-sm" style={{ background: acnt }} />
                    </div>
                  </div>

                  {/* ═══ Centered glass-panel card ═══ */}
                  <div className="absolute inset-0 flex items-center justify-center px-3 py-8">
                    <div className="w-full rounded-2xl overflow-hidden grid grid-cols-2 p-0.5" style={{
                      background: isDk ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.65)",
                      border: `1px solid ${isDk ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)"}`,
                      backdropFilter: "blur(16px)",
                      boxShadow: isDk
                        ? "0 16px 48px rgba(0,0,0,0.6)"
                        : "0 16px 48px rgba(0,0,0,0.08)",
                    }}>

                      {/* ── LEFT: Branding ── */}
                      <div className="rounded-xl relative overflow-hidden p-4 flex flex-col justify-between" style={{
                        background: "linear-gradient(to bottom right, #18181b, #1c1917, rgba(120,53,15,0.20))",
                      }}>
                        {/* Glow orbs */}
                        <div className="absolute -top-6 -left-6 w-20 h-20 rounded-full blur-3xl pointer-events-none" style={{ background: `${acnt}12` }} />
                        <div className="absolute -bottom-6 -right-6 w-20 h-20 rounded-full blur-3xl pointer-events-none" style={{ background: `${acnt}08` }} />

                        {/* Content top */}
                        <div className="relative z-10">
                          {/* Logo row */}
                          <div className="flex items-center gap-1 mb-4">
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke={acnt} strokeWidth="2">
                              <circle cx="12" cy="12" r="3" fill={`${acnt}20`} />
                              <path d="M12 5V9M12 15V19M5 12H9M15 12H19" strokeLinecap="round" />
                            </svg>
                            <span className="text-[7px] font-bold text-white tracking-tight">Golden Hearth</span>
                          </div>

                          {/* Heading */}
                          <p className="text-[13px] font-extrabold text-white leading-[1.15] tracking-tight">Empathetic Care,</p>
                          <p className="text-[13px] font-light leading-[1.15] tracking-tight" style={{ color: acnt }}>AI Assisted Efficiency.</p>
                          <p className="text-[5px] text-zinc-400 font-light mt-2 leading-relaxed max-w-[95%]">
                            Bypass email and password checks. Golden Hearth enables direct preview access to dashboards for nurses, caregivers, admins, and family members.
                          </p>

                          {/* Feature cards — matching actual page spacing */}
                          <div className="space-y-3 mt-4">
                            {[
                              { name: "Optical Matrix Fall Detection", sub: "Real-time edge computer vision logs alerts." },
                              { name: "AI Voice Charting Assistant", sub: "Parse telemetry values and log records." },
                              { name: "Secure Family Dashboards", sub: "Transparent real-time updates and invoices." },
                            ].map((feat) => (
                              <div key={feat.name} className="flex items-start gap-2">
                                <div className="w-4 h-4 rounded shrink-0 mt-0.5 flex items-center justify-center" style={{
                                  background: "rgba(255,255,255,0.05)",
                                  border: "1px solid rgba(255,255,255,0.10)",
                                }}>
                                  <div className="w-1.5 h-1.5 rounded-sm" style={{ background: acnt }} />
                                </div>
                                <div>
                                  <p className="text-[5.5px] font-semibold text-white leading-tight">{feat.name}</p>
                                  <p className="text-[4.5px] text-zinc-500 font-light leading-tight mt-0.5">{feat.sub}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Copyright */}
                        <div className="relative z-10 text-[4.5px] text-zinc-600 border-t border-white/5 pt-2 mt-3">
                          © 2026 Golden Hearth AI. Simulated Walkthrough Mode Active.
                        </div>
                      </div>

                      {/* ── RIGHT: Gate Entry form ── */}
                      <div className="flex flex-col justify-center px-4 py-3">
                        <div className="max-w-full">
                          {/* Section heading */}
                          <div className="mb-4">
                            <p className="text-[13px] font-bold tracking-tight leading-tight" style={{ color: fg }}>Gate Entry</p>
                            <p className="text-[5.5px] font-light mt-1" style={{ color: muted }}>
                              Select a role below to access the workspace sandbox.
                            </p>
                          </div>

                          {/* Label */}
                          <p className="text-[4px] font-semibold uppercase tracking-widest mb-1" style={{ color: muted }}>User Role Bypass</p>

                          {/* Dropdown button */}
                          <div className="rounded-xl px-2 py-2 mb-4 flex items-center justify-between cursor-pointer" style={{
                            background: isDk ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)",
                            border: `1px solid ${isDk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
                          }}>
                            <div className="flex items-center gap-1.5">
                              <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke={acnt} strokeWidth="2.5">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                <circle cx="12" cy="7" r="4" />
                              </svg>
                              <div>
                                <p className="text-[6px] font-semibold leading-none" style={{ color: fg }}>Nurse</p>
                                <p className="text-[4.5px] mt-0.5" style={{ color: muted }}>Floor Operations · Primary Care</p>
                              </div>
                            </div>
                            <svg className="w-2 h-2" viewBox="0 0 24 24" fill="none" stroke={muted} strokeWidth="2.5">
                              <path d="M6 9l6 6 6-6" />
                            </svg>
                          </div>

                          {/* CTA */}
                          <div className="w-full py-2 rounded-xl flex items-center justify-center gap-1 text-[7px] font-bold cursor-pointer" style={{
                            background: fg,
                            color: isDk ? "#09090b" : "#ffffff",
                            boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
                          }}>
                            Demo Log In
                            <svg className="w-2 h-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                              <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
                            </svg>
                          </div>
                        </div>
                      </div>

                    </div>
                  </div>
                </div>
                );
              })() : (
                /* Landing hero preview */
                <div className="relative h-full flex flex-col items-center justify-center text-center px-6">
                  <span
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-5 backdrop-blur-md"
                    style={{
                      color: previewText,
                      background: previewDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                      border: `1px solid ${previewDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)"}`,
                    }}
                  >
                    <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: draft.accent }} />
                    Next-Gen Wellness Platform
                  </span>
                  <h3 className="text-3xl md:text-4xl font-black tracking-tighter mb-3" style={{ color: previewText }}>
                    Care Redefined.
                  </h3>
                  <p className="text-sm max-w-xs mb-6" style={{ color: previewMuted }}>
                    A cinematic, minimalist approach to elder care management.
                  </p>
                  <div className="flex gap-3">
                    <span
                      className="px-5 py-2.5 rounded-xl text-sm font-semibold shadow-lg"
                      style={{ background: draft.accent, color: previewDark ? "#0b0b0f" : "#ffffff" }}
                    >
                      Get Started
                    </span>
                    <span
                      className="px-5 py-2.5 rounded-xl text-sm font-medium backdrop-blur-md"
                      style={{
                        color: previewText,
                        border: `1px solid ${previewDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)"}`,
                      }}
                    >
                      Log In
                    </span>
                  </div>
                </div>
              )}
            </div>
            <p className="text-xs text-gray-400 text-center">
              {activeTab === "login"
                ? "Template, accent, and background update in real time."
                : "Accent, base mode, and background update in real time."
              }
            </p>
          </div>
        </div>
      </div>
      )}

      {/* ═══ Content Tab ═══ */}
      {activeTab === "content" && <SiteContentEditor />}

      {/* ═══ Blog Tab ═══ */}
      {activeTab === "blog" && <BlogManager />}

      {/* ═══ Pages Tab ═══ */}
      {activeTab === "pages" && <PagesManager />}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 * SITE CONTENT EDITOR — Editable jargon / copy for the landing page
 * ════════════════════════════════════════════════════════════════════════════ */

const FALLBACKS: Record<string, string> = {
  hero_title: "Care Redefined.",
  hero_subtitle: "For Peaceful Living.",
  hero_description: "A cinematic, minimalist approach to elder care management. Equipped with Real-Time Optical Safety Matrices and friendly, responsive voice assistants. Engineered for deep empathy and supreme operational efficiency.",
  feature_1_title: "Optical Matrix",
  feature_1_desc: "Real-time edge-computed anomaly and fall detection ensuring absolute resident safety.",
  feature_2_title: "Voice Assistant",
  feature_2_desc: "Low-latency conversational AI for hands-free charting and friendly companionship.",
  feature_3_title: "Secure Family Portal",
  feature_3_desc: "Private health logs and vitals synced in real-time with family dashboards.",
  contact_address: "123 Golden Hearth Lane,\nBonifacio Global City, Taguig,\nMetro Manila, Philippines",
  contact_phone: "+63 (2) 8888-7777",
  contact_email: "concierge@goldenhearth.com",
  contact_map_url: "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3861.9701041113264!2d121.0494499!3d14.5484443!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3397c8eb3c7849bd%3A0xc34b3e83b8a3e746!2sBonifacio%20Global%20City!5e0!3m2!1sen!2sph!4v1720610000000!5m2!1sen!2sph",
  footer_text: "© 2026 AI Powered Assisted Living. All rights reserved.",
};

function SiteContentEditor() {
  const { data: rows, refetch } = useLiveQuery<SiteContentRow>("site-content", {
    tables: ["SiteContent"],
  });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Set<string>>(new Set());

  // Populate edit state from loaded rows
  useEffect(() => {
    const map: Record<string, string> = {};
    for (const r of rows) map[r.id] = r.value;
    setEdits((prev) => {
      const merged = { ...prev };
      for (const [k, v] of Object.entries(map)) {
        if (!(k in merged)) merged[k] = v;
      }
      return merged;
    });
  }, [rows]);

  const handleSave = async (fieldId: string) => {
    setSaving((s) => new Set(s).add(fieldId));
    try {
      const val = edits[fieldId] ?? rows.find((r) => r.id === fieldId)?.value ?? FALLBACKS[fieldId] ?? "";
      const existing = rows.find((r) => r.id === fieldId);
      if (existing) {
        await updateRecord("site-content", fieldId, { value: val });
      } else {
        await createRecord("site-content", { id: fieldId, value: val });
      }
      await refetch();
      Swal.fire({ title: "Saved", icon: "success", timer: 1000, showConfirmButton: false });
    } catch {
      Swal.fire({ title: "Error", text: "Failed to save content", icon: "error" });
    } finally {
      setSaving((s) => { const n = new Set(s); n.delete(fieldId); return n; });
    }
  };

  const handleSaveAll = async () => {
    setSaving(new Set(CONTENT_FIELDS.map((f) => f.id)));
    try {
      for (const field of CONTENT_FIELDS) {
        const val = edits[field.id] ?? rows.find((r) => r.id === field.id)?.value ?? FALLBACKS[field.id] ?? "";
        const existing = rows.find((r) => r.id === field.id);
        if (existing) {
          await updateRecord("site-content", field.id, { value: val });
        } else {
          await createRecord("site-content", { id: field.id, value: val });
        }
      }
      await refetch();
      Swal.fire({ title: "All content saved!", icon: "success", timer: 1200, showConfirmButton: false });
    } catch {
      Swal.fire({ title: "Error", text: "Failed to save some content", icon: "error" });
    } finally {
      setSaving(new Set());
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Site Content Editor</h2>
          <p className="text-sm text-gray-500">Edit all text content displayed on the public landing page.</p>
        </div>
        <button onClick={handleSaveAll} className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">
          <Save className="w-4 h-4" /> Save All
        </button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {CONTENT_FIELDS.map((field) => {
          const currentVal = edits[field.id] ?? rows.find((r) => r.id === field.id)?.value ?? FALLBACKS[field.id] ?? "";
          const isSaving = saving.has(field.id);
          return (
            <div key={field.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">{field.label}</label>
              {field.multiline ? (
                <textarea
                  value={currentVal}
                  onChange={(e) => setEdits((p) => ({ ...p, [field.id]: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none resize-y bg-gray-50 text-gray-900"
                />
              ) : (
                <input
                  type="text"
                  value={currentVal}
                  onChange={(e) => setEdits((p) => ({ ...p, [field.id]: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none bg-gray-50 text-gray-900"
                />
              )}
              <button
                onClick={() => handleSave(field.id)}
                disabled={isSaving}
                className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold hover:bg-blue-100 transition disabled:opacity-50"
              >
                {isSaving ? "Saving…" : "Save"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 * BLOG MANAGER — Full CRUD for blog posts with image upload
 * ════════════════════════════════════════════════════════════════════════════ */

const emptyBlog = (): Omit<BlogPost, "id"> => ({
  title: "",
  description: "",
  content: "",
  imageUrl: "",
  author: "System Admin",
  publishedAt: new Date().toISOString().split("T")[0],
  published: true,
});

function BlogManager() {
  const { data: posts, refetch } = useLiveQuery<BlogPost>("blog-posts", {
    tables: ["BlogPost"],
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyBlog());
  const [imgUploading, setImgUploading] = useState(false);
  const blogFileRef = useRef<HTMLInputElement>(null);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyBlog());
    setModalOpen(true);
  };

  const openEdit = (p: BlogPost) => {
    setEditingId(p.id);
    setForm({
      title: p.title,
      description: p.description,
      content: p.content || "",
      imageUrl: p.imageUrl || "",
      author: p.author,
      publishedAt: p.publishedAt ? p.publishedAt.split("T")[0] : new Date().toISOString().split("T")[0],
      published: p.published,
    });
    setModalOpen(true);
  };

  const handleImageUpload = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setImgUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "blog");
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setForm((f) => ({ ...f, imageUrl: json.url }));
    } catch {
      Swal.fire({ title: "Upload Failed", icon: "error" });
    } finally {
      setImgUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      Swal.fire({ title: "Title required", icon: "warning" });
      return;
    }
    try {
      const payload = {
        ...form,
        publishedAt: new Date(form.publishedAt).toISOString(),
      };
      if (editingId) {
        await updateRecord("blog-posts", editingId, payload);
      } else {
        await createRecord("blog-posts", payload);
      }
      await refetch();
      setModalOpen(false);
      Swal.fire({ title: editingId ? "Post updated" : "Post created", icon: "success", timer: 1200, showConfirmButton: false });
    } catch {
      Swal.fire({ title: "Error", text: "Failed to save blog post", icon: "error" });
    }
  };

  const handleDelete = async (id: string) => {
    const r = await Swal.fire({
      title: "Delete post?",
      text: "This cannot be undone.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      confirmButtonText: "Delete",
    });
    if (r.isConfirmed) {
      await deleteRecord("blog-posts", id);
      await refetch();
      Swal.fire({ title: "Deleted", icon: "success", timer: 1000, showConfirmButton: false });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Blog Posts</h2>
          <p className="text-sm text-gray-500">Create and manage blog posts displayed on the landing page.</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">
          <Plus className="w-4 h-4" /> New Post
        </button>
      </div>

      {/* Posts grid */}
      {posts.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Newspaper className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 font-medium">No blog posts yet</p>
          <p className="text-sm text-gray-400">Click "New Post" to create your first article.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {posts.map((p) => (
            <div key={p.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-lg hover:border-yellow-300 transition flex flex-col">
              {p.imageUrl && (
                <div className="h-40 bg-gray-100 relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.imageUrl} alt={p.title} className="w-full h-full object-cover" />
                  {!p.published && (
                    <span className="absolute top-2 right-2 px-2 py-1 bg-gray-900/80 text-white text-xs rounded-full font-semibold">Draft</span>
                  )}
                </div>
              )}
              <div className="p-4 flex-1 flex flex-col">
                <h3 className="font-bold text-gray-900 mb-1 line-clamp-2">{p.title}</h3>
                <p className="text-sm text-gray-600 mb-3 line-clamp-2 flex-1">{p.description}</p>
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
                  <User className="w-3 h-3" /> {p.author}
                  <span className="text-gray-300">•</span>
                  <Calendar className="w-3 h-3" /> {new Date(p.publishedAt).toLocaleDateString()}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => openEdit(p)} className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold hover:bg-blue-100 transition">
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                  <button onClick={() => handleDelete(p.id)} className="flex items-center justify-center gap-1 px-3 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-semibold hover:bg-red-100 transition">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Blog modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
              <h3 className="text-lg font-bold text-gray-900">{editingId ? "Edit Post" : "New Blog Post"}</h3>
              <button onClick={() => setModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-lg transition">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-6 space-y-5">
              {/* Image upload */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Cover Image</label>
                <div
                  onClick={() => blogFileRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-yellow-400 transition overflow-hidden"
                >
                  {form.imageUrl ? (
                    <div className="relative h-48">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={form.imageUrl} alt="Cover" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/30 opacity-0 hover:opacity-100 transition flex items-center justify-center text-white text-sm font-medium">
                        <Upload className="w-4 h-4 mr-2" /> Replace
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                      <Upload className="w-8 h-8 mb-2" />
                      <p className="text-sm">{imgUploading ? "Uploading…" : "Click to upload cover image"}</p>
                    </div>
                  )}
                </div>
                <input ref={blogFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e.target.files)} />
              </div>

              {/* Title */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Title *</label>
                <input type="text" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Blog post title…" className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none text-gray-900" />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Description / Excerpt</label>
                <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} placeholder="Short summary shown on cards…" className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none resize-y text-gray-900" />
              </div>

              {/* Content */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Full Content (Markdown)</label>
                <textarea value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} rows={8} placeholder="Write your article content here…\n\n## Supports Markdown" className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none resize-y font-mono text-sm text-gray-900" />
              </div>

              {/* Author + Date row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Author</label>
                  <input type="text" value={form.author} onChange={(e) => setForm((f) => ({ ...f, author: e.target.value }))} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none text-gray-900" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Publish Date</label>
                  <input type="date" value={typeof form.publishedAt === 'string' ? form.publishedAt.split('T')[0] : ''} onChange={(e) => setForm((f) => ({ ...f, publishedAt: e.target.value }))} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none text-gray-900" />
                </div>
              </div>

              {/* Published toggle */}
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input type="checkbox" checked={form.published} onChange={(e) => setForm((f) => ({ ...f, published: e.target.checked }))} className="w-5 h-5 rounded" />
                <span className="font-semibold text-gray-700">Published</span>
                <span className="text-xs text-gray-400">{form.published ? "Visible on landing page" : "Draft — hidden from public"}</span>
              </label>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
              <button onClick={() => setModalOpen(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium">Cancel</button>
              <button onClick={handleSubmit} className="px-6 py-2 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95">
                {editingId ? "Update Post" : "Publish Post"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 * PAGES MANAGER — Custom navigation pages for the landing site
 * ════════════════════════════════════════════════════════════════════════════ */

const PAGE_TEMPLATES = [
  {
    id: "about",
    name: "About Us",
    description: "Organization overview and mission",
    content: "# About Us\n\nTell your story here. Share your mission, vision, and values.\n\n## Our Mission\nDescribe what drives your organization.\n\n## Our Values\nHighlight what matters most.",
    purpose: "informational",
    parcelType: "standard",
  },
  {
    id: "services",
    name: "Services",
    description: "List of services offered",
    content: "# Our Services\n\n## Service 1\nDescription of your first service.\n\n## Service 2\nDescription of your second service.\n\n## Service 3\nDescription of your third service.",
    purpose: "marketing",
    parcelType: "service",
  },
  {
    id: "careers",
    name: "Careers",
    description: "Join our team",
    content: "# Join Our Team\n\nWe're looking for talented individuals to join our growing organization.\n\n## Open Positions\n- Position 1\n- Position 2\n- Position 3\n\nApply now at careers@example.com",
    purpose: "recruitment",
    parcelType: "careers",
  },
  {
    id: "faq",
    name: "FAQ",
    description: "Frequently asked questions",
    content: "# Frequently Asked Questions\n\n## Question 1?\nProvide a helpful answer here.\n\n## Question 2?\nAddress common concerns.\n\n## Question 3?\nOffer clear guidance.",
    purpose: "support",
    parcelType: "standard",
  },
  {
    id: "privacy",
    name: "Privacy Policy",
    description: "Privacy and data protection",
    content: "# Privacy Policy\n\nLast updated: [Date]\n\n## Introduction\nWe are committed to protecting your privacy.\n\n## Data Collection\nWe collect information to provide better services.\n\n## Your Rights\nYou have the right to access and control your data.",
    purpose: "legal",
    parcelType: "compliance",
  },
  {
    id: "contact",
    name: "Contact Us",
    description: "Get in touch",
    content: "# Contact Us\n\nWe'd love to hear from you.\n\n## Reach Out\n**Email:** contact@example.com\n**Phone:** +1 (555) 123-4567\n**Address:** Your location here",
    purpose: "contact",
    parcelType: "standard",
  },
];

const PURPOSE_OPTIONS = ["informational", "marketing", "recruitment", "support", "legal", "contact", "educational"];
const PARCEL_TYPES = ["standard", "service", "careers", "compliance", "promotional", "news"];

const emptyPage = (): Omit<CustomPageRow, "id"> => ({
  title: "",
  slug: "",
  content: "",
  published: true,
  sortOrder: 0,
  description: "",
  imageUrl: "",
  pagePurpose: "informational",
  parcelType: "standard",
});

function PagesManager() {
  const { data: pages, refetch } = useLiveQuery<CustomPageRow>("custom-pages", {
    tables: ["CustomPage"],
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [showTemplates, setShowTemplates] = useState(!modalOpen);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyPage());
  const [imgUploading, setImgUploading] = useState(false);
  const pageFileRef = useRef<HTMLInputElement>(null);

  const slugify = (text: string) =>
    text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyPage());
    setShowTemplates(true);
    setModalOpen(true);
  };

  const openEdit = (p: CustomPageRow) => {
    setEditingId(p.id);
    setForm({
      title: p.title,
      slug: p.slug,
      content: p.content,
      published: p.published,
      sortOrder: p.sortOrder,
      description: p.description || "",
      imageUrl: p.imageUrl || "",
      pagePurpose: p.pagePurpose || "informational",
      parcelType: p.parcelType || "standard",
    });
    setShowTemplates(false);
    setModalOpen(true);
  };

  const applyTemplate = (template: typeof PAGE_TEMPLATES[0]) => {
    setForm({
      title: template.name,
      slug: slugify(template.name),
      content: template.content,
      published: true,
      sortOrder: pages.length,
      description: template.description,
      imageUrl: "",
      pagePurpose: template.purpose,
      parcelType: template.parcelType,
    });
    setShowTemplates(false);
  };

  const handleImageUpload = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setImgUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "pages");
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setForm((f) => ({ ...f, imageUrl: json.url }));
    } catch {
      Swal.fire({ title: "Upload Failed", icon: "error" });
    } finally {
      setImgUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      Swal.fire({ title: "Title required", icon: "warning" });
      return;
    }
    const slug = form.slug || slugify(form.title);
    try {
      const payload = { ...form, slug };
      if (editingId) {
        await updateRecord("custom-pages", editingId, payload);
      } else {
        await createRecord("custom-pages", payload);
      }
      await refetch();
      setModalOpen(false);
      Swal.fire({ title: editingId ? "Page updated" : "Page created", icon: "success", timer: 1200, showConfirmButton: false });
    } catch {
      Swal.fire({ title: "Error", text: "Failed to save page", icon: "error" });
    }
  };

  const handleDelete = async (id: string) => {
    const r = await Swal.fire({
      title: "Delete page?",
      text: "This removes it from the navigation.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      confirmButtonText: "Delete",
    });
    if (r.isConfirmed) {
      await deleteRecord("custom-pages", id);
      await refetch();
      Swal.fire({ title: "Deleted", icon: "success", timer: 1000, showConfirmButton: false });
    }
  };

  const togglePublished = async (p: CustomPageRow) => {
    await updateRecord("custom-pages", p.id, { published: !p.published });
    await refetch();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Custom Pages</h2>
          <p className="text-sm text-gray-500">Add pages to the landing page navigation. Published pages appear in the navbar.</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">
          <Plus className="w-4 h-4" /> Add Page
        </button>
      </div>

      {pages.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <FilePlus className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 font-medium">No custom pages yet</p>
          <p className="text-sm text-gray-400">Click "Add Page" to create a new navigation page.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pages.map((p) => (
            <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-start gap-4 hover:shadow-md hover:border-yellow-300 transition">
              <GripVertical className="w-5 h-5 text-gray-300 flex-shrink-0 mt-1" />
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-gray-900 truncate">{p.title}</h3>
                {p.description && <p className="text-sm text-gray-600 truncate">{p.description}</p>}
                <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                  <span className="px-2 py-1 bg-gray-100 rounded">/page/{p.slug}</span>
                  {p.pagePurpose && <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded">{p.pagePurpose}</span>}
                  {p.parcelType && <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded">{p.parcelType}</span>}
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                p.published ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
              }`}>
                {p.published ? "Published" : "Draft"}
              </span>
              <button onClick={() => togglePublished(p)} className="p-2 hover:bg-gray-100 rounded-lg transition" title={p.published ? "Unpublish" : "Publish"}>
                {p.published ? <Eye className="w-4 h-4 text-green-600" /> : <EyeOff className="w-4 h-4 text-gray-400" />}
              </button>
              <button onClick={() => openEdit(p)} className="p-2 hover:bg-blue-50 rounded-lg transition">
                <Pencil className="w-4 h-4 text-blue-600" />
              </button>
              <button onClick={() => handleDelete(p.id)} className="p-2 hover:bg-red-50 rounded-lg transition">
                <Trash2 className="w-4 h-4 text-red-500" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Page modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
              <h3 className="text-lg font-bold text-gray-900">{editingId ? "Edit Page" : showTemplates ? "Choose Template" : "New Page"}</h3>
              <button onClick={() => setModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-lg transition">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {showTemplates && !editingId ? (
              <div className="p-6 space-y-6">
                <div>
                  <h4 className="font-semibold text-gray-900 mb-4">Select a template to get started, or start from scratch.</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    {PAGE_TEMPLATES.map((template) => (
                      <button
                        key={template.id}
                        onClick={() => applyTemplate(template)}
                        className="text-left p-4 border border-gray-200 rounded-xl hover:border-yellow-400 hover:shadow-md transition group"
                      >
                        <h5 className="font-semibold text-gray-900 group-hover:text-yellow-600 transition">{template.name}</h5>
                        <p className="text-sm text-gray-600">{template.description}</p>
                        <div className="flex items-center gap-2 mt-2 text-xs">
                          <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded">{template.purpose}</span>
                          <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded">{template.parcelType}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setShowTemplates(false)}
                    className="w-full px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium transition"
                  >
                    Create Blank Page
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-6 space-y-5">
                {!editingId && (
                  <button
                    onClick={() => setShowTemplates(true)}
                    className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
                  >
                    ← Back to templates
                  </button>
                )}

                {/* Page Image */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Featured Image (optional)</label>
                  <div
                    onClick={() => pageFileRef.current?.click()}
                    className="border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-yellow-400 transition overflow-hidden"
                  >
                    {form.imageUrl ? (
                      <div className="relative h-40">
                        <img src={form.imageUrl} alt="Featured" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/30 opacity-0 hover:opacity-100 transition flex items-center justify-center text-white text-sm font-medium">
                          <Upload className="w-4 h-4 mr-2" /> Replace
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                        <ImageIcon className="w-8 h-8 mb-2" />
                        <p className="text-sm">{imgUploading ? "Uploading…" : "Click to upload featured image"}</p>
                      </div>
                    )}
                  </div>
                  {form.imageUrl && (
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, imageUrl: "" }))}
                      className="mt-2 text-xs text-red-500 hover:text-red-600 font-medium"
                    >
                      Remove image
                    </button>
                  )}
                  <input ref={pageFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e.target.files)} />
                </div>

                {/* Page Title */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Page Title *</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => {
                      const title = e.target.value;
                      setForm((f) => ({ ...f, title, slug: editingId ? f.slug : slugify(title) }));
                    }}
                    placeholder="e.g. About Us, Careers, FAQ…"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none text-gray-900"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Page Description</label>
                  <textarea
                    value={form.description || ""}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    rows={2}
                    placeholder="Brief description of this page's purpose…"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none resize-y text-gray-900"
                  />
                </div>

                {/* URL Slug */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">URL Slug</label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-400">/page/</span>
                    <input
                      type="text"
                      value={form.slug}
                      onChange={(e) => setForm((f) => ({ ...f, slug: slugify(e.target.value) }))}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none font-mono text-gray-900"
                    />
                  </div>
                </div>

                {/* Page Purpose and Parcel Type */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Page Purpose</label>
                    <select
                      value={form.pagePurpose || "informational"}
                      onChange={(e) => setForm((f) => ({ ...f, pagePurpose: e.target.value }))}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none text-gray-900"
                    >
                      <option value="">Select purpose…</option>
                      {PURPOSE_OPTIONS.map((purpose) => (
                        <option key={purpose} value={purpose}>
                          {purpose.charAt(0).toUpperCase() + purpose.slice(1)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Content Type / Parcel</label>
                    <select
                      value={form.parcelType || "standard"}
                      onChange={(e) => setForm((f) => ({ ...f, parcelType: e.target.value }))}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none text-gray-900"
                    >
                      <option value="">Select type…</option>
                      {PARCEL_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type.charAt(0).toUpperCase() + type.slice(1)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Page Content */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Content (Markdown)</label>
                  <textarea
                    value={form.content}
                    onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                    rows={12}
                    placeholder="# Page Title\n\nYour page content here…\n\n## Section Heading"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none resize-y font-mono text-sm text-gray-900"
                  />
                </div>

                {/* Sort Order and Published */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Sort Order</label>
                    <input
                      type="number"
                      value={form.sortOrder}
                      onChange={(e) => setForm((f) => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none text-gray-900"
                    />
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-3 cursor-pointer select-none pb-3">
                      <input type="checkbox" checked={form.published} onChange={(e) => setForm((f) => ({ ...f, published: e.target.checked }))} className="w-5 h-5 rounded" />
                      <span className="font-semibold text-gray-700">Published</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {!showTemplates || editingId ? (
              <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
                <button onClick={() => setModalOpen(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium">Cancel</button>
                <button onClick={handleSubmit} className="px-6 py-2 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95">
                  {editingId ? "Update Page" : "Create Page"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
