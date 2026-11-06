import type { FeedPurchase, InvoicePayment, Sale } from "./types";

export type FarmInvoice = FeedPurchase | Sale;

export function dueDate(value: unknown, invoiceDay: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Isi tanggal jatuh tempo yang valid.");
  const day = new Date(value + "T12:00:00Z");
  if (
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== value
  )
    throw new Error("Isi tanggal jatuh tempo yang valid.");
  if (value < invoiceDay)
    throw new Error("Jatuh tempo tidak boleh sebelum tanggal nota.");
  return value;
}

export function paymentEntry(
  kind: InvoicePayment["kind"],
  amount: number,
  recorded_at: string,
  user_id: string,
  method?: unknown,
): InvoicePayment {
  if (
    method != null &&
    method !== "" &&
    method !== "cash" &&
    method !== "transfer" &&
    method !== "qris"
  )
    throw new Error("Pilih metode pembayaran yang valid.");
  return {
    kind,
    amount,
    recorded_at,
    user_id,
    ...(method === "cash" || method === "transfer" || method === "qris"
      ? { method }
      : {}),
  };
}

export function historicalPaid(invoice: FarmInvoice) {
  return Math.max(
    0,
    invoice.paid -
      (invoice.payments || []).reduce((sum, row) => sum + row.amount, 0),
  );
}

export function dueStatus(invoice: FarmInvoice, day: string) {
  if (invoice.balance <= 0) return "paid";
  if (!invoice.due_date) return "undated";
  return invoice.due_date < day
    ? "overdue"
    : invoice.due_date === day
      ? "today"
      : "upcoming";
}

export type InvoiceGroup<T extends FarmInvoice> = {
  key: string;
  party: string;
  phone: string;
  balance: number;
  invoices: T[];
};
export function groupInvoices<T extends FarmInvoice>(
  rows: T[],
): InvoiceGroup<T>[] {
  const groups = new Map<string, InvoiceGroup<T>>();
  for (const row of rows) {
    const party = (("supplier" in row ? row.supplier : row.customer) || "")
      .trim()
      .replace(/\s+/g, " ");
    const phone = "phone" in row ? row.phone?.trim() || "" : "";
    // A missing legacy name belongs to one invoice, never an invented shared customer.
    const key = party
      ? JSON.stringify([
          "party",
          party.toLocaleLowerCase("id"),
          phone.replace(/[\s()-]/g, ""),
        ])
      : JSON.stringify(["invoice", row.id]);
    const group = groups.get(key) || {
      key,
      party: party || "Nama belum tercatat",
      phone,
      balance: 0,
      invoices: [],
    };
    group.balance += row.balance;
    group.invoices.push(row);
    groups.set(key, group);
  }
  const order = (a: T, b: T) => {
    if (!a.balance && !b.balance) return b.date.localeCompare(a.date);
    if (!a.balance) return 1;
    if (!b.balance) return -1;
    return (
      (a.due_date || "9999-99-99").localeCompare(b.due_date || "9999-99-99") ||
      a.date.localeCompare(b.date)
    );
  };
  for (const group of groups.values()) group.invoices.sort(order);
  return [...groups.values()].sort(
    (a, b) =>
      order(a.invoices[0], b.invoices[0]) ||
      a.party.localeCompare(b.party, "id"),
  );
}
