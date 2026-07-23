import { NextResponse } from "next/server";
import { getSession, getSupabaseTokens, setSupabaseTokens } from "@/lib/auth";
import { getSupabaseIdentity, refreshSupabaseSession } from "@/lib/supabaseAuth";

export async function GET() {
  const session = await getSession();
  if (!session?.authUserId || !session.activeCommunityId) return NextResponse.json({ error: "Realtime unavailable" }, { status: 409 });
  let { accessToken, refreshToken } = await getSupabaseTokens();
  try {
    if (!accessToken && refreshToken) {
      const refreshed = await refreshSupabaseSession(refreshToken);
      accessToken = refreshed.access_token; refreshToken = refreshed.refresh_token;
      await setSupabaseTokens(accessToken, refreshToken, refreshed.expires_in);
    }
    if (!accessToken) throw new Error("missing token");
    const identity = await getSupabaseIdentity(accessToken);
    if (identity.id !== session.authUserId) throw new Error("identity mismatch");
    return NextResponse.json({ accessToken, communityId: session.activeCommunityId }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Realtime authentication failed" }, { status: 401 });
  }
}