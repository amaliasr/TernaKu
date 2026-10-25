import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, executeCommand, pickupBalance, visibleState } from "../src/lib/domain";
import type { CommandPayload, State } from "../src/lib/types";

const NOW = new Date("2026-10-13T09:00:00Z");
const DATE = "2026-10-13";
const PHOTO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC9sAAAAASUVORK5CYII=";
const largePhoto = `data:image/png;base64,${Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(1_048_577 - 8)]).toString("base64")}`;
const cmd = (state: State, actor: string, action: string, payload: CommandPayload) => executeCommand(state, actor, action, payload, NOW);

function fixture(): State {
  const state = emptyState();
  state.users = [
    { id: "admin", name: "Admin", email: "admin@example.test", role: "admin", active: true, target: 0 },
    { id: "employee", name: "Sari", email: "sari@example.test", role: "employee", active: true, target: 1000, registration_status: "approved", photo: PHOTO },
    { id: "pending", name: "Baru", email: "baru@example.test", role: "employee", active: false, target: 0, registration_status: "pending" },
  ];
  state.prices = [{ id: "price", good_price: 28000, cracked_price: 18000, effective_at: `${DATE}T00:00:00+07:00`, created_at: NOW.toISOString(), created_by: "admin" }];
  return state;
}

test("admin employee identity edits normalize unique emails, retain omitted photos, and keep audit data small", () => {
  const source = fixture();
  source.users[1].photo_ref = { kind: "profile", id: "employee", version: "a".repeat(64) };
  const edited = cmd(source, "admin", "user.update", { id: "employee", name: "  Sari Baru  ", email: " SARI.NEW@Example.test " });
  assert.equal(edited.users[1].name, "Sari Baru");
  assert.equal(edited.users[1].email, "sari.new@example.test");
  assert.equal(edited.users[1].photo, PHOTO);
  assert.deepEqual(edited.users[1].photo_ref, source.users[1].photo_ref);
  assert.equal(edited.users[1].role, "employee");
  assert.equal(edited.users[1].registration_status, "approved");
  assert.equal(JSON.stringify(edited.activity[0]).includes("data:image"), false);
  assert.equal(JSON.stringify(edited.activity[0]).includes("photo_ref"), false);
  assert.equal((edited.activity[0].after as { photo_changed: boolean }).photo_changed, false);
  const replaced = cmd(edited, "admin", "user.update", { id: "employee", photo: PHOTO });
  assert.equal(replaced.users[1].photo, PHOTO);
  assert.equal(replaced.users[1].photo_ref, undefined);
  assert.equal((replaced.activity[0].after as { photo_changed: boolean }).photo_changed, true);
  const removed = cmd(replaced, "admin", "user.update", { id: "employee", photo: "" });
  assert.equal(removed.users[1].photo, "");
  assert.equal(removed.users[1].email, "sari.new@example.test");
  assert.equal(source.users[1].email, "sari@example.test");
});

test("employee edits reject duplicate/invalid data atomically and cannot change privileges or an admin email/photo", () => {
  const state = fixture();
  const original = structuredClone(state);
  for (const email of ["ADMIN@example.test", " Baru@Example.Test ", "bad", "a@@example.test", "a b@example.test", "x".repeat(191) + "@example.test", "", null, 123])
    assert.throws(() => cmd(state, "admin", "user.update", { id: "employee", name: "Unsaved", email }), /Email|email/);
  for (const field of ["name", "email", "photo", "target", "active"])
    assert.throws(() => cmd(state, "admin", "user.update", { id: "employee", [field]: null }));
  for (const photo of ["https://example.test/a.png", "data:image/png;base64,aGVsbG8=", largePhoto])
    assert.throws(() => cmd(state, "admin", "user.update", { id: "employee", email: "unsaved@example.test", photo }), /Foto|foto/);
  for (const field of ["role", "registration_status", "password"])
    assert.throws(() => cmd(state, "admin", "user.update", { id: "employee", [field]: "admin" }), /tidak dapat diubah/);
  for (const payload of [{ email: "new@example.test" }, { photo: PHOTO }])
    assert.throws(() => cmd(state, "admin", "user.update", { id: "admin", ...payload }), /hanya.*karyawan/);
  assert.throws(() => cmd(state, "employee", "user.update", { id: "employee", name: "New" }), /hanya untuk admin/);
  assert.deepEqual(state, original);
  const same = cmd(state, "admin", "user.update", { id: "employee", email: "SARI@example.test" });
  assert.equal(same.users[1].email, "sari@example.test");
});

