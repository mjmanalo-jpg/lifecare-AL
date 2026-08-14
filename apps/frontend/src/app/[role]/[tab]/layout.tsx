"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import PortalShell from "@/components/portal/PortalShell";
import DashboardQuickActions from "@/components/portal/views/DashboardQuickActions";
import { PortalShellSkeleton } from "@/components/portal/PortalSkeleton";
import { PATH_TO_ROLE, ROUTE_TO_TAB, Role } from "@/constants/roleConfig";

/**
 * Portal chrome (sidebar + top bar) lives in this layout — NOT in the page —
 * so it survives tab navigation. Because a `[tab]` layout is shared across every
 * tab value, PortalShell mounts exactly once and is never re-created when the
 * user moves between tabs. That's what keeps the sidebar out of the skeleton:
 * only the page below (loading.tsx / PortalShell's `contentPending`) skeletons.
 */
export default function RolePortalChrome({ children }: { children: ReactNode }) {
  const params = useParams();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  const roleParam = params?.role as string;
  const tabParam = params?.tab as string;

  const userRole: Role = roleParam ? (PATH_TO_ROLE[roleParam.toLowerCase()] || "FAMILY") : "FAMILY";
  const activeTab = tabParam ? (ROUTE_TO_TAB[tabParam] || "Dashboard") : "Dashboard";

  // The shell reads browser-only state (theme, portal matrix, collapsed groups),
  // so render it client-side after mount. Since this layout persists, the gate
  // fires ONCE on first load — never again on navigation.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);

  const handleLogout = async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    router.push("/login");
  };

  if (!mounted || !roleParam) {
    return <PortalShellSkeleton />;
  }

  return (
    <PortalShell userRole={userRole} activeTab={activeTab} onLogout={handleLogout}>
      {children}

      {/* Floating quick-actions launcher — persistent for the front-line clinical
          roles, present on every tab. Lives here (not the page) so it doesn't
          re-mount on navigation. */}
      {userRole === "NURSE" && <DashboardQuickActions clinicianRole="NURSE" />}
      {userRole === "CAREGIVER" && <DashboardQuickActions clinicianRole="CAREGIVER" />}
      {userRole === "CARE_MANAGER" && <DashboardQuickActions clinicianRole="FACILITY_ADMIN" />}
    </PortalShell>
  );
}
