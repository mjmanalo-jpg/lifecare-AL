"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Check, CheckCircle, CreditCard, Loader2, Lock, ShieldCheck } from "lucide-react";

type Plan = {
  id: string; key: string; name: string; description?: string | null;
  maxCommunities?: number | null; maxActiveResidents?: number | null; maxStaffSeats?: number | null;
  modules: number; priceMonthly: number | null; currency: string; tagline: string; highlight: boolean;
};

const METHODS: [string, string][] = [["CARD", "Credit / Debit"], ["GCASH", "GCash"], ["MAYA", "Maya"], ["BANK_TRANSFER", "Bank Transfer"]];

function formatPrice(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-PH", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

export default function CheckoutPage() {
  const params = useParams();
  const router = useRouter();
  const planKey = String((params?.plan as string) || "").toUpperCase();

  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [method, setMethod] = useState("CARD");
  const [mode, setMode] = useState<"pay" | "trial">("pay");
  const [stage, setStage] = useState<"form" | "processing" | "done">("form");
  // Optional return destination (e.g. /login when the flow began at gate entry).
  // Only same-origin absolute paths are honored, to avoid open redirects.
  const [nextUrl, setNextUrl] = useState("");
  useEffect(() => {
    const candidate = new URLSearchParams(window.location.search).get("next") || "";
    if (candidate.startsWith("/") && !candidate.startsWith("//")) setNextUrl(candidate);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/public/plans", { cache: "no-store" })
      .then((response) => response.json())
      .then((json) => {
        if (cancelled) return;
        const match = (json.plans || []).find((item: Plan) => item.key === planKey) || null;
        setPlan(match);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [planKey]);

  // Demo-only checkout: no live payment provider is wired, so we simulate a
  // successful charge, then hand off to organization registration.
  const pay = () => {
    setStage("processing");
    setTimeout(() => {
      setStage("done");
      const destination = nextUrl || `/signup?plan=${encodeURIComponent(planKey)}`;
      setTimeout(() => router.push(destination), 1400);
    }, 1600);
  };

  // The 30-day free trial skips payment entirely and goes straight to
  // organization registration; billing is requested when the trial ends.
  const startTrial = () => router.push(`/signup?plan=${encodeURIComponent(planKey)}&trial=1`);

  const bullets = plan ? [
    `${plan.maxCommunities ?? "Unlimited"} ${plan.maxCommunities === 1 ? "community" : "communities"}`,
    `${plan.maxActiveResidents ?? "Unlimited"} residents`,
    `${plan.maxStaffSeats ?? "Unlimited"} staff seats`,
    plan.modules > 0 ? `${plan.modules} care modules included` : "Core clinical modules",
  ] : [];

  return (
    <main className="min-h-screen relative overflow-hidden bg-background text-foreground flex items-center justify-center p-4 md:p-8">
      <div className="absolute top-6 left-6 z-50">
        <Link href="/#plans" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-medium">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to plans
        </Link>
      </div>

      {loading ? (
        <Loader2 className="w-6 h-6 animate-spin text-[var(--lp-accent,#f59e0b)]" />
      ) : !plan ? (
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold mb-2">Plan not found</h1>
          <p className="text-muted-foreground text-sm mb-6">That plan is no longer available. Choose one from our plans page.</p>
          <Link href="/#plans" className="px-6 py-3 rounded-xl bg-foreground text-background font-semibold">View plans</Link>
        </div>
      ) : (
        <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          {/* Plan summary */}
          <div className="glass-panel rounded-3xl p-8 border border-white/5 flex flex-col">
            <span className="text-xs font-bold uppercase tracking-widest text-[var(--lp-accent,#f59e0b)] mb-2">You are subscribing to</span>
            <h1 className="text-2xl font-black tracking-tight">{plan.name}</h1>
            {plan.tagline ? <p className="mt-1 text-sm text-muted-foreground font-light">{plan.tagline}</p> : plan.description ? <p className="mt-1 text-sm text-muted-foreground font-light">{plan.description}</p> : null}
            <div className="mt-6 mb-6">
              {plan.priceMonthly !== null ? (
                <div className="flex items-baseline gap-1.5"><span className="text-4xl font-black tracking-tight">{formatPrice(plan.priceMonthly, plan.currency)}</span><span className="text-sm text-muted-foreground font-light">/ month</span></div>
              ) : (
                <span className="text-2xl font-bold">Custom pricing</span>
              )}
            </div>
            <ul className="space-y-3 flex-1">
              {bullets.map((bullet, index) => (
                <li key={index} className="flex items-center gap-3 text-sm text-muted-foreground font-light">
                  <Check className="w-4 h-4 text-[var(--lp-accent,#f59e0b)] shrink-0" /> <span>{bullet}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 pt-4 border-t border-white/5 flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="w-3.5 h-3.5 text-[var(--lp-accent,#f59e0b)]" /> Cancel anytime · 30-day money-back guarantee
            </div>
          </div>

          {/* Payment panel */}
          <div className="glass-panel rounded-3xl p-8 border border-white/5 flex flex-col">
            <AnimatePresence mode="wait">
              {stage === "done" ? (
                <motion.div key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-1 flex-col items-center justify-center text-center py-10">
                  <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center mb-4"><CheckCircle className="w-9 h-9 text-emerald-500" /></div>
                  <h2 className="text-xl font-bold">Payment successful</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{nextUrl ? "Returning you to gate entry…" : "Redirecting you to register your organization…"}</p>
                  <Loader2 className="w-5 h-5 animate-spin text-[var(--lp-accent,#f59e0b)] mt-4" />
                </motion.div>
              ) : (
                <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col flex-1">
                  {/* Choose to pay now or start the 30-day free trial. Trial hides payment. */}
                  <div className="grid grid-cols-2 gap-1 mb-5 rounded-xl bg-foreground/5 p-1">
                    <button type="button" onClick={() => setMode("trial")} className={`rounded-lg px-3 py-2 text-xs font-bold transition ${mode === "trial" ? "bg-[var(--lp-accent,#f59e0b)] text-background" : "text-muted-foreground hover:text-foreground"}`}>30-day free trial</button>
                    <button type="button" onClick={() => setMode("pay")} className={`rounded-lg px-3 py-2 text-xs font-bold transition ${mode === "pay" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>Pay monthly</button>
                  </div>

                  {mode === "trial" ? (
                    <div className="flex flex-col flex-1">
                      <div className="mb-4 flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-[var(--lp-accent,#f59e0b)]" /><h2 className="text-lg font-bold">Start your 30-day free trial</h2></div>
                      <ul className="space-y-3 mb-5">
                        {["No charge today — full access for 30 days", "Set up your organization immediately", plan.priceMonthly !== null ? `We'll ask for ${formatPrice(plan.priceMonthly, plan.currency)}/month when the trial ends` : "We'll discuss pricing before the trial ends", "Cancel anytime during the trial"].map((line, index) => (
                          <li key={index} className="flex items-center gap-3 text-sm text-muted-foreground font-light"><Check className="w-4 h-4 text-[var(--lp-accent,#f59e0b)] shrink-0" /><span>{line}</span></li>
                        ))}
                      </ul>
                      <div className="mt-auto">
                        <button onClick={startTrial} className="w-full py-4 rounded-xl font-bold bg-[var(--lp-accent,#f59e0b)] text-background hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2">Start 30-day free trial <ArrowLeft className="w-4 h-4 rotate-180" /></button>
                        <p className="text-center text-[11px] text-muted-foreground mt-3">No payment required now — you&apos;ll register your organization next.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col flex-1">
                      <div className="mb-4 flex items-center gap-2"><CreditCard className="w-5 h-5 text-[var(--lp-accent,#f59e0b)]" /><h2 className="text-lg font-bold">Payment method</h2></div>

                      <div className="grid grid-cols-2 gap-2 mb-5">
                        {METHODS.map(([value, label]) => (
                          <button key={value} type="button" onClick={() => setMethod(value)} disabled={stage === "processing"} className={`rounded-xl border px-3 py-2.5 text-xs font-semibold transition ${method === value ? "border-[var(--lp-accent,#f59e0b)] bg-[var(--lp-accent,#f59e0b)]/10 text-foreground" : "border-white/10 text-muted-foreground hover:border-white/20"}`}>{label}</button>
                        ))}
                      </div>

                      {method === "CARD" ? (
                        <div className="space-y-3 mb-5">
                          <input disabled defaultValue="4242 4242 4242 4242" className="w-full rounded-xl bg-foreground/5 border border-border px-3.5 py-3 text-sm" />
                          <div className="grid grid-cols-2 gap-3">
                            <input disabled defaultValue="12 / 30" className="w-full rounded-xl bg-foreground/5 border border-border px-3.5 py-3 text-sm" />
                            <input disabled defaultValue="123" className="w-full rounded-xl bg-foreground/5 border border-border px-3.5 py-3 text-sm" />
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground font-light mb-5 rounded-xl bg-foreground/5 p-4">In production you would be redirected to {METHODS.find(([v]) => v === method)?.[1]} to authorize this payment.</p>
                      )}

                      <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-500 flex items-center gap-2">
                        <Lock className="w-3.5 h-3.5 shrink-0" /> Demo mode — no live payment gateway is configured, so no real charge is made.
                      </div>

                      <div className="mt-auto">
                        <div className="flex items-center justify-between text-sm mb-3"><span className="text-muted-foreground">Due today</span><span className="font-bold">{plan.priceMonthly !== null ? `${formatPrice(plan.priceMonthly, plan.currency)} / month` : "Custom"}</span></div>
                        <button onClick={pay} disabled={stage === "processing"} className="w-full py-4 rounded-xl font-bold bg-foreground text-background hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-60">
                          {stage === "processing" ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing payment…</> : <>{plan.priceMonthly !== null ? `Pay ${formatPrice(plan.priceMonthly, plan.currency)}` : "Continue"} <ArrowLeft className="w-4 h-4 rotate-180" /></>}
                        </button>
                        <p className="text-center text-[11px] text-muted-foreground mt-3">{nextUrl ? "After payment you’ll return to gate entry." : "After payment you’ll register your organization."}</p>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </main>
  );
}
