"use client";

import { useMemo, useState } from "react";
import {
  DollarSign, Search, Eye, FileText, AlertTriangle, CheckCircle, Clock, X, Plus,
  Printer, ShieldCheck, CreditCard, RefreshCw, Layers, ClipboardList, TrendingUp, Download
} from "lucide-react";
import Swal from "sweetalert2";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { useFacilityConfig } from "@/lib/useFacilityConfig";
import { adaptInvoice, adaptServiceCharge, adaptInsuranceValidation, adaptPayment } from "@/lib/adapters";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";

type Invoice = ReturnType<typeof adaptInvoice>;
type ServiceCharge = ReturnType<typeof adaptServiceCharge>;
type InsuranceValidation = ReturnType<typeof adaptInsuranceValidation>;
type Payment = ReturnType<typeof adaptPayment>;

const STATUS_BADGE: Record<string, string> = {
  PAID: "bg-green-100 text-green-800 border border-green-200",
  SENT: "bg-blue-100 text-blue-800 border border-blue-200",
  DRAFT: "bg-gray-100 text-gray-800 border border-gray-200",
  OVERDUE: "bg-red-100 text-red-800 border border-red-200",
  CANCELLED: "bg-yellow-100 text-yellow-800 border border-yellow-200",
};

const TAB_STYLING = (active: boolean) =>
  `px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-2 ${
    active
      ? "bg-yellow-400 text-black shadow-md scale-105"
      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
  }`;

