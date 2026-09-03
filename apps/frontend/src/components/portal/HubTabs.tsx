"use client";

import { useState, type ReactNode } from "react";

export interface HubTab {
  /** Stable key — also the legacy tab route this pane used to live at. */
  key: string;
  label: string;
  /** The board to render when this tab is active. Only the active tab mounts. */
  node: ReactNode;
  /** Optional short hint under the tab bar. */
  hint?: string;
}

/**
 * In-page tabbed hub. Consolidates several previously-separate sidebar entries
 * (e.g. MAR / Compliance / Orders) into one screen so a clinician reaches the
 * whole workflow from a single menu item. Only the active tab's board mounts,
 * so per-board data/hooks run lazily — switching tabs remounts, which is fine
 * for these live-query boards.
 *
 * Navigation/labels only: every board is the exact same component it was as a
 * standalone tab; its legacy route is preserved and still resolves.
 */
export default function HubTabs({
  tabs,
  storageKey,
}: {
  tabs: HubTab[];
  /** Remembers the last-open tab per hub, per browser. */
  storageKey?: string;
}) {
  const [active, setActive] = useState<string>(() => {
    if (storageKey && typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(`lcms_hub_${storageKey}`);
        if (saved && tabs.some((t) => t.key === saved)) return saved;
      } catch { /* ignore disabled storage */ }
    }
    return tabs[0]?.key ?? "";
  });

  const select = (key: string) => {
    setActive(key);
    if (storageKey && typeof window !== "undefined") {
      try { localStorage.setItem(`lcms_hub_${storageKey}`, key); } catch { /* ignore quota */ }
    }
  };

  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Section tabs"
        className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800"
      >
        {tabs.map((t) => {
          const on = t.key === current?.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => select(t.key)}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500 ${
                on
                  ? "border-blue-500 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {current?.hint && (
        <p className="-mt-1 text-xs text-slate-500 dark:text-slate-400">{current.hint}</p>
      )}
      <div>{current?.node}</div>
    </div>
  );
}
