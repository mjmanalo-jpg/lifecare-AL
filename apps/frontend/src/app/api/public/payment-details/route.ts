import { NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/models";
import { readPaymentDetails, DEFAULT_PAYMENT_DETAILS } from "@/lib/paymentDetails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public read of the platform's payee payment details so payers (org admins on
// the checkout / billing page) can see where and how to send their payment.
// This is payee account info intended to be shown to customers.
export async function GET() {
  if (!isDbConfigured()) return NextResponse.json({ paymentDetails: DEFAULT_PAYMENT_DETAILS });
  try {
    return NextResponse.json({ paymentDetails: await readPaymentDetails() });
  } catch {
    return NextResponse.json({ paymentDetails: DEFAULT_PAYMENT_DETAILS });
  }
}
