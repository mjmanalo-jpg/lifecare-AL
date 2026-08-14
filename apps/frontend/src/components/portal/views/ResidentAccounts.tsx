"use client";

import { useMemo, useState } from "react";
import { KeyRound, Search, ShieldCheck, UserRound, Users, Copy, Check, X, Loader2, RefreshCw } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

type ProvisionResult = { email: string; password: string | null; status: "created" | "reset" | "existing_unchanged" };

// Readable, strong password (client-side, secure RNG), e.g. "Care-7K3m-4820".
function genPw(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(8);
  crypto.getRandomValues(bytes);
  const p = (i: number) => alphabet[bytes[i] % alphabet.length];
  return `Care-${p(0)}${p(1)}${p(2)}${p(3)}-${p(4)}${p(5)}${p(6)}${p(7)}`;
}

/**
 * Resident & Family accounts — provision working logins for residents admitted
 * through pre-admission/admission. Pick a resident, enter the resident and/or
 * family-sponsor email, and a one-time password is generated for each (shown
 * once). They sign in with email + that password and can change it later.
 */
export default function ResidentAccounts() {
  const { data: residentRows, refetch } = useLiveQuery<Row>("residents", { query: "include=sponsor&take=500", tables: ["Resident"] });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);

  const residents = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (residentRows || [])
      .filter((r) => {
        if (!q) return true;
        const name = `${s(r.firstName)} ${s(r.lastName)}`.toLowerCase();
        return name.includes(q) || s(r.roomNumber).toLowerCase().includes(q) || s(r.email).toLowerCase().includes(q);
      })
      .sort((a, b) => `${s(a.firstName)} ${s(a.lastName)}`.localeCompare(`${s(b.firstName)} ${s(b.lastName)}`));
  }, [residentRows, query]);

  const stats = useMemo(() => {
    const all = residentRows || [];
    return {
      total: all.length,
      residentLogins: all.filter((r) => r.userId).length,
      familyLogins: all.filter((r) => r.sponsorId).length,
    };
  }, [residentRows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold text-amber-600 flex items-center gap-2"><KeyRound className="w-6 h-6" /> Resident &amp; Family Accounts</h2>
          <p className="text-sm text-gray-500 mt-0.5"><span className="text-emerald-600 font-semibold">● Live</span> Create logins for admitted residents and their family sponsors</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="Total Residents" value={stats.total} tone="slate" icon={UserRound} />
        <Stat label="Resident Logins" value={stats.residentLogins} tone="amber" icon={ShieldCheck} />
        <Stat label="Family Logins" value={stats.familyLogins} tone="emerald" icon={Users} />
      </div>

      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search residents by name or room…"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none"
        />
      </div>

      {residents.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">No residents found. Residents appear here after admission.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {residents.map((r) => {
            const hasResident = !!r.userId;
            const hasSponsor = !!r.sponsorId;
            const sponsor = (r.sponsor as Row | null) || null;
            return (
              <button
                key={s(r.id)}
                onClick={() => setSelected(r)}
                className="text-left rounded-2xl border border-gray-200 bg-white p-4 hover:border-amber-300 hover:shadow-sm transition flex items-start gap-3"
              >
                <span className="h-11 w-11 shrink-0 rounded-full bg-amber-500 text-white flex items-center justify-center font-bold">
                  {(`${s(r.firstName).charAt(0)}${s(r.lastName).charAt(0)}`).toUpperCase() || "?"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-gray-900 truncate">{s(r.firstName)} {s(r.lastName)}</p>
                  <p className="text-xs text-gray-500">{r.roomNumber ? `Room ${s(r.roomNumber)}` : "No room"}{r.careLevel ? ` · ${s(r.careLevel)}` : ""}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge on={hasResident} onText="Resident login" offText="No resident login" />
                    <Badge on={hasSponsor} onText={`Family: ${s(sponsor?.email) || "linked"}`} offText="No family login" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <AccountModal resident={selected} onClose={() => setSelected(null)} onDone={() => { setSelected(null); void refetch(); }} />
      )}
    </div>
  );
}

function Badge({ on, onText, offText }: { on: boolean; onText: string; offText: string }) {
  return on ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"><Check className="w-3 h-3" /> {onText}</span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-gray-100 border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-500">{offText}</span>
  );
}

function Stat({ label, value, tone, icon: Icon }: { label: string; value: number; tone: "slate" | "amber" | "emerald"; icon: typeof KeyRound }) {
  const tones = { slate: "text-slate-700", amber: "text-amber-600", emerald: "text-emerald-600" } as const;
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 flex items-center justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
        <p className={`text-3xl font-extrabold ${tones[tone]}`}>{value}</p>
      </div>
      <Icon className={`w-8 h-8 ${tones[tone]} opacity-30`} />
    </div>
  );
}

