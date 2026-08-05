/* Easyway LMS service worker — community push notifications. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Easyway community", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Easyway community";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // Same tag collapses repeat notifications for one thread into a single
    // entry instead of stacking a dozen buzzes for one busy conversation.
    tag: payload.tag || "easyway-community",
    renotify: true,
    data: { url: payload.url || "/community" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/community";

  // Focus an already-open tab when there is one, rather than piling up tabs.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(target) && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    }),
  );
});
