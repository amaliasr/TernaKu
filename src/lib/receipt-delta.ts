import type { Pickup, PickupBalance, Sale, State, StockMovement } from "./types";
import { ALL_EGG_TYPES, emptyEggQuantities, isEggType, canonicalEggType } from "./egg-types";

interface ReceiptDelta {
  mode: "sale_receipt";
  command_result: NonNullable<State["command_result"]>;
  sale: Sale;
  pickups: Pickup[];
  pickup_balances: Record<string, PickupBalance>;
  inventory?: State["inventory"];
  stock_movements?: StockMovement[];
}

const obj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const quantity = (v: Record<string, unknown>) => ["eggs", "kg", "trays"].every(k => finite(v[k]));
const validCategory = isEggType;

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
  if (sale.stock_source === "warehouse") {
    if (pickups.length || Object.keys(balances).length || sale.items.some(i => i.pickup_id !== "")
      || !obj(data.inventory) || !Array.isArray(data.stock_movements)) return false;
    const inventory = data.inventory;
    if (!ALL_EGG_TYPES.every(category => {
      const q = inventory[category];
      return obj(q) && quantity(q) && ["kg","eggs","trays"].every(k => Number(q[k]) >= 0);
    })) return false;
    const categories = new Set(sale.items.map(i => i.category));
    const ids = new Set<string>();
    for (const m of data.stock_movements) {
      if (!obj(m) || typeof m.id !== "string" || !m.id || ids.has(m.id) || m.kind !== "sale"
        || m.reference_id !== sale.id || m.user_id !== userId || !categories.delete(m.category)
        || !quantity(m) || Number(m.eggs) >= 0 || Number(m.kg) >= 0 || Number(m.trays) > 0
        || !["date","created_at","notes"].every(k => typeof m[k] === "string")) return false;
      ids.add(m.id);
    }
    return !categories.size;
  }
  if ((sale.stock_source !== undefined && sale.stock_source !== "pickup") || sale.items.some(i => !i.pickup_id)) return false;
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
  const sale = { ...delta.sale, items: delta.sale.items.map(item => ({ ...item, category: canonicalEggType(item.category) })) };
  const sales = state.sales.some(s => s.id === sale.id)
    ? state.sales.map(s => s.id === sale.id ? sale : s) : [sale, ...state.sales];
  const updated = new Map(delta.pickups.map(p => [p.id, { ...p, category: canonicalEggType(p.category) }]));
  const pickups = state.pickups.map(p => {
    const next = updated.get(p.id);
    updated.delete(p.id);
    return next ?? p;
  });
  // A warehouse receipt carries an authoritative balance. Never subtract the
  // quantities locally: the same receipt may be replayed after a lost response.
  const warehouse = delta.sale.stock_source === "warehouse" && delta.inventory && delta.stock_movements;
  const movementIds = new Set(warehouse ? warehouse.map(m => m.id) : []);
  const inventory = warehouse && delta.inventory ? { ...emptyEggQuantities(), ...delta.inventory } : undefined;
  if (inventory) {
    inventory.skm = {
      eggs: inventory.skm.eggs + inventory.good.eggs,
      kg: Math.round((inventory.skm.kg + inventory.good.kg) * 1000) / 1000,
      trays: inventory.skm.trays + inventory.good.trays,
    };
    inventory.good = { eggs: 0, kg: 0, trays: 0 };
  }
  return { ...state, command_result: delta.command_result,
    sales,
    ...(warehouse ? {
      inventory,
      stock_movements: [...warehouse.map(m => ({ ...m, category: canonicalEggType(m.category) })), ...(state.stock_movements || []).filter(m => !movementIds.has(m.id))],
    } : {}),
    pickups: [...updated.values(), ...pickups],
    pickup_balances: { ...state.pickup_balances, ...delta.pickup_balances },
  };
}
