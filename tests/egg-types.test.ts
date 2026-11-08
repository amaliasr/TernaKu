import test from "node:test";
import assert from "node:assert/strict";
import { activePrice, allEggStock, businessDate, eggStock, emptyState, executeCommand, normalizeFarmState, pickupBalance } from "../src/lib/domain";
import { ALL_EGG_TYPES, eggTypePrice, emptyEggQuantities } from "../src/lib/egg-types";
import { demoStockCheckContext, harvestCounts } from "../src/lib/stock-checks";
import type { CommandPayload, Price, State, StockCheck } from "../src/lib/types";

const now = new Date("2026-11-07T15:00:00Z"), date = "2026-11-07";
const photo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC9sAAAAASUVORK5CYII=";
const command = (s: State, action: string, payload: CommandPayload, actor = "admin") => executeCommand(s, actor, action, payload, now);
function fixture(): State {
  return { ...emptyState(), users: [
    { id: "admin", name: "Atasan", role: "admin", email: "admin@example.test", active: true, target: 0 },
    { id: "worker", name: "Petugas", role: "employee", can_check_stock: true, email: "worker@example.test", active: true, target: 0 },
  ], prices: [{ id: "legacy-price", good_price: 27000, cracked_price: 17000, effective_at: "2026-11-01", created_at: "2026-11-01T00:00:00+07:00", created_by: "admin" }] };
}
const price = { good_price: 28000, cracked_price: 18000, effective_at: `${date}T00:00:00+07:00` };
const sample = { date, items: [
  { category: "skm", eggs: 485, kg: 28, trays: 3 },
  { category: "skm_new", eggs: 650, kg: 36, trays: 4 },
  { category: "cracked", eggs: 38, kg: 2.3, trays: 0 },
], photo };
function harvested() { return command(command(fixture(), "price.create", price), "production.create", sample, "worker"); }
function legacyStock() {
  const s = fixture();
  s.productions.push({ id: "old", date: "2026-11-01", category: "good", eggs: 100, kg: 6, trays: 1,
    user_id: "worker", barn_id: "", notes: "Catatan asli", photo, created_at: "2026-11-01T07:00:00+07:00", locked: true });
  return s;
}

test("three-type harvest totals 1173 eggs and 66.3kg with one 28k Bagus price", () => {
  const s = harvested();
  assert.deepEqual(eggStock(s), { eggs: 1173, kg: 66.3, trays: 7 });
  assert.deepEqual(eggStock(s, "skm"), { eggs: 485, kg: 28, trays: 3 });
  assert.deepEqual(eggStock(s, "skm_new"), { eggs: 650, kg: 36, trays: 4 });
  assert.deepEqual(eggStock(s, "good"), { eggs: 0, kg: 0, trays: 0 });
  assert.deepEqual(ALL_EGG_TYPES.map(c => eggTypePrice(activePrice(s, now), c)), [28000, 28000, 18000, 28000]);
  assert.equal(new Set(s.productions.map(p => p.harvest_id)).size, 1);
  assert.equal(s.productions[0].photo, photo);
  assert.deepEqual(harvestCounts(s.productions, date), allEggStock(s));
});

