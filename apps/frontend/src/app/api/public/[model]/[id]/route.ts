import { NextRequest, NextResponse } from "next/server";
import { getModel, isDbConfigured } from "@/lib/models";
import { DEMO } from "@/lib/demoData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public (unauthenticated) read-only single-record API for CMS models.
 * Only the models in PUBLIC_MODELS are accessible here.
 *
 *   GET /api/public/[model]/[id]
 */
const PUBLIC_MODELS = new Set(["blog-posts", "site-content", "custom-pages"]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ model: string; id: string }> }
) {
  const { model, id } = await params;

  if (!PUBLIC_MODELS.has(model)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const def = getModel(model);
  if (!def) {
    return NextResponse.json({ error: `Unknown model '${model}'` }, { status: 404 });
  }

  // Demo mode
  if (!isDbConfigured()) {
    const row = (DEMO[model] ?? []).find((r) => r.id === id);
    return row
      ? NextResponse.json({ data: row, demo: true })
      : NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const data = await def.delegate.findUnique({ where: { id } });
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