test("editing pending employee contact details does not approve or activate the account", () => {
  const state = cmd(fixture(), "admin", "user.update", { id: "pending", name: "Nama Baru", email: "pending.new@example.test", photo: PHOTO });
  assert.equal(state.users[2].active, false);
  assert.equal(state.users[2].registration_status, "pending");
  assert.equal(state.users[2].photo, PHOTO);
  assert.throws(() => cmd(state, "admin", "user.update", { id: "pending", active: true }), /persetujuan/);
  const approved = cmd(state, "admin", "user.approve", { id: "pending" });
  assert.equal(approved.users[2].email, "pending.new@example.test");
  assert.equal(approved.users[2].active, true);
});

function saleFixture(actor: string, free: boolean): { state: State; payload: CommandPayload } {
  const category = free ? "cracked" : "good";
  let state = cmd(fixture(), actor, "production.create", { date: DATE, category, eggs: 100, kg: 6, trays: 1 });
  state = cmd(state, actor, "pickup.create", { date: DATE, category, eggs: 100, kg: 6, trays: 1, area: "Pasar" });
  return { state, payload: { date: DATE, customer: "  Ibu Sari  ", photo: PHOTO, payment_method: "cash", paid: 0,
    items: [{ pickup_id: state.pickups[0].id, category, eggs: 50, kg: 3, trays: 0, ...(free ? { is_free: true } : {}) }] } };
}

for (const actor of ["admin", "employee"]) for (const free of [false, true]) {
  test(`${actor} ${free ? "free" : "regular"} sales require a customer name and valid documentation but no phone`, () => {
    const { state, payload } = saleFixture(actor, free);
    const before = structuredClone(state);
    for (const customer of [undefined, null, "", "  ", 123, "x".repeat(191)])
      assert.throws(() => cmd(state, actor, "sale.create", { ...payload, customer }), /Nama/);
    for (const photo of [undefined, null, "", "https://example.test/photo.jpg", "data:image/png;base64,aGVsbG8=", largePhoto])
      assert.throws(() => cmd(state, actor, "sale.create", { ...payload, photo }), /Foto|foto/);
    assert.deepEqual(state, before);
    const saved = cmd(state, actor, "sale.create", payload);
    assert.equal(saved.sales[0].customer, "Ibu Sari");
    assert.equal(saved.sales[0].phone, "");
    assert.equal(saved.sales[0].photo, PHOTO);
    assert.equal(saved.sales[0].total, free ? 0 : 84000);
    assert.equal(pickupBalance(saved, saved.pickups[0]).kg, 3);
  });
}

for (const free of [false, true]) test(`legacy ${free ? "free" : "regular"} sales remain readable and correctable without forcing a missing photo/name`, () => {
  const { state, payload } = saleFixture("employee", free);
  let legacy = cmd(state, "employee", "sale.create", payload);
  legacy.sales[0].customer = "";
  legacy.sales[0].photo = "";
  const saleId = legacy.sales[0].id;
  assert.equal(visibleState(legacy, legacy.users[1]).sales[0].id, saleId);
  if (!free) legacy = cmd(legacy, "employee", "sale.payment", { id: saleId, amount: 1000 });
  const fixed = cmd(legacy, "admin", "correction.apply", { entity: "sale", id: saleId, reason: "Tambahkan keterangan", changes: { notes: "Catatan lama dilengkapi" } });
  assert.equal(fixed.sales[0].photo, "");
  assert.equal(fixed.sales[0].customer, "");
  assert.equal(fixed.sales[0].notes, "Catatan lama dilengkapi");
  for (const customer of ["", "  ", null, "x".repeat(191)])
    assert.throws(() => cmd(fixed, "admin", "correction.apply", { entity: "sale", id: saleId, reason: "Ganti nama pelanggan", changes: { customer } }), /Nama/);
  const named = cmd(fixed, "admin", "correction.apply", { entity: "sale", id: saleId, reason: "Lengkapi nama pelanggan", changes: { customer: "  Ibu Ani  " } });
  assert.equal(named.sales[0].customer, "Ibu Ani");
  assert.equal(named.sales[0].photo, "");
});
