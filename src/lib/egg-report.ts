import type { Category, Quantity, Sale, SaleItem } from "./types";
import { ALL_EGG_TYPES, NEW_EGG_TYPES, canonicalEggType, eggTypeLabel } from "./egg-types";

type EggRecord = Quantity & { category: Category; total?: number };
export type EggReportCount = Quantity & { amount: number };
const empty = (): EggReportCount => ({ eggs: 0, kg: 0, trays: 0, amount: 0 });
const kgSum = (a: number, b: number) => (Math.round(a * 1000) + Math.round(b * 1000)) / 1000;

/** Legacy good records are SKM; prices and amounts remain their original snapshots. */
export function summarizeEggTypes(records: readonly EggRecord[]) {
  const byType = Object.fromEntries(ALL_EGG_TYPES.map(type => [type, empty()])) as Record<Category, EggReportCount>;
  const add = (target: EggReportCount, record: EggRecord | EggReportCount) => {
    target.eggs += record.eggs;
    target.kg = kgSum(target.kg, record.kg);
    target.trays += record.trays;
    target.amount += "amount" in record ? record.amount : record.total ?? 0;
  };
  for (const record of records) add(byType[canonicalEggType(record.category)], record);
  const bagus = empty(), total = empty();
  add(bagus, byType.skm);
  add(bagus, byType.skm_new);
  for (const category of ALL_EGG_TYPES) add(total, byType[category]);
  return { byType, bagus, total, hasLegacy: records.some(record => record.category === "good") };
}

export function eggSummaryRows(records: readonly EggRecord[], withAmount = false): (string | number)[][] {
  const summary = summarizeEggTypes(records);
  const row = (label: string, q: EggReportCount) => [label, q.eggs, q.kg, q.trays, ...(withAmount ? [q.amount] : [])];
  return [
    ...NEW_EGG_TYPES.map(type => row(eggTypeLabel(type), summary.byType[type])),
    row("Subtotal bagus (SKM + SKM Baru)", summary.bagus),
    row("Total seluruh telur", summary.total),
  ];
}

/** Invoice-level payments belong here, never on each egg-type detail row. */
export function saleInvoiceTotals(sales: readonly Sale[]) {
  return sales.reduce((sum, sale) => ({ total: sum.total + sale.total, paid: sum.paid + sale.paid, balance: sum.balance + sale.balance }), { total: 0, paid: 0, balance: 0 });
}

export function receiptEggLabel(item: Pick<SaleItem, "category" | "unit_price">): string {
  return `${eggTypeLabel(canonicalEggType(item.category))}${item.category === "cracked" && item.unit_price === 0 ? " - Gratis" : ""}`;
}
