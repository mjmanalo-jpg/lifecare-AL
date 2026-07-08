"use client";

import { useRef, useState } from "react";
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
} from "lucide-react";
import Swal from "sweetalert2";
import {
  useLandingDraft,
  backgroundStyle,
  compressImage,
  PRESETS,
  type BackgroundType,
} from "@/lib/landingConfig";

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

  const bg = draft.background;

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
      patchBackground({ type: "image", imageUrl: dataUrl });
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

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* ---------------- Controls ---------------- */}
        <div className="xl:col-span-3 space-y-6">
          {/* Presets */}
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

          {/* Base theme + accent */}
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
                    onClick={() => patchBackground({ type: t.id })}
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
                  onChange={(e) => patchBackground({ color: e.target.value })}
                  className="w-12 h-12 rounded cursor-pointer border border-gray-200 bg-white p-0.5"
                />
                <input
                  type="text"
                  value={bg.color}
                  onChange={(e) => patchBackground({ color: e.target.value })}
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
                        onChange={(e) => patchBackground({ gradientFrom: e.target.value })}
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
                        onChange={(e) => patchBackground({ gradientTo: e.target.value })}
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
                    onChange={(e) => patchBackground({ gradientAngle: Number(e.target.value) })}
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
                        onClick={() => patchBackground({ imageUrl: "" })}
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
                        onChange={(e) => patchBackground({ overlay: Number(e.target.value) / 100 })}
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
                        onChange={(e) => patchBackground({ blur: Number(e.target.value) })}
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
              <span className="text-xs text-gray-400">Landing hero</span>
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

              {/* Hero content */}
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
            </div>
            <p className="text-xs text-gray-400 text-center">
              Accent, base mode, and background update in real time.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
