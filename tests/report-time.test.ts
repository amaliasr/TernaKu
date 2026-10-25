import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  createReportWorkbook,
  formatReportCell,
  receiptDateLines,
  type ReportTable,
} from "../src/lib/export";

test("reports display real transaction times in WIB, including a date rollover", () => {
  const value = formatReportCell("2026-10-24T17:30:00Z", "Tanggal & jam (WIB)");
  assert.match(value, /25 Okt 2026/);
  assert.match(value, /00[.:]30/);
  assert.equal(
    value,
    formatReportCell("2026-10-25T00:30:00+07:00", "Tanggal & jam (WIB)"),
  );
});

test("date-only records never display an invented noon or midnight", () => {
  for (const column of ["Tanggal panen", "Tanggal & jam (WIB)", "Waktu input (WIB)"])
    assert.equal(formatReportCell("2026-10-20", column), "20 Okt 2026");
  assert.equal(formatReportCell("2026-10-20", "Tanggal panen"), "20 Okt 2026");
  assert.match(formatReportCell("2026-10-25T03:45:00Z", "Waktu input (WIB)"), /25 Okt 2026.*10[.:]45/);
});

test("legacy timestamps without an offset are interpreted as WIB", () => {
  const expected = formatReportCell("2026-10-25T08:15:00+07:00", "Waktu input (WIB)");
  assert.equal(formatReportCell("2026-10-25 08:15:00", "Waktu input (WIB)"), expected);
  assert.equal(formatReportCell("2026-10-25T08:15", "Waktu input (WIB)"), expected);
  assert.equal(formatReportCell(1234.125, "Berat (kg)"), "1.234,125");
  assert.equal(formatReportCell("2026-10-25 pesanan", "Catatan"), "2026-10-25 pesanan");
});

test("Excel round-trip preserves WIB time, date-only formatting and numeric cells", async () => {
  const tables: ReportTable[] = [{
    name: "Catatan",
    columns: ["Tanggal & jam (WIB)", "Waktu input (WIB)", "Berat (kg)"],
    rows: [
      ["2026-10-24T17:30:00Z", "2026-10-25 08:15:00", 1234.125],
      ["2026-10-20", "2026-10-25T03:45:00+07:00", 0],
    ],
  }];
  const workbook = await createReportWorkbook(tables);
  const bytes = await workbook.xlsx.writeBuffer();
  const { default: ExcelJS } = await import("exceljs");
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(bytes);
  const sheet = restored.getWorksheet("Catatan")!;
  assert.equal((sheet.getCell("A2").value as Date).toISOString(), "2026-10-25T00:30:00.000Z");
  assert.equal((sheet.getCell("B2").value as Date).toISOString(), "2026-10-25T08:15:00.000Z");
  assert.equal(sheet.getCell("A2").numFmt, "dd mmm yyyy hh:mm");
  assert.equal((sheet.getCell("A3").value as Date).toISOString(), "2026-10-20T00:00:00.000Z");
  assert.equal(sheet.getCell("A3").numFmt, "dd mmm yyyy");
  assert.equal(sheet.getCell("B3").numFmt, "dd mmm yyyy hh:mm");
  assert.equal(sheet.getCell("C2").value, 1234.125);
  assert.equal(sheet.getCell("C3").value, 0);
  assert.equal(sheet.getCell("C2").numFmt, "#,##0.###");
});

test("local timestamps render and export identically outside the WIB host timezone", () => {
  const script = `
    import { createReportWorkbook, formatReportCell } from './src/lib/export.ts';
    const value = '2026-10-25 08:15:00';
    const workbook = await createReportWorkbook([{ name: 'Waktu', columns: ['Waktu input (WIB)'], rows: [[value]] }]);
    process.stdout.write(JSON.stringify({ label: formatReportCell(value, 'Waktu input (WIB)'), excel: workbook.getWorksheet('Waktu').getCell('A2').value.toISOString() }));
  `;
  const results = ["UTC", "America/Los_Angeles"].map((timezone) => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
      cwd: process.cwd(),
      env: { ...process.env, TZ: timezone },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout) as { label: string; excel: string };
  });
  assert.deepEqual(results[0], results[1]);
  assert.match(results[0].label, /25 Okt 2026.*08[.:]15/);
  assert.equal(results[0].excel, "2026-10-25T08:15:00.000Z");
});

test("receipts show the transaction time or a clearly separate input time for old date-only records", () => {
  const current = receiptDateLines("2026-10-24T17:30:00Z", "2026-10-25T03:00:00Z");
  assert.equal(current.length, 1);
  assert.match(current[0], /^Tanggal & jam \(WIB\): 25 Okt 2026.*00[.:]30/);
  const legacy = receiptDateLines("2026-10-20", "2026-10-25 08:15:00");
  assert.deepEqual(legacy.slice(0, 1), ["Tanggal: 20 Okt 2026"]);
  assert.match(legacy[1], /^Waktu input \(WIB\): 25 Okt 2026.*08[.:]15/);
  assert.deepEqual(receiptDateLines("2026-10-20", "2026-10-25"), ["Tanggal: 20 Okt 2026"]);
});