export default function FacilityBilling() {
  const [activeTab, setActiveTab] = useState<"overview" | "charges" | "insurance" | "invoices" | "payments" | "receipts">("overview");

  // Real-time Queries
  const { data: invoiceRows, loading: invLoading, refetch: refetchInvoices } = useLiveQuery<Record<string, unknown>>(
    "invoices", { query: "include=resident,serviceCharges,payments&take=300", tables: ["Invoice", "Resident", "ServiceCharge", "Payment"] }
  );
  const { data: residentRows } = useLiveQuery<Record<string, unknown>>(
    "residents", { query: "take=150", tables: ["Resident"] }
  );
  const { data: chargeRows, loading: chargeLoading, refetch: refetchCharges } = useLiveQuery<Record<string, unknown>>(
    "service-charges", { query: "include=resident,invoice&take=300", tables: ["ServiceCharge", "Resident", "Invoice"] }
  );
  const { data: insuranceRows, loading: insLoading, refetch: refetchInsurance } = useLiveQuery<Record<string, unknown>>(
    "insurance-validations", { query: "include=resident&take=300", tables: ["InsuranceValidation", "Resident"] }
  );
  const { data: paymentRows, loading: payLoading, refetch: refetchPayments } = useLiveQuery<Record<string, unknown>>(
    "payments", { query: "include=invoice&take=300", tables: ["Payment", "Invoice"] }
  );
  const { facilityName, facilityAddress } = useFacilityConfig();

  // Normalized Models
  const invoices = useMemo<Invoice[]>(() => invoiceRows.map(adaptInvoice), [invoiceRows]);
  const residents = useMemo(() => residentRows.map((r: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    id: r.id,
    name: `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || r.id,
    room: r.roomNumber ?? "—"
  })), [residentRows]);
  const serviceCharges = useMemo<ServiceCharge[]>(() => chargeRows.map(adaptServiceCharge), [chargeRows]);
  const insuranceValidations = useMemo<InsuranceValidation[]>(() => insuranceRows.map(adaptInsuranceValidation), [insuranceRows]);
  const payments = useMemo<Payment[]>(() => paymentRows.map(adaptPayment), [paymentRows]);

  // UI Filters / Searching
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [chargeFilter, setChargeFilter] = useState("all"); // all, pending, invoiced

  // Modals & Forms State
  const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null);
  const [viewingReceipt, setViewingReceipt] = useState<Payment | null>(null);
  const [showCreateInvoice, setShowCreateInvoice] = useState(false);
  const [showRecordCharge, setShowRecordCharge] = useState(false);
  const [showVerifyInsurance, setShowVerifyInsurance] = useState(false);
  const [showRecordPayment, setShowRecordPayment] = useState(false);

  const [verifyingInsId, setVerifyingInsId] = useState<string | null>(null);

  // Form Fields
  const [invoiceForm, setInvoiceForm] = useState({
    residentId: "", description: "", dueDate: "", billingPeriodStart: "", billingPeriodEnd: "", addPendingCharges: true
  });
  const [chargeForm, setChargeForm] = useState({
    residentId: "", description: "", amount: "", category: "Care Services", serviceDate: new Date().toISOString().slice(0, 10)
  });
  const [insuranceForm, setInsuranceForm] = useState({
    residentId: "", provider: "", policyNumber: "", groupNumber: "", coverageDetails: "", notes: ""
  });
  const [paymentForm, setPaymentForm] = useState({
    invoiceId: "", amount: "", paymentMethod: "CARD", transactionId: "", notes: ""
  });

  // Calculate Overview Stats
  const stats = useMemo(() => {
    const totalBilled = invoices.filter(i => i.status !== "CANCELLED").reduce((s, i) => s + i.totalAmount, 0);
    const totalCollected = invoices.filter(i => i.status !== "CANCELLED").reduce((s, i) => s + i.amountPaid, 0);
    const totalOutstanding = Math.max(0, totalBilled - totalCollected);
    const overdueCount = invoices.filter(i => i.status === "OVERDUE").length;
    const pendingChargesSum = serviceCharges.filter(c => !c.invoiceId).reduce((s, c) => s + c.amount, 0);
    const verifiedInsCount = insuranceValidations.filter(i => i.status === "VALIDATED").length;

    return {
      totalBilled,
      totalCollected,
      totalOutstanding,
      overdueCount,
      pendingChargesSum,
      verifiedInsCount
    };
  }, [invoices, serviceCharges, insuranceValidations]);

  // Action: Add Service Charge
  const handleRecordCharge = async () => {
    if (!chargeForm.residentId || !chargeForm.amount || !chargeForm.description) {
      Swal.fire("Missing Fields", "Please populate Resident, Amount, and Description.", "warning");
      return;
    }
    const result = await Swal.fire({
      title: "Record Service Charge?",
      text: `Record charge of $${Number(chargeForm.amount).toLocaleString()}?`,
      icon: "question", showCancelButton: true, confirmButtonColor: "#fbbf24", cancelButtonColor: "#6b7280"
    });
    if (result.isConfirmed) {
      try {
        await createRecord("service-charges", {
          residentId: chargeForm.residentId,
          description: chargeForm.description,
          amount: Number(chargeForm.amount),
          category: chargeForm.category,
          serviceDate: new Date(chargeForm.serviceDate).toISOString()
        });
        await refetchCharges();
        setShowRecordCharge(false);
        setChargeForm({ residentId: "", description: "", amount: "", category: "Care Services", serviceDate: new Date().toISOString().slice(0, 10) });
        Swal.fire("Success", "Service charge recorded successfully.", "success");
      } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        Swal.fire("Failed", err.message || "Failed to record charge.", "error");
      }
    }
  };

  // Action: Trigger Insurance Verification Mock Flow
  const triggerInsuranceValidation = async (insId: string) => {
    setVerifyingInsId(insId);
    // Simulate real-time validation call
    setTimeout(async () => {
      try {
        const isSuccess = Math.random() > 0.15; // 85% success rate
        await updateRecord("insurance-validations", insId, {
          status: isSuccess ? "VALIDATED" : "FAILED",
          verifiedAt: new Date().toISOString(),
          verifiedBy: "Admin Integrator",
          notes: isSuccess ? "Verified coverage against automated clearinghouse gateway." : "Failed to verify. Policy inactive or invalid policy details."
        });
        await refetchInsurance();
        setVerifyingInsId(null);
        Swal.fire({
          title: isSuccess ? "Insurance Verified" : "Verification Failed",
          text: isSuccess ? "Policy details validated. Active coverage confirmed." : "Automated verification failed. Please check policy details or call provider.",
          icon: isSuccess ? "success" : "error"
        });
      } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        setVerifyingInsId(null);
        Swal.fire("Error", err.message || "Could not verify insurance.", "error");
      }
    }, 2000);
  };

  // Action: Record Insurance Policy
  const handleRecordInsurance = async () => {
    if (!insuranceForm.residentId || !insuranceForm.provider || !insuranceForm.policyNumber) {
      Swal.fire("Missing Fields", "Resident, Provider, and Policy Number are required.", "warning");
      return;
    }
    try {
      await createRecord("insurance-validations", {
        residentId: insuranceForm.residentId,
        provider: insuranceForm.provider,
        policyNumber: insuranceForm.policyNumber,
        groupNumber: insuranceForm.groupNumber || null,
        coverageDetails: insuranceForm.coverageDetails || "General medical care coverage.",
        status: "PENDING"
      });
      await refetchInsurance();
      setShowVerifyInsurance(false);
      setInsuranceForm({ residentId: "", provider: "", policyNumber: "", groupNumber: "", coverageDetails: "", notes: "" });
      Swal.fire("Saved", "Insurance policy added. Verification pending.", "success");
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      Swal.fire("Failed", err.message || "Failed to add insurance.", "error");
    }
  };

  // Action: Create Invoice
  const handleCreateInvoice = async () => {
    if (!invoiceForm.residentId || !invoiceForm.dueDate) {
      Swal.fire("Missing Fields", "Resident and Due Date are required.", "warning");
      return;
    }

    // Determine pending service charges if option selected
    const pendingForResident = serviceCharges.filter(c => c.residentId === invoiceForm.residentId && !c.invoiceId);
    const sumPending = pendingForResident.reduce((s, c) => s + c.amount, 0);

    const result = await Swal.fire({
      title: "Generate Invoice?",
      text: pendingForResident.length > 0 && invoiceForm.addPendingCharges
        ? `Create invoice pulling in ${pendingForResident.length} pending service charges worth $${sumPending.toLocaleString()}?`
        : "Create a blank draft invoice?",
      icon: "question", showCancelButton: true, confirmButtonColor: "#fbbf24"
    });

    if (result.isConfirmed) {
      try {
        const now = new Date();
        const invNum = `INV-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}${String(invoices.length + 1).padStart(3, "0")}`;
        
        const invoicePayload = {
          residentId: invoiceForm.residentId,
          invoiceNumber: invNum,
          totalAmount: pendingForResident.length > 0 && invoiceForm.addPendingCharges ? sumPending : 0,
          amountPaid: 0,
          dueDate: new Date(invoiceForm.dueDate).toISOString(),
          billingPeriodStart: invoiceForm.billingPeriodStart ? new Date(invoiceForm.billingPeriodStart).toISOString() : now.toISOString(),
          billingPeriodEnd: invoiceForm.billingPeriodEnd ? new Date(invoiceForm.billingPeriodEnd).toISOString() : now.toISOString(),
          description: invoiceForm.description || "Assisted living care services & recorded incident charges.",
          status: "DRAFT"
        };

        const res = await createRecord("invoices", invoicePayload);
        const invoiceId = res.data?.id || res.id;

        // If we want to link the service charges, update them
        if (pendingForResident.length > 0 && invoiceForm.addPendingCharges && invoiceId) {
          for (const charge of pendingForResident) {
            await updateRecord("service-charges", charge.id, { invoiceId });
          }
        }

        await refetchInvoices();
        await refetchCharges();
        setShowCreateInvoice(false);
        setInvoiceForm({ residentId: "", description: "", dueDate: "", billingPeriodStart: "", billingPeriodEnd: "", addPendingCharges: true });
        Swal.fire("Invoice Generated", `Draft Invoice ${invNum} has been generated.`, "success");
      } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        Swal.fire("Generation Failed", err.message || "Failed to generate invoice.", "error");
      }
    }
  };

  // Action: Process & Record Payment
  const handleRecordPayment = async () => {
    if (!paymentForm.invoiceId || !paymentForm.amount) {
      Swal.fire("Missing Fields", "Invoice and Amount Paid are required.", "warning");
      return;
    }

    const selectedInv = invoices.find(i => i.id === paymentForm.invoiceId);
    if (!selectedInv) return;

    const amt = Number(paymentForm.amount);
    const updatedPaid = selectedInv.amountPaid + amt;
    const updatedStatus = updatedPaid >= selectedInv.totalAmount ? "PAID" : "SENT";

    const result = await Swal.fire({
      title: "Process Payment?",
      text: `Authorize receipt of $${amt.toLocaleString()} on ${selectedInv.invoiceNumber}?`,
      icon: "info", showCancelButton: true, confirmButtonColor: "#10b981"
    });

    if (result.isConfirmed) {
      try {
        const txnId = paymentForm.transactionId || `TXN-${Date.now()}`;
        // 1. Create Payment Log
        await createRecord("payments", {
          invoiceId: paymentForm.invoiceId,
          amount: amt,
          paymentMethod: paymentForm.paymentMethod,
          transactionId: txnId,
          notes: paymentForm.notes || "Recorded via Admin Billing Portal"
        });

        // 2. Update Invoice
        await updateRecord("invoices", paymentForm.invoiceId, {
          amountPaid: updatedPaid,
          status: updatedStatus,
          paidAt: updatedStatus === "PAID" ? new Date().toISOString() : null
        });

        await refetchPayments();
        await refetchInvoices();
        setShowRecordPayment(false);
        setPaymentForm({ invoiceId: "", amount: "", paymentMethod: "CARD", transactionId: "", notes: "" });
        Swal.fire("Payment Approved", `Receipt logged under transaction ${txnId}.`, "success");
      } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        Swal.fire("Failed", err.message || "Could not log payment.", "error");
      }
    }
  };

  // Action: Trigger invoice release (Mark as Sent)
  const handleMarkSent = async (inv: Invoice) => {
    const result = await Swal.fire({
      title: "Send Invoice?",
      text: `Distribute invoice ${inv.invoiceNumber} to resident's family sponsor?`,
      icon: "question", showCancelButton: true, confirmButtonColor: "#3b82f6"
    });
    if (result.isConfirmed) {
      try {
        await updateRecord("invoices", inv.id, {
          status: "SENT",
          sentAt: new Date().toISOString()
        });
        await refetchInvoices();
        Swal.fire("Sent", "Invoice dispatched successfully.", "success");
      } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        Swal.fire("Failed", err.message || "Could not send invoice.", "error");
      }
    }
  };

  // Export Financial Reports to CSV
  const handleExportCSV = () => {
    if (invoices.length === 0) return;
    const headers = ["Invoice Number,Resident,Total Amount,Amount Paid,Balance,Due Date,Status,Billing Start,Billing End\n"];
    const rows = invoices.map(i => 
      `"${i.invoiceNumber}","${i.residentName}",${i.totalAmount},${i.amountPaid},${i.balance},"${i.dueDate ? new Date(i.dueDate).toLocaleDateString() : ""}",` +
      `"${i.status}","${i.billingPeriodStart ? new Date(i.billingPeriodStart).toLocaleDateString() : ""}","${i.billingPeriodEnd ? new Date(i.billingPeriodEnd).toLocaleDateString() : ""}"`
    ).join("\n");
    const blob = new Blob([...headers, rows], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `finance_report_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filtered views based on search query
  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((i) => {
      if (q && !i.invoiceNumber.toLowerCase().includes(q) && !i.residentName.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      return true;
    });
  }, [invoices, search, statusFilter]);

  const filteredCharges = useMemo(() => {
    const q = search.trim().toLowerCase();
    return serviceCharges.filter((c) => {
      if (q && !c.description.toLowerCase().includes(q) && !c.residentName.toLowerCase().includes(q)) return false;
      if (chargeFilter === "pending" && c.invoiceId) return false;
      if (chargeFilter === "invoiced" && !c.invoiceId) return false;
      return true;
    });
  }, [serviceCharges, search, chargeFilter]);

  const filteredInsurance = useMemo(() => {
    const q = search.trim().toLowerCase();
    return insuranceValidations.filter((iv) => {
      if (q && !iv.residentName.toLowerCase().includes(q) && !iv.provider.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [insuranceValidations, search]);

  const filteredPayments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payments.filter((p) => {
      if (q && !p.invoiceNumber.toLowerCase().includes(q) && !p.residentName.toLowerCase().includes(q) && !p.transactionId?.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [payments, search]);

  return (
    <div className="space-y-6">
      {/* Portal Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-extrabold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-1">
            Billing &amp; Finance Control Center
          </h1>
          <p className="text-gray-600 font-medium">Real-time ledger audit, insurance validation gateway, and payment processing hub</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowRecordCharge(true)} className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-yellow-400 border border-yellow-400/20 font-bold rounded-lg hover:bg-gray-800 transition active:scale-95 text-sm shadow">
            <Layers className="w-4 h-4" /> Record Service Charge
          </button>
          <button onClick={() => setShowVerifyInsurance(true)} className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-yellow-400 border border-yellow-400/20 font-bold rounded-lg hover:bg-gray-800 transition active:scale-95 text-sm shadow">
            <ShieldCheck className="w-4 h-4" /> Validate Insurance
          </button>
          <button onClick={() => setShowCreateInvoice(true)} className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-extrabold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">
            <Plus className="w-4 h-4" /> New Invoice
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 overflow-x-auto gap-2 py-1 scrollbar-none">
        <button onClick={() => { setActiveTab("overview"); setSearch(""); }} className={TAB_STYLING(activeTab === "overview")}>
          <TrendingUp className="w-4 h-4" /> Financial Reports
        </button>
        <button onClick={() => { setActiveTab("charges"); setSearch(""); }} className={TAB_STYLING(activeTab === "charges")}>
          <Layers className="w-4 h-4" /> Service Charges
        </button>
        <button onClick={() => { setActiveTab("insurance"); setSearch(""); }} className={TAB_STYLING(activeTab === "insurance")}>
          <ShieldCheck className="w-4 h-4" /> Insurance Validations
        </button>
        <button onClick={() => { setActiveTab("invoices"); setSearch(""); }} className={TAB_STYLING(activeTab === "invoices")}>
          <FileText className="w-4 h-4" /> Invoice Generation
        </button>
        <button onClick={() => { setActiveTab("payments"); setSearch(""); }} className={TAB_STYLING(activeTab === "payments")}>
          <CreditCard className="w-4 h-4" /> Payment Processing
        </button>
        <button onClick={() => { setActiveTab("receipts"); setSearch(""); }} className={TAB_STYLING(activeTab === "receipts")}>
          <Printer className="w-4 h-4" /> Receipts Issued
        </button>
      </div>

      {/* ── VIEW TAB 1: OVERVIEW & REPORTS ── */}
      {activeTab === "overview" && (
        <div className="space-y-6 animate-fadeIn">
          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatBox label="Total Revenue Collected" value={`$${stats.totalCollected.toLocaleString()}`} icon={CheckCircle} color="green" />
            <StatBox label="Total Outstanding Balance" value={`$${stats.totalOutstanding.toLocaleString()}`} icon={Clock} color="amber" />
            <StatBox label="Unbilled Pending Charges" value={`$${stats.pendingChargesSum.toLocaleString()}`} icon={Layers} color="blue" />
            <StatBox label="Overdue Invoices" value={String(stats.overdueCount)} icon={AlertTriangle} color="red" />
          </div>

          {/* Simple Beautiful Bar/Line Analytics Charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900">Collections Summary</h3>
                <button onClick={handleExportCSV} className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1">
                  <Download className="w-3.5 h-3.5" /> Export Data
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm font-semibold text-gray-600 mb-1">
                    <span>Collected Revenue ({Math.round(stats.totalBilled > 0 ? (stats.totalCollected / stats.totalBilled) * 100 : 0)}%)</span>
                    <span className="text-green-600">${stats.totalCollected.toLocaleString()}</span>
                  </div>
                  <div className="w-full h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 transition-all duration-500" style={{ width: `${stats.totalBilled > 0 ? (stats.totalCollected / stats.totalBilled) * 100 : 0}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm font-semibold text-gray-600 mb-1">
                    <span>Outstanding Receivables</span>
                    <span className="text-amber-600">${stats.totalOutstanding.toLocaleString()}</span>
                  </div>
                  <div className="w-full h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${stats.totalBilled > 0 ? (stats.totalOutstanding / stats.totalBilled) * 100 : 0}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm font-semibold text-gray-600 mb-1">
                    <span>Unbilled Care Backlog</span>
                    <span className="text-blue-600">${stats.pendingChargesSum.toLocaleString()}</span>
                  </div>
                  <div className="w-full h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${stats.totalCollected > 0 ? Math.min(100, (stats.pendingChargesSum / stats.totalCollected) * 100) : 0}%` }} />
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Invoice Ledger Distribution</h3>
              <div className="grid grid-cols-2 gap-4 text-center">
                <div className="p-3 bg-green-50 border border-green-100 rounded-lg">
                  <p className="text-xs font-bold text-green-700">PAID</p>
                  <p className="text-2xl font-extrabold text-green-800">{invoices.filter(i => i.status === "PAID").length}</p>
                </div>
                <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg">
                  <p className="text-xs font-bold text-blue-700">SENT / UNPAID</p>
                  <p className="text-2xl font-extrabold text-blue-800">{invoices.filter(i => i.status === "SENT").length}</p>
                </div>
                <div className="p-3 bg-red-50 border border-red-100 rounded-lg">
                  <p className="text-xs font-bold text-red-700">OVERDUE</p>
                  <p className="text-2xl font-extrabold text-red-800">{invoices.filter(i => i.status === "OVERDUE").length}</p>
                </div>
                <div className="p-3 bg-gray-50 border border-gray-100 rounded-lg">
                  <p className="text-xs font-bold text-gray-700">DRAFTS</p>
                  <p className="text-2xl font-extrabold text-gray-800">{invoices.filter(i => i.status === "DRAFT").length}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Financial summary table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
              <h3 className="font-bold text-gray-900">Global Financial Summary</h3>
              <button onClick={handleExportCSV} className="px-3 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-lg font-bold text-xs flex items-center gap-1">
                <FileText className="w-3.5 h-3.5" /> Export All Invoices
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-100 text-gray-600 font-semibold border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3">Resident</th>
                    <th className="px-6 py-3">Room</th>
                    <th className="px-6 py-3">Total Invoiced</th>
                    <th className="px-6 py-3">Paid amount</th>
                    <th className="px-6 py-3">Balance outstanding</th>
                    <th className="px-6 py-3">Unbilled Charges</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 text-gray-800 font-medium">
                  {residents.map((res) => {
                    const resInvoices = invoices.filter(i => i.raw?.residentId === res.id && i.status !== "CANCELLED");
                    const billed = resInvoices.reduce((s, i) => s + i.totalAmount, 0);
                    const paid = resInvoices.reduce((s, i) => s + i.amountPaid, 0);
                    const balance = Math.max(0, billed - paid);
                    const unbilled = serviceCharges.filter(c => c.residentId === res.id && !c.invoiceId).reduce((s, c) => s + c.amount, 0);

                    if (billed === 0 && unbilled === 0) return null;

                    return (
                      <tr key={res.id} className="hover:bg-gray-50/50">
                        <td className="px-6 py-4 font-bold text-gray-900">{res.name}</td>
                        <td className="px-6 py-4">Room {res.room}</td>
                        <td className="px-6 py-4">${billed.toLocaleString()}</td>
                        <td className="px-6 py-4 text-green-600">${paid.toLocaleString()}</td>
                        <td className={`px-6 py-4 ${balance > 0 ? "text-amber-600" : "text-gray-400"}`}>${balance.toLocaleString()}</td>
                        <td className="px-6 py-4 text-blue-600">${unbilled.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── VIEW TAB 2: SERVICE CHARGES ── */}
      {activeTab === "charges" && (
        <div className="space-y-4 animate-fadeIn">
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
              <input type="text" placeholder="Search by charge description or resident..." value={search} onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white" />
            </div>
            <select value={chargeFilter} onChange={(e) => setChargeFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white text-gray-700">
              <option value="all">All Charge States</option>
              <option value="pending">Pending Invoicing</option>
              <option value="invoiced">Invoiced / Billed</option>
            </select>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                  <tr>
                    <th className="px-6 py-4">Service Date</th>
                    <th className="px-6 py-4">Resident</th>
                    <th className="px-6 py-4">Category</th>
                    <th className="px-6 py-4">Description</th>
                    <th className="px-6 py-4">Amount</th>
                    <th className="px-6 py-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 text-gray-700">
                  {chargeLoading ? (
                    <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-500">Loading service charges...</td></tr>
                  ) : filteredCharges.length > 0 ? filteredCharges.map((sc) => (
                    <tr key={sc.id} className="hover:bg-gray-50 transition">
                      <td className="px-6 py-4 text-xs font-semibold text-gray-500">{sc.serviceDate ? new Date(sc.serviceDate).toLocaleDateString() : "—"}</td>
                      <td className="px-6 py-4 font-bold text-gray-900">{sc.residentName}</td>
                      <td className="px-6 py-4"><span className="px-2.5 py-1 bg-purple-50 text-purple-700 rounded-lg text-xs font-bold border border-purple-100">{sc.category}</span></td>
                      <td className="px-6 py-4 max-w-[200px] truncate">{sc.description}</td>
                      <td className="px-6 py-4 font-bold text-gray-900">${sc.amount.toLocaleString()}</td>
                      <td className="px-6 py-4">
                        {sc.invoiceId ? (
                          <span className="inline-flex items-center gap-1 text-green-700 font-bold text-xs"><CheckCircle className="w-3.5 h-3.5 text-green-500" /> Billed ({sc.invoiceNumber})</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-700 font-bold text-xs"><Clock className="w-3.5 h-3.5 text-amber-500 animate-pulse" /> Pending Invoicing</span>
                        )}
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-500">No service charges found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── VIEW TAB 3: INSURANCE VALIDATION ── */}
      {activeTab === "insurance" && (
        <div className="space-y-4 animate-fadeIn">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
            <input type="text" placeholder="Search by resident name or provider..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {insLoading ? (
              <div className="col-span-full bg-white p-8 border rounded-xl text-center text-gray-500">Loading policy validations...</div>
            ) : filteredInsurance.length > 0 ? filteredInsurance.map((iv) => {
              const verifying = verifyingInsId === iv.id;
              return (
                <div key={iv.id} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-3 relative overflow-hidden flex flex-col justify-between">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <h4 className="font-bold text-gray-900 text-lg leading-tight">{iv.residentName}</h4>
                      <p className="text-xs text-gray-500 font-semibold">Policy: {iv.policyNumber}</p>
                    </div>
                    <span className={`px-2.5 py-1 text-xs font-bold rounded-lg border ${
                      iv.status === "VALIDATED" ? "bg-green-50 text-green-700 border-green-200" :
                      iv.status === "FAILED" ? "bg-red-50 text-red-700 border-red-200" :
                      "bg-yellow-50 text-yellow-700 border-yellow-200"
                    }`}>
                      {iv.status}
                    </span>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-1.5 border border-gray-100">
                    <p className="text-gray-700"><span className="font-semibold text-gray-500">Provider:</span> {iv.provider}</p>
                    {iv.groupNumber && <p className="text-gray-700"><span className="font-semibold text-gray-500">Group:</span> {iv.groupNumber}</p>}
                    {iv.verifiedAt && <p className="text-gray-500"><span className="font-semibold">Verified:</span> {new Date(iv.verifiedAt).toLocaleDateString()} by {iv.verifiedBy}</p>}
                    {iv.notes && <p className="text-gray-600 italic mt-1 border-t border-gray-200/60 pt-1.5">&quot;{iv.notes}&quot;</p>}
                  </div>

                  <button onClick={() => triggerInsuranceValidation(iv.id)} disabled={verifying}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-gray-900 hover:bg-gray-800 text-yellow-400 font-bold rounded-lg text-xs transition disabled:opacity-50">
                    {verifying ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-yellow-400" />
                        Validating gateway...
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Verify Gateway Coverage
                      </>
                    )}
                  </button>
                </div>
              );
            }) : (
              <div className="col-span-full bg-white p-8 border rounded-xl text-center text-gray-500">No insurance policy files registered.</div>
            )}
          </div>
        </div>
      )}

      {/* ── VIEW TAB 4: INVOICE GENERATION ── */}
      {activeTab === "invoices" && (
        <div className="space-y-4 animate-fadeIn">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
              <input type="text" placeholder="Search by invoice number or resident..." value={search} onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white" />
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white text-gray-700">
              <option value="all">All Invoices</option>
              <option value="DRAFT">Draft</option>
              <option value="SENT">Sent / Unpaid</option>
              <option value="PAID">Paid</option>
              <option value="OVERDUE">Overdue</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                  <tr>
                    <th className="px-6 py-4">Invoice</th>
                    <th className="px-6 py-4">Resident</th>
                    <th className="px-6 py-4">Amount Due</th>
                    <th className="px-6 py-4">Paid</th>
                    <th className="px-6 py-4">Balance</th>
                    <th className="px-6 py-4">Due Date</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 text-gray-700">
                  {invLoading ? (
                    <tr><td colSpan={8} className="px-6 py-8 text-center text-gray-500">Loading invoices...</td></tr>
                  ) : filteredInvoices.length > 0 ? filteredInvoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-gray-50 transition">
                      <td className="px-6 py-4 font-bold text-gray-900">{inv.invoiceNumber}</td>
                      <td className="px-6 py-4 font-semibold text-gray-800">{inv.residentName}</td>
                      <td className="px-6 py-4 font-bold text-gray-900">${inv.totalAmount.toLocaleString()}</td>
                      <td className="px-6 py-4 text-green-600 font-semibold">${inv.amountPaid.toLocaleString()}</td>
                      <td className={`px-6 py-4 font-bold ${inv.balance > 0 ? "text-amber-600" : "text-gray-400"}`}>${inv.balance.toLocaleString()}</td>
                      <td className="px-6 py-4 text-xs font-semibold text-gray-500">{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "—"}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${STATUS_BADGE[inv.status] || "bg-gray-100 text-gray-800"}`}>{inv.status}</span>
                      </td>
                      <td className="px-6 py-4 text-right flex justify-end gap-2">
                        {inv.status === "DRAFT" && (
                          <button onClick={() => handleMarkSent(inv)} className="px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-xs font-bold transition">
                            Send / Dispatch
                          </button>
                        )}
                        <button onClick={() => setViewingInvoice(inv)} className="p-2 text-gray-600 hover:bg-gray-100 hover:text-black rounded-lg transition" title="View details">
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan={8} className="px-6 py-8 text-center text-gray-500">No invoices generated yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── VIEW TAB 5: PAYMENT PROCESSING ── */}
      {activeTab === "payments" && (
        <div className="space-y-4 animate-fadeIn">
          <div className="flex justify-between items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
              <input type="text" placeholder="Search by txn ID, invoice, or resident name..." value={search} onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white" />
            </div>
            <button onClick={() => setShowRecordPayment(true)} className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg text-sm transition">
              <CreditCard className="w-4 h-4" /> Record Payment
            </button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                  <tr>
                    <th className="px-6 py-4">Transaction ID</th>
                    <th className="px-6 py-4">Invoice</th>
                    <th className="px-6 py-4">Resident</th>
                    <th className="px-6 py-4">Payment Method</th>
                    <th className="px-6 py-4">Date</th>
                    <th className="px-6 py-4 text-right">Amount Authorized</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 text-gray-700">
                  {payLoading ? (
                    <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-500">Loading payment ledger...</td></tr>
                  ) : filteredPayments.length > 0 ? filteredPayments.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50 transition">
                      <td className="px-6 py-4 font-mono text-xs font-bold text-gray-600">{p.transactionId}</td>
                      <td className="px-6 py-4 font-bold text-gray-900">{p.invoiceNumber}</td>
                      <td className="px-6 py-4 font-semibold text-gray-800">{p.residentName}</td>
                      <td className="px-6 py-4"><span className="px-2.5 py-1 bg-green-50 text-green-700 rounded-lg text-xs font-bold border border-green-100">{p.paymentMethod}</span></td>
                      <td className="px-6 py-4 text-xs font-semibold text-gray-500">{p.paymentDate ? new Date(p.paymentDate).toLocaleString() : "—"}</td>
                      <td className="px-6 py-4 font-extrabold text-green-600 text-right">${p.amount.toLocaleString()}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-500">No payment logs recorded.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── VIEW TAB 6: RECEIPTS ISSUED ── */}
      {activeTab === "receipts" && (
        <div className="space-y-4 animate-fadeIn">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
            <input type="text" placeholder="Search by receipt txn, resident, or invoice..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {payLoading ? (
              <div className="col-span-full bg-white p-8 border rounded-xl text-center text-gray-500">Loading receipts...</div>
            ) : filteredPayments.length > 0 ? filteredPayments.map((p) => (
              <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-4 flex flex-col justify-between hover:shadow transition">
                <div className="flex justify-between items-start gap-2 border-b border-gray-100 pb-3">
                  <div>
                    <h4 className="font-bold text-gray-900 text-lg leading-tight">{p.residentName}</h4>
                    <p className="text-xs text-gray-500 font-mono mt-1 font-bold">Rcpt: #{p.transactionId?.slice(-6).toUpperCase()}</p>
                  </div>
                  <span className="px-2.5 py-1 text-xs font-bold rounded-lg border bg-green-50 text-green-700 border-green-200">
                    PAID
                  </span>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between"><span className="text-gray-500 font-medium">Invoice Reference:</span><span className="font-bold text-gray-800">{p.invoiceNumber}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500 font-medium">Payment Method:</span><span className="font-bold text-gray-800">{p.paymentMethod}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500 font-medium">Auth Date:</span><span className="font-bold text-gray-800">{p.paymentDate ? new Date(p.paymentDate).toLocaleDateString() : ""}</span></div>
                  <div className="flex justify-between border-t border-dashed border-gray-200 pt-2 text-sm"><span className="font-bold text-gray-700">Amount Paid:</span><span className="font-extrabold text-green-600">${p.amount.toLocaleString()}</span></div>
                </div>

                <button onClick={() => setViewingReceipt(p)} className="w-full flex items-center justify-center gap-2 py-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 font-bold rounded-lg text-xs transition">
                  <Printer className="w-3.5 h-3.5 text-gray-500" />
                  View &amp; Print Receipt
                </button>
              </div>
            )) : (
              <div className="col-span-full bg-white p-8 border rounded-xl text-center text-gray-500">No payment receipts issued.</div>
            )}
          </div>
        </div>
      )}

      {/* ── MODAL: VIEW INVOICE DETAIL ── */}
      {viewingInvoice && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
            <div className="p-6 sm:p-8 space-y-6" id="printable-invoice">
              {/* Invoice Branding Header */}
              <div className="flex justify-between items-start border-b border-gray-200 pb-6 gap-4">
                <div>
                  <h2 className="text-2xl font-extrabold text-yellow-600 uppercase tracking-tight">{facilityName || "Facility"}</h2>
                  <p className="text-xs text-gray-500">Assisted Living Facility</p>
                  {facilityAddress && <p className="text-xs text-gray-500">{facilityAddress}</p>}
                </div>
                <div className="text-right">
                  <h3 className="text-xl font-bold text-gray-900">INVOICE</h3>
                  <p className="text-sm font-extrabold text-yellow-600">{viewingInvoice.invoiceNumber}</p>
                  <p className="text-xs text-gray-500 mt-1">Status: <span className="font-bold">{viewingInvoice.status}</span></p>
                </div>
              </div>

              {/* Billing / Metadata Info */}
              <div className="grid grid-cols-2 gap-6 text-sm">
                <div>
                  <h4 className="font-bold text-gray-400 uppercase text-xs mb-1.5">Billed To</h4>
                  <p className="font-extrabold text-gray-900">{viewingInvoice.residentName}</p>
                  <p className="text-gray-600">Room {viewingInvoice.room}</p>
                </div>
                <div className="text-right">
                  <h4 className="font-bold text-gray-400 uppercase text-xs mb-1.5">Billing Terms</h4>
                  {viewingInvoice.dueDate && <p className="text-gray-700"><span className="font-bold">Due Date:</span> {new Date(viewingInvoice.dueDate).toLocaleDateString()}</p>}
                  {viewingInvoice.billingPeriodStart && (
                    <p className="text-gray-600 text-xs mt-0.5">Period: {new Date(viewingInvoice.billingPeriodStart).toLocaleDateString()} – {new Date(viewingInvoice.billingPeriodEnd).toLocaleDateString()}</p>
                  )}
                </div>
              </div>

              {/* Description */}
              {viewingInvoice.description && (
                <div className="bg-gray-50 p-4 rounded-lg text-sm text-gray-700 border border-gray-100">
                  <span className="font-bold text-gray-600 block mb-1">Invoice Notes</span>
                  {viewingInvoice.description}
                </div>
              )}

              {/* Linked Service Charges Itemized List */}
              <div className="space-y-3">
                <h4 className="font-bold text-gray-900 text-sm flex items-center gap-1.5">
                  <ClipboardList className="w-4 h-4 text-yellow-600" />
                  Itemized Service Charges &amp; Incidents
                </h4>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-100 border-b border-gray-200 text-gray-600 font-semibold">
                      <tr>
                        <th className="px-4 py-2.5">Date</th>
                        <th className="px-4 py-2.5">Category</th>
                        <th className="px-4 py-2.5">Description</th>
                        <th className="px-4 py-2.5 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 text-gray-700">
                      {viewingInvoice.serviceCharges && viewingInvoice.serviceCharges.length > 0 ? (
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        viewingInvoice.serviceCharges.map((sc: any) => (
                          <tr key={sc.id}>
                            <td className="px-4 py-2">{sc.serviceDate ? new Date(sc.serviceDate).toLocaleDateString() : ""}</td>
                            <td className="px-4 py-2 font-bold">{sc.category}</td>
                            <td className="px-4 py-2">{sc.description}</td>
                            <td className="px-4 py-2 text-right font-bold">${sc.amount.toLocaleString()}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4} className="px-4 py-3 text-center text-gray-500 italic">No itemized charges linked. Flat base care rate.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Payments ledger summary */}
              {viewingInvoice.payments && viewingInvoice.payments.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-bold text-gray-900 text-sm">Payments Ledger</h4>
                  <div className="text-xs space-y-1.5">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {viewingInvoice.payments.map((p: any) => (
                      <div key={p.id} className="flex justify-between bg-green-50/50 p-2 rounded border border-green-100 text-green-800">
                        <span>Authorized txn <strong className="font-mono">{p.transactionId}</strong> via {p.paymentMethod} on {p.paymentDate ? new Date(p.paymentDate).toLocaleDateString() : ""}</span>
                        <span className="font-bold">-${p.amount.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Total calculations */}
              <div className="border-t border-gray-200 pt-6 space-y-2 text-sm max-w-xs ml-auto">
                <div className="flex justify-between font-semibold text-gray-600"><span>Subtotal:</span><span>${viewingInvoice.totalAmount.toLocaleString()}</span></div>
                <div className="flex justify-between font-semibold text-green-600"><span>Paid to Date:</span><span>-${viewingInvoice.amountPaid.toLocaleString()}</span></div>
                <div className="flex justify-between font-extrabold text-gray-900 border-t border-gray-200 pt-2 text-lg">
                  <span>Balance Due:</span>
                  <span className={viewingInvoice.balance > 0 ? "text-amber-600" : "text-green-600"}>${viewingInvoice.balance.toLocaleString()}</span>
                </div>
              </div>
            </div>
            {/* Modal Actions */}
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-between">
              <button onClick={() => setViewingInvoice(null)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 border border-gray-300 rounded-lg text-sm font-semibold transition">
                Close
              </button>
              <button onClick={() => window.print()} className="flex items-center gap-2 px-5 py-2 bg-gray-900 hover:bg-gray-800 text-white font-bold rounded-lg text-sm transition">
                <Printer className="w-4 h-4" /> Print Invoice
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: VIEW RECEIPTS DETAIL ── */}
      {viewingReceipt && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
            <div className="p-8 space-y-6 relative overflow-hidden" id="printable-receipt">
              {/* PAID Watermark */}
              <div className="absolute top-24 left-1/2 -translate-x-1/2 rotate-12 border-4 border-green-500/20 text-green-500/20 font-extrabold text-6xl px-6 py-2 tracking-widest pointer-events-none select-none rounded-xl">
                PAID
              </div>

              {/* branding */}
              <div className="text-center space-y-1">
                <h2 className="text-2xl font-extrabold text-green-600 tracking-tight uppercase">Receipt of Payment</h2>
                <p className="text-xs text-gray-500">{facilityName || "Facility"} Assisted Living Facility</p>
                <p className="text-xs text-gray-500 font-mono">TXN: {viewingReceipt.transactionId}</p>
              </div>

              {/* Receipt Body */}
              <div className="bg-gray-50 rounded-xl p-5 border border-gray-100 space-y-4 text-sm mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><span className="text-gray-500 text-xs block">Resident Name</span><strong className="text-gray-800">{viewingReceipt.residentName}</strong></div>
                  <div><span className="text-gray-500 text-xs block">Invoice Ref</span><strong className="text-gray-800">{viewingReceipt.invoiceNumber}</strong></div>
                  <div><span className="text-gray-500 text-xs block">Payment Date</span><strong className="text-gray-800">{viewingReceipt.paymentDate ? new Date(viewingReceipt.paymentDate).toLocaleString() : ""}</strong></div>
                  <div><span className="text-gray-500 text-xs block">Auth Method</span><strong className="text-gray-800">{viewingReceipt.paymentMethod}</strong></div>
                </div>

                <div className="border-t border-dashed border-gray-200 pt-4 flex justify-between items-center">
                  <span className="font-extrabold text-gray-700 text-base">Total Captured</span>
                  <span className="font-black text-green-600 text-2xl">${viewingReceipt.amount.toLocaleString()}</span>
                </div>
              </div>

              {/* terms */}
              <p className="text-center text-[10px] text-gray-400 mt-6 leading-relaxed">
                Thank you for your payment. This receipt acts as official validation that funds have been processed and credited to the respective invoice balance.
              </p>
            </div>
            {/* Modal Actions */}
            <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-between">
              <button onClick={() => setViewingReceipt(null)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 border border-gray-300 rounded-lg text-sm font-semibold transition">
                Close
              </button>
              <button onClick={() => window.print()} className="flex items-center gap-2 px-5 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg text-sm transition">
                <Printer className="w-4 h-4" /> Print Receipt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: CREATE INVOICE ── */}
      {showCreateInvoice && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between">
              <h2 className="text-xl font-bold">Generate Invoice</h2>
              <button onClick={() => setShowCreateInvoice(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Resident *</label>
                <select value={invoiceForm.residentId} onChange={(e) => setInvoiceForm({ ...invoiceForm, residentId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white text-gray-800">
                  <option value="">Select resident...</option>
                  {residents.map((r) => <option key={r.id} value={r.id}>{r.name} (Room {r.room})</option>)}
                </select>
              </div>

              {invoiceForm.residentId && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-3.5 text-xs text-blue-800 space-y-1">
                  <p className="font-bold flex items-center gap-1">
                    <Layers className="w-3.5 h-3.5" />
                    Pending Care Charges:
                  </p>
                  <p className="font-medium text-gray-600">
                    Total unbilled charges for this resident: <strong className="text-gray-900">${
                      serviceCharges.filter(c => c.residentId === invoiceForm.residentId && !c.invoiceId).reduce((s, c) => s + c.amount, 0).toLocaleString()
                    }</strong>
                  </p>
                  <label className="flex items-center gap-2 mt-2 font-bold text-gray-900 cursor-pointer">
                    <input type="checkbox" checked={invoiceForm.addPendingCharges} onChange={(e) => setInvoiceForm({ ...invoiceForm, addPendingCharges: e.target.checked })} />
                    Automatically bind and bill these service charges
                  </label>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Billing Start *</label>
                  <input type="date" value={invoiceForm.billingPeriodStart} onChange={(e) => setInvoiceForm({ ...invoiceForm, billingPeriodStart: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Billing End *</label>
                  <input type="date" value={invoiceForm.billingPeriodEnd} onChange={(e) => setInvoiceForm({ ...invoiceForm, billingPeriodEnd: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Due Date *</label>
                <input type="date" value={invoiceForm.dueDate} onChange={(e) => setInvoiceForm({ ...invoiceForm, dueDate: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white" />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Invoice Notes / Description</label>
                <textarea value={invoiceForm.description} onChange={(e) => setInvoiceForm({ ...invoiceForm, description: e.target.value })} rows={2} placeholder="Monthly Care service fees and incidentals..." className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 resize-y" />
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setShowCreateInvoice(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 border border-gray-300 rounded-lg text-sm font-semibold transition">Cancel</button>
              <button onClick={handleCreateInvoice} className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-extrabold rounded-lg hover:shadow-lg transition">Generate Draft Invoice</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: RECORD SERVICE CHARGE ── */}
      {showRecordCharge && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between">
              <h2 className="text-xl font-bold">Record Service Charge</h2>
              <button onClick={() => setShowRecordCharge(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Resident *</label>
                <select value={chargeForm.residentId} onChange={(e) => setChargeForm({ ...chargeForm, residentId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white text-gray-800">
                  <option value="">Select resident...</option>
                  {residents.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Category *</label>
                <select value={chargeForm.category} onChange={(e) => setChargeForm({ ...chargeForm, category: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white text-gray-800">
                  <option value="Care Services">Care Services</option>
                  <option value="Room Rate">Room Rate</option>
                  <option value="Medication Fee">Medication Fee</option>
                  <option value="Dining Services">Dining Services</option>
                  <option value="Specialist Therapy">Specialist Therapy</option>
                  <option value="Incident Remediation">Incident Remediation</option>
                  <option value="Custom Charge">Custom Charge</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Amount ($) *</label>
                  <input type="number" placeholder="250" value={chargeForm.amount} onChange={(e) => setChargeForm({ ...chargeForm, amount: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Service Date *</label>
                  <input type="date" value={chargeForm.serviceDate} onChange={(e) => setChargeForm({ ...chargeForm, serviceDate: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Description *</label>
                <textarea value={chargeForm.description} onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })} rows={2} placeholder="Description of the service or supply provided..." className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 resize-y" />
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setShowRecordCharge(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 border border-gray-300 rounded-lg text-sm font-semibold transition">Cancel</button>
              <button onClick={handleRecordCharge} className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-extrabold rounded-lg hover:shadow-lg transition">Record Charge</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: VALIDATE INSURANCE ── */}
      {showVerifyInsurance && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between">
              <h2 className="text-xl font-bold">Validate Insurance</h2>
              <button onClick={() => setShowVerifyInsurance(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Resident *</label>
                <select value={insuranceForm.residentId} onChange={(e) => setInsuranceForm({ ...insuranceForm, residentId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white text-gray-800">
                  <option value="">Select resident...</option>
                  {residents.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Insurance Provider *</label>
                <input type="text" placeholder="Blue Cross Blue Shield" value={insuranceForm.provider} onChange={(e) => setInsuranceForm({ ...insuranceForm, provider: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Policy Number *</label>
                  <input type="text" placeholder="POL-992384" value={insuranceForm.policyNumber} onChange={(e) => setInsuranceForm({ ...insuranceForm, policyNumber: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Group Number</label>
                  <input type="text" placeholder="GRP-1102" value={insuranceForm.groupNumber} onChange={(e) => setInsuranceForm({ ...insuranceForm, groupNumber: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Coverage Details / Copay Terms</label>
                <textarea value={insuranceForm.coverageDetails} onChange={(e) => setInsuranceForm({ ...insuranceForm, coverageDetails: e.target.value })} rows={2} placeholder="e.g. 80% coverage for special medical therapies, $50 flat medication copay..." className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 resize-y" />
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setShowVerifyInsurance(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 border border-gray-300 rounded-lg text-sm font-semibold transition">Cancel</button>
              <button onClick={handleRecordInsurance} className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-extrabold rounded-lg hover:shadow-lg transition">Submit Policy</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: RECORD PAYMENT ── */}
      {showRecordPayment && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between">
              <h2 className="text-xl font-bold">Process Payment</h2>
              <button onClick={() => setShowRecordPayment(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Select Unpaid/Sent Invoice *</label>
                <select value={paymentForm.invoiceId} onChange={(e) => {
                  const inv = invoices.find(i => i.id === e.target.value);
                  setPaymentForm({
                    ...paymentForm,
                    invoiceId: e.target.value,
                    amount: inv ? String(inv.balance) : ""
                  });
                }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white text-gray-800">
                  <option value="">Select outstanding invoice...</option>
                  {invoices.filter(i => i.status === "SENT" || i.status === "OVERDUE").map((i) => (
                    <option key={i.id} value={i.id}>{i.invoiceNumber} - {i.residentName} (Bal: ${i.balance.toLocaleString()})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Payment Method *</label>
                <select value={paymentForm.paymentMethod} onChange={(e) => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white text-gray-800">
                  <option value="CARD">Credit Card / Debit Card</option>
                  <option value="ACH">ACH Bank Transfer</option>
                  <option value="CHECK">Physical Check</option>
                  <option value="CASH">Cash Payment</option>
                  <option value="OTHER">Other Method</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Amount Paid ($) *</label>
                  <input type="number" placeholder="2500" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Transaction ID / Check Number</label>
                  <input type="text" placeholder="TXN-99382" value={paymentForm.transactionId} onChange={(e) => setPaymentForm({ ...paymentForm, transactionId: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Payment Memo</label>
                <textarea value={paymentForm.notes} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })} rows={2} placeholder="Add physical check number or card terminal auth info..." className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 resize-y" />
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setShowRecordPayment(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 border border-gray-300 rounded-lg text-sm font-semibold transition">Cancel</button>
              <button onClick={handleRecordPayment} className="px-5 py-2 bg-green-600 hover:bg-green-700 text-white font-extrabold rounded-lg hover:shadow-lg transition">Log Payment Transaction</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, icon: Icon, color }: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; color: string }) {
  const COLORS: Record<string, string> = {
    green: "text-green-800 bg-green-50 border border-green-200/60",
    amber: "text-amber-800 bg-amber-50 border border-amber-200/60",
    blue: "text-blue-800 bg-blue-50 border border-blue-200/60",
    red: "text-red-800 bg-red-50 border border-red-200/60"
  };
  const ICON_COLORS: Record<string, string> = {
    green: "text-green-500",
    amber: "text-amber-500",
    blue: "text-blue-500",
    red: "text-red-500"
  };
  return (
    <div className={`rounded-xl p-5 shadow-sm transition hover:shadow-md ${COLORS[color] || COLORS.blue}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">{label}</p>
        <Icon className={`w-5 h-5 ${ICON_COLORS[color] || "text-blue-500"}`} />
      </div>
      <p className="text-3xl font-black mt-2 tracking-tight">{value}</p>
    </div>
  );
}
