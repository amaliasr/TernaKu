import { NEW_EGG_TYPES } from "./egg-types";
import type { Category, NewEggType } from "./types";

export type HarvestDraftRow = { eggs: string; kg: string; trays: string };
export const blankHarvestRow = (): HarvestDraftRow => ({ eggs: "", kg: "", trays: "" });
export type HarvestDraftRows = Record<Category, HarvestDraftRow>;

/** Read older drafts without dropping the unclassified good quantities or touching photos/pending attempts. */
export function normalizeHarvestRows(value: Partial<HarvestDraftRows> | undefined): HarvestDraftRows {
  return Object.fromEntries([...NEW_EGG_TYPES, "good"].map(category => [category, { ...blankHarvestRow(), ...value?.[category as Category] }])) as HarvestDraftRows;
}
export function hasLegacyHarvest(rows: HarvestDraftRows): boolean {
  return Object.values(rows.good).some(value => value !== "" && Number(value) !== 0);
}
export function classifyHarvestDraft(rows: HarvestDraftRows, target: Extract<NewEggType, "skm" | "skm_new">): HarvestDraftRows {
  const next = normalizeHarvestRows(rows);
  for (const key of ["eggs", "kg", "trays"] as const) {
    const original = next.good[key], existing = next[target][key];
    if (original === "") continue;
    const sum = Number(existing || 0) + Number(original);
    if (!Number.isFinite(sum) || sum < 0) throw new Error("Periksa angka pada draf panen lama.");
    next[target][key] = String(Math.round(sum * 1000) / 1000);
  }
  next.good = blankHarvestRow();
  return next;
}
