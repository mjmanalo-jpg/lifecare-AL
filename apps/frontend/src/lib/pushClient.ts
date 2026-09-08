// Web Push (client) — feature detection, permission + subscribe, unsubscribe.
// The service worker is /sw.js; the VAPID public key is exposed via env.

export function pushSupported(): boolean {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

/** Current OS permission, or "unsupported" when web-push isn't available. */
export function pushPermission(): NotificationPermission | "unsupported" {
  return pushSupported() ? Notification.permission : "unsupported";
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type EnableResult = { ok: boolean; reason?: "unsupported" | "not-configured" | "denied" | "error" };

/** Request permission, register the SW, subscribe, and persist to the server. */
export async function enablePush(): Promise<EnableResult> {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) return { ok: false, reason: "not-configured" };
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, reason: "denied" };

    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    const existing = await reg.pushManager.getSubscription();
    const sub = existing ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      // `as BufferSource`: a Uint8Array is a valid application server key; the cast
      // sidesteps the lib.dom SharedArrayBuffer strictness on Uint8Array<ArrayBufferLike>.
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    });

    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ subscription: sub.toJSON(), ua: navigator.userAgent }),
    });
    return res.ok ? { ok: true } : { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** Unsubscribe this device and tell the server to forget it. */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => { /* ignore */ });
      await sub.unsubscribe().catch(() => { /* ignore */ });
    }
  } catch { /* ignore */ }
}
