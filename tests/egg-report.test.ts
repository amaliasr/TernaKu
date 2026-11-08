import test from "node:test";
import assert from "node:assert/strict";
import { eggSummaryRows, summarizeEggTypes, saleInvoiceTotals } from "../src/lib/egg-report";
import { createReportWorkbook, receiptEggRows } from "../src/lib/export";
import { money } from "../src/lib/domain";
import type { Category, Sale, SaleItem } from "../src/lib/types";

const counts = [
  { category: "skm" as const, eggs: 485, kg: 28, trays: 3 },
  { category: "skm_new" as const, eggs: 650, kg: 36, trays: 4 },
  { category: "cracked" as const, eggs: 38, kg: 2.3, trays: 1 },
];

test("three-type harvest recap matches the supplied 1,173 eggs / 66.3 kg example", () => {
  const summary = summarizeEggTypes(counts);
  assert.deepEqual(summary.bagus, { eggs: 1135, kg: 64, trays: 7, amount: 0 });
  assert.deepEqual(summary.total, { eggs: 1173, kg: 66.3, trays: 8, amount: 0 });
  assert.equal(summary.byType.skm.eggs, 485);
  assert.equal(summary.byType.skm_new.eggs, 650);
  assert.equal(summary.byType.cracked.kg, 2.3);
  assert.equal(summary.hasLegacy, false);
});

test("legacy good remains separate from both SKM types and the classified Bagus subtotal", () => {
  const records = [...counts, { category: "good" as const, eggs: 17, kg: 1.001, trays: 0 }];
  const summary = summarizeEggTypes(records);
  assert.equal(summary.bagus.kg, 64);
  assert.equal(summary.total.kg, 67.301);
  assert.equal(summary.total.eggs, 1190);
  assert.equal(summary.byType.good.kg, 1.001);
  const rows = eggSummaryRows(records);
  assert.deepEqual(rows[3], ["Telur bagus (belum dibedakan)", 17, 1.001, 0]);
  assert.deepEqual(rows.at(-1), ["Total seluruh telur", 1190, 67.301, 8]);
});

test("gram precision is retained while accumulating multiple records", () => {
  const records = Array.from({ length: 300 }, (_, index) => ({ category: "skm" as const, eggs: 1, kg: index % 2 ? .002 : .001, trays: 0 }));
  assert.equal(summarizeEggTypes(records).total.kg, .45);
  assert.equal(summarizeEggTypes(records).bagus.kg, .45);
});

function item(category: Category, unitPrice: number, kg = 1): SaleItem {
  return { id: category, pickup_id: "", category, eggs: 17, kg, trays: 0, unit_price: unitPrice, total: unitPrice * kg };
}
const mixedItems = [item("skm", 27000, 2), item("skm_new", 29000, 3), item("cracked", 0, 1), item("good", 25000, 1)];

test("mixed invoice payments and debt are counted once while type revenue uses each snapshot", () => {
  const invoice = { items: mixedItems, total: 166000, paid: 100000, balance: 66000 } as Sale;
  const totals = saleInvoiceTotals([invoice]);
  assert.deepEqual(totals, { total: 166000, paid: 100000, balance: 66000 });
  const report = summarizeEggTypes(invoice.items);
  assert.equal(report.total.amount, totals.total);
  assert.equal(report.bagus.amount, 141000);
  assert.equal(report.byType.cracked.amount, 0);
  assert.equal(report.byType.good.amount, 25000);
  assert.equal(eggSummaryRows(invoice.items, true).at(-1)?.[4], 166000);
});

test("receipt labels and immutable unit prices preserve all four identities including free Bentes", () => {
  const rows = receiptEggRows(mixedItems);
  assert.deepEqual(rows.map(row => row[0]), ["Telur SKM", "Telur SKM Baru", "Telur Bentes - Gratis", "Telur bagus (belum dibedakan)"]);
  assert.deepEqual(rows.map(row => row[4]), [money(27000), money(29000), "Gratis", money(25000)]);
  assert.deepEqual(rows.map(row => row[5]), [money(54000), money(87000), money(0), money(25000)]);
  assert.equal(receiptEggRows([item("cracked", 18000)])[0][0], "Telur Bentes");
});

test("Excel recap round-trip keeps all types, explicit subtotal and numeric gram precision", async () => {
  const rows = eggSummaryRows([...counts, { category: "good", eggs: 17, kg: 1.001, trays: 0 }]);
  const workbook = await createReportWorkbook([{ name: "Panen per jenis", columns: ["Jenis telur", "Butir", "Berat (kg)", "Krat"], rows }]);
  const bytes = await workbook.xlsx.writeBuffer();
  const { default: ExcelJS } = await import("exceljs");
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(bytes);
  const sheet = restored.getWorksheet("Panen per jenis")!;
  assert.equal(sheet.getCell("A2").value, "Telur SKM");
  assert.equal(sheet.getCell("A3").value, "Telur SKM Baru");
  assert.equal(sheet.getCell("A4").value, "Telur Bentes");
  assert.equal(sheet.getCell("A5").value, "Telur bagus (belum dibedakan)");
  assert.equal(sheet.getCell("C5").value, 1.001);
  assert.equal(sheet.getCell("A6").value, "Subtotal bagus (SKM + SKM Baru)");
  assert.equal(sheet.getCell("B6").value, 1135);
  assert.equal(sheet.getCell("C6").value, 64);
  assert.equal(sheet.getCell("B7").value, 1190);
  assert.equal(sheet.getCell("C7").value, 67.301);
});
