"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  accountAccessError,
  emptyState,
  executeCommand,
  registerDemoEmployee,
  visibleState,
} from "./domain";
import { createDemoState, DEMO_PASSWORD } from "./seed";
import { refreshInterval, SessionSync } from "./session-sync";
import { ApiError } from "./request-errors";
import { readApiResponse } from "./api-response";
import { requestTimeout } from "./request-timeout";
import { isPriceSyncResponse, mergePriceSync, refreshKind } from "./price-sync";
import { MediaCache, mediaPath } from "./media-cache";
import { readPendingRequestIds } from "./request-retries";
import { detachBrowserPush } from "./push-client";
import { demoPasswordMatches, parseDemoCredentials, persistDemoData, renameDemoCredential, type DemoCredentials } from "./demo-credentials";
import {
  AUTH_SESSION_KEY,
  clearSession,
  isExpiredSession,
  parseSession,
  restoreSession,
  saveSession,
} from "./auth-session";
export {
  isUncertainWriteError,
  shouldPreserveUnconfirmedWrite,
} from "./request-errors";
import type {
  CommandPayload,
  MediaReference,
  PriceSyncResponse,
  RegistrationAvailability,
  RegistrationInput,
  RegistrationResult,
  State,
  User,
} from "./types";

export type FarmMode = "demo" | "live";
export interface PriceSync {
  lastSuccessAt: number | null;
  refreshing: boolean;
  error: string | null;
}
const emptyPriceSync: PriceSync = {
  lastSuccessAt: null,
  refreshing: false,
  error: null,
};
interface FarmContextValue {
  state: State;
  user: User | null;
  mode: FarmMode;
  loading: boolean;
  sessionRecovery: boolean;
  error: string | null;
  priceSync: PriceSync;
  login: (email: string, password: string) => Promise<void>;
  registrationStatus: () => Promise<RegistrationAvailability>;
  register: (input: RegistrationInput) => Promise<RegistrationResult>;
  logout: () => Promise<void>;
  command: (
    action: string,
    payload: CommandPayload,
    requestId?: string,
  ) => Promise<State>;
  loadMedia: (reference: MediaReference) => Promise<Blob>;
  refresh: () => Promise<void>;
  pushRequest: <T>(
    action: "status" | "subscribe" | "unsubscribe" | "test",
    body?: unknown,
    expectedUserId?: string,
  ) => Promise<T>;
}
const Context = createContext<FarmContextValue | undefined>(undefined);
const STORAGE_KEY = "ternaku.demo.v1";
const DEMO_USER_KEY = "ternaku.demo.user";
const DEMO_AUTH_KEY = "ternaku.demo.credentials";
const RETRY_KEY = "ternaku.api.pending";
const API_URL = (
  process.env.NEXT_PUBLIC_API_URL || "https://api.buildmanagement.id/ternaku"
).replace(/\/$/, "");
const mode: FarmMode =
  process.env.NEXT_PUBLIC_DEMO_MODE === "true" ? "demo" : "live";
