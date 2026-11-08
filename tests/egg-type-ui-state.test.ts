import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHarvestRows, hasLegacyHarvest } from "../src/lib/harvest-draft";
import { emptyEggQuantities } from "../src/lib/egg-types";
import { emptyState } from "../src/lib/domain";
import { warehouseSaleOptions, saleStockPreview } from "../src/lib/sale-availability";
import { isReceiptDelta, mergeReceiptDelta } from "../src/lib/receipt-delta";
import type { Sale } from "../src/lib/types";

test("legacy harvest draft automatically becomes SKM, without mutating its photo or frozen request", () => {
  const original = { fields: { "harvest.rows": { good: { eggs: "485", kg: "28", trays: "3" }, skm_new: { eggs: "650", kg: "36", trays: "" }, cracked: { eggs: "38", kg: "2.3", trays: "" } }, "harvest.photo": "data:image/jpeg;base64,unchanged" },
    attempt: { request_id: "frozen-id", action: "production.create", payload: { items: [{ category: "good", eggs: 485, kg: 28, trays: 3 }] } } };
  const before = structuredClone(original);
  const rows = normalizeHarvestRows(original.fields["harvest.rows"]);
  assert.equal(hasLegacyHarvest(rows), false);
  assert.equal(rows.skm.kg, "28");
  assert.equal(rows.skm_new.kg, "36");
  assert.equal(rows.cracked.kg, "2.3");
  assert.equal([rows.skm, rows.skm_new, rows.cracked].reduce((n, r) => n + Number(r.eggs), 0), 1173);
  assert.equal([rows.skm, rows.skm_new, rows.cracked].reduce((n, r) => n + Number(r.kg), 0), 66.3);
  assert.deepEqual(original, before);
  assert.deepEqual(normalizeHarvestRows(rows), rows);
});

test("editable draft normalization adds old good to existing SKM once and preserves invalid input", () => {
  const rows = normalizeHarvestRows({ good: { eggs: "5", kg: "0.3", trays: "1" }, skm: { eggs: "10", kg: "0.6", trays: "2" } });
  assert.deepEqual(rows.skm, { eggs: "15", kg: "0.9", trays: "3" });
  assert.deepEqual(normalizeHarvestRows(rows), rows);
  const edited = normalizeHarvestRows({ ...rows, skm: { ...rows.skm, kg: "1" } });
  assert.equal(edited.skm.kg, "1");
  const invalid = normalizeHarvestRows({ good: { eggs: "5", kg: "invalid", trays: "1" } });
  assert.equal(hasLegacyHarvest(invalid), true);
  assert.equal(invalid.good.kg, "invalid");
});

test("sale selection has three subtypes only and keeps SKM Baru stock separate", () => {
  const state = emptyState();
  state.inventory = { ...emptyEggQuantities(), skm: { eggs: 100, kg: 6, trays: 1 }, skm_new: { eggs: 200, kg: 12, trays: 2 }, good: { eggs: 0, kg: 0, trays: 0 } };
  const options = warehouseSaleOptions(state);
  assert.deepEqual(options.map(row => row.category), ["skm", "skm_new"]);
  const lines = [{ category: "skm" as const, kg: "7", eggs: "", pickup_id: "" }, { category: "skm_new" as const, kg: "1", eggs: "", pickup_id: "" }];
  const result = saleStockPreview(lines, options, "warehouse");
  assert.equal(result.issues.has("skm"), true);
  assert.equal(result.issues.has("skm_new"), false);
});

test("receipt requires four balances and canonicalizes good using only the authoritative delta", () => {
  const state = emptyState();
  state.inventory = { ...emptyEggQuantities(), skm: { eggs: 100, kg: 6, trays: 1 }, skm_new: { eggs: 200, kg: 12, trays: 2 } };
  const sale: Sale = { id: "sale", number: "TK-1", user_id: "employee", stock_source: "warehouse", date: "2026-11-08", created_at: "2026-11-08", notes: "", customer: "Ibu Sari", phone: "", total: 28000, paid: 28000, balance: 0, payment_method: "cash", payment_status: "paid", locked: true,
    items: [{ id: "item", pickup_id: "", category: "good", eggs: 15, kg: 1, trays: 0, unit_price: 28000, total: 28000 }] };
  const movement = { id: "move", kind: "sale", reference_id: "sale", user_id: "employee", category: "good", date: sale.date, created_at: sale.date, notes: "TK-1", eggs: -15, kg: -1, trays: 0 };
  const legacy = { mode: "sale_receipt", command_result: { action: "sale.create", record_id: "sale", request_id: "request" }, sale, pickups: [], pickup_balances: {}, inventory: { good: { eggs: 15, kg: 1, trays: 0 }, cracked: { eggs: 0, kg: 0, trays: 0 } }, stock_movements: [movement] };
  assert.equal(isReceiptDelta(legacy, "employee", "request"), false);
  const full = { ...legacy, inventory: { ...emptyEggQuantities(), ...legacy.inventory, skm: { eggs: 30, kg: 2, trays: 1 }, skm_new: { eggs: 90, kg: 5, trays: 1 } } };
  assert.ok(isReceiptDelta(full, "employee", "request"));
  const merged = mergeReceiptDelta(state, full);
  assert.deepEqual(merged.inventory?.skm, { eggs: 45, kg: 3, trays: 1 });
  assert.deepEqual(merged.inventory?.skm_new, full.inventory.skm_new);
  assert.deepEqual(merged.inventory?.good, { eggs: 0, kg: 0, trays: 0 });
  assert.equal(merged.sales[0].items[0].category, "skm");
  assert.equal(merged.sales[0].items[0].unit_price, 28000);
  assert.equal(merged.stock_movements?.[0].category, "skm");
  assert.deepEqual(mergeReceiptDelta(merged, full), merged);
});