test("shared pricing supersedes later legacy schedules only after its WIB activation", () => {
  const s = fixture();
  s.prices.push({ id: "legacy-later", good_price: 27500, cracked_price: 17500, effective_at: `${date}T21:00:00+07:00`, created_at: "2026-11-02T00:00:00+07:00", created_by: "admin" });
  s.prices.push({ id: "shared", pricing_mode: "shared_good", good_price: 28000, cracked_price: 18000, effective_at: `${date}T22:00:00+07:00`, created_at: "2026-11-03T00:00:00+07:00", created_by: "admin" });
  s.prices.push({ id: "old-schedule", skm_price: 31000, skm_new_price: 33000, cracked_price: 19000, effective_at: "2026-11-08T00:00:00+07:00", created_at: "2026-11-04T00:00:00+07:00", created_by: "admin" });
  s.prices.push({ id: "next-shared", pricing_mode: "shared_good", good_price: 30000, cracked_price: 20000, effective_at: "2026-11-09T00:00:00+07:00", created_at: "2026-11-05T00:00:00+07:00", created_by: "admin" });
  const unchanged = structuredClone(s.prices);
  assert.equal(activePrice(s, `${date}T21:59:59+07:00`)?.id, "legacy-later");
  assert.equal(eggTypePrice(activePrice(s, `${date}T21:59:59+07:00`), "skm_new"), 27500);
  assert.equal(activePrice(s, now)?.id, "shared");
  const afterOldSchedule = activePrice(s, "2026-11-08T23:59:59+07:00")!;
  assert.equal(afterOldSchedule.id, "shared");
  assert.deepEqual(ALL_EGG_TYPES.map(c => eggTypePrice(afterOldSchedule, c)), [28000, 28000, 18000, 28000]);
  assert.equal(activePrice(s, "2026-11-09T00:00:00+07:00")?.id, "next-shared");
  assert.deepEqual(s.prices, unchanged);
});

test("before shared activation legacy good or equal typed rates are accepted; unequal rates remain unset", () => {
  const source = fixture();
  assert.equal(eggTypePrice(activePrice(source, now), "skm_new"), 27000);
  const legacy = source.prices[0];
  const cases: [Partial<Price>, number | undefined][] = [
    [{ good_price: 26000, skm_price: 28000, skm_new_price: 29000 }, 26000],
    [{ good_price: undefined, skm_price: 28000, skm_new_price: 28000 }, 28000],
    [{ good_price: undefined, skm_price: 28000, skm_new_price: 29000 }, undefined],
    [{ good_price: undefined, skm_price: 28000, skm_new_price: undefined }, undefined],
  ];
  for (const [rates, expected] of cases) {
    source.prices = [{ ...legacy, ...rates }];
    const resolved = activePrice(source, now);
    assert.equal(eggTypePrice(resolved, "skm"), expected);
    assert.equal(eggTypePrice(resolved, "skm_new"), expected);
    assert.equal(eggTypePrice(resolved, "cracked"), 17000);
  }
  const ambiguous = command(source, "production.create", sample, "worker");
  assert.throws(() => command(ambiguous, "sale.create", { date, stock_source: "warehouse", customer: "Warung", photo,
    payment_method: "cash", paid: 0, items: [{ category: "skm", kg: 1, eggs: 17 }] }, "worker"), /belum diatur/);
});

test("price creation rejects split fields and repeated identical updates remain distinct notifications", () => {
  const source = fixture();
  assert.throws(() => command(source, "price.create", { skm_price: 28000, skm_new_price: 29000, cracked_price: 18000, effective_at: price.effective_at }), /harga|Harga/);
  assert.throws(() => command(source, "price.create", { ...price, skm_price: 28000 }), /harga|Harga/);
  const first = command(source, "price.create", price), second = command(first, "price.create", price);
  assert.equal(second.prices.filter(p => p.pricing_mode === "shared_good").length, 2);
  assert.notEqual(second.prices.at(-1)?.id, second.prices.at(-2)?.id);
  assert.equal(new Set(second.notifications.map(n => n.id)).size, 4);
  assert.deepEqual(second.prices.at(-1) && [second.prices.at(-1)!.good_price, second.prices.at(-1)!.skm_price, second.prices.at(-1)!.skm_new_price], [28000, 28000, 28000]);
});

