import test from "node:test";
import assert from "node:assert/strict";
import { closingEggStock, eggStock, emptyState, executeCommand, isProductionStocked } from "../src/lib/domain";
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

const both = { date: "2026-10-24", notes: "Timbang sore", items: [
  {category:"good", eggs:1240, kg:70, trays:8}, {category:"cracked", eggs:35, kg:2.1, trays:0},
] };
const count = { reason:"Dua butir pecah di rak", items:[
  {category:"good",expected:{eggs:1240,kg:70},physical:{eggs:1238,kg:69.88}},
  {category:"cracked",expected:{eggs:35,kg:2.1},physical:{eggs:35,kg:2.1}},
] };
test("one mixed harvest yields two linked lines, one audit, exact stock and no partial writes", () => {
  const initial=fixture(), state=cmd(initial,"owner","production.create",both);
  assert.deepEqual(eggStock(state),{eggs:1275,kg:72.1,trays:8});
  assert.equal(state.activity.length,1);
  assert.ok(state.productions[0].harvest_id);
  assert.equal(state.productions[0].harvest_id,state.productions[1].harvest_id);
  assert.equal(state.stock_movements?.length,2);
  for(const invalid of [[],[both.items[0],both.items[0]],[both.items[0],{...both.items[1],kg:0}]]) {
    assert.throws(()=>cmd(initial,"owner","production.create",{...both,items:invalid}));
    assert.equal(eggStock(initial).eggs,0);
  }
});
test("warehouse count preserves original harvest, records even a matching count, and rejects stale or partial adjustments",()=>{
  const initial=cmd(fixture(),"owner","production.create",both);
  const counted=cmd(initial,"admin","stock.reconcile",count);
  assert.equal(counted.productions[0].eggs,1240);
  assert.deepEqual(eggStock(counted,"good"),{eggs:1238,kg:69.88,trays:8});
  const entries=counted.stock_movements!.filter(m=>m.kind==="reconcile");
  assert.equal(entries.length,2);
  assert.equal(entries[0].reference_id,entries[1].reference_id);
  assert.deepEqual(entries.map(m=>[m.eggs,m.kg]),[[-2,-0.12],[0,0]]);
  assert.deepEqual(entries[0].physical,{eggs:1238,kg:69.88});
  assert.throws(()=>cmd(initial,"owner","stock.reconcile",count),/admin/);
  assert.throws(()=>cmd(counted,"admin","stock.reconcile",count),/Stok berubah/);
  for(const physical of [{eggs:0,kg:1},{eggs:1,kg:0},{eggs:-1,kg:1}])
    assert.throws(()=>cmd(initial,"admin","stock.reconcile",{...count,items:[count.items[0],{...count.items[1],physical}]}));
  assert.throws(()=>cmd(initial,"admin","stock.reconcile",{...count,reason:" "}));
  assert.equal(eggStock(initial,"good").eggs,1240);
});
test("end-of-day WIB stock includes only movements through the cutoff, independent of period start",()=>{
  const initial=cmd(fixture(),"owner","production.create",both);
  const counted=cmd(initial,"admin","stock.reconcile",count);
  assert.deepEqual(closingEggStock(counted,"good","2026-10-23","2026-10-25"),{eggs:0,kg:0});
  assert.deepEqual(closingEggStock(counted,"good","2026-10-24","2026-10-25"),{eggs:1240,kg:70});
  // 17:00 UTC is already the following day in Jakarta.
  const next=executeCommand(counted,"owner","pickup.create",{date:"2026-10-25T17:00:00Z",category:"good",eggs:10,kg:.6,trays:0,area:"Pasar"},new Date("2026-10-26T02:00:00Z"));
  assert.deepEqual(closingEggStock(next,"good","2026-10-25","2026-10-26"),{eggs:1238,kg:69.88});
  assert.deepEqual(closingEggStock(next,"good","2026-10-26","2026-10-26"),{eggs:1228,kg:69.28});
  assert.equal(closingEggStock(next,"good","2026-10-27","2026-10-26"),null);
});
test("a manual mixed harvest belongs to warehouse history only when each line is received",()=>{
  const pending=cmd(cmd(fixture(),"admin","settings.update",{harvest_auto_stock:false}),"owner","production.create",both);
  const received=cmd(pending,"admin","production.receive",{id:pending.productions[0].id});
  assert.equal(eggStock(received,"cracked").eggs,0);
  assert.deepEqual(closingEggStock(received,"good","2026-10-24","2026-10-25"),{eggs:0,kg:0});
  const incomplete={...received,stock_movements:[]};
  assert.equal(closingEggStock(incomplete,"good","2026-10-24","2026-10-25"),null);
});

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
