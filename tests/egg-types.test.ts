import test from "node:test";
import assert from "node:assert/strict";
import { activePrice, allEggStock, businessDate, eggStock, emptyState, executeCommand, pickupBalance } from "../src/lib/domain";
import { ALL_EGG_TYPES, eggTypePrice, emptyEggQuantities } from "../src/lib/egg-types";
import { demoStockCheckContext, harvestCounts } from "../src/lib/stock-checks";
import type { CommandPayload, State } from "../src/lib/types";

const now = new Date("2026-11-07T15:00:00Z"), date = "2026-11-07";
const photo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC9sAAAAASUVORK5CYII=";
const command = (s: State, action: string, payload: CommandPayload, actor = "admin") => executeCommand(s, actor, action, payload, now);
function fixture(): State {
  return { ...emptyState(), users: [
    { id: "admin", name: "Atasan", role: "admin", email: "admin@example.test", active: true, target: 0 },
    { id: "worker", name: "Petugas", role: "employee", can_check_stock: true, email: "worker@example.test", active: true, target: 0 },
  ], prices: [{ id: "legacy-price", good_price: 27000, cracked_price: 17000, effective_at: "2026-11-01", created_at: "2026-11-01T00:00:00+07:00", created_by: "admin" }] };
}
const price = { skm_price: 28000, skm_new_price: 29000, cracked_price: 18000, effective_at: `${date}T00:00:00+07:00` };
const sample = { date, items: [
  { category: "skm", eggs: 485, kg: 28, trays: 3 },
  { category: "skm_new", eggs: 650, kg: 36, trays: 4 },
  { category: "cracked", eggs: 38, kg: 2.3, trays: 0 },
], photo };
function harvested() { return command(command(fixture(), "price.create", price), "production.create", sample, "worker"); }
function legacyStock() {
  const s = fixture();
  s.productions.push({ id: "old", date: "2026-11-01", category: "good", eggs: 100, kg: 6, trays: 1,
    user_id: "worker", barn_id: "", notes: "Catatan asli", created_at: "2026-11-01T07:00:00+07:00", locked: true });
  return s;
}

test("three-type harvest matches the handwritten total with separate physical stock", () => {
  const s = harvested();
  assert.deepEqual(eggStock(s), { eggs: 1173, kg: 66.3, trays: 7 });
  assert.deepEqual(eggStock(s, "skm"), { eggs: 485, kg: 28, trays: 3 });
  assert.deepEqual(eggStock(s, "skm_new"), { eggs: 650, kg: 36, trays: 4 });
  assert.deepEqual(eggStock(s, "good"), { eggs: 0, kg: 0, trays: 0 });
  assert.equal(new Set(s.productions.map(p => p.harvest_id)).size, 1);
  assert.equal(s.productions[0].photo, photo);
  assert.deepEqual(harvestCounts(s.productions, date), allEggStock(s));
});

test("legacy prices do not imply either new rate and future legacy schedules cannot erase them", () => {
  const old = fixture();
  assert.equal(eggTypePrice(activePrice(old, now), "skm"), undefined);
  assert.equal(eggTypePrice(activePrice(old, now), "skm_new"), undefined);
  let s = command(old, "price.create", price);
  s.prices.push({ id: "old-schedule", good_price: 27500, cracked_price: 17500, effective_at: "2026-11-08T00:00:00+07:00", created_at: "2026-11-01T01:00:00+07:00", created_by: "admin" });
  const tomorrow = activePrice(s, "2026-11-08T00:00:00+07:00")!;
  assert.equal(tomorrow.id, "old-schedule");
  assert.deepEqual(ALL_EGG_TYPES.map(c => eggTypePrice(tomorrow, c)), [28000, 29000, 17500, 27500]);
  s = command(s, "price.create", price);
  assert.equal(s.prices.filter(p => p.skm_price === 28000).length, 2);
  assert.equal(new Set(s.notifications.map(n => n.id)).size, 4);
});

test("mixed warehouse sale snapshots all three prices once and never borrows another type", () => {
  const source = harvested();
  const payload = { date, stock_source: "warehouse", customer: "Warung uji", photo, payment_method: "cash", paid: 0,
    items: [{ category: "skm", kg: 1 }, { category: "skm_new", kg: 2 }, { category: "cracked", kg: 0.3 }] };
  const sold = command(source, "sale.create", payload, "worker");
  assert.equal(sold.sales.length, 1);
  assert.equal(sold.sales[0].total, 91400);
  assert.deepEqual(sold.sales[0].items.map(i => i.unit_price), [28000, 29000, 18000]);
  assert.deepEqual([eggStock(sold, "skm").kg, eggStock(sold, "skm_new").kg, eggStock(sold, "cracked").kg], [27, 34, 2]);
  assert.throws(() => command(source, "sale.create", { ...payload, items: [{ category: "skm", eggs: 500, kg: 29 }] }, "worker"), /melebihi|cukup/);
  const repriced = command(sold, "price.create", { ...price, skm_price: 35000, skm_new_price: 36000 });
  assert.deepEqual(repriced.sales, sold.sales);
});

