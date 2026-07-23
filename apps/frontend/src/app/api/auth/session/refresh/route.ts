import { NextResponse } from "next/server";
import { getSession, getSupabaseTokens, setSupabaseTokens } from "@/lib/auth";
import { refreshSupabaseSession } from "@/lib/supabaseAuth";

export async function POST() {
  const session = await getSession();
  const { refreshToken } = await getSupabaseTokens();
  if (!session || !refreshToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const refreshed = await refreshSupabaseSession(refreshToken);
    if (session.authUserId && refreshed.user.id !== session.authUserId) return NextResponse.json({ error: "Identity mismatch" }, { status: 403 });
    await setSupabaseTokens(refreshed.access_token, refreshed.refresh_token, refreshed.expires_in);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Session refresh failed" }, { status: 401 });
  }
}