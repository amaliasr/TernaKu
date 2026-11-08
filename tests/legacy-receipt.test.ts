import test from "node:test";
import assert from "node:assert/strict";
import { emptyEggQuantities } from "../src/lib/egg-types";
import { legacyReceiptIdentity } from "../src/lib/legacy-receipt";
import { isReceiptDelta } from "../src/lib/receipt-delta";

const userId = "employee-1", requestId = "old-command-request";
function receipt() {
  const stamp = "2026-11-08T08:00:00Z";
  return {
    mode: "sale_receipt",
    command_result: { action: "sale.create", request_id: requestId, record_id: "sale-1" },
    sale: {
      id: "sale-1", number: "TK-OLD-1", user_id: userId, stock_source: "warehouse",
      date: stamp, created_at: stamp, customer: "Bu Sari", phone: "", notes: "Pesanan pagi",
      total: 28000, paid: 28000, balance: 0, payment_method: "cash", payment_status: "paid", locked: true,
      items: [{ id: "item-1", pickup_id: "", category: "good", eggs: 15, kg: 1, trays: 0, unit_price: 28000, total: 28000 }],
    },
    pickups: [], pickup_balances: {},
    inventory: { good: { eggs: 30, kg: 2, trays: 0 }, cracked: { eggs: 10, kg: 0.6, trays: 0 } },
    stock_movements: [{ id: "move-1", reference_id: "sale-1", user_id: userId, kind: "sale", category: "good", eggs: -15, kg: -1, trays: 0, date: stamp, created_at: stamp, notes: "TK-OLD-1" }],
  };
}

test("old two-balance receipt supplies only a validated identity for a full authenticated refresh", () => {
  const old = receipt(), before = structuredClone(old);
  assert.equal(isReceiptDelta(old, userId, requestId), false);
  const identity = legacyReceiptIdentity(old, userId, requestId);
  assert.deepEqual(identity, old.command_result);
  assert.notEqual(identity, old.command_result);
  assert.deepEqual(old, before);
  identity!.record_id = "local-change";
  assert.equal(old.command_result.record_id, "sale-1");
});

test("a receipt from a different account or request cannot authorize the compatibility refresh", () => {
  const old = receipt();
  assert.equal(legacyReceiptIdentity(old, "another-user", requestId), null);
  assert.equal(legacyReceiptIdentity(old, userId, "another-request"), null);
  assert.equal(legacyReceiptIdentity(old, userId, undefined), null);
  assert.equal(legacyReceiptIdentity({ ...old, command_result: { ...old.command_result, action: "sale.payment" } }, userId, requestId), null);
  assert.equal(legacyReceiptIdentity({ ...old, command_result: { ...old.command_result, record_id: "another-sale" } }, userId, requestId), null);
  assert.equal(legacyReceiptIdentity({ ...old, stock_movements: [{ ...old.stock_movements[0], user_id: "another-user" }] }, userId, requestId), null);
});

test("modern and partial inventory shapes never enter the two-balance compatibility path", () => {
  const old = receipt();
  const modern = { ...old, inventory: { ...emptyEggQuantities(), ...old.inventory } };
  assert.equal(isReceiptDelta(modern, userId, requestId), true);
  assert.equal(legacyReceiptIdentity(modern, userId, requestId), null);
  for (const inventory of [undefined, null, [], {}, { good: old.inventory.good }, { ...old.inventory, skm: { eggs: 0, kg: 0, trays: 0 } }, { ...old.inventory, extra: 0 }]) {
    assert.equal(legacyReceiptIdentity({ ...old, inventory }, userId, requestId), null);
  }
  const mislabeledNewType = { ...old, sale: { ...old.sale, items: [{ ...old.sale.items[0], category: "skm" }] }, stock_movements: [{ ...old.stock_movements[0], category: "skm" }] };
  assert.equal(legacyReceiptIdentity(mislabeledNewType, userId, requestId), null);
});

test("malformed amounts, foreign stock movements, and personal-pickup responses are rejected", () => {
  const old = receipt();
  const malformed: unknown[] = [null, undefined, "receipt", [],
    { ...old, mode: "unknown" },
    { ...old, sale: { ...old.sale, items: [] } },
    { ...old, sale: { ...old.sale, items: [{ ...old.sale.items[0], unit_price: Number.NaN }] } },
    { ...old, sale: { ...old.sale, stock_source: "pickup" } },
    { ...old, sale: { ...old.sale, items: [{ ...old.sale.items[0], pickup_id: "personal-batch" }] } },
    { ...old, inventory: { ...old.inventory, good: { ...old.inventory.good, kg: -1 } } },
    { ...old, inventory: { ...old.inventory, good: { eggs: 1, kg: 0.1 } } },
    { ...old, stock_movements: [] },
    { ...old, stock_movements: [{ ...old.stock_movements[0], reference_id: "other-sale" }] },
    { ...old, stock_movements: [old.stock_movements[0], old.stock_movements[0]] },
    { ...old, pickup_balances: { personal: {} } },
  ];
  for (const value of malformed) assert.equal(legacyReceiptIdentity(value, userId, requestId), null);
});

test("a free Bentes receipt still carries a bound identity without inventing a good-egg charge", () => {
  const old = receipt();
  old.sale.items[0] = { ...old.sale.items[0], category: "cracked", unit_price: 0, total: 0 };
  old.sale.total = 0; old.sale.paid = 0;
  old.stock_movements[0].category = "cracked";
  assert.deepEqual(legacyReceiptIdentity(old, userId, requestId), old.command_result);
});
