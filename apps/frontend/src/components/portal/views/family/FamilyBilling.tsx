"use client";

import { useMemo, useState } from "react";
import {
  Activity, AlertTriangle, CheckCircle2, Clock, CreditCard, FileText, Printer,
  Receipt, RefreshCw, Search, Wallet, X,
} from "lucide-react";
import Swal from "sweetalert2";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { useFacilityConfig } from "@/lib/useFacilityConfig";
import { createRecord, updateRecord } from "@/lib/api";
import {
  adaptInvoice, adaptServiceCharge, adaptInsuranceValidation, adaptPayment,
} from "@/lib/adapters";
import {
  useRelative, useNowTs, MoneyStat, TabLoading, EmptyState, LiveBadge,
} from "./shared";

type Invoice = ReturnType<typeof adaptInvoice>;
type Payment = ReturnType<typeof adaptPayment>;

const STATUS: Record<string, { label: string; badge: string; bar: string }> = {
  DRAFT: { label: "Draft", badge: "bg-gray-100 text-gray-700 border-gray-200", bar: "bg-gray-400" },
  SENT: { label: "Sent", badge: "bg-blue-100 text-blue-700 border-blue-200", bar: "bg-blue-500" },
  PAID: { label: "Paid", badge: "bg-green-100 text-green-700 border-green-200", bar: "bg-green-500" },
  OVERDUE: { label: "Overdue", badge: "bg-red-100 text-red-700 border-red-200", bar: "bg-red-500" },
  CANCELLED: { label: "Cancelled", badge: "bg-gray-100 text-gray-500 border-gray-200", bar: "bg-gray-300" },
};
const statusMeta = (s: string) => STATUS[s] ?? STATUS.DRAFT;
const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

