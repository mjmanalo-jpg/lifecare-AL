"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, ChevronDown } from "lucide-react";

interface Community { id: string; name: string; role: string }
interface Organization { id: string; name: string; communities: Community[] }

export default function WorkspaceSwitcher() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [active, setActive] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        const orgs = payload?.workspaces?.organizations || [];
        setOrganizations(orgs);
        const session = payload?.session;
        if (session?.activeOrganizationId && session?.activeCommunityId) setActive(`${session.activeOrganizationId}:${session.activeCommunityId}`);
      })
      .catch(() => undefined);
  }, []);

  const options = useMemo(() => organizations.flatMap((organization) => organization.communities.map((community) => ({ organization, community, value: `${organization.id}:${community.id}` }))), [organizations]);
  if (!options.length) return null;

  async function selectWorkspace(value: string) {
    const option = options.find((item) => item.value === value);
    if (!option || value === active) return;
    setBusy(true);
    const response = await fetch("/api/workspaces/select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId: option.organization.id, communityId: option.community.id }) });
    if (response.ok) window.location.assign(`/${option.community.role.toLowerCase()}/dashboard`);
    else setBusy(false);
  }

  return (
    <label className="relative flex items-center gap-2 min-w-0" aria-label="Active workspace">
      <Building2 className="h-4 w-4 shrink-0 text-blue-500" />
      <select value={active} disabled={busy} onChange={(event) => void selectWorkspace(event.target.value)} className="appearance-none max-w-[130px] sm:max-w-[220px] truncate rounded-lg border border-blue-200 bg-white/80 py-1.5 pl-2 pr-7 text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-60">
        {options.map(({ organization, community, value }) => <option key={value} value={value}>Company: {organization.name} | Community: {community.name}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3 text-gray-500" />
    </label>
  );
}
