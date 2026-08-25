import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/models";
import { requireTenantContext, type TenantContext } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Family-sponsor sign-off for a Level-of-Care CHANGE (reassessment) — the gate
 * before a nurse/Care Manager finalizes and applies the new level (which changes
 * billing). GET → the LOC changes awaiting/decided by the caller as sponsor.
 * POST → approve (→ FAMILY_APPROVED, awaits clinician finalize) or reject.
 * Sponsor-scoped by the sign-off's `sponsorId`. Lives in `loc_signoffs`.
 * Mirrors /api/family/care-plan-review.
 */

const KEY = "loc_signoffs";
const settingId = (ctx: TenantContext) => `${ctx.organizationId}:${ctx.communityId}:${KEY}`;

type Signoff = Record<string, unknown> & {
  id?: string; sponsorId?: string; status?: string; residentName?: string;
  submittedById?: string; oldLevel?: string; newLevel?: string;
};

function parse(raw: string | null | undefined): Signoff[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((r) => r && typeof r.id === "string") : []; } catch { return []; }
}
async function read(ctx: TenantContext): Promise<Signoff[]> {
  const row = await prisma.appSetting.findUnique({ where: { id: settingId(ctx) } });
  return parse(row?.value);
}

export async function GET() {
  const ctx = await requireTenantContext({ requireCommunity: true });
  if (!ctx?.organizationId || !ctx.communityId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ signoffs: [] });
  const mine = (await read(ctx)).filter((r) => r.sponsorId && r.sponsorId === ctx.userId);
  return NextResponse.json({ signoffs: mine });
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

  const items = await read(ctx);
  const idx = items.findIndex((r) => r.id === id);
  if (idx < 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const sg = items[idx];

  if (sg.sponsorId !== ctx.userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (sg.status !== "PENDING_FAMILY") return NextResponse.json({ error: "This request was already decided" }, { status: 409 });

  let signer = "Family sponsor";
  try {
    const u = await prisma.user.findUnique({ where: { id: String(ctx.userId) }, select: { firstName: true, lastName: true, name: true } });
    signer = [u?.firstName, u?.lastName].filter(Boolean).join(" ") || u?.name || signer;
  } catch { /* keep default */ }

  const now = new Date().toISOString();
  const updated: Signoff = decision === "APPROVE"
    ? { ...sg, status: "FAMILY_APPROVED", familyDecision: "APPROVED", familyDecidedByName: signer, familyDecidedAt: now, familyRejectReason: undefined }
    : { ...sg, status: "REJECTED", familyDecision: "REJECTED", familyDecidedByName: signer, familyDecidedAt: now, familyRejectReason: reason || "Rejected by family" };
  const next = items.map((x, i) => (i === idx ? updated : x));

  const sid = settingId(ctx);
  await prisma.appSetting.upsert({
    where: { id: sid },
    update: { value: JSON.stringify(next) },
    create: { id: sid, key: KEY, value: JSON.stringify(next), organizationId: ctx.organizationId, communityId: ctx.communityId },
  });

  // Notify the clinician who submitted the reassessment. The board's "awaiting
  // finalize" queue is the source of truth a nurse/Care Manager acts on.
  if (sg.submittedById) {
    try {
      await prisma.notification.create({
        data: {
          organizationId: ctx.organizationId, communityId: ctx.communityId,
          userId: String(sg.submittedById),
          type: "SYSTEM_ALERT",
          title: decision === "APPROVE" ? "Family signed off on level-of-care change" : "Family rejected level-of-care change",
          message: decision === "APPROVE"
            ? `${signer} approved the ${sg.oldLevel || "?"}→${sg.newLevel || "?"} level change for ${sg.residentName || "the resident"}. A nurse or Care Manager can now finalize it.`
            : `${signer} rejected the level-of-care change for ${sg.residentName || "the resident"}${reason ? `: "${reason}"` : ""}. Please revise and resubmit.`,
          relatedEntityType: "loc_signoff",
          severity: decision === "APPROVE" ? "INFO" : "WARNING",
        },
      });
    } catch { /* best-effort */ }
  }

  return NextResponse.json({ ok: true, signoff: updated });
}
