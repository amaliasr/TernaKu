import type { Category, NewEggType, Price, Quantity } from "./types";

export const NEW_EGG_TYPES = ["skm", "skm_new", "cracked"] as const satisfies readonly NewEggType[];
export const ALL_EGG_TYPES = [...NEW_EGG_TYPES, "good"] as const satisfies readonly Category[];
export const EGG_TYPES = {
  skm: { label: "Telur SKM", shortLabel: "SKM", quality: "good", priceKey: "skm_price", color: "#347e50" },
  skm_new: { label: "Telur SKM Baru", shortLabel: "SKM Baru", quality: "good", priceKey: "skm_new_price", color: "#74a84c" },
  cracked: { label: "Telur Bentes", shortLabel: "Bentes", quality: "cracked", priceKey: "cracked_price", color: "#cb894c" },
  good: { label: "Telur bagus (belum dibedakan)", shortLabel: "Bagus lama", quality: "good", priceKey: "good_price", color: "#899488" },
} as const;

export function isEggType(value: unknown): value is Category {
  return typeof value === "string" && (ALL_EGG_TYPES as readonly string[]).includes(value);
}
export function isNewEggType(value: unknown): value is NewEggType {
  return typeof value === "string" && (NEW_EGG_TYPES as readonly string[]).includes(value);
}
export function eggTypeLabel(category: Category): string { return EGG_TYPES[category]?.label ?? "Jenis tidak dikenal"; }
export function eggTypeQuality(category: Category): "good" | "cracked" { return EGG_TYPES[category].quality; }
/** Undefined is an unset rate, distinct from the permitted zero price for Bentes. */
export function eggTypePrice(price: Price | undefined, category: Category): number | undefined {
  return price?.[EGG_TYPES[category].priceKey];
}
export function emptyEggQuantities(): Record<Category, Quantity> {
  return { skm: { eggs: 0, kg: 0, trays: 0 }, skm_new: { eggs: 0, kg: 0, trays: 0 }, cracked: { eggs: 0, kg: 0, trays: 0 }, good: { eggs: 0, kg: 0, trays: 0 } };
}
