const VERSION = "v6";
const APP_CACHE = `csi-map-app-${VERSION}`;
const TILE_CACHE = `csi-map-tiles-${VERSION}`;
const TILE_ORIGINS = new Set(
  (new URL(self.location.href).searchParams.get("origins") ?? "").split(",").flatMap((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.origin === value ? [url.origin] : [];
    } catch {
      return [];
    }
  }),
);
const MAX_TILE_ENTRIES = 1500;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith("csi-map-") && !key.endsWith(VERSION)).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isDevHost() {
  return self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1";
}

function isNextBuild(url) {
  return url.origin === self.location.origin && url.pathname.startsWith("/_next/");
}

function isStaticAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/maplibre/") ||
      url.pathname.startsWith("/icons/") ||
      url.pathname === "/favicon.ico" ||
      url.pathname === "/manifest.webmanifest")
  );
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

let tilePuts = 0;

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - maxEntries)).map((key) => cache.delete(key)));
}

function staleWhileRevalidate(event, cacheName) {
  const opened = caches.open(cacheName);
  const network = fetch(event.request).then(async (response) => {
    if (response.ok) {
      const cache = await opened;
      await cache.put(event.request, response.clone());
      if (++tilePuts % 50 === 0) await trimCache(cacheName, MAX_TILE_ENTRIES);
    }
    return response;
  });
  // Registered synchronously so the background refresh may outlive an instant cached response.
  event.waitUntil(network.catch(() => undefined));
  return opened.then((cache) => cache.match(event.request)).then((cached) => cached ?? network);
}

// One cached copy of the page, keyed without its query, so arbitrary links cannot grow the cache.
// The copy carries its own CSP header and nonce, so it stays internally consistent offline.
async function networkFirstPage(request) {
  const cache = await caches.open(APP_CACHE);
  const key = new URL(request.url).origin + "/";
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(key, response.clone());
    return response;
  } catch {
    return (await cache.match(key)) ?? Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Host tooling and unique CSP nonces must not be served from the tile/app cache.
  if (url.pathname.startsWith("/.netlify/") || url.pathname.startsWith("/v1/")) return;
  // Turbopack reuses /_next/ URLs while the SSR HTML changes, so a cache-first hit
  // hydrates the previous map chrome against the new markup.
  if (isDevHost() && (isNextBuild(url) || request.mode === "navigate")) return;
  if (request.mode === "navigate" && url.origin === self.location.origin) {
    event.respondWith(networkFirstPage(request));
  } else if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, APP_CACHE));
  } else if (TILE_ORIGINS.has(url.origin)) {
    event.respondWith(staleWhileRevalidate(event, TILE_CACHE));
  }
});

self.addEventListener("push", (event) => {
  let data = { title: "Campus map", body: "", url: "/" };
  try {
    const payload = event.data?.json();
    if (payload && typeof payload === "object") {
      if (typeof payload.title === "string" && payload.title) data.title = payload.title.slice(0, 80);
      if (typeof payload.body === "string") data.body = payload.body.slice(0, 160);
      if (typeof payload.url === "string" && payload.url.startsWith("/")) data.url = payload.url;
    }
  } catch {
    const text = event.data?.text();
    if (text) data.body = text.slice(0, 160);
  }
  if (self.registration.showNotification && Notification.permission === "granted") {
    event.waitUntil(
      self.registration.showNotification(data.title, {
        body: data.body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data: { url: data.url },
      }),
    );
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => "focus" in client);
      if (existing) return existing.focus();
      return self.clients.openWindow(target);
    }),
  );
});
