import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { farmNotification, notificationActor, notificationBusinessDate, notificationDateTime, priceNotification } from "../src/lib/notification-format";
import type { FarmNotificationEvent, NotificationEggItem } from "../src/lib/notification-format";
import { emptyState, executeCommand } from "../src/lib/domain";
import { applyDemoWrite } from "../src/lib/demo-writes";

const recordedAt = "2026-11-09T01:15:30Z";
const sample: NotificationEggItem[] = [
  { category: "skm", eggs: 17, kg: 1, trays: 0, eggs_estimated: true },
  { category: "skm_new", eggs: 34, kg: 2, trays: 0 },
  { category: "cracked", eggs: 5, kg: 0.3, trays: 0 },
];
const sale: NonNullable<FarmNotificationEvent["sale"]> = {
  number: "TK-20261109-1234ABCD", date: "2026-11-08", total: 89400, paid: 40000, balance: 49400,
  payment_method: "cash", payment_status: "partial", stock_source: "warehouse",
};
const saleEvent: FarmNotificationEvent = { activity: "sale.create", items: sample, sale };

test("timestamps always use WIB seconds across UTC day, month, and year boundaries", () => {
  assert.equal(notificationDateTime("2026-12-31T17:00:01Z"), "01/01/2027 00:00:01 WIB");
  assert.equal(notificationDateTime("2026-10-31T16:59:59.999Z"), "31/10/2026 23:59:59 WIB");
  assert.equal(notificationDateTime("2026-10-31T17:00:00Z"), "01/11/2026 00:00:00 WIB");
  assert.equal(notificationDateTime("2026-11-09 08:15:30"), "09/11/2026 08:15:30 WIB");
  assert.equal(notificationDateTime("2026-11-08T17:15:30-08:00"), "09/11/2026 08:15:30 WIB");
});

test("formatting is independent of the device timezone including legacy unzoned timestamps", () => {
  const script = `import { notificationDateTime } from './src/lib/notification-format.ts'; console.log(JSON.stringify(['2026-12-31T17:00:01Z','2026-11-09 08:15:30','2026-11-09'].map(notificationDateTime)));`;
  const outputs = ["UTC", "America/Los_Angeles", "Asia/Tokyo"].map(TZ => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { env: { ...process.env, TZ }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  });
  assert.equal(new Set(outputs).size, 1);
  assert.deepEqual(JSON.parse(outputs[0]), ["01/01/2027 00:00:01 WIB", "09/11/2026 08:15:30 WIB", "09/11/2026 (jam tidak tercatat)"]);
});

test("date-only business dates do not invent a recorded time, while scheduled activation is midnight WIB", () => {
  assert.equal(notificationBusinessDate("2026-11-08"), "08/11/2026");
  assert.equal(notificationDateTime("2026-11-08"), "08/11/2026 (jam tidak tercatat)");
  const notice = priceNotification({ good_price: 28000, cracked_price: 0, created_at: "2026-11-08", effective_at: "2026-11-10" }, "Amalia Safira");
  assert.match(notice.message, /Disimpan: 08\/11\/2026 \(jam tidak tercatat\)/);
  assert.match(notice.message, /Mulai berlaku: 10\/11\/2026 00:00:00 WIB/);
});

test("invalid timestamps and impossible calendar dates have a safe placeholder", () => {
  for (const value of [undefined, null, 0, "", "tomorrow", "0000-01-01", "2026-02-30", "2026-13-01", "2026-11-09T25:00:00Z", "2026-11-09T10:60:00Z", "2026-11-09T10:00:60Z", "2026-11-09T10:00:00+99:00"])
    assert.equal(notificationDateTime(value), "-", String(value));
  assert.equal(notificationDateTime("2028-02-29T17:00:00Z"), "01/03/2028 00:00:00 WIB");
});

test("sale notification includes original invoice, all three types, estimates, debt, source and backdated business date", () => {
  assert.deepEqual(farmNotification(saleEvent, "Sari Wulandari", recordedAt), {
    title: "Penjualan telur",
    message: [
      "Sari mencatat penjualan.", "Nota: TK-20261109-1234ABCD", "Transaksi: 08/11/2026", "Tercatat: 09/11/2026 08:15:30 WIB",
      "SKM: 17 butir (perkiraan), 1 kg, 0 krat", "SKM Baru: 34 butir, 2 kg, 0 krat", "Bentes: 5 butir, 0,3 kg, 0 krat",
      "Jumlah: 56 butir (perkiraan), 3,3 kg, 0 krat", "Total penjualan: Rp89.400", "Dibayar: Rp40.000", "Sisa tagihan: Rp49.400",
      "Pembayaran: Sebagian | Tunai", "Stok: Gudang",
    ].join("\n"),
  });
});

