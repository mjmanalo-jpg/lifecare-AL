"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, KeyRound, Loader2, ShieldCheck } from "lucide-react";

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function SetupPasswordForm() {
  const searchParams = useSearchParams();
  const next = useMemo(() => safeNext(searchParams.get("next")), [searchParams]);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [complete, setComplete] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      setError("Use at least 12 characters with uppercase, lowercase, a number, and a symbol.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/auth/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to create your password");
      setComplete(true);
      setTimeout(() => window.location.replace(next), 900);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create your password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-950">
      <section className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
          {complete ? <CheckCircle2 className="h-7 w-7 text-emerald-600" /> : <ShieldCheck className="h-7 w-7" />}
        </div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">SLMS secure onboarding</p>
        <h1 className="mt-2 text-2xl font-black">Create your account password</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">Your invitation verified your email. Set the password you will use for future SLMS sign-ins.</p>

        <form onSubmit={submit} className="mt-7 space-y-4">
          <label className="block text-sm font-semibold">
            New password
            <span className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 px-3">
              <KeyRound className="h-4 w-4 text-slate-400" />
              <input type="password" autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="min-w-0 flex-1 py-3 outline-none" />
            </span>
          </label>
          <label className="block text-sm font-semibold">
            Confirm password
            <span className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 px-3">
              <KeyRound className="h-4 w-4 text-slate-400" />
              <input type="password" autoComplete="new-password" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="min-w-0 flex-1 py-3 outline-none" />
            </span>
          </label>
          <p className="text-xs leading-5 text-slate-500">At least 12 characters, including uppercase, lowercase, a number, and a symbol.</p>
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button disabled={saving || complete} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {complete ? "Password created" : "Create password and continue"}
          </button>
        </form>
      </section>
    </main>
  );
}

export default function SetupPasswordPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-slate-950 text-white"><Loader2 className="h-7 w-7 animate-spin" /></main>}>
      <SetupPasswordForm />
    </Suspense>
  );
}
