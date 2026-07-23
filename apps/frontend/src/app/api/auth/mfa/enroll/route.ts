import { NextRequest, NextResponse } from "next/server";
import { getSession, getSupabaseTokens } from "@/lib/auth";
import { enrollTotpFactor, getSupabaseIdentity, unenrollMfaFactor } from "@/lib/supabaseAuth";

export async function POST(request: NextRequest) {
  const session = await getSession();
  const { accessToken } = await getSupabaseTokens();
  if (!session || !accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const friendlyName = String(body.friendlyName || "LifeCare CMS");
    const identity = await getSupabaseIdentity(accessToken);
    const existingFactors = (identity.factors || []).filter((factor) => factor.factor_type === "totp");
    const verifiedFactor = existingFactors.find((factor) => factor.status === "verified");
    if (verifiedFactor) {
      return NextResponse.json({ id: verifiedFactor.id, requiresVerification: true });
    }
    for (const factor of existingFactors.filter((item) => item.status === "unverified")) {
      await unenrollMfaFactor(accessToken, factor.id);
    }
    const factor = await enrollTotpFactor(accessToken, friendlyName);
    const rawQrCode = String(factor.totp?.qr_code || "").trim();
    const qrCode = rawQrCode.startsWith("data:image/")
      ? rawQrCode
      : rawQrCode.startsWith("<")
        ? `data:image/svg+xml;base64,${Buffer.from(rawQrCode, "utf8").toString("base64")}`
        : rawQrCode
          ? `data:image/svg+xml;utf-8,${rawQrCode}`
          : "";
    return NextResponse.json({ id: factor.id, qrCode, secret: factor.totp?.secret });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unable to enroll MFA";
    return NextResponse.json({ error: detail }, { status: 400 });
  }
}
