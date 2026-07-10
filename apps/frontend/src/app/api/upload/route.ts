import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const folder = (formData.get("folder") as string) || "staff";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const ext = path.extname(file.name) || ".bin";
    const fileName = `${crypto.randomUUID()}${ext}`;
    const dir = path.join(process.cwd(), "public", "uploads", folder);

    await mkdir(dir, { recursive: true });

    const bytes = await file.arrayBuffer();
    await writeFile(path.join(dir, fileName), Buffer.from(bytes));

    const url = `/uploads/${folder}/${fileName}`;

    return NextResponse.json({ url, name: file.name, type: file.type });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 },
    );
  }
}
