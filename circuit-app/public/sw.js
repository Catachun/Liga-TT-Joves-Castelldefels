// This service worker no longer caches anything. Its only job is to clean up
// any previously installed version, delete old caches, and unregister itself
// so the app always loads fresh from the network (with the no-cache headers
// already set on the server side).
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clientsList = await self.clients.matchAll({ type: "window" });
      clientsList.forEach((client) => client.navigate(client.url));
    })()
  );
});
