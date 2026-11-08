import { emptyEggQuantities } from "./egg-types";
import { isReceiptDelta } from "./receipt-delta";
import type { State } from "./types";

/** Validate the old wire shape only to bind a subsequent authenticated full
 * refresh. Never merge its two balances into a three-type inventory. */
export function legacyReceiptIdentity(value: unknown, userId: string, requestId: string | undefined): State["command_result"] | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const inventory = data.inventory;
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)
    || Object.keys(inventory).sort().join(",") !== "cracked,good") return null;
  const check = { ...data, inventory: { ...emptyEggQuantities(), ...inventory } };
  if (!isReceiptDelta(check, userId, requestId) || check.sale.stock_source !== "warehouse"
    || check.sale.items.some(i => i.category !== "good" && i.category !== "cracked")) return null;
  return { ...check.command_result };
}
