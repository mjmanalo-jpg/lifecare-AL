/**
 * 4-digit signing PIN — a personal code each user sets, entered to sign/finalise
 * data (e.g. a shift endorsement). Signing stamps the record and LOCKS it so it
 * can no longer be edited.
 *
 * Migration-free: the PIN hash is stored as an `app-setting` row keyed
 * `__pin:<userId>`. The `__` prefix is filtered out of every client-readable
 * settings endpoint, so hashes are never returned to the browser — only the
 * dedicated /api/auth/signing-pin route (server-side) ever reads them.
 */

export const PIN_SETTING_PREFIX = "__pin:";

/**
 * Models whose records become immutable once signed. `lockField` is the column
 * that, when set, marks the record signed; `allowAfterLock` lists the only
 * fields still writable afterwards (e.g. a downstream acknowledgement).
 */
export const SIGN_LOCK: Record<string, { lockField: string; allowAfterLock: string[] }> = {
  "shift-reports": { lockField: "signedAt", allowAfterLock: ["acknowledgedById", "acknowledgedByName", "acknowledgedAt"] },
};

export function isFourDigitPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

// ── Client helpers ──────────────────────────────────────────────────────

/** Fetch (auto-provisioning if needed) the current user's viewable 4-digit PIN. */
export async function getSigningPin(): Promise<{ hasPin: boolean; pin?: string }> {
  try {
    const r = await fetch("/api/auth/signing-pin");
    const j = await r.json();
    return { hasPin: Boolean(j.hasPin), pin: j.pin };
  } catch { return { hasPin: false }; }
}

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; pin?: string; error?: string }> {
  try {
    const r = await fetch("/api/auth/signing-pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && j.ok !== false, pin: j.pin, error: j.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

/** Verify an entered PIN when signing/finalising data. */
export function verifySigningPin(pin: string) {
  return post({ action: "verify", pin });
}

/** Issue a fresh auto-generated PIN (replaces the old one). */
export function regenerateSigningPin() {
  return post({ action: "regenerate" });
}