test("repeated and legacy SKM items aggregate once without multiplying invoice payments", () => {
  const items: NotificationEggItem[] = [
    { category: "good", eggs: 10, kg: 0.1, trays: 1 },
    { category: "skm", eggs: 10, kg: 0.2, trays: 1 },
    { category: "cracked", eggs: 5, kg: 0.3, trays: 0 },
    { category: "cracked", eggs: 5, kg: 0.3, trays: 0, eggs_estimated: true },
  ];
  const notice = farmNotification({ ...saleEvent, items }, "Sari", recordedAt);
  assert.match(notice.message, /SKM: 20 butir, 0,3 kg, 2 krat\nSKM Baru: 0 butir, 0 kg, 0 krat\nBentes: 10 butir \(perkiraan\), 0,6 kg, 0 krat\nJumlah: 30 butir \(perkiraan\), 0,9 kg, 2 krat/);
  assert.equal(notice.message.match(/Dibayar: Rp40\.000/g)?.length, 1);
  assert.equal(notice.message.match(/Sisa tagihan: Rp49\.400/g)?.length, 1);
});

test("payment descriptions support cash, bank transfer, QRIS, debt and free cracked eggs", () => {
  const cases = [
    ["cash", "paid", "Lunas | Tunai"], ["transfer", "partial", "Sebagian | Transfer"],
    ["qris", "paid", "Lunas | QRIS"], ["credit", "unpaid", "Belum lunas | Piutang"],
  ] as const;
  for (const [payment_method, payment_status, text] of cases) {
    const notice = farmNotification({ ...saleEvent, sale: { ...sale, payment_method, payment_status, stock_source: "pickup" } }, "Sari", recordedAt);
    assert.ok(notice.message.includes(`Pembayaran: ${text}\nStok: Bawaan karyawan`));
  }
  const free = farmNotification({ activity: "sale.create", items: [sample[2]], sale: { ...sale, total: 0, paid: 0, balance: 0, payment_status: "paid" } }, "Sari", recordedAt);
  assert.match(free.message, /Total penjualan: Rp0\nDibayar: Rp0\nSisa tagihan: Rp0\nPembayaran: Gratis \| Tunai/);
});

test("harvest notification totals the sample to 1173 eggs and 66.3 kg and states warehouse receipt", () => {
  const items: NotificationEggItem[] = [
    { category: "skm", eggs: 485, kg: 28, trays: 3 }, { category: "skm_new", eggs: 650, kg: 36, trays: 4 },
    { category: "cracked", eggs: 38, kg: 2.3, trays: 0 },
  ];
  for (const [activity, title, status] of [["production.create", "Panen tercatat", "Menunggu diterima"], ["production.stocked", "Panen masuk gudang", "Sudah masuk"]] as const) {
    const notice = farmNotification({ activity, date: "2026-11-07", items }, "Sari", "2026-11-07T22:00:00+07:00");
    assert.equal(notice.title, title);
    assert.match(notice.message, /Tanggal panen: 07\/11\/2026\nTercatat: 07\/11\/2026 22:00:00 WIB/);
    assert.ok(notice.message.endsWith(`Jumlah: 1.173 butir, 66,3 kg, 7 krat\nGudang: ${status}`));
  }
});

test("warehouse return and additions keep existing titles and show actual delta quantities", () => {
  for (const [activity, title] of [["pickup.return", "Telur kembali ke gudang"], ["stock.add", "Stok gudang bertambah"]] as const) {
    const notice = farmNotification({ activity, items: [{ category: "skm_new", eggs: 0, kg: 0, trays: 2 }] }, "Sari", recordedAt);
    assert.equal(notice.title, title);
    assert.match(notice.message, /Tercatat: 09\/11\/2026 08:15:30 WIB/);
    assert.match(notice.message, /Jumlah: 0 butir, 0 kg, 2 krat\nGudang: Sudah masuk$/);
    assert.doesNotMatch(notice.message, /Tanggal panen/);
  }
});

