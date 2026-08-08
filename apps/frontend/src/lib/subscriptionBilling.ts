import { prisma } from "@/lib/prisma";

// Per-organization SaaS subscription billing (org -> platform). The Invoice /
// Payment models are resident-scoped, so subscription payment history is kept
// migration-free in a single per-org AppSetting JSON row, mirroring planMeta.

export interface SubscriptionPayment {
  id: string;
  amount: number;
  currency: string;
  method: string; // CARD | GCASH | BANK_TRANSFER | MAYA | OTHER
  reference: string;
  provider: string; // simulated | paymongo | stripe
  status: "PAID" | "PENDING" | "FAILED";
  periodLabel: string; // e.g. "2026-08"
  paidAt: string; // ISO
  invoiceNumber?: string; // e.g. "INV-2026-08-1a2b3c-04" (for receipts)
}

// Org-configurable subscription billing preferences (org -> platform).
export interface BillingProfile {
  preferredMethod: string; // CARD | GCASH | BANK_TRANSFER | MAYA
  billingEmail: string;
  billingName: string;
}

// Platform-issued invoice (platform admin -> org). Issued BEFORE payment, unlike
// SubscriptionPayment (recorded on/after payment). One-off charges, adjustments,
// and offline (bank/GCash) reconciliation all flow through these.
export interface SaasInvoiceLine {
  description: string;
  amount: number;
}
export interface SaasInvoice {
  id: string;
  number: string;
  status: "ISSUED" | "PAID" | "VOID";
  currency: string;
  lineItems: SaasInvoiceLine[];
  total: number;
  periodLabel: string;
  // When true, marking this invoice paid reactivates the subscription and rolls
  // the billing period forward (a subscription invoice); false for one-off bills.
  advancesPeriod: boolean;
  issuedAt: string;
  dueDate: string;
  paidAt: string | null;
  paymentId: string | null;   // links to the SubscriptionPayment that settled it
  paymentMethod: string | null;
  notes: string;
}

export function invoiceTotal(lines: SaasInvoiceLine[]): number {
  return lines.reduce((sum, line) => sum + (Number.isFinite(line.amount) ? line.amount : 0), 0);
}

export interface SubscriptionBilling {
  payments: SubscriptionPayment[];
  // ISO string of the due date (currentPeriodEnd/trialEndsAt) we last reminded
  // the org admins about, so the reminder cron does not notify repeatedly.
  lastReminderPeriod: string | null;
  // ISO time we first flagged this subscription PAST_DUE (grace-window anchor).
  pastDueSince: string | null;
  // ISO effective date of a scheduled cancel-at-period-end (null = not canceling).
  cancelScheduledFor: string | null;
  // Org billing contact / preferred method (null until the org sets it).
  profile: BillingProfile | null;
  // Platform-issued invoices (newest first).
  invoices: SaasInvoice[];
}

export const SUBSCRIPTION_BILLING_KEY = "subscription-billing";
const rowId = (organizationId: string) => `${SUBSCRIPTION_BILLING_KEY}:${organizationId}`;

const EMPTY: SubscriptionBilling = { payments: [], lastReminderPeriod: null, pastDueSince: null, cancelScheduledFor: null, profile: null, invoices: [] };

export async function readSubscriptionBilling(organizationId: string): Promise<SubscriptionBilling> {
  const row = await prisma.appSetting.findUnique({ where: { id: rowId(organizationId) }, select: { value: true } }).catch(() => null);
  if (!row?.value) return { ...EMPTY };
  try {
    const parsed = JSON.parse(row.value) as Partial<SubscriptionBilling>;
    return {
      payments: Array.isArray(parsed.payments) ? parsed.payments : [],
      lastReminderPeriod: parsed.lastReminderPeriod ?? null,
      pastDueSince: parsed.pastDueSince ?? null,
      cancelScheduledFor: parsed.cancelScheduledFor ?? null,
      profile: parsed.profile ?? null,
      invoices: Array.isArray(parsed.invoices) ? parsed.invoices : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

export async function writeSubscriptionBilling(organizationId: string, data: SubscriptionBilling): Promise<void> {
  // Cap history so the row cannot grow unbounded. Every field is persisted so
  // no lifecycle/profile state is silently dropped on write.
  const value = JSON.stringify({
    payments: data.payments.slice(0, 100),
    lastReminderPeriod: data.lastReminderPeriod,
    pastDueSince: data.pastDueSince,
    cancelScheduledFor: data.cancelScheduledFor,
    profile: data.profile,
    invoices: data.invoices.slice(0, 200),
  });
  await prisma.appSetting.upsert({
    where: { id: rowId(organizationId) },
    update: { value },
    create: { id: rowId(organizationId), key: SUBSCRIPTION_BILLING_KEY, value, organizationId, communityId: null },
  });
}

// Human-friendly, sortable invoice/receipt number for a subscription payment.
// Derived (not stored in a sequence) so it stays migration-free: the period
// plus a short org tag plus a per-period ordinal keep it unique and readable.
export function buildInvoiceNumber(period: string, organizationId: string, ordinal: number): string {
  return `INV-${period}-${organizationId.slice(0, 6)}-${String(ordinal).padStart(2, "0")}`;
}

// Period tag (YYYY-MM) used to label a payment and detect the current cycle.
export function periodLabel(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// The next billing date, derived so display and automation never diverge:
//   1. an explicit currentPeriodEnd (set after a payment) wins,
//   2. else a still-running trial bills when it ends,
//   3. else the next monthly anniversary of the start date after `now`
//      (e.g. started 2026-07-23, today 2026-08-08 -> 2026-08-23).
export function computeNextBilling(
  input: { currentPeriodEnd?: Date | string | null; trialEndsAt?: Date | string | null; startsAt?: Date | string | null },
  now: Date = new Date(),
): Date | null {
  if (input.currentPeriodEnd) return new Date(input.currentPeriodEnd);
  if (input.trialEndsAt) {
    const trialEnd = new Date(input.trialEndsAt);
    if (!Number.isNaN(trialEnd.getTime()) && trialEnd.getTime() > now.getTime()) return trialEnd;
  }
  if (!input.startsAt) return null;
  const next = new Date(input.startsAt);
  if (Number.isNaN(next.getTime())) return null;
  let guard = 0;
  while (next.getTime() <= now.getTime() && guard < 1200) {
    next.setMonth(next.getMonth() + 1);
    guard += 1;
  }
  return next;
}
