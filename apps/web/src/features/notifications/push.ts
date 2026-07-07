import { postPushSubscribe, type PushSubscriptionPayload } from "./api";

const PUSH_SYNC_COOLDOWN_MS = 30_000;

const pushSyncState = {
  inFlight: false,
  lastUserId: null as string | null,
  lastAttemptAt: 0,
};

function pushSubscriptionToPayload(subscription: PushSubscription): PushSubscriptionPayload | null {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return null;
  }
  return {
    endpoint: json.endpoint,
    keys: {
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
    user_agent: navigator.userAgent,
    device_label: navigator.platform || null,
  };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (!isPushSupported()) {
    return "unsupported";
  }
  return Notification.permission;
}

export async function getActivePushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) {
    return null;
  }
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function createBrowserPushSubscription(publicKey: string): Promise<PushSubscriptionPayload> {
  if (!isPushSupported()) {
    throw new Error("Push notifications are not supported in this browser.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Push notification permission was not granted.");
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("The browser did not provide a complete push subscription.");
  }
  return {
    endpoint: json.endpoint,
    keys: {
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
    user_agent: navigator.userAgent,
    device_label: navigator.platform || null,
  };
}

export async function unsubscribeBrowserPush(): Promise<string | null> {
  const subscription = await getActivePushSubscription();
  if (!subscription) {
    return null;
  }
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  return endpoint;
}

/**
 * Re-post an existing browser push subscription so the backend session_id matches
 * the current auth session. Never requests notification permission.
 */
export async function syncExistingPushSubscriptionForCurrentSession(userId: string): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }
  if (process.env.NODE_ENV !== "production") {
    return false;
  }
  if (!("serviceWorker" in navigator) || !("Notification" in window) || !("PushManager" in window)) {
    return false;
  }
  if (Notification.permission !== "granted") {
    return false;
  }

  const now = Date.now();
  const userChanged = pushSyncState.lastUserId !== userId;
  pushSyncState.lastUserId = userId;
  if (pushSyncState.inFlight) {
    return false;
  }
  if (!userChanged && now - pushSyncState.lastAttemptAt < PUSH_SYNC_COOLDOWN_MS) {
    return false;
  }

  pushSyncState.inFlight = true;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      return false;
    }
    const payload = pushSubscriptionToPayload(subscription);
    if (!payload) {
      return false;
    }
    await postPushSubscribe(payload);
    pushSyncState.lastAttemptAt = Date.now();
    return true;
  } catch {
    return false;
  } finally {
    pushSyncState.inFlight = false;
  }
}
