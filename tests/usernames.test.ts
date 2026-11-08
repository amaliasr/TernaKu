import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { demoLoginUser, renameDemoCredential } from "../src/lib/demo-credentials";
import { accountAccessError, emptyState, executeCommand, registerDemoEmployee } from "../src/lib/domain";
import { findLoginUser, generateUsername, validateUsername, withUsernames } from "../src/lib/usernames";
import type { User } from "../src/lib/types";

const hashPassword = async (email: string, password: string) => createHash("sha256").update(`ternaku-demo:${email}:${password}`).digest("hex");
const password = "StrongPassword123!";
const user = (id: string, email: string, extra: Partial<User> = {}): User => ({ id, name: id, email, role: "employee", active: true, target: 0, ...extra });
const fixture = () => ({ ...emptyState(), users: [
  user("admin", "admin@test.local", { role: "admin" }),
  user("sari", "sari@test.local", { photo: "saved-media" }),
  user("pending", "baru@test.local", { active: false, registration_status: "pending" }),
] });

test("username migration gives stable distinct aliases without changing account details or array order", () => {
  const users = [user("z", "Sari@another.local"), user("a", "sari@test.local"), user("taken", "other@test.local", { username: "sari" })];
  const migrated = withUsernames(users);
  assert.deepEqual(migrated.map(u => [u.id, u.username]), [["z", "sari.3"], ["a", "sari.2"], ["taken", "sari"]]);
  assert.deepEqual(withUsernames([...users].reverse()).map(u => [u.id, u.username]), [...migrated].reverse().map(u => [u.id, u.username]));
  assert.strictEqual(withUsernames(migrated), migrated);
  assert.equal(users[0].username, undefined);
  assert.equal(migrated[0].email, "Sari@another.local");
  for (const [email, expected] of [["x@test.local", "user.x"], ["..@@test.local", "user"], ["_A+B@test.local", "user.ab"], ["Sari.Putri@test.local", "sari.putri"]])
    assert.equal(generateUsername(email, []), expected);
  assert.equal(generateUsername(`${"a".repeat(50)}@test.local`, ["a".repeat(32)]), `${"a".repeat(30)}.2`);
});

test("username format is strict and email can never be claimed as a username", () => {
  assert.equal(validateUsername(" SARI_01.A-b "), "sari_01.a-b");
  for (const value of ["", "  ", null, 22, "ab", "a".repeat(33), "_sari", ".sari", "sari@test.local", "sari putri", "sári", "sari/../admin"])
    assert.throws(() => validateUsername(value), /Username/);
});

test("email and username resolve the same user with case and surrounding space normalized", () => {
  const users = withUsernames(fixture().users);
  assert.equal(findLoginUser(users, " SARI ")?.id, "sari");
  assert.equal(findLoginUser(users, " SARI@Test.Local ")?.id, "sari");
  assert.equal(findLoginUser(users, "unknown"), undefined);
  assert.equal(findLoginUser(users, ""), undefined);
});

test("username login uses the email salt and preserves credentials after username and email edits", async () => {
  const source = fixture();
  const credentials = { "sari@test.local": await hashPassword("sari@test.local", password) };
  const edited = executeCommand(source, "sari", "profile.update", { name: "Sari", username: "  SARI.BARU " });
  const options = { users: edited.users, credentials, password, hashPassword, seedPassword: "Demo123!", seedUserIds: ["admin"] };
  assert.equal((await demoLoginUser({ ...options, identifier: "SARI.BARU" })).id, "sari");
  assert.equal((await demoLoginUser({ ...options, identifier: "sari@test.local" })).id, "sari");
  await assert.rejects(() => demoLoginUser({ ...options, identifier: "sari" }), /tidak sesuai/);
  await assert.rejects(() => demoLoginUser({ ...options, identifier: "sari.baru", password: "wrong" }), /tidak sesuai/);
  const renamed = executeCommand(edited, "admin", "user.update", { id: "sari", email: "new@test.local" });
  assert.equal(renamed.users[1].username, "sari.baru");
  const moved = { ...options, users: renamed.users, credentials: renameDemoCredential(credentials, "sari@test.local", "new@test.local") };
  assert.equal((await demoLoginUser({ ...moved, identifier: "sari.baru" })).id, "sari");
  assert.equal((await demoLoginUser({ ...moved, identifier: "new@test.local" })).id, "sari");
  await assert.rejects(() => demoLoginUser({ ...moved, identifier: "sari@test.local" }), /tidak sesuai/);
  assert.equal(renamed.users[1].photo, "saved-media");
});

test("pending, rejected, and disabled accounts cannot bypass access checks by switching aliases", async () => {
  for (const extra of [{ active: false }, { registration_status: "pending" as const }, { registration_status: "rejected" as const }]) {
    const account = user("sari", "sari@test.local", { username: "sari", ...extra });
    const options = { users: [account], credentials: { "sari@test.local": await hashPassword(account.email, password) }, password, hashPassword, seedPassword: "Demo123!", seedUserIds: [] };
    for (const identifier of ["SARI", "SARI@TEST.LOCAL"])
      await assert.rejects(() => demoLoginUser({ ...options, identifier }), { message: accountAccessError(account)! });
  }
});

test("explicit aliases are unique across pending and active accounts and invalid edits are atomic", () => {
  const state = fixture();
  const original = structuredClone(state);
  for (const username of [" ADMIN ", "baru", "", null, "wrong username", "admin@test.local"]) {
    assert.throws(() => executeCommand(state, "sari", "profile.update", { name: "Unsaved", username }), /Username/);
    assert.throws(() => executeCommand(state, "admin", "user.update", { id: "sari", name: "Unsaved", username }), /Username/);
  }
  assert.throws(() => executeCommand(state, "sari", "user.update", { id: "pending", username: "changed" }), /admin/);
  assert.throws(() => executeCommand(state, "admin", "user.update", { id: "admin", username: "changed" }), /karyawan/);
  assert.deepEqual(state, original);
  assert.equal(executeCommand(state, "sari", "profile.update", { name: "Sari", username: "SARI" }).users[1].username, "sari");
});

test("signup and account creation support chosen aliases, generate omitted aliases, and preserve approval rules", () => {
  const state = fixture();
  const payload = { name: "Sari Baru", email: "sari@another.local", password, password_confirmation: password };
  const signup = registerDemoEmployee(state, payload);
  assert.equal(signup.user.username, "sari.2");
  assert.equal(signup.user.registration_status, "pending");
  assert.equal(signup.user.active, false);
  const chosen = registerDemoEmployee(state, { ...payload, username: " SARI.KEDUA " });
  assert.equal(chosen.user.username, "sari.kedua");
  assert.throws(() => registerDemoEmployee(state, { ...payload, username: " SARI " }), /sudah digunakan/);
  assert.throws(() => registerDemoEmployee(state, { ...payload, username: "" }), /Username/);
  const created = executeCommand(state, "admin", "user.create", { name: "Sari Kedua", email: "sari@another.local", password, role: "employee" });
  assert.equal(created.users.at(-1)?.username, "sari.2");
  const custom = executeCommand(state, "admin", "user.create", { name: "Sari Kedua", email: "sari@another.local", username: "SARI.KEDUA", password, role: "employee" });
  assert.equal(custom.users.at(-1)?.username, "sari.kedua");
  assert.throws(() => executeCommand(state, "admin", "user.create", { name: "Baru", email: "new@test.local", username: "SARI", password, role: "employee" }), /sudah digunakan/);
});
