import test from "node:test";
import assert from "node:assert/strict";
import { MediaCache, mediaPath } from "../src/lib/media-cache";
import type { MediaReference } from "../src/lib/types";

const reference = (id = "one", version = "a".repeat(64)): MediaReference => ({ kind: "profile", id, version });

test("media cache deduplicates in-flight reads and separates changed image versions", async () => {
  const cache = new MediaCache();
  let fetches = 0;
  const fetchBlob = async () => { fetches += 1; return new Blob(["photo"]); };
  const one = cache.load(reference(), fetchBlob);
  assert.equal(cache.load(reference(), fetchBlob), one);
  const blob = await one;
  assert.equal(await cache.load(reference(), fetchBlob), blob);
  await cache.load(reference("one", "b".repeat(64)), fetchBlob);
  assert.equal(fetches, 2);
});

test("only the most recently used photos remain in bounded memory", async () => {
  const cache = new MediaCache(2);
  const fetches: string[] = [];
  const load = (id: string) => cache.load(reference(id), async () => { fetches.push(id); return new Blob([id]); });
  await load("one"); await load("two"); await load("one"); await load("three");
  await load("one"); await load("two");
  assert.deepEqual(fetches, ["one", "two", "three", "two"]);
});

test("session reset discards completed and pending photos without poisoning the next account", async () => {
  const cache = new MediaCache();
  let resolve!: (blob: Blob) => void;
  const pending = cache.load(reference(), () => new Promise<Blob>((done) => { resolve = done; }));
  await Promise.resolve();
  cache.clear();
  const next = new Blob(["new account"]);
  const current = cache.load(reference(), async () => next);
  resolve(new Blob(["old account"]));
  await assert.rejects(pending, /Sesi berubah/);
  assert.equal(await current, next);
  assert.equal(await cache.load(reference(), async () => { throw new Error("must remain cached"); }), next);
});

test("failed media loads can be retried and unsafe references never invoke a request", async () => {
  const cache = new MediaCache();
  await assert.rejects(cache.load(reference(), async () => { throw new Error("offline"); }), /offline/);
  const blob = new Blob(["retry"]);
  assert.equal(await cache.load(reference(), async () => blob), blob);
  assert.throws(() => mediaPath(reference("../other")), /Alamat foto/);
  assert.throws(() => mediaPath(reference("one", "bad-version")), /Alamat foto/);
  assert.equal(mediaPath(reference()), `/media/profile/one?v=${"a".repeat(64)}`);
});
