"use client";

import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType } from "react";
import { Plus, X, Settings, Loader2, ChevronUp, ChevronDown } from "lucide-react";
import { ROLES, type Role } from "@/constants/roleConfig";

/**
 * Floating quick-actions launcher, available on every role's portal. A bottom-right
 * FAB expands into a speed-dial of that role's own boards; picking one slides a
 * right-hand panel in over the page and renders that tab's real content inline.
 *
 * The catalog is derived automatically from the role's sidebar links
 * (`ROLES[role].sidebarLinks`), so the shortcuts always match what the role can
 * actually see. Users curate WHICH shortcuts (and in what order) appear via the
 * "Customize" panel; the choice is persisted in localStorage per role. Each
 * role's portal content is lazy-loaded so nothing loads until it's opened.
 */

type TabContent = ComponentType<{ tab: string }>;
const lazyContent = (loader: () => Promise<{ default: TabContent }>) => lazy(loader);

// One entry per role → its portal-content component (the same one the page renders).
const ROLE_CONTENT: Record<Role, TabContent> = {
  PLATFORM_ADMIN: lazyContent(() => import("@/components/portal/views/PlatformAdminPortalContent")),
  ORGANIZATION_ADMIN: lazyContent(() => import("@/components/portal/views/OrganizationAdminPortalContent")),
  SUPERADMIN: lazyContent(() => import("@/components/portal/views/SuperAdminPortalContent")),
  FACILITY_ADMIN: lazyContent(() => import("@/components/portal/views/FacilityAdminPortalContent")),
  CARE_MANAGER: lazyContent(() => import("@/components/portal/views/CareManagerPortalContent")),
  RESIDENT_COORDINATOR: lazyContent(() => import("@/components/portal/views/ResidentCoordinatorPortalContent")),
  BILLING_ADMIN: lazyContent(() => import("@/components/portal/views/BillingFinancePortalContent")),
  PHYSICIAN: lazyContent(() => import("@/components/portal/views/PhysicianPortalContent")),
  NURSE: lazyContent(() => import("@/components/portal/views/NursePortalContent")),
  CAREGIVER: lazyContent(() => import("@/components/portal/views/CaregiverPortalContent")),
  FAMILY: lazyContent(() => import("@/components/portal/views/FamilyPortalContent")),
  RESIDENT: lazyContent(() => import("@/components/portal/views/ResidentPortalContent")),
  FLEET_MANAGEMENT: lazyContent(() => import("@/components/portal/views/FleetManagementPortalContent")),
  DRIVER: lazyContent(() => import("@/components/portal/views/DriverPortalContent")),
  SECURITY: lazyContent(() => import("@/components/portal/views/SecurityPortalContent")),
  NUTRITIONIST: lazyContent(() => import("@/components/portal/views/NutritionistPortalContent")),
  KITCHEN: lazyContent(() => import("@/components/portal/views/KitchenPortalContent")),
  HOUSEKEEPING: lazyContent(() => import("@/components/portal/views/HousekeepingPortalContent")),
  MAINTENANCE: lazyContent(() => import("@/components/portal/views/MaintenancePortalContent")),
};

// Colors cycled across a role's shortcuts so the icon chips read distinctly.
const PALETTE = ["#0d9488", "#d97706", "#c026d3", "#16a34a", "#0ea5e9", "#7c3aed", "#e11d48", "#2563eb", "#0891b2", "#dc2626", "#ca8a04", "#4f46e5", "#059669", "#db2777", "#475569"];
const DEFAULT_COUNT = 6; // shortcuts pinned by default (users customize from here)

// `.clinical-portal-content button` forces a 2.75rem min-size (touch targets).
// Small controls inside the panel opt out with this inline override.
const btnReset = { minWidth: 0, minHeight: 0 } as const;

type QuickItem = { key: string; label: string; Icon: ComponentType<{ className?: string }>; color: string };

