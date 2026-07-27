import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/tenant";
import { sendSms } from "@/lib/sms";

export const runtime = "nodejs";

// POST /api/sms — send an SMS to any phone number (e.g. a transport driver who
// is not a system user). Authorized to any active tenant member. Returns the
// SmsResult even when the SMS layer is not configured (result.skipped === true)
// so callers can detect that no message was actually sent.
export async function POST(request: NextRequest) {
  try {
    const context = await requireTenantContext({});
    if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const to = typeof body?.to === "string" ? body.to.trim() : "";
    const message = typeof body?.message === "string" ? body.message : "";
    if (!to || !message.trim()) {
      return NextResponse.json({ error: "Both 'to' and 'message' are required" }, { status: 400 });
    }

    const result = await sendSms(to, message);
    return NextResponse.json({ result });
  } catch (error) {
    console.error("SMS send failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Unable to send SMS" }, { status: 500 });
  }
}
