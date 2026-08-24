import { NextRequest, NextResponse } from "next/server";
import { resolveTenantByKey, ingestSlmsLead, type SlmsLeadPayload } from "@/lib/integrations/slmsLeads";

// Inbound server-to-server endpoint. Authenticated by a per-community API key
// (X-API-Key header), NOT a user session — the caller is another system's
// backend (e.g. SLMS Home apps/api), never a browser. The key resolves the
// tenant; the body only carries the referral details.
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key")?.trim();
  if (!apiKey) return NextResponse.json({ error: "Missing X-API-Key" }, { status: 401 });

  const tenant = await resolveTenantByKey(apiKey);
  if (!tenant) return NextResponse.json({ error: "Invalid API key" }, { status: 401 });

  let body: Partial<SlmsLeadPayload>;
  try {
    body = (await request.json()) as Partial<SlmsLeadPayload>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const result = await ingestSlmsLead(tenant, {
    name,
    contact: body.contact,
    email: body.email,
    notes: body.notes,
    prospectiveResident: body.prospectiveResident,
    externalId: body.externalId,
  });

  return NextResponse.json({ ok: true, ...result }, { status: result.deduped ? 200 : 201 });
}
