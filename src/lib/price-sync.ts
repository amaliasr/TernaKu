import type { PriceSyncResponse, Role, State, User } from "./types";
import type { RefreshKind } from "./session-sync";

export const FULL_REFRESH_INTERVAL = 60_000;

export function refreshKind(background: boolean, role: Role | undefined, lastFullAt: number, now = Date.now()): RefreshKind {
  return background && role === "employee" && lastFullAt > 0 && now - lastFullAt < FULL_REFRESH_INTERVAL
    ? "prices" : "full";
}

export function isPriceSyncResponse(value: unknown): value is PriceSyncResponse {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<PriceSyncResponse>;
  const user = snapshot.user;
  return Array.isArray(snapshot.prices) && Array.isArray(snapshot.notifications)
    && !!user && typeof user.id === "string" && typeof user.name === "string"
    && typeof user.email === "string" && typeof user.active === "boolean"
    && (user.role === "admin" || user.role === "employee")
    && typeof user.target === "number" && Number.isFinite(user.target)
    && (user.registration_status === undefined || ["approved", "pending", "rejected"].includes(user.registration_status))
    && typeof snapshot.settings?.harvest_auto_stock === "boolean";
}

/** Only lightweight fields are replaced; media and other collections stay intact. */
export function mergePriceSync(state: State, snapshot: PriceSyncResponse, expectedUserId: string): State {
  if (snapshot.user.id !== expectedUserId || !state.users.some((user) => user.id === expectedUserId))
    throw new Error("Data akun tidak sesuai. Silakan muat ulang aplikasi.");
  const { id, name, email, role, active, target, registration_status } = snapshot.user;
  const user: Omit<User, "photo" | "photo_ref"> = { id, name, email, role, active, target, registration_status };
  return {
    ...state,
    users: state.users.map((previous) => previous.id === id ? { ...previous, ...user } : previous),
    prices: snapshot.prices,
    notifications: snapshot.notifications,
    settings: snapshot.settings,
  };
}
