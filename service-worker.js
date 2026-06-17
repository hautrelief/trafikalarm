const CACHE_NAME = "trafikalarm-prototype-v8";
const ASSETS = [
  "./public/mobilepay-qr.png",
  "./public/login-background.jpg",
  "./public/app-icon-96.png",
  "./public/app-icon-192.png",
  "./public/app-icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request, { cache: "reload" }).catch(() =>
      caches.match(event.request).then((cached) => cached || Response.error())
    )
  );
});
