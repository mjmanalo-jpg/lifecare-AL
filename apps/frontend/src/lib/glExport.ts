/**
 * General-Ledger export — turns invoices + payments into balanced double-entry
 * transactions and serialises them for accounting software:
 *   - QuickBooks Desktop `.iif` (General Journal)
 *   - Account-mapped CSV that QuickBooks Online / Sage Intacct can import
 * Migration-free: derived on demand from existing billing rows.
 */
import type { GlAccounts } from "./billingLibrary";

export interface GlTxn {
  date: string;          // ISO
  type: "Invoice" | "Payment";
  num: string;
  name: string;          // resident
  memo: string;
  debitAccount: string;
  creditAccount: string;
  amount: number;
}

interface InvoiceLike { id: string; invoiceNumber?: string | null; residentId?: string | null; totalAmount?: number | null; status?: string | null; sentAt?: string | null; createdAt?: string | null; dueDate?: string | null; }
interface PaymentLike { id: string; invoiceId?: string | null; amount?: number | null; paymentDate?: string | null; paymentMethod?: string | null; transactionId?: string | null; }

/** Build balanced GL transactions from invoices (AR/Revenue) and payments (Cash/AR). */
export function buildGlTxns(
  invoices: InvoiceLike[],
  payments: PaymentLike[],
  accounts: GlAccounts,
  residentName: (residentId: string | null | undefined) => string,
  invoiceNumberById: (invoiceId: string) => string,
): GlTxn[] {
  const txns: GlTxn[] = [];

  for (const inv of invoices) {
    const amount = Number(inv.totalAmount ?? 0);
    if (!amount || String(inv.status) === "DRAFT" || String(inv.status) === "CANCELLED") continue;
    txns.push({
      date: String(inv.sentAt || inv.createdAt || inv.dueDate || new Date().toISOString()),
      type: "Invoice",
      num: String(inv.invoiceNumber || inv.id.slice(0, 8)),
      name: residentName(inv.residentId),
      memo: `Resident services — invoice ${inv.invoiceNumber ?? ""}`.trim(),
      debitAccount: accounts.ar,
      creditAccount: accounts.revenue,
      amount,
    });
  }

  for (const pay of payments) {
    const amount = Number(pay.amount ?? 0);
    if (!amount) continue;
    const chargeback = amount < 0;
    txns.push({
      date: String(pay.paymentDate || new Date().toISOString()),
      type: "Payment",
      num: String(pay.transactionId || pay.id.slice(0, 8)),
      name: "",
      memo: `${chargeback ? "Chargeback" : "Payment"} — ${invoiceNumberById(String(pay.invoiceId))} (${pay.paymentMethod ?? "OTHER"})`,
      // A normal payment: Dr Cash, Cr AR. A chargeback (negative) reverses it.
      debitAccount: accounts.cash,
      creditAccount: accounts.ar,
      amount,
    });
  }

  return txns;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

const csvCell = (v: string | number): string => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** QuickBooks Online / Sage Intacct import CSV — one row per GL line (debit & credit). */
export function toGeneralLedgerCsv(txns: GlTxn[]): string {
  const header = ["Date", "Journal No", "Type", "Account", "Debit", "Credit", "Name", "Memo"];
  const rows: (string | number)[][] = [header];
  for (const t of txns) {
    const amt = Math.abs(t.amount);
    // Positive amount → normal Dr/Cr; negative (chargeback) → swap sides.
    const [debitAcc, creditAcc] = t.amount >= 0 ? [t.debitAccount, t.creditAccount] : [t.creditAccount, t.debitAccount];
    rows.push([fmtDate(t.date), t.num, t.type, debitAcc, amt.toFixed(2), "", t.name, t.memo]);
    rows.push([fmtDate(t.date), t.num, t.type, creditAcc, "", amt.toFixed(2), t.name, t.memo]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** QuickBooks Desktop .iif — General Journal entries. */
export function toQuickBooksIIF(txns: GlTxn[]): string {
  const lines: string[] = [
    "!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO",
    "!SPL\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO",
    "!ENDTRNS",
  ];
  for (const t of txns) {
    const d = fmtDate(t.date);
    const amt = Math.abs(t.amount);
    const [debitAcc, creditAcc] = t.amount >= 0 ? [t.debitAccount, t.creditAccount] : [t.creditAccount, t.debitAccount];
    const memo = t.memo.replace(/\t/g, " ");
    // TRNS carries the debit (+), SPL the balancing credit (−).
    lines.push(`TRNS\tGENERAL JOURNAL\t${d}\t${debitAcc}\t${t.name}\t${amt.toFixed(2)}\t${memo}`);
    lines.push(`SPL\tGENERAL JOURNAL\t${d}\t${creditAcc}\t${t.name}\t${(-amt).toFixed(2)}\t${memo}`);
    lines.push("ENDTRNS");
  }
  return lines.join("\r\n");
}

/** Trigger a browser download of arbitrary text content. */
export function downloadText(filename: string, content: string, mime = "text/plain"): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
