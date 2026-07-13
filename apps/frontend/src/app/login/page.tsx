"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck,
  Activity,

  Mic,
  ArrowLeft,
  ChevronDown,
  Play,
  Moon,
  Sun,
  Loader
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ROLES, Role } from "@/constants/roleConfig";

export default function LoginPage() {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState<Role>("NURSE");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mounted, setMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    const savedTheme = localStorage.getItem("theme") as "dark" | "light" | null;
    const initialTheme = savedTheme || "dark";
    setTheme(initialTheme);
  }, []);

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

  const handleDemoLogin = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: selectedRole }),
      });

      if (!response.ok) {
        throw new Error("Failed to create session");
      }

      const data = await response.json();
      router.push(data.redirectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen relative overflow-hidden flex items-center justify-center p-4 md:p-8 bg-background text-foreground transition-colors duration-300">
      
      {/* Background Image with Dark/Light Overlay */}
      <div className="absolute inset-0 z-0 select-none pointer-events-none">
        <Image
          src="/sanctuary_exterior.png"
          alt="Golden Hearth Facility Background"
          fill
          className={`object-cover transition-opacity duration-300 ${
            theme === "light" ? "opacity-25" : "opacity-35"
          }`}
          priority
        />
        <div className={`absolute inset-0 transition-colors duration-300 ${
          theme === "light" 
            ? "bg-gradient-to-tr from-white/95 via-white/80 to-amber-50/40" 
            : "bg-gradient-to-tr from-zinc-950/95 via-zinc-950/80 to-amber-950/40"
        }`} />
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
            <Moon className="w-4.5 h-4.5 text-amber-500" />
          ) : (
            <Sun className="w-4.5 h-4.5 text-amber-400" />
          )}
        </button>
      </div>

      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch rounded-3xl glass-panel p-2 min-h-[550px] shadow-2xl border-white/5 light:border-black/5 relative z-10">
        
        {/* Left Column - Branding & Walkthrough Info */}
        <div className="hidden lg:flex flex-col justify-between p-8 rounded-2xl bg-gradient-to-br from-zinc-950 via-zinc-900 to-amber-950/20 text-white relative overflow-hidden">
          {/* Background glow overlay */}
          <div className="absolute -top-12 -left-12 w-64 h-64 bg-amber-500/10 blur-3xl rounded-full pointer-events-none" />
          <div className="absolute -bottom-12 -right-12 w-64 h-64 bg-yellow-500/10 blur-3xl rounded-full pointer-events-none" />
          
          <div className="relative z-10 text-left">
            <div className="flex items-center gap-2 mb-8">
              <svg className="w-6 h-6 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" className="fill-amber-500/20" />
                <path d="M12 5V9M12 15V19M5 12H9M15 12H19" strokeLinecap="round" />
                <circle cx="12" cy="5" r="1.2" className="fill-amber-400" />
                <circle cx="12" cy="19" r="1.2" className="fill-amber-400" />
                <circle cx="5" cy="12" r="1.2" className="fill-amber-400" />
                <circle cx="19" cy="12" r="1.2" className="fill-amber-400" />
                <path d="M4 16C4 16 8 20 12 20C16 20 20 16 20 16M4 8C4 8 8 4 12 4C16 4 20 8 20 8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-lg font-bold tracking-tight">Golden Hearth</span>
            </div>

            <h1 className="text-4xl font-extrabold tracking-tight leading-tight mb-4">
              Empathetic Care, <br />
              <span className="text-amber-400 font-light">AI Assisted Efficiency.</span>
            </h1>
            <p className="text-zinc-400 text-sm font-light mb-8 max-w-md">
              Bypass email and password checks. Golden Hearth enables direct preview access to dashboards for nurses, caregivers, admins, and family members.
            </p>

            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center border border-white/10 shrink-0">
                  <Activity className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Optical Matrix Fall Detection</h3>
                  <p className="text-xs text-zinc-400 font-light mt-0.5">Real-time edge computer vision logs alerts without video feeds leaving the room.</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center border border-white/10 shrink-0">
                  <Mic className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">AI Voice Charting Assistant</h3>
                  <p className="text-xs text-zinc-400 font-light mt-0.5">Listen to nurse commands, parse telemetry values, and log records instantly.</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center border border-white/10 shrink-0">
                  <ShieldCheck className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Secure Family Dashboards</h3>
                  <p className="text-xs text-zinc-400 font-light mt-0.5">Keep family in the loop with transparent real-time updates and invoices.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="relative z-10 text-[11px] text-zinc-500 border-t border-white/5 pt-4 text-left">
            © 2026 Golden Hearth AI. Simulated Walkthrough Mode Active.
          </div>
        </div>

        {/* Right Column - Dropdown Selector & Demo Bypass */}
        <div className="flex flex-col justify-center p-6 md:p-12 relative">
          <div className="max-w-md w-full mx-auto text-left">
            <div className="mb-8">
              <h2 className="text-3xl font-bold tracking-tight mb-2">Gate Entry</h2>
              <p className="text-muted-foreground text-sm font-light">
                Select a role below to access the workspace sandbox.
              </p>
            </div>

            {/* Dropdown Role Selector */}
            <div className="mb-8 relative">
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                User Role Bypass
              </label>
              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="w-full px-4 py-3.5 rounded-xl bg-foreground/5 hover:bg-foreground/10 border border-border flex items-center justify-between text-left transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  {(() => {
                    const IconComponent = ROLES[selectedRole].icon;
                    return <IconComponent className="w-5 h-5 text-amber-500" />;
                  })()}
                  <div>
                    <p className="text-sm font-semibold leading-none">{ROLES[selectedRole].name}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{ROLES[selectedRole].badge}</p>
                  </div>
                </div>
                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-300 ${isDropdownOpen ? "rotate-180" : ""}`} />
              </button>

              <AnimatePresence>
                {isDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute z-30 w-full mt-2 rounded-xl bg-background border border-border shadow-2xl p-1.5 max-h-[220px] overflow-y-auto"
                  >
                    {(Object.keys(ROLES) as Role[]).map((role) => {
                      const details = ROLES[role];
                      const IconComponent = details.icon;
                      return (
                        <button
                          key={role}
                          onClick={() => {
                            setSelectedRole(role);
                            setIsDropdownOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2.5 rounded-lg flex items-start gap-3 hover:bg-foreground/5 transition-colors cursor-pointer ${selectedRole === role ? "bg-amber-500/10 text-amber-500" : ""}`}
                        >
                          <IconComponent className="w-5 h-5 shrink-0 mt-0.5 text-amber-500" />
                          <div>
                            <p className="text-sm font-semibold">{details.name}</p>
                            <p className="text-xs text-muted-foreground font-light mt-0.5">{details.desc}</p>
                          </div>
                        </button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
                {error}
              </div>
            )}

            {/* Submit Bypass Action */}
            <button
              onClick={handleDemoLogin}
              disabled={isLoading}
              className="w-full py-4 rounded-xl font-bold bg-foreground text-background hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Logging in...
                </>
              ) : (
                <>
                  Demo Log In <Play className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </main>
  );
}
