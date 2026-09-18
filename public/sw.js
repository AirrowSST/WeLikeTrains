const CACHE = "wayce-v3";
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const html = await (await fetch("/")).text();
      const assets = [
        ...html.matchAll(/(?:src|href)="([^\"]+\.(?:js|css))"/g),
      ].map((match) => match[1]);
      await cache.addAll([
        "/",
        "/icon.svg",
        "/manifest.webmanifest",
        "/fonts/fonts.css",
        "/fonts/public-sans-latin.woff2",
        "/fonts/public-sans-latin-italic.woff2",
        "/data/basemap.json",
        ...assets,
      ]);
    })(),
  );
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(
            caches.open(CACHE).then((cache) => cache.put(event.request, copy)),
          );
        }
        return response;
      })
      .catch(
        async () =>
          (await caches.match(event.request)) ||
          (event.request.mode === "navigate"
            ? await caches.match("/")
            : new Response("Offline", { status: 503 })),
      ),
  );
});
self.addEventListener("push", (event) => {
  let data = {
    title: "Your commute",
    body: "Open Wayce for your update.",
    url: "/",
  };
  try {
    data = { ...data, ...event.data.json() };
  } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: "commute-advice",
      data: { url: "/" },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((windows) => {
      const existing = windows.find((w) =>
        w.url.startsWith(self.location.origin),
      );
      return existing ? existing.focus() : clients.openWindow("/");
    }),
  );
});
