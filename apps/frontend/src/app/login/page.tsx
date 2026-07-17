"use client";

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck,
  Activity,
  Mic,
  ArrowLeft,
  Moon,
  Sun,
  Loader,
  Mail,
  Lock,
  Eye,
  EyeOff,
  LogIn,
} from "lucide-react";
import Link from "next/link";
import LcmsLogo from "@/components/LcmsLogo";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useLiveLandingConfig, backgroundStyle } from "@/lib/landingConfig";

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : null;
}

function accentRgba(hex: string, opacity: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(245,158,11,${opacity})`;
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${opacity})`;
}

export default function LoginPage() {
  const router = useRouter();
  const config = useLiveLandingConfig();
  const loginConfig = config.login;
  const accent = loginConfig.accent;
  const loginBg = loginConfig.background;

  // ── Email/password state ──
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // ── Shared state ──
  const [theme, setTheme] = useState<"dark" | "light">(loginConfig.baseTheme);
  const [mounted, setMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    const savedTheme = localStorage.getItem("theme") as "dark" | "light" | null;
    const initialTheme = savedTheme || loginConfig.baseTheme;
    setTheme(initialTheme);
  }, [loginConfig.baseTheme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--lp-accent", accent);
    document.documentElement.style.setProperty("--lp-accent-10", `${accent}1a`);
    document.documentElement.style.setProperty("--lp-accent-20", `${accent}33`);
    document.documentElement.style.setProperty("--lp-accent-30", `${accent}4d`);
    document.documentElement.style.setProperty("--lp-accent-80", `${accent}cc`);
  }, [accent]);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    localStorage.setItem("theme", nextTheme);
    if (nextTheme === "light") {
      document.documentElement.classList.add("light");
    } else {
      document.documentElement.classList.remove("light");
    }
  };

  // ── Email/password login ──
  const handleCredentialsLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Login failed");
      }

      router.push(data.redirectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setIsLoading(false);
    }
  };

  const bgPaintStyle = useMemo(() => backgroundStyle(loginBg), [loginBg]);

  const isCustomBg = loginBg.type !== "default";

  return (
    <main className="min-h-screen relative overflow-hidden flex items-center justify-center p-4 md:p-8 bg-background text-foreground transition-colors duration-300">

      {/* Background — config-driven or fallback to image */}
      <div className="absolute inset-0 z-0 select-none pointer-events-none">
        {isCustomBg ? (
          <>
            <div className="absolute inset-0" style={bgPaintStyle} />
            {loginBg.overlay > 0 && (
              <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${loginBg.overlay})` }} />
            )}
          </>
        ) : (
          <>
            <Image
              src="/sanctuary_exterior.png"
              alt="Facility Background"
              fill
              className={`object-cover transition-opacity duration-300 ${
                theme === "light" ? "opacity-25" : "opacity-35"
              }`}
              priority
            />
            <div
              className="absolute inset-0 transition-colors duration-300"
              style={{
                background: theme === "light"
                  ? `linear-gradient(to top right, rgba(255,255,255,0.95), rgba(255,255,255,0.80), ${accentRgba(accent, 0.15)})`
                  : `linear-gradient(to top right, rgba(9,9,11,0.95), rgba(9,9,11,0.80), ${accentRgba(accent, 0.20)})`,
              }}
            />
          </>
        )}
      </div>

      {/* Floating Back Button & Theme Toggle on Top Right */}
      <div className="absolute top-6 left-6 z-50">
        <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-medium">
          <ArrowLeft className="w-3.5 h-3.5" /> Back Home
        </Link>
      </div>

      <div className="absolute top-6 right-6 z-50">
        <button
          onClick={toggleTheme}
          className="p-2 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 dark:hover:bg-white/10 light:border-black/5 light:bg-black/5 light:hover:bg-black/10 transition-all text-muted-foreground hover:text-foreground cursor-pointer"
          aria-label="Toggle Theme"
        >
          {mounted && theme === "light" ? (
            <Moon className="w-4.5 h-4.5" style={{ color: accent }} />
          ) : (
            <Sun className="w-4.5 h-4.5" style={{ color: accent }} />
          )}
        </button>
      </div>

      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch rounded-3xl glass-panel p-2 min-h-[550px] shadow-2xl border-white/5 light:border-black/5 relative z-10">

        {/* Left Column - Branding & Walkthrough Info */}
        <div
          className="hidden lg:flex flex-col justify-between p-8 rounded-2xl text-white relative overflow-hidden"
          style={{
            background: isCustomBg
              ? `linear-gradient(to bottom right, ${accentRgba(accent, 0.15)}, ${accentRgba(accent, 0.05)})`
              : undefined,
          }}
        >
          {!isCustomBg && <div className="absolute inset-0 bg-gradient-to-br from-zinc-950 via-zinc-900 to-amber-950/20" />}

          <div className="absolute -top-12 -left-12 w-64 h-64 blur-3xl rounded-full pointer-events-none" style={{ background: accentRgba(accent, 0.10) }} />
          <div className="absolute -bottom-12 -right-12 w-64 h-64 blur-3xl rounded-full pointer-events-none" style={{ background: accentRgba(accent, 0.10) }} />

          <div className="relative z-10 text-left">
            <div className="mb-8">
              <LcmsLogo />
            </div>

            <h1 className="text-4xl font-extrabold tracking-tight leading-tight mb-4">
              Empathetic Care, <br />
              <span className="font-light" style={{ color: accent }}>AI Assisted Efficiency.</span>
            </h1>
            <p className="text-zinc-400 text-sm font-light mb-8 max-w-md">
              LifeCare CMS (LCMS) — the digital care operating system for assisted living facilities. Sign in with your portal credentials.
            </p>

            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center border border-white/10 shrink-0">
                  <Activity className="w-4 h-4" style={{ color: accent }} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Optical Matrix Fall Detection</h3>
                  <p className="text-xs text-zinc-400 font-light mt-0.5">Real-time edge computer vision logs alerts without video feeds leaving the room.</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center border border-white/10 shrink-0">
                  <Mic className="w-4 h-4" style={{ color: accent }} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">AI Voice Charting Assistant</h3>
                  <p className="text-xs text-zinc-400 font-light mt-0.5">Listen to nurse commands, parse telemetry values, and log records instantly.</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center border border-white/10 shrink-0">
                  <ShieldCheck className="w-4 h-4" style={{ color: accent }} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Secure Family Dashboards</h3>
                  <p className="text-xs text-zinc-400 font-light mt-0.5">Keep family in the loop with transparent real-time updates and invoices.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="relative z-10 text-[11px] text-zinc-500 border-t border-white/5 pt-4 text-left">
            © 2026 LifeCare CMS. Connected Care. Better Outcomes.
          </div>
        </div>

        {/* Right Column - Login Form */}
        <div className="flex flex-col justify-center p-6 md:p-12 relative">
          <div className="max-w-md w-full mx-auto text-left">
            <div className="mb-6">
              <h2 className="text-3xl font-bold tracking-tight mb-2">Gate Entry</h2>
              <p className="text-muted-foreground text-sm font-light">
                Sign in to access your care portal.
              </p>
            </div>

            {/* Error Message */}
            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm mb-4"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <form onSubmit={handleCredentialsLogin} className="space-y-4">
              {/* Email */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@goldenhearth.com"
                    required
                    className="w-full pl-11 pr-4 py-3.5 rounded-xl bg-foreground/5 hover:bg-foreground/10 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-offset-0 transition-colors"
                    autoComplete="email"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    className="w-full pl-11 pr-12 py-3.5 rounded-xl bg-foreground/5 hover:bg-foreground/10 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-offset-0 transition-colors"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={isLoading || !email || !password}
                className="w-full py-4 rounded-xl font-bold bg-foreground text-background hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    Sign In <LogIn className="w-4 h-4" />
                  </>
                )}
              </button>

              {/* Resident self-registration */}
              <p className="text-center text-sm text-muted-foreground pt-1">
                New resident?{" "}
                <Link href="/register" className="font-semibold hover:underline" style={{ color: accent }}>
                  Create an account
                </Link>
              </p>
            </form>
          </div>
        </div>

      </div>
    </main>
  );
}
