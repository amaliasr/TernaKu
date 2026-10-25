import test from "node:test";
import assert from "node:assert/strict";
import { eggStock, emptyState, executeCommand, isProductionStocked } from "../src/lib/domain";
import type { CommandPayload, State } from "../src/lib/types";

const now = new Date("2026-10-25T08:00:00Z");
const cmd = (state: State, user: string, action: string, payload: CommandPayload) => executeCommand(state, user, action, payload, now);
function fixture(): State {
  const state = emptyState();
  state.users = [
    { id: "admin", name: "Atasan", email: "admin@test.local", role: "admin", active: true, target: 0 },
    { id: "owner", name: "Sari", email: "sari@test.local", role: "employee", active: true, target: 0 },
    { id: "other", name: "Budi", email: "budi@test.local", role: "employee", active: true, target: 0 },
  ];
  return state;
}
const produce = (state: State) => cmd(state, "owner", "production.create", { date: "2026-10-25", category: "good", eggs: 100, kg: 6, trays: 1 });

test("automatic stock defaults on, including legacy productions without a receipt field", () => {
  const state = produce(fixture());
  assert.equal(state.settings?.harvest_auto_stock, true);
  assert.equal(isProductionStocked(state.productions[0]), true);
  assert.deepEqual(eggStock(state), { eggs: 100, kg: 6, trays: 1 });
  delete state.settings;
  delete state.productions[0].stocked_at;
  assert.equal(isProductionStocked(state.productions[0]), true);
  assert.equal(eggStock(state).eggs, 100);
  assert.throws(() => cmd(state, "owner", "production.receive", { id: state.productions[0].id }), /sudah masuk/);
});

test("pending harvest is recorded without warehouse stock or stock movement", () => {
  const state = produce(cmd(fixture(), "admin", "settings.update", { harvest_auto_stock: false }));
  assert.equal(state.productions[0].stocked_at, null);
  assert.deepEqual(eggStock(state), { eggs: 0, kg: 0, trays: 0 });
  assert.equal(state.stock_movements?.length, 0);
  assert.throws(() => cmd(state, "owner", "pickup.create", { date: "2026-10-25", category: "good", eggs: 1, kg: 0.06, trays: 0, area: "Pasar" }), /Stok tidak cukup/);
  const toggled = cmd(state, "admin", "settings.update", { harvest_auto_stock: true });
  assert.equal(toggled.productions[0].stocked_at, null);
  assert.equal(eggStock(toggled).eggs, 0);
});

test("only owner or admin may receive a pending harvest and repeated receipt cannot duplicate stock", () => {
  for (const receiver of ["owner", "admin"]) {
    const pending = produce(cmd(fixture(), "admin", "settings.update", { harvest_auto_stock: false }));
    const id = pending.productions[0].id;
    assert.throws(() => cmd(pending, "other", "production.receive", { id }));
    const received = cmd(pending, receiver, "production.receive", { id });
    assert.equal(received.productions[0].stocked_by, receiver);
    assert.equal(received.productions[0].stocked_at, now.toISOString());
    assert.deepEqual(eggStock(received), { eggs: 100, kg: 6, trays: 1 });
    assert.equal(received.stock_movements?.length, 1);
    assert.equal(received.stock_movements?.[0].kind, "production");
    assert.throws(() => cmd(received, receiver, "production.receive", { id }), /sudah masuk/);
    assert.equal(eggStock(pending).eggs, 0);
  }
});

test("pending corrections affect only recorded harvest, and warehouse receipt uses the corrected quantities", () => {
  const pending = produce(cmd(fixture(), "admin", "settings.update", { harvest_auto_stock: false }));
  const id = pending.productions[0].id;
  const corrected = cmd(pending, "owner", "correction.apply", { entity: "production", id, reason: "Hitungan diperbaiki", changes: { eggs: 120, kg: 7.2 } });
  assert.equal(corrected.stock_movements?.length, 0);
  assert.equal(eggStock(corrected).eggs, 0);
  const received = cmd(corrected, "admin", "production.receive", { id });
  assert.equal(eggStock(received).eggs, 120);
  assert.equal(received.stock_movements?.[0].kg, 7.2);
  const adjusted = cmd(received, "owner", "correction.apply", { entity: "production", id, reason: "Hitungan ulang lagi", changes: { eggs: 110, kg: 6.6 } });
  assert.equal(eggStock(adjusted).eggs, 110);
  assert.equal(adjusted.stock_movements?.[1].eggs, -10);
  assert.equal(adjusted.stock_movements?.[1].kind, "correction");
});

test("settings changes require admin and a strict boolean without injected fields", () => {
  const state = fixture();
  assert.throws(() => cmd(state, "owner", "settings.update", { harvest_auto_stock: false }));
  for (const payload of [{}, { harvest_auto_stock: "false" }, { harvest_auto_stock: false, role: "admin" }])
    assert.throws(() => cmd(state, "admin", "settings.update", payload));
  assert.equal(state.settings?.harvest_auto_stock, true);
});
