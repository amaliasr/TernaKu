import type { Quantity } from "./types";

const maxLineEggs = 100_000_000;
const invalidCount = "Jumlah butir harus bilangan bulat positif, maksimal 100.000.000.";
const cannotEstimate = "Jumlah butir belum bisa diperkirakan dari stok ini. Periksa berat atau isi jumlah butir hasil hitung.";

/** Only a missing or blank count requests an estimate. A literal zero is invalid. */
export function saleEggCount(value: unknown): number | undefined {
  if (value == null || (typeof value === "string" && !value.trim())) return undefined;
  if (typeof value !== "number" && !(typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))) {
    throw new Error(invalidCount);
  }
  const count = Number(value);
  if (!Number.isInteger(count) || count <= 0 || count > maxLineEggs) throw new Error(invalidCount);
  return count;
}

type WeighedLine = { eggs?: number; kg: number };

/** The caller supplies one warehouse category or pickup at a time, in invoice order. */
export function resolveSaleEggs(lines: WeighedLine[], balance: Pick<Quantity, "eggs" | "kg">): number[] {
  let remainingEggs = balance.eggs;
  let remainingGrams = Math.round(balance.kg * 1000);
  let estimatedGrams = 0;
  const counts: number[] = [];
  const missing: { index: number; grams: number }[] = [];
  for (const [index, line] of lines.entries()) {
    const grams = Math.round(line.kg * 1000);
    if (line.eggs !== undefined) {
      counts[index] = line.eggs;
      remainingEggs -= line.eggs;
      remainingGrams -= grams;
    } else {
      missing.push({ index, grams });
      estimatedGrams += grams;
    }
  }
  if (!missing.length) return counts;

  // Use measured counts first. Keep at least one egg for each line and for any unsold weight.
  const maxSaleEggs = remainingEggs - (estimatedGrams < remainingGrams ? 1 : 0);
  if (maxSaleEggs < missing.length || estimatedGrams > remainingGrams || estimatedGrams <= 0) throw new Error(cannotEstimate);
  const target = Math.round((estimatedGrams * remainingEggs) / remainingGrams);
  let toAllocate = Math.max(missing.length, Math.min(target, maxSaleEggs));
  for (const [position, line] of missing.entries()) {
    const linesAfter = missing.length - position - 1;
    const proportional = Math.round((line.grams * toAllocate) / estimatedGrams);
    const count = Math.max(1, Math.min(proportional, toAllocate - linesAfter));
    if (count > maxLineEggs) throw new Error(cannotEstimate);
    counts[line.index] = count;
    toAllocate -= count;
    estimatedGrams -= line.grams;
  }
  return counts;
}
