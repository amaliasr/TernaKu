import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

async function worker(network: () => Promise<Response>) {
  const handlers: Record<string, (event: Record<string, unknown>) => void> = {};
  const context = vm.createContext({
    URL, Request, Response,
    self: { location: { origin: "https://ternaku.test" }, addEventListener: (name: string, fn: typeof handlers[string]) => { handlers[name] = fn; } },
    fetch: network,
    caches: { match: async () => new Response("Sambungkan internet dulu", { headers: { "Content-Type": "text/html" } }) },
  });
  vm.runInContext(await readFile("public/sw.js", "utf8"), context);
  return handlers.fetch;
}

test("installed app never intercepts API reads or transaction writes", async () => {
  const handle = await worker(async () => { throw new Error("network should not be called by worker"); });
  for (const request of [
    { method: "GET", mode: "cors", url: "https://api.buildmanagement.id/ternaku/bootstrap" },
    { method: "POST", mode: "cors", url: "https://api.buildmanagement.id/ternaku/commands" },
    { method: "POST", mode: "navigate", url: "https://ternaku.test/auth/login" },
    { method: "GET", mode: "navigate", url: "https://other.test/" },
  ]) handle({ request, respondWith: () => assert.fail("API/transaction was intercepted") });
});

test("installed app loads fresh page online and only a public notice when disconnected", async () => {
  for (const online of [true, false]) {
    const handle = await worker(async () => { if (!online) throw new TypeError("offline"); return new Response("Fresh page"); });
    let response: Promise<Response> | undefined;
    handle({ request: { method: "GET", mode: "navigate", url: "https://ternaku.test/" }, respondWith: (value: Promise<Response>) => { response = value; } });
    assert.ok(response);
    assert.equal(await (await response).text(), online ? "Fresh page" : "Sambungkan internet dulu");
  }
});

test("install manifest uses real PNG icons with the declared sizes and a scoped launch URL", async () => {
  const manifest = JSON.parse(await readFile("public/manifest.webmanifest", "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.scope, "/");
  assert.equal(new URL(manifest.start_url, "https://ternaku.test").origin, "https://ternaku.test");
  for (const icon of [...manifest.icons, {src:"/icons/apple-touch-icon.png", sizes:"180x180"}]) {
    const png = await readFile(`public${icon.src}`);
    assert.equal(png.subarray(1,4).toString(), "PNG");
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
});
