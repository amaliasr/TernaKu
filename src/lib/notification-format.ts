import type { Category, FarmActivity, Price, Sale } from "./types";
import { canonicalEggType, NEW_EGG_TYPES } from "./egg-types";

export type NotificationEggItem = { category: Category; eggs: number; kg: number; trays: number; eggs_estimated?: boolean };
export type FarmNotificationEvent = {
  activity: FarmActivity;
  date?: string;
  items: readonly NotificationEggItem[];
  sale?: Pick<Sale, "number" | "date" | "total" | "paid" | "balance" | "payment_method" | "payment_status" | "stock_source">;
};
type Notice = { title: string; message: string };
const wibDateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
const integerFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const quantityFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });

function parsedTime(value: unknown, dateOnlyAsMidnight = false): { instant: Date; dateOnly: boolean } | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  if (!match || +match[1].slice(0, 4) < 1 || (match[2] !== undefined && (+match[2] > 23 || +match[3] > 59 || +(match[4] || 0) > 59))) return undefined;
  const calendar = new Date(match[1] + "T00:00:00Z");
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== match[1]) return undefined;
  const dateOnly = match[2] === undefined;
  const zoned = dateOnly ? `${match[1]}T00:00:00+07:00` : value.replace(" ", "T") + (match[5] ? "" : "+07:00");
  const instant = new Date(zoned);
  return Number.isFinite(instant.getTime()) ? { instant, dateOnly: dateOnly && !dateOnlyAsMidnight } : undefined;
}
function dateParts(date: Date): Record<string, string> {
  return Object.fromEntries(wibDateTime.formatToParts(date).map(part => [part.type, part.value]));
}
function formatTime(value: unknown, mode: "event" | "business" | "effective"): string {
  const parsed = parsedTime(value, mode === "effective");
  if (!parsed) return "-";
  const p = dateParts(parsed.instant), day = `${p.day}/${p.month}/${p.year}`;
  if (parsed.dateOnly) return mode === "business" ? day : `${day} (jam tidak tercatat)`;
  return `${day} ${p.hour}:${p.minute}:${p.second} WIB`;
}
/** Legacy unzoned timestamps are WIB; a date without a time never invents one. */
export function notificationDateTime(value: unknown): string { return formatTime(value, "event"); }
export function notificationBusinessDate(value: unknown): string { return formatTime(value, "business"); }

export function notificationActor(name: string): string {
  const first = name.trim().split(/\s+/u)[0];
  return /^\p{L}[\p{L}\p{M}.'’\-]*$/u.test(first) ? Array.from(first).slice(0, 32).join("") : "Petugas";
}
const safeNumber = (n: number) => Number.isFinite(n) && n >= 0 ? n : 0;
const decimal = (n: number, digits = 3) => (digits === 0 ? integerFormat : quantityFormat).format(safeNumber(n));
const rupiah = (n: number) => "Rp" + decimal(n, 0);
const bounded = (lines: string[]) => {
  const message = lines.join("\n"), chars = Array.from(message);
  return chars.length <= 1000 ? message : chars.slice(0, 997).join("") + "...";
};
function quantities(items: readonly NotificationEggItem[]): string[] {
  const empty = () => ({ eggs: 0, grams: 0, trays: 0, estimated: false });
  const byType = { skm: empty(), skm_new: empty(), cracked: empty() }, total = empty();
  for (const item of items) {
    const type = canonicalEggType(item.category), q = byType[type];
    if (!q) continue;
    for (const target of [q, total]) {
      target.eggs += safeNumber(item.eggs); target.grams += Math.round(safeNumber(item.kg) * 1000); target.trays += safeNumber(item.trays);
      target.estimated ||= item.eggs_estimated === true;
    }
  }
  const line = (label: string, q: ReturnType<typeof empty>) => `${label}: ${decimal(q.eggs, 0)} butir${q.estimated ? " (perkiraan)" : ""}, ${decimal(q.grams / 1000)} kg, ${decimal(q.trays, 0)} krat`;
  const labels = { skm: "SKM", skm_new: "SKM Baru", cracked: "Bentes" };
  return [...NEW_EGG_TYPES.map(type => line(labels[type], byType[type])), line("Jumlah", total)];
}
function invoiceNumber(value: string): string {
  return /^(?:TK-\d{8}-[a-f0-9]{8}|TRX-\d{8}-\d{4,20})$/i.test(value) ? value : "Belum tercatat";
}
const paymentMethods = { cash: "Tunai", transfer: "Transfer", qris: "QRIS", credit: "Piutang" };
const paymentStatuses = { paid: "Lunas", partial: "Sebagian", unpaid: "Belum lunas" };

/** Only allowlisted event values enter the immutable notification text. */
export function farmNotification(event: FarmNotificationEvent, actorName: string, recordedAt: string): Notice {
  const who = notificationActor(actorName), recorded = `Tercatat: ${notificationDateTime(recordedAt)}`;
  if (event.activity === "sale.create" && event.sale) {
    const sale = event.sale;
    return { title: "Penjualan telur", message: bounded([
      `${who} mencatat penjualan.`, `Nota: ${invoiceNumber(sale.number)}`,
      `Transaksi: ${notificationBusinessDate(sale.date)}`, recorded, ...quantities(event.items),
      `Total penjualan: ${rupiah(sale.total)}`, `Dibayar: ${rupiah(sale.paid)}`, `Sisa tagihan: ${rupiah(sale.balance)}`,
      `Pembayaran: ${sale.total === 0 ? "Gratis" : paymentStatuses[sale.payment_status] || "Belum lunas"} | ${paymentMethods[sale.payment_method] || "-"}`,
      `Stok: ${sale.stock_source === "warehouse" ? "Gudang" : "Bawaan karyawan"}`,
    ]) };
  }
  const definitions: Record<Exclude<FarmActivity, "sale.create">, [string, string, string]> = {
    "production.create": ["Panen tercatat", "mencatat panen", "Menunggu diterima"],
    "production.stocked": ["Panen masuk gudang", "mencatat panen", "Sudah masuk"],
    "production.receive": ["Panen diterima di gudang", "menerima panen di gudang", "Sudah masuk"],
    "pickup.return": ["Telur kembali ke gudang", "mengembalikan telur ke gudang", "Sudah masuk"],
    "stock.add": ["Stok gudang bertambah", "menambah stok gudang", "Sudah masuk"],
  };
  if (event.activity === "sale.create") return { title: "Penjualan telur", message: bounded([`${who} mencatat penjualan.`, recorded, ...quantities(event.items)]) };
  const [title, action, status] = definitions[event.activity];
  return { title, message: bounded([
    `${who} ${action}.`,
    ...(event.activity.startsWith("production.") ? [`Tanggal panen: ${notificationBusinessDate(event.date)}`] : []),
    recorded, ...quantities(event.items), `Gudang: ${status}`,
  ]) };
}

export function priceNotification(price: Pick<Price, "good_price" | "cracked_price" | "created_at" | "effective_at">, actorName: string): Notice {
  return { title: "Harga telur diperbarui", message: bounded([
    `${notificationActor(actorName)} memperbarui harga telur.`,
    `Disimpan: ${notificationDateTime(price.created_at)}`,
    `Mulai berlaku: ${formatTime(price.effective_at, "effective")}`,
    `Telur Bagus (SKM dan SKM Baru): ${price.good_price === undefined ? "Belum diatur" : rupiah(price.good_price) + "/kg"}`,
    `Telur Bentes: ${price.cracked_price === 0 ? "Gratis (Rp0/kg)" : rupiah(price.cracked_price) + "/kg"}`,
  ]) };
}
