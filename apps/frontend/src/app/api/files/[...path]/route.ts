import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/tenant";
import { signedFileUrl } from "@/lib/supabaseStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Auth-gated access to private-bucket uploads. Object paths are
// `<org>/<community>/<folder>/<file>`; a caller may only read files in their own
// org+community (platform admins bypass). Resolves to a short-lived signed URL.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const context = await requireTenantContext({ requireCommunity: true, allowPlatform: true });
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { path } = await params;
  const parts = (path || []).filter((p) => p && p !== "." && p !== "..");
  if (parts.length < 3) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [org, community] = parts;
  if (!context.isPlatform && (org !== context.organizationId || community !== context.communityId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const signed = await signedFileUrl(parts.join("/"), 300);
  if (!signed) return NextResponse.json({ error: "File not found" }, { status: 404 });
  return NextResponse.redirect(signed);
}
