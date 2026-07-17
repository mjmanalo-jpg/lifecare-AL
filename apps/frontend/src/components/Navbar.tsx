"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sun, Moon, Menu, X, User } from "lucide-react";
import Link from "next/link";
import LcmsLogo from "@/components/LcmsLogo";

interface NavLink {
  name: string;
  href: string;
}

const STATIC_LINKS: NavLink[] = [
  { name: "Features", href: "#features" },
  { name: "Technology", href: "#technology" },
  { name: "Showcase", href: "#showcase" },
  { name: "Contact", href: "#contact" },
  { name: "About Us", href: "#about" },
];

export default function Navbar() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [customLinks, setCustomLinks] = useState<NavLink[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    const savedTheme = localStorage.getItem("theme") as "dark" | "light" | null;
    const initialTheme = savedTheme || "dark";
    setTheme(initialTheme);
    if (initialTheme === "light") {
      document.documentElement.classList.add("light");
    } else {
      document.documentElement.classList.remove("light");
    }

    // Fetch custom pages for navigation
    fetch("/api/public/custom-pages?f_published=true", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        const pages = (json.data || []) as Array<{ title: string; slug: string; sortOrder: number }>;
        setCustomLinks(
          pages
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((p) => ({ name: p.title, href: `/page/${p.slug}` }))
        );
      })
      .catch(() => {});
  }, []);

  const allLinks = [...STATIC_LINKS, ...customLinks];

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
        <LcmsLogo />
      </Link>

      <div className="hidden md:flex items-center gap-8">
        {allLinks.map((link) => (
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
          className="w-9 h-9 flex items-center justify-center rounded-xl transition-all text-muted-foreground hover:text-foreground glass-panel hover:bg-foreground/5 cursor-pointer"
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
          className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground transition-all flex items-center gap-1.5 glass-panel hover:bg-foreground/5"
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
          className="w-9 h-9 flex items-center justify-center rounded-xl transition-all text-muted-foreground hover:text-foreground glass-panel hover:bg-foreground/5 cursor-pointer"
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
          className="w-9 h-9 flex items-center justify-center rounded-xl transition-all text-muted-foreground hover:text-foreground z-50 glass-panel hover:bg-foreground/5 cursor-pointer"
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
            className="absolute top-full left-0 w-full bg-background/95 border-b border-border flex flex-col px-6 py-6 gap-6 md:hidden z-40 overflow-hidden shadow-2xl backdrop-blur-lg"
          >
            <div className="flex flex-col gap-4">
              {allLinks.map((link) => (
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

            <div className="w-full border-t border-border pt-4 flex flex-col gap-3">
              <Link 
                href="/login" 
                onClick={() => setIsOpen(false)}
                className="w-full py-3 rounded-xl text-center text-sm font-medium text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5 glass-panel hover:bg-foreground/5"
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
