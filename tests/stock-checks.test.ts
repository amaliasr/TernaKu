import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, executeCommand, eggStock, today, visibleState } from "../src/lib/domain";
import { demoStockCheckContext, harvestCounts } from "../src/lib/stock-checks";
import type { State, User } from "../src/lib/types";

const day = today(), now = new Date(`${day}T10:00:00+07:00`);
const user = (id: string, role: User["role"]): User => ({ id, name: id, email: `${id}@example.test`, role, active: true, target: 0 });
const cmd = (state: State, actor: string, action: string, payload: Record<string, unknown>) => executeCommand(state, actor, action, payload, now);
function fixture() {
  let state: State = { ...emptyState(), users: [user("admin", "admin"), user("checker", "employee"), user("worker", "employee")] };
  state = cmd(state, "admin", "user.update", { id: "checker", can_check_stock: true });
  return cmd(state, "worker", "production.create", { date: day, category: "good", eggs: 100, kg: 10, trays: 1 });
}
const context = (state: State) => demoStockCheckContext(state, day, { good: eggStock(state, "good"), cracked: eggStock(state, "cracked") });
function submit(state: State, eggs = 105, kg = 10.5, harvestEggs = 110, harvestKg = 11) {
  const baseline = context(state), zero = { eggs: 0, kg: 0, trays: 0 };
  return cmd(state, "checker", "stock_check.submit", { date: day, expected_snapshot: baseline.snapshot, status: "pending", warehouse_actual: { good: { eggs, kg, trays: 1 }, cracked: zero }, harvest_actual: { good: { eggs: harvestEggs, kg: harvestKg, trays: 1 }, cracked: zero }, reason: "Hasil hitung ulang di gudang" });
}
test("only admin appoints eligible employees, and appointment history survives revocation", () => {
  const state = fixture();
  assert.throws(() => cmd(state, "worker", "user.update", { id: "worker", can_check_stock: true }), /admin/);
  assert.throws(() => cmd(state, "admin", "user.update", { id: "admin", can_check_stock: true }), /karyawan aktif/);
  const promoted = cmd(state, "admin", "user.update", { id: "checker", role: "admin" });
  assert.equal(promoted.users[1].can_check_stock, false);
  assert.deepEqual(promoted.stock_check_assignments?.map(a => a.assigned), [true, false]);
  assert.equal(state.stock_checks?.length, 0, "not pressing a button remains visibly unchecked");
});
test("assigned readers see team records with redacted identities but cannot edit other employees", () => {
  const state = fixture(), checker = state.users[1], worker = state.users[2];
  const scoped = visibleState(state, checker);
  assert.equal(scoped.productions.length, 1);
  assert.equal(scoped.users.find(u => u.id === worker.id)?.email, "");
  assert.equal(visibleState(state, { ...checker, can_check_stock: false }).productions.length, 0);
  assert.throws(() => cmd(state, "checker", "correction.apply", { entity: "production", id: state.productions[0].id, reason: "Saya memeriksa panen", changes: { eggs: 110, kg: 11 } }), /akses/);
  assert.throws(() => cmd(state, "worker", "stock_check.submit", { date: day, expected_snapshot: context(state).snapshot, status: "confirmed" }), /petugas/);
});
test("approval requires corrected individual harvests and adjusts warehouse only once", () => {
  let state = submit(fixture());
  const id = state.stock_checks![0].id;
  assert.throws(() => cmd(state, "admin", "stock_check.review", { id, decision: "approve" }), /Perbaiki catatan panen/);
  state = cmd(state, "admin", "correction.apply", { entity: "production", id: state.productions[0].id, reason: "Disesuaikan dengan hasil pemeriksaan", changes: { eggs: 110, kg: 11, trays: 1 } });
  state = cmd(state, "admin", "stock_check.review", { id, decision: "approve" });
  assert.deepEqual(eggStock(state, "good"), { eggs: 105, kg: 10.5, trays: 1 });
  assert.equal(state.productions[0].eggs, 110);
  assert.equal(state.stock_checks![0].status, "approved");
  assert.throws(() => cmd(state, "admin", "stock_check.review", { id, decision: "approve" }), /menunggu/);
});
test("new business movements and employee corrections cannot be approved against an old count", () => {
  const state = submit(fixture(), 105, 10.5, 100, 10), id = state.stock_checks![0].id;
  const changed = cmd(state, "worker", "production.create", { date: day, category: "good", eggs: 10, kg: 1, trays: 0 });
  assert.throws(() => cmd(changed, "admin", "stock_check.review", { id, decision: "approve" }), /pergerakan stok baru/);
  const employeeEdit = cmd(state, "worker", "correction.apply", { entity: "production", id: state.productions[0].id, reason: "Karyawan mengoreksi sendiri", changes: { eggs: 105, kg: 10.5 } });
  assert.throws(() => cmd(employeeEdit, "admin", "stock_check.review", { id, decision: "approve" }), /pergerakan stok baru/);
});
test("rechecks retain superseded attempts and reject stale or wrong-day submissions", () => {
  let state = submit(fixture());
  const previous = state.stock_checks![0].id;
  state = submit(state);
  assert.equal(state.stock_checks!.length, 2);
  assert.equal(state.stock_checks![0].status, "superseded");
  assert.equal(state.stock_checks![0].replaced_by, state.stock_checks![1].id);
  assert.throws(() => cmd(state, "admin", "stock_check.review", { id: previous, decision: "approve" }), /menunggu/);
  assert.throws(() => cmd(state, "checker", "stock_check.submit", { date: "2000-01-01", expected_snapshot: context(state).snapshot, status: "confirmed" }), /hari ini/);
  assert.throws(() => cmd(state, "checker", "stock_check.submit", { date: day, expected_snapshot: "stale", status: "confirmed" }), /sudah berubah/);
  const confirmed = cmd(fixture(), "checker", "stock_check.submit", { date: day, expected_snapshot: context(fixture()).snapshot, status: "confirmed" });
  assert.equal(confirmed.stock_checks![0].status, "confirmed");
  assert.throws(() => cmd(confirmed, "checker", "stock_check.submit", { date: day, expected_snapshot: context(confirmed).snapshot, status: "confirmed" }), /sudah selesai/);
});
test("an admin can void an erroneous harvest with zero quantities while retaining its audit", () => {
  const original = fixture(), production = original.productions[0];
  assert.throws(() => cmd(original, "worker", "correction.apply", { entity: "production", id: production.id, reason: "Panen tidak benar", changes: { eggs: 0, kg: 0, trays: 0 } }), /butir|Berat/);
  assert.throws(() => cmd(original, "worker", "correction.request", { entity: "production", id: production.id, reason: "Panen tidak benar", changes: { eggs: 0, kg: 0, trays: 0 } }), /butir|Berat/);
  assert.throws(() => cmd(original, "admin", "correction.apply", { entity: "production", id: production.id, reason: "Panen tidak benar", changes: { eggs: 0 } }), /membatalkan/);
  const state = cmd(original, "admin", "correction.apply", { entity: "production", id: production.id, reason: "Catatan panen terinput dua kali", changes: { eggs: 0, kg: 0, trays: 0 } });
  assert.equal(state.productions[0].id, production.id);
  assert.equal(harvestCounts(state.productions, day).good.eggs, 0);
  assert.equal((state.activity[0].before as { eggs: number }).eggs, 100);
});
test("marking all read affects only the actor's notifications", () => {
  const state = fixture();
  state.notifications = ["checker", "worker"].map(user_id => ({ id: user_id, user_id, title: "Info", message: "Panen", read: false, created_at: now.toISOString() }));
  const result = cmd(state, "checker", "notification.read", { id: "all" });
  assert.deepEqual(result.notifications.map(n => n.read), [true, false]);
});
