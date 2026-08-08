import { prisma } from "@/lib/prisma";

// Platform-wide payment (payee) details configured by the platform admin and
// used across every plan/subscription — e.g. the bank / GCash / Maya accounts
// customers pay into, plus the business name and instructions. Stored
// migration-free in a single platform-global AppSetting JSON row (like planMeta).

const ROW_ID = "platform::payment-details";
const ROW_KEY = "payment-details";

export interface PaymentMethodDetail {
  type: string; // BANK_TRANSFER | GCASH | MAYA | CARD | OTHER
  label: string;
  accountName: string;
  accountNumber: string;
  instructions: string;
}

export interface PaymentDetails {
  provider: string; // DEMO | MANUAL | PAYMONGO | STRIPE (informational)
  businessName: string;
  methods: PaymentMethodDetail[];
  notes: string;
}

export const DEFAULT_PAYMENT_DETAILS: PaymentDetails = { provider: "MANUAL", businessName: "", methods: [], notes: "" };

const str = (value: unknown, max = 200): string => (typeof value === "string" ? value.slice(0, max) : "");

function sanitizeMethod(input: unknown): PaymentMethodDetail {
  const method = (input || {}) as Record<string, unknown>;
  const type = str(method.type, 24).toUpperCase() || "BANK_TRANSFER";
  return { type, label: str(method.label, 60), accountName: str(method.accountName, 120), accountNumber: str(method.accountNumber, 120), instructions: str(method.instructions, 400) };
}

export function sanitizePaymentDetails(input: unknown): PaymentDetails {
  const data = (input || {}) as Record<string, unknown>;
  const methods = Array.isArray(data.methods) ? data.methods.slice(0, 12).map(sanitizeMethod) : [];
  return {
    provider: str(data.provider, 24).toUpperCase() || "MANUAL",
    businessName: str(data.businessName, 160),
    methods,
    notes: str(data.notes, 800),
  };
}

export async function readPaymentDetails(): Promise<PaymentDetails> {
  const row = await prisma.appSetting.findUnique({ where: { id: ROW_ID }, select: { value: true } }).catch(() => null);
  if (!row?.value) return { ...DEFAULT_PAYMENT_DETAILS };
  try {
    return sanitizePaymentDetails(JSON.parse(row.value));
  } catch {
    return { ...DEFAULT_PAYMENT_DETAILS };
  }
}

export async function writePaymentDetails(input: unknown): Promise<PaymentDetails> {
  const details = sanitizePaymentDetails(input);
  const value = JSON.stringify(details);
  await prisma.appSetting.upsert({
    where: { id: ROW_ID },
    update: { value },
    create: { id: ROW_ID, key: ROW_KEY, value, organizationId: null, communityId: null },
  });
  return details;
}
