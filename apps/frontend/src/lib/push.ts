// Web Push (server) — VAPID config + per-community subscription store + send.
// Subscriptions are stored migration-free in the `__push_subscriptions` app-setting
// (the `__` prefix hides it from the generic /api/db route; only /api/push writes it),
// one array per community: { userId, endpoint, subscription, ua?, at }.

import webpush from "web-push";
import { prisma } from "@/lib/prisma";

export const PUSH_SUBSCRIPTIONS_KEY = "__push_subscriptions";

export interface StoredPushSub {
  userId: string;
  endpoint: string;
  subscription: webpush.PushSubscription;
  ua?: string;
  at: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  urgent?: boolean;
}

export function parsePushSubs(raw: string | null | undefined): StoredPushSub[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v)
      ? v.filter((s): s is StoredPushSub => !!s && typeof s.endpoint === "string" && !!s.subscription && typeof s.userId === "string")
      : [];
  } catch {
    return [];
  }
}

let configured: boolean | null = null;
/** Set VAPID details once from env. Returns false when keys are absent (push off). */
export function configureWebPush(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@lifecare.local";
  if (!pub || !priv) { configured = false; return false; }
  try { webpush.setVapidDetails(subject, pub, priv); configured = true; }
  catch { configured = false; }
  return configured;
}

/** Load a community's stored subscriptions + the app-setting id (for write-back). */
export async function loadCommunityPushSubs(communityId: string): Promise<{ id: string | null; subs: StoredPushSub[] }> {
  const row = await prisma.appSetting
    .findFirst({ where: { communityId, key: PUSH_SUBSCRIPTIONS_KEY }, select: { id: true, value: true } })
    .catch(() => null);
  return { id: row?.id ?? null, subs: parsePushSubs(row?.value) };
}

/**
 * Send `payload` to the given users' devices from an already-loaded `subs` list.
 * Best-effort: never throws; endpoints that return 404/410 (gone) are added to
 * `dead` so the caller can prune them once. Returns the count delivered.
 */
export async function sendToSubscriptions(
  subs: StoredPushSub[],
  userIds: string[],
  payload: PushPayload,
  dead: Set<string>,
): Promise<number> {
  if (!subs.length || !userIds.length || !configureWebPush()) return 0;
  const targetUsers = new Set(userIds);
  const targets = subs.filter((s) => targetUsers.has(s.userId) && !dead.has(s.endpoint));
  if (!targets.length) return 0;
  const data = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(targets.map(async (s) => {
    try { await webpush.sendNotification(s.subscription, data); sent++; }
    catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) dead.add(s.endpoint); // subscription expired/unsubscribed
    }
  }));
  return sent;
}

/** Write back the subscription list with dead endpoints removed (no-op if none). */
export async function prunePushSubs(settingId: string | null, subs: StoredPushSub[], dead: Set<string>): Promise<void> {
  if (!settingId || !dead.size) return;
  const kept = subs.filter((s) => !dead.has(s.endpoint));
  await prisma.appSetting.update({ where: { id: settingId }, data: { value: JSON.stringify(kept) } }).catch(() => { /* best-effort */ });
}
