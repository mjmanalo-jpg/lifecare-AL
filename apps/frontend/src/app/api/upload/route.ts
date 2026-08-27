import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { requireTenantContext } from "@/lib/tenant";
import { uploadToBucket } from "@/lib/supabaseStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BYTES = 10 * 1024 * 1024;
const FOLDERS = new Set(["staff", "avatars", "documents", "resident-documents", "face-enrollment"]);

// Uploads go to a PRIVATE Supabase Storage bucket (durable + access-controlled),
// not the local/serverless filesystem. The returned `url` points at the auth-gated
// /api/files route, which resolves it to a short-lived signed URL on demand.
export async function POST(request: NextRequest) {
  const context = await requireTenantContext({ requireCommunity: true, allowPlatform: true });
  if (!context?.organizationId || !context.communityId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const form = await request.formData();
    const file = form.get("file") as File | null;
    const requested = String(form.get("folder") || "documents").split(/[\\/]/).pop() || "documents";
    const folder = FOLDERS.has(requested) ? requested : "documents";
    if (!file || file.size <= 0 || file.size > MAX_BYTES) return NextResponse.json({ error: "File must be between 1 byte and 10 MB" }, { status: 413 });
    const extension = path.extname(file.name).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 10) || ".bin";
    const fileName = `${crypto.randomUUID()}${extension}`;
    const objectPath = `${context.organizationId}/${context.communityId}/${folder}/${fileName}`;
    await uploadToBucket(objectPath, Buffer.from(await file.arrayBuffer()), file.type);
    return NextResponse.json({ url: `/api/files/${objectPath}`, name: path.basename(file.name), type: file.type, size: file.size });
  } catch (error) {
    console.error("Upload failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