test("price notice has actor, saved/effective exact times, shared good price and explicit free bentes", () => {
  assert.deepEqual(priceNotification({ good_price: 28000, cracked_price: 0, created_at: recordedAt, effective_at: "2026-11-10T09:30:05+07:00" }, "Amalia Safira"), {
    title: "Harga telur diperbarui",
    message: "Amalia memperbarui harga telur.\nDisimpan: 09/11/2026 08:15:30 WIB\nMulai berlaku: 10/11/2026 09:30:05 WIB\nTelur Bagus (SKM dan SKM Baru): Rp28.000/kg\nTelur Bentes: Gratis (Rp0/kg)",
  });
});

test("notification text excludes customer, contact, email, note and image fields; unsafe first names and invoice are rejected", () => {
  const privateSale = { ...sale, number: "call-081234567890", customer: "Rahasia Pelanggan", phone: "081234567890", notes: "Rahasia Catatan", photo: "data:image/png;base64,Rahasia", email: "buyer@example.test" };
  const notice = farmNotification({ ...saleEvent, sale: privateSale }, "staff@example.test", recordedAt);
  assert.match(notice.message, /^Petugas mencatat penjualan\.\nNota: Belum tercatat/);
  assert.doesNotMatch(notice.message, /Rahasia|081234567890|example|base64|image/);
  assert.equal(notificationActor(" O’Neil NamaLain "), "O’Neil");
  assert.equal(notificationActor("08123456789 NamaLain"), "Petugas");
  assert.equal(notificationActor("<script> alert"), "Petugas");
  assert.equal(notificationActor(""), "Petugas");
  assert.equal(notificationActor("Ä".repeat(40) + " NamaLain"), "Ä".repeat(32));
});

test("aggregated notification stays bounded even for many rows and unusually large numeric values", () => {
  const items = Array.from({ length: 500 }, (_, i): NotificationEggItem => ({ category: i % 2 ? "skm" : "skm_new", eggs: 1e60, kg: 1e60, trays: 1e60 }));
  const notice = farmNotification({ ...saleEvent, items }, "Ä".repeat(32), recordedAt);
  assert.ok(Array.from(notice.message).length <= 1000);
  assert.doesNotMatch(notice.message, /Invalid|NaN|Infinity/);
});

test("two intentional equal price saves are distinct events but a retry cannot duplicate notices", () => {
  const initial = emptyState();
  initial.users = [{ id: "admin", name: "Amalia Safira", role: "admin", active: true, target: 0, email: "amalia@test.local" },
    { id: "employee", name: "Sari", role: "employee", active: true, target: 0, email: "sari@test.local" },
    { id: "pending", name: "Pending", role: "employee", active: true, registration_status: "pending", target: 0, email: "pending@test.local" }];
  initial.notifications.push({ id: "historical", user_id: "employee", title: "Notifikasi lama", message: "Teks asli tetap utuh", created_at: "2026-11-01", read: false });
  const payload = { good_price: 28000, cracked_price: 0, effective_at: "2026-11-09T08:00" };
  const attempt = { request_id: "first-price", fingerprint: "a".repeat(64) };
  const first = applyDemoWrite(initial, "admin", "price.create", payload, attempt, new Date(recordedAt));
  const firstTexts = first.state.notifications.map(n => n.message);
  const retried = applyDemoWrite(JSON.parse(JSON.stringify(first.state)), "admin", "price.create", payload, attempt, new Date("2026-11-09T01:15:31Z"));
  assert.deepEqual(retried.result, first.result);
  assert.equal(retried.state.prices.length, 1);
  assert.equal(retried.state.notifications.length, 3);
  const second = applyDemoWrite(retried.state, "admin", "price.create", payload, { ...attempt, request_id: "second-price" }, new Date("2026-11-09T01:15:32Z"));
  const notices = second.state.notifications.filter(n => n.type === "price.updated");
  assert.equal(notices.length, 4);
  assert.equal(new Set(notices.map(n => n.event_id)).size, 2);
  assert.equal(notices.filter(n => n.user_id === "pending").length, 0);
  assert.deepEqual(second.state.notifications.slice(0, 3).map(n => n.message), firstTexts);
  assert.match(notices[0].message, /Disimpan: 09\/11\/2026 08:15:30 WIB/);
  assert.match(notices[2].message, /Disimpan: 09\/11\/2026 08:15:32 WIB/);
  const edited = executeCommand(second.state, "admin", "profile.update", { name: "Nama Baru" }, new Date("2026-11-09T01:16:00Z"));
  assert.deepEqual(edited.notifications, second.state.notifications);
});
