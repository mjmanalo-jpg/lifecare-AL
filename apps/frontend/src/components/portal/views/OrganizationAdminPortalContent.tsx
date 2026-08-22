"use client";

import Link from "next/link";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { Activity, Building2, CheckCircle2, ClipboardCheck, CreditCard, DollarSign, ExternalLink, Gauge, Loader2, Mail, Palette, Plus, Receipt, RefreshCw, Shield, UserPlus, Users, Wallet, XCircle } from "lucide-react";
import { openGlobalConfirm } from "@/components/ui/global-confirm";

type Community = { id: string; name: string; code?: string | null; timezone: string; isActive: boolean; bedsTotal?: number | null; _count: { residents: number; staff: number; rooms: number } };
type Member = { id: string; role: string; status: string; user: { id: string; name: string; email: string; isActive: boolean; lastLogin?: string | null; communityMemberships: { id: string; role: string; status: string; community: { id: string; name: string } }[] } };
type Invitation = { id: string; email: string; status: string; organizationRole?: string | null; communityRole?: string | null; expiresAt: string; createdAt: string; community?: { id: string; name: string } | null };
type Staff = { id: string; position: string; department?: string | null; isActive: boolean; isApproved: boolean; community?: { id: string; name: string } | null; user: { id: string; name: string; email: string; phone?: string | null; role: string; isActive: boolean } };
type AuditEvent = { id: string; actorName: string; actorRole: string; action: string; entityType: string; reason?: string | null; createdAt: string };
type Organization = { id: string; name: string; logoUrl?: string | null; primaryColor?: string | null; secondaryColor?: string | null; emailFromName?: string | null; status: string; communities: Community[]; memberships: Member[]; invitations: Invitation[]; staff: Staff[]; subscription?: { status: string; startsAt?: string | null; trialEndsAt?: string | null; currentPeriodEnd?: string | null; nextBillingDate?: string | null; plan: { name: string; key: string; priceMonthly?: number | null; currency?: string | null; maxCommunities?: number | null; maxActiveResidents?: number | null; maxStaffSeats?: number | null; entitlements: { id: string; featureKey: string; enabled: boolean }[] } } | null };

