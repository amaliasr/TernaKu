"use client";

import { availableSalePickups, saleStockKey, warehouseSaleOptions, type SaleStockSource } from "@/lib/sale-availability";
import type { Category, State } from "@/lib/types";
import { useDraftField, useEntryDraft } from "./DraftBoundary";
import { Field } from "./ModuleUI";

export type SaleStart = { source: SaleStockSource; pickupId?: string };

export function useSaleStockSource(state: State, userId?: string, start?: SaleStart) {
  const carried = availableSalePickups(state, userId);
  const warehouse = warehouseSaleOptions(state);
  const fields = useEntryDraft()?.writer.record.fields;
  const [source, setSource] = useDraftField<SaleStockSource>("stockSource", () => {
    // Drafts made before direct warehouse sales were always for a personal pickup.
    if (Array.isArray(fields?.items)) return "pickup";
    return start?.source ?? (warehouse.length || !carried.length ? "warehouse" : "pickup");
  });
  const available = source === "warehouse" ? warehouse : carried;
  const warehouseSale = source === "warehouse";
  const optionFor = (line: { pickup_id: string; category?: Category }) =>
    available.find(option => option.id === saleStockKey(line, source));
  const choiceFor = (stockSource: SaleStockSource) => ({
    pickup_id: stockSource === "pickup"
      ? carried.find(p => p.id === start?.pickupId)?.id ?? (carried.length === 1 ? carried[0].id : "")
      : "",
    category: stockSource === "warehouse" && warehouse.length === 1 ? warehouse[0].category : undefined,
  });
  let emptyMessage = "";
  if (!available.length) {
    if (warehouse.length) emptyMessage = "Anda belum membawa telur. Pilih Stok gudang untuk menjual langsung.";
    else if (carried.length) emptyMessage = "Gudang sedang kosong. Anda bisa menjual dari telur yang Anda bawa.";
    else emptyMessage = "Belum ada telur siap jual. Catat panen dan pastikan telurnya sudah masuk gudang.";
  }
  return { source, setSource, warehouseSale, available, optionFor, choiceFor, emptyMessage };
}

export function SaleStockSourceField({ source, onChange }: {
  source: SaleStockSource; onChange(value: SaleStockSource): void;
}) {
  return <Field label="Jual dari">
    <select className="form-select" value={source}
      onChange={event => onChange(event.target.value === "warehouse" ? "warehouse" : "pickup")}>
      <option value="warehouse">Stok gudang</option>
      <option value="pickup">Telur yang saya bawa</option>
    </select>
  </Field>;
}
