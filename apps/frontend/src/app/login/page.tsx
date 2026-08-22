"use client";

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck,
  Activity,
  Mic,
  ArrowLeft,
  ArrowRight,
  Moon,
  Sun,
  Loader,
  Building2,
  Phone,
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
  // "employee" = staff/family via company + mobile; "client" = org owner via email.
  const [mode, setMode] = useState<"employee" | "client">("employee");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  // Employee flow: Continue resolves the account, then a pop-up collects the
  // password ("password") or, first-time, sets one ("firstTime").
  const [pwPrompt, setPwPrompt] = useState<null | "password" | "firstTime">(null);

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
  useEffect(() => {
    const as = new URLSearchParams(window.location.search).get("as");
    if (as === "client" || as === "employee") setMode(as);
  }, []);

  // Client = email + password. Employee = Continue resolves the account by
  // company + mobile, then a pop-up collects (or sets) the password.
  const handleCredentialsLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      if (mode === "client") {
        const response = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Login failed");
        router.push(data.redirectUrl);
        return;
      }

      const response = await fetch("/api/auth/mobile-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, mobile }),
      });
      const data = await response.json();
      if (data.needsFirstPassword) { setNewPassword(""); setConfirmPassword(""); setPwPrompt("firstTime"); setIsLoading(false); return; }
      if (data.needsPassword) { setPassword(""); setPwPrompt("password"); setIsLoading(false); return; }
      if (!response.ok) throw new Error(data.error || "We couldn't find that account.");
      if (data.redirectUrl) { router.push(data.redirectUrl); return; }
      setIsLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setIsLoading(false);
    }
  };

  const submitEmployeePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwPrompt === "firstTime" && newPassword !== confirmPassword) {
      setError("Those passwords don't match.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/mobile-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company,
          mobile,
          password: pwPrompt === "password" ? password : "",
          newPassword: pwPrompt === "firstTime" ? newPassword : "",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Sign-in failed");
      router.push(data.redirectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setIsLoading(false);
    }
  };

  const closePwPrompt = () => {
    setPwPrompt(null);
    setError(null);
    setPassword(""); setNewPassword(""); setConfirmPassword("");
    setIsLoading(false);
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
              Senior Living Management System (SLMS) — the digital care operating system for assisted living facilities. Sign in with your portal credentials.
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
            © 2026 Senior Living Management System. Connected Care. Better Outcomes.
          </div>
        </div>

        {/* Right Column - Login Form */}
        <div className="flex flex-col justify-center p-6 md:p-12 relative">
          <div className="max-w-md w-full mx-auto text-left">
            <div className="mb-6">
              <h2 className="text-3xl font-bold tracking-tight mb-2">{mode === "client" ? "Organization sign-in" : "Employee & family sign-in"}</h2>
              <p className="text-muted-foreground text-sm font-light">
                {mode === "client" ? "Sign in to your organization dashboard." : "Sign in with your company name and registered mobile number."}
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
              {/* Client (organization owner) — email */}
              {mode === "client" && (
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Email address</label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@yourcompany.com"
                      required
                      className="w-full pl-11 pr-4 py-3.5 rounded-xl bg-foreground/5 hover:bg-foreground/10 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-offset-0 transition-colors"
                      autoComplete="email"
                    />
                  </div>
                </div>
              )}

              {/* Employee/family — company name */}
              {mode === "employee" && (
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Company name</label>
                  <div className="relative">
                    <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="text"
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      placeholder="Your company"
                      required
                      className="w-full pl-11 pr-4 py-3.5 rounded-xl bg-foreground/5 hover:bg-foreground/10 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-offset-0 transition-colors"
                      autoComplete="organization"
                    />
                  </div>
                </div>
              )}

              {/* Employee/family — mobile number */}
              {mode === "employee" && (
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Mobile number</label>
                  <div className="relative">
                    <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="tel"
                      value={mobile}
                      onChange={(e) => setMobile(e.target.value)}
                      placeholder="0917 123 4567"
                      required
                      className="w-full pl-11 pr-4 py-3.5 rounded-xl bg-foreground/5 hover:bg-foreground/10 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-offset-0 transition-colors"
                      autoComplete="tel"
                    />
                  </div>
                </div>
              )}

              {/* Client enters the password inline; employees enter it in the pop-up. */}
              {mode === "client" && (
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Password</label>
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
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer" tabIndex={-1}>
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={isLoading || (mode === "client" ? (!email || !password) : (!company || !mobile))}
                className="w-full py-4 rounded-xl font-bold bg-foreground text-background hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    Please wait…
                  </>
                ) : mode === "client" ? (
                  <>
                    Sign In <LogIn className="w-4 h-4" />
                  </>
                ) : (
                  <>
                    Continue <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              {mode === "client" ? (
                <>
                  <p className="text-center text-sm text-muted-foreground pt-1">
                    Don&apos;t have an account?{" "}
                    <Link href="/signup" className="font-semibold hover:underline" style={{ color: accent }}>
                      Register your organization
                    </Link>
                  </p>
                  <p className="text-center text-sm text-muted-foreground">
                    Staff or family?{" "}
                    <button type="button" onClick={() => { setMode("employee"); setError(null); }} className="font-semibold hover:underline cursor-pointer" style={{ color: accent }}>
                      Employee login
                    </button>
                  </p>
                </>
              ) : (
                <p className="text-center text-sm text-muted-foreground pt-1">
                  Organization owner?{" "}
                  <button type="button" onClick={() => { setMode("client"); setError(null); }} className="font-semibold hover:underline cursor-pointer" style={{ color: accent }}>
                    Client login
                  </button>
                </p>
              )}
            </form>
          </div>
        </div>

      </div>

      {/* Employee/family password pop-up (after Continue) */}
      <AnimatePresence>
        {pwPrompt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={closePwPrompt}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
              className="w-full max-w-sm rounded-2xl bg-background border border-border p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold tracking-tight mb-1">{pwPrompt === "firstTime" ? "Set up your first-time password" : "Enter your password"}</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {pwPrompt === "firstTime"
                  ? `You don't have a password yet — create one to finish signing in to ${company || "your company"}. You'll use it every time from now on.`
                  : `Signing in to ${company || "your company"} as ${mobile || "your number"}.`}
              </p>

              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm mb-4">{error}</div>
              )}

              <form onSubmit={submitEmployeePassword} className="space-y-3">
                {pwPrompt === "password" ? (
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Password</label>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        required
                        autoFocus
                        className="w-full pl-11 pr-12 py-3.5 rounded-xl bg-foreground/5 hover:bg-foreground/10 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-offset-0 transition-colors"
                        autoComplete="current-password"
                      />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer" tabIndex={-1}>
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">First-time password</label>
                      <div className="relative">
                        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                          type={showPassword ? "text" : "password"}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="At least 8 characters"
                          minLength={8}
                          required
                          autoFocus
                          className="w-full pl-11 pr-12 py-3.5 rounded-xl bg-foreground/5 hover:bg-foreground/10 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-offset-0 transition-colors"
                          autoComplete="new-password"
                        />
                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer" tabIndex={-1}>
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Confirm password</label>
                      <div className="relative">
                        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                          type={showPassword ? "text" : "password"}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Re-enter your password"
                          required
                          className="w-full pl-11 pr-4 py-3.5 rounded-xl bg-foreground/5 hover:bg-foreground/10 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-offset-0 transition-colors"
                          autoComplete="new-password"
                        />
                      </div>
                    </div>
                  </>
                )}

                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={closePwPrompt} className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold text-foreground hover:bg-foreground/5 transition-colors cursor-pointer">
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={isLoading || (pwPrompt === "password" ? !password : (newPassword.length < 8 || !confirmPassword))}
                    className="flex-1 py-3 rounded-xl bg-foreground text-background text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {isLoading ? <Loader className="w-4 h-4 animate-spin" /> : pwPrompt === "firstTime" ? "Set & sign in" : "Sign in"}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
