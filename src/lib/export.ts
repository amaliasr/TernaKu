import type { FeedPurchase, Sale, State } from "./types";
import {
  dateLabel,
  isFreeSaleItem,
  money,
  normalizeDateTime,
  number,
} from "./domain";

export const REPORT_TIME_NOTE =
  "Jam ditampilkan dalam WIB jika tersedia. Tanggal mengikuti catatan kegiatan, sedangkan waktu input menunjukkan kapan catatan disimpan.";
const isDateColumn = (column: string) => /^(Tanggal|Waktu)/i.test(column);
const hasRecordedTime = (value: string) =>
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value);
const includesTime = (column: string, value: string) =>
  /\b(WIB|jam|waktu)\b/i.test(column) && hasRecordedTime(value);

export type ReportTable = {
  name: string;
  columns: string[];
  rows: (string | number)[][];
};
export function formatReportCell(
  value: string | number,
  column: string,
): string {
  if (typeof value === "number") return number(value, 3);
  if (isDateColumn(column) && /^\d{4}-\d{2}-\d{2}/.test(value))
    return dateLabel(value, includesTime(column, value));
  return value;
}
function excelDate(value: string): Date | null {
  if (value.length === 10) {
    const date = new Date(value + "T00:00:00Z");
    return Number.isFinite(date.getTime()) ? date : null;
  }
  const timestamp = new Date(normalizeDateTime(value));
  if (!Number.isFinite(timestamp.getTime())) return null;
  const local = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(timestamp);
  return new Date(local.replace(" ", "T") + "Z");
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
export async function createReportWorkbook(tables: ReportTable[]) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TernaKu";
  workbook.created = new Date();
  for (const table of tables) {
    const sheet = workbook.addWorksheet(table.name.slice(0, 31), {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.addRow(table.columns);
    table.rows.forEach((row) =>
      sheet.addRow(
        row.map((value, i) =>
          typeof value === "string" &&
          isDateColumn(table.columns[i]) &&
          /^\d{4}-\d{2}-\d{2}/.test(value)
            ? excelDate(value) || value
            : value,
        ),
      ),
    );
    sheet.columns = table.columns.map((header, i) => ({
      header,
      width: Math.min(
        48,
        Math.max(
          17,
          header.length + 4,
          ...table.rows.map((r) => String(r[i] ?? "").length + 2),
        ),
      ),
    }));
    sheet.getRow(1).height = 28;
    sheet.getRow(1).eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF286B48" },
      };
      cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { vertical: "middle" };
      if (isDateColumn(String(cell.value))) cell.note = REPORT_TIME_NOTE;
    });
    sheet.eachRow((row, index) => {
      if (index === 1) return;
      row.height = 23;
      row.eachCell((cell, col) => {
        cell.font = { name: "Calibri", size: 11 };
        if (index % 2 === 0)
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF1F6ED" },
          };
        if (typeof cell.value === "number") cell.numFmt = "#,##0.###";
        if (cell.value instanceof Date) {
          const source = table.rows[index - 2]?.[col - 1];
          cell.numFmt = typeof source === "string" &&
            includesTime(table.columns[col - 1], source)
            ? "dd mmm yyyy hh:mm"
            : "dd mmm yyyy";
        }
      });
    });
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: {
        row: Math.max(1, table.rows.length + 1),
        column: table.columns.length,
      },
    };
  }
  return workbook;
}
export async function exportExcel(tables: ReportTable[], filename: string) {
  const workbook = await createReportWorkbook(tables);
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([new Uint8Array(buffer)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename + ".xlsx",
  );
}
export async function exportReportPDF(
  tables: ReportTable[],
  period: string,
  filename: string,
) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ orientation: "landscape" });
  tables.forEach((table, i) => {
    if (i > 0) doc.addPage();
    doc.setTextColor(40, 107, 72);
    doc.setFontSize(23);
    doc.setFont("helvetica", "bold");
    doc.text("TernaKu", 15, 19);
    doc.setTextColor(74, 89, 67);
    doc.setFontSize(12);
    doc.text(`Laporan ${table.name}`, 15, 29);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Periode: ${period}`, 15, 36);
    doc.setFontSize(8);
    const timeNote = doc.splitTextToSize(REPORT_TIME_NOTE, 267);
    doc.text(timeNote, 15, 42);
    autoTable(doc, {
      head: [table.columns],
      body: table.rows.map((row) =>
        row.map((cell, i) => formatReportCell(cell, table.columns[i])),
      ),
      startY: 46 + timeNote.length * 3.5,
      styles: { font: "helvetica", fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [40, 107, 72] },
      alternateRowStyles: { fillColor: [246, 249, 241] },
      margin: { left: 15, right: 15, bottom: 18 },
      didDrawPage: () => {
        doc.setFontSize(8);
        doc.setTextColor(145, 157, 134);
        doc.text(
          "TernaKu | Laporan operasional peternakan",
          15,
          doc.internal.pageSize.height - 8,
        );
      },
    });
  });
  for (let page = 1; page <= doc.getNumberOfPages(); page++) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(145, 157, 134);
    doc.text(
      "TernaKu | Laporan operasional peternakan",
      15,
      doc.internal.pageSize.height - 8,
    );
    doc.text(
      String(page) + " / " + doc.getNumberOfPages(),
      doc.internal.pageSize.width - 15,
      doc.internal.pageSize.height - 8,
      { align: "right" },
    );
  }
  doc.save(filename + ".pdf");
}
async function receiptDocument(
  title: string,
  id: string,
  date: string,
  party: string,
  employee: string,
  rows: (string | number)[][],
  total: number,
  paid: number,
  balance: number,
  notes: string,
  method?: string,
  createdAt?: string,
) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF();
  doc.setFillColor(40, 107, 72);
  doc.rect(0, 0, 210, 49, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(27);
  doc.setFont("helvetica", "bold");
  doc.text("TernaKu", 17, 23);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Peternakan dalam genggaman", 17, 31);
  doc.setFontSize(15);
  doc.text(title, 193, 22, { align: "right" });
  doc.setFontSize(9);
  doc.text(id, 193, 31, { align: "right" });
  doc.setTextColor(62, 80, 55);
  doc.setFontSize(10);
  const dates = receiptDateLines(date, createdAt);
  const dateExtraHeight = (dates.length - 1) * 6;
  doc.text(dates, 17, 63, { lineHeightFactor: 1.7 });
  doc.text(`Dicatat oleh: ${employee}`, 17, 71 + dateExtraHeight);
  const partyLines = doc.splitTextToSize(party, 175);
  doc.text(partyLines, 17, 80 + dateExtraHeight);
  autoTable(doc, {
    head: [
      ["Keterangan", "Butir", "Berat (kg)", "Krat", "Harga / kg", "Jumlah"],
    ],
    body: rows,
    startY: 88 + dateExtraHeight + (partyLines.length - 1) * 5,
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [40, 107, 72] },
    alternateRowStyles: { fillColor: [246, 249, 241] },
    margin: { left: 17, right: 17, bottom: 60 },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
    },
  });
  let y =
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
      .finalY + 13;
  if (y > 230) {
    doc.addPage();
    y = 25;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Total", 115, y);
  doc.text(money(total), 193, y, { align: "right" });
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("Dibayar", 115, y + 10);
  doc.text(money(paid), 193, y + 10, { align: "right" });
  doc.text("Sisa tagihan", 115, y + 20);
  doc.text(money(balance), 193, y + 20, { align: "right" });
  doc.setDrawColor(218, 228, 211);
  doc.line(115, y + 24, 193, y + 24);
  if (method) {
    doc.setFontSize(9);
    doc.text(`Pembayaran: ${method}`, 17, y + 10);
  }
  doc.setFontSize(9);
  doc.setTextColor(135, 150, 125);
  const note = notes
    ? `Catatan: ${notes}`
    : "Terima kasih. Simpan nota ini sebagai bukti transaksi.";
  const lines = doc.splitTextToSize(note, 175);
  autoTable(doc, {
    body: [[lines.join("\n")]],
    startY: y + 35,
    theme: "plain",
    styles: { fontSize: 9, textColor: [135, 150, 125] },
    margin: { left: 15, right: 15, bottom: 15 },
  });
  doc.save(id + ".pdf");
}
export function receiptDateLines(date: string, createdAt?: string): string[] {
  const timed = hasRecordedTime(date);
  const lines = [
    `${timed ? "Tanggal & jam (WIB)" : "Tanggal"}: ${dateLabel(date, timed)}`,
  ];
  if (!timed && createdAt && hasRecordedTime(createdAt))
    lines.push(`Waktu input (WIB): ${dateLabel(createdAt, true)}`);
  return lines;
}
export async function printReceipt(sale: Sale, state: State) {
  return receiptDocument(
    "NOTA PENJUALAN",
    sale.number,
    sale.date,
    `${sale.items.some(isFreeSaleItem) ? "Pelanggan / penerima" : "Pelanggan"}: ${sale.customer || "Pelanggan umum"}${sale.phone ? " | " + sale.phone : ""}`,
    state.users.find((u) => u.id === sale.user_id)?.name || "Karyawan",
    sale.items.map((i) => [
      i.category === "good"
        ? "Telur bagus"
        : isFreeSaleItem(i)
          ? "Telur bentes - Gratis"
          : "Telur bentes",
      number(i.eggs, 0),
      number(i.kg, 3),
      number(i.trays),
      isFreeSaleItem(i) ? "Gratis" : money(i.unit_price),
      money(i.total),
    ]),
    sale.total,
    sale.paid,
    sale.balance,
    sale.notes,
    sale.total === 0
      ? "Gratis - tidak ada tagihan"
      : {
          cash: "Tunai",
          transfer: "Transfer",
          qris: "QRIS",
          credit: "Piutang",
        }[sale.payment_method],
    sale.created_at,
  );
}
export async function printPurchase(purchase: FeedPurchase, state: State) {
  return receiptDocument(
    "NOTA PEMBELIAN",
    purchase.number,
    purchase.date,
    `Pemasok: ${purchase.supplier}`,
    state.users.find((u) => u.id === purchase.user_id)?.name || "Admin",
    purchase.items.map((i) => [
      state.feeds.find((f) => f.id === i.feed_id)?.name || "Pakan ternak",
      "-",
      number(i.quantity, 3),
      "-",
      money(i.unit_price),
      money(i.total),
    ]),
    purchase.total,
    purchase.paid,
    purchase.balance,
    purchase.notes,
    undefined,
    purchase.created_at,
  );
}
