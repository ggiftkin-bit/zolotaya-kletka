/* Offline timers for «Золотая Клетка»: ход, охота, сила. */
const timers = new Map();

self.addEventListener("install", (event) => {
  self.skipWaiting();
  void event;
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "cancel") {
    const t = timers.get(data.id);
    if (t) clearTimeout(t);
    timers.delete(data.id);
    return;
  }
  if (data.type !== "schedule") return;
  const old = timers.get(data.id);
  if (old) clearTimeout(old);
  const delay = Math.max(0, Number(data.at) - Date.now());
  const t = setTimeout(() => {
    timers.delete(data.id);
    void self.registration.showNotification(String(data.title || "Клетка"), {
      body: String(data.body || ""),
      tag: String(data.id || "kletka"),
      icon: "/__grok/icon-180.png",
      badge: "/favicon.svg",
      renotify: true,
    });
  }, Math.min(delay, 2147483647));
  timers.set(data.id, t);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
      return undefined;
    }),
  );
});
