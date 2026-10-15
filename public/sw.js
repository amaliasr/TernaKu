/* Only the public offline notice is cached. Prices, accounts, and transactions
 * always use the network; failed writes must never look like saved records. */
const OFFLINE_CACHE = "ternaku-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith("ternaku-offline-") && key !== OFFLINE_CACHE)
        .map((key) => caches.delete(key)),
    )).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || event.request.mode !== "navigate") return;
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cached = await caches.match(OFFLINE_URL);
    return cached || new Response("Internet terputus. Sambungkan kembali lalu buka TernaKu.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }));
});
