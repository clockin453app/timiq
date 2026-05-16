/**
 * TimIQ — minimal install / offline shell only.
 *
 * Cached: offline page, manifest, local SVG icons only.
 * Never cached: /api/*, HTML documents (except offline fallback), auth pages,
 * payroll, budgets, uploads, downloads, or any JSON from the API.
 *
 * Offline shell: precached assets + navigate fallback to offline.html only.
 * Never cache /api/*, HTML app routes, payroll, documents, downloads, or private JSON.
 * Queued work lives in IndexedDB from the app — not in the service worker cache.
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

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = typeof payload.title === "string" && payload.title.trim() ? payload.title : "TimIQ notification";
  const body = typeof payload.body === "string" ? payload.body : "Open TimIQ to view details.";
  const rawUrl = typeof payload.url === "string" ? payload.url : "/";
  const safeUrl = rawUrl.startsWith("/") && !rawUrl.startsWith("//") ? rawUrl : "/";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/timiq-icon-192.svg",
      badge: "/icons/timiq-icon-192.svg",
      data: {
        url: safeUrl,
        kind: typeof payload.kind === "string" ? payload.kind : "",
        notificationId: typeof payload.notification_id === "string" ? payload.notification_id : "",
      },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const rawUrl = typeof data.url === "string" ? data.url : "/";
  const safePath = rawUrl.startsWith("/") && !rawUrl.startsWith("//") ? rawUrl : "/";
  const targetUrl = new URL(safePath, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        try {
          const clientUrl = new URL(client.url);
          if (clientUrl.origin === self.location.origin && "focus" in client) {
            if ("navigate" in client && client.url !== targetUrl) {
              return client.navigate(targetUrl).then((navigated) => (navigated || client).focus());
            }
            return client.focus();
          }
        } catch {
          /* ignore malformed client URLs */
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
