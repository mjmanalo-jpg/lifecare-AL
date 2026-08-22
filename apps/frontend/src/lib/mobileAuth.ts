// Company + mobile-number login helpers (huma-style).
//
// Users sign in with their company name + registered mobile number + password.
// Mobiles are compared in a canonical form so "0917 123 4567", "+639171234567"
// and "639171234567" all match the same account. Pure + unit-tested; the route
// (/api/auth/mobile-login) does the DB lookup + session issue.

/** Canonical mobile: digits only, last 10 (drops 0 / 63 / +63 country prefix). */
export function normalizeMobile(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.slice(-10);
}

/** Two mobile numbers refer to the same line (canonical, min 7 digits). */
export function mobilesMatch(a: string, b: string): boolean {
  const na = normalizeMobile(a);
  return na.length >= 7 && na === normalizeMobile(b);
}

export type LoginPortal = "EMPLOYEE" | "FAMILY";

/** Client-facing roles (the Family/Resident portal); everything else is staff. */
const CLIENT_ROLES = new Set(["FAMILY", "RESIDENT"]);

/** Does this account's role belong to the chosen login portal? */
export function roleMatchesPortal(role: string, portal: LoginPortal): boolean {
  const isClient = CLIENT_ROLES.has(String(role ?? "").toUpperCase());
  return portal === "FAMILY" ? isClient : !isClient;
}
