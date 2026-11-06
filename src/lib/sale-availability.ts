import { number, pickupBalance } from "./domain";
import type { State } from "./types";

export function availableSalePickups(state: State, userId?: string) {
  return state.pickups
    .filter((pickup) => pickup.user_id === userId)
    .map((pickup) => ({ ...pickup, balance: pickupBalance(state, pickup) }))
    .filter((pickup) => pickup.balance.eggs > 0 && pickup.balance.kg > 0);
}

/** Multiple sale lines may use the same pickup (e.g. paid and free bentes). */
export function saleStockIssues(
  lines: { pickup_id: string; eggs: string; kg: string }[],
  available: ReturnType<typeof availableSalePickups>,
): Map<string, string> {
  const used = new Map<string, { eggs: number; grams: number }>();
  for (const line of lines) {
    if (!line.pickup_id) continue;
    const quantity = used.get(line.pickup_id) || { eggs: 0, grams: 0 };
    quantity.eggs += Number(line.eggs);
    quantity.grams += Math.round(Number(line.kg) * 1000);
    used.set(line.pickup_id, quantity);
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
        "Telur dari pengambilan ini sudah tidak tersedia. Pilih pengambilan lain.",
      );
      continue;
    }
    const grams = Math.round(balance.kg * 1000);
    if (quantity.eggs > balance.eggs || quantity.grams > grams) {
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
