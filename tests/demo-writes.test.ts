import test from "node:test";
import assert from "node:assert/strict";
import { applyDemoWrite, withDemoWriteLock } from "../src/lib/demo-writes";
import { closingEggStock, eggStock, emptyState, executeCommand, pickupBalance, visibleState } from "../src/lib/domain";
import { ApiError } from "../src/lib/request-errors";
import type { State } from "../src/lib/types";

const at = new Date("2026-10-24T10:00:00+07:00");
const date = "2026-10-24";
const harvest = { date, items: [ { category: "good", eggs: 100, kg: 6, trays: 1 }, { category: "cracked", eggs: 20, kg: 1.2, trays: 0 } ] };
const attempt = { request_id: "same-uuid", fingerprint: "a".repeat(64) };
const salePhoto = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC9sAAAAASUVORK5CYII=";
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
  const payload = {date, customer:"Bu Sari", photo:salePhoto,
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

const warehouse = {
  stock_source: "warehouse", date, customer: "Bu Sari", photo: salePhoto, payment_method: "credit", paid: 0,
  items: [
    { category: "good", eggs: 40, kg: 2.4, trays: 1 },
    { category: "cracked", eggs: 6, kg: 0.36, trays: 0, is_free: true },
    { category: "cracked", eggs: 4, kg: 0.24, trays: 0 },
  ],
};

test("warehouse sale debits each category once, even with a repeated request or mixed paid/free lines", () => {
  const harvested = executeCommand(legacy(), "sari", "production.create", harvest, at);
  const before = executeCommand(harvested, "budi", "pickup.create",
    { date, category: "good", eggs: 10, kg: 0.6, trays: 0, area: "Pasar" }, at);
  const first = applyDemoWrite(before, "budi", "sale.create", warehouse, attempt, at);
  const { state, result } = applyDemoWrite(JSON.parse(JSON.stringify(first.state)), "budi", "sale.create", warehouse, attempt, at);
  assert.deepEqual(result, first.result);
  assert.equal(state.sales.length, 1);
  const [sale] = state.sales;
  assert.equal(sale.stock_source, "warehouse");
  assert.equal(sale.user_id, "budi");
  assert.equal(sale.total, 2.4 * 28000 + 0.24 * 18000);
  assert.equal(sale.balance, sale.total);
  assert.deepEqual(sale.items.map(i => [i.pickup_id, i.unit_price]), [["", 28000], ["", 0], ["", 18000]]);
  assert.deepEqual(state.pickups, before.pickups);
  assert.deepEqual(pickupBalance(state, state.pickups[0]), pickupBalance(before, before.pickups[0]));
  const moves = state.stock_movements!.filter(m => m.reference_id === sale.id);
  assert.deepEqual(moves.map(m => [m.kind, m.category, m.eggs, m.kg, m.trays, m.user_id]), [
    ["sale", "good", -40, -2.4, -1, "budi"], ["sale", "cracked", -10, -0.6, 0, "budi"],
  ]);
  assert.deepEqual(eggStock(state, "good"), { eggs: 50, kg: 3, trays: 0 });
  assert.deepEqual(eggStock(state, "cracked"), { eggs: 10, kg: 0.6, trays: 0 });
  const sari = visibleState(state, state.users[0]);
  assert.equal(sari.sales.length, 0);
  assert.deepEqual(eggStock(sari), eggStock(state));
  assert.deepEqual(closingEggStock(state, "cracked", "2026-10-23", date), { eggs: 0, kg: 0 });
});

test("warehouse entries reject insufficient combined stock, unknown sources, and mixed pickup IDs atomically", () => {
  const state = executeCommand(legacy(), "sari", "production.create", harvest, at);
  const good = warehouse.items[0];
  for (const items of [
    [{ ...good, eggs: 60, kg: 3.6, trays: 0 }, { ...good, eggs: 55, kg: 3.3 }],
    [good, { ...good, trays: 1 }],
    [good, { ...good, kg: 5, trays: 0 }],
    [{ ...good, kg: 6 }],
    [{ ...good, pickup_id: "unexpected" }],
  ]) assert.throws(() => executeCommand(state, "budi", "sale.create", { ...warehouse, items }, at));
  for (const source of [undefined, "pickup", "other"])
    assert.throws(() => executeCommand(state, "budi", "sale.create", { ...warehouse, stock_source: source }, at));
  assert.equal(state.sales.length, 0);
  assert.equal(state.stock_movements!.length, 2);
});

test("warehouse sale correction restores only its delta on the approval date and retains the seller's original prices", () => {
  const initial = legacy();
  initial.users.push({ ...initial.users[0], id: "admin", name: "Atasan", role: "admin" });
  const state = executeCommand(initial, "sari", "production.create", harvest, at);
  const sold = executeCommand(state, "budi", "sale.create", { ...warehouse, items: [warehouse.items[0]] }, at);
  const sale = sold.sales[0], [item] = sale.items;
  const nextDay = new Date("2026-10-25T09:00:00+07:00");
  const changes = { items: [{ id: item.id, eggs: 10, kg: 0.6, trays: 0 }] };
  const correction = { entity: "sale", id: sale.id, changes, reason: "Berat awal salah dibaca" };
  const requested = executeCommand(sold, "budi", "correction.request", correction, nextDay);
  assert.deepEqual(eggStock(requested), eggStock(sold));
  const approved = executeCommand(requested, "admin", "correction.review",
    { id: requested.corrections[0].id, approved: true }, nextDay);
  assert.equal(approved.sales[0].total, item.unit_price * 0.6);
  assert.deepEqual(eggStock(approved, "good"), { eggs: 90, kg: 5.4, trays: 1 });
  assert.deepEqual(closingEggStock(approved, "good", date, "2026-10-25"), { eggs: 60, kg: 3.6 });
  const movement = approved.stock_movements!.at(-1)!;
  assert.deepEqual([movement.kind, movement.reference_id, movement.user_id, movement.eggs, movement.kg, movement.trays],
    ["correction", sale.id, "budi", 30, 1.8, 1]);
  assert.equal(approved.activity[0].user_id, "admin");
  assert.throws(() => executeCommand(approved, "admin", "correction.apply", {
    ...correction, changes: { items: [{ id: item.id, eggs: 101, kg: 6.06, trays: 1 }] },
  }, nextDay), /gudang/);
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
