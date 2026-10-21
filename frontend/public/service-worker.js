/*
 * Retire the legacy cache-first service worker.
 *
 * Older BuyO releases registered a worker that served `/` and `/index.html`
 * from the `shop-cache-v1` cache before going to the network. Those clients
 * would otherwise keep seeing the pre-React page after the cutover. This
 * replacement clears the old caches and unregisters itself; the React app does
 * not register a service worker.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
      await self.clients.claim();
      await self.registration.unregister();
    })(),
  );
});
