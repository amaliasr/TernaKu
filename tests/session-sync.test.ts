import test from "node:test";
import assert from "node:assert/strict";
import { refreshInterval, SessionSync } from "../src/lib/session-sync";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("employees check every five seconds and admin keeps a one-minute interval", () => {
  assert.equal(refreshInterval("employee"), 5000);
  assert.equal(refreshInterval("admin"), 60000);
});

test("a slow refresh is reused rather than starting overlapping reads", async () => {
  const sync = new SessionSync();
  const response = deferred();
  let calls = 0;
  const read = () => {
    calls += 1;
    return response.promise;
  };
  const first = sync.refresh(read);
  const second = sync.refresh(read);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  response.resolve();
  await first;
  await sync.refresh(async () => {
    calls += 1;
  });
  assert.equal(calls, 2);
});

test("a pre-save response cannot overwrite a completed sale", async () => {
  const sync = new SessionSync();
  const response = deferred();
  let displayedSales = 0;
  const refresh = sync.refresh(async ({ canApply }) => {
    await response.promise;
    if (canApply()) displayedSales = 0;
  });
  await Promise.resolve();
  const finish = sync.beginMutation();
  displayedSales = 1;
  finish();
  response.resolve();
  await refresh;
  assert.equal(displayedSales, 1);
});

test("polling waits for an in-progress save and resumes afterwards", async () => {
  const sync = new SessionSync();
  const finish = sync.beginMutation();
  let calls = 0;
  const read = async () => {
    calls += 1;
  };
  await sync.refresh(read);
  assert.equal(calls, 0);
  finish();
  await sync.refresh(read);
  assert.equal(calls, 1);
});

test("logout prevents old response and old error UI from restoring a session", async () => {
  const sync = new SessionSync();
  const response = deferred();
  let applied = false;
  let updatedStatus = false;
  const refresh = sync.refresh(async ({ canApply, sessionActive }) => {
    await response.promise;
    if (canApply()) applied = true;
    if (sessionActive()) updatedStatus = true;
  });
  await Promise.resolve();
  sync.invalidate();
  response.resolve();
  await refresh;
  assert.equal(applied, false);
  assert.equal(updatedStatus, false);
});

test("the next user can refresh while an old session request is still pending", async () => {
  const sync = new SessionSync();
  const oldResponse = deferred();
  const newResponse = deferred();
  const oldRead = sync.refresh(async () => {
    await oldResponse.promise;
  });
  await Promise.resolve();
  sync.invalidate();
  const newRead = sync.refresh(async () => {
    await newResponse.promise;
  });
  await Promise.resolve();
  oldResponse.resolve();
  await oldRead;
  assert.equal(sync.refresh(async () => {}), newRead);
  newResponse.resolve();
  await newRead;
});

test("a failed refresh does not prevent the next interval from retrying", async () => {
  const sync = new SessionSync();
  await assert.rejects(
    sync.refresh(async () => {
      throw new Error("offline");
    }),
    /offline/,
  );
  let applied = false;
  await sync.refresh(async ({ canApply }) => {
    applied = canApply();
  });
  assert.equal(applied, true);
});

test("manual full refresh waits behind a lightweight poll and is never swallowed", async () => {
  const sync = new SessionSync();
  const response = deferred();
  const reads: string[] = [];
  const light = sync.refresh(async () => { reads.push("prices"); await response.promise; }, "prices");
  await Promise.resolve();
  const full = sync.refresh(async () => { reads.push("full"); }, "full");
  const duplicate = sync.refresh(async () => { reads.push("duplicate"); }, "full");
  assert.equal(full, duplicate);
  assert.deepEqual(reads, ["prices"]);
  response.resolve();
  await Promise.all([light, full]);
  assert.deepEqual(reads, ["prices", "full"]);
});

test("a failed lightweight poll still permits the queued full refresh", async () => {
  const sync = new SessionSync();
  const response = deferred();
  const light = sync.refresh(async () => { await response.promise; throw new Error("offline"); }, "prices");
  let fullRead = false;
  const full = sync.refresh(async ({ canApply }) => { fullRead = canApply(); }, "full");
  response.resolve();
  await assert.rejects(light, /offline/);
  await full;
  assert.equal(fullRead, true);
});

test("logout discards a queued full read and permits the next user's lightweight poll", async () => {
  const sync = new SessionSync();
  const response = deferred();
  const light = sync.refresh(async () => { await response.promise; }, "prices");
  let oldFullRead = false;
  const full = sync.refresh(async () => { oldFullRead = true; }, "full");
  sync.invalidate();
  let newRead = false;
  await sync.refresh(async ({ canApply }) => { newRead = canApply(); }, "prices");
  response.resolve();
  await Promise.all([light, full]);
  assert.equal(oldFullRead, false);
  assert.equal(newRead, true);
});

test("a new mutation prevents a queued full read until the confirmed command finishes", async () => {
  const sync = new SessionSync();
  const response = deferred();
  const light = sync.refresh(async () => { await response.promise; }, "prices");
  let fullReads = 0;
  const read = async () => { fullReads += 1; };
  const full = sync.refresh(read, "full");
  const finish = sync.beginMutation();
  response.resolve();
  await Promise.all([light, full]);
  assert.equal(fullReads, 0);
  finish();
  await sync.refresh(read, "full");
  assert.equal(fullReads, 1);
});
