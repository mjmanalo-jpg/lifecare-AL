import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { requireTenantContext } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BYTES = 10 * 1024 * 1024;
const FOLDERS = new Set(["staff", "avatars", "documents", "resident-documents", "face-enrollment"]);

export async function POST(request: NextRequest) {
  const context = await requireTenantContext({ requireCommunity: true });
  if (!context?.organizationId || !context.communityId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const form = await request.formData();
    const file = form.get("file") as File | null;
    const requested = String(form.get("folder") || "documents").split(/[\\/]/).pop() || "documents";
    const folder = FOLDERS.has(requested) ? requested : "documents";
    if (!file || file.size <= 0 || file.size > MAX_BYTES) return NextResponse.json({ error: "File must be between 1 byte and 10 MB" }, { status: 413 });
    const extension = path.extname(file.name).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 10) || ".bin";
    const fileName = `${crypto.randomUUID()}${extension}`;
    const relative = path.join("uploads", context.organizationId, context.communityId, folder);
    const directory = path.resolve(process.cwd(), "public", relative);
    const publicRoot = path.resolve(process.cwd(), "public");
    if (!directory.startsWith(publicRoot + path.sep)) return NextResponse.json({ error: "Invalid upload path" }, { status: 400 });
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, fileName), Buffer.from(await file.arrayBuffer()), { flag: "wx" });
    return NextResponse.json({ url: `/${relative.replace(/\\/g, "/")}/${fileName}`, name: path.basename(file.name), type: file.type, size: file.size });
  } catch {
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}