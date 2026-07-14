"use client";

import { useState, ReactNode, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Swal from "sweetalert2";
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
} from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Role, RoleDetails, ROLES } from "@/constants/roleConfig";

interface PortalShellProps {
  userRole: Role;
  activeTab: string;
  children: ReactNode;
  onLogout?: () => void;
}

export default function PortalShell({
  userRole,
  activeTab,
  children,
  onLogout,
}: PortalShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [language, setLanguage] = useState("en");
  const [now, setNow] = useState(() => Date.now());
  const { facilityName } = useFacilityConfig();

  // Session details from GET /api/auth/session
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  
  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated) {
          setSessionUserId(data.userId || "demo-user");
        }
      })
      .catch((err) => console.warn("Failed to get session:", err));
  }, []);

  // Fetch notifications in real-time
  const { data: notificationsData, refetch: refetchNotifications } = useLiveQuery<{
    id: string;
    type: string;
    title: string;
    message: string;
    isRead: boolean;
    createdAt: string;
  }>("notifications", {
    query: sessionUserId ? `f_userId=${sessionUserId}` : undefined,
    tables: ["Notification"],
  });

  const [bellDropdownOpen, setBellDropdownOpen] = useState(false);

  // Compute unread count
  const unreadNotifications = notificationsData?.filter((n) => !n.isRead) || [];
  const unreadCount = unreadNotifications.length;

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


  const roleDetails: RoleDetails = ROLES[userRole];

  // The sidebar is the role's own comprehensive feature set — fixed and
  // consistent. It was previously derived from the polled `portal_matrix`
  // app-setting, which caused two bugs: a load→loaded flip that made the nav
  // items blink on every mount, and injection of cross-role features that mapped
  // to routes the portal can't render (an inconsistent, bloated sidebar). Each
  // role's sidebarLinks in roleConfig is now the single source of truth.
  const filteredLinks = roleDetails.sidebarLinks;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);



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

  const handleLogout = async () => {
    const result = await Swal.fire({
      title: "Logout Confirmation",
      text: "Are you sure you want to logout?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Yes, Logout",
      cancelButtonText: "Cancel",
      background: theme === "dark" ? "#1f2937" : "#ffffff",
      color: theme === "dark" ? "#ffffff" : "#000000",
    });

    if (result.isConfirmed) {
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
    }
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

  return (
    <div className={`flex h-screen ${theme === "dark" ? "bg-black text-white" : "bg-gray-50 text-gray-900"}`}>
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? "w-64" : "w-20"
        } transition-all duration-300 flex flex-col shadow-2xl hidden md:flex ${
          theme === "dark"
            ? "bg-gradient-to-b from-black to-gray-950 text-white"
            : "bg-gradient-to-b from-white to-gray-100 text-gray-900 border-r border-gray-200"
        }`}
      >
        {/* Brand Header */}
        <div className={`p-4 border-b flex items-center justify-between transition-colors duration-300 ${
          theme === "dark"
            ? "bg-gradient-to-r from-black to-gray-950 border-yellow-500/10"
            : "bg-gradient-to-r from-white to-gray-50 border-yellow-200"
        }`}>
          {sidebarOpen && (
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-gradient-to-br from-yellow-400 to-yellow-500 rounded-lg flex items-center justify-center text-black font-bold text-lg">
                ♥
              </div>
              <div className="text-sm">
                <div className={`font-black text-lg leading-tight ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{facilityName || "Care Portal"}</div>
                <div className={`text-xs font-bold ${theme === "dark" ? "text-yellow-300" : "text-yellow-700"}`}>{roleDetails.badge}</div>
              </div>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className={`p-2 rounded-lg transition text-yellow-400 active:bg-gray-600 ${
              theme === "dark"
                ? "hover:bg-gray-700"
                : "hover:bg-gray-200"
            }`}
            title={sidebarOpen ? "Collapse" : "Expand"}
          >
            {sidebarOpen ? (
              <ChevronLeft className="w-5 h-5" />
            ) : (
              <ChevronRight className="w-5 h-5" />
            )}
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {filteredLinks.map((link) => {
            const isActive = pathname.includes(link.route);
            const Icon = link.icon;
            return (
              <Link
                key={`${link.name}-${link.route}`}
                href={link.route}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg transition ${
                  isActive
                    ? theme === "dark"
                      ? "bg-gradient-to-r from-yellow-500/20 to-yellow-400/10 text-yellow-300 border-l-2 border-yellow-400"
                      : "bg-yellow-100 text-yellow-700 border-l-2 border-yellow-500"
                    : theme === "dark"
                    ? "text-gray-300 hover:bg-gray-700/50 hover:text-white"
                    : "text-gray-700 hover:bg-gray-200 hover:text-gray-900"
                }`}
              >
                <Icon className="flex-shrink-0 w-5 h-5" />
                {sidebarOpen && <span className="text-sm font-semibold">{link.name}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className={`p-4 border-t transition-colors duration-300 ${
          theme === "dark"
            ? "bg-gradient-to-r from-black to-gray-950 border-yellow-500/10"
            : "bg-gradient-to-r from-white to-gray-50 border-yellow-200"
        }`}>
          {sidebarOpen && (
            <p className={`text-xs text-center leading-snug ${
              theme === "dark" ? "text-yellow-100/70" : "text-yellow-700"
            }`}>
              {roleDetails.footerText}
            </p>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className={`border-b px-4 md:px-6 py-4 flex items-center justify-between shadow-sm transition-colors duration-300 ${
          theme === "dark"
            ? "bg-gradient-to-r from-gray-900 to-black border-yellow-500/20 text-white"
            : "bg-gradient-to-r from-white to-gray-50 border-yellow-200 text-gray-900"
        }`}>
          <div className="flex items-center gap-4">
            {/* Mobile Menu Toggle */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className={`md:hidden p-2 rounded-lg transition active:scale-95 ${
                theme === "dark"
                  ? "hover:bg-gray-800 text-gray-300 active:bg-gray-700"
                  : "hover:bg-yellow-100 text-gray-700 active:bg-yellow-200"
              }`}
              title={mobileMenuOpen ? "Close menu" : "Open menu"}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            {/* Clock */}
            <div className={`text-sm ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>
              <div id="current-time">
                {new Date(now).toLocaleTimeString()}
              </div>
            </div>
          </div>

          {/* Right Section: Theme + Profile */}
          <div className="flex items-center gap-4">
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className={`p-2 rounded-lg transition active:scale-95 ${
                theme === "dark"
                  ? "hover:bg-gray-800 text-yellow-400 active:bg-gray-700"
                  : "hover:bg-yellow-100 text-yellow-600 active:bg-yellow-200"
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
            <div className="relative">
              <button
                onClick={() => setBellDropdownOpen(!bellDropdownOpen)}
                className={`p-2 rounded-lg relative transition active:scale-95 ${
                  theme === "dark"
                    ? "hover:bg-gray-800 text-gray-300 active:bg-gray-700"
                    : "hover:bg-yellow-100 text-gray-700 active:bg-yellow-200"
                }`}
                title="Notifications"
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
                <div className={`fixed inset-x-4 top-16 sm:absolute sm:inset-auto sm:right-0 sm:mt-3 sm:w-96 rounded-2xl shadow-2xl border z-50 overflow-hidden transition-all duration-200 ${
                  theme === "dark"
                    ? "bg-gray-900 border-gray-700 text-white"
                    : "bg-white border-yellow-100 text-gray-900"
                }`}>
                  {/* Dropdown Header */}
                  <div className={`px-4 py-3 flex items-center justify-between border-b ${
                    theme === "dark" ? "border-gray-800 bg-gray-950/50" : "border-yellow-50 bg-yellow-50/30"
                  }`}>
                    <div className="flex items-center gap-2">
                      <Bell className="w-4 h-4 text-yellow-500" />
                      <span className="font-bold text-sm">Notifications</span>
                    </div>
                    {unreadCount > 0 && (
                      <button
                        onClick={handleMarkAllRead}
                        className="text-xs font-semibold text-yellow-600 hover:text-yellow-700 transition"
                      >
                        Mark all as read
                      </button>
                    )}
                  </div>

                  {/* Dropdown List */}
                  <div className="max-h-[380px] overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
                    {notificationsData && notificationsData.length > 0 ? (
                      notificationsData.map((n) => {
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
                            onClick={() => !n.isRead && handleMarkSingleRead(n.id)}
                            className={`p-4 flex gap-3 transition cursor-pointer hover:bg-yellow-50/10 ${
                              !n.isRead ? "bg-yellow-50/5 dark:bg-yellow-500/5 font-medium" : ""
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
                              <p className={`text-xs mt-0.5 line-clamp-2 leading-relaxed ${
                                theme === "dark" ? "text-gray-300" : "text-gray-600"
                              }`}>{n.message}</p>
                            </div>
                            {!n.isRead && (
                              <div className="w-2 h-2 rounded-full bg-blue-500 self-center flex-shrink-0" />
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                        <p className="text-2xl">🎉</p>
                        <p className="text-sm font-semibold mt-2">All caught up!</p>
                        <p className="text-xs text-gray-400 mt-1 mb-4">No notifications right now.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>


            {/* Profile Dropdown */}
            <div className="relative">
              <button
                onClick={() =>
                  setProfileDropdownOpen(!profileDropdownOpen)
                }
                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition ${
                  theme === "dark" ? "hover:bg-gray-800" : "hover:bg-yellow-100"
                }`}
              >
                <div className="w-8 h-8 bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-full flex items-center justify-center text-black text-sm font-bold">
                  {roleDetails.profileName.charAt(0)}
                </div>
                <div className="text-sm text-left hidden sm:block">
                  <div className={`font-medium ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                    {roleDetails.profileName.split(" ")[0]}
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
                    : "bg-white border-yellow-200"
                }`}>
                  <button
                    onClick={() => {
                      setProfileDropdownOpen(false);
                      setShowSettingsModal(true);
                    }}
                    className={`w-full text-left px-4 py-2 flex items-center gap-2 border-b transition-colors ${
                      theme === "dark"
                        ? "hover:bg-gray-800 border-gray-700 text-gray-200"
                        : "hover:bg-yellow-50 border-yellow-100 text-gray-700"
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
              className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
              onClick={() => setMobileMenuOpen(false)}
            >
              <motion.aside
                initial={{ x: -300 }}
                animate={{ x: 0 }}
                exit={{ x: -300 }}
                className={`w-64 h-full shadow-2xl transition-colors duration-300 ${
                  theme === "dark"
                    ? "bg-gradient-to-b from-black to-gray-950 text-white"
                    : "bg-gradient-to-b from-white to-gray-100 text-gray-900"
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className={`p-4 border-b transition-colors duration-300 ${
                  theme === "dark"
                    ? "bg-gradient-to-r from-black to-gray-950 border-yellow-500/10"
                    : "bg-gradient-to-r from-white to-gray-50 border-yellow-200"
                }`}>
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 bg-gradient-to-br from-yellow-400 to-yellow-500 rounded-lg flex items-center justify-center text-black font-bold text-lg">
                      ♥
                    </div>
                    <div className="text-sm">
                      <div className={`font-black text-lg leading-tight ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{facilityName || "Care Portal"}</div>
                      <div className={`text-xs font-bold ${theme === "dark" ? "text-yellow-300" : "text-yellow-700"}`}>
                        {roleDetails.badge}
                      </div>
                    </div>
                  </div>
                </div>

                <nav className="p-4 space-y-2">
                  {filteredLinks.map((link) => {
                    const isActive = pathname.includes(link.route);
                    const Icon = link.icon;
                    return (
                      <Link
                        key={`${link.name}-${link.route}`}
                        href={link.route}
                        onClick={() => setMobileMenuOpen(false)}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg transition ${
                          isActive
                            ? theme === "dark"
                              ? "bg-gradient-to-r from-yellow-500/20 to-yellow-400/10 text-yellow-300 border-l-2 border-yellow-400"
                              : "bg-yellow-100 text-yellow-700 border-l-2 border-yellow-500"
                            : theme === "dark"
                            ? "text-gray-300 hover:bg-gray-700/50 hover:text-white"
                            : "text-gray-700 hover:bg-gray-200 hover:text-gray-900"
                        }`}
                      >
                        <Icon className="flex-shrink-0 w-5 h-5" />
                        <span className="text-sm font-semibold">{link.name}</span>
                      </Link>
                    );
                  })}
                </nav>
              </motion.aside>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Content Area */}
        <main className="flex-1 overflow-auto p-4 md:p-6">
          {children}
        </main>
      </div>

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className={`rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto ${
            theme === "dark" ? "bg-gray-900" : "bg-white"
          }`}>
            {/* Header */}
            <div className="sticky top-0 bg-gradient-to-r from-gray-900 to-black text-white p-6 flex items-center justify-between border-b border-yellow-300">
              <h1 className="text-2xl font-bold">Settings</h1>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="p-2 hover:bg-gray-700 rounded-lg transition"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Content */}
            <div className="p-8 space-y-8">
              {/* Profile Section */}
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-yellow-100 rounded-lg">
                    <UserIcon className="w-5 h-5 text-yellow-600" />
                  </div>
                  <h2 className={`text-xl font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Profile</h2>
                </div>
                <div className="space-y-4 pl-11">
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}>
                      Full Name
                    </label>
                    <input
                      type="text"
                      defaultValue={roleDetails.profileName}
                      className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none ${
                        theme === "dark"
                          ? "bg-gray-800 border-gray-700 text-white"
                          : "bg-white border-gray-300 text-gray-900"
                      }`}
                    />
                  </div>
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}>
                      Role
                    </label>
                    <input
                      type="text"
                      defaultValue={roleDetails.name}
                      disabled
                      className={`w-full px-4 py-2 border rounded-lg outline-none ${
                        theme === "dark"
                          ? "bg-gray-700 border-gray-600 text-gray-400"
                          : "bg-gray-50 border-gray-300 text-gray-600"
                      }`}
                    />
                  </div>
                </div>
              </div>

              {/* Notifications Section */}
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Bell className="w-5 h-5 text-blue-600" />
                  </div>
                  <h2 className={`text-xl font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Notifications</h2>
                </div>
                <div className="space-y-4 pl-11">
                  <label className={`flex items-center gap-3 cursor-pointer ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}>
                    <input
                      type="checkbox"
                      checked={notifications}
                      onChange={(e) => setNotifications(e.target.checked)}
                      className="w-5 h-5 rounded"
                    />
                    <span className="text-sm">Enable push notifications</span>
                  </label>
                  <label className={`flex items-center gap-3 cursor-pointer ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}>
                    <input
                      type="checkbox"
                      checked={emailAlerts}
                      onChange={(e) => setEmailAlerts(e.target.checked)}
                      className="w-5 h-5 rounded"
                    />
                    <span className="text-sm">Email alerts for critical events</span>
                  </label>
                </div>
              </div>

              {/* Language Section */}
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-green-100 rounded-lg">
                    <Globe className="w-5 h-5 text-green-600" />
                  </div>
                  <h2 className={`text-xl font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Language</h2>
                </div>
                <div className="space-y-4 pl-11">
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none ${
                      theme === "dark"
                        ? "bg-gray-800 border-gray-700 text-white"
                        : "bg-white border-gray-300 text-gray-900"
                    }`}
                  >
                    <option value="en">English</option>
                    <option value="es">Spanish</option>
                    <option value="fr">French</option>
                    <option value="de">German</option>
                  </select>
                </div>
              </div>

              {/* Security Section */}
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-red-100 rounded-lg">
                    <Lock className="w-5 h-5 text-red-600" />
                  </div>
                  <h2 className={`text-xl font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Security</h2>
                </div>
                <div className="space-y-4 pl-11">
                  <button className={`w-full px-4 py-2 font-medium rounded-lg transition ${
                    theme === "dark"
                      ? "bg-gray-800 hover:bg-gray-700 text-white"
                      : "bg-gray-100 hover:bg-gray-200 text-gray-900"
                  }`}>
                    Change Password
                  </button>
                  <button className={`w-full px-4 py-2 font-medium rounded-lg transition ${
                    theme === "dark"
                      ? "bg-gray-800 hover:bg-gray-700 text-white"
                      : "bg-gray-100 hover:bg-gray-200 text-gray-900"
                  }`}>
                    Two-Factor Authentication
                  </button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className={`sticky bottom-0 px-8 py-4 flex items-center justify-between border-t ${
              theme === "dark"
                ? "bg-gray-800 border-gray-700"
                : "bg-gray-50 border-gray-200"
            }`}>
              <button
                onClick={() => setShowSettingsModal(false)}
                className={`px-6 py-2 rounded-lg transition ${
                  theme === "dark"
                    ? "text-gray-300 hover:bg-gray-700"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                Close
              </button>
              <button className="px-6 py-2 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black font-semibold rounded-lg hover:shadow-lg transition">
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
