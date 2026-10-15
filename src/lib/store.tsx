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
}
const Context = createContext<FarmContextValue | undefined>(undefined);
const STORAGE_KEY = "ternaku.demo.v1";
const DEMO_USER_KEY = "ternaku.demo.user";
const DEMO_AUTH_KEY = "ternaku.demo.credentials";
const TOKEN_KEY = "ternaku.api.token";
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
  const [error, setError] = useState<string | null>(null);
  const [priceSync, setPriceSync] = useState<PriceSync>(emptyPriceSync);
  const sync = useRef(new SessionSync());
  const stateRef = useRef(allState);
  const userRef = useRef(user);
  const tokenRef = useRef<string | null>(null);
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
    tokenRef.current = null;
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(`${TOKEN_KEY}.user`);
    setSessionUser(null);
    commit(emptyState());
    setPriceSync(emptyPriceSync);
  }, [commit, setSessionUser]);
  const refreshData = useCallback(
    (background = false) => {
      const refreshToken = tokenRef.current;
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
          if (!canApply() || tokenRef.current !== refreshToken) return;
          commit(next);
          if (!background) setError(null);
        } catch (cause) {
          if (!canApply() || tokenRef.current !== refreshToken) return;
          const message =
            cause instanceof Error ? cause.message : "Gagal memperbarui harga.";
          if (cause instanceof ApiError && cause.status === 401) {
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
    [commit, invalidateSession],
  );
  const refresh = useCallback(() => refreshData(), [refreshData]);
  useEffect(() => {
    let mounted = true;
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
          const storedUser = sessionStorage.getItem(DEMO_USER_KEY);
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
          const token = sessionStorage.getItem(TOKEN_KEY);
          tokenRef.current = token;
          if (token) {
            const next = await request<State>("/bootstrap", token);
            if (!isState(next))
              throw new Error("Struktur data API tidak sesuai.");
            const sessionUserRaw = sessionStorage.getItem(`${TOKEN_KEY}.user`);
            const savedUser = sessionUserRaw
              ? (JSON.parse(sessionUserRaw) as User)
              : null;
            const sessionUser =
              next.users.find(
                (u) => u.id === savedUser?.id && !accountAccessError(u),
              ) || null;
            if (!sessionUser)
              throw new Error("Sesi tidak valid. Silakan masuk kembali.");
            if (mounted) {
              commit(next);
              setSessionUser(sessionUser);
            }
          }
        }
      } catch (cause) {
        if (mounted) {
          setError(
            cause instanceof Error ? cause.message : "Gagal memuat aplikasi.",
          );
          if (mode === "live") {
            tokenRef.current = null;
            sessionStorage.removeItem(TOKEN_KEY);
            sessionStorage.removeItem(`${TOKEN_KEY}.user`);
          }
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void init();
    const onStorage = (event: StorageEvent) => {
      if (mode === "demo" && event.key === STORAGE_KEY)
        void refresh().catch(() => {});
    };
    window.addEventListener("storage", onStorage);
    return () => {
      mounted = false;
      sync.current.invalidate();
      window.removeEventListener("storage", onStorage);
    };
  }, [commit, refresh, setSessionUser]);
  useEffect(() => {
    if (!user) return;
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
    const interval = setInterval(update, refreshInterval(user.role));
    document.addEventListener("visibilitychange", update);
    window.addEventListener("online", update);
    window.addEventListener("offline", offline);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", offline);
    };
  }, [refreshData, user?.id, user?.role]);

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
          sessionStorage.setItem(DEMO_USER_KEY, found.id);
          commit(source);
          setSessionUser(found);
        } else {
          const result = await request<{ token: string; user: User }>(
            "/auth/login",
            null,
            { email: email.trim(), password },
          );
          const next = await request<State>("/bootstrap", result.token);
          if (!isState(next))
            throw new Error("Struktur data API tidak sesuai.");
          sessionStorage.setItem(TOKEN_KEY, result.token);
          sessionStorage.setItem(
            `${TOKEN_KEY}.user`,
            JSON.stringify(result.user),
          );
          tokenRef.current = result.token;
          commit(next);
          setSessionUser(result.user);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Gagal masuk.");
        throw cause;
      } finally {
        setLoading(false);
      }
    },
    [commit, setSessionUser],
  );
  const logout = useCallback(async () => {
    const token = tokenRef.current;
    tokenRef.current = null;
    setSessionUser(null);
    setError(null);
    setPriceSync(emptyPriceSync);
    if (mode === "demo") sessionStorage.setItem(DEMO_USER_KEY, "logged-out");
    else {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(`${TOKEN_KEY}.user`);
      commit(emptyState());
      setPriceSync(emptyPriceSync);
      if (token) {
        try {
          await request("/auth/logout", token, {});
        } catch {
          /* Local credentials are removed even if the network is unavailable. */
        }
      }
    }
  }, [commit, setSessionUser]);
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
          const fingerprint = requestId === undefined
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
          if (cause instanceof ApiError && cause.status === 401)
            invalidateSession();
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
        error,
        priceSync,
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
