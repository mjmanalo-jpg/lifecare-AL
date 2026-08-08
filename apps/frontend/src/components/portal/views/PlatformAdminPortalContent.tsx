"use client";

import Link from "next/link";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, Building2, CheckCircle2, CircleDollarSign, CreditCard, Database,
  Gauge, KeyRound, Loader2, Mail, Pencil, Plus, RefreshCw, ServerCog, Shield, ShieldCheck,
  Trash2, Users, X, XCircle,
} from "lucide-react";
import SaasPlatformConsole from "@/components/portal/views/superadmin/SaasPlatformConsole";
import { openGlobalConfirm } from "@/components/ui/global-confirm";

interface PlanMeta { priceMonthly: number | null; currency: string; public: boolean; order: number; tagline: string; highlight: boolean; }
interface PayMethodDetail { type: string; label: string; accountName: string; accountNumber: string; instructions: string; }
interface PaymentDetails { provider: string; businessName: string; methods: PayMethodDetail[]; notes: string; }
const PAY_METHOD_TYPES: [string, string][] = [["BANK_TRANSFER", "Bank Transfer"], ["GCASH", "GCash"], ["MAYA", "Maya"], ["CARD", "Card"], ["OTHER", "Other"]];
const PAY_PROVIDERS: [string, string][] = [["DEMO", "Demo (no live gateway)"], ["MANUAL", "Manual (bank / e-wallet)"], ["PAYMONGO", "PayMongo"], ["STRIPE", "Stripe"]];
interface Plan {
  id: string; key: string; name: string; description?: string | null;
  maxCommunities?: number | null; maxActiveResidents?: number | null;
  maxStaffSeats?: number | null; maxStorageBytes?: string | null;
  entitlements?: { id: string; featureKey: string; enabled: boolean; limit?: number | null }[];
  meta?: PlanMeta;
}
interface Organization {
  id: string; name: string; status: string;
  subscription?: { status: string; plan: Plan } | null;
  _count: { communities: number; residents: number; staff: number };
  memberships?: { id: string; role: string; status: string; user: { id: string; name: string; email: string; isActive: boolean; lastLogin?: string | null } }[];
}
interface Invoice {
  id: string; number: string; status: string; currency: string; total: number;
  periodLabel: string; issuedAt: string; dueDate: string;
  lineItems: { description: string; amount: number }[]; paymentMethod?: string | null;
}
interface Insights {
  deniedLast24Hours: number;
  generatedAt: string;
  invitations: { id: string; email: string; status: string; organizationRole?: string | null; communityRole?: string | null; expiresAt: string; organization: { id: string; name: string }; community?: { id: string; name: string } | null }[];
  platformUsers: { id: string; name: string; email: string; platformRole?: string | null; isActive: boolean; lastLogin?: string | null }[];
  auditEvents: { id: string; actorName: string; actorRole: string; action: string; entityType: string; entityId: string; ipAddress?: string | null; reason?: string | null; createdAt: string }[];
  usageSnapshots: { id: string; organizationId: string; metric: string; value: string; periodEnd: string }[];
  saas: SaasMetrics;
  health: Record<string, string>;
}
interface SaasMetrics {
  currency: string; mrr: number; arr: number; arpa: number; totalSubscriptions: number;
  counts: Record<string, number>; payingCount: number; newTrialsLast30: number; churnedLast30: number; trialConversionPct: number;
  byPlan: { planId: string; name: string; active: number; revenue: number }[];
}

const emptySaas: SaasMetrics = { currency: "PHP", mrr: 0, arr: 0, arpa: 0, totalSubscriptions: 0, counts: {}, payingCount: 0, newTrialsLast30: 0, churnedLast30: 0, trialConversionPct: 0, byPlan: [] };
const emptyInsights: Insights = { deniedLast24Hours: 0, generatedAt: "", invitations: [], platformUsers: [], auditEvents: [], usageSnapshots: [], saas: emptySaas, health: {} };