function AccountModal({ resident, onClose, onDone }: { resident: Row; onClose: () => void; onDone: () => void }) {
  const sponsor = (resident.sponsor as Row | null) || null;
  const [residentEmail, setResidentEmail] = useState(s(resident.email));
  const [sponsorName, setSponsorName] = useState(s(sponsor?.name));
  const [sponsorEmail, setSponsorEmail] = useState(s(sponsor?.email));
  const [password, setPassword] = useState("");
  const [reset, setReset] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ resident: ProvisionResult | null; sponsor: ProvisionResult | null } | null>(null);

  const name = `${s(resident.firstName)} ${s(resident.lastName)}`.trim() || "Resident";
  const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none text-sm";

  const submit = async () => {
    if (!residentEmail.trim() && !sponsorEmail.trim()) { Swal.fire({ title: "Enter a resident or family email", icon: "warning" }); return; }
    if (password && password.length < 6) { Swal.fire({ title: "Password must be at least 6 characters", icon: "warning" }); return; }
    setSaving(true);
    try {
      // Same password applies to BOTH the resident and sponsor logins.
      const res = await fetch("/api/accounts/provision", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ residentId: s(resident.id), residentEmail: residentEmail.trim(), sponsorName: sponsorName.trim(), sponsorEmail: sponsorEmail.trim(), residentPassword: password, sponsorPassword: password, reset }),
      });
      const j = await res.json();
      if (!res.ok) { Swal.fire({ title: "Could not create accounts", text: j?.error || "Provisioning failed.", icon: "error" }); return; }
      setResult(j);
    } catch {
      Swal.fire({ title: "Network error", text: "Please try again.", icon: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden">
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="h-10 w-10 shrink-0 rounded-full bg-white/15 ring-1 ring-white/20 flex items-center justify-center font-bold text-sm">{(`${s(resident.firstName).charAt(0)}${s(resident.lastName).charAt(0)}`).toUpperCase() || "?"}</span>
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-white truncate">{name}</h3>
              <p className="text-slate-300 text-xs truncate">{resident.roomNumber ? `Room ${s(resident.roomNumber)} · ` : ""}Set up logins</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {result ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                Accounts ready. Share these one-time passwords — they can be changed after first sign-in.
              </div>
              {result.resident && <CredCard title="Resident login" res={result.resident} />}
              {result.sponsor && <CredCard title="Family sponsor login" res={result.sponsor} />}
              {!result.resident && !result.sponsor && <p className="text-sm text-gray-500">No accounts were created.</p>}
              <button onClick={onDone} className="w-full px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold">Done</button>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
                Set or generate one login password — it works for <b>both</b> the resident and sponsor. No email is sent: copy each email + the password and share it directly. The resident login is optional.
              </div>

              <div className="space-y-3">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-500 flex items-center gap-1.5"><UserRound className="w-3.5 h-3.5 text-amber-600" /> Resident login (optional)</p>
                <label className="block">
                  <span className="block text-xs font-semibold text-gray-600 mb-1">Resident Email</span>
                  <input className={inputCls} type="email" value={residentEmail} onChange={(e) => setResidentEmail(e.target.value)} placeholder="resident@example.com" />
                </label>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-500 flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-amber-600" /> Family sponsor</p>
                <label className="block">
                  <span className="block text-xs font-semibold text-gray-600 mb-1">Sponsor Name</span>
                  <input className={inputCls} value={sponsorName} onChange={(e) => setSponsorName(e.target.value)} placeholder="Jane Doe" />
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold text-gray-600 mb-1">Sponsor Email</span>
                  <input className={inputCls} type="email" value={sponsorEmail} onChange={(e) => setSponsorEmail(e.target.value)} placeholder="family@example.com" />
                </label>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-500 flex items-center gap-1.5"><KeyRound className="w-3.5 h-3.5 text-amber-600" /> Login password (both accounts)</p>
                <div className="flex gap-2">
                  <input className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Set a password — or click Generate" />
                  <button type="button" onClick={() => setPassword(genPw())} className="shrink-0 inline-flex items-center gap-1 px-3 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 text-xs font-semibold whitespace-nowrap"><RefreshCw className="w-3.5 h-3.5" /> Generate</button>
                </div>
                <p className="text-[11px] text-gray-400">Min 6 characters. Used for both the resident and sponsor. Leave blank to auto-generate.</p>
              </div>

              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} className="rounded border-gray-300 text-amber-500 focus:ring-amber-400" />
                <RefreshCw className="w-3.5 h-3.5 text-gray-400" /> Re-issue a new password if an account already exists
              </label>
            </>
          )}
        </div>

        {!result && (
          <div className="border-t border-gray-100 px-6 py-4 flex items-center justify-end gap-2 bg-gray-50">
            <button onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 text-sm font-medium disabled:opacity-50">Cancel</button>
            <button onClick={submit} disabled={saving} className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold shadow-sm disabled:opacity-50">
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : <><KeyRound className="w-4 h-4" /> Create accounts</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CredCard({ title, res }: { title: string; res: ProvisionResult }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${res.email} / ${res.password ?? ""}`); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };
  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">{title}</p>
        {res.status === "existing_unchanged" && <span className="text-[11px] font-semibold text-amber-600">Existing account · password unchanged</span>}
        {res.status === "reset" && <span className="text-[11px] font-semibold text-emerald-600">Password re-issued</span>}
      </div>
      <p className="mt-2 text-sm text-gray-900"><span className="text-gray-500">Email:</span> <span className="font-semibold">{res.email}</span></p>
      {res.password ? (
        <div className="mt-1 flex items-center gap-2">
          <code className="flex-1 rounded-lg bg-gray-100 px-3 py-2 text-sm font-mono text-gray-900 select-all">{res.password}</code>
          <button onClick={copy} className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-xs font-semibold">
            {copied ? <><Check className="w-3.5 h-3.5 text-emerald-600" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
          </button>
        </div>
      ) : (
        <p className="mt-1 text-xs text-gray-500">This email already has a login — tick &quot;Re-issue a new password&quot; to reset it.</p>
      )}
    </div>
  );
}