test("mixed warehouse sale uses shared Bagus rate, debits separate stocks and preserves its old snapshot", () => {
  const source = harvested();
  const payload = { date, stock_source: "warehouse", customer: "Warung uji", photo, payment_method: "cash", paid: 40000,
    items: [{ category: "skm", kg: 1 }, { category: "skm_new", kg: 2 }, { category: "cracked", kg: 0.3 }] };
  const sold = command(source, "sale.create", payload, "worker");
  assert.equal(sold.sales.length, 1);
  assert.equal(sold.sales[0].total, 89400);
  assert.equal(sold.sales[0].paid, 40000);
  assert.equal(sold.sales[0].balance, 49400);
  assert.deepEqual(sold.sales[0].items.map(i => i.unit_price), [28000, 28000, 18000]);
  assert.deepEqual([eggStock(sold, "skm").kg, eggStock(sold, "skm_new").kg, eggStock(sold, "cracked").kg], [27, 34, 2]);
  assert.throws(() => command(source, "sale.create", { ...payload, items: [{ category: "skm", eggs: 500, kg: 29 }] }, "worker"), /melebihi|cukup/);
  const repriced = command(sold, "price.create", { ...price, good_price: 35000 });
  assert.deepEqual(repriced.sales, sold.sales);
});

test("normalization converts historical identities once while preserving images, financial snapshots, audit and prices", () => {
  const source = legacyStock();
  source.productions.push({ ...source.productions[0], id: "typed", category: "skm", trays: 2 });
  source.pickups.push({ id: "old-pickup", date: "2026-11-01", category: "good", eggs: 20, kg: 1.2, trays: 1, user_id: "worker", area: "Pasar", notes: "", created_at: "2026-11-01T08:00:00+07:00", locked: false, returned_eggs: 0, returned_kg: 0, returned_trays: 0 });
  source.sales.push({ id: "old-sale", number: "TRX-OLD", date: "2026-11-01T10:00:00+07:00", created_at: "2026-11-01T10:01:00+07:00", user_id: "worker", customer: "Pelanggan lama", phone: "", notes: "Catatan asli", photo, payment_method: "credit", payment_status: "partial", paid: 10000, balance: 6200, total: 16200, locked: true, items: [{ id: "old-item", pickup_id: "old-pickup", category: "good", eggs: 10, kg: .6, trays: 0, unit_price: 27000, total: 16200 }] });
  source.stock_movements = [{ id: "old-move", category: "good", kind: "pickup", reference_id: "old-pickup", user_id: "worker", date: "2026-11-01", created_at: "2026-11-01T08:00:00+07:00", eggs: -20, kg: -1.2, trays: -1, notes: "Catatan asli" }];
  source.inventory = { ...emptyEggQuantities(), good: { eggs: 80, kg: 4.8, trays: 0 }, skm: { eggs: 100, kg: 6, trays: 2 } };
  source.activity = [{ id: "old-audit", user_id: "worker", action: "sale.create", description: "Asli", created_at: "2026-11-01", before: { category: "good", price: 27000, photo }, after: { category: "good", price: 27000 }, demo_write: { request_id: "frozen-id", fingerprint: "unchanged", record_id: "old-sale" } }];
  const original = structuredClone(source), normalized = normalizeFarmState(source, now.toISOString());
  assert.deepEqual(source, original);
  assert.ok(normalized.productions.every(row => row.category === "skm"));
  assert.equal(normalized.pickups[0].category, "skm");
  assert.equal(normalized.sales[0].items[0].category, "skm");
  assert.equal(normalized.stock_movements![0].category, "skm");
  assert.deepEqual(eggStock(normalized), eggStock(original));
  assert.deepEqual(eggStock(normalized, "skm"), { eggs: 180, kg: 10.8, trays: 2 });
  assert.deepEqual(normalized.inventory!.good, { eggs: 0, kg: 0, trays: 0 });
  assert.deepEqual(normalized.productions.map(row => row.photo), original.productions.map(row => row.photo));
  assert.deepEqual(normalized.sales[0], { ...original.sales[0], items: original.sales[0].items.map(item => ({ ...item, category: "skm" })) });
  assert.deepEqual(normalized.activity, original.activity);
  assert.deepEqual(normalized.prices, original.prices);
  assert.deepEqual(normalizeFarmState(normalized, "2026-11-09T00:00:00Z"), normalized);
});

