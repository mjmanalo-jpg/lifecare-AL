"use client";

import { useState, ReactNode, useEffect, useMemo, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { useFacilityConfig } from "@/lib/useFacilityConfig";
import {
  Menu,
  X,
  LogOut,
  Settings,
  Sun,
  Moon,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Bell,
  Globe,
  Lock,
  User as UserIcon,
  Activity,
  AlertTriangle,
  Pill,
  BellRing,
  CheckSquare,
  MessageSquare,
  Clock,
  Zap,
  Bus,
  Search,
  MoreHorizontal,
  CircleCheck,
} from "lucide-react";
import Link from "next/link";
import LcmsLogo from "@/components/LcmsLogo";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import ChangePasswordDialog from "@/components/portal/ChangePasswordDialog";
import LogoutDialog from "@/components/portal/LogoutDialog";
import SignatureModal from "@/components/portal/SignatureModal";
import { motion, AnimatePresence } from "framer-motion";
import {
  Role,
  RoleDetails,
  ROLES,
  ROUTE_TO_TAB,
  SidebarLink,
  groupSidebarLinks,
} from "@/constants/roleConfig";
import { canAlertAction } from "@/lib/alertAccess";

interface PortalShellProps {
  userRole: Role;
  activeTab: string;
  children: ReactNode;
  onLogout?: () => void;
}

const DEFAULT_COLLAPSED_GROUPS: Record<string, boolean> = {
  "Clinical Monitoring": true,
  "Coordination & Comms": true,
  Operations: true,
  Administration: true,
  Inventory: true,
  "Billing & Finance": true,
  "Hospitality & Services": true,
  "Fleet & Transport": true,
};

const sidebarGroupStateByRole = new Map<Role, Record<string, boolean>>();

// Every notification resolves to an explicit sidebar tab. The ENTITY a
// notification points at is the precise signal (many types are shared —
// SYSTEM_ALERT alone covers inventory, camera, subscription, system health,
// …), so it's checked first; the notification TYPE is the fallback for alerts
// without an entity (e.g. demo data). Each key maps to an ordered list of
// candidate route segments; the first tab the current role actually has in its
// sidebar wins, so a click always lands on a real page (vitals → Vitals Monitor
// when present, else Vitals Trends), never a 404 or the wrong dashboard.
const NOTIF_TARGET_ROUTES: Record<string, string[]> = {
  // Care system
  vitalsLog: ["monitoring", "vitals", "records", "dashboard"],
  weightTrend: ["monitoring", "vitals", "records", "dashboard"],
  weightreminder: ["weightmonitoring", "monitoring", "dashboard"], // key is lowercase — routeForNotification lowercases relatedEntityType before lookup
  medicationAdministration: ["mar", "medications", "orders", "dashboard"],
  incident: ["incidents", "alertcenter", "records", "dashboard"],
  escalation: ["escalations", "alertcenter", "dashboard"],
  slaBreach: ["alertcenter", "alerts", "escalations", "dashboard"],
  followUp: ["followups", "records", "dashboard"],
  assessment: ["rounds", "casereview", "dashboard"],
  task: ["taskboard", "tasks", "taskassignment", "documentation", "dashboard"],
  handover: ["taskassignment", "shiftendorsements", "endorsementdashboard", "dashboard"],
  dailyDoc: ["dailyrounds", "documentation", "tasks", "reports", "dashboard"],
  callbell: ["callbells", "alertcenter", "monitoring", "dashboard"],
  // Facility operations
  inventoryItem: ["inventory-alerts", "inventory", "dashboard"],
  camera: ["cameras", "cameralogs", "securitylog", "dashboard"],
  purchaseRequest: ["purchaserequests", "inventory", "dashboard"],
  serviceRequest: ["services", "frontdesk", "dashboard"],
  maintenance: ["maintenance", "dashboard"],
  diningReservation: ["community", "dining", "dashboard"],
  conciergeBooking: ["concierge", "services", "dashboard"],
  trip: ["trips", "requests", "transport", "dashboard"],
  // Billing & subscriptions
  invoice: ["invoices", "expenses", "billing", "ledger", "dashboard"],
  subscription: ["subscription", "usage", "invoices", "dashboard"],
  "subscription-payment": ["subscription", "usage", "dashboard"],
  "saas-invoice": ["invoices", "workspaces", "dashboard"],
  // Organizations & access
  organization: ["workspaces", "communities", "dashboard"],
  community: ["communities", "dashboard"],
  "staff-account": ["staff", "people", "dashboard"],
  invitation: ["invitations", "people", "dashboard"],
  // Platform / system health
  systemHealth: ["health", "dashboard"],
};

const NOTIF_ROUTE_BY_TYPE: Record<string, string[]> = {
  VITAL_ALERT: ["monitoring", "vitals", "records", "dashboard"],
  MEDICATION_REMINDER: ["mar", "medications", "orders", "dashboard"],
  INCIDENT_REPORT: ["incidents", "alertcenter", "records", "dashboard"],
  CALL_BELL: ["callbells", "alertcenter", "monitoring", "dashboard"],
  TASK_ASSIGNMENT: ["taskboard", "tasks", "taskassignment", "documentation", "dashboard"],
  SHIFT_REMINDER: ["reports", "dashboard"],
  MESSAGE: ["messages", "dashboard"],
  TRANSPORT_UPDATE: ["trips", "requests", "transport", "dashboard"],
  SBAR_ESCALATION: ["escalations", "alertcenter", "dashboard"],
  SYSTEM_ALERT: ["health", "dashboard"],
  BILLING_UPDATE: ["invoices", "expenses", "subscription", "billing", "dashboard"],
};

// Optional deep-link appended when the resolved tab supports sub-tabs.
const NOTIF_ROUTE_QUERY: Record<string, string> = {
  diningReservation: "subtab=dining",
  handover: "tab=handover", // opens the Handover tab on the Task Assignment board
};

/** Best matching sidebar route for a notification — by its related entity type
 *  first (precise), then its notification type (fallback), else the role's
 *  dashboard. Candidates are matched against the current role's sidebar links
 *  so a click always lands on a tab that exists for that role. */
function routeForNotification(type: string, relatedEntityType: string | null | undefined, links: SidebarLink[], fallback: string): string {
  const entity = relatedEntityType ? String(relatedEntityType).toLowerCase() : "";
  const candidates = (entity ? NOTIF_TARGET_ROUTES[entity] : undefined) ?? NOTIF_ROUTE_BY_TYPE[type] ?? [];
  for (const segment of candidates) {
    const match = links.find((l) => l.route.endsWith(`/${segment}`));
    if (match) {
      const query = entity ? NOTIF_ROUTE_QUERY[entity] : undefined;
      return query ? `${match.route}?${query}` : match.route;
    }
  }
  return fallback;
}

export default function PortalShell({
  userRole,
  children,
  onLogout,
}: PortalShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const roleDetails: RoleDetails = ROLES[userRole];
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [navQuery, setNavQuery] = useState("");
  // Seed from the class the pre-paint theme script already set on <html>, so the
  // chrome doesn't flash light before the mount effect runs. Server render has no
  // document and falls back to the CSS default (dark); the effect reconciles.
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("light") ? "light" : "dark"
  );
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [showLogout, setShowLogout] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [language, setLanguage] = useState("en");

  // Supervisor portals nudge the alerts engine (throttled to once / 10 min) so
  // automated alerts get generated during normal use; Vercel Cron covers prod.
  useEffect(() => {
    if (!["NURSE", "FACILITY_ADMIN", "SUPERADMIN"].includes(userRole)) return;
    try {
      const KEY = "lcms_alerts_scan_ts";
      const last = Number(localStorage.getItem(KEY) || 0);
      if (Date.now() - last < 10 * 60 * 1000) return;
      localStorage.setItem(KEY, String(Date.now()));
      fetch("/api/cron/alerts", { method: "POST" }).catch(() => { /* non-fatal */ });
    } catch { /* ignore */ }
  }, [userRole]);
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const { facilityName } = useFacilityConfig();

  // Session details from GET /api/auth/session
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  
  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated) {
          const userId = data.session?.userId || "demo-user";
          setSessionUserId(userId);
          setProfileName(data.workspaces?.user?.name || roleDetails.profileName);
          setProfileEmail(data.workspaces?.user?.email || "");
          try {
            const preferences = JSON.parse(localStorage.getItem(`lcms_preferences_${userId}`) || "{}");
            if (typeof preferences.notifications === "boolean") setNotifications(preferences.notifications);
            if (typeof preferences.emailAlerts === "boolean") setEmailAlerts(preferences.emailAlerts);
            if (typeof preferences.language === "string") setLanguage(preferences.language);
          } catch { /* Ignore malformed device preferences. */ }
        }
      })
      .catch((err) => console.warn("Failed to get session:", err));
  }, [roleDetails.profileName]);

  // Fetch notifications in real-time
  const { data: notificationsData, refetch: refetchNotifications } = useLiveQuery<{
    id: string;
    type: string;
    title: string;
    message: string;
    isRead: boolean;
    createdAt: string;
    severity?: string | null;
    snoozedUntil?: string | null;
    relatedEntityType?: string | null;
  }>("notifications", {
    query: sessionUserId ? `f_userId=${sessionUserId}` : undefined,
    tables: ["Notification"],
  });

  const [bellDropdownOpen, setBellDropdownOpen] = useState(false);

  // Dropdown dismissal: Escape and outside-click close the notification and
  // profile menus, so they never trap the user (they previously stayed open).
  const bellRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!bellDropdownOpen && !profileDropdownOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setBellDropdownOpen(false); setProfileDropdownOpen(false); }
    };
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (bellRef.current && !bellRef.current.contains(t)) setBellDropdownOpen(false);
      if (profileRef.current && !profileRef.current.contains(t)) setProfileDropdownOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [bellDropdownOpen, profileDropdownOpen]);

  // A tick of "now" (updated after mount + every 30s) — used instead of calling
  // Date.now() during render, which the purity rule forbids.
  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  // Compute unread count
  // Snoozed alerts drop out of the queue until their snooze window elapses.
  const isSnoozed = (n: { snoozedUntil?: string | null }) => !!n.snoozedUntil && new Date(n.snoozedUntil).getTime() >= nowTs;
  // Admin tiers only surface alerts within their function. Facility Operations is
  // not a clinical role — its bell only carries operational alerts (inventory,
  // maintenance/tickets, camera/device, occupancy). Care-system alerts are hidden
  // by BOTH notification type AND the entity they point at: SYSTEM_ALERT is shared
  // by operational inventory alerts and clinical SLA/escalation/follow-up/doc
  // alerts, so the entity type is the reliable discriminator. Those clinical
  // alerts live in the nurse / care-manager / physician portals.
  // Platform & Organization admins additionally exclude facility-operational
  // alerts (purchase/service/maintenance/dining/concierge/inventory/camera/
  // transport) and resident-family billing — their bells only carry subscription,
  // billing, security and system-level alerts.
  const CLINICAL_NOTIF_TYPES = new Set(["VITAL_ALERT", "MEDICATION_REMINDER", "CALL_BELL", "SBAR_ESCALATION", "SHIFT_REMINDER", "TASK_ASSIGNMENT", "INCIDENT_REPORT"]);
  const CLINICAL_ENTITY_TYPES = new Set(["vitalsLog", "medicationAdministration", "incident", "escalation", "slaBreach", "assessment", "dailyDoc", "weightTrend", "followUp", "task"]);
  const FACILITY_NOTIF_TYPES = new Set(["TRANSPORT_UPDATE"]);
  const FACILITY_ENTITY_TYPES = new Set(["purchaseRequest", "serviceRequest", "maintenance", "diningReservation", "conciergeBooking", "inventoryItem", "camera", "trip"]);
  const isClinicalNotif = (n: { type?: string; relatedEntityType?: string | null }) =>
    CLINICAL_NOTIF_TYPES.has(String(n.type)) || CLINICAL_ENTITY_TYPES.has(String(n.relatedEntityType ?? ""));
  const isFacilityNotif = (n: { type?: string; relatedEntityType?: string | null }) =>
    FACILITY_NOTIF_TYPES.has(String(n.type)) || FACILITY_ENTITY_TYPES.has(String(n.relatedEntityType ?? ""));
  // Resident/family invoice notifications (entity "invoice") are out of scope for
  // the admin tiers; SaaS subscription billing (entity "subscription") is not.
  const isResidentBilling = (n: { type?: string; relatedEntityType?: string | null }) =>
    String(n.type) === "BILLING_UPDATE" && String(n.relatedEntityType ?? "") === "invoice";
  const scopeRole = String(userRole);
  const visibleNotifications = (notificationsData || []).filter((n) => {
    if (isSnoozed(n)) return false;
    if (scopeRole === "FACILITY_ADMIN") return !isClinicalNotif(n);
    if (scopeRole === "ORGANIZATION_ADMIN" || scopeRole === "PLATFORM_ADMIN") return !isClinicalNotif(n) && !isFacilityNotif(n) && !isResidentBilling(n);
    return true;
  });
  const unreadNotifications = visibleNotifications.filter((n) => !n.isRead);
  const unreadCount = unreadNotifications.length;

  const handleSnooze = async (id: string) => {
    try {
      const { updateRecord } = await import("@/lib/api");
      await updateRecord("notifications", id, { snoozedUntil: new Date(nowTs + 60 * 60 * 1000).toISOString() });
      await refetchNotifications();
    } catch (err) { console.error("Snooze failed:", err); }
  };

  const handleMarkAllRead = async () => {
    try {
      const { updateRecord } = await import("@/lib/api");
      await Promise.all(
        unreadNotifications.map((n) =>
          updateRecord("notifications", n.id, {
            isRead: true,
            readAt: new Date().toISOString(),
          })
        )
      );
      await refetchNotifications();
      Swal.fire({
        title: "Notifications Read",
        text: "All notifications marked as read.",
        icon: "success",
        timer: 1500,
        showConfirmButton: false,
        background: theme === "dark" ? "#1f2937" : "#ffffff",
        color: theme === "dark" ? "#ffffff" : "#000000",
      });
    } catch (err) {
      console.error("Mark all read failed:", err);
    }
  };

  const handleMarkSingleRead = async (id: string) => {
    try {
      const { updateRecord } = await import("@/lib/api");
      await updateRecord("notifications", id, {
        isRead: true,
        readAt: new Date().toISOString(),
      });
      await refetchNotifications();
    } catch (err) {
      console.error("Mark single read failed:", err);
    }
  };

  // Clicking a notification marks it read and navigates to the page most
  // relevant to its content (incident → Incidents, call bell → Records, …),
  // scoped to the current role's available tabs.
  const handleNotificationClick = (n: { id: string; type: string; isRead: boolean; relatedEntityType?: string | null }) => {
    if (!n.isRead) void handleMarkSingleRead(n.id);
    setBellDropdownOpen(false);
    const fallback =
      roleDetails.sidebarLinks[0]?.route ||
      `/${pathname.split("/")[1] || String(userRole).toLowerCase()}/dashboard`;
    router.push(routeForNotification(n.type, n.relatedEntityType, roleDetails.sidebarLinks, fallback));
  };


  const portalScopeName = userRole === "PLATFORM_ADMIN" ? "SaaS Control Plane" : userRole === "ORGANIZATION_ADMIN" ? "Organization Control Center" : (facilityName || "Care Portal");

  // Dynamic sidebar filtering matching Portal Feature Matrix settings with localStorage cache to prevent blinking
  const { data: settingRows } = useLiveQuery<{
    id: string;
    key?: string;
    value: string;
  }>("app-settings", { tables: ["AppSetting"] });

  const filteredLinks = useMemo(() => {
    const rawLinks = roleDetails.sidebarLinks;
    
    // 1. Try to read from localStorage synchronously to avoid mount blinking
    let storedValue: string | null = null;
    if (typeof window !== "undefined") {
      storedValue = localStorage.getItem("portal_matrix_cache");
    }
    
    // 2. Update cache and use fresh value when database settings load
    const dbStored = settingRows?.find((s) => (s.key || s.id) === "portal_matrix")?.value;
    if (dbStored) {
      storedValue = dbStored;
      if (typeof window !== "undefined") {
        localStorage.setItem("portal_matrix_cache", dbStored);
      }
    }
    
    if (!storedValue) return rawLinks;
    try {
      const parsed = JSON.parse(storedValue);
      const roleMatrix = parsed[userRole];
      if (!roleMatrix) return rawLinks;
      return rawLinks.filter((link) => roleMatrix[link.name] !== false);
    } catch {
      return rawLinks;
    }
  }, [settingRows, roleDetails, userRole]);

  // Group links into matrix-based collapsible sections
  const visibleNavLinks = useMemo(() => {
    const query = navQuery.trim().toLocaleLowerCase();
    if (!query) return filteredLinks;
    return filteredLinks.filter((link) =>
      `${link.name} ${link.group || ""}`.toLocaleLowerCase().includes(query)
    );
  }, [filteredLinks, navQuery]);

  const groupedLinks = useMemo(
    () => groupSidebarLinks(visibleNavLinks),
    [visibleNavLinks]
  );

  // Keep the two highest-frequency clinical groups open. Lower-frequency
  // groups remain one tap away, which prevents a long link wall on first load.
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(
    () => sidebarGroupStateByRole.get(userRole) ?? { ...DEFAULT_COLLAPSED_GROUPS }
  );

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [group]: !prev[group] };
      sidebarGroupStateByRole.set(userRole, next);
      return next;
    });
  };

  // The active route segment (the part after /<role>/). Exact-segment matching
  // avoids the substring collisions that `pathname.includes(route)` produced
  // (e.g. /cameras also lighting up /cameralogs).
  const activeSegment = pathname.split("/")[2] || "dashboard";
  const isLinkActive = (link: SidebarLink) => link.route.endsWith(`/${activeSegment}`);

  // Human name of the page currently in view — sidebar label first (already the
  // words the user clicked), then the route→tab map, so the chrome can always
  // answer "where am I?".
  const currentPageName =
    filteredLinks.find((l) => l.route.endsWith(`/${activeSegment}`))?.name ||
    ROUTE_TO_TAB[activeSegment] ||
    "Overview";

  const currentGroup =
    groupSidebarLinks(filteredLinks).find(({ links }) => links.some(isLinkActive))?.group ||
    "Overview";

  const priorityLinks = useMemo(() => {
    const preferredSegments = ["dashboard", "alertcenter", "residents", "carelogs", "mar"];
    const preferred = preferredSegments
      .map((segment) => filteredLinks.find((link) => link.route.endsWith(`/${segment}`)))
      .filter(Boolean) as SidebarLink[];
    const active = filteredLinks.find((link) => link.route.endsWith(`/${activeSegment}`));
    const combined = active ? [active, ...preferred] : preferred;
    return combined.filter((link, index, all) => all.findIndex((item) => item.route === link.route) === index).slice(0, 5);
  }, [activeSegment, filteredLinks]);

  // Renders a single nav link (label optional for the collapsed rail)
  const renderLink = (link: SidebarLink, showLabel: boolean) => {
    const isActive = isLinkActive(link);
    const Icon = link.icon;
    return (
      <Link
        key={`${link.name}-${link.route}`}
        href={link.route}
        onClick={() => setMobileMenuOpen(false)}
        title={showLabel ? undefined : link.name}
        aria-current={isActive ? "page" : undefined}
        className={`group/nav flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
          isActive
            ? theme === "dark"
              ? "bg-blue-500/15 text-blue-200 shadow-[inset_0_0_0_1px_rgba(96,165,250,.24)]"
              : "bg-blue-50 text-blue-800 shadow-[inset_0_0_0_1px_rgba(37,99,235,.18)]"
            : theme === "dark"
            ? "text-slate-300 hover:bg-slate-800 hover:text-white"
            : "text-slate-700 hover:bg-slate-100 hover:text-slate-950"
        } ${showLabel ? "" : "justify-center"}`}
      >
        <Icon className="flex-shrink-0 w-5 h-5" />
        {showLabel && <span className="text-sm font-semibold">{link.name}</span>}
      </Link>
    );
  };

  // Renders the full nav as collapsible group sections
  const renderGroupedNav = () =>
    groupedLinks.map(({ group, links }) => {
      const collapsed = navQuery ? false : !!collapsedGroups[group];
      return (
        <div key={group} className="space-y-1">
          <button
            onClick={() => toggleGroup(group)}
            className={`group flex min-h-10 w-full items-center justify-between rounded-lg px-3 pt-3 pb-1 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              theme === "dark" ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-800"
            }`}
            aria-expanded={!collapsed}
          >
            <span className="text-[11px] font-bold uppercase tracking-[0.12em]">{group}</span>
            <span className="ml-auto mr-2 text-[10px] tabular-nums opacity-70">{links.length}</span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-200 ${
                collapsed ? "-rotate-90" : ""
              }`}
            />
          </button>
          {!collapsed && (
            <div className="space-y-1 pb-1">{links.map((link) => renderLink(link, true))}</div>
          )}
        </div>
      );
    });

  const renderNavSearch = () => (
    <div className="px-3 pb-2 pt-3">
      <label className="relative block">
        <Search className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${theme === "dark" ? "text-slate-400" : "text-slate-500"}`} />
        <span className="sr-only">Find a portal page</span>
        <input
          value={navQuery}
          onChange={(event) => setNavQuery(event.target.value)}
          placeholder="Find a page..."
          className={`h-11 w-full rounded-xl border pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 ${
            theme === "dark" ? "border-slate-700 bg-slate-900 text-white" : "border-slate-200 bg-slate-50 text-slate-950"
          }`}
        />
      </label>
      {navQuery && visibleNavLinks.length === 0 && (
        <div className={`px-3 py-8 text-center text-sm ${theme === "dark" ? "text-slate-400" : "text-slate-600"}`}>
          No pages match {navQuery}.
        </div>
      )}
    </div>
  );

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
      document.body.style.position = "fixed";
      document.body.style.inset = "0";
    } else {
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.inset = "";
    }
    return () => {
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.inset = "";
    };
  }, [mobileMenuOpen]);



  // Initialize theme from localStorage
  useEffect(() => {
    const savedTheme = (localStorage.getItem("theme") as "light" | "dark") || "light";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(savedTheme);
    if (savedTheme === "dark") {
      document.documentElement.classList.remove("light");
      document.documentElement.style.colorScheme = "dark";
    } else {
      document.documentElement.classList.add("light");
      document.documentElement.style.colorScheme = "light";
    }
  }, []);

  const handleLogout = () => setShowLogout(true);

  const handleConfirmLogout = () => {
    setShowLogout(false);
    if (onLogout) {
      onLogout();
    } else {
      router.push("/login");
    }

    Swal.fire({
      title: "Logged Out",
      text: "You have been successfully logged out.",
      icon: "success",
      timer: 1500,
      showConfirmButton: false,
      background: theme === "dark" ? "#1f2937" : "#ffffff",
      color: theme === "dark" ? "#ffffff" : "#000000",
    });
  };

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);

    // Apply theme immediately to DOM
    if (newTheme === "dark") {
      document.documentElement.classList.remove("light");
      document.documentElement.style.colorScheme = "dark";
    } else {
      document.documentElement.classList.add("light");
      document.documentElement.style.colorScheme = "light";
    }
  };

  const handleSaveSettings = async () => {
    const cleanName = profileName.trim();
    if (cleanName.length < 2) {
      await Swal.fire({ title: "Name required", text: "Enter at least two characters.", icon: "warning" });
      return;
    }
    setSettingsSaving(true);
    try {
      const response = await fetch("/api/auth/account", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: cleanName }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to save settings");
      setProfileName(body.user?.name || cleanName);
      if (sessionUserId) localStorage.setItem(`lcms_preferences_${sessionUserId}`, JSON.stringify({ notifications, emailAlerts, language }));
      document.documentElement.lang = language;
      setShowSettingsModal(false);
      await Swal.fire({ title: "Settings saved", icon: "success", timer: 1400, showConfirmButton: false });
    } catch (error) {
      await Swal.fire({ title: "Save failed", text: error instanceof Error ? error.message : "Unable to save settings", icon: "error" });
    } finally { setSettingsSaving(false); }
  };

  const handleChangePassword = () => setShowChangePassword(true);
  return (
    <div className={`flex h-screen ${theme === "dark" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-950"}`}>
      {/* Desktop navigation index. Tablets use the overlay drawer below so the
          clinical workspace never loses a third of its usable width. */}
      <aside
        className={`${
          sidebarOpen ? "w-72" : "w-[76px]"
        } hidden shrink-0 flex-col overflow-hidden border-r transition-[width] duration-200 xl:flex ${
          theme === "dark"
            ? "border-slate-800 bg-slate-950 text-white"
            : "border-slate-200 bg-white text-slate-950"
        }`}
      >
        {/* Brand Header */}
        <div className={`flex min-h-[76px] items-center justify-between border-b p-4 transition-colors ${
          theme === "dark"
            ? "border-slate-800 bg-slate-950"
            : "border-slate-200 bg-white"
        }`}>
          {sidebarOpen ? (
            /* Full brand — shown whenever the sidebar is expanded (md+). */
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <LcmsLogo />
              <div className="text-left border-l border-gray-200 dark:border-gray-800 pl-2 min-w-0 flex-1">
                <div className={`font-black text-xs leading-none uppercase tracking-wider ${theme === "dark" ? "text-blue-400" : "text-blue-600"}`}>{roleDetails.badge}</div>
                <div className={`text-[10px] font-bold truncate mt-0.5 ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`} title={portalScopeName}>
                  {portalScopeName}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center w-full">
              <LcmsLogo iconOnly />
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-blue-500 outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500 ${
              theme === "dark"
                ? "hover:bg-slate-800"
                : "hover:bg-slate-100"
            }`}
            aria-label={sidebarOpen ? "Collapse navigation" : "Expand navigation"}
            title={sidebarOpen ? "Collapse" : "Expand"}
          >
            {sidebarOpen ? (
              <ChevronLeft className="w-5 h-5" />
            ) : (
              <ChevronRight className="w-5 h-5" />
            )}
          </button>
        </div>

        {/* Navigation Links — grouped by SLMS matrix module when expanded */}
        {sidebarOpen && renderNavSearch()}
        <nav className={`min-h-0 flex-1 space-y-1 overflow-y-auto scrollbar-thin ${sidebarOpen ? "px-3 pb-4" : "p-3"}`} aria-label="Portal sections">
          {sidebarOpen
            ? renderGroupedNav()
            : priorityLinks.map((link) => renderLink(link, false))}
        </nav>

        {/* Footer */}
        <div className={`p-4 border-t transition-colors duration-300 ${
          theme === "dark"
            ? "bg-gradient-to-r from-black to-gray-950 border-blue-500/10"
            : "bg-gradient-to-r from-white to-gray-50 border-blue-200"
        }`}>
          {sidebarOpen ? (
            <p className={`text-xs text-center leading-snug ${
              theme === "dark" ? "text-blue-100/70" : "text-blue-700"
            }`}>
              {roleDetails.footerText}
            </p>
          ) : null}
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {/* Topbar */}
        <header className={`flex min-h-[76px] items-center justify-between gap-3 border-b px-3 py-2 transition-colors sm:px-5 lg:px-7 ${
          theme === "dark"
            ? "border-slate-800 bg-slate-950 text-white"
            : "border-slate-200 bg-white text-slate-950"
        }`}>
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {/* Mobile Menu Toggle */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl outline-none transition active:scale-95 focus-visible:ring-2 focus-visible:ring-blue-500 xl:hidden ${
                theme === "dark"
                  ? "hover:bg-gray-800 text-gray-300 active:bg-gray-700"
                  : "hover:bg-blue-100 text-blue-900 active:bg-blue-200"
              }`}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
              aria-controls="portal-mobile-nav"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            {/* Current page — the chrome's persistent "where am I" anchor. A
                label, not a heading: each board renders its own <h1>. */}
            <div className="min-w-0">
              <div className={`truncate text-base font-bold leading-tight sm:text-lg ${theme === "dark" ? "text-white" : "text-slate-950"}`}>
                {currentPageName}
              </div>
              <div className={`hidden items-center gap-1 truncate text-[11px] leading-tight sm:flex ${theme === "dark" ? "text-slate-400" : "text-slate-600"}`} title={`${portalScopeName} / ${currentGroup}`}>
                <span className="truncate">{portalScopeName}</span><ChevronRight className="h-3 w-3 shrink-0" /><span className="truncate">{currentGroup}</span>
              </div>
            </div>

            {userRole !== "PLATFORM_ADMIN" && <WorkspaceSwitcher />}

            {/* Clock — hidden on smaller screens */}
            <div className={`text-sm hidden xl:block ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>
              <div id="current-time">
                {new Date(now).toLocaleTimeString()}
              </div>
            </div>
          </div>

          {/* Right Section: Theme + Profile */}
          <div className="flex items-center gap-1 sm:gap-3 md:gap-4">
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className={`flex h-11 w-11 items-center justify-center rounded-xl outline-none transition active:scale-95 focus-visible:ring-2 focus-visible:ring-blue-500 ${
                theme === "dark"
                  ? "hover:bg-gray-800 text-blue-400 active:bg-gray-700"
                  : "hover:bg-blue-100 text-blue-600 active:bg-blue-200"
              }`}
              title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            >
              {theme === "light" ? (
                <Moon className="w-5 h-5" />
              ) : (
                <Sun className="w-5 h-5" />
              )}
            </button>

            {/* Notification Bell Dropdown */}
            <div className="relative" ref={bellRef}>
              <button
                onClick={() => setBellDropdownOpen(!bellDropdownOpen)}
                className={`relative flex h-11 w-11 items-center justify-center rounded-xl outline-none transition active:scale-95 focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  theme === "dark"
                    ? "hover:bg-gray-800 text-gray-300 active:bg-gray-700"
                    : "hover:bg-blue-100 text-blue-900 active:bg-blue-200"
                }`}
                aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
                aria-haspopup="menu"
                aria-expanded={bellDropdownOpen}
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 flex h-4 w-4">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500 text-[10px] font-black text-white items-center justify-center">
                      {unreadCount}
                    </span>
                  </span>
                )}
              </button>

              {/* Notification dropdown card */}
              {bellDropdownOpen && (
                  <div className={`fixed inset-x-3 top-14 sm:absolute sm:inset-auto sm:right-0 sm:mt-3 sm:w-96 w-[calc(100vw-1.5rem)] rounded-2xl shadow-2xl border z-50 overflow-hidden transition-all duration-200 ${
                    theme === "dark"
                      ? "bg-gray-900 border-gray-700 text-white"
                      : "bg-white border-blue-200 text-gray-900"
                  }`}>
                    {/* Dropdown Header */}
                    <div className={`px-4 py-3 flex items-center justify-between border-b ${
                      theme === "dark" ? "border-gray-800 bg-gray-950/50" : "border-blue-50 bg-blue-50/30"
                    }`}>
                      <div className="flex items-center gap-2">
                        <Bell className="w-4 h-4 text-blue-500" />
                        <span className="font-bold text-sm">Notifications</span>
                      </div>
                      {unreadCount > 0 && (
                        <button
                          onClick={handleMarkAllRead}
                          className="text-xs font-semibold text-blue-600 hover:text-blue-700 transition"
                        >
                        Mark all as read
                      </button>
                    )}
                  </div>

                  {/* Dropdown List */}
                  <div className="max-h-[380px] overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
                    {visibleNotifications.length > 0 ? (
                      visibleNotifications.map((n) => {
                        const getNotificationIcon = (type: string) => {
                          switch (type) {
                            case "VITAL_ALERT":
                              return <Activity className="w-4 h-4 text-red-500" />;
                            case "INCIDENT_REPORT":
                              return <AlertTriangle className="w-4 h-4 text-orange-500" />;
                            case "MEDICATION_REMINDER":
                              return <Pill className="w-4 h-4 text-purple-500" />;
                            case "CALL_BELL":
                              return <BellRing className="w-4 h-4 text-yellow-500" />;
                            case "TASK_ASSIGNMENT":
                              return <CheckSquare className="w-4 h-4 text-green-500" />;
                            case "MESSAGE":
                              return <MessageSquare className="w-4 h-4 text-blue-500" />;
                            case "SHIFT_REMINDER":
                              return <Clock className="w-4 h-4 text-indigo-500" />;
                            case "TRANSPORT_UPDATE":
                              return <Bus className="w-4 h-4 text-cyan-500" />;
                            case "SYSTEM_ALERT":
                            default:
                              return <Zap className="w-4 h-4 text-teal-500" />;
                          }
                        };

                        const getNotificationBg = (type: string) => {
                          switch (type) {
                            case "VITAL_ALERT":
                              return "bg-red-50 dark:bg-red-950/30";
                            case "INCIDENT_REPORT":
                              return "bg-orange-50 dark:bg-orange-950/30";
                            case "MEDICATION_REMINDER":
                              return "bg-purple-50 dark:bg-purple-950/30";
                            case "CALL_BELL":
                              return "bg-yellow-50 dark:bg-yellow-950/30";
                            case "TASK_ASSIGNMENT":
                              return "bg-green-50 dark:bg-green-950/30";
                            case "MESSAGE":
                              return "bg-blue-50 dark:bg-blue-950/30";
                            case "SHIFT_REMINDER":
                              return "bg-indigo-50 dark:bg-indigo-950/30";
                            case "TRANSPORT_UPDATE":
                              return "bg-cyan-50 dark:bg-cyan-950/30";
                            case "SYSTEM_ALERT":
                            default:
                              return "bg-teal-50 dark:bg-teal-950/30";
                          }
                        };

                        const formatTimeAgo = (isoString: string) => {
                          try {
                            const past = new Date(isoString);
                            const diffMs = Date.now() - past.getTime();
                            const diffMins = Math.floor(diffMs / (60 * 1000));
                            if (diffMins < 1) return "Just now";
                            if (diffMins < 60) return `${diffMins}m ago`;
                            const diffHours = Math.floor(diffMins / 60);
                            if (diffHours < 24) return `${diffHours}h ago`;
                            return past.toLocaleDateString();
                          } catch {
                            return "";
                          }
                        };

                        return (
                          <div
                            key={n.id}
                            onClick={() => handleNotificationClick(n)}
                            className={`flex cursor-pointer gap-3 p-4 transition hover:bg-blue-50/10 ${n.severity === "CRITICAL" ? "ring-1 ring-inset ring-red-500/50" : n.severity === "WARNING" ? "ring-1 ring-inset ring-amber-500/50" : ""} ${
                              !n.isRead ? "bg-blue-50/5 dark:bg-blue-500/5 font-medium" : ""
                            }`}
                          >
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${getNotificationBg(n.type)}`}>
                              {getNotificationIcon(n.type)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-xs ${theme === "dark" ? "text-gray-400" : "text-gray-500"} float-right pl-2`}>
                                {formatTimeAgo(n.createdAt)}
                              </p>
                              <p className="text-sm font-bold truncate leading-snug">{n.title}</p>
                              {(n.severity === "CRITICAL" || n.severity === "WARNING") && (
                                <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${n.severity === "CRITICAL" ? "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200" : "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"}`}>
                                  {n.severity === "CRITICAL" ? "Critical" : "Warning"}
                                </span>
                              )}
                              <p className={`text-xs mt-0.5 line-clamp-2 leading-relaxed ${
                                theme === "dark" ? "text-gray-300" : "text-gray-600"
                              }`}>{n.message}</p>
                            </div>
                            {/* Snooze is RBAC-gated (Module 09) — full-control roles only. */}
                            {canAlertAction(userRole, "snooze") && (
                              <button
                                onClick={(e) => { e.stopPropagation(); void handleSnooze(n.id); }}
                                title="Snooze 1 hour"
                                className="self-center flex-shrink-0 text-[10px] font-semibold text-gray-400 hover:text-gray-700 px-1.5 py-1 rounded"
                              >
                                Snooze
                              </button>
                            )}
                            {!n.isRead && (
                              <div className="w-2 h-2 rounded-full bg-blue-500 self-center flex-shrink-0" />
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                        <CircleCheck className="mx-auto h-7 w-7 text-emerald-500" />
                        <p className="text-sm font-semibold mt-2">All caught up!</p>
                        <p className="text-xs text-gray-400 mt-1 mb-4">No notifications right now.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>


            {/* Profile Dropdown */}
            <div className="relative" ref={profileRef}>
              <button
                onClick={() =>
                  setProfileDropdownOpen(!profileDropdownOpen)
                }
                className={`flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  theme === "dark" ? "hover:bg-gray-800" : "hover:bg-blue-100"
                }`}
                aria-label="Account menu"
                aria-haspopup="menu"
                aria-expanded={profileDropdownOpen}
              >
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
                  {(profileName || roleDetails.profileName).charAt(0)}
                </div>
                <div className="text-sm text-left hidden sm:block">
                  <div className={`font-medium ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                    {(profileName || roleDetails.profileName).split(" ")[0]}
                  </div>
                  <div className={`text-xs ${theme === "dark" ? "text-gray-400" : "text-gray-600"}`}>
                    {roleDetails.badge}
                  </div>
                </div>
              </button>

              {/* Dropdown Menu */}
              {profileDropdownOpen && (
                <div className={`absolute right-0 mt-2 w-48 border rounded-lg shadow-xl z-50 ${
                  theme === "dark" 
                    ? "bg-gray-900 border-gray-700" 
                    : "bg-white border-blue-200"
                }`}>
                  <button
                    onClick={() => {
                      setProfileDropdownOpen(false);
                      setShowSettingsModal(true);
                    }}
                    className={`w-full text-left px-4 py-2 flex items-center gap-2 border-b transition-colors ${
                      theme === "dark"
                        ? "hover:bg-gray-800 border-gray-700 text-gray-200"
                        : "hover:bg-blue-50 border-blue-100 text-blue-900"
                    }`}
                  >
                    <Settings className="w-4 h-4" />
                    <span className="text-sm">Settings</span>
                  </button>
                  <button
                    onClick={() => {
                      setProfileDropdownOpen(false);
                      handleLogout();
                    }}
                    className={`w-full text-left px-4 py-2 flex items-center gap-2 transition-colors rounded-b-lg ${
                      theme === "dark"
                        ? "hover:bg-red-900/30 text-red-400"
                        : "hover:bg-red-50 text-red-600"
                    }`}
                  >
                    <LogOut className="w-4 h-4" />
                    <span className="text-sm">Logout</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Mobile Sidebar Overlay */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/55 xl:hidden"
              onClick={() => setMobileMenuOpen(false)}
            >
              <motion.aside
                initial={{ x: -320 }}
                animate={{ x: 0 }}
                exit={{ x: -320 }}
                className={`flex h-full w-[min(320px,92vw)] max-w-[320px] flex-col shadow-2xl transition-colors ${
                  theme === "dark"
                    ? "bg-gradient-to-b from-black to-gray-950 text-white"
                    : "bg-gradient-to-b from-white to-gray-100 text-gray-900"
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Mobile Sidebar Header */}
                <div className={`p-4 border-b flex items-center gap-2 transition-colors duration-300 ${
                  theme === "dark"
                    ? "bg-gradient-to-b from-black to-gray-950 border-blue-500/10"
                    : "bg-gradient-to-b from-white to-gray-100 border-blue-200"
                }`}>
                  <LcmsLogo />
                  <div className="min-w-0 flex-1">
                    <div className={`font-black text-sm leading-tight truncate ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                      {portalScopeName}
                    </div>
                    <div className={`text-[10px] font-bold truncate ${theme === "dark" ? "text-blue-300" : "text-blue-700"}`}>
                      {roleDetails.badge}
                    </div>
                  </div>
                  <button
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      theme === "dark" ? "hover:bg-gray-800 text-gray-400" : "hover:bg-gray-200 text-gray-500"
                    }`}
                    title="Close menu"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {renderNavSearch()}
                {/* Tablet and mobile navigation drawer */}
                <nav id="portal-mobile-nav" aria-label="Portal sections" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4 scrollbar-thin">
                  {renderGroupedNav()}
                </nav>

                {/* Mobile Sidebar Footer */}
                <div className={`p-4 border-t transition-colors duration-300 flex-shrink-0 ${
                  theme === "dark"
                    ? "bg-gradient-to-r from-black to-gray-950 border-blue-500/10"
                    : "bg-gradient-to-r from-white to-gray-50 border-blue-200"
                }`}>
                  <p className={`text-[10px] text-center leading-snug ${
                    theme === "dark" ? "text-blue-100/70" : "text-blue-700"
                  }`}>
                    {roleDetails.footerText}
                  </p>
                </div>
              </motion.aside>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Content Area */}
        <main className="min-h-0 flex-1 overflow-y-auto p-3 pb-24 sm:p-5 sm:pb-24 lg:p-7 lg:pb-7" style={{ height: 0 }}>
          <div className={["CARE_MANAGER", "NURSE", "CAREGIVER"].includes(userRole) ? "clinical-portal-content" : undefined}>
            {children}
          </div>
        </main>

        {/* Mobile task dock: the active workflow plus the most common clinical
            destinations stay thumb-reachable; the complete index lives in More. */}
        <nav aria-label="Quick portal navigation" className={`fixed inset-x-0 bottom-0 z-30 grid min-h-[72px] grid-cols-5 border-t px-1 pb-[env(safe-area-inset-bottom)] md:hidden ${theme === "dark" ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-white"}`}>
          {priorityLinks.slice(0, 4).map((link) => {
            const Icon = link.icon;
            const isActive = isLinkActive(link);
            const segment = link.route.split("/").pop();
            const label = segment === "dashboard" ? "Home" : segment === "alertcenter" ? "Alerts" : segment === "residents" ? "Residents" : segment === "carelogs" ? "Care logs" : segment === "mar" ? "MAR" : link.name;
            return (
              <Link key={`dock-${link.route}`} href={link.route} aria-current={isActive ? "page" : undefined} className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 px-1 text-[10px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${isActive ? "text-blue-600 dark:text-blue-300" : "text-slate-600 dark:text-slate-400"}`}>
                <Icon className="h-5 w-5" /><span className="w-full truncate text-center">{label}</span>
              </Link>
            );
          })}
          <button onClick={() => setMobileMenuOpen(true)} aria-label="Open all portal pages" className="flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 px-1 text-[10px] font-semibold text-slate-600 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:text-slate-400">
            <MoreHorizontal className="h-5 w-5" /><span>More</span>
          </button>
        </nav>
      </div>

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowSettingsModal(false); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="settings-title" className={`flex h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl shadow-2xl sm:h-[88dvh] sm:max-h-[760px] sm:max-w-3xl sm:rounded-2xl ${theme === "dark" ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-900"}`}>
            <div className="flex flex-none items-center justify-between border-b border-white/10 bg-gradient-to-r from-slate-950 to-slate-900 px-5 py-4 text-white sm:px-6">
              <div><h1 id="settings-title" className="text-xl font-black sm:text-2xl">Account settings</h1><p className="mt-0.5 text-xs text-slate-400">Profile, preferences, and account security</p></div>
              <button aria-label="Close settings" onClick={() => setShowSettingsModal(false)} className="rounded-xl p-2 text-slate-300 transition hover:bg-white/10 hover:text-white"><X className="h-5 w-5" /></button>
            </div>

            <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain p-4 scrollbar-thin sm:p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <section className={`rounded-2xl border p-4 sm:p-5 md:col-span-2 ${theme === "dark" ? "border-slate-800 bg-slate-900" : "border-slate-200 bg-white"}`}>
                  <div className="mb-4 flex items-center gap-3"><span className="rounded-xl bg-blue-100 p-2.5 text-blue-600"><UserIcon className="h-5 w-5" /></span><div><h2 className="font-bold">Profile</h2><p className={`text-xs ${theme === "dark" ? "text-slate-400" : "text-slate-500"}`}>Your name is shared across authorized SLMS workspaces.</p></div></div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-medium">Full name<input value={profileName} onChange={(event) => setProfileName(event.target.value)} maxLength={100} className={`mt-2 w-full rounded-xl border px-3 py-2.5 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 ${theme === "dark" ? "border-slate-700 bg-slate-950" : "border-slate-300 bg-white"}`} /></label>
                    <label className="text-sm font-medium">Email address<input value={profileEmail} disabled className={`mt-2 w-full rounded-xl border px-3 py-2.5 ${theme === "dark" ? "border-slate-700 bg-slate-800 text-slate-400" : "border-slate-200 bg-slate-100 text-slate-500"}`} /></label>
                    <label className="text-sm font-medium">Effective portal role<input value={roleDetails.name} disabled className={`mt-2 w-full rounded-xl border px-3 py-2.5 ${theme === "dark" ? "border-slate-700 bg-slate-800 text-slate-400" : "border-slate-200 bg-slate-100 text-slate-500"}`} /></label>
                    <div className="flex items-end"><p className={`rounded-xl p-3 text-xs ${theme === "dark" ? "bg-slate-950 text-slate-400" : "bg-blue-50 text-blue-700"}`}>Roles and workspace access are managed by an authorized administrator and cannot be changed here.</p></div>
                  </div>
                </section>

                <section className={`rounded-2xl border p-4 sm:p-5 ${theme === "dark" ? "border-slate-800 bg-slate-900" : "border-slate-200 bg-white"}`}>
                  <div className="mb-4 flex items-center gap-3"><span className="rounded-xl bg-blue-100 p-2.5 text-blue-600"><Bell className="h-5 w-5" /></span><div><h2 className="font-bold">Notifications</h2><p className={`text-xs ${theme === "dark" ? "text-slate-400" : "text-slate-500"}`}>Choose how this device alerts you.</p></div></div>
                  <div className="space-y-3">
                    <label className={`flex cursor-pointer items-center justify-between rounded-xl border p-3 ${theme === "dark" ? "border-slate-700" : "border-slate-200"}`}><span><b className="block text-sm">Push notifications</b><span className={`text-xs ${theme === "dark" ? "text-slate-400" : "text-slate-500"}`}>Browser alerts on this device</span></span><input type="checkbox" checked={notifications} onChange={(event) => setNotifications(event.target.checked)} className="h-5 w-5 accent-blue-600" /></label>
                    <label className={`flex cursor-pointer items-center justify-between rounded-xl border p-3 ${theme === "dark" ? "border-slate-700" : "border-slate-200"}`}><span><b className="block text-sm">Critical email alerts</b><span className={`text-xs ${theme === "dark" ? "text-slate-400" : "text-slate-500"}`}>High-priority account events</span></span><input type="checkbox" checked={emailAlerts} onChange={(event) => setEmailAlerts(event.target.checked)} className="h-5 w-5 accent-blue-600" /></label>
                  </div>
                </section>

                <section className={`rounded-2xl border p-4 sm:p-5 ${theme === "dark" ? "border-slate-800 bg-slate-900" : "border-slate-200 bg-white"}`}>
                  <div className="mb-4 flex items-center gap-3"><span className="rounded-xl bg-emerald-100 p-2.5 text-emerald-600"><Globe className="h-5 w-5" /></span><div><h2 className="font-bold">Language</h2><p className={`text-xs ${theme === "dark" ? "text-slate-400" : "text-slate-500"}`}>Set your interface preference.</p></div></div>
                  <label className="text-sm font-medium">Preferred language<select value={language} onChange={(event) => setLanguage(event.target.value)} className={`mt-2 w-full rounded-xl border px-3 py-2.5 outline-none focus:border-blue-500 ${theme === "dark" ? "border-slate-700 bg-slate-950" : "border-slate-300 bg-white"}`}><option value="en">English</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option></select></label>
                  <p className={`mt-3 text-xs ${theme === "dark" ? "text-slate-400" : "text-slate-500"}`}>This records your preference; translated application content will be introduced progressively.</p>
                </section>

                <section className={`rounded-2xl border p-4 sm:p-5 md:col-span-2 ${theme === "dark" ? "border-slate-800 bg-slate-900" : "border-slate-200 bg-white"}`}>
                  <div className="mb-4 flex items-center gap-3"><span className="rounded-xl bg-rose-100 p-2.5 text-rose-600"><Lock className="h-5 w-5" /></span><div><h2 className="font-bold">Security</h2><p className={`text-xs ${theme === "dark" ? "text-slate-400" : "text-slate-500"}`}>Manage credentials for your own account.</p></div></div>
                  <div className="grid gap-3 sm:grid-cols-2"><button onClick={() => void handleChangePassword()} className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${theme === "dark" ? "border-slate-700 hover:bg-slate-800" : "border-slate-200 hover:border-blue-300 hover:bg-blue-50"}`}>Change password</button><button onClick={() => setShowPinSetup(true)} className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${theme === "dark" ? "border-slate-700 hover:bg-slate-800" : "border-slate-200 hover:border-blue-300 hover:bg-blue-50"}`}>4-digit signing PIN</button></div>
                </section>
              </div>
            </div>

            <div className={`flex flex-none items-center justify-between gap-3 border-t px-4 py-3 sm:px-6 ${theme === "dark" ? "border-slate-800 bg-slate-900" : "border-slate-200 bg-white"}`}>
              <button onClick={() => setShowSettingsModal(false)} className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${theme === "dark" ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100"}`}>Cancel</button>
              <button disabled={settingsSaving} onClick={() => void handleSaveSettings()} className="inline-flex min-w-32 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:shadow-lg disabled:opacity-60">{settingsSaving && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}Save changes</button>
            </div>
          </div>
        </div>
      )}

      <ChangePasswordDialog open={showChangePassword} onOpenChange={setShowChangePassword} />
      <SignatureModal open={showPinSetup} onClose={() => setShowPinSetup(false)} mode="manage" title="Your signing PIN" description="Your personal 4-digit code (auto-issued). Use it to sign and finalise data such as shift endorsements. Reveal it below or regenerate a new one." />
      <LogoutDialog open={showLogout} onOpenChange={setShowLogout} onConfirm={handleConfirmLogout} />
    </div>
  );
}
