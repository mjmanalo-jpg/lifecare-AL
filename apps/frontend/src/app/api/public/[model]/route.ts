import { NextRequest, NextResponse } from "next/server";
import { getModel, isDbConfigured } from "@/lib/models";
import { DEMO } from "@/lib/demoData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public (unauthenticated) read-only API for CMS models that the landing page
 * needs to render without requiring a login session.
 *
 * Only the models in PUBLIC_MODELS are accessible here. Everything else 401s.
 *
 *   GET /api/public/[model]?f_published=true
 */
const PUBLIC_MODELS = new Set(["blog-posts", "site-content", "custom-pages"]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ model: string }> }
) {
  const { model } = await params;

  if (!PUBLIC_MODELS.has(model)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const def = getModel(model);
  if (!def) {
    return NextResponse.json({ error: `Unknown model '${model}'` }, { status: 404 });
  }

  // Demo mode
  if (!isDbConfigured()) {
    let rows = DEMO[model] ?? [];
    // Apply f_ filters for demo data
    const sp = new URL(req.url).searchParams;
    sp.forEach((value, key) => {
      if (key.startsWith("f_")) {
        const field = key.slice(2);
        rows = rows.filter((r) => {
          if (value === "true") return r[field] === true;
          if (value === "false") return r[field] === false;
          return String(r[field]) === value;
        });
      }
    });
    return NextResponse.json({ data: rows, demo: true });
  }

  try {
    const sp = new URL(req.url).searchParams;
    const take = Math.min(Math.max(Number(sp.get("take") ?? 100), 1), 500);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {};
    sp.forEach((value, key) => {
      if (key.startsWith("f_")) {
        const field = key.slice(2);
        if (value === "true" || value === "false") where[field] = value === "true";
        else if (value === "null") where[field] = null;
        else where[field] = value;
      }
    });

    const data = await def.delegate.findMany({
      where: { AND: [where, { organizationId: null, communityId: null }] },
      orderBy: def.orderBy,
      take,
    });
    return NextResponse.json({ data, count: data.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
