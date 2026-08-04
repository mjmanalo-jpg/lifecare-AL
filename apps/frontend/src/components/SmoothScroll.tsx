"use client";

import { ReactNode, useEffect } from "react";
import { usePathname } from "next/navigation";

// Every portal path prefix (keep in sync with PATH_TO_ROLE in roleConfig).
// Lenis smooth-scroll is skipped on these routes because the portal scrolls
// inside PortalShell's inner <main>, not the window — running Lenis there
// hijacks the wheel and blocks native scrolling.
const PORTAL_PATH_RE = /^\/(platform_admin|organization_admin|nurse|physician|caregiver|family|resident|superadmin|facility_admin|care_manager|billing_admin|fleet_management|driver|security|nutritionist|kitchen|housekeeping|maintenance)(\/|$)/i;

export default function SmoothScroll({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isPortal = PORTAL_PATH_RE.test(pathname);

  useEffect(() => {
    if (isPortal) return;

    let lenis: { raf: (time: number) => void; destroy: () => void } | null = null;
    let rafId = 0;

    import("lenis").then(({ default: Lenis }) => {
      lenis = new Lenis({
        duration: 1.2,
        easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        orientation: "vertical",
        gestureOrientation: "vertical",
        smoothWheel: true,
        wheelMultiplier: 1,
        touchMultiplier: 2,
      });

      function raf(time: number) {
        lenis.raf(time);
        rafId = requestAnimationFrame(raf);
      }

      rafId = requestAnimationFrame(raf);
    });

    return () => {
      cancelAnimationFrame(rafId);
      lenis?.destroy();
    };
  }, [isPortal]);

  return <>{children}</>;
}
