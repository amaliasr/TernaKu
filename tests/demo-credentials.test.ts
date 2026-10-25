import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { demoPasswordMatches, parseDemoCredentials, persistDemoData, renameDemoCredential } from "../src/lib/demo-credentials";

const hash = async (email: string, password: string) => createHash("sha256").update(`ternaku-demo:${email}:${password}`).digest("hex");

test("renaming a demo account preserves its original password across repeated email edits", async () => {
  const password = "Password123!";
  const original = { "old@example.test": await hash("old@example.test", password) };
  const renamed = renameDemoCredential(original, " OLD@example.test ", " New@example.test ");
  const twice = parseDemoCredentials(JSON.stringify(renameDemoCredential(renamed, "new@example.test", "final@example.test")));
  assert.equal(await demoPasswordMatches(twice, " FINAL@example.test ", password, null, hash), true);
  assert.equal(await demoPasswordMatches(twice, "final@example.test", "incorrect", null, hash), false);
  assert.equal(await demoPasswordMatches(twice, "old@example.test", password, null, hash), false);
  assert.equal(await demoPasswordMatches(twice, "new@example.test", password, null, hash), false);
  assert.deepEqual(Object.keys(original), ["old@example.test"]);
  assert.deepEqual(Object.keys(twice), ["final@example.test"]);
});

test("legacy credentials still work and stored passwords override the seed fallback", async () => {
  const credentials = parseDemoCredentials(JSON.stringify({ "seed@example.test": await hash("seed@example.test", "Custom123!") }));
  assert.equal(await demoPasswordMatches(credentials, "seed@example.test", "Custom123!", "Demo123!", hash), true);
  assert.equal(await demoPasswordMatches(credentials, "seed@example.test", "Demo123!", "Demo123!", hash), false);
  assert.equal(await demoPasswordMatches({}, "new@example.test", "Demo123!", null, hash), false);
});

test("renamed seed accounts keep their seed password without inheriting a stale destination credential", async () => {
  const credentials = { "renamed@example.test": await hash("renamed@example.test", "Unrelated123!") };
  const renamed = renameDemoCredential(credentials, "seed@example.test", "renamed@example.test");
  assert.equal(await demoPasswordMatches(renamed, "renamed@example.test", "Demo123!", "Demo123!", hash), true);
  assert.equal(await demoPasswordMatches(renamed, "renamed@example.test", "Unrelated123!", "Demo123!", hash), false);
  for (const raw of ["null", "[]", '{"x@example.test":{}}', '{"x@example.test":"not-a-hash"}'])
    assert.throws(() => parseDemoCredentials(raw), /akun demo/);
});

class StorageFixture {
  values = new Map<string, string>();
  failKey: string | null = null;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (key === this.failKey) throw new Error("Quota exceeded");
    this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
}

test("a failed state save rolls back renamed credentials; a credential save failure leaves state untouched", async () => {
  const storage = new StorageFixture();
  const original = { "old@example.test": await hash("old@example.test", "Password123!") };
  storage.setItem("state", JSON.stringify({ email: "old@example.test" }));
  storage.setItem("credentials", JSON.stringify(original));
  const next = renameDemoCredential(original, "old@example.test", "new@example.test");
  storage.failKey = "state";
  assert.throws(() => persistDemoData(storage, "state", { email: "new@example.test" }, "credentials", next), /Quota/);
  assert.deepEqual(parseDemoCredentials(storage.getItem("credentials")), original);
  assert.equal(JSON.parse(storage.getItem("state")!).email, "old@example.test");
  storage.failKey = "credentials";
  assert.throws(() => persistDemoData(storage, "state", { email: "new@example.test" }, "credentials", next), /Quota/);
  assert.equal(JSON.parse(storage.getItem("state")!).email, "old@example.test");
  storage.failKey = null;
  persistDemoData(storage, "state", { email: "new@example.test" }, "credentials", next);
  assert.equal(JSON.parse(storage.getItem("state")!).email, "new@example.test");
  assert.equal(await demoPasswordMatches(parseDemoCredentials(storage.getItem("credentials")), "new@example.test", "Password123!", null, hash), true);
});

test("failed first account save removes its temporary credential entry", () => {
  const storage = new StorageFixture();
  storage.failKey = "state";
  assert.throws(() => persistDemoData(storage, "state", {}, "credentials", { "a@example.test": "a".repeat(64) }), /Quota/);
  assert.equal(storage.getItem("credentials"), null);
});
