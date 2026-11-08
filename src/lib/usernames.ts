import type { User } from "./types";

export const normalizeUsername = (value: string): string => value.trim().toLowerCase();

export function validateUsername(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(normalizeUsername(value)))
    throw new Error("Username harus 3–32 karakter, diawali huruf atau angka. Gunakan huruf, angka, titik, garis bawah, atau tanda hubung.");
  return normalizeUsername(value);
}

/** Generated aliases stay independent of later email edits. Explicit aliases always win. */
export function generateUsername(email: string, existing: readonly string[]): string {
  let base = normalizeUsername(email).split("@")[0].replace(/[^a-z0-9._-]/g, "").replace(/^[^a-z0-9]+/, "").slice(0, 32);
  if (base.length < 3) base = `user${base ? `.${base}` : ""}`;
  const reserved = new Set(existing.map(normalizeUsername));
  let candidate = base;
  for (let sequence = 2; reserved.has(candidate); sequence++) {
    const suffix = `.${sequence}`;
    candidate = `${base.slice(0, 32 - suffix.length)}${suffix}`;
  }
  return candidate;
}

/** Upgrade old demo records without changing their order, IDs, credentials, or media. */
export function withUsernames(users: User[]): User[] {
  if (users.every(user => user.username)) return users;
  const used = users.flatMap(user => user.username ? [user.username] : []);
  const generated = new Map<string, string>();
  for (const user of [...users].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    if (user.username) continue;
    const username = generateUsername(user.email, used);
    used.push(username);
    generated.set(user.id, username);
  }
  return users.map(user => generated.has(user.id) ? { ...user, username: generated.get(user.id)! } : user);
}

export function findLoginUser(users: User[], identifier: string): User | undefined {
  const normalized = normalizeUsername(identifier);
  return withUsernames(users).find(user => normalized.includes("@")
    ? normalizeUsername(user.email) === normalized
    : user.username === normalized);
}

export function assignUsername(users: User[], email: string, value?: unknown, userId?: string): string {
  const others = withUsernames(users).filter(user => user.id !== userId);
  const existing = others.map(user => user.username!);
  const username = value === undefined ? generateUsername(email, existing) : validateUsername(value);
  if (existing.some(taken => normalizeUsername(taken) === username)) throw new Error("Username sudah digunakan. Pilih username lain.");
  return username;
}
