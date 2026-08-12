"use client";

import { useEffect, useRef, useState } from "react";
import { X, KeyRound, ShieldCheck, Loader2, Eye, EyeOff, RefreshCw } from "lucide-react";
import { getSigningPin, verifySigningPin, regenerateSigningPin, isFourDigitPin } from "@/lib/signingPin";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after a successful signature (verify) — do the actual write here. */
  onSigned?: () => void | Promise<void>;
  /** "sign" verifies to finalise data; "manage" reveals / regenerates the PIN. */
  mode?: "sign" | "manage";
  title?: string;
  description?: string;
}

const box = "w-full text-center tracking-[0.6em] text-2xl font-bold rounded-lg border border-gray-300 px-3 py-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";

/**
 * Signing-PIN modal.
 * - "sign": the user types their auto-issued 4-digit PIN to finalise & lock data.
 * - "manage": shows the user their own auto-generated PIN (reveal) + regenerate.
 */
export default function SignatureModal({ open, onClose, onSigned, mode = "sign", title, description }: Props) {
  const [loading, setLoading] = useState(true);
  const [pin, setPin] = useState("");            // entered (sign mode)
  const [myPin, setMyPin] = useState("");        // the user's own PIN (manage mode)
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openTracked, setOpenTracked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // The current user's own PIN, prefetched on open so signing verifies instantly
  // (client-side compare) instead of paying a network + bcrypt round-trip per
  // attempt — that round-trip was the "delay" felt when signing off.
  const expectedRef = useRef<string>("");

  // Reset transient state the moment the modal opens (render-phase reset — the
  // React-recommended way to adjust state on a prop change, no effect cascade).
  if (open && !openTracked) { setOpenTracked(true); setPin(""); setError(""); setReveal(false); setLoading(mode === "manage"); }
  if (!open && openTracked) setOpenTracked(false);

  useEffect(() => {
    if (!open) return;
    expectedRef.current = "";
    if (mode === "manage") {
      getSigningPin().then((r) => { setMyPin(r.pin || ""); setLoading(false); });
    } else {
      // Prefetch the signer's own PIN for instant local verification + focus.
      getSigningPin().then((r) => { if (r.pin) expectedRef.current = r.pin; }).catch(() => {});
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open, mode]);

  if (!open) return null;

  const doSign = async (candidate = pin) => {
    if (busy) return;
    setError(""); setBusy(true);
    try {
      if (!isFourDigitPin(candidate)) { setError("Enter your 4-digit PIN."); return; }
      // Instant path: compare against the prefetched PIN. Fall back to the
      // server verify only if the prefetch hasn't landed yet.
      let ok: boolean;
      if (isFourDigitPin(expectedRef.current)) ok = candidate === expectedRef.current;
      else ok = (await verifySigningPin(candidate)).ok;
      if (!ok) { setError("Incorrect PIN. You can view it in Account settings."); setPin(""); inputRef.current?.focus(); return; }
      await onSigned?.();
      onClose();
    } finally { setBusy(false); }
  };

  const doRegenerate = async () => {
    setBusy(true);
    try {
      const res = await regenerateSigningPin();
      if (res.ok && res.pin) { setMyPin(res.pin); setReveal(true); }
    } finally { setBusy(false); }
  };

  const digitsOnly = (v: string) => v.replace(/\D/g, "").slice(0, 4);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between bg-[#2E4A48] px-5 py-4 text-white">
          <h3 className="flex items-center gap-2 font-bold"><KeyRound className="h-5 w-5" /> {title || (mode === "manage" ? "Your signing PIN" : "Sign & finalise")}</h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-white/15"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-3 p-5">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
          ) : mode === "manage" ? (
            <>
              <p className="text-sm text-gray-600">{description || "This is your personal 4-digit code, issued automatically. Use it to sign and finalise data. Keep it private."}</p>
              <div className="flex items-center justify-center gap-3 rounded-xl border border-gray-200 bg-gray-50 py-5">
                <span className="tracking-[0.6em] text-3xl font-black text-gray-900">{reveal ? myPin : "••••"}</span>
                <button onClick={() => setReveal((v) => !v)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-200" title={reveal ? "Hide" : "Reveal"}>{reveal ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button>
              </div>
              <button onClick={() => void doRegenerate()} disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Regenerate a new code
              </button>
            </>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); void doSign(); }} className="space-y-3">
              <p className="text-sm text-gray-600">{description || "Enter your 4-digit signing PIN to finalise and lock this record. Once signed it can no longer be edited."}</p>
              <input ref={inputRef} type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => { const v = digitsOnly(e.target.value); setPin(v); setError(""); if (v.length === 4) void doSign(v); }} className={box} placeholder="••••" />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#2E4A48] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#25403D] disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Sign
              </button>
              <p className="text-center text-xs text-gray-400">Forgot your PIN? View it under Account settings → Signing PIN.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
