// Guards what public/sw.js is allowed to intercept.
//
// The security invariant: /api/* must NEVER reach the service worker cache.
// Clinical data lives in IndexedDB (src/lib/offline/*), which the app can clear
// on logout; CacheStorage entries would outlive the session on a shared facility
// tablet. A stray broadening of the fetch handler would put PHI there silently,
// so this test asserts the dispatch decision directly.
//
// The worker is evaluated in a stub SW global; only the listener registrations
// run at eval time, so we can capture the fetch handler and probe it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ORIGIN = "https://app.lifecare.test";

const source = readFileSync(
  fileURLToPath(new URL("../public/sw.js", import.meta.url)),
  "utf8",
);

/** Evaluate sw.js against stubs and hand back its `fetch` listener. */
function loadFetchHandler(): (event: unknown) => void {
  const listeners = new Map<string, (event: unknown) => void>();
  const self = {
    addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
    location: { origin: ORIGIN },
    skipWaiting: async () => {},
    clients: { claim: async () => {}, matchAll: async () => [] },
    registration: { showNotification: async () => {} },
  };
  const cache = { match: async () => undefined, put: async () => {}, add: async () => {} };
  const caches = { open: async () => cache, keys: async () => [], delete: async () => true };
  const fetchStub = async () => ({ status: 200, redirected: false, type: "basic", headers: new Map(), clone: () => ({}) });

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function("self", "caches", "fetch", "Response", source)(self, caches, fetchStub, { error: () => ({}) });

  const handler = listeners.get("fetch");
  assert.ok(handler, "sw.js should register a fetch listener");
  return handler;
}

/** True when the worker took over the request (i.e. it may cache the response). */
function intercepts(req: { url: string; method?: string; mode?: string }): boolean {
  let handled = false;
  loadFetchHandler()({
    request: { method: "GET", mode: "cors", ...req },
    respondWith: (p: Promise<unknown>) => { handled = true; void Promise.resolve(p).catch(() => {}); },
  });
  return handled;
}

test("never intercepts API traffic — PHI must not reach CacheStorage", () => {
  assert.equal(intercepts({ url: `${ORIGIN}/api/db/residents` }), false);
  assert.equal(intercepts({ url: `${ORIGIN}/api/db/care-events?f_residentId=abc` }), false);
  assert.equal(intercepts({ url: `${ORIGIN}/api/auth/session` }), false);
  // Even a full page load of an API path stays uncached — the PHI guard runs
  // before the navigation branch.
  assert.equal(intercepts({ url: `${ORIGIN}/api/db/residents`, mode: "navigate" }), false);
});

test("never intercepts writes or cross-origin requests", () => {
  assert.equal(intercepts({ url: `${ORIGIN}/nurse/dashboard`, method: "POST", mode: "navigate" }), false);
  assert.equal(intercepts({ url: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm/x.wasm" }), false);
});

test("caches the PHI-free app shell", () => {
  // Page loads: the server-rendered document is a skeleton ("use client" pages).
  assert.equal(intercepts({ url: `${ORIGIN}/nurse/dashboard`, mode: "navigate" }), true);
  // Content-hashed build output and the 13 MB face-api weights.
  assert.equal(intercepts({ url: `${ORIGIN}/_next/static/chunks/main-abc123.js` }), true);
  assert.equal(intercepts({ url: `${ORIGIN}/models/face-api/tiny_face_detector_model.bin` }), true);
  assert.equal(intercepts({ url: `${ORIGIN}/icon-192.png` }), true);
});

test("leaves Next.js client-side RSC navigations alone", () => {
  // These are mode:"cors" fetches returning a flight payload, not HTML. Caching
  // one and later replaying it for a document request would break the route.
  assert.equal(intercepts({ url: `${ORIGIN}/nurse/dashboard?_rsc=1a2b3c` }), false);
});
