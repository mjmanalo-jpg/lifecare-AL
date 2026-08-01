"use client";

import Link from "next/link";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, Building2, CheckCircle2, CircleDollarSign, Database,
  Gauge, KeyRound, Loader2, Mail, Plus, RefreshCw, ServerCog, Shield, ShieldCheck,
  Users, XCircle,
} from "lucide-react";
import SaasPlatformConsole from "@/components/portal/views/superadmin/SaasPlatformConsole";

interface Plan {
  id: string; key: string; name: string; description?: string | null;
  maxCommunities?: number | null; maxActiveResidents?: number | null;
  maxStaffSeats?: number | null; maxStorageBytes?: string | null;
  entitlements?: { id: string; featureKey: string; enabled: boolean; limit?: number | null }[];
}
interface Organization {
  id: string; name: string; status: string;
  subscription?: { status: string; plan: Plan } | null;
  _count: { communities: number; residents: number; staff: number };
}
interface Insights {
  deniedLast24Hours: number;
  generatedAt: string;
  invitations: { id: string; email: string; status: string; organizationRole?: string | null; communityRole?: string | null; expiresAt: string; organization: { id: string; name: string }; community?: { id: string; name: string } | null }[];
  platformUsers: { id: string; name: string; email: string; platformRole?: string | null; isActive: boolean; lastLogin?: string | null }[];
  auditEvents: { id: string; actorName: string; actorRole: string; action: string; entityType: string; entityId: string; ipAddress?: string | null; reason?: string | null; createdAt: string }[];
  usageSnapshots: { id: string; organizationId: string; metric: string; value: string; periodEnd: string }[];
  health: Record<string, string>;
}

