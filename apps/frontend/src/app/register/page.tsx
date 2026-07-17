"use client";

import { useEffect, useMemo } from "react";
import ResidentRegistration from "@/components/portal/views/ResidentRegistration";
import { useLiveLandingConfig, backgroundStyle } from "@/lib/landingConfig";

export default function RegisterPage() {
  // Align with the Super Admin "Landing Studio" customization: the public
  // registration screen inherits the same accent, background, and base theme
  // as the login page instead of a hardcoded amber look.
  const config = useLiveLandingConfig();
  const login = config.login;
  const accent = login.accent;
  const bg = login.background;
  const isCustomBg = bg.type !== "default";

  useEffect(() => {
    if (login.baseTheme === "light") document.documentElement.classList.add("light");
    else document.documentElement.classList.remove("light");
  }, [login.baseTheme]);

  const fallbackBg = useMemo<React.CSSProperties>(
    () => ({
      background:
        login.baseTheme === "light"
          ? "linear-gradient(135deg, #fef3c7, #e7e5e4)"
          : "linear-gradient(135deg, #0b1120, #020617)",
    }),
    [login.baseTheme],
  );

  return (
    <main className="min-h-screen relative overflow-hidden bg-background text-foreground">
      {/* Config-driven background layer (mirrors the login page) */}
      <div className="absolute inset-0 z-0 select-none pointer-events-none">
        {isCustomBg ? (
          <>
            <div className="absolute inset-0" style={backgroundStyle(bg)} />
            {bg.overlay > 0 && <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${bg.overlay})` }} />}
          </>
        ) : (
          <div className="absolute inset-0" style={fallbackBg} />
        )}
      </div>

      <ResidentRegistration variant="public" accent={accent} />
    </main>
  );
}
