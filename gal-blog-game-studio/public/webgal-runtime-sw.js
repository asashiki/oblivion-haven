const CACHE_PREFIX = "gal-blog-studio-webgal-preview-";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith("/webgal-runtime/session/")) return;
  event.respondWith(
    caches.match(event.request).then((cached) => (
      cached || new Response("WebGAL preview file not found", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    )),
  );
});

self.addEventListener("message", (event) => {
  if (event.data !== "cleanup-webgal-preview-caches") return;
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith(CACHE_PREFIX)).map((key) => caches.delete(key)),
    )),
  );
});
