"use client";

import { useEffect, useRef, useState } from "react";
import { BellRing, BellOff, RefreshCw } from "lucide-react";
import { useFarm } from "@/lib/store";
import {
  applicationServerKey,
  currentPushSubscription,
  PUSH_OWNER_KEY,
  type PushConfig,
} from "@/lib/push-client";
import styles from "./PushNotifications.module.css";

export default function PushNotifications() {
  const { user, mode, pushRequest } = useFarm();
  const [supported, setSupported] = useState(false);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [active, setActive] = useState(false);
  const [permission, setPermission] =
    useState<NotificationPermission>("default");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const currentUser = useRef(user?.id);
  currentUser.current = user?.id;

  useEffect(() => {
    let cancelled = false;
    const lifetime = ++generation.current;
    setActive(false);
    setConfig(null);
    setFailed(false);
    setMessage("");
    const capable =
      window.isSecureContext &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    const ios =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    setSupported(capable);
    setNeedsInstall(ios && !standalone);
    if ("Notification" in window) setPermission(Notification.permission);
    if (!user || mode === "demo" || !capable || (ios && !standalone)) return;
    async function inspect() {
      try {
        const status = await pushRequest<PushConfig>(
          "status",
          undefined,
          user!.id,
        );
        if (cancelled) return;
        setConfig(status);
        if (!status.enabled) return;
        const subscription = await currentPushSubscription();
        if (cancelled || !subscription) return;
        let owner: string | null = null;
        try {
          owner = localStorage.getItem(PUSH_OWNER_KEY);
        } catch {
          /* Ask to enable again. */
        }
        if (owner !== user!.id) {
          await subscription.unsubscribe();
          return;
        }
        if (Notification.permission !== "granted") return;
        await pushRequest("subscribe", subscription.toJSON(), user!.id);
        if (!cancelled) setActive(true);
      } catch {
        if (!cancelled) {
          setFailed(true);
          setMessage(
            "Status notifikasi belum dapat diperiksa. Sambungkan internet lalu coba lagi.",
          );
        }
      }
    }
    void inspect();
    return () => {
      cancelled = true;
      if (generation.current === lifetime) generation.current += 1;
    };
  }, [user?.id, mode, pushRequest, revision]);

  async function enable() {
    if (!user || !config?.public_key || busy) return;
    const owner = user.id;
    const lifetime = generation.current;
    const stillCurrent = () =>
      generation.current === lifetime && currentUser.current === owner;
    const guard = () => {
      if (!stillCurrent())
        throw new Error(
          "Akun berubah. Buka kembali pengaturan notifikasi pada akun Anda.",
        );
    };
    let createdSubscription: PushSubscription | null = null;
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      // Ask during the button gesture, before any network await (required on iOS).
      const granted = await Notification.requestPermission();
      guard();
      setPermission(granted);
      if (granted !== "granted") {
        setMessage(
          granted === "denied"
            ? "Izin notifikasi diblokir. Izinkan TernaKu melalui pengaturan notifikasi browser atau HP."
            : "Izin belum diberikan. Tekan Aktifkan notifikasi jika sudah siap.",
        );
        return;
      }
      await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
      guard();
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  "Notifikasi belum siap. Muat ulang aplikasi lalu coba lagi.",
                ),
              ),
            15000,
          ),
        ),
      ]);
      guard();
      let subscription = await registration.pushManager.getSubscription();
      guard();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(config.public_key),
        });
        createdSubscription = subscription;
      }
      guard();
      try {
        localStorage.setItem(PUSH_OWNER_KEY, owner);
      } catch {
        /* Current subscription still works. */
      }
      await pushRequest("subscribe", subscription.toJSON(), owner);
      guard();
      setActive(true);
      setMessage(
        "Notifikasi aktif di HP ini. Setiap pembaruan harga dari atasan akan dikirim, termasuk saat nominalnya sama.",
      );
    } catch (cause) {
      if (createdSubscription) {
        // A late completion must not revoke a subscription now claimed by another account.
        let claimedOwner: string | null = null;
        try {
          claimedOwner = localStorage.getItem(PUSH_OWNER_KEY);
        } catch {
          /* Fall back to the current account. */
        }
        if (
          claimedOwner === owner ||
          (claimedOwner === null &&
            (!currentUser.current || currentUser.current === owner))
        ) {
          await createdSubscription.unsubscribe().catch(() => false);
          try {
            if (localStorage.getItem(PUSH_OWNER_KEY) === owner)
              localStorage.removeItem(PUSH_OWNER_KEY);
          } catch {
            /* Nothing to clear. */
          }
        }
      }
      if (stillCurrent()) {
        setFailed(true);
        setMessage(
          cause instanceof Error
            ? cause.message
            : "Notifikasi belum dapat diaktifkan.",
        );
      }
    } finally {
      if (stillCurrent()) setBusy(false);
    }
  }
  async function disable() {
    if (!user || busy) return;
    const owner = user.id;
    const lifetime = generation.current;
    const stillCurrent = () =>
      generation.current === lifetime && currentUser.current === owner;
    setBusy(true);
    setMessage("");
    try {
      const subscription = await currentPushSubscription();
      if (!stillCurrent()) return;
      if (subscription) {
        await pushRequest(
          "unsubscribe",
          { endpoint: subscription.endpoint },
          owner,
        );
        if (!stillCurrent()) return;
        await subscription.unsubscribe();
      }
      if (!stillCurrent()) return;
      try {
        localStorage.removeItem(PUSH_OWNER_KEY);
      } catch {
        /* Browser storage is optional here. */
      }
      setActive(false);
      setMessage(
        "Notifikasi HP dimatikan. Pemberitahuan di dalam aplikasi tetap tersedia.",
      );
    } catch (cause) {
      if (stillCurrent())
        setMessage(
          cause instanceof Error
            ? cause.message
            : "Belum dapat mematikan notifikasi. Coba lagi.",
        );
    } finally {
      if (stillCurrent()) setBusy(false);
    }
  }
  async function test() {
    if (!user || busy) return;
    const owner = user.id;
    const lifetime = generation.current;
    const stillCurrent = () =>
      generation.current === lifetime && currentUser.current === owner;
    setBusy(true);
    setMessage("");
    try {
      const subscription = await currentPushSubscription();
      if (!stillCurrent()) return;
      if (!subscription)
        throw new Error("Aktifkan notifikasi kembali di HP ini.");
      await pushRequest("test", { endpoint: subscription.endpoint }, owner);
      if (!stillCurrent()) return;
      setMessage(
        "Notifikasi percobaan sudah masuk antrean pengiriman. Periksa panel notifikasi HP; pengiriman dapat memerlukan sekitar satu menit.",
      );
    } catch (cause) {
      if (stillCurrent())
        setMessage(
          cause instanceof Error
            ? cause.message
            : "Notifikasi percobaan belum dapat dikirim.",
        );
    } finally {
      if (stillCurrent()) setBusy(false);
    }
  }
  return (
    <section className={styles.panel} aria-label="Notifikasi HP">
      <div className={styles.heading}>
        <BellRing size={22} />
        <strong>Notifikasi di HP</strong>
        <span>{active ? "Aktif" : "Belum aktif"}</span>
      </div>
      <p>
        Dapatkan pemberitahuan setiap atasan memperbarui harga, walaupun
        harganya sama dan aplikasi sedang ditutup.
      </p>
      {mode === "demo" ? (
        <small>Aktifkan melalui akun Anda di website TernaKu.</small>
      ) : needsInstall ? (
        <small>
          Di iPhone/iPad, pasang TernaKu ke layar utama lalu buka dari ikonnya.
          Memerlukan iOS/iPadOS 16.4 atau lebih baru.
        </small>
      ) : !supported ? (
        <small>
          Browser ini belum mendukung notifikasi HP. Gunakan Chrome di Android
          atau aplikasi TernaKu yang dipasang di iPhone.
        </small>
      ) : (
        <>
          {config && !config.enabled && (
            <small>
              Layanan notifikasi belum siap. Hubungi atasan, lalu periksa
              kembali.
            </small>
          )}
          {permission === "denied" && (
            <small>
              Izin notifikasi diblokir. Buka pengaturan browser/HP untuk
              mengizinkan notifikasi TernaKu.
            </small>
          )}
          <div className={styles.buttons}>
            {active ? (
              <>
                <button
                  type="button"
                  className="btn btn-light"
                  disabled={busy}
                  onClick={() => void test()}
                >
                  Coba notifikasi
                </button>
                <button
                  type="button"
                  className="btn btn-light"
                  disabled={busy}
                  onClick={() => void disable()}
                >
                  <BellOff size={17} /> Matikan
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !config?.enabled || permission === "denied"}
                onClick={() => void enable()}
              >
                {busy ? "Memproses…" : "Aktifkan notifikasi"}
              </button>
            )}
            {(failed ||
              permission === "denied" ||
              (config && !config.enabled)) && (
              <button
                type="button"
                className="btn btn-light"
                disabled={busy}
                onClick={() => setRevision((value) => value + 1)}
              >
                <RefreshCw size={17} /> Periksa lagi
              </button>
            )}
          </div>
        </>
      )}
      {message && (
        <p className={styles.message} role="status">
          {message}
        </p>
      )}
      <small>
        Notifikasi mengikuti koneksi, izin, dan pengaturan hemat baterai/hening
        pada HP.
      </small>
    </section>
  );
}