function Panel({ title, subtitle, icon, children, action }: { title: string; subtitle?: string; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3"><div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600">{icon}</div><div><h2 className="font-bold text-slate-900">{title}</h2>{subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}</div></div>{action}
    </div>
    <div className="mt-4">{children}</div>
  </section>;
}

function Stat({ label, value, icon, tone = "indigo" }: { label: string; value: string | number; icon: ReactNode; tone?: "indigo" | "emerald" | "amber" | "rose" }) {
  const tones = { indigo: "bg-indigo-50 text-indigo-700", emerald: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-700", rose: "bg-rose-50 text-rose-700" };
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className={`inline-flex rounded-lg p-2 ${tones[tone]}`}>{icon}</div><strong className="mt-3 block text-2xl text-slate-900">{value}</strong><span className="text-xs font-medium text-slate-500">{label}</span></div>;
}

function Badge({ value }: { value: string }) {
  const good = ["ACTIVE", "ACCEPTED", "OPERATIONAL", "CONFIGURED"].includes(value);
  const warn = ["TRIALING", "PENDING"].includes(value);
  return <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${good ? "bg-emerald-100 text-emerald-700" : warn ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>{value.replaceAll("_", " ")}</span>;
}

export default function PlatformAdminPortalContent({ tab = "dashboard" }: { tab?: string }) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [insights, setInsights] = useState<Insights>(emptyInsights);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);
  const [payDetails, setPayDetails] = useState<PaymentDetails>({ provider: "MANUAL", businessName: "", methods: [], notes: "" });
  const [savingPay, setSavingPay] = useState(false);

  async function load() {
    setLoading(true); setError("");
    try {
      const [organizationResponse, planResponse, insightResponse] = await Promise.all([
        fetch("/api/platform/organizations", { cache: "no-store" }),
        fetch("/api/platform/plans", { cache: "no-store" }),
        fetch("/api/platform/insights", { cache: "no-store" }),
      ]);
      const checks: [string, Response][] = [["Customer workspaces", organizationResponse], ["Plans and entitlements", planResponse], ["Platform insights", insightResponse]];
      for (const [label, response] of checks) {
        if (!response.ok) {
          const failure = await response.clone().json().catch(() => ({}));
          const message = failure.code === "MFA_REQUIRED" ? "MFA verification is required for this session" : failure.error || `Request failed with status ${response.status}`;
          throw new Error(`${label}: ${message}`);
        }
      }
      setOrganizations((await organizationResponse.json()).organizations || []);
      setPlans((await planResponse.json()).plans || []);
      setInsights(await insightResponse.json());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load platform data"); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch("/api/platform/organizations", { cache: "no-store" }),
      fetch("/api/platform/plans", { cache: "no-store" }),
      fetch("/api/platform/insights", { cache: "no-store" }),
    ]).then(async ([organizationResponse, planResponse, insightResponse]) => {
      if (cancelled) return;
      const checks: [string, Response][] = [["Customer workspaces", organizationResponse], ["Plans and entitlements", planResponse], ["Platform insights", insightResponse]];
      for (const [label, response] of checks) {
        if (!response.ok) {
          const failure = await response.clone().json().catch(() => ({}));
          const message = failure.code === "MFA_REQUIRED" ? "MFA verification is required for this session" : failure.error || `Request failed with status ${response.status}`;
          throw new Error(`${label}: ${message}`);
        }
      }
      setOrganizations((await organizationResponse.json()).organizations || []);
      setPlans((await planResponse.json()).plans || []);
      setInsights(await insightResponse.json());
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load platform data");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const totals = useMemo(() => organizations.reduce((sum, organization) => ({ communities: sum.communities + organization._count.communities, residents: sum.residents + organization._count.residents, staff: sum.staff + organization._count.staff }), { communities: 0, residents: 0, staff: 0 }), [organizations]);
  const pendingInvitations = insights.invitations.filter((invitation) => invitation.status === "PENDING").length;
  const limitWarnings = organizations.filter((organization) => {
    const plan = organization.subscription?.plan;
    return Boolean((plan?.maxCommunities && organization._count.communities >= plan.maxCommunities) || (plan?.maxActiveResidents && organization._count.residents >= plan.maxActiveResidents) || (plan?.maxStaffSeats && organization._count.staff >= plan.maxStaffSeats));
  }).length;

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setCreatingPlan(true); setError("");
    const form = event.currentTarget; const data = new FormData(form);
    const numberOrNull = (name: string) => data.get(name) ? Number(data.get(name)) : null;
    const response = await fetch("/api/platform/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: data.get("key"), name: data.get("name"), description: data.get("description"), maxCommunities: numberOrNull("maxCommunities"), maxActiveResidents: numberOrNull("maxActiveResidents"), maxStaffSeats: numberOrNull("maxStaffSeats"), priceMonthly: numberOrNull("priceMonthly"), currency: data.get("currency") || "PHP", tagline: data.get("tagline") || "", public: data.get("public") === "on" }) });
    if (response.ok) { form.reset(); await load(); } else setError((await response.json()).error || "Plan creation failed");
    setCreatingPlan(false);
  }
  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editingPlan) return; setSavingPlan(true); setError("");
    const form = event.currentTarget; const data = new FormData(form);
    const numberOrNull = (name: string) => data.get(name) ? Number(data.get(name)) : null;
    const response = await fetch(`/api/platform/plans/${editingPlan.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: data.get("name"), description: data.get("description"), maxCommunities: numberOrNull("maxCommunities"), maxActiveResidents: numberOrNull("maxActiveResidents"), maxStaffSeats: numberOrNull("maxStaffSeats"), priceMonthly: numberOrNull("priceMonthly"), currency: data.get("currency") || "PHP", tagline: data.get("tagline") || "", order: numberOrNull("order") ?? 100, public: data.get("public") === "on", highlight: data.get("highlight") === "on" }) });
    if (response.ok) { setEditingPlan(null); await load(); } else setError((await response.json()).error || "Plan update failed");
    setSavingPlan(false);
  }
  async function deletePlan(plan: Plan) {
    if (!window.confirm(`Delete the "${plan.name}" plan? This cannot be undone.`)) return;
    setError("");
    const response = await fetch(`/api/platform/plans/${plan.id}`, { method: "DELETE" });
    if (response.ok) await load(); else setError((await response.json()).error || "Plan deletion failed");
  }
  const priceText = (plan: Plan) => (plan.meta && plan.meta.priceMonthly !== null ? `${plan.meta.currency} ${plan.meta.priceMonthly.toLocaleString()}/mo` : "No price set");
  async function setOrgStatus(organization: Organization, status: "ACTIVE" | "SUSPENDED") {
    if (status === "SUSPENDED" && !window.confirm(`Suspend "${organization.name}"? Their users lose access until reactivated.`)) return;
    setError("");
    const response = await fetch(`/api/platform/organizations/${organization.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (response.ok) await load(); else setError((await response.json().catch(() => ({}))).error || "Status change failed");
  }

  // ── Platform-issued invoices ──
  const [invoiceOrg, setInvoiceOrg] = useState<Organization | null>(null);
  const [orgInvoices, setOrgInvoices] = useState<Invoice[]>([]);
  const [invLines, setInvLines] = useState<{ description: string; amount: string }[]>([{ description: "", amount: "" }]);
  const [invAdvances, setInvAdvances] = useState(true);
  const [invNotes, setInvNotes] = useState("");
  const [invBusy, setInvBusy] = useState(false);
  async function openInvoices(organization: Organization) {
    setInvoiceOrg(organization); setOrgInvoices([]); setInvLines([{ description: "", amount: "" }]); setInvAdvances(true); setInvNotes(""); setError("");
    const response = await fetch(`/api/platform/organizations/${organization.id}/invoices`, { cache: "no-store" });
    if (response.ok) setOrgInvoices((await response.json()).invoices || []);
  }
  async function refreshInvoices() { if (!invoiceOrg) return; const response = await fetch(`/api/platform/organizations/${invoiceOrg.id}/invoices`, { cache: "no-store" }); if (response.ok) setOrgInvoices((await response.json()).invoices || []); }
  async function issueInvoice() {
    if (!invoiceOrg) return;
    const lineItems = invLines.map((line) => ({ description: line.description.trim(), amount: Number(line.amount) })).filter((line) => line.description && line.amount > 0);
    if (!lineItems.length) { setError("Add at least one line item with a description and a positive amount"); return; }
    const total = lineItems.reduce((sum, line) => sum + line.amount, 0);
    const currency = invoiceOrg.subscription?.plan?.meta?.currency || "PHP";
    let totalText = `${currency} ${total.toLocaleString()}`;
    try { totalText = new Intl.NumberFormat("en-PH", { style: "currency", currency, maximumFractionDigits: 0 }).format(total); } catch { /* keep fallback */ }
    const { confirmed } = await openGlobalConfirm({
      title: "Issue this invoice?",
      description: `${invoiceOrg.name} will be billed ${lineItems.length} line item(s) totaling ${totalText}. The invoice is issued immediately and appears on the customer&rsquo;s billing page.`,
      confirmText: "Issue invoice",
      variant: "warning",
    });
    if (!confirmed) return;
    setInvBusy(true); setError("");
    const response = await fetch(`/api/platform/organizations/${invoiceOrg.id}/invoices`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lineItems, advancesPeriod: invAdvances, notes: invNotes }) });
    if (response.ok) { setInvLines([{ description: "", amount: "" }]); setInvNotes(""); await refreshInvoices(); } else setError((await response.json().catch(() => ({}))).error || "Could not issue invoice");
    setInvBusy(false);
  }
  async function invoiceAction(invoiceId: string, action: "markPaid" | "void", method?: string) {
    if (!invoiceOrg) return;
    if (action === "void" && !window.confirm("Void this invoice?")) return;
    setInvBusy(true); setError("");
    const response = await fetch(`/api/platform/organizations/${invoiceOrg.id}/invoices/${invoiceId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, method }) });
    if (response.ok) await refreshInvoices(); else setError((await response.json().catch(() => ({}))).error || "Action failed");
    setInvBusy(false);
  }
  const saas = insights.saas || emptySaas;
  const saasMoney = (amount: number) => { try { return new Intl.NumberFormat("en-PH", { style: "currency", currency: saas.currency, maximumFractionDigits: 0 }).format(amount); } catch { return `${saas.currency} ${amount.toLocaleString()}`; } };

  useEffect(() => { let cancelled = false; void fetch("/api/platform/payment-details", { cache: "no-store" }).then((response) => (response.ok ? response.json() : null)).then((data) => { if (!cancelled && data?.paymentDetails) setPayDetails(data.paymentDetails); }).catch(() => {}); return () => { cancelled = true; }; }, []);
  const updatePay = (field: "provider" | "businessName" | "notes", value: string) => setPayDetails((prev) => ({ ...prev, [field]: value }));
  const addPayMethod = () => setPayDetails((prev) => ({ ...prev, methods: [...prev.methods, { type: "BANK_TRANSFER", label: "", accountName: "", accountNumber: "", instructions: "" }] }));
  const removePayMethod = (index: number) => setPayDetails((prev) => ({ ...prev, methods: prev.methods.filter((_, i) => i !== index) }));
  const updatePayMethod = (index: number, field: keyof PayMethodDetail, value: string) => setPayDetails((prev) => ({ ...prev, methods: prev.methods.map((method, i) => (i === index ? { ...method, [field]: value } : method)) }));
  async function savePaymentDetails() { setSavingPay(true); setError(""); const response = await fetch("/api/platform/payment-details", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payDetails) }); if (response.ok) setPayDetails((await response.json()).paymentDetails); else setError((await response.json()).error || "Failed to save payment details"); setSavingPay(false); }

  const overview = <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Customer organizations" value={organizations.length} icon={<Building2 className="h-5 w-5"/>}/><Stat label="Active communities" value={totals.communities} icon={<Activity className="h-5 w-5"/>} tone="emerald"/><Stat label="Pending invitations" value={pendingInvitations} icon={<Mail className="h-5 w-5"/>} tone="amber"/><Stat label="Capacity warnings" value={limitWarnings} icon={<AlertTriangle className="h-5 w-5"/>} tone={limitWarnings ? "rose" : "emerald"}/></div>
    <Panel title="Subscription revenue" subtitle="Monthly recurring revenue and lifecycle, computed live from customer subscriptions and plan pricing." icon={<CircleDollarSign className="h-5 w-5"/>}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Monthly recurring revenue" value={saasMoney(saas.mrr)} icon={<CircleDollarSign className="h-5 w-5"/>} tone="emerald"/>
        <Stat label="Annual run-rate" value={saasMoney(saas.arr)} icon={<Activity className="h-5 w-5"/>}/>
        <Stat label="Paying customers" value={saas.payingCount} icon={<Building2 className="h-5 w-5"/>}/>
        <Stat label="Avg revenue / customer" value={saasMoney(saas.arpa)} icon={<Gauge className="h-5 w-5"/>}/>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Trialing" value={saas.counts.TRIALING || 0} icon={<Mail className="h-5 w-5"/>} tone="amber"/>
        <Stat label="Past due (grace)" value={saas.counts.PAST_DUE || 0} icon={<AlertTriangle className="h-5 w-5"/>} tone={saas.counts.PAST_DUE ? "rose" : "emerald"}/>
        <Stat label="Trial → paid" value={`${saas.trialConversionPct}%`} icon={<CheckCircle2 className="h-5 w-5"/>}/>
        <Stat label="Churned (30d)" value={saas.churnedLast30} icon={<XCircle className="h-5 w-5"/>} tone={saas.churnedLast30 ? "rose" : "emerald"}/>
      </div>
      {saas.byPlan.length > 0 && <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[420px] text-left text-sm"><thead className="border-b text-xs uppercase text-slate-500"><tr><th className="p-2">Plan</th><th className="p-2">Paying</th><th className="p-2">MRR</th></tr></thead><tbody>{saas.byPlan.map((row) => <tr key={row.planId} className="border-b last:border-0"><td className="p-2 font-semibold text-slate-900">{row.name}</td><td className="p-2">{row.active}</td><td className="p-2">{saasMoney(row.revenue)}</td></tr>)}</tbody></table></div>}
    </Panel>
    <Panel title="Control-plane overview" subtitle="Customer metadata and SaaS operations only; resident clinical records remain outside this portal." icon={<Gauge className="h-5 w-5"/>}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{[
        ["Customer Workspaces", `${organizations.filter((item) => item.status === "ACTIVE").length} active customers`, "/platform_admin/workspaces"],
        ["Plans & Entitlements", `${plans.length} configurable plans`, "/platform_admin/plans"],
        ["Security & Audit", `${insights.deniedLast24Hours} denied events in 24h`, "/platform_admin/security"],
        ["System Health", `${Object.values(insights.health).filter((value) => ["OPERATIONAL", "CONFIGURED"].includes(value)).length}/${Object.keys(insights.health).length || 5} services ready`, "/platform_admin/health"],
      ].map(([name, detail, route]) => <Link key={name} href={route} className="rounded-xl border border-slate-200 p-4 transition hover:border-indigo-300 hover:bg-indigo-50"><strong className="text-sm text-slate-900">{name}</strong><p className="mt-1 text-xs text-slate-500">{detail}</p></Link>)}</div>
    </Panel>
  </div>;

  const planView = <div className="space-y-5"><Panel title="Payment details" subtitle="Where customers pay their subscription. Applies to every plan and subscription you create." icon={<CreditCard className="h-5 w-5"/>}>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-semibold text-slate-600">Business / payee name<input value={payDetails.businessName} onChange={(event) => updatePay("businessName", event.target.value)} placeholder="ResoluteAI Inc." className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"/></label>
      <label className="text-xs font-semibold text-slate-600">Payment mode<select value={payDetails.provider} onChange={(event) => updatePay("provider", event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">{PAY_PROVIDERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    <div className="mt-4 space-y-3">
      {payDetails.methods.map((method, index) => <div key={index} className="rounded-xl border border-slate-200 p-3">
        <div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold text-slate-500">Method {index + 1}</span><button type="button" onClick={() => removePayMethod(index)} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-600"><Trash2 className="h-3.5 w-3.5"/>Remove</button></div>
        <div className="grid gap-2 sm:grid-cols-2">
          <select value={method.type} onChange={(event) => updatePayMethod(index, "type", event.target.value)} className="rounded-lg border px-3 py-2 text-sm">{PAY_METHOD_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <input placeholder="Label (e.g. BDO Savings)" value={method.label} onChange={(event) => updatePayMethod(index, "label", event.target.value)} className="rounded-lg border px-3 py-2 text-sm"/>
          <input placeholder="Account name" value={method.accountName} onChange={(event) => updatePayMethod(index, "accountName", event.target.value)} className="rounded-lg border px-3 py-2 text-sm"/>
          <input placeholder="Account number / handle" value={method.accountNumber} onChange={(event) => updatePayMethod(index, "accountNumber", event.target.value)} className="rounded-lg border px-3 py-2 text-sm"/>
        </div>
        <input placeholder="Instructions (optional)" value={method.instructions} onChange={(event) => updatePayMethod(index, "instructions", event.target.value)} className="mt-2 w-full rounded-lg border px-3 py-2 text-sm"/>
      </div>)}
      <button type="button" onClick={addPayMethod} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Plus className="h-3.5 w-3.5"/>Add payment method</button>
    </div>
    <label className="mt-4 block text-xs font-semibold text-slate-600">Notes shown to customers<textarea value={payDetails.notes} onChange={(event) => updatePay("notes", event.target.value)} rows={2} placeholder="e.g. Send proof of payment to billing@resoluteai.com" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"/></label>
    <button disabled={savingPay} onClick={() => void savePaymentDetails()} className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{savingPay && <Loader2 className="h-4 w-4 animate-spin"/>}Save payment details</button>
  </Panel><Panel title="Create subscription plan" subtitle="Commercial limits are enforced by server-side entitlements. Price, tagline, and visibility control how the plan appears on the public landing page." icon={<Plus className="h-5 w-5"/>}>
    <form onSubmit={createPlan} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"><input required name="key" placeholder="Plan key (e.g. GROWTH)" className="rounded-lg border px-3 py-2 text-sm"/><input required name="name" placeholder="Plan name" className="rounded-lg border px-3 py-2 text-sm"/><input name="description" placeholder="Description" className="rounded-lg border px-3 py-2 text-sm"/><input type="number" min="1" name="maxCommunities" placeholder="Community limit" className="rounded-lg border px-3 py-2 text-sm"/><input type="number" min="1" name="maxActiveResidents" placeholder="Resident limit" className="rounded-lg border px-3 py-2 text-sm"/><input type="number" min="1" name="maxStaffSeats" placeholder="Staff-seat limit" className="rounded-lg border px-3 py-2 text-sm"/><input type="number" min="0" name="priceMonthly" placeholder="Monthly price" className="rounded-lg border px-3 py-2 text-sm"/><input name="currency" defaultValue="PHP" placeholder="Currency" className="rounded-lg border px-3 py-2 text-sm"/><input name="tagline" placeholder="Landing tagline" className="rounded-lg border px-3 py-2 text-sm"/><label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-slate-700"><input type="checkbox" name="public" defaultChecked className="h-4 w-4"/>Show on landing page</label><button disabled={creatingPlan} className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 xl:col-span-2">{creatingPlan && <Loader2 className="h-4 w-4 animate-spin"/>}Create plan</button></form>
  </Panel><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{plans.map((plan) => <article key={plan.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between"><div><h3 className="font-bold text-slate-900">{plan.name}</h3><code className="text-xs text-indigo-600">{plan.key}</code></div><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${plan.meta?.public === false ? "bg-slate-200 text-slate-600" : "bg-emerald-100 text-emerald-700"}`}>{plan.meta?.public === false ? "HIDDEN" : "PUBLIC"}</span></div><p className="mt-2 min-h-8 text-xs text-slate-500">{plan.meta?.tagline || plan.description || "No description"}</p><div className="mt-3 flex items-center gap-2 text-sm font-bold text-indigo-600"><CircleDollarSign className="h-4 w-4"/>{priceText(plan)}{plan.meta?.highlight && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">POPULAR</span>}</div><div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><span className="rounded-lg bg-slate-50 p-2"><b className="block">{plan.maxCommunities ?? "∞"}</b>Communities</span><span className="rounded-lg bg-slate-50 p-2"><b className="block">{plan.maxActiveResidents ?? "∞"}</b>Residents</span><span className="rounded-lg bg-slate-50 p-2"><b className="block">{plan.maxStaffSeats ?? "∞"}</b>Staff</span></div><p className="mt-3 text-xs text-slate-500">{plan.entitlements?.filter((item) => item.enabled).length || 0} enabled module entitlements</p><div className="mt-4 flex gap-2"><button onClick={() => setEditingPlan(plan)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Pencil className="h-3.5 w-3.5"/>Edit</button><button onClick={() => void deletePlan(plan)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5"/></button></div></article>)}{!plans.length && <p className="text-sm text-slate-500">No plans yet. Create one above and it will appear on the landing page.</p>}</div></div>;

  const usageView = <Panel title="Usage and capacity" subtitle="Current database counts compared with each customer’s assigned plan." icon={<Gauge className="h-5 w-5"/>}><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b text-xs uppercase text-slate-500"><tr><th className="p-3">Customer</th><th className="p-3">Plan</th><th className="p-3">Communities</th><th className="p-3">Residents</th><th className="p-3">Staff</th><th className="p-3">Status</th><th className="p-3">Actions</th></tr></thead><tbody>{organizations.map((organization) => { const plan = organization.subscription?.plan; const atLimit = Boolean((plan?.maxCommunities && organization._count.communities >= plan.maxCommunities) || (plan?.maxActiveResidents && organization._count.residents >= plan.maxActiveResidents) || (plan?.maxStaffSeats && organization._count.staff >= plan.maxStaffSeats)); return <tr key={organization.id} className="border-b last:border-0"><td className="p-3 font-semibold text-slate-900">{organization.name}</td><td className="p-3">{plan?.name || "Unassigned"}</td><td className="p-3">{organization._count.communities} / {plan?.maxCommunities ?? "∞"}</td><td className="p-3">{organization._count.residents} / {plan?.maxActiveResidents ?? "∞"}</td><td className="p-3">{organization._count.staff} / {plan?.maxStaffSeats ?? "∞"}</td><td className="p-3"><div className="flex items-center gap-1.5"><Badge value={organization.status}/>{atLimit && <Badge value="LIMIT WARNING"/>}</div></td><td className="p-3"><div className="flex items-center gap-1.5"><button onClick={() => void openInvoices(organization)} className="rounded-lg border border-indigo-200 px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50">Invoices</button>{organization.status === "ACTIVE" ? <button onClick={() => void setOrgStatus(organization, "SUSPENDED")} className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50">Suspend</button> : <button onClick={() => void setOrgStatus(organization, "ACTIVE")} className="rounded-lg border border-emerald-200 px-2.5 py-1 text-xs font-semibold text-emerald-600 hover:bg-emerald-50">Activate</button>}</div></td></tr>; })}</tbody></table></div></Panel>;

  const accessView = <div className="grid gap-5 xl:grid-cols-2"><Panel title="Customers & access" subtitle="Each customer workspace and its owner or admin account." icon={<Building2 className="h-5 w-5"/>}><div className="space-y-3">{organizations.map((organization) => <div key={organization.id} className="rounded-xl border p-3"><div className="flex items-center justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{organization.name}</p><p className="truncate text-xs text-slate-500">{organization.subscription?.plan?.name || "No plan"} · {organization.memberships?.length ? organization.memberships.map((membership) => membership.role).join(" + ") + (organization.memberships.length > 1 ? " accounts" : " account") : "owner account pending"}</p></div><Badge value={organization.status}/></div>{organization.memberships && organization.memberships.length > 0 && <div className="mt-2 space-y-1">{organization.memberships.map((membership) => <div key={membership.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5"><div className="min-w-0"><p className="truncate text-xs font-medium text-slate-800">{membership.user.name} · {membership.role}</p><p className="truncate text-[11px] text-slate-500">{membership.user.email}</p></div><span className="flex-none text-[10px] text-slate-400">{membership.user.lastLogin ? `Last in ${new Date(membership.user.lastLogin).toLocaleDateString()}` : "Never signed in"}</span></div>)}</div>}</div>)}{!organizations.length && <p className="text-sm text-slate-500">No customer organizations yet.</p>}</div></Panel><Panel title="Platform access" subtitle="Accounts with platform-wide control-plane roles." icon={<KeyRound className="h-5 w-5"/>}><div className="space-y-2">{insights.platformUsers.map((user) => <div key={user.id} className="flex items-center justify-between gap-3 rounded-xl border p-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{user.name}</p><p className="truncate text-xs text-slate-500">{user.email} · {user.platformRole}</p></div><Badge value={user.isActive ? "ACTIVE" : "SUSPENDED"}/></div>)}</div></Panel></div>;

  const securityView = <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-3"><Stat label="Denied events (24h)" value={insights.deniedLast24Hours} icon={<Shield className="h-5 w-5"/>} tone={insights.deniedLast24Hours ? "rose" : "emerald"}/><Stat label="Audit events loaded" value={insights.auditEvents.length} icon={<Database className="h-5 w-5"/>}/><Stat label="Platform accounts" value={insights.platformUsers.length} icon={<Users className="h-5 w-5"/>}/></div><Panel title="Platform audit activity" subtitle="Safe operational metadata only; before/after payloads and resident PHI are not displayed." icon={<ShieldCheck className="h-5 w-5"/>}><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="border-b text-xs uppercase text-slate-500"><tr><th className="p-3">Time</th><th className="p-3">Actor</th><th className="p-3">Action</th><th className="p-3">Target</th><th className="p-3">IP</th></tr></thead><tbody>{insights.auditEvents.map((event) => <tr key={event.id} className="border-b last:border-0"><td className="p-3 text-xs">{new Date(event.createdAt).toLocaleString()}</td><td className="p-3"><b className="block">{event.actorName}</b><span className="text-xs text-slate-500">{event.actorRole}</span></td><td className="p-3"><Badge value={event.action}/></td><td className="p-3">{event.entityType}</td><td className="p-3 text-xs text-slate-500">{event.ipAddress || "Not recorded"}</td></tr>)}</tbody></table></div></Panel></div>;

  const healthView = <Panel title="Platform service health" subtitle="Configuration readiness from the current application environment. This is not an external uptime monitor." icon={<Activity className="h-5 w-5"/>} action={<button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold"><RefreshCw className="h-4 w-4"/>Refresh</button>}><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Object.entries(insights.health).map(([service, status]) => <div key={service} className="flex items-center justify-between rounded-xl border p-4"><div className="flex items-center gap-3">{["OPERATIONAL", "CONFIGURED"].includes(status) ? <CheckCircle2 className="h-5 w-5 text-emerald-500"/> : <XCircle className="h-5 w-5 text-rose-500"/>}<span className="text-sm font-semibold capitalize text-slate-900">{service.replaceAll(/([A-Z])/g, " $1")}</span></div><Badge value={status}/></div>)}</div></Panel>;

  const settingsView = <div className="grid gap-5 xl:grid-cols-2"><Panel title="Security defaults" subtitle="Required control-plane safeguards." icon={<ShieldCheck className="h-5 w-5"/>}><div className="space-y-3">{["Privileged MFA enforcement", "Tenant-aware authorization", "Platform audit recording", "Resident PHI excluded from control plane"].map((item) => <div key={item} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm"><span>{item}</span><Badge value="ACTIVE"/></div>)}</div></Panel><Panel title="Platform configuration" subtitle="Environment-managed settings are changed through deployment configuration, not exposed as browser secrets." icon={<ServerCog className="h-5 w-5"/>}><div className="space-y-3">{["Shared product domain", "Invitation email provider", "Supabase authentication", "Database and Realtime endpoints"].map((item) => <div key={item} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm"><span>{item}</span><Badge value="CONFIGURED"/></div>)}</div><p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Secrets, CORS origins, retention, and vendor agreements remain deployment-controlled. No secret values are shown in this portal.</p></Panel></div>;

  const views: Record<string, ReactNode> = { dashboard: overview, workspaces: <SaasPlatformConsole/>, plans: planView, usage: usageView, access: accessView, security: securityView, health: healthView, platformsettings: settingsView };
  return <div className="space-y-6"><section className="rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-700 to-indigo-700 p-5 text-white shadow-lg"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-3"><div className="rounded-xl bg-white/15 p-2.5"><ShieldCheck className="h-7 w-7"/></div><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-100">SLMS SaaS Control Plane</p><h1 className="mt-1 text-2xl font-black sm:text-3xl">Platform Admin Portal</h1><p className="mt-2 max-w-3xl text-sm text-blue-100">Provision customers, govern subscriptions and access, monitor capacity, and review platform security without entering resident clinical workflows.</p></div></div>{loading && <Loader2 className="h-5 w-5 animate-spin text-blue-100"/>}</div></section>{error && <div className="flex flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 sm:flex-row sm:items-center sm:justify-between"><span>{error}</span><button onClick={() => void load()} className="inline-flex flex-none items-center justify-center gap-2 rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-bold"><RefreshCw className="h-4 w-4"/>Retry</button></div>}{views[tab] || overview}{invoiceOrg && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setInvoiceOrg(null); }}><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
  <div className="mb-4 flex items-center justify-between"><h3 className="text-lg font-bold text-slate-900">Invoices · {invoiceOrg.name}</h3><button onClick={() => setInvoiceOrg(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5"/></button></div>
  <div className="rounded-xl border border-slate-200 p-3">
    <p className="mb-2 text-xs font-bold text-slate-600">Issue a new invoice</p>
    <div className="space-y-2">{invLines.map((line, index) => <div key={index} className="flex gap-2"><input value={line.description} onChange={(event) => setInvLines((prev) => prev.map((item, i) => (i === index ? { ...item, description: event.target.value } : item)))} placeholder="Description (e.g. Setup fee)" className="flex-1 rounded-lg border px-3 py-2 text-sm"/><input value={line.amount} onChange={(event) => setInvLines((prev) => prev.map((item, i) => (i === index ? { ...item, amount: event.target.value } : item)))} type="number" min="0" placeholder="Amount" className="w-32 rounded-lg border px-3 py-2 text-sm"/>{invLines.length > 1 && <button type="button" onClick={() => setInvLines((prev) => prev.filter((_, i) => i !== index))} className="rounded-lg border border-rose-200 px-2 text-rose-600"><Trash2 className="h-3.5 w-3.5"/></button>}</div>)}</div>
    <button type="button" onClick={() => setInvLines((prev) => [...prev, { description: "", amount: "" }])} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Plus className="h-3.5 w-3.5"/>Add line</button>
    <input value={invNotes} onChange={(event) => setInvNotes(event.target.value)} placeholder="Notes (optional)" className="mt-2 w-full rounded-lg border px-3 py-2 text-sm"/>
    <label className="mt-2 flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={invAdvances} onChange={(event) => setInvAdvances(event.target.checked)} className="h-4 w-4"/>This is a subscription period (paying it reactivates the org and rolls the billing date forward)</label>
    <button disabled={invBusy} onClick={() => void issueInvoice()} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{invBusy && <Loader2 className="h-4 w-4 animate-spin"/>}Issue invoice</button>
  </div>
  <div className="mt-4 space-y-2">{orgInvoices.map((invoice) => { const money = (() => { try { return new Intl.NumberFormat("en-PH", { style: "currency", currency: invoice.currency, maximumFractionDigits: 0 }).format(invoice.total); } catch { return `${invoice.currency} ${invoice.total.toLocaleString()}`; } })(); return <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm"><div><b className="text-slate-900">{money}</b> <span className="text-xs text-slate-500">· {invoice.number} · {invoice.periodLabel}</span><p className="text-xs text-slate-500">{invoice.lineItems.map((line) => line.description).join(", ")}</p></div><div className="flex items-center gap-1.5"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${invoice.status === "PAID" ? "bg-emerald-100 text-emerald-700" : invoice.status === "VOID" ? "bg-slate-100 text-slate-500" : "bg-amber-100 text-amber-700"}`}>{invoice.status}</span>{invoice.status === "ISSUED" && <><select defaultValue="BANK_TRANSFER" id={`m-${invoice.id}`} className="rounded-lg border px-2 py-1 text-xs">{[["BANK_TRANSFER", "Bank"], ["GCASH", "GCash"], ["MAYA", "Maya"], ["CARD", "Card"], ["OFFLINE", "Other"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button disabled={invBusy} onClick={() => void invoiceAction(invoice.id, "markPaid", (document.getElementById(`m-${invoice.id}`) as HTMLSelectElement)?.value)} className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white disabled:opacity-50">Mark paid</button><button disabled={invBusy} onClick={() => void invoiceAction(invoice.id, "void")} className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-semibold text-rose-600">Void</button></>}</div></div>; })}{!orgInvoices.length && <p className="py-4 text-center text-sm text-slate-500">No invoices issued yet.</p>}</div>
</div></div>}
{editingPlan && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingPlan(null); }}><div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"><div className="mb-4 flex items-center justify-between"><h3 className="text-lg font-bold text-slate-900">Edit plan · {editingPlan.name}</h3><button onClick={() => setEditingPlan(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5"/></button></div><form onSubmit={savePlan} className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600 sm:col-span-2">Plan name<input required name="name" defaultValue={editingPlan.name} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"/></label><label className="text-xs font-semibold text-slate-600 sm:col-span-2">Description<input name="description" defaultValue={editingPlan.description || ""} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"/></label><label className="text-xs font-semibold text-slate-600 sm:col-span-2">Landing tagline<input name="tagline" defaultValue={editingPlan.meta?.tagline || ""} placeholder="e.g. For growing facilities" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"/></label><label className="text-xs font-semibold text-slate-600">Monthly price<input type="number" min="0" name="priceMonthly" defaultValue={editingPlan.meta?.priceMonthly ?? ""} placeholder="Leave blank for custom" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"/></label><label className="text-xs font-semibold text-slate-600">Currency<input name="currency" defaultValue={editingPlan.meta?.currency || "PHP"} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"/></label><label className="text-xs font-semibold text-slate-600">Community limit<input type="number" min="1" name="maxCommunities" defaultValue={editingPlan.maxCommunities ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"/></label><label className="text-xs font-semibold text-slate-600">Resident limit<input type="number" min="1" name="maxActiveResidents" defaultValue={editingPlan.maxActiveResidents ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"/></label><label className="text-xs font-semibold text-slate-600">Staff-seat limit<input type="number" min="1" name="maxStaffSeats" defaultValue={editingPlan.maxStaffSeats ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"/></label><label className="text-xs font-semibold text-slate-600">Display order<input type="number" name="order" defaultValue={editingPlan.meta?.order ?? 100} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"/></label><label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" name="public" defaultChecked={editingPlan.meta?.public !== false} className="h-4 w-4"/>Show on landing page</label><label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" name="highlight" defaultChecked={editingPlan.meta?.highlight === true} className="h-4 w-4"/>Highlight as “Most popular”</label><div className="mt-2 flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={() => setEditingPlan(null)} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button disabled={savingPlan} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{savingPlan && <Loader2 className="h-4 w-4 animate-spin"/>}Save changes</button></div></form></div></div>}</div>;
}