test("context-only legacy counts normalize even when every loaded record is already canonical", () => {
  const source = fixture();
  const quantities = { ...emptyEggQuantities(), good: { eggs: 17, kg: 1.001, trays: 1 }, skm: { eggs: 34, kg: 2, trays: 2 } };
  source.stock_check_context = { schema_version: 2, date, snapshot: "stale-read-only", warehouse: structuredClone(quantities), harvest: structuredClone(quantities) };
  const normalized = normalizeFarmState(source, now.toISOString());
  assert.deepEqual(normalized.stock_check_context!.warehouse.skm, { eggs: 51, kg: 3.001, trays: 3 });
  assert.deepEqual(normalized.stock_check_context!.warehouse.good, { eggs: 0, kg: 0, trays: 0 });
  assert.deepEqual(normalized.stock_check_context!.harvest, normalized.stock_check_context!.warehouse);
  assert.deepEqual(source.stock_check_context.warehouse.good, quantities.good);
});

test("frozen legacy commands canonicalize to SKM without changing their serialized payload", () => {
  const source = legacyStock();
  const payload = { date, category: "good", eggs: 10, kg: .6, trays: 0, photo };
  const serialized = JSON.stringify(payload);
  Object.freeze(payload);
  const result = command(source, "production.create", payload, "worker");
  assert.equal(result.productions.at(-1)?.category, "skm");
  assert.equal(JSON.stringify(payload), serialized);
  const salePayload = { date, stock_source: "warehouse", customer: "Pelanggan lama", photo, payment_method: "cash", paid: 0, items: [Object.freeze({ category: "good", eggs: 10, kg: .6 })] };
  const saleBytes = JSON.stringify(salePayload); Object.freeze(salePayload.items); Object.freeze(salePayload);
  const sold = command(result, "sale.create", salePayload, "worker");
  assert.equal(sold.sales[0].items[0].category, "skm");
  assert.equal(sold.sales[0].items[0].unit_price, 27000);
  assert.equal(JSON.stringify(salePayload), saleBytes);
});

test("good and skm aliases cannot bypass duplicate harvest or stock count validation", () => {
  const source = harvested();
  const rows = [{ category: "good", eggs: 17, kg: 1, trays: 0 }, { category: "skm", eggs: 17, kg: 1, trays: 0 }];
  assert.throws(() => command(source, "production.create", { date, items: rows }, "worker"), /berulang/);
  const expected = eggStock(source, "skm");
  const physical = { ...expected, eggs: expected.eggs + 17, kg: expected.kg + 1 };
  assert.throws(() => command(source, "stock.reconcile", { reason: "Hitung ulang stok gudang", items: ["good", "skm"].map(category => ({ category, expected, physical })) }), /sekali|berulang/);
});

test("independent historical tray counts combine to nine then a later pickup leaves eight", () => {
  const source = legacyStock();
  source.productions[0].trays = 2;
  source.productions.push({ ...source.productions[0], id: "typed", category: "skm", trays: 3 });
  source.stock_movements = [
    { id: "count-good", category: "good", kind: "reconcile", method: "count", reference_id: "count-1", user_id: "admin", date, created_at: `${date}T08:00:00+07:00`, eggs: 0, kg: 0, trays: 2, expected: { eggs: 100, kg: 6, trays: 2 }, physical: { eggs: 100, kg: 6, trays: 4 }, notes: "Hitung krat lama" },
    { id: "count-skm", category: "skm", kind: "reconcile", method: "count", reference_id: "count-2", user_id: "admin", date, created_at: `${date}T08:01:00+07:00`, eggs: 0, kg: 0, trays: 2, expected: { eggs: 100, kg: 6, trays: 3 }, physical: { eggs: 100, kg: 6, trays: 5 }, notes: "Hitung krat SKM" },
  ];
  const normalized = normalizeFarmState(source, now.toISOString());
  assert.equal(eggStock(source, "skm").trays, 9);
  assert.equal(eggStock(normalized, "skm").trays, 9);
  assert.deepEqual(normalized.stock_movements!.map(row => row.physical), source.stock_movements.map(row => row.physical));
  assert.equal(normalized.stock_movements!.at(-1)?.merged_trays_after, 9);
  assert.deepEqual(normalizeFarmState(normalized), normalized);
  const picked = command(normalized, "pickup.create", { date, category: "skm", eggs: 17, kg: 1, trays: 1, area: "Pasar" }, "worker");
  assert.equal(eggStock(picked, "skm").trays, 8);
  assert.equal(eggStock(picked, "skm").kg, 11);
});

