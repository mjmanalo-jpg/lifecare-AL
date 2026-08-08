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
}

export interface SubscriptionBilling {
  payments: SubscriptionPayment[];
  // ISO string of the due date (currentPeriodEnd/trialEndsAt) we last reminded
  // the org admins about, so the reminder cron does not notify repeatedly.
  lastReminderPeriod: string | null;
}

export const SUBSCRIPTION_BILLING_KEY = "subscription-billing";
const rowId = (organizationId: string) => `${SUBSCRIPTION_BILLING_KEY}:${organizationId}`;

const EMPTY: SubscriptionBilling = { payments: [], lastReminderPeriod: null };

export async function readSubscriptionBilling(organizationId: string): Promise<SubscriptionBilling> {
  const row = await prisma.appSetting.findUnique({ where: { id: rowId(organizationId) }, select: { value: true } }).catch(() => null);
  if (!row?.value) return { ...EMPTY };
  try {
    const parsed = JSON.parse(row.value) as Partial<SubscriptionBilling>;
    return { payments: Array.isArray(parsed.payments) ? parsed.payments : [], lastReminderPeriod: parsed.lastReminderPeriod ?? null };
  } catch {
    return { ...EMPTY };
  }
}

export async function writeSubscriptionBilling(organizationId: string, data: SubscriptionBilling): Promise<void> {
  // Cap history so the row cannot grow unbounded.
  const value = JSON.stringify({ payments: data.payments.slice(0, 100), lastReminderPeriod: data.lastReminderPeriod });
  await prisma.appSetting.upsert({
    where: { id: rowId(organizationId) },
    update: { value },
    create: { id: rowId(organizationId), key: SUBSCRIPTION_BILLING_KEY, value, organizationId, communityId: null },
  });
}

// Period tag (YYYY-MM) used to label a payment and detect the current cycle.
export function periodLabel(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
