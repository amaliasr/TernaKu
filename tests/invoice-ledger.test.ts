import test from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../src/lib/seed";
import { executeCommand, feedStock, visibleState } from "../src/lib/domain";
import {
  dueDate,
  dueStatus,
  historicalPaid,
  groupInvoices,
} from "../src/lib/invoice-ledger";
import type { Sale } from "../src/lib/types";

const now = new Date("2026-11-06T03:00:00Z");
const date = "2026-11-06";

test("customer ledger groups invoices by normalized name/contact, keeps unknown customers separate and shows settled history after debt", () => {
  const row = createDemoState(now).sales[0];
  const inv = (
    id: string,
    customer: string,
    balance: number,
    due_date: string | null,
    phone = "",
  ) => ({ ...row, id, customer, phone, balance, due_date });
  const a = inv("a", "  Bu   Siti", 3000, null);
  const b = inv("b", "bu siti", 7000, "2026-11-05");
  const c = inv("c", "BU SITI", 15000, "2026-11-06", "0811111");
  const groups = groupInvoices([
    a,
    c,
    inv("d", "Bu Siti", 0, null),
    inv("e", "", 100, null),
    b,
    inv("f", "", 200, null),
  ]);
  assert.equal(groups.length, 4);
  assert.equal(groups[0].balance, 10000);
  assert.deepEqual(
    groups[0].invoices.map((i) => i.id),
    ["b", "a", "d"],
  );
  assert.equal(dueStatus(b, date), "overdue");
  assert.equal(dueStatus(c, date), "today");
  assert.equal(dueStatus(a, date), "undated");
});

test("due dates are genuine business days; legacy invoices may have no deadline", () => {
  assert.equal(dueDate(undefined, date), null);
  for (const v of [
    "2026-11-05",
    "2027-02-29",
    "tomorrow",
    2424,
    ["2027-01-01"],
  ])
    assert.throws(() => dueDate(v, date), /tempo/);
  assert.equal(dueDate("2028-02-29", date), "2028-02-29");
});

test("supplier installments change the balance once, retain history, forbid employee changes and never alter feed stock", () => {
  let state = createDemoState(now);
  const feed = state.feeds[0].id;
  const stock = feedStock(state, feed);
  const payload = {
    date,
    supplier: "Toko Uji",
    due_date: "2026-12-01",
    items: [{ feed_id: feed, quantity: 20, unit_price: 5000 }],
    paid: 20000,
  };
  state = executeCommand(state, "admin", "feed.purchase", payload, now);
  const invoice = state.feed_purchases.at(-1)!;
  assert.equal(invoice.due_date, payload.due_date);
  assert.equal(invoice.payments?.[0].amount, 20000);
  assert.equal(feedStock(state, feed), stock + 20);
  const payment = {
    id: invoice.id,
    amount: 5000,
    expected_paid: 20000,
    method: "transfer",
  };
  assert.throws(
    () => executeCommand(state, "emp-1", "feed.payment", payment, now),
    /admin/,
  );
  assert.throws(
    () =>
      executeCommand(
        state,
        "admin",
        "feed.payment",
        { ...payment, method: "credit" },
        now,
      ),
    /metode/,
  );
  assert.throws(
    () =>
      executeCommand(
        state,
        "admin",
        "feed.payment",
        { ...payment, amount: 90000 },
        now,
      ),
    /melebihi/,
  );
  state = executeCommand(state, "admin", "feed.payment", payment, now);
  assert.throws(
    () => executeCommand(state, "admin", "feed.payment", payment, now),
    /berubah/,
  );
  assert.throws(
    () =>
      executeCommand(
        state,
        "admin",
        "feed.payment",
        { id: invoice.id, amount: 100 },
        now,
      ),
    /wajib/,
  );
  state = executeCommand(
    state,
    "admin",
    "feed.due",
    { id: invoice.id, due_date: "2026-11-30" },
    now,
  );
  state = executeCommand(
    state,
    "admin",
    "feed.payment",
    { ...payment, expected_paid: 25000, amount: 75000 },
    now,
  );
  const paid = state.feed_purchases.at(-1)!;
  assert.equal(feedStock(state, feed), stock + 20);
  assert.equal(paid.balance, 0);
  assert.equal(paid.due_date, "2026-11-30");
  assert.deepEqual(
    paid.payments?.map((p) => p.amount),
    [20000, 5000, 75000],
  );
  assert.equal(historicalPaid(paid), 0);
  assert.deepEqual(
    visibleState(state, state.users.find((u) => u.id === "emp-1")!)
      .feed_purchases,
    [],
  );
});

test("legacy receipts retain the unitemized amount and only append known installments; owner rules apply", () => {
  let state = createDemoState(now);
  const sale: Sale = {
    ...state.sales[0],
    user_id: "emp-1",
    date,
    total: 24000,
    paid: 4000,
    balance: 20000,
    payment_status: "partial",
    payments: undefined,
    due_date: undefined,
  };
  state.sales = [sale];
  assert.equal(historicalPaid(sale), 4000);
  assert.equal(dueStatus(sale, date), "undated");
  const update = { id: sale.id, due_date: "2026-11-11" };
  assert.throws(
    () => executeCommand(state, "emp-2", "sale.due", update, now),
    /akses/,
  );
  state = executeCommand(state, "emp-1", "sale.due", update, now);
  state = executeCommand(
    state,
    "emp-1",
    "sale.payment",
    { id: sale.id, amount: 20000, expected_paid: 4000, method: "qris" },
    now,
  );
  const paid = state.sales[0];
  assert.equal(paid.paid, 24000);
  assert.equal(paid.balance, 0);
  assert.equal(paid.payment_status, "paid");
  assert.equal(historicalPaid(paid), 4000);
  assert.deepEqual(paid.payments, [
    {
      kind: "installment",
      amount: 20000,
      recorded_at: now.toISOString(),
      user_id: "emp-1",
      method: "qris",
    },
  ]);
  assert.throws(
    () => executeCommand(state, "emp-1", "sale.due", update, now),
    /lunas/,
  );
});
