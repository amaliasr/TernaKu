import test from "node:test";
import assert from "node:assert/strict";
import { applyDemoWrite, withDemoWriteLock } from "../src/lib/demo-writes";
import { eggStock, emptyState, executeCommand, pickupBalance } from "../src/lib/domain";
import { ApiError } from "../src/lib/request-errors";
import type { State } from "../src/lib/types";

const at = new Date("2026-10-24T10:00:00+07:00");
const date = "2026-10-24";
const harvest = { date, items: [ { category: "good", eggs: 100, kg: 6, trays: 1 }, { category: "cracked", eggs: 20, kg: 1.2, trays: 0 } ] };
const attempt = { request_id: "same-uuid", fingerprint: "a".repeat(64) };
function legacy(): State {
  const state = emptyState();
  state.users = ["sari", "budi"].map(id => ({id, name:id, role:"employee", active:true, target:0, email:`${id}@test.local`}));
  state.prices.push({ id:"harga", good_price:28000, cracked_price:18000, effective_at:date, created_by:"admin", created_at:at.toISOString() });
  return state;
}

test("batch harvest and its confirmation survive a reload together; request IDs are per account", () => {
  const first = applyDemoWrite(legacy(), "sari", "production.create", harvest, attempt, at);
  const persisted: State = JSON.parse(JSON.stringify(first.state));
  const retry = applyDemoWrite(persisted, "sari", "production.create", harvest, attempt, at);
  assert.equal(retry.state, persisted);
  assert.deepEqual(retry.result, first.result);
  assert.equal(eggStock(retry.state).eggs, 120);
  assert.equal(retry.state.productions.length, 2);
  assert.equal(retry.state.activity.length, 1);
  assert.throws(() => applyDemoWrite(persisted, "sari", "production.create", harvest, { ...attempt, fingerprint:"changed" }),
    (e: unknown) => e instanceof ApiError && e.status === 409);
  const other = applyDemoWrite(persisted, "budi", "production.create", harvest, attempt, at);
  assert.equal(other.state.productions.length, 4);
  persisted.users[0].active = false;
  assert.throws(() => applyDemoWrite(persisted, "sari", "production.create", harvest, attempt),
    (e: unknown) => e instanceof ApiError && e.status === 403);
});

test("sale retry after another sale returns the original note even after all its stock is sold", () => {
  const harvested = executeCommand(legacy(), "sari", "production.create", harvest, at);
  const state = executeCommand(harvested, "sari", "pickup.create", {date, category:"good", eggs:100, kg:6, trays:1, area:"Pasar"}, at);
  const pickup = state.pickups[0];
  const payload = {date, customer:"Bu Sari", photo:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC9sAAAAASUVORK5CYII=",
    payment_method:"cash", paid:0, items:[{pickup_id:pickup.id,category:"good",eggs:50,kg:3,trays:0}]};
  const first = applyDemoWrite(state, "sari", "sale.create", payload, attempt, at);
  const second = applyDemoWrite(first.state, "sari", "sale.create", payload, {...attempt,request_id:"second-uuid"}, at);
  const retry = applyDemoWrite(JSON.parse(JSON.stringify(second.state)), "sari", "sale.create", payload, attempt, at);
  assert.equal(retry.state.sales.length, 2);
  assert.deepEqual(retry.result, first.result);
  assert.notEqual(retry.result?.record_id, second.result?.record_id);
  assert.equal(pickupBalance(retry.state, pickup).eggs, 0);
  assert.throws(() => applyDemoWrite(retry.state, "sari", "sale.create", payload, {...attempt,request_id:"another-uuid"}, at),
    (e: unknown) => e instanceof ApiError && e.status === 422);
});

test("writers wait for another tab's lock and re-read its data before deciding whether to replay", { skip: !globalThis.navigator?.locks }, async () => {
  let persisted = JSON.stringify(legacy());
  let entered = false;
  let release!: () => void;
  let locked!: () => void;
  const lockedSignal = new Promise<void>(resolve => { locked = resolve; });
  const holder = navigator.locks.request("ternaku.demo.v1", async () => {
    locked();
    await new Promise<void>(resolve => { release = resolve; });
    persisted = JSON.stringify(applyDemoWrite(JSON.parse(persisted), "sari", "production.create", harvest, attempt, at).state);
  });
  await lockedSignal;
  const writes = ["sari", "budi"].map(user => withDemoWriteLock(() => {
    entered = true;
    const stored = applyDemoWrite(JSON.parse(persisted), user, "production.create", harvest, attempt, at);
    persisted = JSON.stringify(stored.state);
  }));
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(entered, false);
  release();
  await Promise.all([holder, ...writes]);
  assert.equal(JSON.parse(persisted).productions.length, 4);
});
