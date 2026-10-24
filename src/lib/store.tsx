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
import { readPendingRequestIds } from "./request-retries";
import { detachBrowserPush } from "./push-client";
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
  ) => Promise<void>;
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
  const timeout = setTimeout(() => controller.abort(), 20000);
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
    let json: { data?: T; error?: string };
    try {
      json = await response.json();
    } catch {
      if (response.status === 401)
        throw new ApiError("Sesi berakhir. Silakan masuk kembali.", 401);
      throw new Error(
        "API mengirim respons yang tidak valid. Periksa konfigurasi server.",
      );
    }
    if (!response.ok || json.error)
      throw new ApiError(
        json.error || `Permintaan gagal (${response.status}).`,
        response.status,
      );
    if (json.data === undefined)
      throw new Error("Data respons API tidak lengkap.");
    return json.data;
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError")
      throw new Error("API tidak merespons. Silakan coba kembali.");
    if (cause instanceof TypeError)
      throw new Error(
        "Tidak dapat terhubung ke API. Periksa koneksi internet dan konfigurasi server.",
      );
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
    if (userRef.current?.id !== next?.id) sync.current.invalidate();
    userRef.current = next;
    setUser(next);
  }, []);
  const invalidateSession = useCallback(() => {
    const previousToken = tokenRef.current;
    ++authEpoch.current;
    sync.current.invalidate();
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
      return sync.current.refresh(async ({ canApply, sessionActive }) => {
        if (!canApply()) return;
        setPriceSync((previous) => ({ ...previous, refreshing: true }));
        try {
          let next: State;
          if (mode === "demo") {
            const stored = localStorage.getItem(STORAGE_KEY);
            const parsed: unknown = stored
              ? JSON.parse(stored)
              : stateRef.current;
            if (!isState(parsed)) throw new Error("Data demo tidak valid.");
            next = parsed;
          } else {
            next = await request<State>("/bootstrap", refreshToken);
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
      });
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
      const hashedPassword = await passwordHash(email, input.password);
      // Read after hashing so simultaneous submissions in this tab see the latest registered email.
      const stored = localStorage.getItem(STORAGE_KEY);
      const source = stored ? (JSON.parse(stored) as State) : stateRef.current;
      const registration = registerDemoEmployee(source, input);
      const previousCredentials = localStorage.getItem(DEMO_AUTH_KEY);
      const credentials = JSON.parse(previousCredentials || "{}") as Record<
        string,
        string
      >;
      credentials[email] = hashedPassword;
      localStorage.setItem(DEMO_AUTH_KEY, JSON.stringify(credentials));
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(registration.state));
      } catch (cause) {
        if (previousCredentials === null)
          localStorage.removeItem(DEMO_AUTH_KEY);
        else localStorage.setItem(DEMO_AUTH_KEY, previousCredentials);
        throw cause;
      }
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
          const credentials = JSON.parse(
            localStorage.getItem(DEMO_AUTH_KEY) || "{}",
          ) as Record<string, string>;
          const validPassword = credentials[normalizedEmail]
            ? credentials[normalizedEmail] ===
              (await passwordHash(normalizedEmail, password))
            : ["admin", "emp-1", "emp-2", "emp-3"].includes(found?.id || "") &&
              password === DEMO_PASSWORD;
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
            { email: email.trim(), password },
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
    async (action: string, payload: CommandPayload, requestId?: string) => {
      const currentUser = userRef.current;
      if (!currentUser) throw new Error("Silakan masuk terlebih dahulu.");
      const sessionToken = tokenRef.current;
      const finishMutation = sync.current.beginMutation();
      try {
        let next: State;
        if (mode === "demo") {
          // Always calculate on complete demo data, then expose only the signed-in user's permitted rows.
          const stored = localStorage.getItem(STORAGE_KEY);
          const source = stored
            ? (JSON.parse(stored) as State)
            : stateRef.current;
          next = executeCommand(source, currentUser.id, action, payload);
          if (action === "user.create") {
            const credentials = JSON.parse(
              localStorage.getItem(DEMO_AUTH_KEY) || "{}",
            ) as Record<string, string>;
            const email = String(payload.email).trim().toLowerCase();
            credentials[email] = await passwordHash(
              email,
              String(payload.password),
            );
            localStorage.setItem(DEMO_AUTH_KEY, JSON.stringify(credentials));
          }
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
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
          if (
            tokenRef.current !== sessionToken ||
            userRef.current?.id !== currentUser.id
          )
            throw new Error("Sesi berubah. Silakan masuk kembali.");
          next = await request<State>("/commands", sessionToken, {
            action,
            payload,
            request_id,
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
          if (
            tokenRef.current !== sessionToken ||
            userRef.current?.id !== currentUser.id
          )
            return;
        }
        commit(next);
        setError(null);
      } catch (cause) {
        if (
          tokenRef.current === sessionToken &&
          userRef.current?.id === currentUser.id
        ) {
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
