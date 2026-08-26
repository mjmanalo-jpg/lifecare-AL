"use client";

import { FormEvent, useEffect, useState } from "react";
import { Building2, CircleDollarSign, Loader2, Plus, Settings2, ShieldAlert, X } from "lucide-react";

interface Plan { id: string; name: string; maxCommunities?: number | null; maxActiveResidents?: number | null }
interface Organization { id: string; name: string; status: string; subscription?: { status: string; plan: Plan }; _count: { communities: number; residents: number; staff: number } }

const SUB_STATUSES = ["ACTIVE", "TRIALING", "PAST_DUE", "SUSPENDED", "CANCELED"] as const;

export default function SaasPlatformConsole() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [manageOrg, setManageOrg] = useState<Organization | null>(null);
  const [subPlanId, setSubPlanId] = useState("");
  const [subStatus, setSubStatus] = useState<string>("ACTIVE");
  const [savingSub, setSavingSub] = useState(false);

  async function load() {
    const [organizationsResponse, plansResponse] = await Promise.all([fetch("/api/platform/organizations", { cache: "no-store" }), fetch("/api/platform/plans", { cache: "no-store" })]);
    if (organizationsResponse.ok) setOrganizations((await organizationsResponse.json()).organizations || []);
    if (plansResponse.ok) setPlans((await plansResponse.json()).plans || []);
  }
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch("/api/platform/organizations", { cache: "no-store" }),
      fetch("/api/platform/plans", { cache: "no-store" }),
    ]).then(async ([organizationsResponse, plansResponse]) => {
      if (cancelled) return;
      if (organizationsResponse.ok) setOrganizations((await organizationsResponse.json()).organizations || []);
      if (plansResponse.ok) setPlans((await plansResponse.json()).plans || []);
    });
    return () => { cancelled = true; };
  }, []);

  async function provision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true); setError("");
    const data = new FormData(form);
    const response = await fetch("/api/platform/organizations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: data.get("name"), ownerEmail: data.get("ownerEmail"), planId: data.get("planId"), community: { name: data.get("communityName"), timezone: data.get("timezone") } }) });
    const body = await response.json();
    if (!response.ok) setError(body.error || "Provisioning failed");
    else { setOpen(false); form.reset(); await load(); }
    setBusy(false);
  }

  function openManage(organization: Organization) {
    setManageOrg(organization);
    setSubPlanId(organization.subscription?.plan.id || plans[0]?.id || "");
    setSubStatus(organization.subscription?.status || "ACTIVE");
    setError("");
  }
  async function saveSubscription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manageOrg) return;
    setSavingSub(true); setError("");
    const response = await fetch(`/api/platform/organizations/${manageOrg.id}/subscription`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: subPlanId, status: subStatus }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error || "Could not update subscription");
    else { setManageOrg(null); await load(); }
    setSavingSub(false);
  }

  return <section className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-white to-indigo-50/60 p-4 sm:p-5 shadow-sm">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="flex items-center gap-2 text-lg font-bold text-slate-900"><Building2 className="h-5 w-5 text-indigo-600" /> SaaS customer workspaces</h2><p className="mt-1 text-xs text-slate-600">Provision, license, and monitor customer organizations without opening resident records.</p></div><button onClick={() => setOpen(!open)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"><Plus className="h-4 w-4" /> New organization</button></div>
    {open && <form onSubmit={provision} className="mt-4 grid gap-3 rounded-xl border border-indigo-100 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5"><input required name="name" placeholder="Company name" className="rounded-lg border px-3 py-2 text-sm"/><input required name="communityName" placeholder="First community" className="rounded-lg border px-3 py-2 text-sm"/><input required type="email" name="ownerEmail" placeholder="Owner email" className="rounded-lg border px-3 py-2 text-sm"/><select required name="planId" className="rounded-lg border px-3 py-2 text-sm"><option value="">Select plan</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select><input type="hidden" name="timezone" value="America/New_York"/><button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin"/>}Provision</button>{error && <p className="text-sm text-red-600 sm:col-span-2 lg:col-span-5">{error}</p>}</form>}
    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{organizations.map((organization) => <article key={organization.id} className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-start justify-between gap-2"><div><h3 className="font-semibold text-slate-900">{organization.name}</h3><p className="text-xs text-slate-500">{organization.subscription?.plan.name || "No plan"}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${organization.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{organization.status}</span></div><div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-lg bg-slate-50 p-2"><strong className="block text-base text-slate-900">{organization._count.communities}</strong>Facilities</div><div className="rounded-lg bg-slate-50 p-2"><strong className="block text-base text-slate-900">{organization._count.residents}</strong>Residents</div><div className="rounded-lg bg-slate-50 p-2"><strong className="block text-base text-slate-900">{organization._count.staff}</strong>Staff</div></div><div className="mt-3 flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-xs text-slate-600">{organization.subscription ? <CircleDollarSign className="h-4 w-4 text-indigo-500"/> : <ShieldAlert className="h-4 w-4 text-amber-500"/>}{organization.subscription?.status || "Subscription missing"}</span><button onClick={() => openManage(organization)} className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50"><Settings2 className="h-3.5 w-3.5"/>{organization.subscription ? "Manage" : "Activate"}</button></div></article>)}{!organizations.length && <p className="py-6 text-sm text-slate-500">No customer organizations have been provisioned.</p>}</div>

    {manageOrg && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setManageOrg(null); }}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between"><h3 className="text-lg font-bold text-slate-900">Subscription · {manageOrg.name}</h3><button onClick={() => setManageOrg(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5"/></button></div>
        {!manageOrg.subscription && <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">This organization has no subscription, so its staff can&apos;t create records. Assign a plan and set it active to unblock them.</p>}
        <form onSubmit={saveSubscription} className="space-y-3">
          <label className="block text-xs font-semibold text-slate-600">Plan<select required value={subPlanId} onChange={(event) => setSubPlanId(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"><option value="">Select plan</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
          <label className="block text-xs font-semibold text-slate-600">Status<select value={subStatus} onChange={(event) => setSubStatus(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">{SUB_STATUSES.map((status) => <option key={status} value={status}>{status.replace("_", " ")}</option>)}</select></label>
          <p className="text-[11px] text-slate-500">Active and Trialing allow record creation. Suspended and Canceled lock the org out.</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1"><button type="button" onClick={() => setManageOrg(null)} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button disabled={savingSub || !subPlanId} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{savingSub && <Loader2 className="h-4 w-4 animate-spin"/>}Save</button></div>
        </form>
      </div>
    </div>}
  </section>;
}
