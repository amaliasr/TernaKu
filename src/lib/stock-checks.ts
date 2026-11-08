import type { CommandPayload, Production, State, StockCheckContext, StockCheckQuantities, User } from "./types";
import { ApiError } from "./request-errors";
import { ALL_EGG_TYPES, emptyEggQuantities } from "./egg-types";

const categories = ALL_EGG_TYPES;
const round = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const ensure = (ok: unknown, message: string): void => { if (!ok) throw new Error(message); };
function dayOf(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const zoned = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value) ? value : value.replace(" ", "T") + "+07:00";
  const date = new Date(zoned);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(date) : "";
}
export function harvestCounts(productions: Production[], day: string): StockCheckQuantities {
  const counts: StockCheckQuantities = emptyEggQuantities();
  for (const p of productions) if (dayOf(p.date) === day) {
    const q = counts[p.category]; q.eggs += p.eggs; q.kg = round(q.kg + p.kg); q.trays += p.trays;
  }
  return counts;
}
export function sameCheckCounts(a: StockCheckQuantities, b: StockCheckQuantities): boolean {
  return categories.every(c => !!a[c] && !!b[c] && a[c].eggs === b[c].eggs && round(a[c].kg) === round(b[c].kg) && a[c].trays === b[c].trays);
}
function businessSnapshot(state: State) {
  const ordered = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return {
    productions: ordered(state.productions).map(p => ({ id: p.id, date: p.date, category: p.category, user_id: p.user_id, eggs: p.eggs, kg: p.kg, trays: p.trays, stocked_at: p.stocked_at })),
    sales: ordered(state.sales).map(s => ({ id: s.id, date: s.date, user_id: s.user_id, items: s.items.map(i => ({ category: i.category, pickup_id: i.pickup_id, eggs: i.eggs, kg: i.kg, trays: i.trays })) })),
    pickups: ordered(state.pickups).map(p => ({ id: p.id, date: p.date, user_id: p.user_id, category: p.category, eggs: p.eggs, kg: p.kg, trays: p.trays, returned_eggs: p.returned_eggs, returned_kg: p.returned_kg, returned_trays: p.returned_trays })),
    movements: (state.stock_movements || []).map(m => m.id).sort(),
    corrections: state.activity.filter(a => a.action === "correction.apply" || a.action === "correction.review").map(a => a.id).sort(),
  };
}
export function demoStockCheckContext(state: State, day: string, warehouse: StockCheckQuantities): StockCheckContext {
  const harvest = harvestCounts(state.productions, day);
  return { schema_version: 2, date: day, warehouse, harvest, snapshot: JSON.stringify({ schema_version: 2, date: day, warehouse, harvest, business: businessSnapshot(state) }) };
}
function actual(value: unknown): StockCheckQuantities {
  ensure(!!value && typeof value === "object" && !Array.isArray(value), "Isi hasil hitungan untuk setiap jenis telur.");
  const data = value as StockCheckQuantities;
  ensure(Object.keys(data).sort().join(",") === [...categories].sort().join(","), "Isi SKM, SKM Baru, Bentes, dan stok bagus lama yang belum dibedakan.");
  for (const c of categories) {
    const q = data[c];
    ensure(!!q && typeof q === "object" && Object.keys(q).sort().join(",") === "eggs,kg,trays", "Isi jumlah butir, berat, dan krat.");
    for (const key of ["eggs", "kg", "trays"] as const)
      ensure(typeof q[key] === "number" && Number.isFinite(q[key]) && q[key] >= 0 && q[key] <= 1_000_000_000 && (key === "kg" ? round(q[key]) === q[key] : Number.isInteger(q[key])), "Masukkan jumlah yang valid; berat maksimal tiga angka desimal.");
    ensure((q.eggs === 0) === (q.kg === 0), "Jumlah butir dan berat harus sama-sama nol atau terisi.");
  }
  return structuredClone(data);
}
function reason(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  ensure(text.length >= 5 && text.length <= 2000, "Tulis alasan antara 5 dan 2.000 karakter.");
  return text;
}
export function recordStockAssignment(state: State, target: User, assigned: boolean, actor: User, stamp: string, id: (prefix: string) => string): void {
  const before = !!target.can_check_stock;
  target.can_check_stock = assigned;
  if (before !== assigned) (state.stock_check_assignments ??= []).push({ id: id("assignment"), user_id: target.id, assigned, created_at: stamp, created_by: actor.id });
}

