import test from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../src/lib/domain";
import { isPriceSyncResponse, mergePriceSync, refreshKind } from "../src/lib/price-sync";
import type { PriceSyncResponse } from "../src/lib/types";

function snapshot(): PriceSyncResponse {
  return {
    prices: [{ id: "new-price", good_price: 28000, cracked_price: 0, effective_at: "2026-10-25T00:00:00+07:00", created_at: "2026-10-25T00:00:00+07:00", created_by: "admin" }],
    notifications: [],
    user: { id: "employee", name: "Nama baru", email: "employee@test.local", role: "employee", active: true, target: 1, registration_status: "approved" },
    settings: { harvest_auto_stock: false },
  };
}

test("five-second employee ticks are lightweight until full data reaches one minute", () => {
  for (const elapsed of [5_000, 10_000, 55_000, 59_999])
    assert.equal(refreshKind(true, "employee", 1_000, 1_000 + elapsed), "prices");
  assert.equal(refreshKind(true, "employee", 1_000, 61_000), "full");
  assert.equal(refreshKind(false, "employee", 1_000, 2_000), "full");
  assert.equal(refreshKind(true, "employee", 0, 2_000), "full");
  assert.equal(refreshKind(true, undefined, 1_000, 2_000), "full");
  assert.equal(refreshKind(true, "admin", 1_000, 2_000), "full");
});

test("lightweight sync replaces prices and account metadata while preserving media and unrelated state", () => {
  const state = emptyState();
  state.users = [{ ...snapshot().user, name: "Nama lama", photo: "legacy-data", photo_ref: { kind: "profile", id: "employee", version: "a".repeat(64) } }];
  const before = structuredClone(state);
  const incoming = snapshot();
  // Even a server accidentally including photo fields cannot erase cached identity media.
  Object.assign(incoming.user, { photo: "", photo_ref: undefined });
  const merged = mergePriceSync(state, incoming, "employee");
  assert.equal(merged.users[0].name, "Nama baru");
  assert.equal(merged.users[0].photo, "legacy-data");
  assert.deepEqual(merged.users[0].photo_ref, before.users[0].photo_ref);
  assert.equal(merged.productions, state.productions);
  assert.equal(merged.sales, state.sales);
  assert.equal(merged.prices, incoming.prices);
  assert.equal(merged.settings?.harvest_auto_stock, false);
  assert.deepEqual(state, before);
  assert.throws(() => mergePriceSync(state, incoming, "other-account"), /akun tidak sesuai/);
});

test("malformed sync envelopes are rejected while revocation metadata remains visible to the caller", () => {
  const valid = snapshot();
  assert.equal(isPriceSyncResponse(valid), true);
  assert.equal(isPriceSyncResponse({ ...valid, user: { ...valid.user, active: false } }), true);
  for (const invalid of [null, {}, { ...valid, settings: {} }, { ...valid, user: { ...valid.user, active: "yes" } }, { ...valid, user: { ...valid.user, role: "owner" } }, { ...valid, prices: {} }])
    assert.equal(isPriceSyncResponse(invalid), false);
});
