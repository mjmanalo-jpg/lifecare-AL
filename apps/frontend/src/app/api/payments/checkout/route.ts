import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/tenant";
import { createCheckout } from "@/lib/payments";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const context = await requireTenantContext({});
    if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const amount = Number(body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "A positive amount is required" }, { status: 400 });
    }

    const result = await createCheckout({
      amount,
      currency: typeof body?.currency === "string" ? body.currency : undefined,
      description: typeof body?.description === "string" ? body.description : undefined,
      referenceId: typeof body?.referenceId === "string" ? body.referenceId : undefined,
    });

    return NextResponse.json({ result });
  } catch (error) {
    console.error("Payment checkout failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Unable to create checkout" }, { status: 500 });
  }
}
