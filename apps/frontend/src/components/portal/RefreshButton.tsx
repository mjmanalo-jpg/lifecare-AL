"use client";

import { useCallback, useState } from "react";
import { RefreshCw } from "lucide-react";

interface RefreshButtonProps {
  /** The board's refetch handler. May be sync or return a promise. */
  onRefresh: () => void | Promise<unknown>;
  /** Full button className — pass the board's existing classes to keep the look. */
  className?: string;
  /** Visible label (omit for an icon-only button). */
  label?: string;
  title?: string;
  /** Icon size classes (default w-4 h-4). */
  iconClassName?: string;
}

const DEFAULT_CLASS =
  "flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium disabled:opacity-60";

/**
 * Shared Refresh control. Wraps a refetch handler so the icon spins while the
 * request is in flight — with a short minimum spin so the feedback is always
 * visible even when the data comes back instantly (cached/coalesced). Re-clicks
 * are ignored while a refresh is already running. Used across every board so a
 * Refresh click always visibly does something.
 */
export default function RefreshButton({
  onRefresh,
  className,
  label = "Refresh",
  title,
  iconClassName = "w-4 h-4",
}: RefreshButtonProps) {
  const [busy, setBusy] = useState(false);

  const handle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    const startedAt = Date.now();
    try {
      await Promise.resolve(onRefresh());
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < 500) await new Promise((resolve) => setTimeout(resolve, 500 - elapsed));
      setBusy(false);
    }
  }, [busy, onRefresh]);

  return (
    <button
      type="button"
      onClick={() => void handle()}
      disabled={busy}
      title={title ?? label}
      className={className ?? DEFAULT_CLASS}
    >
      <RefreshCw className={`${iconClassName}${busy ? " animate-spin" : ""}`} />
      {label ? ` ${label}` : null}
    </button>
  );
}
