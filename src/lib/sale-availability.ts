import { eggStock, number, pickupBalance } from "./domain";
import { resolveSaleEggs, saleEggCount } from "./sale-eggs";
import type { Category, Quantity, Sale, State } from "./types";
import { NEW_EGG_TYPES, canonicalEggType } from "./egg-types";

export type SaleStockSource = NonNullable<Sale["stock_source"]>;
type LineStock = { pickup_id: string; category?: Category };

export const saleSourceLabel = (source?: SaleStockSource) =>
  source === "warehouse" ? "Stok gudang" : "Telur yang dibawa";

export function saleStockKey(line: LineStock, source: SaleStockSource) {
  if (source === "pickup") return line.pickup_id;
  return line.category ? canonicalEggType(line.category) : "";
}

export function warehouseSaleOptions(state: State) {
  return NEW_EGG_TYPES
    .map(category => ({ id: category, category, balance: eggStock(state, category), area: "Gudang", date: "" }))
    .filter(option => option.balance.eggs > 0 && option.balance.kg > 0);
}

export function availableSalePickups(state: State, userId?: string) {
  return state.pickups
    .filter((pickup) => pickup.user_id === userId)
    .map((pickup) => ({ ...pickup, category: canonicalEggType(pickup.category), balance: pickupBalance(state, pickup) }))
    .filter((pickup) => pickup.balance.eggs > 0 && pickup.balance.kg > 0);
}

type DraftLine = LineStock & { eggs: string; kg: string; trays?: string };
type SaleOption = { id: string; balance: Quantity };

/** Group repeated lines exactly as a sale will be booked, while retaining their form indexes. */
export function saleStockPreview(
  lines: DraftLine[],
  available: SaleOption[],
  source: SaleStockSource = "pickup",
) {
  const groups = new Map<string, number[]>();
  lines.forEach((line, index) => {
    const key = saleStockKey(line, source);
    if (!key) return;
    const group = groups.get(key);
    if (group) group.push(index);
    else groups.set(key, [index]);
  });
  const balances = new Map(available.map(option => [option.id, option.balance]));
  const issues = new Map<string, string>();
  const estimatedEggs = new Map<number, number>();
  for (const [id, indexes] of groups) {
    const balance = balances.get(id);
    if (!balance) {
      issues.set(id, source === "warehouse"
        ? "Jenis telur ini sudah habis di gudang."
        : "Telur dari pengambilan ini sudah tidak tersedia. Pilih pengambilan lain.");
      continue;
    }
    try {
      const group = indexes.map(index => ({
        eggs: saleEggCount(lines[index].eggs),
        kg: Number(lines[index].kg),
        trays: Number(lines[index].trays || 0),
      }));
      const manualEggs = group.reduce((sum, line) => sum + (line.eggs ?? 0), 0);
      const saleGrams = group.reduce((sum, line) => sum + Math.round(line.kg * 1000), 0);
      const saleTrays = group.reduce((sum, line) => sum + line.trays, 0);
      const stockGrams = Math.round(balance.kg * 1000);
      if (manualEggs > balance.eggs || saleGrams > stockGrams || (source === "warehouse" && saleTrays > balance.trays)) {
        issues.set(id, source === "warehouse"
          ? `Di gudang tersisa ${number(balance.eggs)} butir, ${number(balance.kg, 3)} kg, dan ${number(balance.trays)} krat. Kurangi jumlah yang dijual.`
          : `Sisa pengambilan ini ${number(balance.eggs)} butir dan ${number(balance.kg, 3)} kg. Kurangi jumlah yang dijual atau pilih pengambilan lain.`);
        continue;
      }
      // While a row is being typed, its weight is unknown and can change every estimate in this group.
      if (group.some(line => !Number.isFinite(line.kg) || line.kg < 0.001)) continue;
      const counts = resolveSaleEggs(group, balance);
      const usedEggs = counts.reduce((sum, n) => sum + n, 0);
      if ((usedEggs === balance.eggs) !== (saleGrams === stockGrams)) {
        issues.set(id, `Jika semua telur dijual, isi ${number(balance.eggs)} butir dan ${number(balance.kg, 3)} kg. Jika hanya sebagian, sisakan butir dan beratnya.`);
        continue;
      }
      indexes.forEach((index, position) => {
        if (group[position].eggs === undefined) estimatedEggs.set(index, counts[position]);
      });
    } catch (error) {
      issues.set(id, error instanceof Error ? error.message : "Periksa jumlah butir dan berat telur.");
    }
  }
  return { issues, estimatedEggs };
}
export function saleStockIssues(lines: DraftLine[], available: SaleOption[], source: SaleStockSource = "pickup") {
  return saleStockPreview(lines, available, source).issues;
}
