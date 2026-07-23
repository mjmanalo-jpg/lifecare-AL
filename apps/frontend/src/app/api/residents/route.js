import { NextResponse } from "next/server";
import { requireTenantContext, tenantWhere } from "@/lib/tenant";
import { withTenantDb } from "@/lib/tenantDb";
import { assertMutationEntitled } from "@/lib/entitlements";

const READ_ONLY_ROLES = new Set(["FAMILY", "RESIDENT", "VIEWER"]);
const EDITABLE_FIELDS = ["firstName", "lastName", "dateOfBirth", "gender", "phone", "email", "roomNumber", "careLevel", "admissionDate", "emergencyContact", "emergencyContactPhone", "medicalHistory", "allergies", "notes"];

function pickResidentInput(body) {
  return Object.fromEntries(EDITABLE_FIELDS.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));
}

export async function GET(req) {
  const context = await requireTenantContext({ requireCommunity: true });
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 100, 1), 200);
  const offset = Math.max(Number(searchParams.get("offset")) || 0, 0);
  const scope = tenantWhere("residents", context);
  const where = id ? { AND: [scope, { id }] } : scope;
  const [data, total] = await withTenantDb(context, (tx) => Promise.all([
    tx.resident.findMany({ where, take: id ? 1 : limit, skip: id ? 0 : offset, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] }),
    tx.resident.count({ where }),
  ]));
  if (id && data.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (id) return NextResponse.json(data[0]);
  return NextResponse.json({ data, pagination: { total, limit, offset, hasMore: offset + limit < total } });
}

export async function POST(req) {
  const context = await requireTenantContext({ requireCommunity: true });
  if (!context?.organizationId || !context.communityId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (READ_ONLY_ROLES.has(context.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await assertMutationEntitled(context, "residents");
  const body = await req.json();
  const data = pickResidentInput(body);
  if (!data.firstName || !data.lastName || !data.roomNumber || !data.careLevel || !data.admissionDate) return NextResponse.json({ error: "Missing required resident fields" }, { status: 400 });
  const created = await withTenantDb(context, (tx) => tx.resident.create({ data: { ...data, organizationId: context.organizationId, communityId: context.communityId } }));
  return NextResponse.json(created, { status: 201 });
}

export async function PUT(req) {
  const context = await requireTenantContext({ requireCommunity: true });
  if (!context || READ_ONLY_ROLES.has(context.role)) return NextResponse.json({ error: context ? "Forbidden" : "Unauthorized" }, { status: context ? 403 : 401 });
  const body = await req.json();
  const id = String(body.id || "");
  const existing = await withTenantDb(context, (tx) => tx.resident.findFirst({ where: { AND: [tenantWhere("residents", context), { id }] }, select: { id: true } }));
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const updated = await withTenantDb(context, (tx) => tx.resident.update({ where: { id }, data: pickResidentInput(body) }));
  return NextResponse.json(updated);
}

export async function DELETE(req) {
  const context = await requireTenantContext({ requireCommunity: true });
  if (!context || READ_ONLY_ROLES.has(context.role)) return NextResponse.json({ error: context ? "Forbidden" : "Unauthorized" }, { status: context ? 403 : 401 });
  const id = new URL(req.url).searchParams.get("id");
  const existing = id ? await withTenantDb(context, (tx) => tx.resident.findFirst({ where: { AND: [tenantWhere("residents", context), { id }] }, select: { id: true } })) : null;
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await withTenantDb(context, (tx) => tx.resident.delete({ where: { id } }));
  return NextResponse.json({ success: true });
}