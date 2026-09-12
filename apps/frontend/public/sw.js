/* LifeCare service worker: web push + an offline app-shell cache.

   Caching scope is deliberately narrow. The IndexedDB layer in src/lib/offline/*
   already owns API data (read cache + write outbox), so this worker NEVER touches
   /api/* — clinical data must not end up in CacheStorage where logout can't clear
   it. What it does cache is PHI-free: hashed build assets, images, the 13 MB
   face-api weights, and route HTML (every page.tsx is "use client", so the
   server-rendered document is an empty skeleton — the data arrives later over
   /api/db and is served from IndexedDB when offline).

   Net effect: launching the installed app with no signal boots the real shell
   against cached data instead of Chrome's dinosaur. */

const VERSION = "v1";
const CACHE = `lifecare-${VERSION}`;
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/manifest.json", "/icon-192.png", "/icon-512.png"];

// ── install / activate ───────────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Per-entry catch: one missing asset must not fail the whole install.
    await Promise.all(PRECACHE.map((url) =>
      cache.add(new Request(url, { cache: "reload" })).catch(() => { /* skip */ })
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => n.startsWith("lifecare-") && n !== CACHE).map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

// ── fetch ────────────────────────────────────────────────────────────────────

/** Content-hashed or immutable-enough to serve from cache without revalidating. */
function isStaticAsset(pathname) {
  return pathname.startsWith("/_next/static/")
    || pathname.startsWith("/models/")
    || /\.(?:png|jpe?g|svg|webp|gif|ico|woff2?)$/i.test(pathname);
}

/** Only plain 200s are storable — a redirect replayed from cache throws. */
function isStorable(res) {
  return res && res.status === 200 && !res.redirected && res.type !== "opaque";
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (isStorable(res)) cache.put(request, res.clone());
  return res;
}

async function networkFirstDocument(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    const type = res.headers.get("content-type") || "";
    if (isStorable(res) && type.includes("text/html")) cache.put(request, res.clone());
    return res;
  } catch {
    // Offline: last-seen HTML for this route, else the generic offline page.
    return (await cache.match(request, { ignoreSearch: true }))
      || (await cache.match(OFFLINE_URL))
      || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // src/lib/offline/* owns API data. Leave it alone — no PHI in CacheStorage.
  if (url.pathname.startsWith("/api/")) return;

  // Full page loads (app launch, address bar, reload). Next's client-side RSC
  // navigations aren't mode:"navigate", so they fall through untouched.
  if (request.mode === "navigate") {
    event.respondWith(networkFirstDocument(request));
    return;
  }

  if (isStaticAsset(url.pathname)) event.respondWith(cacheFirst(request));
});

// ── web push ─────────────────────────────────────────────────────────────────
// Shows an OS notification for each message and focuses/opens the app on click.
// Payload shape (from lib/push.ts): { title, body, tag, url, urgent }.

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_e) { data = {}; }
  const title = data.title || "LifeCare alert";
  const urgent = !!data.urgent;
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
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
