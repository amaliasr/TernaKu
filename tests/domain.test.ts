import test from "node:test";
import assert from "node:assert/strict";
import {
  activePrice,
  businessDate,
  eggStock,
  emptyState,
  executeCommand,
  feedStock,
  pickupBalance,
  today,
  visibleState,
} from "../src/lib/domain";
import { createDemoState } from "../src/lib/seed";
import type { CommandPayload, State } from "../src/lib/types";

const NOW = new Date("2026-10-13T09:00:00Z");
const DATE = "2026-10-13";
function fixture(): State {
  const s = emptyState();
  s.users = [
    {
      id: "admin",
      name: "Admin",
      email: "admin@example.test",
      role: "admin",
      active: true,
      target: 0,
    },
    {
      id: "a",
      name: "Sari",
      email: "sari@example.test",
      role: "employee",
      active: true,
      target: 1000000,
    },
    {
      id: "b",
      name: "Budi",
      email: "budi@example.test",
      role: "employee",
      active: true,
      target: 1000000,
    },
  ];
  s.barns = [
    { id: "barn", name: "Kandang A", type: "ayam", capacity: 1000, notes: "" },
  ];
  s.prices = [
    {
      id: "price",
      good_price: 28000,
      cracked_price: 18000,
      effective_at: `${DATE}T00:00:00+07:00`,
      created_at: NOW.toISOString(),
      created_by: "admin",
    },
  ];
  s.feeds = [{ id: "feed", name: "Layer", unit: "kg", min_stock: 20 }];
  return cmd(s, "a", "production.create", {
    date: DATE,
    barn_id: "barn",
    category: "good",
    eggs: 1000,
    kg: 60,
    trays: 5,
  });
}
const cmd = (s: State, user: string, action: string, payload: CommandPayload) =>
  executeCommand(s, user, action, payload, NOW);
const take = (s: State, user = "a", eggs = 500, kg = 30) =>
  cmd(s, user, "pickup.create", {
    date: DATE,
    category: "good",
    eggs,
    kg,
    trays: 3,
    area: "Pasar",
  });
const sale = (
  s: State,
  id: string,
  eggs = 100,
  kg = 6,
  extra: CommandPayload = {},
) =>
  cmd(s, "a", "sale.create", {
    date: DATE,
    items: [{ pickup_id: id, category: "good", eggs, kg, trays: 1 }],
    payment_method: "cash",
    paid: 0,
    ...extra,
  });

