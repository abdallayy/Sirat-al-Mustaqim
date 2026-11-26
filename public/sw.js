const CACHE_NAME = "sirat-app-v4";
const APP_BASE_PATH = new URL(self.registration.scope).pathname;
const APP_ROOT_URL = new URL(APP_BASE_PATH, self.location.origin).href;
const appPath = (path) => `${APP_BASE_PATH}${path}`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll([
        appPath(""),
        appPath("manifest.webmanifest"),
        appPath("icon.svg"),
        appPath("data/quran.json"),
      ]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("sirat-app-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  const appRelativePath = url.pathname.startsWith(APP_BASE_PATH)
    ? `/${url.pathname.slice(APP_BASE_PATH.length)}`
    : url.pathname;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const cacheable =
            ["/", "/manifest.webmanifest", "/icon.svg", "/data/quran.json"].includes(appRelativePath) ||
            /^\/data\/hadith-(bukhari|muslim)\.json$/.test(appRelativePath) ||
            appRelativePath.startsWith("/assets/");
          if (cacheable) {
            const length = Number(response.headers.get("content-length") ?? 0);
            if (!length || length <= 10_000_000) {
              const copy = response.clone();
              void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch((error) => {
                console.warn("Could not cache an offline resource.", error);
              });
            }
          }
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const appShell = await caches.match(APP_ROOT_URL);
          if (appShell) return appShell;
        }
        return Response.error();
      }),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = typeof payload.title === "string" ? payload.title : "الصراط المستقيم";
  const body = typeof payload.body === "string" ? payload.body : "حان موعد الصلاة.";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: typeof payload.id === "string" ? payload.id : undefined,
      icon: appPath("icon.svg"),
      vibrate: [180, 90, 180],
      data: { url: `${APP_BASE_PATH}?section=prayer` },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const target = new URL(`${APP_BASE_PATH}?section=prayer`, self.location.origin).href;
      const existing = windows.find((client) => {
        const clientUrl = new URL(client.url);
        return clientUrl.origin === self.location.origin &&
          clientUrl.pathname.startsWith(APP_BASE_PATH);
      });
      if (existing) {
        await existing.navigate(target);
        return existing.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
