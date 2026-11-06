import type { PriceSyncResponse, Role, State, User } from "./types";
import type { RefreshKind } from "./session-sync";

export const FULL_REFRESH_INTERVAL = 60_000;
export const validPriceCursor = (value: unknown): value is string =>
  typeof value === "string" && /^(0|[1-9][0-9]{0,17})$/.test(value);

export function refreshKind(background: boolean, role: Role | undefined, lastFullAt: number, now = Date.now()): RefreshKind {
  return background && role === "employee" && lastFullAt > 0 && now - lastFullAt < FULL_REFRESH_INTERVAL
    ? "prices" : "full";
}

export function isPriceSyncResponse(value: unknown): value is PriceSyncResponse {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<PriceSyncResponse>;
  const user = snapshot.user;
  const deltaValid = snapshot.mode === undefined || (snapshot.mode === "delta"
    && validPriceCursor(snapshot.since) && validPriceCursor(snapshot.cursor)
    && BigInt(snapshot.cursor) >= BigInt(snapshot.since)
    && typeof snapshot.more === "boolean" && (!snapshot.more || BigInt(snapshot.cursor) > BigInt(snapshot.since))
    && Array.isArray(snapshot.read_notices) && snapshot.read_notices.every(id => typeof id === "string"));
  return deltaValid && Array.isArray(snapshot.prices) && Array.isArray(snapshot.notifications)
    && !!user && typeof user.id === "string" && typeof user.name === "string"
    && typeof user.email === "string" && typeof user.active === "boolean"
    && (user.role === "admin" || user.role === "employee")
    && typeof user.target === "number" && Number.isFinite(user.target)
    && (user.registration_status === undefined || ["approved", "pending", "rejected"].includes(user.registration_status))
    && typeof snapshot.settings?.harvest_auto_stock === "boolean";
}

function upsertChanges<T extends { id: string }>(stored: T[], ascending: T[]): T[] {
  if (!ascending.length) return stored;
  const changed = new Set(ascending.map(item => item.id));
  return [...ascending].reverse().concat(stored.filter(item => !changed.has(item.id)));
}

/** Merge only data belonging to this snapshot, session and cursor. */
export function mergePriceSync(state: State, snapshot: PriceSyncResponse, expectedUserId: string): State {
  if (snapshot.user.id !== expectedUserId || !state.users.some((user) => user.id === expectedUserId))
    throw new Error("Data akun tidak sesuai. Silakan muat ulang aplikasi.");
  const { id, name, email, role, active, target, registration_status } = snapshot.user;
  const user: Omit<User, "photo" | "photo_ref"> = { id, name, email, role, active, target, registration_status };
  const delta = snapshot.mode === "delta";
  if ((delta && state.price_cursor !== snapshot.since) || snapshot.notifications.some(n => n.user_id !== expectedUserId))
    throw new Error("Pembaruan harga tidak sesuai. Silakan muat ulang aplikasi.");
  const seen = new Set(snapshot.read_notices);
  // New rows contain the actual read flag from MySQL. An earlier "read all"
  // marker in this page must not mark notifications created later as read.
  const notifications = delta && seen.size ? state.notifications.map(n =>
    !n.read && (seen.has("all") || seen.has(n.id)) ? { ...n, read: true } : n) : state.notifications;
  return {
    ...state,
    users: state.users.map((previous) => previous.id === id ? { ...previous, ...user } : previous),
    price_cursor: delta ? snapshot.cursor : undefined,
    prices: delta ? upsertChanges(state.prices, snapshot.prices) : snapshot.prices,
    notifications: delta ? upsertChanges(notifications, snapshot.notifications) : snapshot.notifications,
    settings: snapshot.settings,
  };
}
