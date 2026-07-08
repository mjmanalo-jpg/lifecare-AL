"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sun, Moon, Menu, X, User } from "lucide-react";
import Link from "next/link";

export default function Navbar() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const savedTheme = localStorage.getItem("theme") as "dark" | "light" | null;
    const initialTheme = savedTheme || "dark";
    setTheme(initialTheme);
    if (initialTheme === "light") {
      document.documentElement.classList.add("light");
    } else {
      document.documentElement.classList.remove("light");
    }
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

  const toggleMenu = () => setIsOpen(!isOpen);

  return (
    <motion.nav 
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="fixed top-0 left-0 w-full z-50 px-6 py-4 md:px-12 flex items-center justify-between backdrop-blur-md border-b border-white/5 bg-background/60 light:border-black/5 transition-colors duration-300"
    >
      {/* Brand Logo */}
      <Link href="/" className="flex items-center gap-3 group z-55">
        <div 
          className="relative flex items-center justify-center w-10 h-10 rounded-xl border transition-transform duration-300"
          style={{
            background: "linear-gradient(to top right, var(--lp-accent-20, rgba(245,158,11,0.2)), var(--lp-accent-10, rgba(245,158,11,0.1)))",
            borderColor: "var(--lp-accent-30, rgba(245,158,11,0.3))",
            boxShadow: "0 0 15px var(--lp-accent-20, rgba(245,158,11,0.2))"
          }}
        >
          {/* Custom SVG logo representing AI synapse and caring curves */}
          <svg 
            className="w-6 h-6" 
            style={{ color: "var(--lp-accent, #f59e0b)" }}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          >
            <circle cx="12" cy="12" r="3" style={{ fill: "var(--lp-accent-10, rgba(245,158,11,0.1))" }} />
            <path d="M12 5V9M12 15V19M5 12H9M15 12H19" strokeLinecap="round" />
            <circle cx="12" cy="5" r="1.2" style={{ fill: "var(--lp-accent, #f59e0b)" }} />
            <circle cx="12" cy="19" r="1.2" style={{ fill: "var(--lp-accent, #f59e0b)" }} />
            <circle cx="5" cy="12" r="1.2" style={{ fill: "var(--lp-accent, #f59e0b)" }} />
            <circle cx="19" cy="12" r="1.2" style={{ fill: "var(--lp-accent, #f59e0b)" }} />
            <path d="M4 16C4 16 8 20 12 20C16 20 20 16 20 16M4 8C4 8 8 4 12 4C16 4 20 8 20 8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="flex flex-col">
          <span className="text-lg font-bold tracking-tight text-foreground leading-none group-hover:text-[var(--lp-accent,#f59e0b)] transition-colors">
            Golden Hearth
          </span>
          <span className="text-[9px] text-muted-foreground font-semibold tracking-wide uppercase mt-1">
            AI Powered Assisted Living
          </span>
        </div>
      </Link>

      {/* Navigation Links - Desktop */}
      <div className="hidden md:flex items-center gap-8">
        {[
          { name: "Features", href: "#features" },
          { name: "Technology", href: "#technology" },
          { name: "Showcase", href: "#showcase" },
          { name: "About Us", href: "#about" },
        ].map((link) => (
          <Link 
            key={link.name} 
            href={link.href} 
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors duration-200"
          >
            {link.name}
          </Link>
        ))}
      </div>

      {/* Action Buttons - Desktop */}
      <div className="hidden md:flex items-center gap-4">
        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 dark:hover:bg-white/10 light:border-black/5 light:bg-black/5 light:hover:bg-black/10 transition-all text-muted-foreground hover:text-foreground cursor-pointer"
          aria-label="Toggle Theme"
        >
          {mounted && theme === "light" ? (
            <Moon className="w-4 h-4 text-[var(--lp-accent,#f59e0b)]" />
          ) : (
            <Sun className="w-4 h-4 text-[var(--lp-accent,#f59e0b)]" />
          )}
        </button>

        <Link 
          href="/login" 
          className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-white/5 border border-white/5 transition-all flex items-center gap-1.5 glass-panel"
        >
          <User className="w-4 h-4 text-[var(--lp-accent,#f59e0b)]" /> Log In
        </Link>
        <Link 
          href="/login" 
          className="px-4 py-2 rounded-xl text-sm font-semibold text-background bg-foreground hover:scale-105 transition-all shadow-[0_0_20px_rgba(255,255,255,0.15)] dark:shadow-[0_0_20px_rgba(255,255,255,0.15)] light:shadow-[0_0_20px_rgba(0,0,0,0.1)]"
        >
          Get Started
        </Link>
      </div>

      {/* Mobile Menu Actions & Toggle Button */}
      <div className="flex md:hidden items-center gap-3">
        {/* Mobile Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 light:border-black/5 light:bg-black/5 light:hover:bg-black/10 transition-all text-muted-foreground hover:text-foreground cursor-pointer"
          aria-label="Toggle Theme"
        >
          {mounted && theme === "light" ? (
            <Moon className="w-4 h-4 text-[var(--lp-accent,#f59e0b)]" />
          ) : (
            <Sun className="w-4 h-4 text-[var(--lp-accent,#f59e0b)]" />
          )}
        </button>

        {/* Hamburger Toggle */}
        <button
          onClick={toggleMenu}
          className="p-2 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 light:border-black/5 light:bg-black/5 light:hover:bg-black/10 transition-all text-muted-foreground hover:text-foreground z-50 cursor-pointer"
          aria-label="Toggle Menu"
        >
          {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile Menu Drawer */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className="absolute top-full left-0 w-full bg-background/95 border-b border-white/5 light:border-black/5 flex flex-col px-6 py-6 gap-6 md:hidden z-40 overflow-hidden shadow-2xl backdrop-blur-lg"
          >
            <div className="flex flex-col gap-4">
              {[
                { name: "Features", href: "#features" },
                { name: "Technology", href: "#technology" },
                { name: "Showcase", href: "#showcase" },
                { name: "About Us", href: "#about" },
              ].map((link) => (
                <Link 
                  key={link.name} 
                  href={link.href} 
                  onClick={() => setIsOpen(false)}
                  className="text-base font-medium text-muted-foreground hover:text-foreground transition-colors duration-200 py-1"
                >
                  {link.name}
                </Link>
              ))}
            </div>

            <div className="w-full border-t border-white/5 light:border-black/5 pt-4 flex flex-col gap-3">
              <Link 
                href="/login" 
                onClick={() => setIsOpen(false)}
                className="w-full py-3 rounded-xl text-center text-sm font-medium text-muted-foreground hover:text-foreground border border-white/5 light:border-black/5 flex items-center justify-center gap-1.5 glass-panel"
              >
                <User className="w-4 h-4 text-[var(--lp-accent,#f59e0b)]" /> Log In
              </Link>
              <Link 
                href="/login" 
                onClick={() => setIsOpen(false)}
                className="w-full py-3 rounded-xl text-center text-sm font-semibold text-background bg-foreground shadow-lg"
              >
                Get Started
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}
