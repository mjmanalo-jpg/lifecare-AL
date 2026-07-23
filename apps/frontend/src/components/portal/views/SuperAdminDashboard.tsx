"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Users, ShieldCheck, Sparkles, Database, AlertTriangle, CheckCircle2,
  UserCheck, UserX, Bell, ArrowRight, Activity, ClipboardList, BellRing,
  DollarSign, UserRound, BarChart3, Settings, type LucideIcon,
} from "lucide-react";
import Swal from "sweetalert2";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from "recharts";
import { useLiveQuery, useStats } from "@/lib/useLiveQuery";
import { updateRecord } from "@/lib/api";
import { humanize } from "@/lib/adapters";
import { ROLES, GLOBAL_FEATURES, type Role } from "@/constants/roleConfig";

/* ── Types & metadata ────────────────────────────────────────────────── */

const ALL_ROLES: Role[] = ["SUPERADMIN", "FACILITY_ADMIN", "PHYSICIAN", "NURSE", "CAREGIVER", "FAMILY", "RESIDENT"];

const ROLE_BAR_COLORS = ["#eab308", "#3b82f6", "#14b8a6", "#ec4899", "#22c55e", "#a855f7", "#f97316"];

const asStr = (v: unknown): string => (v == null ? "" : String(v));

function relTime(iso: string | null, nowTs: number): string {
  if (!iso || !nowTs) return "—";
  const m = Math.round((nowTs - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/* ── Component ───────────────────────────────────────────────────────── */

/**
 * Super Admin home — platform governance, not facility care. Everything here
 * is unique to this role: user administration, staff approvals, portal-matrix
 * coverage, and real cross-model telemetry (no facility-level duplication).
 */
export default function SuperAdminDashboard() {
  const router = useRouter();
  const { stats } = useStats();

  const { data: userRows } = useLiveQuery<Record<string, unknown>>(
    "users", { query: "take=500", tables: ["User"] }
  );
  const { data: staffRows, refetch: refetchStaff } = useLiveQuery<Record<string, unknown>>(
    "staff", { query: "include=user&take=200", tables: ["Staff", "User"] }
  );
  const { data: settingRows } = useLiveQuery<Record<string, unknown>>(
    "app-settings", { tables: ["AppSetting"] }
  );
  const { data: kbRows } = useLiveQuery<Record<string, unknown>>(
    "knowledge-docs", { query: "take=100", tables: ["KnowledgeDoc"] }
  );
  const { data: notifRows } = useLiveQuery<Record<string, unknown>>(
    "notifications", { query: "take=30", tables: ["Notification"] }
  );

  const [approvingId, setApprovingId] = useState<string | null>(null);

  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  const demoMode = Boolean((stats as { demo?: boolean } | null)?.demo);

  /* Users grouped by portal role — live user administration view. */
  const usersByRole = useMemo(() => {
    const counts = new Map<string, number>();
    userRows.forEach((u) => {
      const role = asStr(u.role) || "UNASSIGNED";
      counts.set(role, (counts.get(role) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([name, Accounts]) => ({ name: humanize(name), Accounts }))
      .sort((a, b) => b.Accounts - a.Accounts);
  }, [userRows]);

  /* Staff awaiting approval — the super admin's action queue. */
  const pendingStaff = useMemo(() => staffRows
    .filter((s) => s.isApproved === false)
    .map((s) => {
      const user = s.user as { name?: string; email?: string } | undefined;
      return {
        id: String(s.id),
        name: user?.name ?? "Staff member",
        email: user?.email ?? "",
        position: asStr(s.position),
        department: asStr(s.department),
      };
    }), [staffRows]);

  /* Portal-matrix coverage per role (same storage the Matrix editor writes). */
  const matrixCoverage = useMemo(() => {
    const total = Object.keys(GLOBAL_FEATURES).length;
    const stored = settingRows.find((s) => String(s.key || s.id) === "portal_matrix")?.value;
    let parsed: Record<string, Record<string, boolean>> = {};
    try {
      parsed = stored ? JSON.parse(String(stored)) : {};
    } catch { /* corrupt setting — fall back to sidebar defaults */ }
    return ALL_ROLES.map((r) => {
      const defaults = new Set(ROLES[r].sidebarLinks.map((l) => l.name));
      const enabled = Object.keys(GLOBAL_FEATURES)
        .filter((f) => parsed[r]?.[f] ?? defaults.has(f)).length;
      return { role: r, label: ROLES[r].name, enabled, total };
    });
  }, [settingRows]);

  const notifications = useMemo(() => notifRows.slice(0, 8).map((n) => ({
    id: String(n.id),
    title: asStr(n.title) || humanize(asStr(n.type)) || "Notification",
    message: asStr(n.message),
    isRead: Boolean(n.isRead),
    createdAt: n.createdAt ? String(n.createdAt) : null,
  })), [notifRows]);

  const handleApprove = async (id: string, name: string) => {
    setApprovingId(id);
    try {
      await updateRecord("staff", id, { isApproved: true, isActive: true });
      await refetchStaff();
      Swal.fire({ title: "Approved", text: `${name} can now access their portal.`, icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Approval Failed", text: err instanceof Error ? err.message : "Could not approve.", icon: "error" });
    } finally {
      setApprovingId(null);
    }
  };

  const handleReject = async (id: string, name: string) => {
    const result = await Swal.fire({
      title: "Reject Application?",
      text: `${name} will be deactivated and kept unapproved.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Reject",
    });
    if (!result.isConfirmed) return;
    try {
      await updateRecord("staff", id, { isApproved: false, isActive: false });
      await refetchStaff();
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not reject.", icon: "error" });
    }
  };

  /* Real cross-portal telemetry from /api/stats — replaces mock numbers. */
  const OPS_TILES: { label: string; value: number; icon: LucideIcon; color: string }[] = [
    { label: "Residents", value: stats?.residents ?? 0, icon: UserRound, color: "text-blue-500 bg-blue-50 border-blue-200" },
    { label: "Active Incidents", value: stats?.activeIncidents ?? 0, icon: AlertTriangle, color: "text-red-500 bg-red-50 border-red-200" },
    { label: "Staff On Duty", value: stats?.activeStaff ?? 0, icon: Users, color: "text-green-500 bg-green-50 border-green-200" },
    { label: "Open Tasks", value: stats?.openTasks ?? 0, icon: ClipboardList, color: "text-amber-500 bg-amber-50 border-amber-200" },
    { label: "Pending Call Bells", value: stats?.pendingCallBells ?? 0, icon: BellRing, color: "text-orange-500 bg-orange-50 border-orange-200" },
    { label: "Overdue Invoices", value: stats?.overdueInvoices ?? 0, icon: DollarSign, color: "text-purple-500 bg-purple-50 border-purple-200" },
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-1 flex items-center gap-2">
            <Settings className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 text-yellow-500 flex-shrink-0" /> Admin Dashboard
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-xs sm:text-sm">
            <span className="inline-flex items-center gap-1 text-green-600">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live
            </span>
            Platform governance — users, approvals, portals &amp; system telemetry
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs sm:text-sm font-semibold border self-start sm:self-auto ${
          demoMode ? "bg-amber-50 text-amber-700 border-amber-300" : "bg-green-50 text-green-700 border-green-300"
        }`}>
          <Database className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> {demoMode ? "Demo Mode — no database connected" : "Live Database"}
        </span>
      </div>

      {/* Platform stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 lg:gap-4">
        <Stat label="User Accounts" value={userRows.length} icon={Users} tone="gray" />
        <Stat label="Pending Approvals" value={pendingStaff.length} icon={UserCheck} tone={pendingStaff.length > 0 ? "red" : "green"} />
        <Stat label="Configured Portals" value={ALL_ROLES.length} icon={ShieldCheck} tone="blue" />
        <Stat label="AI Knowledge Docs" value={kbRows.length} icon={Sparkles} tone="amber" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left column — user administration & telemetry */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-yellow-500" /> User Accounts by Portal Role
            </h3>
            {usersByRole.length ? (
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={usersByRole} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={28} />
                  <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                  <Bar dataKey="Accounts" radius={[4, 4, 0, 0]}>
                    {usersByRole.map((_, i) => <Cell key={i} fill={ROLE_BAR_COLORS[i % ROLE_BAR_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-gray-500 py-8 text-center">No user accounts yet.</p>
            )}
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4 text-yellow-500" /> Operations Snapshot — Live Across All Portals
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3">
              {OPS_TILES.map(({ label, value, icon: Icon, color }) => (
                <div key={label} className={`p-2.5 sm:p-3 rounded-lg border ${color.split(" ").slice(1).join(" ")}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] sm:text-xs text-gray-600 font-semibold">{label}</p>
                    <Icon className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${color.split(" ")[0]}`} />
                  </div>
                  <p className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900 mt-1">{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Recent platform activity */}
          <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Bell className="w-4 h-4 text-yellow-500" /> Recent Platform Activity
            </h3>
            {notifications.length ? (
              <div className="space-y-2">
                {notifications.map((n) => (
                  <div key={n.id} className={`flex items-start gap-3 p-2.5 rounded-lg border ${n.isRead ? "bg-gray-50 border-gray-100" : "bg-yellow-50/60 border-yellow-200"}`}>
                    <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${n.isRead ? "bg-gray-300" : "bg-yellow-400"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900 truncate">{n.title}</p>
                      <p className="text-xs text-gray-600 line-clamp-1">{n.message}</p>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">{relTime(n.createdAt, nowTs)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 py-6 text-center">No notifications yet.</p>
            )}
          </div>
        </div>

        {/* Right column — approvals & portal matrix */}
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-yellow-500" /> Staff Approval Queue
              </h3>
              {pendingStaff.length > 0 && (
                <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-bold">{pendingStaff.length}</span>
              )}
            </div>
            {pendingStaff.length ? (
              <div className="space-y-2">
                {pendingStaff.slice(0, 6).map((s) => (
                  <div key={s.id} className="p-3 bg-amber-50/60 rounded-lg border border-amber-200">
                    <p className="text-sm font-semibold text-gray-900 truncate">{s.name}</p>
                    <p className="text-xs text-gray-600 truncate">{s.position}{s.department ? ` • ${s.department}` : ""}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <button onClick={() => void handleApprove(s.id, s.name)} disabled={approvingId === s.id}
                        className="flex items-center gap-1 px-2.5 py-1 bg-gradient-to-r from-green-400 to-green-500 text-white rounded text-xs font-semibold hover:shadow transition disabled:opacity-50">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                      </button>
                      <button onClick={() => void handleReject(s.id, s.name)}
                        className="flex items-center gap-1 px-2.5 py-1 text-red-600 border border-red-200 bg-red-50 rounded text-xs font-semibold hover:bg-red-100 transition">
                        <UserX className="w-3.5 h-3.5" /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center">
                <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto mb-1" />
                <p className="text-sm text-gray-500">No approvals waiting.</p>
              </div>
            )}
            <button onClick={() => router.push("/superadmin/staff")}
              className="mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
              Open Staff Registry <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-yellow-500" /> Portal Matrix Coverage
            </h3>
            <div className="space-y-2.5">
              {matrixCoverage.map(({ role, label, enabled, total }) => (
                <div key={role}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-semibold text-gray-700">{label}</span>
                    <span className="text-gray-500">{enabled}/{total} features</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full transition-all"
                      style={{ width: `${total ? Math.round((enabled / total) * 100) : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => router.push("/superadmin/matrix")}
              className="mt-4 w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
              Configure Portal Matrix <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Presentational sub-components ───────────────────────────────────── */

const TONES: Record<string, { wrap: string; icon: string; value: string }> = {
  gray: { wrap: "bg-white border-gray-200", icon: "text-gray-500", value: "text-gray-900" },
  blue: { wrap: "bg-blue-50 border-blue-200", icon: "text-blue-500", value: "text-blue-600" },
  red: { wrap: "bg-red-50 border-red-200", icon: "text-red-500", value: "text-red-600" },
  green: { wrap: "bg-green-50 border-green-200", icon: "text-green-500", value: "text-green-600" },
  amber: { wrap: "bg-amber-50 border-amber-200", icon: "text-amber-500", value: "text-amber-600" },
};

function Stat({ label, value, icon: Icon, tone }: { label: string; value: number; icon: LucideIcon; tone: keyof typeof TONES }) {
  const t = TONES[tone];
  return (
    <div className={`p-3 sm:p-4 rounded-lg border ${t.wrap}`}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] sm:text-xs sm:text-sm text-gray-600 font-semibold">{label}</p>
        <Icon className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${t.icon}`} />
      </div>
      <p className={`text-xl sm:text-2xl md:text-3xl font-bold mt-1 ${t.value}`}>{value}</p>
    </div>
  );
}
