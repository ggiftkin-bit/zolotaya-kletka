const SW = "/kletka-sw.js";

const pageTimers = new Map<string, number>();

export function notifyAllowed(): boolean {
  return typeof Notification !== "undefined" && Notification.permission === "granted";
}

export async function ensureNotify(): Promise<boolean> {
  if (typeof window === "undefined" || typeof Notification === "undefined") return false;
  if (Notification.permission === "denied") return false;
  if (Notification.permission !== "granted") {
    const p = await Notification.requestPermission();
    if (p !== "granted") return false;
  }
  await ensureSW();
  return true;
}

async function ensureSW(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register(SW);
    await navigator.serviceWorker.ready;
    return reg;
  } catch {
    return null;
  }
}

export function scheduleNotice(id: string, title: string, body: string, at: number) {
  cancelNotice(id);
  if (typeof window === "undefined") return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const delay = Math.max(0, at - Date.now());
  if (delay <= 0) {
    void ping(title, body, id);
    return;
  }
  void (async () => {
    const reg = await ensureSW();
    reg?.active?.postMessage({ type: "schedule", id, title, body, at });
  })();
  const t = window.setTimeout(() => {
    pageTimers.delete(id);
    void ping(title, body, id);
  }, Math.min(delay, 2_147_000_000));
  pageTimers.set(id, t);
}

export function cancelNotice(id: string) {
  const t = pageTimers.get(id);
  if (t) window.clearTimeout(t);
  pageTimers.delete(id);
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "cancel", id });
  } catch {
    /* ignore */
  }
}

export async function ping(title: string, body: string, tag: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, {
      body,
      tag,
      icon: "/__grok/icon-180.png",
      badge: "/favicon.svg",
    });
  } catch {
    try {
      new Notification(title, { body, tag, icon: "/__grok/icon-180.png" });
    } catch {
      /* ignore */
    }
  }
}

export function maybePingHidden(title: string, body: string, tag: string) {
  if (typeof document === "undefined") return;
  if (document.visibilityState === "visible") return;
  void ping(title, body, tag);
}