test("unconfigured typed price blocks a sale rather than treating it as free or using the old good price", () => {
  const source = command(fixture(), "production.create", sample, "worker");
  assert.throws(() => command(source, "sale.create", { date, stock_source: "warehouse", customer: "Warung", photo,
    payment_method: "cash", paid: 0, items: [{ category: "skm", kg: 1, eggs: 17 }] }, "worker"), /belum diatur/);
  assert.equal(source.sales.length, 0);
  assert.equal(eggStock(source, "skm").kg, 28);
});

test("new harvest and pickup cannot create ambiguous good stock", () => {
  const source = legacyStock();
  for (const action of ["production.create", "pickup.create"])
    assert.throws(() => command(source, action, { date, category: "good", eggs: 10, kg: 0.6, trays: 0, area: "Pasar" }, "worker"), /SKM/);
  assert.equal(eggStock(source, "good").kg, 6);
});

test("classification transfers only checked legacy stock, conserving totals and all original records", () => {
  const old = legacyStock(), before = structuredClone(old.productions);
  const payload = { category: "skm_new", eggs: 50, kg: 3, trays: 0,
    expected_source: eggStock(old, "good"), expected_target: eggStock(old, "skm_new"), reason: "Sudah dipisahkan di gudang" };
  assert.throws(() => command(old, "stock.classify", payload, "worker"), /admin/);
  const result = command(old, "stock.classify", payload);
  assert.deepEqual(result.productions, before);
  assert.deepEqual(eggStock(result), eggStock(old));
  assert.equal(eggStock(result, "skm_new").kg, 3);
  assert.equal(eggStock(result, "good").kg, 3);
  assert.equal(result.activity.at(-1)?.action, "stock.classify");
  assert.throws(() => command(result, "stock.classify", payload), /Stok berubah/);
  assert.throws(() => command(old, "stock.classify", { ...payload, kg: 7 }), /melebihi/);
});

test("legacy carried eggs keep their identity and sale price through return and sale", () => {
  let s = legacyStock();
  s.pickups.push({ id: "old-pickup", date: "2026-11-01", category: "good", eggs: 60, kg: 3.6, trays: 0,
    user_id: "worker", area: "Pasar", notes: "", created_at: "2026-11-01T08:00:00+07:00", locked: false, returned_eggs: 0, returned_kg: 0, returned_trays: 0 });
  s = command(s, "pickup.return", { id: "old-pickup", eggs: 10, kg: 0.6, trays: 0 }, "worker");
  s = command(s, "sale.create", { date, customer: "Pelanggan lama", photo, payment_method: "cash", paid: 0,
    items: [{ category: "good", pickup_id: "old-pickup", eggs: 50, kg: 3, trays: 0 }] }, "worker");
  assert.equal(s.sales[0].items[0].category, "good");
  assert.equal(s.sales[0].items[0].unit_price, 27000);
  assert.equal(pickupBalance(s, "old-pickup").kg, 0);
  assert.equal(eggStock(s, "good").kg, 3);
  assert.equal(eggStock(s, "skm").kg, 0);
});

test("stock checks distinguish subtypes and require recount of pre-split pending snapshots", () => {
  const source = harvested(), context = demoStockCheckContext(source, date, allEggStock(source));
  assert.throws(() => command(source, "stock_check.submit", { date, expected_snapshot: context.snapshot, status: "confirmed" }, "worker"), /Perbarui aplikasi/);
  let s = command(source, "stock_check.submit", { schema_version: 2, date, expected_snapshot: context.snapshot, status: "pending",
    warehouse_actual: { ...context.warehouse, skm: { eggs: 486, kg: 28.1, trays: 3 } },
    harvest_actual: context.harvest, reason: "Hasil hitungan fisik berbeda" }, "worker");
  assert.equal(s.stock_checks![0].schema_version, 2);
  assert.throws(() => command(s, "stock_check.review", { id: s.stock_checks![0].id, decision: "approve" }), /Perbarui aplikasi/);
  s.stock_checks![0].schema_version = undefined;
  const id = s.stock_checks![0].id;
  assert.throws(() => command(s, "stock_check.review", { schema_version: 2, id, decision: "approve" }), /menghitung ulang/);
  const old = structuredClone(s.stock_checks![0]);
  s = command(s, "stock_check.submit", { schema_version: 2, date, expected_snapshot: demoStockCheckContext(s, date, allEggStock(s)).snapshot, status: "confirmed" }, "worker");
  assert.equal(s.stock_checks![0].status, "superseded");
  assert.deepEqual(s.stock_checks![0].expected, old.expected);
  assert.equal(s.stock_checks![1].schema_version, 2);
  assert.deepEqual(emptyEggQuantities().good, { eggs: 0, kg: 0, trays: 0 });
});

test("22:00 recap remains on its WIB date until midnight", () => {
  assert.equal(businessDate("2026-11-07T22:00:00+07:00"), "2026-11-07");
  assert.equal(businessDate("2026-11-07T23:59:59+07:00"), "2026-11-07");
  assert.equal(businessDate("2026-11-08T00:00:00+07:00"), "2026-11-08");
});
