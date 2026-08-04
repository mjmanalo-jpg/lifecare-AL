"use client";

import { useMemo, useState } from "react";
import { X, FileDown, CreditCard, Loader2 } from "lucide-react";
import { jsPDF } from "jspdf";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import { BILLING_SETTINGS_KEY, parseBillingSettings } from "@/lib/billingLibrary";

type Row = Record<string, unknown>;
const peso = (n: number) => `₱${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const s = (v: unknown) => (v == null ? "" : String(v));
const d = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString() : "—");

/** Resident account statement — charges, invoices, payments, running balance;
 *  printable PDF; and auto-pay enrollment. */
export default function ResidentStatement({ residentId, residentName, facilityName, onClose }: { residentId: string; residentName: string; facilityName?: string; onClose: () => void }) {
  const { data: charges } = useLiveQuery<Row>("service-charges", { query: `f_residentId=${residentId}&take=500`, tables: ["ServiceCharge"] });
  const { data: invoices } = useLiveQuery<Row>("invoices", { query: `f_residentId=${residentId}&take=500`, tables: ["Invoice"] });
  const invoiceIds = useMemo(() => new Set(invoices.map((i) => String(i.id))), [invoices]);
  const { data: allPayments } = useLiveQuery<Row>("payments", { query: "take=1000", tables: ["Payment"] });
  const payments = useMemo(() => allPayments.filter((p) => invoiceIds.has(String(p.invoiceId))), [allPayments, invoiceIds]);
  const { data: settingRows, refetch } = useLiveQuery<{ id: string; key?: string; value: string }>("app-settings", { tables: ["AppSetting"] });

  const settings = useMemo(() => parseBillingSettings(settingRows.find((r) => (r.key || r.id) === BILLING_SETTINGS_KEY)?.value), [settingRows]);
  const enrolled = settings.autopayResidentIds.includes(residentId);
  const [busy, setBusy] = useState(false);

  const totals = useMemo(() => {
    const invoiced = invoices.reduce((a, i) => a + Number(i.totalAmount ?? 0), 0);
    const paid = payments.reduce((a, p) => a + Number(p.amount ?? 0), 0);
    const uninvoiced = charges.filter((c) => !c.invoiceId).reduce((a, c) => a + Number(c.amount ?? 0), 0);
    return { invoiced, paid, uninvoiced, balance: invoiced - paid + uninvoiced };
  }, [invoices, payments, charges]);

  const toggleAutopay = async () => {
    setBusy(true);
    try {
      const ids = enrolled ? settings.autopayResidentIds.filter((x) => x !== residentId) : [...settings.autopayResidentIds, residentId];
      await upsertRecord("app-settings", BILLING_SETTINGS_KEY, { key: BILLING_SETTINGS_KEY, value: JSON.stringify({ ...settings, autopayResidentIds: ids }) });
      await refetch();
      Swal.fire({ title: enrolled ? "Auto-pay disabled" : "Auto-pay enrolled", text: settings.onlinePaymentsEnabled ? undefined : "Charges will auto-pay once online payments are enabled.", icon: "success", timer: 1600, showConfirmButton: false });
    } catch (e) {
      Swal.fire({ title: "Failed", text: e instanceof Error ? e.message : "Try again", icon: "error" });
    } finally { setBusy(false); }
  };

  const downloadPdf = () => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const M = 40; let y = 50;
    const line = (t: string, size = 10, bold = false, color = 60) => { doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(size).setTextColor(color); doc.text(t, M, y); y += size + 4; };
    doc.setFont("helvetica", "bold").setFontSize(18).text(facilityName || "Facility", M, y); y += 20;
    line("Resident Account Statement", 13, true, 20); y += 4;
    line(`${residentName}`, 12, true, 30);
    line(`Generated ${new Date().toLocaleString()}`, 9, false, 120); y += 8;
    line("Charges", 12, true, 20);
    charges.forEach((c) => line(`• ${d(c.serviceDate)}  ${s(c.description).replace(/\[auto:[^\]]+\]/, "").trim()}  —  ${peso(Number(c.amount))}  [${s(c.category)}]`, 9));
    if (!charges.length) line("— none —", 9, false, 120);
    y += 6; line("Invoices", 12, true, 20);
    invoices.forEach((i) => line(`• ${s(i.invoiceNumber)}  due ${d(i.dueDate)}  —  ${peso(Number(i.totalAmount))}  [${s(i.status)}]`, 9));
    if (!invoices.length) line("— none —", 9, false, 120);
    y += 6; line("Payments", 12, true, 20);
    payments.forEach((p) => line(`• ${d(p.paymentDate)}  ${s(p.paymentMethod)}  —  ${peso(Number(p.amount))}`, 9));
    if (!payments.length) line("— none —", 9, false, 120);
    y += 10;
    line(`Total invoiced: ${peso(totals.invoiced)}`, 11, true, 20);
    line(`Total paid: ${peso(totals.paid)}`, 11, true, 20);
    line(`Uninvoiced charges: ${peso(totals.uninvoiced)}`, 11, false, 60);
    line(`Balance due: ${peso(totals.balance)}`, 13, true, totals.balance > 0 ? 200 : 40);
    doc.save(`statement-${residentName.toLowerCase().replace(/\s+/g, "-")}.pdf`);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-[#2E4A48] text-white px-5 py-4 flex items-center justify-between z-10">
          <div><h2 className="text-lg font-bold">Account Statement</h2><p className="text-white/70 text-sm">{residentName}</p></div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/15 rounded"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Invoiced" value={peso(totals.invoiced)} />
            <Stat label="Paid" value={peso(totals.paid)} tone="green" />
            <Stat label="Uninvoiced" value={peso(totals.uninvoiced)} />
            <Stat label="Balance" value={peso(totals.balance)} tone={totals.balance > 0 ? "red" : "green"} />
          </div>

          <StatementSection title={`Charges (${charges.length})`}>
            {charges.map((c) => (
              <Line key={s(c.id)} left={`${d(c.serviceDate)} · ${s(c.description).replace(/\[auto:[^\]]+\]/, "").trim()}`} right={peso(Number(c.amount))} tag={s(c.category)} muted={!!c.invoiceId} />
            ))}
          </StatementSection>
          <StatementSection title={`Invoices (${invoices.length})`}>
            {invoices.map((i) => <Line key={s(i.id)} left={`${s(i.invoiceNumber)} · due ${d(i.dueDate)}`} right={peso(Number(i.totalAmount))} tag={s(i.status)} />)}
          </StatementSection>
          <StatementSection title={`Payments (${payments.length})`}>
            {payments.map((p) => <Line key={s(p.id)} left={`${d(p.paymentDate)} · ${s(p.paymentMethod)}`} right={peso(Number(p.amount))} />)}
          </StatementSection>

          <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-4">
            <button onClick={downloadPdf} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#2E4A48] text-white text-sm font-semibold hover:bg-[#25403D]"><FileDown className="w-4 h-4" /> Download statement PDF</button>
            <button onClick={() => void toggleAutopay()} disabled={busy} className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border disabled:opacity-60 ${enrolled ? "border-rose-300 text-rose-600 hover:bg-rose-50" : "border-emerald-300 text-emerald-700 hover:bg-emerald-50"}`}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />} {enrolled ? "Disable auto-pay" : "Enroll in auto-pay"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  return <div className="rounded-lg border border-gray-200 p-3"><p className="text-xs text-gray-500">{label}</p><p className={`text-lg font-bold ${tone === "green" ? "text-green-600" : tone === "red" ? "text-red-600" : "text-gray-900"}`}>{value}</p></div>;
}
function StatementSection({ title, children }: { title: string; children: React.ReactNode }) {
  const arr = Array.isArray(children) ? children : [children];
  return <div><h4 className="font-bold text-gray-900 text-sm mb-2">{title}</h4><div className="space-y-1">{arr.length && arr.some(Boolean) ? children : <p className="text-sm text-gray-400">— none —</p>}</div></div>;
}
function Line({ left, right, tag, muted }: { left: string; right: string; tag?: string; muted?: boolean }) {
  return <div className={`flex items-center justify-between gap-2 text-sm rounded px-2 py-1.5 ${muted ? "bg-gray-50 text-gray-500" : "bg-gray-50"}`}><span className="min-w-0 truncate text-gray-800">{left}{tag ? <span className="ml-1.5 text-[11px] text-gray-400">[{tag}]</span> : null}</span><span className="font-semibold text-gray-900 shrink-0">{right}</span></div>;
}