export default function DashboardQuickActions({ role }: { role: Role }) {
  const storageKey = `quickAccess:v3:${role}`;

  // Catalog derived from the role's sidebar links. `link.route` is a full href
  // (e.g. "/care_manager/carelogs") — the tab the PortalContent switches on is
  // its LAST path segment ("carelogs"). Dashboard is excluded (no point launching
  // the dashboard from the dashboard FAB). Deduped by segment.
  const catalog = useMemo<QuickItem[]>(() => {
    const seen = new Set<string>();
    const items: QuickItem[] = [];
    for (const link of ROLES[role]?.sidebarLinks ?? []) {
      const seg = link.route.split(/[?#]/)[0].split("/").filter(Boolean).pop() || "";
      if (!seg || seg === "dashboard" || seen.has(seg)) continue;
      seen.add(seg);
      items.push({ key: seg, label: link.name, Icon: link.icon, color: PALETTE[items.length % PALETTE.length] });
    }
    return items;
  }, [role]);
  const catalogByKey = useMemo(() => new Map(catalog.map((c) => [c.key, c])), [catalog]);
  const defaultKeys = useMemo(() => catalog.slice(0, DEFAULT_COUNT).map((c) => c.key), [catalog]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  // Enabled shortcut keys in the user's chosen order. Hydration-safe: start from
  // defaults, then load the saved preference on mount (localStorage is client-only).
  const [enabled, setEnabled] = useState<string[]>(defaultKeys);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    let next = defaultKeys;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) next = arr.filter((k) => catalogByKey.has(k));
      }
    } catch { /* ignore malformed / unavailable storage */ }
    setEnabled(next);
    setLoaded(true);
  }, [storageKey, defaultKeys, catalogByKey]);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(storageKey, JSON.stringify(enabled)); } catch { /* ignore */ }
  }, [enabled, loaded, storageKey]);

  const enabledItems = useMemo(
    () => enabled.map((k) => catalogByKey.get(k)).filter((c): c is QuickItem => Boolean(c)),
    [enabled, catalogByKey],
  );

  const toggle = (key: string) =>
    setEnabled((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  const move = (key: string, dir: -1 | 1) =>
    setEnabled((prev) => {
      const i = prev.indexOf(key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const open = (k: string) => { setShown(false); setActive(k); setMenuOpen(false); };
  const close = () => { setShown(false); setActive(null); };

  useEffect(() => {
    if (!active) return;
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [active]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (active) close();
      else if (customizeOpen) setCustomizeOpen(false);
      else if (menuOpen) setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, customizeOpen, menuOpen]);

  useEffect(() => {
    if (!active && !customizeOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [active, customizeOpen]);

  // Nothing to launch (role with only a dashboard) — no FAB.
  if (catalog.length === 0) return null;

  const activeItem = active ? catalogByKey.get(active) : null;
  const RoleContent = ROLE_CONTENT[role];

  return (
    <>
      {/* Speed dial */}
      <div className="fixed bottom-24 right-4 z-40 flex flex-col items-end gap-3 print:hidden md:bottom-6 md:right-6">
        {menuOpen && (
          <div className="mb-1 flex max-h-[60vh] w-60 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl animate-in fade-in slide-in-from-bottom-2 zoom-in-95 duration-200">
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {enabledItems.length > 0 ? enabledItems.map((a) => (
                <button key={a.key} onClick={() => open(a.key)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-slate-800 transition hover:bg-slate-50">
                  <span className="shrink-0" style={{ color: a.color }}><a.Icon className="h-4 w-4" /></span> <span className="truncate">{a.label}</span>
                </button>
              )) : (
                <p className="px-3 py-6 text-center text-xs text-slate-400">No shortcuts yet.<br />Tap Customize to add some.</p>
              )}
            </div>
            <button onClick={() => { setCustomizeOpen(true); setMenuOpen(false); }}
              className="flex w-full items-center gap-3 border-t border-slate-100 px-3 py-2.5 text-sm font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-700">
              <Settings className="h-4 w-4 shrink-0" /> Customize
            </button>
          </div>
        )}
        <button
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={menuOpen ? "Close quick actions" : "Open quick actions"}
          aria-expanded={menuOpen}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition hover:bg-blue-700 active:scale-95"
        >
          {menuOpen ? <X className="h-6 w-6" /> : <Plus className="h-6 w-6" />}
        </button>
      </div>

      {/* Customize panel */}
      {customizeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Customize quick actions">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setCustomizeOpen(false)} />
          <div className="relative flex max-h-[82vh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-900/5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex flex-none items-start justify-between gap-3 px-5 pb-4 pt-5">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-blue-50 text-blue-600"><Settings className="h-5 w-5" /></span>
                <div>
                  <h2 className="text-[15px] font-bold text-slate-900">Customize shortcuts</h2>
                  <p className="mt-0.5 text-xs text-slate-500">Pick the boards for your quick-access menu.</p>
                </div>
              </div>
              <button onClick={() => setCustomizeOpen(false)} aria-label="Close" style={btnReset} className="-mr-1 rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              <div className="mb-1 flex items-center justify-between px-2 pt-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">On your menu</p>
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-600">{enabledItems.length}</span>
              </div>
              {enabledItems.length > 0 ? (
                <div className="space-y-1">
                  {enabledItems.map((a, idx) => (
                    <div key={a.key} className="group flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 px-2.5 py-2 transition hover:border-slate-200 hover:bg-slate-50">
                      <IconChip icon={a.Icon} color={a.color} />
                      <span className="flex-1 truncate text-sm font-semibold text-slate-800">{a.label}</span>
                      <div className="flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
                        <button onClick={() => move(a.key, -1)} disabled={idx === 0} aria-label={`Move ${a.label} up`} style={btnReset}
                          className="p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-25 disabled:hover:bg-transparent"><ChevronUp className="h-4 w-4" /></button>
                        <span className="h-4 w-px bg-slate-200" />
                        <button onClick={() => move(a.key, 1)} disabled={idx === enabledItems.length - 1} aria-label={`Move ${a.label} down`} style={btnReset}
                          className="p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-25 disabled:hover:bg-transparent"><ChevronDown className="h-4 w-4" /></button>
                      </div>
                      <Switch on onClick={() => toggle(a.key)} label={a.label} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-2xl border border-dashed border-slate-200 px-3 py-5 text-center text-xs text-slate-400">Nothing pinned yet — add boards below.</p>
              )}

              {catalog.some((c) => !enabled.includes(c.key)) && (
                <>
                  <p className="mb-1 px-2 pt-4 text-[11px] font-bold uppercase tracking-wider text-slate-400">More boards</p>
                  <div className="space-y-1">
                    {catalog.filter((c) => !enabled.includes(c.key)).map((a) => (
                      <div key={a.key} className="flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 transition hover:bg-slate-50">
                        <IconChip icon={a.Icon} color={a.color} muted />
                        <span className="flex-1 truncate text-sm font-medium text-slate-600">{a.label}</span>
                        <Switch on={false} onClick={() => toggle(a.key)} label={a.label} />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-none items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
              <button onClick={() => setEnabled(defaultKeys)} style={btnReset} className="rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800">Reset to default</button>
              <button onClick={() => setCustomizeOpen(false)} style={btnReset} className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 active:scale-95">Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Slide-in content panel */}
      {activeItem && (
        <div className="fixed inset-0 z-50 m-0 h-dvh w-screen max-w-none" role="dialog" aria-modal="true" aria-label={activeItem.label}>
          <div className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${shown ? "opacity-100" : "opacity-0"}`} onClick={close} />
          <div className={`absolute inset-y-0 right-0 ml-auto flex h-full w-full max-w-4xl flex-col bg-slate-50 shadow-2xl transition-transform duration-300 ${shown ? "translate-x-0" : "translate-x-full"}`}>
            <div className="flex flex-none items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
              <h2 className="text-lg font-bold text-slate-900">{activeItem.label}</h2>
              <button onClick={close} aria-label="Close" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6">
              <div className={`transition-all duration-500 ease-out ${shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`}>
                <Suspense fallback={<div className="flex items-center justify-center py-24 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
                  <RoleContent tab={activeItem.key} />
                </Suspense>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Rounded, tinted icon chip used throughout the customize panel. */
function IconChip({ icon: Icon, color, muted = false }: { icon: ComponentType<{ className?: string }>; color: string; muted?: boolean }) {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: `${color}${muted ? "14" : "1f"}`, color }}>
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

/** Compact iOS-style on/off switch. Uses btnReset to escape the global min-size
 *  rule that would otherwise inflate it into a 44px square. */
function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} role="switch" aria-checked={on}
      aria-label={`${on ? "Remove" : "Add"} ${label}`} style={btnReset}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 ${on ? "bg-blue-600" : "bg-slate-200"}`}>
      <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${on ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );
}
