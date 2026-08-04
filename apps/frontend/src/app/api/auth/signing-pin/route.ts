import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireTenantContext } from "@/lib/tenant";
import { PIN_SETTING_PREFIX } from "@/lib/signingPin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-user signing PIN. It is AUTO-GENERATED (the staff never picks it) and
// must be VIEWABLE by the staff in settings, so it's stored reversibly:
// AES-256-GCM encrypted with a key derived from SESSION_SECRET. The ciphertext
// lives in an app-setting keyed `__pin:<userId>` — filtered out of every client
// settings read, so only this route ever touches it. A DB dump never reveals a
// PIN without the app secret.
const SECRET = process.env.SESSION_SECRET || "golden-hearth-dev-secret-change-me";
const KEY = crypto.createHash("sha256").update(`signing-pin:${SECRET}`).digest();

function pinId(orgId: string, userId: string) {
  return `${orgId || "_"}::${PIN_SETTING_PREFIX}${userId}`;
}
function genPin(): string {
  return String(crypto.randomInt(0, 10000)).padStart(4, "0");
}
function encrypt(pin: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(pin, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}
function decrypt(stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    const [iv, tag, data] = stored.split(":");
    if (!iv || !tag || !data) return null; // legacy bcrypt hash → treat as absent
    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch { return null; }
}

async function store(id: string, userId: string, orgId: string | undefined, pin: string) {
  await prisma.appSetting.upsert({
    where: { id },
    update: { value: encrypt(pin) },
    create: { id, key: `${PIN_SETTING_PREFIX}${userId}`, value: encrypt(pin), organizationId: orgId ?? null, communityId: null },
  });
}

/** Ensure the user has a valid, viewable PIN; auto-provision one if missing/legacy. */
async function ensurePin(orgId: string | undefined, userId: string): Promise<string> {
  const id = pinId(orgId ?? "", userId);
  const row = await prisma.appSetting.findUnique({ where: { id }, select: { value: true } });
  const current = decrypt(row?.value);
  if (current) return current;
  const pin = genPin();
  await store(id, userId, orgId, pin);
  return pin;
}

export async function GET() {
  const context = await requireTenantContext({ allowPlatform: true });
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const pin = await ensurePin(context.organizationId, context.userId);
  return NextResponse.json({ hasPin: true, pin });
}

export async function POST(request: NextRequest) {
  const context = await requireTenantContext({ allowPlatform: true });
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = pinId(context.organizationId ?? "", context.userId);
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");

  if (action === "verify") {
    const current = await ensurePin(context.organizationId, context.userId);
    const ok = String(body.pin || "") === current;
    return NextResponse.json({ ok });
  }

  if (action === "regenerate") {
    const pin = genPin();
    await store(id, context.userId, context.organizationId, pin);
    return NextResponse.json({ ok: true, pin });
  }

  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
}
