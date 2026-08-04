import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class names, de-duplicating conflicting utilities.
 * Standard shadcn/ui helper — used by the primitives in `components/ui`.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a span given in minutes as a compact, human duration that rolls up
 * through hours and then days:
 *   45 -> "45m"   90 -> "1h 30m"   937 -> "15h 37m"
 *   1440 -> "1d"  3833 -> "2d 15h"   0 -> "0m"
 * Past an hour it reads "Xh Ym"; past a day it reads "Xd Yh" (minutes dropped
 * at day scale to stay readable).
 */
export function formatDurationHm(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) {
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const days = Math.floor(h / 24);
  const remH = h % 24;
  return remH ? `${days}d ${remH}h` : `${days}d`;
}

/**
 * Relative "time ago" from an ISO timestamp — hours + minutes once past an
 * hour (e.g. "15h 37m ago"), rolling into days (with the leftover hours) after
 * a full day. Pass `nowTs` from a live clock so it ticks.
 */
export function timeAgo(iso: string | null | undefined, nowTs: number = Date.now()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const mins = Math.max(0, Math.round((nowTs - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) {
    const m = mins % 60;
    return m ? `${h}h ${m}m ago` : `${h}h ago`;
  }
  const days = Math.floor(h / 24);
  const remH = h % 24;
  return remH ? `${days}d ${remH}h ago` : `${days}d ago`;
}
