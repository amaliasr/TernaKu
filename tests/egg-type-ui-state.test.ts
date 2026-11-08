import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHarvestRows, classifyHarvestDraft, hasLegacyHarvest } from "../src/lib/harvest-draft";
import { emptyEggQuantities } from "../src/lib/egg-types";
import { emptyState } from "../src/lib/domain";
import { warehouseSaleOptions, saleStockPreview } from "../src/lib/sale-availability";
import { isReceiptDelta, mergeReceiptDelta } from "../src/lib/receipt-delta";
import type { Sale } from "../src/lib/types";

test("legacy harvest draft only changes after an explicit choice; photo and frozen attempt stay intact", () => {
  const original = { values: { "harvest.rows": { good: { eggs: "485", kg: "28", trays: "3" }, cracked: { eggs: "38", kg: "2.3", trays: "" } }, "harvest.photo": "data:image/jpeg;base64,unchanged" },
    attempt: { request_id: "frozen-id", action: "production.create", payload: { items: [{ category: "good", eggs: 485, kg: 28, trays: 3 }] } } };
  const before = structuredClone(original);
  const rows = normalizeHarvestRows(original.values["harvest.rows"]);
  assert.equal(hasLegacyHarvest(rows), true);
  assert.equal(rows.skm.kg, "");
  rows.skm_new = { eggs: "650", kg: "36", trays: "" };
  const classified = classifyHarvestDraft(rows, "skm");
  assert.equal(hasLegacyHarvest(classified), false);
  assert.equal(classified.skm.kg, "28");
  assert.equal(classified.skm_new.kg, "36");
  assert.equal(classified.cracked.kg, "2.3");
  assert.equal([classified.skm, classified.skm_new, classified.cracked].reduce((n, r) => n + Number(r.eggs), 0), 1173);
  assert.equal([classified.skm, classified.skm_new, classified.cracked].reduce((n, r) => n + Number(r.kg), 0), 66.3);
  assert.deepEqual(original, before);
  assert.equal(rows.good.kg, "28");
});

test("explicit draft classification adds to an existing leaf without overwriting other quantities", () => {
  const rows = normalizeHarvestRows({ good: { eggs: "5", kg: "0.3", trays: "1" }, skm: { eggs: "10", kg: "0.6", trays: "2" } });
  const classified = classifyHarvestDraft(rows, "skm");
  assert.deepEqual(classified.skm, { eggs: "15", kg: "0.9", trays: "3" });
  rows.good.kg = "invalid";
  assert.throws(() => classifyHarvestDraft(rows, "skm"), /Periksa angka/);
});

test("sale selection reserves each subtype separately and never pools unclassified stock", () => {
  const state = emptyState();
  state.inventory = { ...emptyEggQuantities(), skm: { eggs: 100, kg: 6, trays: 1 }, skm_new: { eggs: 200, kg: 12, trays: 2 }, good: { eggs: 50, kg: 3, trays: 0 } };
  const options = warehouseSaleOptions(state);
  assert.deepEqual(options.map(row => row.category), ["skm", "skm_new", "good"]);
  const lines = [{ category: "skm" as const, kg: "7", eggs: "", pickup_id: "" }, { category: "skm_new" as const, kg: "1", eggs: "", pickup_id: "" }];
  const result = saleStockPreview(lines, options, "warehouse");
  assert.equal(result.issues.has("skm"), true);
  assert.equal(result.issues.has("skm_new"), false);
});

test("new subtype receipt requires four balances; old two-key reply preserves already loaded subtype balances", () => {
  const state = emptyState();
  state.inventory = { ...emptyEggQuantities(), skm: { eggs: 100, kg: 6, trays: 1 }, skm_new: { eggs: 200, kg: 12, trays: 2 } };
  const sale: Sale = { id: "sale", number: "TK-1", user_id: "employee", stock_source: "warehouse", date: "2026-11-08", created_at: "2026-11-08", notes: "", customer: "Ibu Sari", phone: "", total: 28000, paid: 28000, balance: 0, payment_method: "cash", payment_status: "paid", locked: true,
    items: [{ id: "item", pickup_id: "", category: "good", eggs: 15, kg: 1, trays: 0, unit_price: 28000, total: 28000 }] };
  const movement = { id: "move", kind: "sale", reference_id: "sale", user_id: "employee", category: "good", date: sale.date, created_at: sale.date, notes: "TK-1", eggs: -15, kg: -1, trays: 0 };
  const legacy = { mode: "sale_receipt", command_result: { action: "sale.create", record_id: "sale", request_id: "request" }, sale, pickups: [], pickup_balances: {}, inventory: { good: { eggs: 15, kg: 1, trays: 0 }, cracked: { eggs: 0, kg: 0, trays: 0 } }, stock_movements: [movement] };
  assert.ok(isReceiptDelta(legacy, "employee", "request"));
  const merged = mergeReceiptDelta(state, legacy);
  assert.deepEqual(merged.inventory?.skm_new, state.inventory.skm_new);
  assert.deepEqual(merged.inventory?.skm, state.inventory.skm);
  assert.equal(merged.inventory?.good.eggs, 15);
  assert.deepEqual(mergeReceiptDelta(merged, legacy), merged);
  const current = { ...legacy, sale: { ...sale, items: [{ ...sale.items[0], category: "skm_new" }] }, stock_movements: [{ ...movement, category: "skm_new" }] };
  assert.equal(isReceiptDelta(current, "employee", "request"), false);
  assert.equal(isReceiptDelta({ ...current, inventory: { ...emptyEggQuantities(), ...legacy.inventory } }, "employee", "request"), true);
});
