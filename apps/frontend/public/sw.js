/* LifeCare push service worker. Shows an OS notification for each web-push
   message and focuses/opens the app on click. Payload shape (from lib/push.ts):
   { title, body, tag, url, urgent }. */

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_e) { data = {}; }
  const title = data.title || "LifeCare alert";
  const urgent = !!data.urgent;
  const options = {
    body: data.body || "",
    icon: "/logo-lifecare.png",
    badge: "/logo-lifecare.png",
    tag: data.tag || undefined,      // collapse duplicates of the same occurrence
    renotify: urgent,                // re-alert even if a same-tag one is showing
    requireInteraction: urgent,      // overdue stays until acknowledged
    vibrate: urgent ? [140, 70, 140, 70, 200] : [90],
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) { if ("navigate" in w) { try { w.navigate(url); } catch (_e) { /* ignore */ } } return w.focus(); }
      }
      return self.clients.openWindow ? self.clients.openWindow(url) : undefined;
    })
  );
});

// Activate immediately so the first subscribe works without a reload.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
