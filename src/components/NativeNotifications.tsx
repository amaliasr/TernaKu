"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { BellRing } from "lucide-react";
import { deviceRequest, nativePlatform, type NativeDevice, type NativePlatform } from "@/lib/native-push";
import { useFarm } from "@/lib/store";
import styles from "./PushNotifications.module.css";

type Task = "inspect" | "enable" | "disable" | "test" | "settings";
type Panel = { active: boolean; busy: boolean; denied: boolean; configured: boolean; message: string; run(task: Task): void };
const NativeContext = createContext<Panel | null>(null);
const subscribe = () => () => {};
export function useNativePanel() { return useContext(NativeContext); }

export function NativePushProvider({ children }: { children: ReactNode }) {
  const platform = useSyncExternalStore(subscribe, nativePlatform, () => null);
  const { user, mode } = useFarm();
  if (!platform || !user || mode !== "live") return children;
  return <DeviceSession key={user.id} platform={platform} userId={user.id} employee={user.role === "employee"}>{children}</DeviceSession>;
}

function DeviceSession({ children, platform, userId, employee }: {
  children: ReactNode; platform: NativePlatform; userId: string; employee: boolean;
}) {
  const { pushRequest } = useFarm();
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [message, setMessage] = useState("");
  const lifetime = useRef(0);
  const running = useRef(false);
  const refreshAgain = useRef(false);
  const prompted = useRef(false);
  const registered = useRef<NativeDevice | null>(null);

  const run = useCallback(async function perform(task: Task) {
    if (running.current) {
      if (task === "inspect") refreshAgain.current = true;
      return;
    }
    const epoch = lifetime.current;
    const current = () => lifetime.current === epoch;
    running.current = true;
    setBusy(true);
    try {
      if (task === "test" && registered.current) {
        const { installation_id } = registered.current;
        await pushRequest("native/test", { platform, installation_id }, userId);
        if (current()) setMessage("Pesan percobaan sudah masuk antrean. Periksa notifikasi di HP ini.");
        return;
      }
      if (task === "settings") {
        await deviceRequest(platform, "settings");
        return;
      }
      if (task === "disable" && registered.current) {
        const { installation_id } = registered.current;
        await pushRequest("native/unsubscribe", { platform, installation_id }, userId);
        if (!current()) return;
        registered.current = null;
        setActive(false);
        await deviceRequest(platform, "disable");
        if (current()) setMessage("Notifikasi harga di HP ini sudah dimatikan.");
        return;
      }

      const config = await pushRequest<{ native?: Partial<Record<NativePlatform, boolean>> }>("status", undefined, userId);
      if (!current()) return;
      const ready = config.native?.[platform] === true;
      setConfigured(ready);
      if (!ready) {
        registered.current = null;
        setActive(false);
        setMessage("Pengiriman ke aplikasi HP sedang menunggu pengaturan dari pengelola TernaKu.");
        return;
      }
      let device = await deviceRequest(platform, task === "enable" ? "enable" : "status");
      if (!current()) return;
      if (task === "inspect" && employee && device.status === "default" && !device.optedOut && !prompted.current) {
        prompted.current = true;
        device = await deviceRequest(platform, "enable");
        if (!current()) return;
      }
      setDenied(device.status === "denied");
      const identity = { platform, installation_id: device.installation_id };
      if (device.status !== "granted" || !device.token || device.optedOut) {
        if (device.status === "denied" || device.optedOut) {
          await pushRequest("native/unsubscribe", identity, userId);
          if (!current()) return;
        }
        registered.current = null;
        setActive(false);
        setMessage(device.status === "denied" ? "Izinkan notifikasi TernaKu di pengaturan HP."
          : device.status === "unavailable" || (device.status === "granted" && !device.token)
            ? "HP belum dapat terhubung ke layanan notifikasi. Periksa kembali saat tersambung internet."
            : "Aktifkan untuk menerima harga saat aplikasi ditutup.");
        return;
      }
      if (registered.current?.token !== device.token || registered.current.installation_id !== device.installation_id) {
        const registration = await pushRequest<{ binding_id: string }>("native/subscribe", { ...identity, token: device.token, ...(platform === "ios" ? { environment: device.environment } : {}) }, userId);
        if (!current()) return;
        if (platform === "android") await deviceRequest(platform, "bound", { user_id: userId, binding_id: registration.binding_id });
        if (!current()) return;
        registered.current = device;
      }
      setActive(true);
      if (task === "enable") setMessage("HP ini sudah terdaftar untuk menerima pembaruan harga.");
      else setMessage("");
    } catch (error) {
      if (current()) setMessage(error instanceof Error ? error.message : "Belum dapat mengatur notifikasi. Coba lagi.");
    } finally {
      if (current()) {
        running.current = false;
        setBusy(false);
        if (refreshAgain.current) {
          refreshAgain.current = false;
          void perform("inspect");
        }
      }
    }
  }, [employee, platform, pushRequest, userId]);

  useEffect(() => {
    running.current = false;
    const inspect = () => { if (!document.hidden) void run("inspect"); };
    inspect();
    window.addEventListener("ternaku:native-token-changed", inspect);
    window.addEventListener("online", inspect);
    document.addEventListener("visibilitychange", inspect);
    return () => {
      lifetime.current++;
      window.removeEventListener("ternaku:native-token-changed", inspect);
      window.removeEventListener("online", inspect);
      document.removeEventListener("visibilitychange", inspect);
    };
  }, [run]);
  return <NativeContext.Provider value={{ active, busy, denied, configured, message, run }}>{children}</NativeContext.Provider>;
}

export function NativeNotificationPanel({ panel }: { panel: Panel }) {
  const { active, busy, configured, denied, message, run } = panel;
  return <section className={styles.panel} aria-label="Notifikasi HP">
    <div className={styles.heading}><BellRing size={22} /><strong>Notifikasi di HP</strong><span>{active ? "Aktif" : "Belum aktif"}</span></div>
    <p>Terima pemberitahuan setiap atasan menyimpan harga, termasuk saat nominalnya sama dan aplikasi ditutup.</p>
    <div className={styles.buttons}>
      {active ? <>
        <button type="button" className="btn btn-light" disabled={busy} onClick={() => run("test")}>Coba notifikasi</button>
        <button type="button" className="btn btn-light" disabled={busy} onClick={() => run("disable")}>Matikan</button>
      </> : <button type="button" className="btn btn-primary" disabled={busy}
        onClick={() => run(!configured ? "inspect" : denied ? "settings" : "enable")}>
        {busy ? "Memeriksa…" : !configured ? "Periksa lagi" : denied ? "Buka pengaturan HP" : "Aktifkan notifikasi"}
      </button>}
    </div>
    {message && <p role="status" className={styles.message}>{message}</p>}
  </section>;
}
