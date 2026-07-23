import { NextRequest, NextResponse } from "next/server";
import { elevateSessionMfa, getSession, getSupabaseTokens, setSupabaseTokens } from "@/lib/auth";
import { challengeTotpFactor, verifyTotpFactor } from "@/lib/supabaseAuth";

export async function POST(request: NextRequest) {
  const session = await getSession();
  const { accessToken, refreshToken } = await getSupabaseTokens();
  if (!session || !accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  const factorId = String(body.factorId || "");
  const code = String(body.code || "").replace(/\s/g, "");
  if (!factorId || !/^\d{6}$/.test(code)) return NextResponse.json({ error: "Factor and six-digit code are required" }, { status: 400 });
  try {
    const challenge = await challengeTotpFactor(accessToken, factorId);
    const verified = await verifyTotpFactor(accessToken, factorId, challenge.id, code);
    if (verified.access_token) await setSupabaseTokens(verified.access_token, verified.refresh_token || refreshToken || "", verified.expires_in || 3600);
    await elevateSessionMfa(session);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Invalid verification code" }, { status: 400 });
  }
}