test("Jakarta business date is independent of host timezone", () => {
  assert.equal(today(new Date("2026-10-12T18:00:00Z")), "2026-10-13");
  assert.equal(businessDate("2026-10-12T18:00:00Z"), "2026-10-13");
  assert.equal(businessDate("2026-10-13T01:00:00+07:00"), "2026-10-13");
  assert.equal(businessDate("2026-10-13"), "2026-10-13");
  assert.equal(businessDate("2026-10-13T00:01"), "2026-10-13");
});
test("production stores actual weight independently of ten kg tray estimate", () => {
  const s = fixture();
  assert.equal(s.productions[0].kg, 60);
  assert.equal(s.productions[0].trays, 5);
  assert.equal(eggStock(s).kg, 60);
});
test("pickup checks both eggs and kg and does not mutate original on failure", () => {
  const s = fixture();
  const snapshot = JSON.stringify(s);
  assert.throws(() => take(s, "a", 1001, 20), /Stok tidak cukup/);
  assert.throws(() => take(s, "a", 100, 61), /Stok tidak cukup/);
  assert.equal(JSON.stringify(s), snapshot);
});
test("sales reserve duplicate pickup items cumulatively in a single atomic transaction", () => {
  const s = take(fixture());
  const p = s.pickups[0];
  assert.throws(
    () =>
      sale(s, p.id, 100, 6, {
        items: [
          { pickup_id: p.id, category: "good", eggs: 300, kg: 18 },
          { pickup_id: p.id, category: "good", eggs: 300, kg: 18 },
        ],
      }),
    /melebihi sisa/,
  );
  assert.equal(s.sales.length, 0);
  assert.equal(pickupBalance(s, p).kg, 30);
});
test("employees cannot sell another employees pickup or change prices", () => {
  const s = take(fixture(), "b");
  assert.throws(() => sale(s, s.pickups[0].id), /milik Anda/);
  assert.throws(
    () =>
      cmd(s, "a", "price.create", {
        good_price: 1,
        cracked_price: 1,
        effective_at: DATE,
      }),
    /hanya untuk admin/,
  );
});
test("scheduled prices activate at Jakarta time and existing snapshots never change", () => {
  let s = take(fixture());
  s = sale(s, s.pickups[0].id);
  const oldTotal = s.sales[0].total;
  s = cmd(s, "admin", "price.create", {
    good_price: 30000,
    cracked_price: 20000,
    effective_at: "2026-10-14T00:00",
  });
  assert.equal(activePrice(s, NOW)?.good_price, 28000);
  assert.equal(activePrice(s, "2026-10-13T17:00:00Z")?.good_price, 30000);
  assert.equal(s.sales[0].total, oldTotal);
  assert.equal(s.sales[0].items[0].unit_price, 28000);
  assert.equal(s.notifications.length, s.users.length);
});
test("backdating a sale does not change the transaction-time price snapshot", () => {
  const s = take(fixture());
  const result = sale(s, s.pickups[0].id, 100, 6, {
    date: "2026-10-01",
    unit_price: 1,
    total: 1,
    user_id: "b",
  });
  assert.equal(result.sales[0].items[0].unit_price, 28000);
  assert.equal(result.sales[0].total, 168000);
  assert.equal(result.sales[0].user_id, "a");
});
test("a stale displayed price must be reviewed before a sale can be confirmed", () => {
  let s = take(fixture());
  const oldId = s.prices[0].id;
  s = cmd(s, "admin", "price.create", {
    good_price: 30000,
    cracked_price: 19000,
    effective_at: DATE,
  });
  assert.throws(
    () =>
      sale(s, s.pickups[0].id, 100, 6, {
        expected_price_id: oldId,
        paid: 168000,
      }),
    /Harga telur telah berubah/,
  );
  assert.equal(s.sales.length, 0);
  const sold = sale(s, s.pickups[0].id, 100, 6, {
    expected_price_id: activePrice(s, NOW)!.id,
    paid: 180000,
  });
  assert.equal(sold.sales[0].payment_status, "paid");
});
test("partial payment and later payment have server-derived debt and reject overpayment", () => {
  const s = take(fixture());
  const sold = sale(s, s.pickups[0].id, 100, 6, { paid: 68000 });
  assert.equal(sold.sales[0].balance, 100000);
  assert.equal(sold.sales[0].payment_status, "partial");
  const paid = cmd(sold, "a", "sale.payment", {
    id: sold.sales[0].id,
    amount: 100000,
  });
  assert.equal(paid.sales[0].balance, 0);
  assert.equal(paid.sales[0].payment_status, "paid");
  assert.throws(
    () => cmd(paid, "a", "sale.payment", { id: paid.sales[0].id, amount: 1 }),
    /melebihi sisa tagihan/,
  );
});
test("returns restore warehouse once and cannot return already sold or returned eggs", () => {
  let s = take(fixture());
  const id = s.pickups[0].id;
  s = sale(s, id, 200, 12);
  s = cmd(s, "a", "pickup.return", { id, eggs: 300, kg: 18, trays: 2 });
  assert.equal(eggStock(s, "good").kg, 48);
  assert.equal(eggStock(s).eggs, 800);
  assert.equal(pickupBalance(s, id).kg, 0);
  assert.throws(
    () => cmd(s, "a", "pickup.return", { id, eggs: 1, kg: 0.06 }),
    /Retur melebihi/,
  );
  assert.throws(() => sale(s, id, 1, 0.06), /melebihi sisa/);
});
test("closing stock cannot strand eggs without weight or weight without eggs", () => {
  const initial = fixture();
  assert.throws(() => take(initial, "a", 1000, 30), /dihabiskan bersama/);
  const s = take(initial);
  const id = s.pickups[0].id;
  assert.throws(() => sale(s, id, 500, 20), /dihabiskan bersama/);
  assert.throws(() => sale(s, id, 300, 30), /dihabiskan bersama/);
  assert.throws(
    () => cmd(s, "a", "pickup.return", { id, eggs: 500, kg: 20 }),
    /dihabiskan bersama/,
  );
  const closed = sale(s, id, 500, 30);
  assert.equal(pickupBalance(closed, id).kg, 0);
  assert.equal(pickupBalance(closed, id).eggs, 0);
});
test("mixed good and cracked items each use their own immutable category price", () => {
  let s = fixture();
  s = cmd(s, "a", "production.create", {
    date: DATE,
    barn_id: "barn",
    category: "cracked",
    eggs: 50,
    kg: 3,
    trays: 0,
  });
  s = take(s);
  s = cmd(s, "a", "pickup.create", {
    date: DATE,
    category: "cracked",
    eggs: 50,
    kg: 3,
    trays: 0,
    area: "Pasar",
  });
  s = sale(s, s.pickups[0].id, 100, 6, {
    items: [
      { pickup_id: s.pickups[0].id, category: "good", eggs: 100, kg: 6 },
      { pickup_id: s.pickups[1].id, category: "cracked", eggs: 50, kg: 3 },
    ],
  });
  assert.equal(s.sales[0].total, 222000);
  assert.deepEqual(
    s.sales[0].items.map((i) => i.unit_price),
    [28000, 18000],
  );
});
test("feed procurement derives purchase receipt totals; consumption cannot overdraw", () => {
  let s = fixture();
  s = cmd(s, "admin", "feed.purchase", {
    date: DATE,
    supplier: "CV Pakan",
    items: [{ feed_id: "feed", quantity: 50, unit_price: 8000 }],
    paid: 100000,
  });
  assert.equal(s.feed_purchases[0].total, 400000);
  assert.equal(s.feed_purchases[0].balance, 300000);
  assert.match(s.feed_purchases[0].number, /^PO-/);
  s = cmd(s, "a", "feed.use", {
    date: DATE,
    feed_id: "feed",
    barn_id: "barn",
    quantity: 35,
  });
  assert.equal(feedStock(s, "feed"), 15);
  assert.throws(
    () =>
      cmd(s, "a", "feed.use", {
        date: DATE,
        feed_id: "feed",
        barn_id: "barn",
        quantity: 16,
      }),
    /Stok pakan tidak cukup/,
  );
});
test("derived monetary totals stay within exact safe accounting bounds", () => {
  assert.throws(
    () =>
      cmd(fixture(), "admin", "feed.purchase", {
        date: DATE,
        supplier: "CV Pakan",
        items: [
          { feed_id: "feed", quantity: 1000000000, unit_price: 1000000000 },
        ],
        paid: 0,
      }),
    /batas nominal/,
  );
});
test("corrections need a reason and cannot make stock negative", () => {
  const s = take(fixture());
  const id = s.productions[0].id;
  assert.throws(
    () =>
      cmd(s, "admin", "correction.apply", {
        entity: "production",
        id,
        reason: "",
        changes: { kg: 20 },
      }),
    /Alasan/,
  );
  assert.throws(
    () =>
      cmd(s, "admin", "correction.apply", {
        entity: "production",
        id,
        reason: "Salah timbang",
        changes: { kg: 20 },
      }),
    /stok gudang negatif/,
  );
  const fixed = cmd(s, "a", "correction.apply", {
    entity: "production",
    id,
    reason: "Timbang ulang",
    changes: { kg: 59 },
  });
  assert.equal(fixed.productions[0].kg, 59);
  assert.ok(fixed.activity[0].before);
  assert.ok(fixed.activity[0].after);
});
test("locked employee corrections require admin approval; financial fields are immutable", () => {
  let s = take(fixture());
  const id = s.productions[0].id;
  s = cmd(s, "admin", "record.lock", {
    entity: "production",
    id,
    locked: true,
  });
  const payload = {
    entity: "production",
    id,
    reason: "Catatan diperjelas",
    changes: { notes: "Selesai sortir" },
  };
  assert.throws(() => cmd(s, "a", "correction.apply", payload), /diajukan/);
  s = cmd(s, "a", "correction.request", payload);
  assert.equal(s.productions[0].notes, "");
  s = cmd(s, "admin", "correction.review", {
    id: s.corrections[0].id,
    approved: true,
  });
  assert.equal(s.productions[0].notes, "Selesai sortir");
  assert.equal(s.corrections[0].status, "approved");
  assert.throws(
    () =>
      cmd(s, "admin", "correction.review", {
        id: s.corrections[0].id,
        approved: true,
      }),
    /sudah ditinjau/,
  );
  s = sale(s, s.pickups[0].id);
  assert.throws(
    () =>
      cmd(s, "admin", "correction.apply", {
        entity: "sale",
        id: s.sales[0].id,
        reason: "Ubah harga",
        changes: { total: 1 },
      }),
    /kolom yang diizinkan/,
  );
});
test("sale quantity correction preserves original prices and payment while recomputing debt", () => {
  let s = take(fixture());
  s = sale(s, s.pickups[0].id, 100, 6, { paid: 84000 });
  const original = s.sales[0];
  const warehouse = eggStock(s);
  s = cmd(s, "admin", "price.create", {
    good_price: 31000,
    cracked_price: 21000,
    effective_at: DATE,
  });
  s = cmd(s, "admin", "correction.apply", {
    entity: "sale",
    id: original.id,
    reason: "Timbangan aktual diperbaiki",
    changes: {
      items: [{ id: original.items[0].id, eggs: 50, kg: 3, trays: 0 }],
    },
  });
  assert.equal(s.sales[0].items[0].unit_price, 28000);
  assert.equal(s.sales[0].total, 84000);
  assert.equal(s.sales[0].paid, 84000);
  assert.equal(s.sales[0].balance, 0);
  assert.equal(s.sales[0].payment_status, "paid");
  assert.equal(pickupBalance(s, s.pickups[0]).kg, 27);
  assert.deepEqual(eggStock(s), warehouse);
  assert.ok(s.activity[0].before);
  assert.ok(s.activity[0].after);
  s = cmd(s, "admin", "correction.apply", {
    entity: "sale",
    id: original.id,
    reason: "Jumlah penjualan terlewat",
    changes: {
      items: [{ id: original.items[0].id, eggs: 200, kg: 12, trays: 1 }],
    },
  });
  assert.equal(s.sales[0].total, 336000);
  assert.equal(s.sales[0].balance, 252000);
  assert.equal(s.sales[0].payment_status, "partial");
});
test("sale corrections reject refunds, immutable-field injection and changes beyond pickup balance atomically", () => {
  let s = take(fixture());
  s = sale(s, s.pickups[0].id, 100, 6, { paid: 168000 });
  const saleRow = s.sales[0];
  const original = JSON.stringify(s);
  const fix = (items: CommandPayload[]) =>
    cmd(s, "admin", "correction.apply", {
      entity: "sale",
      id: saleRow.id,
      reason: "Koreksi timbangan",
      changes: { items },
    });
  assert.throws(
    () => fix([{ id: saleRow.items[0].id, eggs: 50, kg: 3, trays: 0 }]),
    /Pengembalian dana belum tersedia/,
  );
  assert.throws(
    () =>
      fix([
        { id: saleRow.items[0].id, eggs: 100, kg: 6, trays: 1, unit_price: 1 },
      ]),
    /tidak dapat diubah/,
  );
  assert.throws(
    () => fix([{ id: "unknown", eggs: 100, kg: 6, trays: 1 }]),
    /tidak ditemukan/,
  );
  assert.throws(
    () => fix([{ id: saleRow.items[0].id, eggs: 600, kg: 36, trays: 4 }]),
    /melebihi sisa pengambilan/,
  );
  assert.throws(
    () => fix([{ id: saleRow.items[0].id, eggs: 500, kg: 20, trays: 3 }]),
    /dihabiskan bersama/,
  );
  assert.equal(JSON.stringify(s), original);
});
test("sale quantity corrections aggregate all existing lines from the same pickup", () => {
  let s = take(fixture());
  const pickupId = s.pickups[0].id;
  s = sale(s, pickupId, 100, 6, {
    items: [
      { pickup_id: pickupId, category: "good", eggs: 100, kg: 6, trays: 1 },
      { pickup_id: pickupId, category: "good", eggs: 100, kg: 6, trays: 1 },
    ],
  });
  const row = s.sales[0];
  const changes = {
    items: row.items.map((item) => ({
      id: item.id,
      eggs: 300,
      kg: 18,
      trays: 1,
    })),
  };
  assert.throws(
    () =>
      cmd(s, "admin", "correction.apply", {
        entity: "sale",
        id: row.id,
        reason: "Koreksi kedua item",
        changes,
      }),
    /melebihi sisa pengambilan/,
  );
  assert.throws(
    () =>
      cmd(s, "admin", "correction.apply", {
        entity: "sale",
        id: row.id,
        reason: "Koreksi kedua item",
        changes: { items: [changes.items[0], changes.items[0]] },
      }),
    /tidak boleh berulang/,
  );
  assert.throws(
    () =>
      cmd(s, "admin", "correction.apply", {
        entity: "sale",
        id: row.id,
        reason: "Koreksi kedua item",
        changes: { items: [changes.items[0]] },
      }),
    /semua item lama/,
  );
});
test("pickup quantity corrections preserve sold and returned totals and append inverse warehouse deltas", () => {
  let s = take(fixture());
  const pickup = s.pickups[0];
  s = sale(s, pickup.id, 200, 12);
  s = cmd(s, "a", "pickup.return", {
    id: pickup.id,
    eggs: 100,
    kg: 6,
    trays: 0,
  });
  const oldWarehouse = eggStock(s).kg;
  s = cmd(s, "admin", "correction.apply", {
    entity: "pickup",
    id: pickup.id,
    reason: "Jumlah dibawa diperbaiki",
    changes: { eggs: 400, kg: 24, trays: 2 },
  });
  assert.equal(eggStock(s).kg, oldWarehouse + 6);
  assert.equal(pickupBalance(s, pickup.id).kg, 6);
  assert.equal(s.stock_movements!.at(-1)?.kind, "correction");
  assert.equal(s.stock_movements!.at(-1)?.kg, 6);
  assert.equal(s.pickups[0].returned_kg, 6);
  assert.equal(s.sales[0].items[0].kg, 12);
  assert.throws(
    () =>
      cmd(s, "admin", "correction.apply", {
        entity: "pickup",
        id: pickup.id,
        reason: "Jumlah dibawa diperbaiki",
        changes: { eggs: 200, kg: 12 },
      }),
    /lebih kecil dari telur/,
  );
  assert.throws(
    () =>
      cmd(s, "admin", "correction.apply", {
        entity: "pickup",
        id: pickup.id,
        reason: "Jumlah dibawa diperbaiki",
        changes: { eggs: 2000, kg: 120 },
      }),
    /stok gudang negatif/,
  );
  const ledger = s.stock_movements!.reduce((sum, m) => sum + m.kg, 0);
  assert.equal(ledger, eggStock(s).kg);
});
test("employees request quantity corrections and approval revalidates current pickup capacity", () => {
  let s = take(fixture());
  s = sale(s, s.pickups[0].id, 100, 6);
  const row = s.sales[0];
  const payload = {
    entity: "sale",
    id: row.id,
    reason: "Berat pada nota salah",
    changes: { items: [{ id: row.items[0].id, eggs: 200, kg: 12, trays: 1 }] },
  };
  assert.throws(() => cmd(s, "a", "correction.apply", payload), /diajukan/);
  s = cmd(s, "a", "correction.request", payload);
  assert.equal(s.sales[0].total, 168000);
  s = cmd(s, "admin", "correction.review", {
    id: s.corrections[0].id,
    approved: true,
  });
  assert.equal(s.sales[0].total, 336000);
  assert.equal(s.corrections[0].status, "approved");
  const pickupPayload = {
    entity: "pickup",
    id: s.pickups[0].id,
    reason: "Koreksi jumlah diambil",
    changes: { eggs: 600, kg: 36, trays: 4 },
  };
  assert.throws(
    () => cmd(s, "a", "correction.apply", pickupPayload),
    /diajukan/,
  );
  s = cmd(s, "a", "correction.request", pickupPayload);
  s = cmd(s, "admin", "correction.review", {
    id: s.corrections[1].id,
    approved: true,
  });
  assert.equal(s.pickups[0].kg, 36);
  assert.equal(eggStock(s).kg, 24);
});
test("a pending quantity correction is revalidated if later sales consume its pickup balance", () => {
  let s = take(fixture());
  const pickupId = s.pickups[0].id;
  s = sale(s, pickupId, 100, 6);
  const row = s.sales[0];
  s = cmd(s, "a", "correction.request", {
    entity: "sale",
    id: row.id,
    reason: "Berat tambahan terlewat",
    changes: { items: [{ id: row.items[0].id, eggs: 200, kg: 12, trays: 1 }] },
  });
  s = sale(s, pickupId, 400, 24);
  assert.throws(
    () =>
      cmd(s, "admin", "correction.review", {
        id: s.corrections[0].id,
        approved: true,
      }),
    /melebihi sisa pengambilan/,
  );
  assert.equal(s.corrections[0].status, "pending");
  assert.equal(s.sales[0].total, 168000);
  assert.equal(pickupBalance(s, pickupId).kg, 0);
});
test("employee state protects other records while keeping full warehouse and feed aggregates", () => {
  let s = take(fixture(), "b");
  s = cmd(s, "admin", "feed.purchase", {
    date: DATE,
    supplier: "CV Pakan",
    items: [{ feed_id: "feed", quantity: 50, unit_price: 8000 }],
    paid: 0,
  });
  const visible = visibleState(
    s,
    s.users.find((u) => u.id === "b")!,
  );
  assert.equal(visible.productions.length, 0);
  assert.equal(visible.pickups.length, 1);
  assert.equal(visible.activity.length, 0);
  assert.equal(visible.users.length, 1);
  assert.equal(visible.feed_purchases.length, 0);
  assert.deepEqual(eggStock(visible), eggStock(s));
  assert.equal(feedStock(visible, "feed"), 50);
});
test("finite numeric inputs, precision, active accounts, and self-disable are enforced", () => {
  const s = fixture();
  assert.throws(() => take(s, "a", 1, Infinity), /angka/);
  assert.throws(() => take(s, "a", 1.5, 1), /bulat/);
  assert.throws(() => take(s, "a", 1, 0.1234), /3 angka/);
  assert.throws(
    () => cmd(s, "admin", "user.update", { id: "admin", active: false }),
    /akun sendiri/,
  );
  const disabled = cmd(s, "admin", "user.update", { id: "a", active: false });
  assert.throws(() => take(disabled), /dinonaktifkan/);
});
test("photo attachments retain complete data rather than silently truncating base64", () => {
  const encoded = `data:image/png;base64,${"A".repeat(20000)}`;
  const s = cmd(fixture(), "a", "production.create", {
    date: DATE,
    barn_id: "barn",
    category: "good",
    eggs: 1,
    kg: 0.06,
    photo: encoded,
  });
  assert.equal(s.productions.at(-1)?.photo, encoded);
});
test("optional production source and dated signed stock ledger preserve corrections and returns", () => {
  let s = cmd(fixture(), "a", "production.create", {
    date: DATE,
    category: "good",
    eggs: 10,
    kg: 0.6,
    trays: 0,
  });
  assert.equal(s.productions.at(-1)?.barn_id, "");
  s = take(s);
  const pickup = s.pickups[0];
  s = cmd(s, "a", "pickup.return", {
    id: pickup.id,
    eggs: 100,
    kg: 6,
    notes: "Kembali sore",
  });
  const returned = s.stock_movements?.at(-1);
  assert.equal(returned?.kind, "return");
  assert.equal(returned?.date, NOW.toISOString());
  assert.equal(returned?.kg, 6);
  s = cmd(s, "admin", "correction.apply", {
    entity: "production",
    id: s.productions[0].id,
    reason: "Timbang ulang",
    changes: { kg: 59 },
  });
  assert.equal(s.stock_movements?.at(-1)?.kind, "correction");
  assert.equal(s.stock_movements?.at(-1)?.kg, -1);
  assert.equal(
    visibleState(s, s.users[1]).stock_movements?.at(-1)?.kind,
    "correction",
    "employee can see admin correction on their own production",
  );
  const ledger = s.stock_movements!.reduce(
    (sum, m) => ({ eggs: sum.eggs + m.eggs, kg: sum.kg + m.kg }),
    { eggs: 0, kg: 0 },
  );
  assert.equal(ledger.eggs, eggStock(s).eggs);
  assert.ok(Math.abs(ledger.kg - eggStock(s).kg) < 0.0001);
});
test("same-instant price replacements use the newest record and reject impossible calendar dates", () => {
  let s = fixture();
  s = cmd(s, "admin", "price.create", {
    good_price: 29000,
    cracked_price: 19000,
    effective_at: DATE,
  });
  s = cmd(s, "admin", "price.create", {
    good_price: 30000,
    cracked_price: 20000,
    effective_at: DATE,
  });
  assert.equal(activePrice(s, NOW)?.good_price, 30000);
  assert.throws(
    () =>
      cmd(s, "admin", "price.create", {
        good_price: 29000,
        cracked_price: 19000,
        effective_at: "2026-02-31T00:00",
      }),
    /Tanggal mulai berlaku/,
  );
});
test("demo seed is internally consistent, recent, and has no incentive or cattle calculations", () => {
  const s = createDemoState(NOW);
  for (const c of ["good", "cracked"] as const) {
    assert.ok(eggStock(s, c).eggs >= 0);
    assert.ok(eggStock(s, c).kg >= 0);
  }
  for (const pickup of s.pickups) {
    const balance = pickupBalance(s, pickup);
    assert.ok(balance.eggs >= 0, pickup.id);
    assert.ok(balance.kg >= 0, pickup.id);
  }
  for (const feed of s.feeds) assert.ok(feedStock(s, feed.id) >= 0);
  for (const sale of s.sales) {
    assert.equal(
      sale.total,
      sale.items.reduce(
        (total, item) => total + Math.round(item.kg * item.unit_price),
        0,
      ),
    );
    assert.equal(sale.balance, sale.total - sale.paid);
  }
  assert.equal(s.productions.at(-1)?.date, DATE);
  assert.equal(activePrice(s, NOW)?.good_price, 28000);
});
