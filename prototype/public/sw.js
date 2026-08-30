/* Easyway LMS service worker — push notifications, and the offline shell. */

/**
 * Bump this to retire every previously cached file.
 *
 * Caches are keyed by name, so a new version means a new cache, and `activate`
 * deletes the old ones. Without that, a student who installed the app in
 * August would still be served August's JavaScript in December.
 */
const CACHE = "easyway-v2";

/**
 * The pages worth having before the network is asked.
 *
 * Deliberately tiny. It is tempting to precache the dashboard, but every
 * portal page is server-rendered per user — a cached copy is somebody's
 * private timetable sitting in a shared cache, and the wrong person's data is
 * far worse than an offline notice.
 *
 * `/materials/offline` is the ONE exception, and it is safe: that route is
 * client-only, renders no session and no per-user data server-side, and reads
 * nothing but the device's own IndexedDB. A shared cached copy of it leaks
 * nothing. It is what a student opens on the train to watch a downloaded
 * class, so it must load with no network.
 */
const PRECACHE = ["/offline", "/materials/offline"];

/** The navigations we are allowed to serve from cache (see PRECACHE note). */
const CACHEABLE_NAVIGATIONS = new Set(["/materials/offline"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      // A failed precache must not abort the install — push notifications and
      // installability do not depend on it, and a service worker stuck in
      // "installing" is worse than one with a cold cache.
      .catch(() => undefined)
      // Activate new deployments immediately. The app listens for
      // controllerchange and reloads once onto the new build.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/**
 * WHAT IS AND IS NOT CACHED, and why the exclusions are the important half.
 *
 * A service worker sits in front of every request the app makes, so a careless
 * fetch handler in a school portal is a data-leak mechanism rather than a
 * performance feature. Three rules:
 *
 *   1. Only GET. A cached POST is meaningless and replaying one is dangerous.
 *   2. Never /api/ and never /auth/. These carry one student's marks, one
 *      tutor's roster, one person's session. On a shared phone — which in this
 *      school is common — a cached API response is the previous user's data
 *      handed to the next one.
 *   3. Only same-origin. Paystack, LiveKit and the storage bucket manage their
 *      own caching and must not be intercepted.
 *
 * What is left is the immutable build output under /_next/static/ (content
 * hashed, so it can be cached forever and served cache-first) and navigations,
 * which go to the network first and fall back to the offline page only when
 * the network genuinely fails. Network-first matters: a stale cached shell
 * would show a student yesterday's portal and look like the app was broken.
 */
self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  /**
   * Immutable build assets: cache-first, and fill the cache on first miss.
   *
   * The `webpack/` exclusion is for development only, and it is not cosmetic:
   * hot-update chunks live under this same prefix, are written fresh on every
   * edit, and are anything but immutable. Caching them means the next edit is
   * served the previous edit's module and HMR appears to have stopped working
   * — a failure that looks like a bug in whatever you were just editing.
   */
  if (url.pathname.startsWith("/_next/static/") && !url.pathname.startsWith("/_next/static/webpack/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Page navigations: network-first, offline notice as the last resort.
  if (request.mode === "navigate") {
    // The downloads shelf is allowed to come from cache and refresh in the
    // background — it holds no user data and has to open with no network.
    if (CACHEABLE_NAVIGATIONS.has(url.pathname)) {
      event.respondWith(
        caches.match(url.pathname).then((hit) => {
          const network = fetch(request)
            .then((response) => {
              if (response.ok) {
                const copy = response.clone();
                caches.open(CACHE).then((cache) => cache.put(url.pathname, copy));
              }
              return response;
            })
            .catch(() => hit);
          return hit || network;
        }),
      );
      return;
    }

    event.respondWith(
      fetch(request).catch(() =>
        caches.match("/offline").then((hit) => hit || new Response("You are offline.", {
          status: 503,
          headers: { "Content-Type": "text/plain" },
        })),
      ),
    );
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Easyway", body: event.data ? event.data.text() : "" };
  }

  // Every notify() send now carries its own title/body/url/tag, whatever the
  // kind — class, payment, result, message. The old "community" defaults are
  // only the last resort for a malformed push.
  const title = payload.title || "Easyway";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    silent: false,
    // Same tag collapses repeat notifications for one thread into a single
    // entry instead of stacking a dozen buzzes for one busy conversation.
    tag: payload.tag || "easyway",
    renotify: true,
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  // Focus an already-open tab when there is one, rather than piling up tabs.
  // A bare "/" target matches any tab, so only prefer an existing tab when the
  // notification points somewhere specific; otherwise just open the app.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      if (target.length > 1) {
        for (const client of clients) {
          if (client.url.includes(target) && "focus" in client) return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      if (clients[0] && "focus" in clients[0]) return clients[0].focus();
      return undefined;
    }),
  );
});
