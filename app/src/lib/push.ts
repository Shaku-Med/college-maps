export function isStandaloneApp() {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

function hasPushApis() {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
}

/** iOS only delivers Web Push from a home-screen app. Windows and Android browsers can subscribe in a tab. */
function requiresStandalonePush() {
  if (typeof window === "undefined") return false;
  const nav = window.navigator;
  return /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
}

export function canOfferNotifications() {
  if (!hasPushApis()) return false;
  if (requiresStandalonePush()) return isStandaloneApp();
  return true;
}

function urlBase64ToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const PUSH_UNAVAILABLE = "Notifications are not available.";
const PUSH_DENIED = "Notifications were not allowed on this device.";

export async function currentPushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

function isPushServiceFailure(err: unknown) {
  const message = err instanceof Error ? err.message : "";
  return (err instanceof DOMException && err.name === "AbortError") || /push service/i.test(message);
}

async function subscribeWithKey(registration: ServiceWorkerRegistration, publicKey: string) {
  const key = urlBase64ToBytes(publicKey);
  if (key.byteLength !== 65 || key[0] !== 0x04) {
    throw new Error(PUSH_UNAVAILABLE);
  }
  try {
    return await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength),
    });
  } catch (err) {
    if (!isPushServiceFailure(err)) throw err;
    return await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: publicKey,
    });
  }
}

export async function enablePush(publicKey: string) {
  if (!window.isSecureContext || Notification.permission === "denied") {
    throw new Error(Notification.permission === "denied" ? PUSH_DENIED : PUSH_UNAVAILABLE);
  }
  if (Notification.permission !== "granted") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error(PUSH_DENIED);
    }
  }
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error(PUSH_UNAVAILABLE)), 8000);
    }),
  ]);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    const current = subscription.options.applicationServerKey;
    const expected = urlBase64ToBytes(publicKey);
    const sameKey =
      current &&
      current.byteLength === expected.byteLength &&
      new Uint8Array(current).every((byte, i) => byte === expected[i]);
    if (!sameKey) {
      await subscription.unsubscribe();
      subscription = null;
    }
  }
  try {
    subscription ??= await subscribeWithKey(registration, publicKey);
  } catch {
    throw new Error(PUSH_UNAVAILABLE);
  }
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error(PUSH_UNAVAILABLE);
  }
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
}

export async function disablePush() {
  const subscription = await currentPushSubscription();
  const endpoint = subscription?.endpoint;
  if (subscription) await subscription.unsubscribe();
  return endpoint;
}
