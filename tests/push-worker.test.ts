import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function worker() {
  const handlers: Record<string, (event: any) => void> = {};
  const notices: { title: string; options: any }[] = [];
  const opened: string[] = [];
  const context = vm.createContext({
    URL,
    self: {
      location: { origin: "https://ternaku.test" },
      addEventListener: (name: string, handler: any) => {
        handlers[name] = handler;
      },
      registration: {
        showNotification: async (title: string, options: any) => {
          notices.push({ title, options });
        },
      },
      clients: {
        matchAll: async () => [],
        openWindow: async (url: string) => {
          opened.push(url);
        },
      },
    },
  });
  vm.runInContext(await readFile("public/sw.js", "utf8"), context);
  return { handlers, notices, opened };
}

test("every distinct price update has a notification even when the amounts match", async () => {
  const { handlers, notices } = await worker();
  for (const id of ["price_one", "price_two"]) {
    let work: Promise<void> | undefined;
    handlers.push({
      data: {
        json: () => ({
          title: "Harga diperbarui",
          body: "Bagus Rp28.000 · Bentes Rp18.000",
          tag: id,
        }),
      },
      waitUntil: (value: Promise<void>) => {
        work = value;
      },
    });
    await work;
  }
  assert.equal(notices.length, 2);
  assert.notEqual(notices[0].options.tag, notices[1].options.tag);
  assert.equal(notices[0].options.body, notices[1].options.body);
  assert.equal(notices[0].options.renotify, true);
});

test("push notice and click always lead to TernaKu, never an external payload URL", async () => {
  const { handlers, notices, opened } = await worker();
  let work: Promise<void> | undefined;
  handlers.push({
    data: { json: () => ({ url: "https://evil.example/", body: "Update" }) },
    waitUntil: (value: Promise<void>) => {
      work = value;
    },
  });
  await work;
  assert.equal(notices[0].options.data.url, "/");
  let closed = false;
  handlers.notificationclick({
    notification: {
      close: () => {
        closed = true;
      },
    },
    waitUntil: (value: Promise<void>) => {
      work = value;
    },
  });
  await work;
  assert.equal(closed, true);
  assert.deepEqual(opened, ["/"]);
});

test("malformed or non-object push data still displays a safe notice", async () => {
  const { handlers, notices } = await worker();
  for (const payload of [null, [], "unexpected", 42]) {
    let work: Promise<void> | undefined;
    handlers.push({
      data: { json: () => payload },
      waitUntil: (value: Promise<void>) => {
        work = value;
      },
    });
    await work;
  }
  assert.equal(notices.length, 4);
  for (const notice of notices) {
    assert.equal(notice.title, "Pemberitahuan TernaKu");
    assert.equal(notice.options.data.url, "/");
  }
});