const emptyInsights: Insights = { deniedLast24Hours: 0, generatedAt: "", invitations: [], platformUsers: [], auditEvents: [], usageSnapshots: [], health: {} };

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
    const response = await fetch("/api/platform/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: data.get("key"), name: data.get("name"), description: data.get("description"), maxCommunities: numberOrNull("maxCommunities"), maxActiveResidents: numberOrNull("maxActiveResidents"), maxStaffSeats: numberOrNull("maxStaffSeats") }) });
    if (response.ok) { form.reset(); await load(); } else setError((await response.json()).error || "Plan creation failed");
    setCreatingPlan(false);
  }

  const overview = <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Customer organizations" value={organizations.length} icon={<Building2 className="h-5 w-5"/>}/><Stat label="Active communities" value={totals.communities} icon={<Activity className="h-5 w-5"/>} tone="emerald"/><Stat label="Pending invitations" value={pendingInvitations} icon={<Mail className="h-5 w-5"/>} tone="amber"/><Stat label="Capacity warnings" value={limitWarnings} icon={<AlertTriangle className="h-5 w-5"/>} tone={limitWarnings ? "rose" : "emerald"}/></div>
    <Panel title="Control-plane overview" subtitle="Customer metadata and SaaS operations only; resident clinical records remain outside this portal." icon={<Gauge className="h-5 w-5"/>}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{[
        ["Customer Workspaces", `${organizations.filter((item) => item.status === "ACTIVE").length} active customers`, "/platform_admin/workspaces"],
        ["Plans & Entitlements", `${plans.length} configurable plans`, "/platform_admin/plans"],
        ["Security & Audit", `${insights.deniedLast24Hours} denied events in 24h`, "/platform_admin/security"],
        ["System Health", `${Object.values(insights.health).filter((value) => ["OPERATIONAL", "CONFIGURED"].includes(value)).length}/${Object.keys(insights.health).length || 5} services ready`, "/platform_admin/health"],
      ].map(([name, detail, route]) => <Link key={name} href={route} className="rounded-xl border border-slate-200 p-4 transition hover:border-indigo-300 hover:bg-indigo-50"><strong className="text-sm text-slate-900">{name}</strong><p className="mt-1 text-xs text-slate-500">{detail}</p></Link>)}</div>
    </Panel>
  </div>;

  const planView = <div className="space-y-5"><Panel title="Create subscription plan" subtitle="Commercial limits are configurable and enforced by server-side entitlements." icon={<Plus className="h-5 w-5"/>}>
    <form onSubmit={createPlan} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"><input required name="key" placeholder="Plan key (e.g. GROWTH)" className="rounded-lg border px-3 py-2 text-sm"/><input required name="name" placeholder="Plan name" className="rounded-lg border px-3 py-2 text-sm"/><input name="description" placeholder="Description" className="rounded-lg border px-3 py-2 text-sm"/><input type="number" min="1" name="maxCommunities" placeholder="Community limit" className="rounded-lg border px-3 py-2 text-sm"/><input type="number" min="1" name="maxActiveResidents" placeholder="Resident limit" className="rounded-lg border px-3 py-2 text-sm"/><input type="number" min="1" name="maxStaffSeats" placeholder="Staff-seat limit" className="rounded-lg border px-3 py-2 text-sm"/><button disabled={creatingPlan} className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{creatingPlan && <Loader2 className="h-4 w-4 animate-spin"/>}Create plan</button></form>
  </Panel><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{plans.map((plan) => <article key={plan.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between"><div><h3 className="font-bold text-slate-900">{plan.name}</h3><code className="text-xs text-indigo-600">{plan.key}</code></div><CircleDollarSign className="h-5 w-5 text-indigo-500"/></div><p className="mt-2 min-h-8 text-xs text-slate-500">{plan.description || "No description"}</p><div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><span className="rounded-lg bg-slate-50 p-2"><b className="block">{plan.maxCommunities ?? "∞"}</b>Communities</span><span className="rounded-lg bg-slate-50 p-2"><b className="block">{plan.maxActiveResidents ?? "∞"}</b>Residents</span><span className="rounded-lg bg-slate-50 p-2"><b className="block">{plan.maxStaffSeats ?? "∞"}</b>Staff</span></div><p className="mt-3 text-xs text-slate-500">{plan.entitlements?.filter((item) => item.enabled).length || 0} enabled module entitlements</p></article>)}</div></div>;

  const usageView = <Panel title="Usage and capacity" subtitle="Current database counts compared with each customer’s assigned plan." icon={<Gauge className="h-5 w-5"/>}><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b text-xs uppercase text-slate-500"><tr><th className="p-3">Customer</th><th className="p-3">Plan</th><th className="p-3">Communities</th><th className="p-3">Residents</th><th className="p-3">Staff</th><th className="p-3">Status</th></tr></thead><tbody>{organizations.map((organization) => { const plan = organization.subscription?.plan; const atLimit = Boolean((plan?.maxCommunities && organization._count.communities >= plan.maxCommunities) || (plan?.maxActiveResidents && organization._count.residents >= plan.maxActiveResidents) || (plan?.maxStaffSeats && organization._count.staff >= plan.maxStaffSeats)); return <tr key={organization.id} className="border-b last:border-0"><td className="p-3 font-semibold text-slate-900">{organization.name}</td><td className="p-3">{plan?.name || "Unassigned"}</td><td className="p-3">{organization._count.communities} / {plan?.maxCommunities ?? "∞"}</td><td className="p-3">{organization._count.residents} / {plan?.maxActiveResidents ?? "∞"}</td><td className="p-3">{organization._count.staff} / {plan?.maxStaffSeats ?? "∞"}</td><td className="p-3">{atLimit ? <Badge value="LIMIT WARNING"/> : <Badge value="ACTIVE"/>}</td></tr>; })}</tbody></table></div></Panel>;

  const accessView = <div className="grid gap-5 xl:grid-cols-2"><Panel title="Customer invitations" subtitle="Tenant-bound invitations and their current lifecycle state." icon={<Mail className="h-5 w-5"/>}><div className="space-y-2">{insights.invitations.slice(0, 12).map((invitation) => <div key={invitation.id} className="flex items-center justify-between gap-3 rounded-xl border p-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{invitation.email}</p><p className="truncate text-xs text-slate-500">{invitation.organization.name} · {invitation.organizationRole || invitation.communityRole}</p></div><Badge value={invitation.status}/></div>)}{!insights.invitations.length && <p className="text-sm text-slate-500">No invitations found.</p>}</div></Panel><Panel title="Platform access" subtitle="Accounts with platform-wide control-plane roles." icon={<KeyRound className="h-5 w-5"/>}><div className="space-y-2">{insights.platformUsers.map((user) => <div key={user.id} className="flex items-center justify-between gap-3 rounded-xl border p-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{user.name}</p><p className="truncate text-xs text-slate-500">{user.email} · {user.platformRole}</p></div><Badge value={user.isActive ? "ACTIVE" : "SUSPENDED"}/></div>)}</div></Panel></div>;

  const securityView = <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-3"><Stat label="Denied events (24h)" value={insights.deniedLast24Hours} icon={<Shield className="h-5 w-5"/>} tone={insights.deniedLast24Hours ? "rose" : "emerald"}/><Stat label="Audit events loaded" value={insights.auditEvents.length} icon={<Database className="h-5 w-5"/>}/><Stat label="Platform accounts" value={insights.platformUsers.length} icon={<Users className="h-5 w-5"/>}/></div><Panel title="Platform audit activity" subtitle="Safe operational metadata only; before/after payloads and resident PHI are not displayed." icon={<ShieldCheck className="h-5 w-5"/>}><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="border-b text-xs uppercase text-slate-500"><tr><th className="p-3">Time</th><th className="p-3">Actor</th><th className="p-3">Action</th><th className="p-3">Target</th><th className="p-3">IP</th></tr></thead><tbody>{insights.auditEvents.map((event) => <tr key={event.id} className="border-b last:border-0"><td className="p-3 text-xs">{new Date(event.createdAt).toLocaleString()}</td><td className="p-3"><b className="block">{event.actorName}</b><span className="text-xs text-slate-500">{event.actorRole}</span></td><td className="p-3"><Badge value={event.action}/></td><td className="p-3">{event.entityType}</td><td className="p-3 text-xs text-slate-500">{event.ipAddress || "Not recorded"}</td></tr>)}</tbody></table></div></Panel></div>;

  const healthView = <Panel title="Platform service health" subtitle="Configuration readiness from the current application environment. This is not an external uptime monitor." icon={<Activity className="h-5 w-5"/>} action={<button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold"><RefreshCw className="h-4 w-4"/>Refresh</button>}><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Object.entries(insights.health).map(([service, status]) => <div key={service} className="flex items-center justify-between rounded-xl border p-4"><div className="flex items-center gap-3">{["OPERATIONAL", "CONFIGURED"].includes(status) ? <CheckCircle2 className="h-5 w-5 text-emerald-500"/> : <XCircle className="h-5 w-5 text-rose-500"/>}<span className="text-sm font-semibold capitalize text-slate-900">{service.replaceAll(/([A-Z])/g, " $1")}</span></div><Badge value={status}/></div>)}</div></Panel>;

  const settingsView = <div className="grid gap-5 xl:grid-cols-2"><Panel title="Security defaults" subtitle="Required control-plane safeguards." icon={<ShieldCheck className="h-5 w-5"/>}><div className="space-y-3">{["Privileged MFA enforcement", "Tenant-aware authorization", "Platform audit recording", "Resident PHI excluded from control plane"].map((item) => <div key={item} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm"><span>{item}</span><Badge value="ACTIVE"/></div>)}</div></Panel><Panel title="Platform configuration" subtitle="Environment-managed settings are changed through deployment configuration, not exposed as browser secrets." icon={<ServerCog className="h-5 w-5"/>}><div className="space-y-3">{["Shared product domain", "Invitation email provider", "Supabase authentication", "Database and Realtime endpoints"].map((item) => <div key={item} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm"><span>{item}</span><Badge value="CONFIGURED"/></div>)}</div><p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Secrets, CORS origins, retention, and vendor agreements remain deployment-controlled. No secret values are shown in this portal.</p></Panel></div>;

  const views: Record<string, ReactNode> = { dashboard: overview, workspaces: <SaasPlatformConsole/>, plans: planView, usage: usageView, access: accessView, security: securityView, health: healthView, platformsettings: settingsView };
  return <div className="space-y-6"><section className="rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-700 to-indigo-700 p-5 text-white shadow-lg"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-3"><div className="rounded-xl bg-white/15 p-2.5"><ShieldCheck className="h-7 w-7"/></div><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-100">SLMS SaaS Control Plane</p><h1 className="mt-1 text-2xl font-black sm:text-3xl">Platform Admin Portal</h1><p className="mt-2 max-w-3xl text-sm text-blue-100">Provision customers, govern subscriptions and access, monitor capacity, and review platform security without entering resident clinical workflows.</p></div></div>{loading && <Loader2 className="h-5 w-5 animate-spin text-blue-100"/>}</div></section>{error && <div className="flex flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 sm:flex-row sm:items-center sm:justify-between"><span>{error}</span><button onClick={() => void load()} className="inline-flex flex-none items-center justify-center gap-2 rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-bold"><RefreshCw className="h-4 w-4"/>Retry</button></div>}{views[tab] || overview}</div>;
}
