import { eggStock, number, pickupBalance } from "./domain";
import type { Category, Quantity, Sale, State } from "./types";

export type SaleStockSource = NonNullable<Sale["stock_source"]>;
type LineStock = { pickup_id: string; category?: Category };

export const saleSourceLabel = (source?: SaleStockSource) =>
  source === "warehouse" ? "Stok gudang" : "Telur yang dibawa";

export function saleStockKey(line: LineStock, source: SaleStockSource) {
  return source === "warehouse" ? line.category ?? "" : line.pickup_id;
}

export function warehouseSaleOptions(state: State) {
  return (["good", "cracked"] as const)
    .map(category => ({ id: category, category, balance: eggStock(state, category), area: "Gudang", date: "" }))
    .filter(option => option.balance.eggs > 0 && option.balance.kg > 0);
}

export function availableSalePickups(state: State, userId?: string) {
  return state.pickups
    .filter((pickup) => pickup.user_id === userId)
    .map((pickup) => ({ ...pickup, balance: pickupBalance(state, pickup) }))
    .filter((pickup) => pickup.balance.eggs > 0 && pickup.balance.kg > 0);
}

/** Paid and free lines can draw on the same pickup or warehouse category. */
export function saleStockIssues(
  lines: (LineStock & { eggs: string; kg: string; trays?: string })[],
  available: { id: string; balance: Quantity }[],
  source: SaleStockSource = "pickup",
): Map<string, string> {
  const used = new Map<string, { eggs: number; grams: number; trays: number }>();
  for (const line of lines) {
    const key = saleStockKey(line, source);
    if (!key) continue;
    const quantity = used.get(key) || { eggs: 0, grams: 0, trays: 0 };
    quantity.eggs += Number(line.eggs);
    quantity.grams += Math.round(Number(line.kg) * 1000);
    quantity.trays += Number(line.trays || 0);
    used.set(key, quantity);
  }
  const balances = new Map(
    available.map((pickup) => [pickup.id, pickup.balance]),
  );
  const issues = new Map<string, string>();
  for (const [id, quantity] of used) {
    const balance = balances.get(id);
    if (!balance) {
      issues.set(
        id,
        source === "warehouse" ? "Jenis telur ini sudah habis di gudang." : "Telur dari pengambilan ini sudah tidak tersedia. Pilih pengambilan lain.",
      );
      continue;
    }
    const grams = Math.round(balance.kg * 1000);
    if (source === "warehouse" && (quantity.eggs > balance.eggs || quantity.grams > grams || quantity.trays > balance.trays)) {
      issues.set(id, `Di gudang tersisa ${number(balance.eggs)} butir, ${number(balance.kg, 3)} kg, dan ${number(balance.trays)} krat. Kurangi jumlah yang dijual.`);
    } else if (quantity.eggs > balance.eggs || quantity.grams > grams) {
      issues.set(
        id,
        `Sisa pengambilan ini ${number(balance.eggs)} butir dan ${number(balance.kg, 3)} kg. Kurangi jumlah yang dijual atau pilih pengambilan lain.`,
      );
    } else if (
      quantity.eggs > 0 &&
      quantity.grams > 0 &&
      (quantity.eggs === balance.eggs) !== (quantity.grams === grams)
    ) {
      issues.set(
        id,
        `Jika semua telur dijual, isi ${number(balance.eggs)} butir dan ${number(balance.kg, 3)} kg. Jika hanya sebagian, sisakan butir dan beratnya.`,
      );
    }
  }
  return issues;
}
