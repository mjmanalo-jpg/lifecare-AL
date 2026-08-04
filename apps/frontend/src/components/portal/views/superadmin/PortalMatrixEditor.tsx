"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { ShieldCheck, ToggleLeft, ToggleRight, CheckSquare, Square } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { ROLES, type Role, GLOBAL_FEATURES } from "@/constants/roleConfig";

/* ─── Portal Matrix Editor ─────────────────────────────────────────────── */

/** All roles we want to configure. */
const ALL_ROLES: Role[] = [
  "SUPERADMIN",
  "FACILITY_ADMIN",
  "PHYSICIAN",
  "NURSE",
  "CAREGIVER",
  "FAMILY",
  "RESIDENT",
  "FLEET_MANAGEMENT",
  "DRIVER",
  "SECURITY",
];

/** Friendly labels for the role keys. */
const ROLE_LABELS: Record<Role, string> = {
  PLATFORM_ADMIN: "Platform Admin",
  ORGANIZATION_ADMIN: "Organization Admin",
  SUPERADMIN: "Super Admin",
  FACILITY_ADMIN: "Facility Admin",
  CARE_MANAGER: "Care Manager",
  BILLING_ADMIN: "Billing & Finance",
  PHYSICIAN: "Physician",
  NURSE: "Head Nurse",
  CAREGIVER: "Caregiver",
  FAMILY: "Family Sponsor",
  RESIDENT: "Resident",
  FLEET_MANAGEMENT: "Fleet Manager",
  DRIVER: "Transport Driver",
  SECURITY: "Security Guard",
  NUTRITIONIST: "Nutritionist",
  KITCHEN: "Kitchen Staff",
  HOUSEKEEPING: "Housekeeping",
  MAINTENANCE: "Maintenance",
};

/** Colour accents per role row for the left badge. */
const ROLE_COLORS: Record<Role, string> = {
  PLATFORM_ADMIN: "from-slate-700 to-blue-800",
  ORGANIZATION_ADMIN: "from-violet-600 to-indigo-700",
  SUPERADMIN: "from-blue-600 to-indigo-600",
  FACILITY_ADMIN: "from-blue-400 to-blue-600",
  CARE_MANAGER: "from-teal-500 to-emerald-600",
  BILLING_ADMIN: "from-emerald-500 to-green-600",
  PHYSICIAN: "from-teal-400 to-teal-600",
  NURSE: "from-pink-400 to-pink-600",
  CAREGIVER: "from-green-400 to-green-600",
  FAMILY: "from-purple-400 to-purple-600",
  RESIDENT: "from-orange-400 to-orange-600",
  FLEET_MANAGEMENT: "from-indigo-400 to-indigo-600",
  DRIVER: "from-amber-400 to-amber-600",
  SECURITY: "from-red-500 to-rose-700",
  NUTRITIONIST: "from-lime-500 to-green-600",
  KITCHEN: "from-orange-500 to-amber-600",
  HOUSEKEEPING: "from-sky-400 to-cyan-600",
  MAINTENANCE: "from-stone-500 to-zinc-700",
};

type MatrixState = Record<string, Record<string, boolean>>;