function Card({ title, subtitle, icon, children, action }: { title: string; subtitle?: string; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-3"><span className="rounded-xl bg-blue-50 p-2.5 text-blue-600">{icon}</span><div><h2 className="font-bold text-slate-900">{title}</h2>{subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}</div></div>{action}</div><div className="mt-4">{children}</div></section>;
}
function Badge({ value }: { value: string }) { const good = ["ACTIVE", "APPROVED", "ACCEPTED", "TRIALING"].includes(value); const pending = ["PENDING", "INVITED"].includes(value); return <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${good ? "bg-emerald-100 text-emerald-700" : pending ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>{value.replaceAll("_", " ")}</span>; }
function Stat({ label, value, icon }: { label: string; value: number | string; icon: ReactNode }) { return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><span className="inline-flex rounded-lg bg-blue-50 p-2 text-blue-600">{icon}</span><b className="mt-3 block text-2xl text-slate-900">{value}</b><span className="text-xs text-slate-500">{label}</span></div>; }
function communityAccess(member: Member, communities: Community[]) {
  const assigned = member.user.communityMemberships.filter((item) => item.status === "ACTIVE").map((item) => `${item.community.name} (${item.role.replaceAll("_", " ")})`);
  if (assigned.length) return assigned.join(", ");
  if (["OWNER", "ADMIN"].includes(member.role)) return `All communities: ${communities.map((community) => community.name).join(", ") || "none created"}`;
  return "No community assignment";
}

export default function OrganizationAdminPortalContent({ tab = "dashboard" }: { tab?: string }) {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [newStaffRole, setNewStaffRole] = useState("");
  type Invoice = { id: string; number: string; status: string; currency: string; total: number; periodLabel: string; issuedAt: string; dueDate: string; lineItems: { description: string; amount: number }[]; notes?: string };
  type Billing = { planName: string | null; status: string; amountDue: number | null; currency: string; dueDate: string | null; paidThisPeriod: boolean; onlinePaymentEnabled: boolean; payments: { id: string; amount: number; currency: string; method: string; provider: string; status: string; periodLabel: string; paidAt: string; invoiceNumber?: string }[]; profile?: { preferredMethod: string; billingEmail: string; billingName: string } | null; cancelScheduledFor?: string | null; invoices?: Invoice[]; paymentDetails?: { provider: string; businessName: string; notes: string; methods: { type: string; label: string; accountName: string; accountNumber: string; instructions: string }[] } };
  const [billing, setBilling] = useState<Billing | null>(null);
  const [payMethod, setPayMethod] = useState("CARD");
  const [paying, setPaying] = useState(false);
  type PlanOption = { id: string; key: string; name: string; description?: string | null; maxCommunities?: number | null; maxActiveResidents?: number | null; maxStaffSeats?: number | null; priceMonthly: number | null; currency: string; isCurrent: boolean };
  type SubMgmt = { currentPlanId: string | null; status: string; cancelScheduledFor: string | null; usage: { communities: number; residents: number; staff: number }; plans: PlanOption[] };
  const [subMgmt, setSubMgmt] = useState<SubMgmt | null>(null);
  const [planChoice, setPlanChoice] = useState("");
  const [subBusy, setSubBusy] = useState(false);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    if (!silent) setError("");
    const response = await fetch("/api/organization-admin/overview", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { if (!silent) setError(body.code === "MFA_REQUIRED" ? "Organization owners and admins must verify MFA. Open Account Settings → Authenticator MFA, then retry." : body.error || "Unable to load organization administration data"); }
    else { setOrganization(body.organization); setAuditEvents(body.auditEvents || []); }
    if (!silent) setLoading(false);
  }
  useEffect(() => { void load(); }, []);
  // Poll silently so resident / staff / room counts in Communities stay current
  // without flashing the loading spinner (realtime subscriptions are scoped to a
  // single community; the org-admin overview spans all of them).
  useEffect(() => { const id = window.setInterval(() => { void load(true); }, 20000); return () => window.clearInterval(id); }, []);
  useEffect(() => { let cancelled = false; void fetch("/api/organization-admin/billing", { cache: "no-store" }).then((response) => (response.ok ? response.json() : null)).then((data) => { if (!cancelled && data) { setBilling(data); if (data.profile?.preferredMethod) setPayMethod(data.profile.preferredMethod); } }).catch(() => {}); return () => { cancelled = true; }; }, []);
  async function loadSubMgmt() { try { const response = await fetch("/api/organization-admin/subscription", { cache: "no-store" }); if (response.ok) { const data = await response.json(); setSubMgmt(data); setPlanChoice(data.currentPlanId || ""); } } catch { /* non-fatal */ } }
  useEffect(() => { let cancelled = false; void fetch("/api/organization-admin/subscription", { cache: "no-store" }).then((response) => (response.ok ? response.json() : null)).then((data) => { if (!cancelled && data) { setSubMgmt(data); setPlanChoice(data.currentPlanId || ""); } }).catch(() => {}); return () => { cancelled = true; }; }, []);

  const totals = useMemo(() => (organization?.communities || []).reduce((sum, community) => ({ residents: sum.residents + community._count.residents, staff: sum.staff + community._count.staff }), { residents: 0, staff: 0 }), [organization]);
  const pendingStaff = (organization?.staff || []).filter((staff) => !staff.isApproved);
  const pendingInvitations = (organization?.invitations || []).filter((invitation) => invitation.status === "PENDING");

  async function createCommunity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy(true); setError("");
    const response = await fetch("/api/organization-admin/communities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(data.entries())) });
    const body = await response.json(); if (response.ok) { form.reset(); await load(); } else setError(body.error || "Community creation failed"); setBusy(false);
  }
  async function createStaffAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!organization) return; const form = event.currentTarget; const data = new FormData(form); const staffName = String(data.get("name") || ""); setBusy(true); setError(""); setNotice("");
    const response = await fetch(`/api/organization-admin/staff-accounts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: data.get("name"), email: data.get("email"), password: data.get("password"), phone: data.get("phone"), position: data.get("position"), department: data.get("department"), communityId: data.get("communityId"), role: data.get("role") }) });
    const body = await response.json().catch(() => ({})); if (response.ok) { form.reset(); setShowAddStaff(false); setNotice(`Staff account created for ${staffName}. They sign in with your company name + their mobile number, and set their password on first login.`); await load(); } else setError(body.error || "Account creation failed"); setBusy(false);
  }
  async function decideStaff(id: string, status: "APPROVED" | "REJECTED") { setBusy(true); const response = await fetch(`/api/organization-admin/staff/${id}/approval`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }); const body = await response.json(); if (response.ok) await load(); else setError(body.error || "Approval failed"); setBusy(false); }
  async function refreshBilling() { try { const response = await fetch("/api/organization-admin/billing", { cache: "no-store" }); if (response.ok) setBilling(await response.json()); } catch { /* non-fatal */ } }
  async function payNow(invoiceId?: string) {
    setPaying(true); setError(""); setNotice("");
    const response = await fetch("/api/organization-admin/billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method: payMethod, ...(invoiceId ? { invoiceId } : {}) }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setError(body.error || "Payment failed"); setPaying(false); return; }
    if (body.checkoutUrl) { window.location.href = body.checkoutUrl; return; }
    setNotice(body.simulated ? "Payment recorded. No live payment gateway is configured, so this was processed in demo mode." : "Payment successful.");
    await Promise.all([load(), refreshBilling()]);
    setPaying(false);
  }
  async function saveBranding(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!organization) return; const data = new FormData(event.currentTarget); setBusy(true); const response = await fetch(`/api/organizations/${organization.id}/branding`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(data.entries())) }); const body = await response.json(); if (response.ok) await load(); else setError(body.error || "Branding update failed"); setBusy(false); }
  async function changePlan() {
    if (!planChoice || planChoice === subMgmt?.currentPlanId) return;
    setSubBusy(true); setError(""); setNotice("");
    const response = await fetch("/api/organization-admin/subscription", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: planChoice }) });
    const body = await response.json().catch(() => ({}));
    if (response.ok) { setNotice(body.message || "Plan updated."); await Promise.all([load(), refreshBilling(), loadSubMgmt()]); } else setError(body.error || "Plan change failed");
    setSubBusy(false);
  }
  async function setCancellation(action: "cancel" | "resume") {
    if (action === "cancel") {
      const { confirmed } = await openGlobalConfirm({
        title: "Cancel your subscription?",
        description: "Your subscription cancels at the end of the current billing period. You keep full access until then, and can resume at any time before the cancellation date.",
        confirmText: "Cancel subscription",
        cancelText: "Keep subscription",
        variant: "danger",
      });
      if (!confirmed) return;
    }
    setSubBusy(true); setError(""); setNotice("");
    const response = await fetch("/api/organization-admin/subscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const body = await response.json().catch(() => ({}));
    if (response.ok) { setNotice(body.message || "Updated."); await Promise.all([refreshBilling(), loadSubMgmt()]); } else setError(body.error || "Update failed");
    setSubBusy(false);
  }
  async function saveBillingProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setSubBusy(true); setError(""); setNotice("");
    const response = await fetch("/api/organization-admin/billing", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile: { preferredMethod: data.get("preferredMethod"), billingEmail: data.get("billingEmail"), billingName: data.get("billingName") } }) });
    const body = await response.json().catch(() => ({}));
    if (response.ok) { setNotice("Billing details saved."); await refreshBilling(); } else setError(body.error || "Could not save billing details");
    setSubBusy(false);
  }
  const invoiceList = (invoices: Invoice[]) => <div className="space-y-2">{invoices.map((invoice) => { const money = (() => { try { return `${invoice.currency} ${new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 }).format(invoice.total)}`; } catch { return `${invoice.currency} ${invoice.total.toLocaleString()}`; } })(); return <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-sm"><div><b className="text-slate-900">{money}</b> <span className="text-xs text-slate-500">· {invoice.number} · {invoice.periodLabel}</span><p className="text-xs text-slate-500">{invoice.lineItems.map((line) => line.description).join(", ")} · due {new Date(invoice.dueDate).toLocaleDateString()}</p></div><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${invoice.status === "PAID" ? "bg-emerald-100 text-emerald-700" : invoice.status === "VOID" ? "bg-slate-100 text-slate-500" : "bg-amber-100 text-amber-700"}`}>{invoice.status}</span>{invoice.status === "ISSUED" && <button disabled={paying} onClick={() => void payNow(invoice.id)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">Pay</button>}<a href={`/api/organization-admin/billing/invoice/${invoice.id}`} target="_blank" rel="noreferrer" className="rounded-lg border px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50">Download</a></div></div>; })}</div>;

  const overview = <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Communities" value={organization?.communities.length || 0} icon={<Building2 className="h-5 w-5"/>}/><Stat label="Active residents" value={totals.residents} icon={<Activity className="h-5 w-5"/>}/><Stat label="Staff profiles" value={totals.staff} icon={<Users className="h-5 w-5"/>}/><Stat label="Pending invitations" value={pendingInvitations.length} icon={<Mail className="h-5 w-5"/>}/></div><Card title="Organization control center" subtitle="Manage company-wide access here, then enter a community for clinical and facility operations." icon={<Shield className="h-5 w-5"/>} action={<Link href="/facility_admin/dashboard" className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white">Open Facility Operations <ExternalLink className="h-4 w-4"/></Link>}><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-4"><b className="text-sm">Subscription</b><p className="mt-1 text-xs text-slate-500">{organization?.subscription?.plan.name || "No plan"} · {organization?.subscription?.status || "UNASSIGNED"}</p></div><div className="rounded-xl bg-slate-50 p-4"><b className="text-sm">People with access</b><p className="mt-1 text-xs text-slate-500">{organization?.memberships.filter((item) => item.status === "ACTIVE").length || 0} active organization memberships</p></div><div className="rounded-xl bg-slate-50 p-4"><b className="text-sm">Approval queue</b><p className="mt-1 text-xs text-slate-500">{pendingStaff.length} staff records awaiting review</p></div></div></Card></div>;

  const communities = <div className="space-y-5"><Card title="Add community" subtitle="New facilities are limited by the assigned subscription plan." icon={<Plus className="h-5 w-5"/>}><form onSubmit={createCommunity} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><input required name="name" placeholder="Community name" className="rounded-xl border px-3 py-2.5 text-sm"/><input name="code" placeholder="Community code" className="rounded-xl border px-3 py-2.5 text-sm"/><input name="timezone" defaultValue="America/New_York" placeholder="Timezone" className="rounded-xl border px-3 py-2.5 text-sm"/><input name="bedsTotal" type="number" min="1" placeholder="Bed capacity" className="rounded-xl border px-3 py-2.5 text-sm"/><button disabled={busy} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white">Create community</button></form></Card><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{organization?.communities.map((community) => <article key={community.id} className="rounded-2xl border bg-white p-4 shadow-sm"><div className="flex justify-between"><div><h3 className="font-bold">{community.name}</h3><p className="text-xs text-slate-500">{community.code || "No code"} · {community.timezone}</p></div><Badge value={community.isActive ? "ACTIVE" : "SUSPENDED"}/></div><div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-center text-xs"><span className="rounded-lg bg-slate-50 p-2"><b className="block">{community._count.residents}</b>Residents</span><span className="rounded-lg bg-slate-50 p-2"><b className="block">{community._count.staff}</b>Staff</span><span className="rounded-lg bg-slate-50 p-2"><b className="block">{community._count.rooms}{community.bedsTotal ? ` / ${community.bedsTotal}` : ""}</b>Beds</span></div></article>)}</div></div>;

  const people = <Card title="People and access" subtitle="Organization and community memberships. Owners and organization admins automatically cover every community." icon={<Users className="h-5 w-5"/>}><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="border-b text-xs uppercase text-slate-500"><tr><th className="p-3">Person</th><th className="p-3">Organization role</th><th className="p-3">Community access</th><th className="p-3">Status</th><th className="p-3">Last login</th></tr></thead><tbody>{organization?.memberships.map((membership) => <tr key={membership.id} className="border-b last:border-0"><td className="p-3"><b className="block">{membership.user.name}</b><span className="text-xs text-slate-500">{membership.user.email}</span></td><td className="p-3">{membership.role}</td><td className="p-3 text-xs">{communityAccess(membership, organization.communities)}</td><td className="p-3"><Badge value={membership.status}/></td><td className="p-3 text-xs text-slate-500">{membership.user.lastLogin ? new Date(membership.user.lastLogin).toLocaleString() : "Never"}</td></tr>)}</tbody></table></div></Card>;

  const ACCOUNT_ROLES: [string, string][] = [["FACILITY_ADMIN", "Facility Admin"], ["CARE_MANAGER", "Care Manager"], ["SUPERADMIN", "Super Admin"]];
  // Every staff role an org admin can register (they sign in via company + mobile).
  const STAFF_ROLES: [string, string][] = [["CARE_MANAGER", "Care Manager"], ["RESIDENT_COORDINATOR", "Resident Coordinator"], ["NURSE", "Nurse"], ["CAREGIVER", "Caregiver"], ["PHYSICIAN", "Physician"], ["FACILITY_ADMIN", "Facility Admin"], ["BILLING_ADMIN", "Billing Admin"], ["NUTRITIONIST", "Nutritionist"], ["KITCHEN", "Kitchen"], ["HOUSEKEEPING", "Housekeeping"], ["MAINTENANCE", "Maintenance"], ["SECURITY", "Security"], ["FLEET_MANAGEMENT", "Fleet Manager"], ["DRIVER", "Driver"], ["SUPERADMIN", "Super Admin"]];
  const roleLabel = (value: string) => STAFF_ROLES.find(([key]) => key === value)?.[1] || ACCOUNT_ROLES.find(([key]) => key === value)?.[1] || value.replaceAll("_", " ");
  const allStaff = organization?.staff || [];
  const fmtMobile = (raw?: string | null) => { const d = String(raw || "").replace(/\D/g, ""); return d.length === 11 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : raw || "—"; };
  const fieldCls = "w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
  const labelCls = "mb-1 block text-xs font-semibold text-slate-600";
  const staffAccountForm = (
    <>
      <Card
        title="Staff"
        subtitle="Add nurses, caregivers, and managers. They sign in with your company name + their mobile number and set their password on first login."
        icon={<UserPlus className="h-5 w-5"/>}
        action={<button onClick={() => { setError(""); setNotice(""); setNewStaffRole(""); setShowAddStaff(true); }} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700"><UserPlus className="h-4 w-4"/>Add staff member</button>}
      >
        <p className="text-sm text-slate-500">Register each staff member&apos;s details and role. The mobile number is their unique sign-in — no email invitation is sent.</p>
      </Card>
      {showAddStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowAddStaff(false)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Add staff member</h3>
              <button onClick={() => setShowAddStaff(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><XCircle className="h-5 w-5"/></button>
            </div>
            <p className="mb-4 text-sm text-slate-500">Enter the staff member&apos;s details. They sign in with your company name + their mobile number, and set their password the first time they log in.</p>
            <form onSubmit={createStaffAccount} className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className={labelCls}>Full name</label><input required name="name" placeholder="e.g. Maria Santos" className={fieldCls}/></div>
              <div><label className={labelCls}>Mobile number <span className="text-blue-600">*unique sign-in</span></label><input required type="tel" name="phone" placeholder="0917 123 4567" className={fieldCls}/></div>
              <div><label className={labelCls}>Email <span className="font-normal text-slate-400">(optional)</span></label><input type="email" name="email" placeholder="name@company.com" className={fieldCls}/></div>
              <div><label className={labelCls}>Role</label><select required name="role" value={newStaffRole} onChange={(e) => setNewStaffRole(e.target.value)} className={fieldCls}><option value="" disabled>Select role</option>{STAFF_ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
              <div><label className={labelCls}>Community</label><select required name="communityId" defaultValue="" className={fieldCls}><option value="" disabled>Select community</option>{organization?.communities.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
              {["CAREGIVER", "NURSE", "CARE_MANAGER"].includes(newStaffRole) && (
                <div className="sm:col-span-2"><label className={labelCls}>Employee ID <span className="text-blue-600">*used in the staff roster</span></label><input required name="employeeCode" placeholder="e.g. CG1 / NOD1 / CM1 (matches your roster)" className={fieldCls}/></div>
              )}
              <div><label className={labelCls}>Position / title</label><input required name="position" placeholder="e.g. Registered Nurse" className={fieldCls}/></div>
              <div><label className={labelCls}>Department <span className="font-normal text-slate-400">(optional)</span></label><input name="department" placeholder="e.g. Nursing" className={fieldCls}/></div>
              <div className="sm:col-span-2 rounded-xl bg-blue-50 px-3.5 py-2.5 text-xs text-blue-700">The staff member sets their own password the first time they sign in with your company name + mobile number.</div>
              <div className="sm:col-span-2 flex gap-2 pt-1">
                <button type="button" onClick={() => setShowAddStaff(false)} className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={busy} className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">{busy ? "Adding…" : "Add staff member"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
  const invitations = <div className="space-y-5">{staffAccountForm}<Card title={`All staff accounts${allStaff.length ? ` (${allStaff.length})` : ""}`} subtitle="Every staff member registered for this organization. Their mobile number is their company sign-in." icon={<Users className="h-5 w-5"/>}><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b text-xs uppercase text-slate-500"><tr><th className="p-3">Person</th><th className="p-3">Role</th><th className="p-3">Mobile (sign-in)</th><th className="p-3">Community</th><th className="p-3">Position</th><th className="p-3">Status</th></tr></thead><tbody>{allStaff.map((staff) => <tr key={staff.id} className="border-b last:border-0"><td className="p-3"><b className="block">{staff.user.name}</b><span className="text-xs text-slate-500">{staff.user.email}</span></td><td className="p-3">{roleLabel(staff.user.role)}</td><td className="p-3 text-xs font-medium tabular-nums text-slate-700">{fmtMobile(staff.user.phone)}</td><td className="p-3 text-xs">{staff.community?.name || "—"}</td><td className="p-3 text-xs">{staff.position}</td><td className="p-3"><Badge value={staff.isApproved ? (staff.user.isActive ? "ACTIVE" : "SUSPENDED") : "PENDING"}/></td></tr>)}</tbody></table>{!allStaff.length && <p className="text-sm text-slate-500">No staff accounts yet.</p>}</div></Card></div>;

  const approvals = <Card title="Pending staff approvals" subtitle="Approve or reject staff records submitted through delegated facility workflows." icon={<ClipboardCheck className="h-5 w-5"/>}><div className="space-y-2">{pendingStaff.map((staff) => <div key={staff.id} className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between"><div><b className="text-sm">{staff.user.name}</b><p className="text-xs text-slate-500">{staff.position} · {staff.community?.name || "Unassigned"} · {staff.user.email}</p></div><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void decideStaff(staff.id, "APPROVED")} className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4"/>Approve</button><button disabled={busy} onClick={() => void decideStaff(staff.id, "REJECTED")} className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700"><XCircle className="h-4 w-4"/>Reject</button></div></div>)}{!pendingStaff.length && <p className="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">No staff records are waiting for approval.</p>}</div></Card>;

  const plan = organization?.subscription?.plan;
  const sub = organization?.subscription;
  const priceMonthly = plan?.priceMonthly ?? null;
  const currency = plan?.currency || "PHP";
  const fmtMoney = (amount: number) => { try { return new Intl.NumberFormat("en-PH", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount); } catch { return `${currency} ${amount.toLocaleString()}`; } };
  const billingDate = sub?.nextBillingDate || sub?.currentPeriodEnd || sub?.trialEndsAt || null;
  const billingLabel = sub?.status === "TRIALING" ? "Trial ends" : "Next billing";
  const subscription = <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-3"><Stat label={`Communities / ${plan?.maxCommunities ?? "∞"}`} value={organization?.communities.filter((item) => item.isActive).length || 0} icon={<Building2 className="h-5 w-5"/>}/><Stat label={`Residents / ${plan?.maxActiveResidents ?? "∞"}`} value={totals.residents} icon={<Activity className="h-5 w-5"/>}/><Stat label={`Staff / ${plan?.maxStaffSeats ?? "∞"}`} value={totals.staff} icon={<Users className="h-5 w-5"/>}/></div>
    <div className="grid gap-3 lg:grid-cols-2">
      <Card title="Monthly payment" subtitle="Your current recurring subscription charge." icon={<DollarSign className="h-5 w-5"/>}>
        <div className="rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 p-5 text-white">
          {priceMonthly !== null ? <div className="flex items-baseline gap-1.5"><span className="text-3xl font-black">{fmtMoney(priceMonthly)}</span><span className="text-sm text-blue-100">/ month</span></div> : <span className="text-2xl font-bold">Custom pricing</span>}
          <p className="mt-2 text-xs text-blue-100">{plan?.name || "No plan assigned"} · {sub?.status || "UNASSIGNED"}</p>
          {billingDate && <p className="mt-1 text-xs text-blue-100">{billingLabel}: {new Date(billingDate).toLocaleDateString()}</p>}
        </div>
        {priceMonthly === null && <p className="mt-3 text-xs text-slate-500">Your plan does not have a listed price yet. Contact the SLMS Platform Administrator for billing details.</p>}
      </Card>
      <Card title="Subscription" subtitle="Switch plans or cancel. Changes take effect from your next billing date." icon={<Gauge className="h-5 w-5"/>}>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-4"><div><b>{plan?.name || "No plan assigned"}</b><p className="text-xs text-slate-500">{plan?.key} · {plan?.entitlements.filter((item) => item.enabled).length || 0} enabled module entitlements</p></div><Badge value={sub?.status || "UNASSIGNED"}/></div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-xl border p-3"><span className="text-slate-500">Started</span><b className="mt-0.5 block text-slate-900">{sub?.startsAt ? new Date(sub.startsAt).toLocaleDateString() : "—"}</b></div><div className="rounded-xl border p-3"><span className="text-slate-500">{billingLabel}</span><b className="mt-0.5 block text-slate-900">{billingDate ? new Date(billingDate).toLocaleDateString() : "—"}</b></div></div>
        {subMgmt && subMgmt.plans.length > 0 && <div className="mt-3">
          <p className="mb-1 text-xs font-semibold text-slate-500">Change plan</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select value={planChoice} onChange={(event) => setPlanChoice(event.target.value)} className="flex-1 rounded-xl border px-3 py-2.5 text-sm">{subMgmt.plans.map((option) => <option key={option.id} value={option.id}>{option.name}{option.priceMonthly !== null ? ` · ${option.currency} ${option.priceMonthly.toLocaleString()}/mo` : ""}{option.isCurrent ? " (current)" : ""}</option>)}</select>
            <button disabled={subBusy || !planChoice || planChoice === subMgmt.currentPlanId} onClick={() => void changePlan()} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Change plan</button>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">Downgrades are blocked while your usage exceeds the target plan&rsquo;s limits.</p>
        </div>}
        <div className="mt-3 rounded-xl border border-slate-200 p-3">
          {billing?.cancelScheduledFor ? <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-amber-700">Cancels on {new Date(billing.cancelScheduledFor).toLocaleDateString()} — you keep access until then.</p><button disabled={subBusy} onClick={() => void setCancellation("resume")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">Keep subscription</button></div>
            : <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-500">Cancel at the end of the current billing period.</p><button disabled={subBusy || !sub} onClick={() => void setCancellation("cancel")} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-600 disabled:opacity-50">Cancel subscription</button></div>}
        </div>
      </Card>
    </div>
    <div className="grid gap-3 lg:grid-cols-2">
      <Card title="Payment options" subtitle="Pay your monthly subscription securely." icon={<CreditCard className="h-5 w-5"/>}>
        {billing?.amountDue != null ? <><p className="mb-2 text-xs font-semibold text-slate-500">Choose a payment method</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{([["CARD", "Credit / Debit"], ["GCASH", "GCash"], ["MAYA", "Maya"], ["BANK_TRANSFER", "Bank Transfer"]] as [string, string][]).map(([value, label]) => <button key={value} type="button" onClick={() => setPayMethod(value)} className={`rounded-xl border px-3 py-2.5 text-xs font-semibold transition ${payMethod === value ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:border-blue-300"}`}>{label}</button>)}</div><button disabled={paying || billing.paidThisPeriod} onClick={() => void payNow()} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50">{paying && <Loader2 className="h-4 w-4 animate-spin"/>}{billing.paidThisPeriod ? "Paid for this period" : `Pay ${fmtMoney(billing.amountDue)}`}</button><p className="mt-2 text-[11px] text-slate-400">Secured checkout. When a payment provider is configured you are redirected to complete payment; otherwise it is recorded in demo mode.</p></> : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Online payment becomes available once your plan has a price. Contact the SLMS Platform Administrator.</p>}
        {billing?.paymentDetails && billing.paymentDetails.methods.length > 0 && <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-bold text-slate-600">Where to send payment{billing.paymentDetails.businessName ? ` · ${billing.paymentDetails.businessName}` : ""}</p><div className="mt-2 space-y-2">{billing.paymentDetails.methods.map((method, index) => <div key={index} className="rounded-lg bg-white p-2 text-xs"><b className="text-slate-800">{method.label || method.type.replaceAll("_", " ")}</b><p className="text-slate-500">{method.accountName}{method.accountNumber ? ` · ${method.accountNumber}` : ""}</p>{method.instructions && <p className="mt-0.5 text-slate-400">{method.instructions}</p>}</div>)}</div>{billing.paymentDetails.notes && <p className="mt-2 text-[11px] text-slate-400">{billing.paymentDetails.notes}</p>}</div>}
        <form onSubmit={saveBillingProfile} className="mt-4 rounded-xl border border-slate-200 p-3"><p className="mb-2 text-xs font-bold text-slate-600">Billing contact &amp; preferred method</p><div className="grid gap-2 sm:grid-cols-3"><select name="preferredMethod" defaultValue={billing?.profile?.preferredMethod || "CARD"} className="rounded-lg border px-3 py-2 text-sm">{([["CARD", "Credit / Debit"], ["GCASH", "GCash"], ["MAYA", "Maya"], ["BANK_TRANSFER", "Bank Transfer"]] as [string, string][]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input name="billingName" defaultValue={billing?.profile?.billingName || ""} placeholder="Billing contact name" className="rounded-lg border px-3 py-2 text-sm"/><input name="billingEmail" type="email" defaultValue={billing?.profile?.billingEmail || ""} placeholder="Billing email" className="rounded-lg border px-3 py-2 text-sm"/></div><button disabled={subBusy} className="mt-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Save billing details</button></form>
      </Card>
      <Card title="Payment history" subtitle="Your recent subscription payments." icon={<Receipt className="h-5 w-5"/>}>
        <div className="space-y-2">{billing?.payments?.length ? billing.payments.map((payment) => { const money = (() => { try { return new Intl.NumberFormat("en-PH", { style: "currency", currency: payment.currency, maximumFractionDigits: 0 }).format(payment.amount); } catch { return `${payment.currency} ${payment.amount.toLocaleString()}`; } })(); return <div key={payment.id} className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm"><div><b className="text-slate-900">{money}</b><p className="text-xs text-slate-500">{new Date(payment.paidAt).toLocaleDateString()} · {payment.method.replaceAll("_", " ")} · {payment.provider}</p></div><div className="flex flex-col items-end gap-1.5"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${payment.status === "PAID" ? "bg-emerald-100 text-emerald-700" : payment.status === "PENDING" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>{payment.status}</span><a href={`/api/organization-admin/billing/receipt/${payment.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:underline"><Receipt className="h-3 w-3"/>Receipt</a></div></div>; }) : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No payments yet.</p>}</div>
      </Card>
    </div>
    {billing?.invoices && billing.invoices.length > 0 && <Card title="Invoices" subtitle="Invoices issued by the SLMS Platform Administrator." icon={<Receipt className="h-5 w-5"/>}>{invoiceList(billing.invoices)}</Card>}
    <Card title="Usage this period" subtitle="Current consumption against your plan's included capacity." icon={<Wallet className="h-5 w-5"/>}>
      <div className="space-y-3">{[{ label: "Communities", used: organization?.communities.filter((item) => item.isActive).length || 0, limit: plan?.maxCommunities }, { label: "Active residents", used: totals.residents, limit: plan?.maxActiveResidents }, { label: "Staff seats", used: totals.staff, limit: plan?.maxStaffSeats }].map((row) => { const pct = row.limit ? Math.min(100, Math.round((row.used / row.limit) * 100)) : 0; return <div key={row.label}><div className="flex items-center justify-between text-xs"><span className="font-semibold text-slate-700">{row.label}</span><span className="text-slate-500">{row.used} / {row.limit ?? "∞"}</span></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${pct >= 90 ? "bg-rose-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${row.limit ? pct : 6}%` }}/></div></div>; })}</div>
    </Card>
  </div>;

  const branding = <Card title="Organization branding" subtitle="These values apply across authorized organization and community experiences." icon={<Palette className="h-5 w-5"/>}><form onSubmit={saveBranding} className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Logo URL<input name="logoUrl" defaultValue={organization?.logoUrl || ""} className="mt-2 w-full rounded-xl border px-3 py-2.5"/></label><label className="text-sm font-medium">Email sender name<input name="emailFromName" defaultValue={organization?.emailFromName || organization?.name || ""} className="mt-2 w-full rounded-xl border px-3 py-2.5"/></label><label className="text-sm font-medium">Primary color<input name="primaryColor" type="color" defaultValue={organization?.primaryColor || "#2563eb"} className="mt-2 h-11 w-full rounded-xl border p-1"/></label><label className="text-sm font-medium">Secondary color<input name="secondaryColor" type="color" defaultValue={organization?.secondaryColor || "#4f46e5"} className="mt-2 h-11 w-full rounded-xl border p-1"/></label><button disabled={busy} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white sm:col-span-2">Save branding</button></form></Card>;
  const audit = <Card title="Organization audit" subtitle="Sensitive operational actions recorded for this customer tenant." icon={<Shield className="h-5 w-5"/>}><div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="border-b text-xs uppercase text-slate-500"><tr><th className="p-3">Time</th><th className="p-3">Actor</th><th className="p-3">Action</th><th className="p-3">Target</th><th className="p-3">Reason</th></tr></thead><tbody>{auditEvents.map((event) => <tr key={event.id} className="border-b last:border-0"><td className="p-3 text-xs">{new Date(event.createdAt).toLocaleString()}</td><td className="p-3"><b className="block">{event.actorName}</b><span className="text-xs text-slate-500">{event.actorRole}</span></td><td className="p-3">{event.action}</td><td className="p-3">{event.entityType}</td><td className="p-3 text-xs text-slate-500">{event.reason || "—"}</td></tr>)}</tbody></table></div></Card>;

  const invoices = <Card title="Invoices" subtitle="Invoices issued by the SLMS Platform Administrator. Pay an issued invoice or download a PDF copy." icon={<Receipt className="h-5 w-5"/>}>{billing?.invoices?.length ? invoiceList(billing.invoices) : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No invoices issued yet. Invoices sent to this organization by the platform administrator will appear here.</p>}</Card>;
  const views: Record<string, ReactNode> = { dashboard: overview, communities, people, approvals, invitations, subscription, invoices, branding, audit };
  return <div className="space-y-6"><section className="rounded-2xl bg-gradient-to-r from-blue-700 to-indigo-700 p-5 text-white shadow-lg"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-blue-100">SLMS Customer Administration</p><h1 className="mt-1 text-2xl font-black sm:text-3xl">{organization?.name || "Organization Admin Portal"}</h1><p className="mt-2 text-sm text-blue-100">Manage communities, people, invitations, access, subscription usage, branding, and tenant security.</p></div>{loading && <Loader2 className="h-5 w-5 animate-spin"/>}</div></section>{error && <div className="flex flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 sm:flex-row sm:items-center sm:justify-between"><span>{error}</span><button onClick={() => void load()} className="inline-flex items-center justify-center gap-2 rounded-lg border bg-white px-3 py-2 text-xs font-bold"><RefreshCw className="h-4 w-4"/>Retry</button></div>}{notice && <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700"><span>{notice}</span><button onClick={() => setNotice("")} className="rounded-lg border bg-white px-3 py-1.5 text-xs font-bold">Dismiss</button></div>}{organization ? views[tab] || overview : !loading && !error ? <p className="text-sm text-slate-500">Organization data is unavailable.</p> : null}</div>;
}
