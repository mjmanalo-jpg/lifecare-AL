import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDbConfigured } from "@/lib/models";
import { validateSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Key/value application settings backed by the Prisma `AppSetting` model.
 *   GET  /api/settings           → { data: { key: value, ... } }
 *   POST /api/settings  {key,value} → upsert one setting
 *
 * Realtime reads go through /api/db/app-settings (useLiveQuery). This route
 * exists only to give writes proper upsert semantics. Degrades to a no-op echo
 * when no database is configured, so the UI keeps working.
 */

export async function GET() {
  const role = await validateSession();
  if (!role) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isDbConfigured()) return NextResponse.json({ data: {}, demo: true });

  try {
    const rows = await prisma.appSetting.findMany();
    const data = Object.fromEntries(rows.map((r) => [r.id, r.value]));
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const role = await validateSession();
  if (!role) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { key, value } = await req.json().catch(() => ({}));
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });

  if (!isDbConfigured()) {
    return NextResponse.json({ data: { id: key, value }, demo: true });
  }

  try {
    const data = await prisma.appSetting.upsert({
      where: { id: String(key) },
      update: { value: String(value) },
      create: { id: String(key), value: String(value) },
    });
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
