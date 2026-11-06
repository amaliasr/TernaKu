export type NativePlatform = "android" | "ios";
export type NativeAction = "status" | "enable" | "disable" | "settings" | "bound" | "unbound";
export type PushRoute = "status" | "subscribe" | "unsubscribe" | "test" |
  "native/subscribe" | "native/unsubscribe" | "native/test";

export interface NativeDevice {
  platform: NativePlatform;
  installation_id: string;
  status: "granted" | "default" | "denied" | "unavailable";
  token?: string;
  environment?: "sandbox" | "production";
  optedOut?: boolean;
}

type Bridge = { postMessage(message: string): void };
type NativeWindow = Window & {
  TernaKuAndroid?: Bridge;
  webkit?: { messageHandlers?: { TernaKuIOS?: Bridge } };
};

function bridge(platform: NativePlatform): Bridge | undefined {
  const host = window as NativeWindow;
  return platform === "android" ? host.TernaKuAndroid : host.webkit?.messageHandlers?.TernaKuIOS;
}

export function nativePlatform(): NativePlatform | null {
  if (typeof window === "undefined") return null;
  if (bridge("android")?.postMessage) return "android";
  if (bridge("ios")?.postMessage) return "ios";
  return null;
}

export function deviceRequest(platform: NativePlatform, action: NativeAction, binding?: { user_id: string; binding_id: string }): Promise<NativeDevice> {
  const target = bridge(platform);
  if (!target) return Promise.reject(new Error("Buka TernaKu dari aplikasi yang terpasang di HP."));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    function cleanup() {
      window.clearTimeout(timer);
      window.removeEventListener("ternaku:native-push", receive);
    }
    function receive(event: Event) {
      const result = (event as CustomEvent<NativeDevice & { requestId: string }>).detail;
      if (!result || result.requestId !== requestId || result.platform !== platform) return;
      cleanup();
      if (typeof result.installation_id !== "string" ||
          !["default", "granted", "denied", "unavailable"].includes(result.status)) {
        reject(new Error("HP belum dapat memeriksa notifikasi. Coba lagi."));
      } else {
        resolve(result);
      }
    }
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Belum ada jawaban dari HP. Periksa izin notifikasi lalu coba lagi."));
    }, action === "enable" ? 120000 : 20000);
    window.addEventListener("ternaku:native-push", receive);
    try { target.postMessage(JSON.stringify({ action, requestId, ...binding })); }
    catch (error) { cleanup(); reject(error); }
  });
}
