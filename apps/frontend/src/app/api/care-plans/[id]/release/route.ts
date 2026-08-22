import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { carePlanReleaseIssues } from "@/lib/lifecare/carePlanRelease";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APPROVER_ROLES = new Set(["NURSE", "CARE_MANAGER", "FACILITY_ADMIN", "SUPERADMIN"]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireTenantContext({ requireCommunity: true });
  if (!context?.communityId || !context.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!APPROVER_ROLES.has(context.role)) return NextResponse.json({ error: "Only an authorized nursing/clinical leader can approve a care plan." }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const approver = await prisma.user.findUnique({ where: { id: context.userId }, select: { name: true } }).catch(() => null);
  const approvedByName = approver?.name?.trim() || String(body.approvedByName || "").trim();
  const effectiveDate = String(body.effectiveDate || "");
  const nextReviewDate = String(body.nextReviewDate || "");

  const plan = await prisma.carePlan.findFirst({
    where: { id, communityId: context.communityId, organizationId: context.organizationId },
    include: { carePlanItems: { where: { category: "INTERVENTION", status: "ACTIVE" }, select: { title: true, description: true, status: true } } },
  });
  if (!plan) return NextResponse.json({ error: "Care plan not found." }, { status: 404 });

  const issues = carePlanReleaseIssues(plan, { approvedByName, effectiveDate, nextReviewDate });
  if (issues.length) return NextResponse.json({ error: "Care plan activation gates are incomplete.", code: "CARE_PLAN_RELEASE_GATES", issues }, { status: 422 });

  const approvedAt = new Date();
  const effective = new Date(effectiveDate);
  const review = new Date(nextReviewDate);
  const result = await prisma.$transaction(async (tx) => {
    const superseded = await tx.carePlan.updateMany({
      where: {
        communityId: context.communityId,
        residentId: plan.residentId,
        id: { not: plan.id },
        status: { in: ["ACTIVE", "DRAFT", "UNDER_REVIEW"] },
      },
      data: { status: "DISCONTINUED", discontinuedReason: `Superseded by approved care plan ${plan.id}` },
    });
    const active = await tx.carePlan.update({
      where: { id: plan.id },
      data: {
        status: "ACTIVE",
        startDate: effective,
        reviewDate: approvedAt,
        nextReviewDate: review,
        approvedById: context.userId,
        approvedByName,
        approvedAt,
      },
    });
    return { active, superseded: superseded.count };
  });

  logAudit({
    actorId: context.userId,
    actorRole: context.role,
    action: "UPDATE",
    entityType: "care-plans",
    entityId: plan.id,
    organizationId: context.organizationId,
    communityId: context.communityId,
    reason: `Approved current care-plan version; superseded ${result.superseded} prior active/draft version(s).`,
    before: { status: plan.status, residentId: plan.residentId },
    after: { status: result.active.status, residentId: result.active.residentId, approvedAt: result.active.approvedAt },
  });

  return NextResponse.json({ ok: true, plan: result.active, superseded: result.superseded });
}

