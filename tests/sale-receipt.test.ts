import test from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../src/lib/domain";
import { findSavedSale } from "../src/lib/sale-receipt";
import type { CommandPayload, Sale, State } from "../src/lib/types";

const requestId = "7c880611-e636-4113-ae75-86ee97790268";
const payload: CommandPayload = {
  date: "2026-10-25T09:15:00+07:00",
  customer: "  Bu Sari  ",
  phone: "081234567890",
  notes: "Pesanan pagi",
  items: [{ pickup_id: "pickup-1", category: "good", eggs: 30, kg: 1.8, trays: 0 }],
  payment_method: "cash",
  paid: 50400,
};
function sale(id: string, extra: Partial<Sale> = {}): Sale {
  return {
    id,
    number: `TK-${id}`,
    date: "2026-10-25T02:15:00Z",
    user_id: "employee",
    customer: "Bu Sari",
    phone: "081234567890",
    notes: "Pesanan pagi",
    items: [{ id: `${id}-item`, pickup_id: "pickup-1", category: "good", eggs: 30, kg: 1.8, trays: 0, unit_price: 28000, total: 50400 }],
    payment_method: "cash",
    total: 50400,
    paid: 50400,
    balance: 0,
    payment_status: "paid",
    created_at: "2026-10-25T09:15:02+07:00",
    locked: true,
    ...extra,
  };
}
function state(sales: Sale[], recordId?: string): State {
  return {
    ...emptyState(),
    sales,
    ...(recordId ? { command_result: { action: "sale.create", record_id: recordId, request_id: requestId } } : {}),
  };
}

test("first save opens the sale returned by the command rather than an older React snapshot", () => {
  const before = state([]);
  const created = sale("new");
  const confirmed = state([created], created.id);
  assert.equal(before.sales.length, 0);
  assert.equal(findSavedSale(confirmed, "employee", payload, requestId, []), created);
});

test("a later concurrent sale cannot replace the receipt for this save", () => {
  const created = sale("mine");
  const later = sale("later", { created_at: "2026-10-25T09:16:00+07:00" });
  const confirmed = state([later, created], created.id);
  assert.equal(findSavedSale(confirmed, "employee", payload, requestId, []), created);
});

test("confirmed idempotent replay opens the original sale even after it entered history", () => {
  const original = sale("original");
  const confirmed = state([sale("other"), original], original.id);
  assert.equal(findSavedSale(confirmed, "employee", payload, requestId, [original.id]), original);
  assert.equal(confirmed.sales.length, 2);
});

test("receipt uses stored transaction prices even after the current price changes", () => {
  const created = sale("snapshot");
  const confirmed = state([created], created.id);
  confirmed.prices = [{ id: "new-price", good_price: 35000, cracked_price: 25000, created_at: "2026-10-25T03:00:00Z", effective_at: "2026-10-25T03:00:00Z", created_by: "admin" }];
  const receipt = findSavedSale(confirmed, "employee", payload, requestId);
  assert.equal(receipt?.items[0].unit_price, 28000);
  assert.equal(receipt?.total, 50400);
});

test("mismatched request, wrong action, missing ID and another user's sale never open a receipt", () => {
  const created = sale("created");
  const mismatched = state([created], created.id);
  assert.equal(findSavedSale(mismatched, "employee", payload, "a-different-request"), null);
  const wrongAction = state([created], created.id);
  wrongAction.command_result!.action = "sale.payment";
  assert.equal(findSavedSale(wrongAction, "employee", payload, requestId), null);
  assert.equal(findSavedSale(state([created], "missing"), "employee", payload, requestId), null);
  assert.equal(findSavedSale(state([created], created.id), "other-user", payload, requestId), null);
});

test("demo commands can return their exact sale without a live request ID", () => {
  const created = sale("demo");
  const confirmed = state([created], created.id);
  confirmed.command_result!.request_id = "";
  assert.equal(findSavedSale(confirmed, "employee", payload), created);
});

test("older API resolves one matching new sale while ignoring earlier identical sales", () => {
  const old = sale("old");
  const created = sale("new");
  const confirmed = state([old, created, sale("other", { user_id: "other-user" })]);
  assert.equal(findSavedSale(confirmed, "employee", payload, requestId, [old.id]), created);
});

test("older API never guesses between identical transactions or returns a mismatched receipt", () => {
  assert.equal(findSavedSale(state([sale("one"), sale("two")]), "employee", payload), null);
  assert.equal(findSavedSale(state([sale("wrong", { paid: 0 })]), "employee", payload), null);
  assert.equal(findSavedSale(state([sale("wrong")]), "employee", { ...payload, items: [] }), null);
  assert.equal(findSavedSale(state([sale("wrong")]), "employee", { ...payload, date: "invalid" }), null);
});

test("free cracked-egg receipt remains zero and belongs to its named recipient", () => {
  const free = sale("free", {
    customer: "Pak Budi", phone: "", notes: "", total: 0, paid: 0, balance: 0,
    items: [{ id: "free-item", pickup_id: "pickup-cracked", category: "cracked", eggs: 10, kg: 0.6, trays: 0, unit_price: 0, total: 0, is_free: true }],
  });
  const gift: CommandPayload = {
    date: payload.date, customer: "Pak Budi", payment_method: "credit", paid: 0,
    items: [{ pickup_id: "pickup-cracked", category: "cracked", eggs: 10, kg: 0.6, trays: 0, is_free: true }],
  };
  assert.equal(findSavedSale(state([free]), "employee", gift), free);
  assert.equal(findSavedSale(state([free]), "employee", { ...gift, customer: "Penerima lain" }), null);
});
