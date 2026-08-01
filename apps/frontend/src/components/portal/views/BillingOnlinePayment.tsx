"use client";

import { useMemo, useState } from "react";
import { CreditCard, Lock, ShieldCheck, Loader2, ExternalLink } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptInvoice } from "@/lib/adapters";
import { createRecord, updateRecord } from "@/lib/api";
import { ONLINE_PAYMENTS_ENABLED, ONLINE_PAYMENT_PROVIDER_LABEL } from "@/lib/billingConfig";

type Invoice = ReturnType<typeof adaptInvoice>;

/**
 * Online (card / e-wallet) payment gateway.
 *
 * The full flow is implemented, but is held behind ONLINE_PAYMENTS_ENABLED
 * until the client confirms which third-party provider to use. While disabled,
 * the UI renders in a read-only "pending activation" state so the capability is
 * visible without being live. See lib/billingConfig.ts + lib/payments.ts.
 */
export default function BillingOnlinePayment() {
  const enabled = ONLINE_PAYMENTS_ENABLED;

  const { data: invoiceRows, refetch } = useLiveQuery<Record<string, unknown>>(
    "invoices",
    { query: "include=resident,payments&take=300", tables: ["Invoice", "Resident", "Payment"] }
  );
  const invoices = useMemo<Invoice[]>(() => invoiceRows.map(adaptInvoice), [invoiceRows]);

  // Only invoices that can actually be paid online — sent/overdue with a balance.
  const payable = useMemo(
    () => invoices.filter((i) => i.balance > 0 && (i.status === "SENT" || i.status === "OVERDUE")),
    [invoices]
  );

  const [selectedId, setSelectedId] = useState("");
  const [amount, setAmount] = useState("");
  const [processing, setProcessing] = useState(false);

  const selected = payable.find((i) => i.id === selectedId) || null;

  const onSelect = (id: string) => {
    setSelectedId(id);
    const inv = payable.find((i) => i.id === id);
    setAmount(inv ? String(inv.balance) : "");
  };

  const handlePayOnline = async () => {
    if (!enabled) return;
    if (!selected || !amount) {
      Swal.fire("Missing Fields", "Select an invoice and amount to pay.", "warning");
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      Swal.fire("Invalid Amount", "Enter a positive amount.", "warning");
      return;
    }

    setProcessing(true);
    try {
      const res = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amt,
          description: `Online payment — ${selected.invoiceNumber}`,
          referenceId: selected.id,
        }),
      });
      const body = await res.json().catch(() => ({}));
      const result = body?.result;
      if (!res.ok || !result?.ok) {
        throw new Error(result?.error || body?.error || "Checkout could not be started.");
      }

      // Hosted-gateway path: hand the payer off to the provider's checkout page.
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }

      // Simulated (no live provider) path: record the payment locally.
      const updatedPaid = selected.amountPaid + amt;
      const updatedStatus = updatedPaid >= selected.totalAmount ? "PAID" : "SENT";
      await createRecord("payments", {
        invoiceId: selected.id,
        amount: amt,
        paymentMethod: "CARD",
        transactionId: result.referenceId || `ONLINE-${selected.invoiceNumber}`,
        notes: "Online payment (gateway)",
      });
      await updateRecord("invoices", selected.id, {
        amountPaid: updatedPaid,
        status: updatedStatus,
        paidAt: updatedStatus === "PAID" ? new Date().toISOString() : null,
      });
      await refetch();
      setSelectedId("");
      setAmount("");
      Swal.fire("Payment Received", `Payment recorded against ${selected.invoiceNumber}.`, "success");
    } catch (err) {
      Swal.fire("Payment Failed", err instanceof Error ? err.message : "Could not process online payment.", "error");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2 flex items-center gap-3">
          <CreditCard className="w-8 h-8 text-blue-500" /> Online Payment
        </h1>
        <p className="text-gray-600">Accept card / e-wallet payments against outstanding invoices through a secure hosted gateway.</p>
      </div>

      {!enabled && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 flex items-start gap-4">
          <Lock className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <p className="font-semibold text-base mb-1">Online payments are built but not yet activated.</p>
            <p>
              The full checkout flow (via <span className="font-semibold">{ONLINE_PAYMENT_PROVIDER_LABEL}</span>) is implemented and
              ready. It stays disabled until you confirm the third-party provider to go live with. Once you approve one, flip{" "}
              <code className="px-1 py-0.5 rounded bg-amber-100 font-mono text-xs">ONLINE_PAYMENTS_ENABLED</code> and set the provider keys —
              no other change needed. Manual <span className="font-semibold">Payment Processing</span> remains fully available in the meantime.
            </p>
          </div>
        </div>
      )}

      <div className={`relative rounded-xl border border-gray-200 bg-white p-6 shadow-sm ${!enabled ? "opacity-60" : ""}`}>
        {!enabled && (
          <div className="absolute inset-0 z-10 cursor-not-allowed rounded-xl" title="Online payments are not activated yet" />
        )}

        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-4">
          <ShieldCheck className="w-4 h-4 text-emerald-500" /> Secure Checkout
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Invoice</label>
            <select
              value={selectedId}
              onChange={(e) => onSelect(e.target.value)}
              disabled={!enabled}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-400 outline-none disabled:bg-gray-50"
            >
              <option value="">Select an outstanding invoice…</option>
              {payable.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.invoiceNumber} — {i.residentName} — balance {i.balance.toLocaleString()}
                </option>
              ))}
            </select>
            {payable.length === 0 && (
              <p className="text-xs text-gray-500 mt-2">No sent/overdue invoices with an outstanding balance.</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Amount</label>
            <input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={!enabled || !selected}
              placeholder="0.00"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none disabled:bg-gray-50"
            />
            {selected && (
              <p className="text-xs text-gray-500 mt-2">
                Invoice total {selected.totalAmount.toLocaleString()} · already paid {selected.amountPaid.toLocaleString()}
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between gap-4 flex-wrap">
          <p className="text-xs text-gray-500 flex items-center gap-1.5">
            <ExternalLink className="w-3.5 h-3.5" />
            When live, the payer is redirected to the provider&apos;s hosted checkout page.
          </p>
          <button
            onClick={handlePayOnline}
            disabled={!enabled || processing || !selected || !amount}
            className="flex items-center gap-2 px-6 py-3 rounded-lg font-semibold text-white bg-gradient-to-r from-blue-500 to-indigo-600 shadow-md hover:shadow-lg transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
            {enabled ? "Pay Online" : "Awaiting provider activation"}
          </button>
        </div>
      </div>
    </div>
  );
}
