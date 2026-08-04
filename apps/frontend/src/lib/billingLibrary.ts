/**
 * Billing configuration layer — all migration-free, persisted as JSON in
 * `app-settings` (keyed rows). Covers the Customizable Charge Library, recurring
 * accrual rules, GL-export account mapping, the online-payments runtime toggle,
 * and auto-pay enrollment. Read via the generic app-settings query; write via
 * upsertRecord("app-settings", KEY, { key: KEY, value: JSON }).
 */

export const BILLING_LIBRARY_KEY = "billing_charge_library";
export const BILLING_SETTINGS_KEY = "billing_settings";
export const BILLING_DISPUTES_KEY = "billing_disputes";

export const CHARGE_CATEGORIES = [
  "Room Rate", "Care Services", "Medical", "Dining", "Therapy",
  "Concierge Services", "Transport", "Ancillary", "Custom",
] as const;

export const CARE_LEVEL_OPTIONS = ["ALL", "INDEPENDENT", "ASSISTED", "MEMORY", "SKILLED"] as const;

export interface ChargeTemplate {
  id: string;
  name: string;
  category: string;
  amount: number;
  /** Which care level this applies to; "ALL" = every resident. */
  careLevel: string;
  /** Recurring (rent, monthly care fee) → accrued monthly by the billing cron. */
  recurring: boolean;
}

export interface GlAccounts {
  revenue: string;
  ar: string;   // accounts receivable
  cash: string; // deposit / cash account
}

export interface BillingSettings {
  onlinePaymentsEnabled: boolean;
  autopayResidentIds: string[];
  glAccounts: GlAccounts;
}

export interface Dispute {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  reason: string;
  status: "OPEN" | "RESOLVED" | "CHARGEBACK";
  amount: number;
  at: string;
  by: string;
}

export const DEFAULT_GL_ACCOUNTS: GlAccounts = {
  revenue: "Resident Services Revenue",
  ar: "Accounts Receivable",
  cash: "Undeposited Funds",
};

export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  onlinePaymentsEnabled: false,
  autopayResidentIds: [],
  glAccounts: DEFAULT_GL_ACCOUNTS,
};

/** Seed templates offered the first time the library is empty. */
export const SEED_TEMPLATES: Omit<ChargeTemplate, "id">[] = [
  { name: "Monthly Room & Board — Independent", category: "Room Rate", amount: 45000, careLevel: "INDEPENDENT", recurring: true },
  { name: "Monthly Room & Board — Assisted", category: "Room Rate", amount: 65000, careLevel: "ASSISTED", recurring: true },
  { name: "Monthly Room & Board — Memory Care", category: "Room Rate", amount: 85000, careLevel: "MEMORY", recurring: true },
  { name: "Monthly Room & Board — Skilled", category: "Room Rate", amount: 110000, careLevel: "SKILLED", recurring: true },
  { name: "Medication Management (monthly)", category: "Medical", amount: 4500, careLevel: "ALL", recurring: true },
  { name: "Physical Therapy Session", category: "Therapy", amount: 1800, careLevel: "ALL", recurring: false },
  { name: "Guest Meal", category: "Dining", amount: 350, careLevel: "ALL", recurring: false },
];

function parseJson<T>(raw: string | undefined | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function parseTemplates(raw: string | undefined | null): ChargeTemplate[] {
  const v = parseJson<ChargeTemplate[]>(raw, []);
  return Array.isArray(v) ? v.filter((t) => t && typeof t.name === "string") : [];
}

export function parseBillingSettings(raw: string | undefined | null): BillingSettings {
  const v = parseJson<Partial<BillingSettings>>(raw, {});
  return {
    onlinePaymentsEnabled: Boolean(v.onlinePaymentsEnabled),
    autopayResidentIds: Array.isArray(v.autopayResidentIds) ? v.autopayResidentIds.map(String) : [],
    glAccounts: { ...DEFAULT_GL_ACCOUNTS, ...(v.glAccounts ?? {}) },
  };
}

export function parseDisputes(raw: string | undefined | null): Dispute[] {
  const v = parseJson<Dispute[]>(raw, []);
  return Array.isArray(v) ? v : [];
}

/** "2026-08" — the accrual period tag, embedded in recurring charge descriptions
 *  so the cron can dedupe (one accrual per resident/template/month). */
export function periodTag(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function recurringMarker(templateId: string, tag: string): string {
  return `[auto:${templateId}:${tag}]`;
}

export function newId(prefix = "tpl"): string {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.floor(performance.now())}`;
}
