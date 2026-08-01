// ─────────────────────────────────────────────────────────────
// Billing & Finance — feature switches
//
// Online payments require a live third-party gateway (PayMongo / Stripe).
// The full flow is IMPLEMENTED but intentionally kept OFF until the client
// confirms the provider to use. Flip ONLINE_PAYMENTS_ENABLED to true (and set
// the provider env keys documented in lib/payments.ts) to activate it.
// ─────────────────────────────────────────────────────────────

/** Master switch for the online (card / e-wallet) payment gateway. */
export const ONLINE_PAYMENTS_ENABLED = false;

/** Provider(s) wired behind the gateway — shown in the pending-activation notice. */
export const ONLINE_PAYMENT_PROVIDER_LABEL = "PayMongo / Stripe";
