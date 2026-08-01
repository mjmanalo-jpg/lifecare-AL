"use client";

import FacilityBilling from "./FacilityBilling";
import BillingOnlinePayment from "./BillingOnlinePayment";
import BillingLedger from "./billing/BillingLedger";
import BillingReceivables from "./billing/BillingReceivables";
import BillingRevenue from "./billing/BillingRevenue";

interface BillingFinancePortalContentProps {
  tab: string;
}

type BillingTab = "overview" | "charges" | "insurance" | "invoices" | "payments" | "receipts";

// Sidebar route segment -> FacilityBilling internal tab.
const TAB_TO_BILLING: Record<string, BillingTab> = {
  dashboard: "overview",
  charges: "charges",
  invoices: "invoices",
  payments: "payments",
  insurance: "insurance",
  receipts: "receipts",
};

export default function BillingFinancePortalContent({ tab }: BillingFinancePortalContentProps) {
  // Consolidated finance views (Phase 1) — built on the shared charge/invoice data.
  if (tab === "ledger") return <BillingLedger />;
  if (tab === "receivables") return <BillingReceivables />;
  if (tab === "revenue") return <BillingRevenue />;
  // Online payments live in their own gated view.
  if (tab === "onlinepayment") return <BillingOnlinePayment />;

  const initialTab = TAB_TO_BILLING[tab] ?? "overview";
  // key remounts FacilityBilling on sidebar navigation so initialTab takes effect.
  return <FacilityBilling key={initialTab} initialTab={initialTab} />;
}
