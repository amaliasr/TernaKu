import type { Pickup, PickupBalance, Sale, State } from "./types";

interface ReceiptDelta {
  mode: "sale_receipt";
  command_result: NonNullable<State["command_result"]>;
  sale: Sale;
  pickups: Pickup[];
  pickup_balances: Record<string, PickupBalance>;
}

const obj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const quantity = (v: Record<string, unknown>) => ["eggs", "kg", "trays"].every(k => finite(v[k]));
const validCategory = (v: unknown) => v === "good" || v === "cracked";

/** A receipt from another request, account, or pickup cannot modify this session. */
export function isReceiptDelta(data: unknown, userId: string, requestId: string | undefined): data is ReceiptDelta {
  if (!obj(data) || data.mode !== "sale_receipt" || !obj(data.command_result) || !obj(data.sale)
    || !Array.isArray(data.pickups) || !obj(data.pickup_balances)) return false;
  const { command_result: result, sale, pickups, pickup_balances: balances } = data;
  if (result.action !== "sale.create" || typeof requestId !== "string" || result.request_id !== requestId
    || typeof sale.id !== "string" || !sale.id || sale.id !== result.record_id || sale.user_id !== userId
    || !["number", "date", "customer", "phone", "notes", "created_at"].every(k => typeof sale[k] === "string")
    || !["cash", "credit", "transfer", "qris"].includes(String(sale.payment_method))
    || !["paid", "unpaid", "partial"].includes(String(sale.payment_status))
    || ![sale.total, sale.balance, sale.paid].every(finite) || !Array.isArray(sale.items) || !sale.items.length
    || sale.items.length > 100 || !sale.items.every(i => obj(i) && typeof i.pickup_id === "string" && validCategory(i.category) && quantity(i) && finite(i.unit_price) && finite(i.total))) return false;
  const expected = new Set(sale.items.map(i => i.pickup_id));
  if (pickups.length !== expected.size || Object.keys(balances).length !== expected.size) return false;
  for (const p of pickups) {
    if (!obj(p) || typeof p.id !== "string" || !expected.delete(p.id) || p.user_id !== userId
      || !validCategory(p.category) || !quantity(p) || !["returned_eggs","returned_kg","returned_trays"].every(k => finite(p[k]))) return false;
    const b = balances[p.id];
    if (!obj(b) || !quantity(b) || !["Dibawa","Sebagian terjual","Terjual","Dikembalikan"].includes(String(b.status))) return false;
  }
  return !expected.size;
}

export function mergeReceiptDelta(state: State, delta: ReceiptDelta): State {
  const sales = state.sales.some(s => s.id === delta.sale.id)
    ? state.sales.map(s => s.id === delta.sale.id ? delta.sale : s) : [delta.sale, ...state.sales];
  const updated = new Map(delta.pickups.map(p => [p.id, p]));
  const pickups = state.pickups.map(p => {
    const next = updated.get(p.id);
    updated.delete(p.id);
    return next ?? p;
  });
  // Only carried stock changes when eggs are sold. Warehouse stock was deducted
  // on pickup. Updating the latter here would count a sale twice.
  return { ...state, command_result: delta.command_result,
    sales,
    pickups: [...updated.values(), ...pickups],
    pickup_balances: { ...state.pickup_balances, ...delta.pickup_balances },
  };
}
