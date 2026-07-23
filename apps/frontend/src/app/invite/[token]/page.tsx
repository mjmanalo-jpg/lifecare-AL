"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";

export default function AcceptInvitationPage() {
  const params = useParams<{ token: string }>();
  const [message, setMessage] = useState("Verifying your secure invitation…");
  const [done, setDone] = useState(false);

  useEffect(() => {
    async function accept() {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      if (accessToken && refreshToken) {
        const exchange = await fetch("/api/auth/exchange", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken, refreshToken, invitationToken: params.token }) });
        if (!exchange.ok) { setMessage("This invitation could not be verified."); return; }
        history.replaceState(null, "", window.location.pathname);
      }
      const response = await fetch(`/api/invitations/${params.token}/accept`, { method: "POST" });
      if (response.status === 401) { setMessage("Sign in with the invited email, then open this link again."); return; }
      if (!response.ok) { const body = await response.json(); setMessage(body.error || "This invitation is no longer valid."); return; }
      setDone(true);
      setMessage("Workspace access is ready. Redirecting…");
      setTimeout(() => window.location.assign("/account/setup-password"), 1200);
    }
    void accept();
  }, [params.token]);

  return <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6"><section className="w-full max-w-md rounded-3xl border border-blue-400/20 bg-white/5 p-8 text-center shadow-2xl"><div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/15">{done ? <CheckCircle2 className="h-7 w-7 text-emerald-400" /> : <ShieldCheck className="h-7 w-7 text-blue-400" />}</div><h1 className="text-2xl font-bold">Secure workspace invitation</h1><p className="mt-3 text-sm text-slate-300">{message}</p>{!done && message.startsWith("Verifying") && <Loader2 className="mx-auto mt-6 h-5 w-5 animate-spin text-blue-400" />} {message.startsWith("Sign in") && <Link href="/" className="mt-6 inline-flex rounded-xl bg-blue-500 px-5 py-2.5 text-sm font-semibold hover:bg-blue-400">Go to sign in</Link>}</section></main>;
}
