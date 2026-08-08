// Subscription lifecycle: the single source of truth for which statuses keep a
// tenant's access, and the pure state-machine that the daily lifecycle cron
// applies. Kept dependency-free (no prisma) so the decision logic is trivially
// testable and reusable from both the gate (tenant.ts / entitlements.ts) and
// the cron.

export type SubStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED";

// Statuses that retain portal access. PAST_DUE keeps access during the dunning
// grace window so the org can still come pay; SUSPENDED and CANCELED are locked
// out (they recover only by paying through the billing endpoint, which is
// reachable via `allowInactiveSubscription`, or by a platform admin).
export const ACCESS_STATUSES: ReadonlySet<string> = new Set(["TRIALING", "ACTIVE", "PAST_DUE"]);

// Statuses allowed to create/mutate tenant data. Same set: grace keeps working.
export const MUTATION_STATUSES: ReadonlySet<string> = new Set(["TRIALING", "ACTIVE", "PAST_DUE"]);

// Days a subscription may sit PAST_DUE (dunning grace) before it is suspended.
export const GRACE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const time = (value: Date | string | null | undefined): number | null => {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
};

export interface LifecycleInput {
  status: string;
  trialEndsAt: Date | string | null;
  currentPeriodEnd: Date | string | null;
  // Set the first time we mark a subscription PAST_DUE, so the grace deadline is
  // measured from then. Lives in the per-org subscription-billing store.
  pastDueSince: string | null;
  // When the org scheduled a cancel-at-period-end; the effective date.
  cancelScheduledFor: string | null;
  // Whether a PAID payment already covers the current due period.
  paidCurrentPeriod: boolean;
}

export interface LifecycleDecision {
  // The new status, if it changed.
  status?: SubStatus;
  // Store fields to persist alongside (only present when they change).
  pastDueSince?: string | null;
  cancelScheduledFor?: string | null;
  reason: string;
}

// Decide the next state for one subscription. Returns null when nothing changes.
export function decideLifecycle(input: LifecycleInput, now: Date): LifecycleDecision | null {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  // A scheduled cancellation takes effect at its date, from any live state.
  if (input.cancelScheduledFor && input.status !== "CANCELED") {
    const at = time(input.cancelScheduledFor);
    if (at !== null && nowMs >= at) {
      return { status: "CANCELED", cancelScheduledFor: null, pastDueSince: null, reason: "Scheduled cancellation took effect" };
    }
  }

  switch (input.status) {
    case "TRIALING": {
      const trialEnd = time(input.trialEndsAt);
      if (trialEnd !== null && nowMs >= trialEnd) {
        if (input.paidCurrentPeriod) return { status: "ACTIVE", pastDueSince: null, reason: "Trial converted to paid" };
        return { status: "PAST_DUE", pastDueSince: nowIso, reason: "Trial ended without payment" };
      }
      return null;
    }
    case "ACTIVE": {
      const periodEnd = time(input.currentPeriodEnd);
      if (periodEnd !== null && nowMs >= periodEnd && !input.paidCurrentPeriod) {
        return { status: "PAST_DUE", pastDueSince: nowIso, reason: "Billing period ended without payment" };
      }
      return null;
    }
    case "PAST_DUE": {
      // A payment clears PAST_DUE via the billing flow; this is a safety net.
      if (input.paidCurrentPeriod) return { status: "ACTIVE", pastDueSince: null, reason: "Payment received while past due" };
      // Grace is measured only from an explicit anchor. If we observe a PAST_DUE
      // subscription with no anchor (legacy/edited data), start the clock now —
      // never back-date it to a stale due date and suspend on the first run.
      if (!input.pastDueSince) return { pastDueSince: nowIso, reason: "Past-due grace window started" };
      const since = time(input.pastDueSince);
      if (since !== null && nowMs - since >= GRACE_DAYS * DAY_MS) {
        return { status: "SUSPENDED", reason: `Grace period of ${GRACE_DAYS} days elapsed while past due` };
      }
      return null;
    }
    default:
      return null;
  }
}
