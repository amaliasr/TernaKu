/* Only the public offline notice is cached. Prices, accounts, and transactions
 * always use the network; failed writes must never look like saved records. */
const OFFLINE_CACHE = "ternaku-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("ternaku-offline-") && key !== OFFLINE_CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || event.request.mode !== "navigate")
    return;
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(OFFLINE_URL);
      return (
        cached ||
        new Response(
          "Internet terputus. Sambungkan kembali lalu buka TernaKu.",
          {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          },
        )
      );
    }),
  );
});

// Each saved price has a distinct ID, even when the numeric prices are unchanged.
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    /* Show a safe generic notice. */
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    payload = {};
  const title =
    typeof payload.title === "string"
      ? payload.title.slice(0, 120)
      : "Pemberitahuan TernaKu";
  const body =
    typeof payload.body === "string"
      ? payload.body.slice(0, 500)
      : "Buka TernaKu untuk melihat pembaruan harga.";
  const tag =
    typeof payload.tag === "string"
      ? payload.tag.slice(0, 120)
      : "ternaku-update";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      renotify: true,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        try {
          await client.focus();
          return;
        } catch {
          /* Try another window or open one. */
        }
      }
      await self.clients.openWindow("/");
    })(),
  );
});