function isState(value: unknown): value is State {
  if (!value || typeof value !== "object") return false;
  return [
    "users",
    "barns",
    "productions",
    "pickups",
    "sales",
    "prices",
    "feeds",
    "feed_purchases",
    "feed_usages",
    "notifications",
    "activity",
    "corrections",
  ].every((key) => Array.isArray((value as Record<string, unknown>)[key]));
}
async function passwordHash(email: string, password: string): Promise<string> {
  return digest(`ternaku-demo:${email}:${password}`);
}
async function digest(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
async function request<T>(
  path: string,
  token: string | null,
  body?: unknown,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeout(path, body));
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
      cache: "no-store",
    });
    return await readApiResponse<T>(response);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError")
      throw new Error(
        path === "/commands"
          ? "Koneksi terlalu lambat untuk memastikan hasil penyimpanan. Data mungkin sudah tersimpan. Coba lagi tanpa mengubah isian."
          : "Memuat data terlalu lama. Periksa koneksi internet, lalu coba kembali.",
      );
    if (cause instanceof TypeError)
      throw new Error(
        path === "/commands"
          ? "Koneksi terputus saat menyimpan. Data mungkin sudah tersimpan. Sambungkan internet, lalu coba lagi tanpa mengubah isian."
          : "Belum dapat terhubung ke server. Periksa koneksi internet, lalu coba kembali.",
      );
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestMedia(reference: MediaReference, token: string): Promise<Blob> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${API_URL}${mediaPath(reference)}`, {
      headers: { Accept: "image/jpeg, image/png, image/webp", Authorization: `Bearer ${token}` },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      await readApiResponse(response);
      throw new ApiError(`Foto belum dapat dimuat (HTTP ${response.status}).`, response.status);
    }
    const mime = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
    if (!mime || !["image/jpeg", "image/png", "image/webp"].includes(mime))
      throw new Error("Server belum mengirim foto yang dapat dibaca.");
    const blob = await response.blob();
    if (!blob.size) throw new Error("Foto masih kosong. Coba muat kembali.");
    return blob;
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError")
      throw new Error("Foto terlalu lama dimuat. Periksa koneksi internet, lalu coba kembali.");
    if (cause instanceof TypeError)
      throw new Error("Foto belum dapat dimuat. Periksa koneksi internet, lalu coba kembali.");
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
}

export function FarmProvider({ children }: { children: ReactNode }) {
  const [allState, setAllState] = useState<State>(emptyState);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionRecovery, setSessionRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priceSync, setPriceSync] = useState<PriceSync>(emptyPriceSync);
  const sync = useRef(new SessionSync());
  const stateRef = useRef(allState);
  const userRef = useRef(user);
  const tokenRef = useRef<string | null>(null);
  const sessionUserId = useRef<string | null>(null);
  const authEpoch = useRef(0);
  const lastFullRefresh = useRef(0);
  const mediaCache = useRef(new MediaCache());
  const commit = useCallback((next: State) => {
    stateRef.current = next;
    setAllState(next);
    setPriceSync((previous) => ({
      ...previous,
      lastSuccessAt: Date.now(),
      error: null,
    }));
    if (userRef.current) {
      const updated = next.users.find(
        (u) => u.id === userRef.current?.id && !accountAccessError(u),
      );
      if (updated) {
        userRef.current = updated;
        setUser(updated);
      } else {
        userRef.current = null;
        setUser(null);
      }
    }
  }, []);
  const setSessionUser = useCallback((next: User | null) => {
    if (userRef.current?.id !== next?.id || userRef.current?.role !== next?.role) {
      sync.current.invalidate();
      mediaCache.current.clear();
      lastFullRefresh.current = 0;
    }
    userRef.current = next;
    setUser(next);
  }, []);
  const invalidateSession = useCallback(() => {
    const previousToken = tokenRef.current;
    ++authEpoch.current;
    sync.current.invalidate();
    mediaCache.current.clear();
    lastFullRefresh.current = 0;
    tokenRef.current = null;
    sessionUserId.current = null;
    try {
      clearSession(localStorage, sessionStorage, previousToken);
    } catch {
      /* Always clear the current view even if browser storage is unavailable. */
    }
    setSessionRecovery(false);
    setSessionUser(null);
    commit(emptyState());
    setPriceSync(emptyPriceSync);
  }, [commit, setSessionUser]);
  const refreshData = useCallback(
    (background = false) => {
      const refreshToken = tokenRef.current;
      const refreshEpoch = authEpoch.current;
      if (mode === "live" && !refreshToken) return Promise.resolve();
      const kind = mode === "live" ? refreshKind(background, userRef.current?.role, lastFullRefresh.current) : "full";
      return sync.current.refresh(async ({ canApply, sessionActive }) => {
        if (!canApply()) return;
        setPriceSync((previous) => ({ ...previous, refreshing: true }));
        try {
          let next: State;
          let full = kind === "full";
          if (mode === "demo") {
            const stored = localStorage.getItem(STORAGE_KEY);
            const parsed: unknown = stored
              ? JSON.parse(stored)
              : stateRef.current;
            if (!isState(parsed)) throw new Error("Data demo tidak valid.");
            next = parsed;
          } else if (kind === "prices") {
            const snapshot = await request<PriceSyncResponse>("/sync/prices", refreshToken);
            if (!isPriceSyncResponse(snapshot)) throw new Error("Data harga belum dapat dibaca. Coba muat kembali.");
            if (!canApply() || tokenRef.current !== refreshToken || authEpoch.current !== refreshEpoch) return;
            if (snapshot.user.id !== sessionUserId.current) throw new Error("Data akun tidak sesuai. Silakan muat ulang aplikasi.");
            const accessError = accountAccessError(snapshot.user);
            if (accessError) throw new ApiError(accessError, 401);
            if (snapshot.user.role !== userRef.current?.role) {
              next = await request<State>("/bootstrap?compact=1", refreshToken);
              full = true;
              if (!isState(next)) throw new Error("Struktur data API tidak sesuai.");
            } else {
              next = mergePriceSync(stateRef.current, snapshot, sessionUserId.current!);
            }
          } else {
            next = await request<State>("/bootstrap?compact=1", refreshToken);
            if (!isState(next))
              throw new Error("Struktur data API tidak sesuai.");
          }
          if (
            !canApply() ||
            tokenRef.current !== refreshToken ||
            authEpoch.current !== refreshEpoch
          )
            return;
          if (mode === "live") {
            const restoredUser = next.users.find(
              (u) => u.id === sessionUserId.current && !accountAccessError(u),
            );
            if (!restoredUser)
              throw new Error(
                "Data akun belum dapat dimuat. Silakan coba kembali.",
              );
            setSessionUser(restoredUser);
            setSessionRecovery(false);
            setPriceSync((previous) => ({ ...previous, refreshing: false }));
          }
          commit(next);
          if (full) lastFullRefresh.current = Date.now();
          if (!background) setError(null);
        } catch (cause) {
          if (
            !canApply() ||
            tokenRef.current !== refreshToken ||
            authEpoch.current !== refreshEpoch
          )
            return;
          const message =
            cause instanceof Error ? cause.message : "Gagal memperbarui harga.";
          if (isExpiredSession(cause)) {
            invalidateSession();
            setError(message);
          } else {
            setPriceSync((previous) => ({ ...previous, error: message }));
            if (!background) setError(message);
          }
          throw cause;
        } finally {
          if (sessionActive())
            setPriceSync((previous) => ({ ...previous, refreshing: false }));
        }
      }, kind);
    },
    [commit, invalidateSession, setSessionUser],
  );
  const refresh = useCallback(() => refreshData(), [refreshData]);
  useEffect(() => {
    let mounted = true;
    const initEpoch = authEpoch.current;
    async function init() {
      try {
        if (mode === "demo") {
          let next: State | undefined;
          const stored = localStorage.getItem(STORAGE_KEY);
          if (stored) {
            try {
              const parsed: unknown = JSON.parse(stored);
              if (isState(parsed)) next = parsed;
            } catch {
              /* Rebuild damaged demo data only; real data never falls back. */
            }
          }
          if (!next) {
            next = createDemoState();
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          }
          const storedUser =
            localStorage.getItem(DEMO_USER_KEY) ??
            sessionStorage.getItem(DEMO_USER_KEY);
          if (storedUser) localStorage.setItem(DEMO_USER_KEY, storedUser);
          sessionStorage.removeItem(DEMO_USER_KEY);
          const initialUser =
            storedUser === "logged-out"
              ? null
              : next.users.find(
                  (u) =>
                    u.id === (storedUser || "admin") && !accountAccessError(u),
                ) || null;
          if (mounted) {
            commit(next);
            setSessionUser(initialUser);
          }
        } else {
          const saved = restoreSession(localStorage, sessionStorage);
          tokenRef.current = saved?.token ?? null;
          sessionUserId.current = saved?.userId ?? null;
          if (saved) {
            setSessionRecovery(true);
            await refreshData();
          }
        }
      } catch (cause) {
        if (mounted && authEpoch.current === initEpoch) {
          setError(
            cause instanceof Error ? cause.message : "Gagal memuat aplikasi.",
          );
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void init();
    const onStorage = (event: StorageEvent) => {
      if (mode === "demo" && event.key === STORAGE_KEY)
        void refresh().catch(() => {});
      if (
        mode === "demo" &&
        (event.key === DEMO_USER_KEY || event.key === null)
      ) {
        ++authEpoch.current;
        sync.current.invalidate();
        mediaCache.current.clear();
        lastFullRefresh.current = 0;
        const id = localStorage.getItem(DEMO_USER_KEY);
        setSessionUser(
          stateRef.current.users.find(
            (u) => u.id === id && !accountAccessError(u),
          ) ?? null,
        );
      }
      if (
        mode === "live" &&
        (event.key === AUTH_SESSION_KEY || event.key === null)
      ) {
        // Read the current record: an older queued event must not undo a newer login.
        const saved = parseSession(localStorage.getItem(AUTH_SESSION_KEY));
        if (saved && saved.token === tokenRef.current) return;
        ++authEpoch.current;
        sync.current.invalidate();
        mediaCache.current.clear();
        lastFullRefresh.current = 0;
        tokenRef.current = saved?.token ?? null;
        sessionUserId.current = saved?.userId ?? null;
        setSessionUser(null);
        commit(emptyState());
        setPriceSync(emptyPriceSync);
        setSessionRecovery(!!saved);
        setError(null);
        setLoading(false);
        if (saved) void refreshData().catch(() => {});
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      mounted = false;
      ++authEpoch.current;
      sync.current.invalidate();
      window.removeEventListener("storage", onStorage);
    };
  }, [commit, refresh, refreshData, setSessionUser]);
  useEffect(() => {
    if (!user && !sessionRecovery) return;
    const update = () => {
      if (document.visibilityState === "visible")
        void refreshData(true).catch(() => {});
    };
    const offline = () => {
      if (mode === "live")
        setPriceSync((previous) => ({
          ...previous,
          error:
            "Koneksi terputus. Harga akan diperbarui setelah tersambung kembali.",
        }));
    };
    const interval = setInterval(
      update,
      refreshInterval(user?.role ?? "employee"),
    );
    document.addEventListener("visibilitychange", update);
    window.addEventListener("online", update);
    window.addEventListener("offline", offline);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", offline);
    };
  }, [refreshData, user?.id, user?.role, sessionRecovery]);

  const registrationStatus =
    useCallback(async (): Promise<RegistrationAvailability> => {
      // Registration has its own form state; a status fetch must never replace the form with the global loading screen.
      if (mode === "demo")
        return { first_admin_required: false, setup_enabled: false };
      return request<RegistrationAvailability>(
        "/auth/registration-status",
        null,
      );
    }, []);
  const register = useCallback(
    async (input: RegistrationInput): Promise<RegistrationResult> => {
      if (mode === "live")
        return request<RegistrationResult>("/auth/register", null, input);

      const email = input.email.trim().toLowerCase();
      const registrationEpoch = authEpoch.current;
      const hashedPassword = await passwordHash(email, input.password);
      if (authEpoch.current !== registrationEpoch) throw new Error("Sesi berubah. Silakan buka kembali pendaftaran.");
      // Read after hashing so simultaneous submissions in this tab see the latest registered email.
      const stored = localStorage.getItem(STORAGE_KEY);
      const source = stored ? (JSON.parse(stored) as State) : stateRef.current;
      const registration = registerDemoEmployee(source, input);
      const credentials = parseDemoCredentials(localStorage.getItem(DEMO_AUTH_KEY));
      credentials[email] = hashedPassword;
      persistDemoData(localStorage, STORAGE_KEY, registration.state, DEMO_AUTH_KEY, credentials);
      commit(registration.state);
      return registration.result;
    },
    [commit],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const loginEpoch = ++authEpoch.current;
      sync.current.invalidate();
      setError(null);
      setLoading(true);
      try {
        if (mode === "demo") {
          const stored = localStorage.getItem(STORAGE_KEY);
          const source = stored
            ? (JSON.parse(stored) as State)
            : stateRef.current;
          const normalizedEmail = email.trim().toLowerCase();
          const found = source.users.find(
            (u) => u.email.toLowerCase() === normalizedEmail,
          );
          const credentialJson = localStorage.getItem(DEMO_AUTH_KEY);
          const validPassword = await demoPasswordMatches(
            parseDemoCredentials(credentialJson), normalizedEmail, password,
            ["admin", "emp-1", "emp-2", "emp-3"].includes(found?.id || "") ? DEMO_PASSWORD : null,
            passwordHash,
          );
          if (authEpoch.current !== loginEpoch) return;
          if (localStorage.getItem(STORAGE_KEY) !== stored || localStorage.getItem(DEMO_AUTH_KEY) !== credentialJson || (!stored && stateRef.current !== source))
            throw new Error("Data akun berubah. Silakan masuk kembali.");
          if (!found || !validPassword)
            throw new Error("Email atau kata sandi tidak sesuai.");
          const accessError = accountAccessError(found);
          if (accessError) throw new Error(accessError);
          if (authEpoch.current !== loginEpoch) return;
          localStorage.setItem(DEMO_USER_KEY, found.id);
          sessionStorage.removeItem(DEMO_USER_KEY);
          commit(source);
          setSessionUser(found);
        } else {
          const result = await request<{ token: string; user: User }>(
            "/auth/login",
            null,
            { email: email.trim(), password, response_mode: "compact" },
          );
          if (authEpoch.current !== loginEpoch) {
            void request("/auth/logout", result.token, {}).catch(() => {});
            return;
          }
          try {
            saveSession(localStorage, {
              token: result.token,
              userId: result.user.id,
            });
          } catch (cause) {
            void request("/auth/logout", result.token, {}).catch(() => {});
            throw cause;
          }
          mediaCache.current.clear();
          lastFullRefresh.current = 0;
          tokenRef.current = result.token;
          sessionUserId.current = result.user.id;
          setSessionRecovery(true);
          // Persist credentials before bootstrap, so a temporary outage does not lose a successful login.
          await refreshData();
        }
      } catch (cause) {
        if (authEpoch.current === loginEpoch)
          setError(cause instanceof Error ? cause.message : "Gagal masuk.");
        throw cause;
      } finally {
        if (authEpoch.current === loginEpoch || !tokenRef.current)
          setLoading(false);
      }
    },
    [commit, refreshData, setSessionUser],
  );
  const logout = useCallback(async () => {
    const token = tokenRef.current;
    // Clear credentials and invalidate pending requests before waiting for network/browser cleanup.
    invalidateSession();
    setError(null);
    setLoading(false);
    if (mode === "demo") {
      localStorage.setItem(DEMO_USER_KEY, "logged-out");
      sessionStorage.removeItem(DEMO_USER_KEY);
    } else {
      // The server revokes every push binding belonging to this token; it must
      // not wait for a browser's subscription API, which can stall offline.
      const revoke = token
        ? request("/auth/logout", token, {}).catch(() => {
            /* Local credentials are removed even if the network is unavailable. */
          })
        : Promise.resolve();
      await Promise.all([revoke, detachBrowserPush()]);
    }
  }, [invalidateSession]);
  const pushRequest = useCallback(
    async <T,>(
      action: "status" | "subscribe" | "unsubscribe" | "test",
      body?: unknown,
      expectedUserId?: string,
    ): Promise<T> => {
      if (mode !== "live" || !tokenRef.current || !userRef.current)
        throw new Error(
          "Masuk ke akun TernaKu untuk mengaktifkan notifikasi HP.",
        );
      const token = tokenRef.current;
      const userId = userRef.current.id;
      if (expectedUserId && userId !== expectedUserId)
        throw new Error(
          "Akun berubah. Buka kembali pengaturan notifikasi pada akun Anda.",
        );
      let result: T;
      try {
        result = await request<T>(`/push/${action}`, token, body);
      } catch (cause) {
        if (tokenRef.current === token && isExpiredSession(cause))
          invalidateSession();
        throw cause;
      }
      if (tokenRef.current !== token || userRef.current?.id !== userId)
        throw new Error(
          "Akun berubah. Buka kembali pengaturan notifikasi pada akun Anda.",
        );
      return result;
    },
    [invalidateSession],
  );
  const command = useCallback(
    async (action: string, payload: CommandPayload, requestId?: string): Promise<State> => {
      const currentUser = userRef.current;
      if (!currentUser) throw new Error("Silakan masuk terlebih dahulu.");
      const sessionToken = tokenRef.current;
      const commandEpoch = authEpoch.current;
      const sessionUnchanged = () => tokenRef.current === sessionToken && userRef.current?.id === currentUser.id && authEpoch.current === commandEpoch;
      const finishMutation = sync.current.beginMutation();
      try {
        let next: State;
        let commandResult: State["command_result"];
        if (mode === "demo") {
          // Hash before reading state so another completed command cannot be overwritten while hashing.
          const createdPassword = action === "user.create" ? await passwordHash(String(payload.email).trim().toLowerCase(), String(payload.password)) : undefined;
          if (!sessionUnchanged()) throw new Error("Sesi berubah. Silakan masuk kembali.");
          // Always calculate on complete demo data, then expose only the signed-in user's permitted rows.
          const stored = localStorage.getItem(STORAGE_KEY);
          const source = stored
            ? (JSON.parse(stored) as State)
            : stateRef.current;
          next = executeCommand(source, currentUser.id, action, payload);
          if (action === "sale.create") {
            const added = next.sales.find((sale) => !source.sales.some((previous) => previous.id === sale.id));
            if (added) commandResult = { action, record_id: added.id, request_id: requestId ?? "" };
          }
          let credentials: DemoCredentials | undefined;
          if (createdPassword !== undefined) {
            credentials = parseDemoCredentials(localStorage.getItem(DEMO_AUTH_KEY));
            const email = String(payload.email).trim().toLowerCase();
            credentials[email] = createdPassword;
          } else if (action === "user.update" && Object.hasOwn(payload, "email")) {
            const previous = source.users.find((member) => member.id === payload.id)!;
            const updated = next.users.find((member) => member.id === previous.id)!;
            credentials = renameDemoCredential(parseDemoCredentials(localStorage.getItem(DEMO_AUTH_KEY)), previous.email, updated.email);
          }
          if (!sessionUnchanged()) throw new Error("Sesi berubah. Silakan masuk kembali.");
          persistDemoData(localStorage, STORAGE_KEY, next, DEMO_AUTH_KEY, credentials);
        } else {
          if (
            requestId !== undefined &&
            !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)
          )
            throw new ApiError("ID percobaan penyimpanan tidak valid.", 400);
          // A persisted sale owns its UUID alongside its exact payload, so a
          // reload between confirmation and local cleanup cannot create a new sale.
          // Other commands keep the existing fingerprint-based retry map.
          const fingerprint =
            requestId === undefined
              ? `${currentUser.id}:${await digest(JSON.stringify({ action, payload }))}`
              : null;
          let request_id = requestId;
          if (fingerprint) {
            const retries = readPendingRequestIds(
              sessionStorage.getItem(RETRY_KEY),
            );
            request_id = retries[fingerprint] || crypto.randomUUID();
            retries[fingerprint] = request_id;
            sessionStorage.setItem(RETRY_KEY, JSON.stringify(retries));
          }
          if (!sessionUnchanged())
            throw new Error("Sesi berubah. Silakan masuk kembali.");
          next = await request<State>("/commands", sessionToken, {
            action,
            payload,
            request_id,
            response_mode: "compact",
          });
          if (!isState(next))
            throw new Error("Struktur data API tidak sesuai.");
          if (fingerprint) {
            try {
              const remaining = readPendingRequestIds(
                sessionStorage.getItem(RETRY_KEY),
              );
              delete remaining[fingerprint];
              sessionStorage.setItem(RETRY_KEY, JSON.stringify(remaining));
            } catch {
              // The server confirmed this write. A local cleanup problem must not
              // turn that confirmation into another uncertain save; keep the old ID.
            }
          }
          commandResult = next.command_result;
        }
        if (!sessionUnchanged())
          throw new Error("Sesi berubah. Buka kembali riwayat setelah masuk untuk melihat hasil penyimpanan.");
        // Receipts consume the confirmed response directly. Do not keep a last
        // command result in general state where a later poll could make it stale.
        const state = { ...next };
        delete state.command_result;
        commit(state);
        lastFullRefresh.current = Date.now();
        setError(null);
        const confirmed = mode === "demo" ? visibleState(state, currentUser) : state;
        return commandResult ? { ...confirmed, command_result: commandResult } : confirmed;
      } catch (cause) {
        if (sessionUnchanged()) {
          if (isExpiredSession(cause)) invalidateSession();
          setError(
            cause instanceof Error ? cause.message : "Data gagal disimpan.",
          );
        }
        throw cause;
      } finally {
        finishMutation();
      }
    },
    [commit, invalidateSession],
  );
  const loadMedia = useCallback(async (reference: MediaReference): Promise<Blob> => {
    const token = tokenRef.current;
    const epoch = authEpoch.current;
    if (!token || mode !== "live") throw new Error("Masuk kembali untuk melihat foto ini.");
    const currentSession = () => tokenRef.current === token && authEpoch.current === epoch;
    const blob = await mediaCache.current.load(reference, async () => {
      if (!currentSession()) throw new Error("Sesi berubah. Buka kembali foto setelah masuk.");
      try {
        const blob = await requestMedia(reference, token);
        if (!currentSession()) throw new Error("Sesi berubah. Buka kembali foto setelah masuk.");
        return blob;
      } catch (cause) {
        if (currentSession() && isExpiredSession(cause)) invalidateSession();
        throw cause;
      }
    });
    if (!currentSession()) throw new Error("Sesi berubah. Buka kembali foto setelah masuk.");
    return blob;
  }, [invalidateSession]);
  const state = useMemo(
    () => (mode === "demo" ? visibleState(allState, user) : allState),
    [allState, user],
  );
  return (
    <Context.Provider
      value={{
        state,
        user,
        mode,
        loading,
        sessionRecovery,
        error,
        priceSync,
        pushRequest,
        login,
        registrationStatus,
        register,
        logout,
        command,
        loadMedia,
        refresh,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useFarm(): FarmContextValue {
  const context = useContext(Context);
  if (!context)
    throw new Error("useFarm harus digunakan di dalam FarmProvider.");
  return context;
}