export default function PortalMatrixEditor() {
  const { data: settingRows, refetch } = useLiveQuery<{
    id: string;
    value: string;
  }>("app-settings", { tables: ["AppSetting"] });

  // Build the unique superset of all feature names across all roles.
  const allFeatures = useMemo(() => {
    return Object.keys(GLOBAL_FEATURES);
  }, []);

  // Hydrate matrix from the database setting, defaulting native features to true, others to false.
  const [matrix, setMatrix] = useState<MatrixState>(() => {
    const stored = settingRows.find((s) => s.id === "portal_matrix")?.value;
    const parsed: MatrixState = stored ? JSON.parse(stored) : {};
    const state: MatrixState = {};
    ALL_ROLES.forEach((r) => {
      state[r] = {};
      const roleFeatures = ROLES[r].sidebarLinks.map((l) => l.name);
      Object.keys(GLOBAL_FEATURES).forEach((f) => {
        state[r][f] = parsed[r]?.[f] ?? roleFeatures.includes(f);
      });
    });
    return state;
  });

  // Track saving status.
  const [savingStatus, setSavingStatus] = useState<"saved" | "saving" | "error">("saved");

  // Keep local matrix state updated if the database changes externally, as long as we're not currently saving.
  useEffect(() => {
    const stored = settingRows.find((s) => s.id === "portal_matrix")?.value;
    if (stored && savingStatus !== "saving") {
      try {
        const parsed: MatrixState = JSON.parse(stored);
        const state: MatrixState = {};
        ALL_ROLES.forEach((r) => {
          state[r] = {};
          const roleFeatures = ROLES[r].sidebarLinks.map((l) => l.name);
          Object.keys(GLOBAL_FEATURES).forEach((f) => {
            state[r][f] = parsed[r]?.[f] ?? roleFeatures.includes(f);
          });
        });
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMatrix(state);
      } catch (e) {
        console.error("Failed to parse matrix setting:", e);
      }
    }
  }, [settingRows, savingStatus]);

  // Centralized real-time persistence helper.
  const saveMatrix = async (nextMatrix: MatrixState) => {
    setSavingStatus("saving");
    try {
      const { upsertRecord } = await import("@/lib/api");
      await upsertRecord("app-settings", "portal_matrix", {
        value: JSON.stringify(nextMatrix),
      });
      await refetch();
      setSavingStatus("saved");
    } catch (err) {
      console.error("Realtime save failed:", err);
      setSavingStatus("error");
    }
  };

  const toggle = useCallback(
    (role: string, feature: string) => {
      setMatrix((prev) => {
        const next = {
          ...prev,
          [role]: { ...prev[role], [feature]: !prev[role]?.[feature] },
        };
        saveMatrix(next);
        return next;
      });
    },
    [settingRows]
  );

  const toggleEntireRole = useCallback(
    (role: string) => {
      setMatrix((prev) => {
        const allOn = Object.keys(GLOBAL_FEATURES).every((f) => prev[role]?.[f] === true);
        const updated = { ...prev[role] };
        Object.keys(GLOBAL_FEATURES).forEach((f) => {
          updated[f] = !allOn;
        });
        const next = { ...prev, [role]: updated };
        saveMatrix(next);
        return next;
      });
    },
    [settingRows]
  );

  const toggleEntireFeature = useCallback(
    (feature: string) => {
      setMatrix((prev) => {
        const allOn = ALL_ROLES.every((r) => prev[r]?.[feature] === true);
        const next = { ...prev };
        ALL_ROLES.forEach((r) => {
          next[r] = { ...next[r], [feature]: !allOn };
        });
        saveMatrix(next);
        return next;
      });
    },
    [settingRows]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Portal Feature Matrix
          </h1>
          <p className="text-gray-600">
            Enable or disable sidebar modules per user role. Click any cell to sync changes instantly in real-time.
          </p>
        </div>

        {/* Realtime Status Badge */}
        <div className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl px-4 py-3.5 shadow-sm">
          {savingStatus === "saving" && (
            <>
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-500"></span>
              </span>
              <span className="text-sm font-semibold text-yellow-600">Syncing with Supabase...</span>
            </>
          )}
          {savingStatus === "saved" && (
            <>
              <span className="relative flex h-3 w-3">
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500 animate-pulse"></span>
              </span>
              <span className="text-sm font-semibold text-green-600">Live Realtime Sync Active</span>
            </>
          )}
          {savingStatus === "error" && (
            <>
              <span className="relative flex h-3 w-3">
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
              </span>
              <span className="text-sm font-semibold text-red-600">Sync Error - Offline</span>
            </>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap gap-6 items-center text-sm text-gray-600">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-yellow-500" />
          <span>Click checkboxes to toggle module access per role</span>
        </div>
        <div className="flex items-center gap-2">
          <ToggleLeft className="w-4 h-4 text-gray-400" />
          <span>Click role/feature headers to toggle entire row/column</span>
        </div>
      </div>

      {/* Matrix Grid */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            {/* Column headers: features */}
            <thead>
              <tr className="bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200">
                <th className="sticky left-0 z-10 bg-gradient-to-r from-gray-50 to-gray-100 px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider min-w-[180px]">
                  Role / Module
                </th>
                {allFeatures.map((feature) => (
                  <th
                    key={feature}
                    className="px-2 py-3 text-center min-w-[110px]"
                  >
                    <button
                      onClick={() => toggleEntireFeature(feature)}
                      className="text-xs font-bold text-gray-600 hover:text-yellow-600 transition-colors cursor-pointer flex flex-col items-center gap-1 mx-auto"
                      title={`Toggle "${feature}" for all roles`}
                    >
                      <span className="leading-tight">{feature}</span>
                      <ToggleRight className="w-3.5 h-3.5 text-gray-400" />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {ALL_ROLES.map((role, idx) => {
                const enabledCount = allFeatures.filter(
                  (f) => matrix[role]?.[f] === true
                ).length;

                return (
                  <tr
                    key={role}
                    className={`border-b border-gray-100 transition-colors hover:bg-yellow-50/40 ${
                      idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"
                    }`}
                  >
                    {/* Role label cell */}
                    <td className="sticky left-0 z-10 bg-inherit px-4 py-3">
                      <button
                        onClick={() => toggleEntireRole(role)}
                        className="flex items-center gap-3 group cursor-pointer"
                        title={`Toggle all modules for ${ROLE_LABELS[role]}`}
                      >
                        <div
                          className={`w-9 h-9 rounded-lg bg-gradient-to-br ${ROLE_COLORS[role]} flex items-center justify-center text-white text-xs font-black shadow-sm group-hover:scale-110 transition-transform`}
                        >
                          {ROLE_LABELS[role].charAt(0)}
                        </div>
                        <div className="text-left">
                          <div className="font-semibold text-gray-900 text-sm group-hover:text-yellow-700 transition-colors">
                            {ROLE_LABELS[role]}
                          </div>
                          <div className="text-[11px] text-gray-400">
                            {enabledCount}/{allFeatures.length} modules
                          </div>
                        </div>
                      </button>
                    </td>

                    {/* Feature checkbox cells */}
                    {allFeatures.map((feature) => {
                      const isEnabled = matrix[role]?.[feature] === true;
                      return (
                        <td
                          key={feature}
                          className="px-2 py-3 text-center"
                        >
                          <button
                            onClick={() => toggle(role, feature)}
                            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200 ${
                              isEnabled
                                ? "bg-gradient-to-br from-green-400 to-green-600 text-white shadow-sm hover:shadow-md hover:scale-110"
                                : "bg-gray-100 text-gray-300 hover:bg-gray-200 hover:scale-110"
                            }`}
                            title={`${isEnabled ? "Disable" : "Enable"} "${feature}" for ${ROLE_LABELS[role]}`}
                          >
                            {isEnabled ? (
                              <CheckSquare className="w-4 h-4" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary Footer */}
      <div className="bg-gradient-to-r from-gray-900 to-black rounded-xl p-6 text-white">
        <h3 className="text-lg font-bold text-yellow-400 mb-3">Matrix Summary</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {ALL_ROLES.map((role) => {
            const enabledCount = allFeatures.filter(
              (f) => matrix[role]?.[f] === true
            ).length;
            const pct = Math.round((enabledCount / allFeatures.length) * 100);
            return (
              <div
                key={role}
                className="bg-white/10 backdrop-blur-sm rounded-lg p-3 text-center"
              >
                <div
                  className={`w-8 h-8 mx-auto mb-2 rounded-lg bg-gradient-to-br ${ROLE_COLORS[role]} flex items-center justify-center text-white text-xs font-bold`}
                >
                  {ROLE_LABELS[role].charAt(0)}
                </div>
                <div className="text-xs font-medium text-gray-300 truncate">
                  {ROLE_LABELS[role]}
                </div>
                <div className="text-xl font-black text-yellow-400 mt-1">
                  {pct}%
                </div>
                <div className="text-[10px] text-gray-500">
                  {enabledCount}/{allFeatures.length}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
