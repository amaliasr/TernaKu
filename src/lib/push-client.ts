export interface PushConfig { enabled: boolean; public_key: string | null }
export const PUSH_OWNER_KEY = "ternaku.push.owner.v1";

export function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const decoded = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const result = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) result[i] = decoded.charCodeAt(i);
  return result;
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration?.pushManager ? registration.pushManager.getSubscription() : null;
}

/** Revoke this browser's subscription before clearing its signed-in account. */
export async function detachBrowserPush(): Promise<string | undefined> {
  try { localStorage.removeItem(PUSH_OWNER_KEY); } catch { /* Permission may have been revoked. */ }
  let endpoint: string | undefined;
  try {
    const subscription = await currentPushSubscription();
    if (!subscription) return;
    endpoint = subscription.endpoint;
    await subscription.unsubscribe();
  } catch { /* Server logout can still remove a known endpoint. */ }
  return endpoint;
}
