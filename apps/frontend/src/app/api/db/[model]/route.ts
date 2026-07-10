import { NextRequest, NextResponse } from "next/server";
import { getModel, isDbConfigured } from "@/lib/models";
import { getSession } from "@/lib/auth";
import { scopeWhere, scopeDemoRows } from "@/lib/scope";
import { DEMO } from "@/lib/demoData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Generic collection endpoint backed by Prisma.
 *   GET  /api/db/:model?take=100&include=resident&f_status=ACTIVE&order=asc
 *   POST /api/db/:model            (body = record to create)
 *
 * Filters: any query param prefixed `f_` becomes an equality `where` clause.
 * Includes: comma-separated relation names via `include`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildQuery(url: URL, defaultOrderBy?: Record<string, any>) {
  const sp = url.searchParams;
  const take = Math.min(Math.max(Number(sp.get("take") ?? 200), 1), 1000);

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

  const includeParam = sp.get("include");
  const include = includeParam
    ? Object.fromEntries(includeParam.split(",").map((r) => [r.trim(), true]))
    : undefined;

  const orderDir = sp.get("order");
  const orderBy =
    orderDir && defaultOrderBy
      ? Object.fromEntries(Object.keys(defaultOrderBy).map((k) => [k, orderDir]))
      : defaultOrderBy;

  return { take, where, include, orderBy };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ model: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { model } = await params;
  const def = getModel(model);
  if (!def) return NextResponse.json({ error: `Unknown model '${model}'` }, { status: 404 });

  // No real database yet → serve demo data so the UI is fully populated.
  // Self-service roles are still scoped to the demo relative so the boundary shows.
  if (!isDbConfigured()) {
    const rows = scopeDemoRows(model, DEMO[model] ?? [], session.role, session.userId);
    return NextResponse.json({ data: rows, demo: true });
  }

  try {
    const { take, where, include, orderBy } = buildQuery(new URL(req.url), def.orderBy);

    // Self-service roles (FAMILY/RESIDENT) are restricted to their own resident(s).
    // AND the scope clause into whatever filters the client requested.
    const scope = await scopeWhere(model, session);
    const scopedWhere = scope ? { AND: [where, scope] } : where;

    const data = await def.delegate.findMany({
      where: scopedWhere,
      orderBy,
      take,
      ...(include ? { include } : {}),
    });
    return NextResponse.json({ data, count: data.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ model: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = session.role;

  const { model } = await params;
  const def = getModel(model);
  if (!def) return NextResponse.json({ error: `Unknown model '${model}'` }, { status: 404 });

  // Self-service roles (FAMILY/RESIDENT) may only create the records their portal
  // legitimately produces (messages to staff, visit requests). Rest is staff-only.
  const SELF_SERVICE = role === "FAMILY" || role === "RESIDENT";
  const SELF_WRITABLE = new Set(["messages", "visits"]);
  if (SELF_SERVICE && !SELF_WRITABLE.has(model)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  // Demo mode: echo the payload back so the UI flow succeeds without a DB.
  if (!isDbConfigured()) {
    return NextResponse.json({ data: { id: `demo-${Date.now()}`, ...body }, demo: true }, { status: 201 });
  }

  try {
    const data = await def.delegate.create({ data: body });
    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Create failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
