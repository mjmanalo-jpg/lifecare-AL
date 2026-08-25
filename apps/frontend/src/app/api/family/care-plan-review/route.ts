import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/models";
import { requireTenantContext, type TenantContext } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Family-sponsor sign-off for Care Plan Reviews (the gate before a Care Manager
 * finalizes/releases the plan).
 *   GET  → the reviews awaiting/decided by the caller as the resident's family sponsor.
 *   POST → approve (→ FAMILY_APPROVED, awaits clinician finalize) or reject (→ REJECTED,
 *          returns the held draft plan to DRAFT for revision).
 * Sponsor-scoped: a family user can only act on reviews whose `sponsorId` is their own
 * user id. Reviews live in the community-scoped app-setting `care_plan_reviews`.
 * Mirrors /api/family/private-care.
 */

const REVIEW_KEY = "care_plan_reviews";
const settingId = (ctx: TenantContext) => `${ctx.organizationId}:${ctx.communityId}:${REVIEW_KEY}`;

type Review = Record<string, unknown> & {
  id?: string; sponsorId?: string; approvalStatus?: string; planId?: string;
  residentName?: string; submittedById?: string;
};

function parseReviews(raw: string | null | undefined): Review[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((r) => r && typeof r.id === "string") : []; } catch { return []; }
}
async function readReviews(ctx: TenantContext): Promise<Review[]> {
  const row = await prisma.appSetting.findUnique({ where: { id: settingId(ctx) } });
  return parseReviews(row?.value);
}

export async function GET() {
  const ctx = await requireTenantContext({ requireCommunity: true });
  if (!ctx?.organizationId || !ctx.communityId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ reviews: [] });
  const mine = (await readReviews(ctx)).filter((r) => r.sponsorId && r.sponsorId === ctx.userId);
  // Enrich the reviews awaiting this family with the linked plan's goals + interventions,
  // so the sponsor reviews the actual plan before signing off (server-side — no extra client perms).
  const enriched = await Promise.all(mine.map(async (r) => {
    if (r.approvalStatus !== "PENDING_FAMILY" || !r.planId) return r;
    try {
      const p = await prisma.carePlan.findUnique({ where: { id: String(r.planId) }, select: { title: true, careGoals: true, interventions: true } });
      return { ...r, planTitle: p?.title, planGoals: p?.careGoals, planInterventions: p?.interventions };
    } catch { return r; }
  }));
  return NextResponse.json({ reviews: enriched });
}

export async function POST(request: NextRequest) {
  const ctx = await requireTenantContext({ requireCommunity: true });
  if (!ctx?.organizationId || !ctx.communityId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  const decision = String(body.decision || "");
  const reason = String(body.reason || "").slice(0, 500);
  if (!id || (decision !== "APPROVE" && decision !== "REJECT")) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const reviews = await readReviews(ctx);
  const idx = reviews.findIndex((r) => r.id === id);
  if (idx < 0) return NextResponse.json({ error: "Review not found" }, { status: 404 });
  const rv = reviews[idx];

  // Only the resident's family sponsor may decide, and only while it awaits them.
  if (rv.sponsorId !== ctx.userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (rv.approvalStatus !== "PENDING_FAMILY") return NextResponse.json({ error: "This review was already decided" }, { status: 409 });

  // Family signer's display name — recorded so staff see WHO signed off and WHEN.
  let signer = "Family sponsor";
  try {
    const u = await prisma.user.findUnique({ where: { id: String(ctx.userId) }, select: { firstName: true, lastName: true, name: true } });
    signer = [u?.firstName, u?.lastName].filter(Boolean).join(" ") || u?.name || signer;
  } catch { /* keep default */ }

  const now = new Date().toISOString();
  const updated: Review = decision === "APPROVE"
    ? { ...rv, approvalStatus: "FAMILY_APPROVED", familyDecision: "APPROVED", familyDecidedByName: signer, familyDecidedAt: now, familyRejectReason: undefined }
    : { ...rv, approvalStatus: "REJECTED", familyDecision: "REJECTED", familyDecidedByName: signer, familyDecidedAt: now, familyRejectReason: reason || "Rejected by family" };
  const next = reviews.map((x, i) => (i === idx ? updated : x));

  const sid = settingId(ctx);
  await prisma.appSetting.upsert({
    where: { id: sid },
    update: { value: JSON.stringify(next) },
    create: { id: sid, key: REVIEW_KEY, value: JSON.stringify(next), organizationId: ctx.organizationId, communityId: ctx.communityId },
  });

  // On rejection, return the held draft plan to DRAFT so the nurse/CM can revise & resubmit.
  if (decision === "REJECT" && rv.planId) {
    try { await prisma.carePlan.update({ where: { id: String(rv.planId) }, data: { status: "DRAFT" } }); } catch { /* best-effort */ }
  }

  // Notify the review's submitter (nurse/CM) of the family's decision. The board's
  // "Ready to finalize" queue is the source of truth a Care Manager acts on.
  if (rv.submittedById) {
    try {
      await prisma.notification.create({
        data: {
          organizationId: ctx.organizationId, communityId: ctx.communityId,
          userId: String(rv.submittedById),
          type: "SYSTEM_ALERT",
          title: decision === "APPROVE" ? "Family signed off on care plan" : "Family rejected care plan review",
          message: decision === "APPROVE"
            ? `${signer} approved the care plan review for ${rv.residentName || "the resident"}. A Care Manager can now finalize it.`
            : `${signer} rejected the care plan review for ${rv.residentName || "the resident"}${reason ? `: "${reason}"` : ""}. Please revise and resubmit.`,
          relatedEntityType: "care_plan_review",
          severity: decision === "APPROVE" ? "INFO" : "WARNING",
        },
      });
    } catch { /* best-effort */ }
  }

  return NextResponse.json({ ok: true, review: updated });
}
