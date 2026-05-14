/**
 * TimIQ — minimal install / offline shell only.
 *
 * Cached: offline page, manifest, local SVG icons only.
 * Never cached: /api/*, HTML documents (except offline fallback), auth pages,
 * payroll, budgets, uploads, downloads, or any JSON from the API.
 *
 * Full offline sync / background sync is intentionally not implemented (later batch).
 */
const SHELL_CACHE = "timiq-pwa-shell-v1";
const PRECACHE_URLS = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/timiq-icon-192.svg",
  "/icons/timiq-icon-512.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== SHELL_CACHE) {
              return caches.delete(key);
            }
            return undefined;
          }),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") {
    return;
  }

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match("/offline.html").then((cached) => cached || new Response("Offline", { status: 503 })),
      ),
    );
    return;
  }

  const isPrecachedAsset = PRECACHE_URLS.some((p) => url.pathname === p);
  if (isPrecachedAsset) {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then((hit) => {
        if (hit) {
          return hit;
        }
        return fetch(req);
      }),
    );
  }
});
