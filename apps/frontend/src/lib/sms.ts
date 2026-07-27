// Provider-agnostic SMS / external-notification layer (server-only).
//
// Used to notify people who may NOT be system users — e.g. a transport driver
// receiving "You have a patient transport booked Friday 10:00 AM" plus a
// reminder before departure. The facility is in the Philippines, so PH mobile
// numbers are normalized to E.164 (+63) before sending.
//
// Provider is chosen at runtime via the SMS_PROVIDER env var. When nothing is
// configured (or required keys are missing) sendSms resolves a skipped result
// and logs a clear line — it NEVER throws.

export type SmsResult = {
  ok: boolean;
  provider: string;
  id?: string;
  error?: string;
  skipped?: boolean;
};

/**
 * Normalize a Philippine mobile number to E.164 (+63…).
 * - Already "+"-prefixed numbers are kept as-is.
 * - Leading "0" (e.g. 0917…) becomes "+63917…".
 * - A bare 10-digit number starting with "9" (e.g. 9171234567) becomes "+63…".
 * - Anything else is returned trimmed, unchanged.
 */
function normalizePhNumber(raw: string): string {
  const to = raw.trim();
  if (to.startsWith("+")) return to;
  if (to.startsWith("0")) return "+63" + to.slice(1);
  if (to.startsWith("9") && to.length === 10) return "+63" + to;
  return to;
}

async function sendViaSemaphore(to: string, message: string): Promise<SmsResult> {
  const apikey = process.env.SEMAPHORE_API_KEY;
  if (!apikey) {
    console.info(`[sms] not configured — would send to ${to}: ${message}`);
    return { ok: false, provider: "none", skipped: true };
  }

  const params = new URLSearchParams({ apikey, number: to, message });
  const senderName = process.env.SEMAPHORE_SENDER_NAME;
  if (senderName) params.set("sendername", senderName);

  try {
    const response = await fetch("https://api.semaphore.co/api/v4/messages", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { ok: false, provider: "semaphore", error: `HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}` };
    }
    // Semaphore returns an array of message objects; surface the first id if present.
    let id: string | undefined;
    try {
      const data = (await response.json()) as unknown;
      const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
      if (first && (typeof first.message_id === "number" || typeof first.message_id === "string")) {
        id = String(first.message_id);
      }
    } catch {
      // Non-JSON success body is fine; we still report ok.
    }
    return { ok: true, provider: "semaphore", id };
  } catch (error) {
    return { ok: false, provider: "semaphore", error: error instanceof Error ? error.message : "unknown error" };
  }
}

async function sendViaTwilio(to: string, message: string): Promise<SmsResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !authToken || !from) {
    console.info(`[sms] not configured — would send to ${to}: ${message}`);
    return { ok: false, provider: "none", skipped: true };
  }

  const body = new URLSearchParams({ To: to, From: from, Body: message });
  const auth = Buffer.from(`${sid}:${authToken}`).toString("base64");

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { ok: false, provider: "twilio", error: `HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}` };
    }
    let id: string | undefined;
    try {
      const data = (await response.json()) as Record<string, unknown>;
      if (typeof data.sid === "string") id = data.sid;
    } catch {
      // Success without a parseable body — still ok.
    }
    return { ok: true, provider: "twilio", id };
  } catch (error) {
    return { ok: false, provider: "twilio", error: error instanceof Error ? error.message : "unknown error" };
  }
}

/**
 * Send an SMS via the configured provider. Always resolves a SmsResult and
 * never throws. When no provider is configured, resolves { ok:false,
 * provider:"none", skipped:true } so callers can distinguish "not configured"
 * from a real send failure.
 */
export async function sendSms(to: string, message: string): Promise<SmsResult> {
  const number = normalizePhNumber(to);
  const provider = (process.env.SMS_PROVIDER || "").trim().toLowerCase();

  try {
    if (provider === "semaphore") return await sendViaSemaphore(number, message);
    if (provider === "twilio") return await sendViaTwilio(number, message);
    console.info(`[sms] not configured — would send to ${number}: ${message}`);
    return { ok: false, provider: "none", skipped: true };
  } catch (error) {
    // Defensive: normalize any unexpected throw into a SmsResult.
    return { ok: false, provider: provider || "none", error: error instanceof Error ? error.message : "unknown error" };
  }
}
