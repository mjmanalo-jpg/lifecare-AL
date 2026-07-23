interface SupabaseIdentity {
  id: string;
  email: string;
  aal?: string;
  factors?: SupabaseMfaFactor[];
}

interface SupabaseMfaFactor {
  id: string;
  factor_type: string;
  status: "verified" | "unverified";
  friendly_name?: string;
}

interface SupabaseTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email?: string; aal?: string };
}

function configuration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey || url.includes("[") || anonKey.includes("[")) return null;
  return { url, anonKey };
}

export function isSupabaseAuthConfigured(): boolean {
  return Boolean(configuration());
}

async function authRequest(path: string, init: RequestInit, key?: string) {
  const config = configuration();
  if (!config) throw new Error("Supabase Auth is not configured");
  const response = await fetch(`${config.url}/auth/v1${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: key || config.anonKey,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.msg === "string" ? body.msg : typeof body?.message === "string" ? body.message : "Authentication failed";
    throw new Error(message);
  }
  return body;
}

export async function signInWithSupabase(email: string, password: string): Promise<SupabaseTokenResponse> {
  return authRequest("/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  }) as Promise<SupabaseTokenResponse>;
}

export async function refreshSupabaseSession(refreshToken: string): Promise<SupabaseTokenResponse> {
  return authRequest("/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  }) as Promise<SupabaseTokenResponse>;
}

export async function updateSupabasePassword(accessToken: string, password: string): Promise<void> {
  await authRequest("/user", {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ password }),
  });
}

export async function signOutSupabase(accessToken: string): Promise<void> {
  await authRequest("/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: "{}",
  });
}

export async function getSupabaseIdentity(accessToken: string): Promise<SupabaseIdentity> {
  const user = await authRequest("/user", {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return { id: user.id, email: String(user.email || "").toLowerCase(), aal: user.aal, factors: Array.isArray(user.factors) ? user.factors : [] };
}

export async function sendSupabaseInvitation(email: string, redirectTo: string): Promise<void> {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("Supabase invitation delivery is not configured. Set SUPABASE_SERVICE_ROLE_KEY and restart the application.");
  await authRequest("/invite", {
    method: "POST",
    body: JSON.stringify({ email, redirect_to: redirectTo }),
    headers: { Authorization: `Bearer ${serviceKey}` },
  }, serviceKey);
}
export async function enrollTotpFactor(accessToken: string, friendlyName = "LifeCare CMS") {
  return authRequest("/factors", { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ factor_type: "totp", friendly_name: friendlyName }) });
}

export async function unenrollMfaFactor(accessToken: string, factorId: string) {
  return authRequest(`/factors/${encodeURIComponent(factorId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
}

export async function challengeTotpFactor(accessToken: string, factorId: string) {
  return authRequest(`/factors/${encodeURIComponent(factorId)}/challenge`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: "{}" });
}

export async function verifyTotpFactor(accessToken: string, factorId: string, challengeId: string, code: string) {
  return authRequest(`/factors/${encodeURIComponent(factorId)}/verify`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ challenge_id: challengeId, code }) });
}