/** The demo follows the same approval gates; live authority stays in the API transaction. */
export function applyDemoStockCheck(state: State, actor: User, action: string, payload: CommandPayload, context: StockCheckContext, stamp: string, id: (prefix: string) => string): { before?: unknown; after: unknown } {
  const checks = state.stock_checks ??= [];
  if (action === "stock_check.submit") {
    ensure(actor.role === "employee" && actor.can_check_stock, "Hanya petugas yang ditunjuk dapat mengirim pemeriksaan.");
    if (payload.schema_version !== 2) throw new ApiError("Perbarui aplikasi untuk memeriksa SKM, SKM Baru, dan Bentes.", 409);
    ensure(Object.keys(payload).every(k => ["schema_version", "date", "expected_snapshot", "status", "warehouse_actual", "harvest_actual", "reason"].includes(k)), "Kolom pemeriksaan tidak dikenal.");
    ensure(payload.date === context.date, "Pemeriksaan hanya dapat dikirim untuk hari ini.");
    if (payload.expected_snapshot !== context.snapshot) throw new ApiError("Catatan sudah berubah. Muat ulang dan hitung kembali.", 409);
    ensure(payload.status === "confirmed" || payload.status === "pending", "Pilih hasil pemeriksaan.");
    ensure(payload.status !== "confirmed" || (payload.warehouse_actual === undefined && payload.harvest_actual === undefined), "Untuk hitungan berbeda, pilih Ada selisih.");
    const prior = [...checks].reverse().find(c => c.user_id === actor.id && c.date === context.date && c.status !== "superseded");
    ensure(!prior || prior.schema_version !== 2 || prior.status === "pending" || prior.status === "rejected", "Pemeriksaan hari ini sudah selesai.");
    const warehouse = payload.status === "confirmed" ? structuredClone(context.warehouse) : actual(payload.warehouse_actual);
    const harvest = payload.status === "confirmed" ? structuredClone(context.harvest) : actual(payload.harvest_actual);
    const note = payload.status === "pending" ? reason(payload.reason) : "";
    ensure(payload.status !== "pending" || !sameCheckCounts(warehouse, context.warehouse) || !sameCheckCounts(harvest, context.harvest), "Jumlahnya sudah sama. Pilih Jumlah sudah cocok.");
    const row = {
      schema_version: 2, id: id("stock-check"), user_id: actor.id, date: context.date, snapshot: context.snapshot,
      status: payload.status as "confirmed" | "pending", expected: { warehouse: structuredClone(context.warehouse), harvest: structuredClone(context.harvest) },
      warehouse_actual: warehouse, harvest_actual: harvest, production_ids: state.productions.filter(p => dayOf(p.date) === context.date).map(p => p.id),
      movement_sequence: state.stock_movements?.length || 0, movement_ids: (state.stock_movements || []).map(m => m.id),
      reason: note, created_at: stamp, updated_at: stamp, reviewed_at: null, reviewed_by: null, review_reason: "",
    };
    if (prior) { prior.status = "superseded"; prior.replaced_by = row.id; prior.updated_at = stamp; }
    checks.push(row);
    return { after: structuredClone(row) };
  }
  ensure(actor.role === "admin", "Hanya atasan yang dapat menyetujui pemeriksaan.");
  ensure(Object.keys(payload).every(k => ["schema_version", "id", "decision", "reason"].includes(k)), "Kolom persetujuan tidak dikenal.");
  const row = checks.find(c => c.id === payload.id);
  if (!row || row.status !== "pending") throw new Error("Pemeriksaan tidak sedang menunggu persetujuan.");
  ensure(payload.decision === "approve" || payload.decision === "reject", "Pilih keputusan pemeriksaan.");
  const before = structuredClone(row);
  if (payload.decision === "reject") { row.status = "rejected"; row.review_reason = reason(payload.reason); }
  else {
    if (payload.schema_version !== 2) throw new ApiError("Perbarui aplikasi untuk menyetujui pemeriksaan setiap jenis telur.", 409);
    if (row.schema_version !== 2) throw new ApiError("Jenis telur sekarang sudah dipisahkan. Minta petugas menghitung ulang sebelum disetujui.", 409);
    const baseline = JSON.parse(row.snapshot).business as ReturnType<typeof businessSnapshot>;
    const current = businessSnapshot(state);
    const allowed = new Set(row.production_ids);
    const stale = JSON.stringify(baseline.sales) !== JSON.stringify(current.sales) || JSON.stringify(baseline.pickups) !== JSON.stringify(current.pickups)
      || JSON.stringify(baseline.productions.map(p => p.id)) !== JSON.stringify(current.productions.map(p => p.id))
      || JSON.stringify(baseline.productions.filter(p => !allowed.has(p.id))) !== JSON.stringify(current.productions.filter(p => !allowed.has(p.id)))
      || (state.stock_movements || []).some(m => !baseline.movements.includes(m.id) && !(m.kind === "correction" && allowed.has(m.reference_id)))
      || state.activity.some(a => current.corrections.includes(a.id) && !baseline.corrections.includes(a.id) && a.actor_role !== "admin");
    if (stale) throw new ApiError("Ada pergerakan stok baru setelah pemeriksaan. Minta petugas menghitung ulang.", 409);
    ensure(sameCheckCounts(harvestCounts(state.productions, row.date), row.harvest_actual), "Perbaiki catatan panen masing-masing karyawan sampai sesuai hasil pemeriksaan.");
    for (const category of categories) {
      const expected = context.warehouse[category], physical = row.warehouse_actual[category];
      (state.stock_movements ??= []).push({ id: id("movement"), date: stamp, created_at: stamp, user_id: actor.id, category, kind: "reconcile", method: "count", expected: structuredClone(expected), physical: structuredClone(physical), reference_id: row.id, eggs: physical.eggs - expected.eggs, kg: round(physical.kg - expected.kg), trays: physical.trays - expected.trays, notes: `Pemeriksaan gudang disetujui: ${row.reason}` });
    }
    row.status = "approved"; row.review_reason = typeof payload.reason === "string" ? payload.reason.trim().slice(0, 2000) : "";
  }
  row.reviewed_by = actor.id; row.reviewed_at = stamp; row.updated_at = stamp;
  return { before, after: structuredClone(row) };
}
