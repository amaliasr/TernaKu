import { ApiError } from "./request-errors";
/** One atomic record lets another tab observe a complete login/logout. */
export const AUTH_SESSION_KEY = "ternaku.api.session";
export const LEGACY_TOKEN_KEY = "ternaku.api.token";
export interface SavedSession {
  token: string;
  userId: string;
}
type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function isExpiredSession(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function parseSession(raw: string | null): SavedSession | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const { token, userId } = value as Record<string, unknown>;
    return typeof token === "string" &&
      /^[a-f0-9]{64}$/.test(token) &&
      typeof userId === "string" &&
      userId.length > 0 &&
      userId.length <= 40
      ? { token, userId }
      : null;
  } catch {
    return null;
  }
}

export function saveSession(
  storage: SessionStorage,
  value: SavedSession,
): void {
  storage.setItem(AUTH_SESSION_KEY, JSON.stringify(value));
}

export function restoreSession(
  storage: SessionStorage,
  legacy: SessionStorage,
): SavedSession | null {
  const raw = storage.getItem(AUTH_SESSION_KEY);
  // Even an invalid current record takes precedence over an obsolete tab's token.
  if (raw !== null) {
    legacy.removeItem(LEGACY_TOKEN_KEY);
    legacy.removeItem(`${LEGACY_TOKEN_KEY}.user`);
    return parseSession(raw);
  }
  const token = legacy.getItem(LEGACY_TOKEN_KEY);
  let userId: unknown;
  try {
    userId = JSON.parse(
      legacy.getItem(`${LEGACY_TOKEN_KEY}.user`) || "null",
    )?.id;
  } catch {
    return null;
  }
  const session = parseSession(JSON.stringify({ token, userId }));
  if (session) {
    saveSession(storage, session);
    legacy.removeItem(LEGACY_TOKEN_KEY);
    legacy.removeItem(`${LEGACY_TOKEN_KEY}.user`);
  }
  return session;
}

export function clearSession(
  storage: SessionStorage,
  legacy: SessionStorage,
  expectedToken: string | null,
): void {
  const current = parseSession(storage.getItem(AUTH_SESSION_KEY));
  if (!current || current.token === expectedToken) {
    // A tombstone prevents a still-open legacy tab from resurrecting a logged-out token.
    storage.setItem(AUTH_SESSION_KEY, "null");
  }
  legacy.removeItem(LEGACY_TOKEN_KEY);
  legacy.removeItem(`${LEGACY_TOKEN_KEY}.user`);
}
