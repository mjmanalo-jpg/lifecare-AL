import { NextRequest, NextResponse } from "next/server";
import { getModel, isDbConfigured } from "@/lib/models";
import { validateSession } from "@/lib/auth";
import { DEMO } from "@/lib/demoData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Single-record endpoint.
 *   GET    /api/db/:model/:id?include=resident
 *   PATCH  /api/db/:model/:id   (body = partial update)
 *   DELETE /api/db/:model/:id
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ model: string; id: string }> }
) {
  const role = await validateSession();
  if (!role) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { model, id } = await params;
  const def = getModel(model);
  if (!def) return NextResponse.json({ error: `Unknown model '${model}'` }, { status: 404 });

  if (!isDbConfigured()) {
    const row = (DEMO[model] ?? []).find((r) => r.id === id);
    return row
      ? NextResponse.json({ data: row, demo: true })
      : NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const includeParam = new URL(req.url).searchParams.get("include");
    const include = includeParam
      ? Object.fromEntries(includeParam.split(",").map((r) => [r.trim(), true]))
      : undefined;
    const data = await def.delegate.findUnique({ where: { id }, ...(include ? { include } : {}) });
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ model: string; id: string }> }
) {
  const role = await validateSession();
  if (!role) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { model, id } = await params;
  const def = getModel(model);
  if (!def) return NextResponse.json({ error: `Unknown model '${model}'` }, { status: 404 });

  // Self-service roles may only update messages (mark-as-read); no other edits.
  if ((role === "FAMILY" || role === "RESIDENT") && model !== "messages") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  if (!isDbConfigured()) {
    return NextResponse.json({ data: { id, ...body }, demo: true });
  }

  try {
    const data = await def.delegate.update({ where: { id }, data: body });
    return NextResponse.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ model: string; id: string }> }
) {
  const role = await validateSession();
  if (!role) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { model, id } = await params;
  const def = getModel(model);
  if (!def) return NextResponse.json({ error: `Unknown model '${model}'` }, { status: 404 });

  // Self-service logins (FAMILY/RESIDENT) can never delete.
  if (role === "FAMILY" || role === "RESIDENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isDbConfigured()) {
    return NextResponse.json({ ok: true, demo: true });
  }

  try {
    await def.delegate.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
