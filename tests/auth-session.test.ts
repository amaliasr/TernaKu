import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_SESSION_KEY,
  LEGACY_TOKEN_KEY,
  clearSession,
  isExpiredSession,
  parseSession,
  restoreSession,
  saveSession,
} from "../src/lib/auth-session";
import { ApiError } from "../src/lib/request-errors";
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
const session = { token: "a".repeat(64), userId: "employee-1" };

test("legacy tab credentials migrate atomically and survive a new tab/browser session", () => {
  const local = memoryStorage(),
    legacy = memoryStorage();
  legacy.setItem(LEGACY_TOKEN_KEY, session.token);
  legacy.setItem(
    `${LEGACY_TOKEN_KEY}.user`,
    JSON.stringify({
      id: session.userId,
      role: "admin",
      photo: "large cached image",
    }),
  );
  assert.deepEqual(restoreSession(local, legacy), session);
  assert.equal(legacy.getItem(LEGACY_TOKEN_KEY), null);
  assert.deepEqual(restoreSession(local, memoryStorage()), session);
  assert.deepEqual(
    Object.keys(JSON.parse(local.getItem(AUTH_SESSION_KEY)!)).sort(),
    ["token", "userId"],
  );
});
test("failed persistent storage migration preserves legacy credentials", () => {
  const local = memoryStorage(),
    legacy = memoryStorage();
  legacy.setItem(LEGACY_TOKEN_KEY, session.token);
  legacy.setItem(
    `${LEGACY_TOKEN_KEY}.user`,
    JSON.stringify({ id: session.userId }),
  );
  assert.throws(
    () =>
      restoreSession(
        {
          ...local,
          setItem: () => {
            throw new Error("quota");
          },
        },
        legacy,
      ),
    /quota/,
  );
  assert.equal(legacy.getItem(LEGACY_TOKEN_KEY), session.token);
});
test("logout tombstone prevents an older tab from restoring its legacy token", () => {
  const local = memoryStorage(),
    oldTab = memoryStorage();
  saveSession(local, session);
  oldTab.setItem(LEGACY_TOKEN_KEY, session.token);
  oldTab.setItem(
    `${LEGACY_TOKEN_KEY}.user`,
    JSON.stringify({ id: session.userId }),
  );
  clearSession(local, memoryStorage(), session.token);
  assert.equal(restoreSession(local, oldTab), null);
  assert.equal(oldTab.getItem(LEGACY_TOKEN_KEY), null);
  assert.equal(local.getItem(AUTH_SESSION_KEY), "null");
});
test("stale logout or unauthorized response cannot erase another tab's newer login", () => {
  const local = memoryStorage(),
    newer = { token: "b".repeat(64), userId: "employee-2" };
  saveSession(local, newer);
  clearSession(local, memoryStorage(), session.token);
  assert.deepEqual(restoreSession(local, memoryStorage()), newer);
});
test("corrupt credentials are never used as a session", () => {
  for (const raw of [
    "{",
    "[]",
    "null",
    "{}",
    JSON.stringify({ token: "short", userId: "a" }),
    JSON.stringify({ token: session.token, userId: 7 }),
  ])
    assert.equal(parseSession(raw), null);
});
test("only an actual HTTP 401 expires a session; outages, timeout, rate limiting and malformed responses preserve it", () => {
  assert.equal(isExpiredSession(new ApiError("expired", 401)), true);
  for (const cause of [
    new Error("Network offline"),
    new TypeError("fetch failed"),
    new Error("invalid JSON"),
    new DOMException("Timeout", "AbortError"),
    new ApiError("forbidden", 403),
    new ApiError("slow down", 429),
    new ApiError("unavailable", 503),
  ])
    assert.equal(isExpiredSession(cause), false);
});