/** Billing & Finance — invoices, service charges, insurance, online payments, analytics. */
export default function FamilyBilling() {
  const { facilityName } = useFacilityConfig();
  const { displayName } = useRelative();
  const nowTs = useNowTs();

  const { data: invoiceRows, loading: invoiceLoading, refetch: refetchInvoices } = useLiveQuery("invoices", {
    query: "include=resident,serviceCharges,payments&take=100",
    tables: ["Invoice", "Resident", "ServiceCharge", "Payment"],
  });
  const { data: chargeRows, loading: chargeLoading, refetch: refetchCharges } = useLiveQuery("service-charges", {
    query: "include=resident,invoice&take=100",
    tables: ["ServiceCharge", "Resident", "Invoice"],
  });
  const { data: insuranceRows, loading: insuranceLoading } = useLiveQuery("insurance-validations", {
    query: "include=resident&take=100",
    tables: ["InsuranceValidation", "Resident"],
  });
  const { data: paymentRows, refetch: refetchPayments } = useLiveQuery("payments", {
    query: "include=invoice&take=100",
    tables: ["Payment", "Invoice"],
  });

  const [billView, setBillView] = useState<"list" | "analytics">("list");
  const [invStatus, setInvStatus] = useState<string>("all");
  const [invSearch, setInvSearch] = useState("");
  const [billSubTab, setBillSubTab] = useState<"invoices" | "charges" | "insurance">("invoices");
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [viewingReceipt, setViewingReceipt] = useState<Payment | any | null>(null);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [payForm, setPayForm] = useState({ cardName: "", cardNumber: "", cardExpiry: "", cardCvv: "" });

  // Normalize
  const invoices = invoiceRows.map((inv: unknown) => adaptInvoice(inv));
  const serviceCharges = chargeRows.map((sc: unknown) => adaptServiceCharge(sc));
  const insuranceValidations = insuranceRows.map((iv: unknown) => adaptInsuranceValidation(iv));
  const payments = paymentRows.map((p: unknown) => adaptPayment(p));

  const activeInvoices = invoices.filter((v) => v.status !== "CANCELLED");
  const totalBilled = activeInvoices.reduce((s, v) => s + v.totalAmount, 0);
  const totalPaid = activeInvoices.reduce((s, v) => s + v.amountPaid, 0);
  const balanceDue = Math.max(0, totalBilled - totalPaid);

  // Overdue Calculations
  const overdueList = activeInvoices.filter((v) => {
    const dueTs = v.dueDate ? new Date(v.dueDate).getTime() : 0;
    return v.status === "OVERDUE" || (v.balance > 0 && dueTs > 0 && nowTs > 0 && dueTs < nowTs && v.status !== "PAID");
  });
  const overdueAmount = overdueList.reduce((s, v) => s + v.balance, 0);

  // Filters & Sorting
  const q = invSearch.trim().toLowerCase();
  const filteredInvoices = invoices
    .filter((v) => invStatus === "all" || (invStatus === "overdue" ? overdueList.some(o => o.id === v.id) : v.status === invStatus))
    .filter((v) => !q || v.invoiceNumber.toLowerCase().includes(q) || v.description.toLowerCase().includes(q))
    .sort((a, b) => {
      const aTs = a.dueDate ? new Date(a.dueDate).getTime() : 0;
      const bTs = b.dueDate ? new Date(b.dueDate).getTime() : 0;
      return bTs - aTs;
    });

  const toVM = (i: Invoice): InvoiceVM => ({
    id: i.id, number: i.invoiceNumber, description: i.description,
    total: i.totalAmount, paid: i.amountPaid, balance: i.balance, status: i.status,
    dueTs: i.dueDate ? new Date(i.dueDate).getTime() : 0, overdue: i.balance > 0,
    periodStart: i.billingPeriodStart ? new Date(i.billingPeriodStart) : null,
    periodEnd: i.billingPeriodEnd ? new Date(i.billingPeriodEnd) : null,
  });

  const handlePayNow = (inv: Invoice) => {
    setPayingInvoice(inv);
    setPayForm({ cardName: "", cardNumber: "", cardExpiry: "", cardCvv: "" });
  };

  const submitOnlinePayment = async () => {
    if (!payingInvoice) return;
    if (!payForm.cardName || !payForm.cardNumber || !payForm.cardExpiry || !payForm.cardCvv) {
      Swal.fire("Missing Fields", "Please populate card details.", "warning");
      return;
    }
    setProcessingPayment(true);
    const invoice = payingInvoice;

    // Simulate real-time stripe payment gateway latency
    setTimeout(async () => {
      try {
        const txnId = `TXN-ONL-${Date.now()}`;
        // 1. Record payment
        await createRecord("payments", {
          invoiceId: invoice.id,
          amount: invoice.balance,
          paymentMethod: "CARD",
          transactionId: txnId,
          notes: `Authorized via Online Sponsor Portal. Cardholder: ${payForm.cardName}`,
        });

        // 2. Mark Invoice PAID
        await updateRecord("invoices", invoice.id, {
          amountPaid: invoice.totalAmount,
          status: "PAID",
          paidAt: new Date().toISOString(),
        });

        await refetchInvoices();
        await refetchPayments();
        await refetchCharges();

        const newPaymentMock = {
          transactionId: txnId,
          invoiceNumber: invoice.invoiceNumber,
          residentName: invoice.residentName,
          amount: invoice.balance,
          paymentDate: new Date(),
          paymentMethod: "CARD (ONLINE)",
        };

        setProcessingPayment(false);
        setPayingInvoice(null);
        Swal.fire({
          title: "Payment Authorized",
          text: `Transaction ${txnId} captured. Thank you for your payment.`,
          icon: "success",
        }).then(() => {
          setViewingReceipt(newPaymentMock);
        });
      } catch (err: unknown) {
        setProcessingPayment(false);
        const msg = err instanceof Error ? err.message : "Online authorization failed.";
        Swal.fire("Gateway Error", msg, "error");
      }
    }, 1800);
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 flex items-center gap-2 tracking-tight">
            <Receipt className="w-6 h-6 text-yellow-500 flex-shrink-0" /> Billing &amp; Finance
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm mt-1">
            <LiveBadge />
            Real-time payment portal for {displayName}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden bg-white shadow-sm">
            <button onClick={() => setBillView("list")} className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold transition ${billView === "list" ? "bg-yellow-400 text-black font-extrabold" : "text-gray-700 hover:bg-gray-50"}`}>
              <Receipt className="w-4 h-4" /> Billing Modules
            </button>
            <button onClick={() => setBillView("analytics")} className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold transition border-l border-gray-300 ${billView === "analytics" ? "bg-yellow-400 text-black font-extrabold" : "text-gray-700 hover:bg-gray-50"}`}>
              <Activity className="w-4 h-4" /> Financial Reports
            </button>
          </div>
          <button onClick={() => exportInvoicesCsv(invoices.map(toVM))} disabled={invoices.length === 0} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-xs font-bold disabled:opacity-50">
            <FileText className="w-4 h-4" /> Export CSV
          </button>
          <button onClick={() => { void refetchInvoices(); void refetchPayments(); }} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-xs font-bold">
            <RefreshCw className="w-4 h-4" /> Sync Ledger
          </button>
        </div>
      </div>

      {/* Financial summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <MoneyStat label="Total Billed" value={fmt(totalBilled)} icon={FileText} tone="gray" />
        <MoneyStat label="Total Paid" value={fmt(totalPaid)} icon={CheckCircle2} tone="green" />
        <MoneyStat label="Balance Due" value={fmt(balanceDue)} icon={Wallet} tone={balanceDue > 0 ? "amber" : "green"} />
        <MoneyStat label="Overdue Balance" value={fmt(overdueAmount)} icon={AlertTriangle} tone={overdueAmount > 0 ? "red" : "green"} sub={overdueList.length ? `${overdueList.length} overdue` : undefined} />
      </div>

      {billView === "analytics" && <BillingAnalytics invoices={invoices.map(toVM)} />}

      {billView === "list" && (
        <div className="space-y-6">
          {/* Sub Tabs: Invoices, Service Charges, Insurance */}
          <div className="flex border-b border-gray-200 gap-4 text-sm font-semibold">
            <button onClick={() => setBillSubTab("invoices")} className={`pb-2 border-b-2 transition ${billSubTab === "invoices" ? "border-yellow-500 text-yellow-600 font-bold" : "border-transparent text-gray-500 hover:text-gray-900"}`}>
              Invoices &amp; Receipts
            </button>
            <button onClick={() => setBillSubTab("charges")} className={`pb-2 border-b-2 transition ${billSubTab === "charges" ? "border-yellow-500 text-yellow-600 font-bold" : "border-transparent text-gray-500 hover:text-gray-900"}`}>
              Service Charge History
            </button>
            <button onClick={() => setBillSubTab("insurance")} className={`pb-2 border-b-2 transition ${billSubTab === "insurance" ? "border-yellow-500 text-yellow-600 font-bold" : "border-transparent text-gray-500 hover:text-gray-900"}`}>
              Insurance Policy
            </button>
          </div>

          {/* Sub Tab: Invoices */}
          {billSubTab === "invoices" && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <select value={invStatus} onChange={(e) => setInvStatus(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-yellow-400 outline-none text-sm font-semibold">
                  <option value="all">All Invoices</option>
                  <option value="overdue">Overdue</option>
                  {Object.keys(STATUS).map((k) => <option key={k} value={k}>{STATUS[k].label}</option>)}
                </select>
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
                  <input type="text" placeholder="Search invoice number or description…" value={invSearch} onChange={(e) => setInvSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none text-sm" />
                </div>
              </div>

              {invoiceLoading && invoiceRows.length === 0 ? (
                <TabLoading label="Loading invoices..." />
              ) : invoices.length === 0 ? (
                <EmptyState message="No invoices on file." />
              ) : filteredInvoices.length === 0 ? (
                <EmptyState message="No invoices match your filters." />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredInvoices.map((v) => {
                    const pct = v.totalAmount > 0 ? Math.round((v.amountPaid / v.totalAmount) * 100) : 0;
                    const isOverdue = overdueList.some(o => o.id === v.id);
                    return (
                      <div key={v.id} className={`bg-white rounded-xl border p-5 shadow-sm transition hover:shadow flex flex-col justify-between ${isOverdue ? "border-red-200 bg-red-50/10" : "border-gray-200"}`}>
                        <div>
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="min-w-0">
                              <h4 className="font-extrabold text-gray-900 text-lg leading-tight truncate">{v.invoiceNumber}</h4>
                              {v.description && <p className="text-xs text-gray-500 font-semibold mt-0.5 truncate">{v.description}</p>}
                            </div>
                            <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${isOverdue ? "bg-red-100 text-red-700 border-red-200" : statusMeta(v.status).badge}`}>
                              {isOverdue ? "Overdue" : statusMeta(v.status).label}
                            </span>
                          </div>
                          {(v.billingPeriodStart && v.billingPeriodEnd) && (
                            <p className="text-xs text-gray-400 font-semibold mb-3">Period: {new Date(v.billingPeriodStart).toLocaleDateString()} – {new Date(v.billingPeriodEnd).toLocaleDateString()}</p>
                          )}

                          <div className="grid grid-cols-3 gap-2 text-center my-4 py-2 border-y border-dashed border-gray-100 bg-gray-50/40 rounded-lg">
                            <div><p className="text-[10px] uppercase font-bold text-gray-400">Total</p><p className="font-extrabold text-gray-900">{fmt(v.totalAmount)}</p></div>
                            <div><p className="text-[10px] uppercase font-bold text-gray-400">Paid</p><p className="font-extrabold text-green-600">{fmt(v.amountPaid)}</p></div>
                            <div><p className="text-[10px] uppercase font-bold text-gray-400">Balance</p><p className={`font-extrabold ${v.balance > 0 ? "text-amber-600" : "text-gray-400"}`}>{fmt(v.balance)}</p></div>
                          </div>

                          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full ${pct === 100 ? "bg-green-500" : "bg-yellow-400"} transition-all`} style={{ width: `${pct}%` }} />
                          </div>
                          <p className={`text-xs mt-3 flex items-center gap-1.5 ${isOverdue ? "text-red-600 font-extrabold" : "text-gray-500 font-medium"}`}>
                            <Clock className="w-4 h-4" /> Due {v.dueDate ? new Date(v.dueDate).toLocaleDateString() : "—"}
                          </p>
                        </div>

                        <div className="mt-4 pt-3 border-t border-gray-100 flex gap-2">
                          {v.balance > 0 && v.status !== "DRAFT" && (
                            <button onClick={() => handlePayNow(v)} className="flex-1 py-2 bg-yellow-400 hover:bg-yellow-500 text-black font-extrabold rounded-lg text-xs transition shadow-sm active:scale-95 flex items-center justify-center gap-1.5">
                              <CreditCard className="w-3.5 h-3.5" /> Pay Balance Online
                            </button>
                          )}
                          {v.amountPaid > 0 && (
                            <button onClick={() => {
                              const relPayment = payments.find(p => p.invoiceId === v.id);
                              if (relPayment) {
                                setViewingReceipt(relPayment);
                              } else {
                                setViewingReceipt({
                                  transactionId: `TXN-GEN-${v.id.slice(-6)}`,
                                  invoiceNumber: v.invoiceNumber,
                                  residentName: v.residentName,
                                  amount: v.amountPaid,
                                  paymentDate: v.paidAt || new Date(),
                                  paymentMethod: "OFFLINE RECORD",
                                });
                              }
                            }} className="flex-1 py-2 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold border border-gray-200 rounded-lg text-xs transition flex items-center justify-center gap-1.5">
                              <Printer className="w-3.5 h-3.5 text-gray-500" /> View Payment Receipt
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Sub Tab: Service Charges */}
          {billSubTab === "charges" && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                    <tr>
                      <th className="px-6 py-4">Service Date</th>
                      <th className="px-6 py-4">Category</th>
                      <th className="px-6 py-4">Description</th>
                      <th className="px-6 py-4">Amount</th>
                      <th className="px-6 py-4">Invoiced</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 text-gray-700">
                    {chargeLoading ? (
                      <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">Loading service charges...</td></tr>
                    ) : serviceCharges.length > 0 ? serviceCharges.map((sc) => (
                      <tr key={sc.id} className="hover:bg-gray-50/50">
                        <td className="px-6 py-4 text-xs font-semibold text-gray-500">{sc.serviceDate ? new Date(sc.serviceDate).toLocaleDateString() : ""}</td>
                        <td className="px-6 py-4"><span className="px-2.5 py-1 bg-purple-50 text-purple-700 border border-purple-100 rounded-lg text-xs font-bold">{sc.category}</span></td>
                        <td className="px-6 py-4 max-w-[200px] truncate">{sc.description}</td>
                        <td className="px-6 py-4 font-bold text-gray-900">${sc.amount.toLocaleString()}</td>
                        <td className="px-6 py-4">
                          {sc.invoiceId ? (
                            <span className="text-green-700 font-bold text-xs flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> Billed ({sc.invoiceNumber})</span>
                          ) : (
                            <span className="text-amber-700 font-bold text-xs flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-amber-500" /> Pending</span>
                          )}
                        </td>
                      </tr>
                    )) : (
                      <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">No recorded service charges.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Sub Tab: Insurance */}
          {billSubTab === "insurance" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {insuranceLoading ? (
                <div className="bg-white p-8 border rounded-xl text-center text-gray-500 col-span-full">Loading policies...</div>
              ) : insuranceValidations.length > 0 ? insuranceValidations.map((iv) => (
                <div key={iv.id} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-4">
                  <div className="flex justify-between items-start border-b border-gray-100 pb-3">
                    <div>
                      <h4 className="font-extrabold text-gray-900 text-lg leading-tight">{iv.provider}</h4>
                      <p className="text-xs text-gray-400 font-bold mt-1">Policy: {iv.policyNumber}</p>
                    </div>
                    <span className={`px-2.5 py-1 text-xs font-bold rounded-lg border ${
                      iv.status === "VALIDATED" ? "bg-green-50 text-green-700 border-green-200" :
                      iv.status === "FAILED" ? "bg-red-50 text-red-700 border-red-200" :
                      "bg-yellow-50 text-yellow-700 border-yellow-200"
                    }`}>
                      {iv.status}
                    </span>
                  </div>
                  <div className="text-xs space-y-2 text-gray-700">
                    {iv.groupNumber && <p><span className="font-semibold text-gray-500">Group Number:</span> {iv.groupNumber}</p>}
                    <p><span className="font-semibold text-gray-500">Coverage Terms:</span> {iv.coverageDetails}</p>
                    {iv.verifiedAt && <p className="text-gray-400 italic pt-2 border-t border-gray-100">Gateway verification checked on {new Date(iv.verifiedAt).toLocaleDateString()}.</p>}
                  </div>
                </div>
              )) : (
                <div className="bg-white p-8 border rounded-xl text-center text-gray-500 col-span-full">No active insurance verification policy files found.</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── ONLINE CHECKOUT GATEWAY MODAL ── */}
      {payingInvoice && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-gray-900 text-white p-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-yellow-400" />
                <span className="font-bold">Secure Card Checkout</span>
              </div>
              <button onClick={() => setPayingInvoice(null)} disabled={processingPayment} className="p-2 hover:bg-white/10 rounded-lg transition"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-6 space-y-5">
              <div className="bg-gray-50 rounded-lg p-4 text-xs space-y-2 border border-gray-100">
                <div className="flex justify-between"><span>Billing Invoice:</span><span className="font-bold text-gray-800">{payingInvoice.invoiceNumber}</span></div>
                <div className="flex justify-between"><span>Resident:</span><span className="font-bold text-gray-800">{payingInvoice.residentName}</span></div>
                <div className="flex justify-between text-sm border-t border-dashed border-gray-200 pt-2"><span className="font-bold text-gray-700">Amount Due:</span><span className="font-extrabold text-yellow-600">${payingInvoice.balance.toLocaleString()}</span></div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cardholder Name *</label>
                  <input type="text" placeholder="John Sponsor" value={payForm.cardName} onChange={(e) => setPayForm({ ...payForm, cardName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Credit Card Number *</label>
                  <input type="text" placeholder="4111 2222 3333 4444" value={payForm.cardNumber} onChange={(e) => setPayForm({ ...payForm, cardNumber: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Expiry Date *</label>
                    <input type="text" placeholder="MM/YY" value={payForm.cardExpiry} onChange={(e) => setPayForm({ ...payForm, cardExpiry: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">CVV/CVC *</label>
                    <input type="password" placeholder="***" maxLength={4} value={payForm.cardCvv} onChange={(e) => setPayForm({ ...payForm, cardCvv: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white" />
                  </div>
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-between items-center">
              <button onClick={() => setPayingInvoice(null)} disabled={processingPayment} className="px-4 py-2 text-gray-600 hover:text-gray-900 text-sm font-semibold transition">
                Cancel
              </button>
              <button onClick={submitOnlinePayment} disabled={processingPayment} className="px-6 py-2 bg-yellow-400 hover:bg-yellow-500 text-black font-extrabold rounded-lg text-sm transition disabled:opacity-60 shadow flex items-center gap-1.5">
                {processingPayment ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Authorizing Gateway...
                  </>
                ) : (
                  <>
                    <CreditCard className="w-4 h-4" />
                    Authorize Payment
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PRINTABLE RECEIPTS MODAL ── */}
      {viewingReceipt && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto">
            <div className="p-8 space-y-6 relative overflow-hidden" id="printable-receipt">
              <div className="absolute top-20 left-1/2 -translate-x-1/2 rotate-12 border-4 border-green-500/20 text-green-500/20 font-extrabold text-5xl px-6 py-2 tracking-widest pointer-events-none select-none rounded-xl">
                PAID
              </div>
              <div className="text-center space-y-1">
                <h2 className="text-2xl font-extrabold text-green-600 tracking-tight uppercase">Receipt of Payment</h2>
                <p className="text-xs text-gray-500 font-semibold">{facilityName || "Facility"} Assisted Living Facility</p>
                <p className="text-[10px] text-gray-400 font-mono mt-1">TXN ID: {viewingReceipt.transactionId}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-5 border border-gray-100 space-y-4 text-xs mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><span className="text-gray-500 block">Resident Name</span><strong className="text-gray-800 text-sm">{viewingReceipt.residentName}</strong></div>
                  <div><span className="text-gray-500 block">Invoice Reference</span><strong className="text-gray-800 text-sm">{viewingReceipt.invoiceNumber}</strong></div>
                  <div><span className="text-gray-500 block">Payment Date</span><strong className="text-gray-800 text-sm">{viewingReceipt.paymentDate ? new Date(viewingReceipt.paymentDate).toLocaleDateString() : ""}</strong></div>
                  <div><span className="text-gray-500 block">Method Used</span><strong className="text-gray-800 text-sm">{viewingReceipt.paymentMethod}</strong></div>
                </div>
                <div className="border-t border-dashed border-gray-200 pt-4 flex justify-between items-center text-sm">
                  <span className="font-extrabold text-gray-700">Total Captured</span>
                  <span className="font-black text-green-600 text-xl">${viewingReceipt.amount.toLocaleString()}</span>
                </div>
              </div>
              <p className="text-center text-[9px] text-gray-400 mt-6 leading-relaxed">
                Thank you for your payment. This receipt confirms that the funds have been successfully validated and processed.
              </p>
            </div>
            <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-between">
              <button onClick={() => setViewingReceipt(null)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 border border-gray-300 rounded-lg text-xs font-bold transition">Close</button>
              <button onClick={() => window.print()} className="flex items-center gap-2 px-5 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg text-xs transition"><Printer className="w-3.5 h-3.5" /> Print Receipt</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Billing analytics ───────────────────────────────────────────────── */
interface InvoiceVM {
  id: string; number: string; description: string;
  total: number; paid: number; balance: number; status: string;
  dueTs: number; overdue: boolean;
  periodStart: Date | null; periodEnd: Date | null;
}
const STATUS_PIE_COLOR: Record<string, string> = {
  DRAFT: "#9ca3af", SENT: "#3b82f6", PAID: "#22c55e", OVERDUE: "#ef4444", CANCELLED: "#d1d5db",
};

function exportInvoicesCsv(rows: InvoiceVM[]): void {
  const headers = ["Invoice", "Description", "Total", "Paid", "Balance", "Status", "Due"];
  const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  rows.forEach((v) => lines.push([v.number, v.description, v.total, v.paid, v.balance, v.status, v.dueTs ? new Date(v.dueTs).toLocaleDateString() : ""].map(esc).join(",")));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "invoices.csv"; a.click();
  URL.revokeObjectURL(url);
}

function BillingAnalytics({ invoices }: { invoices: InvoiceVM[] }) {
  const a = useMemo(() => {
    const map = new Map<string, { label: string; Billed: number; Paid: number; sort: number }>();
    invoices.forEach((v) => {
      const d = v.periodEnd ?? (v.dueTs ? new Date(v.dueTs) : null);
      if (!d) return;
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const cur = map.get(key) ?? { label: d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }), Billed: 0, Paid: 0, sort: d.getFullYear() * 12 + d.getMonth() };
      cur.Billed += v.total; cur.Paid += v.paid;
      map.set(key, cur);
    });
    const byMonth = Array.from(map.values()).sort((x, y) => x.sort - y.sort);
    const statusPie = Object.keys(STATUS_PIE_COLOR)
      .map((k) => ({ name: k.charAt(0) + k.slice(1).toLowerCase(), key: k, value: invoices.filter((v) => v.status === k).length }))
      .filter((s) => s.value > 0);
    const topBalances = [...invoices].filter((v) => v.balance > 0).sort((x, y) => y.balance - x.balance).slice(0, 5);
    return { byMonth, statusPie, topBalances };
  }, [invoices]);

  if (invoices.length === 0) return <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">No billing data to analyze.</div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 mb-3">Billed vs Paid by Month</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={a.byMonth} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="label" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis fontSize={12} tickLine={false} axisLine={false} width={48} tickFormatter={(n) => `$${Math.round(Number(n) / 1000)}k`} />
            <Tooltip formatter={(n) => `$${Math.round(Number(n)).toLocaleString()}`} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <Legend />
            <Bar dataKey="Billed" fill="#eab308" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Paid" fill="#22c55e" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 mb-3">Invoices by Status</h3>
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie data={a.statusPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
              {a.statusPie.map((s, i) => <Cell key={i} fill={STATUS_PIE_COLOR[s.key]} />)}
            </Pie>
            <Tooltip /><Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 mb-3">Largest Outstanding Balances</h3>
        {a.topBalances.length > 0 ? (
          <div className="space-y-2">
            {a.topBalances.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-100">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 text-sm truncate">{v.number}</p>
                  <p className="text-xs text-gray-600 truncate">{v.description || "—"}</p>
                </div>
                <span className="font-bold text-amber-700 flex-shrink-0">${Math.round(v.balance).toLocaleString()}</span>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-green-700 py-6 text-center">All invoices are fully paid. 🎉</p>}
      </div>
    </div>
  );
}
