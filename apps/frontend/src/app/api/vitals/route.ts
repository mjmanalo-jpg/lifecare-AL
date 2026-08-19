import { NextRequest, NextResponse } from "next/server";
import { VitalType, IncidentType, IncidentSeverity } from "@prisma/client";
import { requireTenantContext, tenantWhere } from "@/lib/tenant";
import { withTenantDb } from "@/lib/tenantDb";
import { logAudit } from "@/lib/audit";
import { isDbConfigured } from "@/lib/models";
import { DEMO } from "@/lib/demoData";
import { isAbnormalVital, vitalSeverity, VITAL_META } from "@/lib/vitalThresholds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function canAccessResident(context: NonNullable<Awaited<ReturnType<typeof requireTenantContext>>>, residentId: string) {
  return withTenantDb(context, (tx) => tx.resident.findFirst({ where: { AND: [{ id: residentId }, tenantWhere("residents", context)] }, select: { id: true } }));
}

export async function GET(request: NextRequest) {
  const context = await requireTenantContext({ requireCommunity: true });
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const residentId = new URL(request.url).searchParams.get("residentId");
  if (!residentId) return NextResponse.json({ error: "Missing residentId" }, { status: 400 });
  if (!isDbConfigured()) return NextResponse.json({ data: DEMO.vitals.filter((item) => item.residentId === residentId), demo: true });
  if (!(await canAccessResident(context, residentId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const data = await withTenantDb(context, (tx) => tx.vitalsLog.findMany({ where: { residentId, communityId: context.communityId }, orderBy: { recordedAt: "desc" } }));
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const context = await requireTenantContext({ requireCommunity: true });
  if (!context?.organizationId || !context.communityId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  const residentId = String(body.residentId || "");
  const type = String(body.type || "");
  if (!residentId || !Object.values(VitalType).includes(type as VitalType) || body.value === undefined) return NextResponse.json({ error: "Resident, vital type, and value are required" }, { status: 400 });
  if (!(await canAccessResident(context, residentId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isDbConfigured()) return NextResponse.json({ data: { id: `demo-${Date.now()}`, residentId, type, value: String(body.value) }, demo: true }, { status: 201 });
  const valueStr = String(body.value);
  const data = await withTenantDb(context, (tx) => tx.vitalsLog.create({ data: { organizationId: context.organizationId, communityId: context.communityId, residentId, type: type as VitalType, value: valueStr, unit: body.unit || null, notes: body.notes != null ? String(body.notes) : null, recordedAt: new Date(), recordedBy: context.userId } }));

  // Audit — vitals are recorded outside /api/db (this dedicated route), so log
  // the reading against the staff member who took it for the audit trail.
  logAudit({
    actorId: context.userId,
    actorRole: context.role,
    action: "CREATE",
    entityType: "vitals",
    entityId: (data as { id?: string })?.id || residentId,
    organizationId: context.organizationId,
    communityId: context.communityId,
    after: { residentId },
    reason: `${VITAL_META[type as VitalType]?.label ?? type} recorded — ${valueStr}${body.unit ? ` ${body.unit}` : ""}`,
  });

  // Abnormal reading → also log a clinical Incident so it surfaces in the
  // resident's "Recent Incidents" (visible to caregiver/nurse/care manager),
  // attributed to the staff who recorded the vital. Best-effort — a failure here
  // must never block the vital write.
  if (isAbnormalVital(type, valueStr)) {
    try {
      const critical = vitalSeverity(type, valueStr) === "CRITICAL";
      const label = VITAL_META[type]?.label ?? type;
      const unit = VITAL_META[type]?.unit ?? "";
      await withTenantDb(context, async (tx) => {
        const staff = context.userId
          ? await tx.staff.findFirst({ where: { userId: context.userId, communityId: context.communityId }, select: { id: true } })
          : null;
        await tx.incident.create({
          data: {
            organizationId: context.organizationId,
            communityId: context.communityId,
            residentId,
            incidentType: IncidentType.MEDICAL_EMERGENCY,
            severity: critical ? IncidentSeverity.CRITICAL : IncidentSeverity.MODERATE,
            title: `${critical ? "Critical" : "Abnormal"} ${label}`,
            description: `${critical ? "Critically abnormal" : "Abnormal"} ${label} of ${valueStr}${unit ? ` ${unit}` : ""} recorded. Auto-logged from vitals monitoring — clinical review required.`,
            reportedById: staff?.id ?? null,
            followUpRequired: critical,
            incidentDate: new Date(),
          },
        });
      });
    } catch (e) {
      console.error("[vitals POST] abnormal-vital incident create failed:", e instanceof Error ? e.message : "unknown");
    }
  }
  return NextResponse.json({ data }, { status: 201 });
}