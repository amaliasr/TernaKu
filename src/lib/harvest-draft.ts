import { ALL_EGG_TYPES } from "./egg-types";
import type { Category } from "./types";

export type HarvestDraftRow = { eggs: string; kg: string; trays: string };
export const blankHarvestRow = (): HarvestDraftRow => ({ eggs: "", kg: "", trays: "" });
export type HarvestDraftRows = Record<Category, HarvestDraftRow>;

/** Legacy good now means SKM. Normalize editor fields only, never the frozen request or photo. */
export function normalizeHarvestRows(value: Partial<HarvestDraftRows> | undefined): HarvestDraftRows {
  const rows = Object.fromEntries(ALL_EGG_TYPES.map(category => [category, { ...blankHarvestRow(), ...value?.[category] }])) as HarvestDraftRows;
  const keys = ["eggs", "kg", "trays"] as const;
  // Keep malformed legacy input intact so the form can explain it instead of losing it.
  if (keys.some(key => [rows.good[key], rows.skm[key]].some(v => v !== "" && (!Number.isFinite(Number(v)) || Number(v) < 0)))) return rows;
  for (const key of keys) if (rows.good[key] !== "") {
    rows.skm[key] = String(Math.round((Number(rows.skm[key] || 0) + Number(rows.good[key])) * 1000) / 1000);
  }
  rows.good = blankHarvestRow();
  return rows;
}
export function hasLegacyHarvest(rows: HarvestDraftRows): boolean {
  return Object.values(rows.good).some(value => value !== "" && Number(value) !== 0);
}