test("legacy carried eggs migrate to SKM and remain returnable and sellable at the common rate", () => {
  let source = legacyStock();
  source.pickups.push({ id: "old-pickup", date: "2026-11-01", category: "good", eggs: 60, kg: 3.6, trays: 0, user_id: "worker", area: "Pasar", notes: "", created_at: "2026-11-01T08:00:00+07:00", locked: false, returned_eggs: 0, returned_kg: 0, returned_trays: 0 });
  source = command(source, "pickup.return", { id: "old-pickup", eggs: 10, kg: .6, trays: 0 }, "worker");
  source = command(source, "sale.create", { date, customer: "Pelanggan lama", photo, payment_method: "cash", paid: 0,
    items: [{ category: "good", pickup_id: "old-pickup", eggs: 50, kg: 3, trays: 0 }] }, "worker");
  assert.equal(source.pickups[0].category, "skm");
  assert.equal(source.sales[0].items[0].category, "skm");
  assert.equal(source.sales[0].items[0].unit_price, 27000);
  assert.equal(pickupBalance(source, "old-pickup").kg, 0);
  assert.equal(eggStock(source, "good").kg, 0);
  assert.equal(eggStock(source, "skm").kg, 3);
});

test("pending legacy stock checks become rejected and require a fresh count", () => {
  const source = legacyStock();
  const quantities = { ...emptyEggQuantities(), good: { eggs: 100, kg: 6, trays: 1 } };
  const old: StockCheck = { id: "old-check", schema_version: 2, date, user_id: "worker", status: "pending", snapshot: "legacy-snapshot", movement_sequence: 0, expected: { warehouse: structuredClone(quantities), harvest: structuredClone(quantities) }, warehouse_actual: structuredClone(quantities), harvest_actual: structuredClone(quantities), reason: "Periksa catatan panen lama", production_ids: ["old"], created_at: `${date}T08:00:00+07:00`, updated_at: `${date}T08:00:00+07:00`, reviewed_at: null, reviewed_by: null, review_reason: "" };
  source.stock_checks = [old, { ...structuredClone(old), id: "old-confirmed", date: "2026-11-06", status: "confirmed" }];
  const normalized = normalizeFarmState(source, now.toISOString());
  assert.equal(source.stock_checks[0].status, "pending");
  assert.equal(normalized.stock_checks![0].status, "rejected");
  assert.match(normalized.stock_checks![0].review_reason, /Periksa ulang/);
  assert.equal(normalized.stock_checks![1].status, "confirmed");
  assert.deepEqual(normalized.stock_checks![0].warehouse_actual.skm, { eggs: 100, kg: 6, trays: 1 });
  assert.throws(() => command(normalized, "stock_check.review", { schema_version: 2, id: "old-check", decision: "approve" }), /menunggu persetujuan/);
  const context = demoStockCheckContext(normalized, date, allEggStock(normalized));
  const checked = command(normalized, "stock_check.submit", { schema_version: 2, date, expected_snapshot: context.snapshot, status: "confirmed" }, "worker");
  assert.equal(checked.stock_checks![0].status, "superseded");
  assert.equal(checked.stock_checks!.at(-1)?.status, "confirmed");
  assert.deepEqual(checked.stock_checks!.at(-1)?.warehouse_actual.good, { eggs: 0, kg: 0, trays: 0 });
});

test("22:00 recap remains on its WIB date until midnight", () => {
  assert.equal(businessDate("2026-11-07T22:00:00+07:00"), "2026-11-07");
  assert.equal(businessDate("2026-11-07T23:59:59+07:00"), "2026-11-07");
  assert.equal(businessDate("2026-11-07T17:00:00Z"), "2026-11-08");
  assert.equal(businessDate("2026-11-08T00:00:00+07:00"), "2026-11-08");
});
