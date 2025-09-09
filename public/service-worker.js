// public/service-worker.js
const CACHE = "drumkit-mvp-v1";                    // bump this to invalidate old caches
const APP_SHELL = [
  "/",                                             // entry
  "/index.html",
  "/styles.css",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // 1) Cache-first for WAVs anywhere (e.g., /clap-1.wav or /sounds/kick.wav)
  if (url.pathname.endsWith(".wav")) {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        c.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  // 2) Cache-first for app shell assets
  if (sameOrigin && APP_SHELL.includes(url.pathname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        return caches.open(CACHE).then((c) => { c.put(req, res.clone()); return res; });
      }))
    );
    return;
  }

  // 3) Navigation fallback (SPA) – network-first, then cached index.html
  if (req.mode === "navigate" && sameOrigin) {
    e.respondWith(
      fetch(req).catch(() => caches.match("/index.html"))
    );
    return;
  }

  // 4) Default: network-first with cache fallback (helps when offline)
  e.respondWith(
    fetch(req).then((res) => {
      if (sameOrigin && res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(req, clone));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
