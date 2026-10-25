import type { CommandPayload, Sale, State } from "./types";

const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

function matchesPayload(sale: Sale, payload: CommandPayload): boolean {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const submittedAt = Date.parse(text(payload.date));
  if (
    !Number.isFinite(submittedAt) ||
    Date.parse(sale.date) !== submittedAt ||
    sale.customer !== text(payload.customer) ||
    sale.phone !== text(payload.phone) ||
    sale.notes !== text(payload.notes) ||
    sale.paid !== Number(payload.paid ?? 0) ||
    sale.payment_method !== (sale.total === 0 ? "cash" : payload.payment_method) ||
    items.length !== sale.items.length ||
    !items.length
  )
    return false;
  return sale.items.every((item, index) => {
    const submitted = items[index];
    if (!submitted || typeof submitted !== "object") return false;
    const line = submitted as CommandPayload;
    return (
      item.pickup_id === line.pickup_id &&
      item.category === line.category &&
      item.eggs === Number(line.eggs) &&
      item.kg === Number(line.kg) &&
      item.trays === Number(line.trays ?? 0) &&
      (line.is_free !== true ||
        (item.category === "cracked" && item.unit_price === 0))
    );
  });
}

/** Resolve only the confirmed transaction, never whichever sale happens to be newest. */
export function findSavedSale(
  confirmed: State,
  userId: string,
  payload: CommandPayload,
  requestId?: string,
  previousSaleIds?: readonly string[],
): Sale | null {
  const result = confirmed.command_result;
  if (result) {
    if (
      result.action !== "sale.create" ||
      (requestId !== undefined && result.request_id !== requestId)
    )
      return null;
    return (
      confirmed.sales.find(
        (sale) => sale.id === result.record_id && sale.user_id === userId,
      ) || null
    );
  }

  // Compatibility with an older API. If an exact match is ambiguous, keep the
  // confirmed-success screen and let the user open the receipt from history.
  const previous = new Set(previousSaleIds || []);
  const candidates = confirmed.sales.filter(
    (sale) =>
      sale.user_id === userId &&
      !previous.has(sale.id) &&
      matchesPayload(sale, payload),
  );
  return candidates.length === 1 ? candidates[0] : null;
}
