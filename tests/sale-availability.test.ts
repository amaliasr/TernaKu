import test from "node:test";
import assert from "node:assert/strict";
import {
  availableSalePickups,
  saleStockKey,
  saleStockIssues,
  saleStockPreview,
  warehouseSaleOptions,
} from "../src/lib/sale-availability";
import { emptyEggQuantities } from "../src/lib/egg-types";
import { createDemoState } from "../src/lib/seed";

test("sale drafts use the latest owned pickup balance, including multiple lines from one batch", () => {
  const state = createDemoState(new Date("2026-11-06T03:00:00Z"));
  const pickup = state.pickups[0];
  state.pickup_balances = {
    [pickup.id]: { eggs: 10, kg: 0.6, trays: 0, status: "Sebagian terjual" },
  };
  const available = availableSalePickups(state, pickup.user_id);
  const line = (eggs: string, kg: string) => ({
    pickup_id: pickup.id,
    eggs,
    kg,
  });
  assert.equal(
    saleStockIssues([line("5", "0.3"), line("5", "0.3")], available).size,
    0,
  );
  assert.match(
    saleStockIssues([line("6", "0.3"), line("5", "0.3")], available).get(
      pickup.id,
    )!,
    /Kurangi jumlah/,
  );
  assert.match(
    saleStockIssues([line("10", "0.3")], available).get(pickup.id)!,
    /sisakan butir/,
  );
  assert.match(
    saleStockIssues([line("5", "0.6")], available).get(pickup.id)!,
    /sisakan butir/,
  );
  state.pickup_balances[pickup.id] = {
    eggs: 0,
    kg: 0,
    trays: 0,
    status: "Terjual",
  };
  assert.match(
    saleStockIssues(
      [line("1", "0.05")],
      availableSalePickups(state, pickup.user_id),
    ).get(pickup.id)!,
    /tidak tersedia/,
  );
  assert.equal(availableSalePickups(state, "other-user").length, 0);
});

test("weighed sales reserve counted eggs first and keep estimates separate across sources", () => {
  const options = [
    { id: "good", balance: { eggs: 45, kg: 10, trays: 0 } },
    { id: "cracked", balance: { eggs: 10, kg: 0.5, trays: 0 } },
  ];
  const good = { pickup_id: "", category: "good" as const, kg: "7", eggs: "" };
  const cracked = { ...good, category: "cracked" as const };
  const draft = [good, { ...cracked, eggs: "", kg: "0.05" }, { ...cracked, eggs: "5", kg: "0.4" }, { ...cracked, eggs: "", kg: "0.05" }];
  const preview = saleStockPreview(draft, options, "warehouse");
  assert.deepEqual([...preview.issues], []);
  // 45 * 7 / 10 rounds to 32. For cracked, reserve 5 counted first, then split the 5 remaining eggs.
  assert.deepEqual([...preview.estimatedEggs], [[0, 32], [1, 3], [3, 2]]);
  const last = { pickup_id: "personal", eggs: "", kg: "0.01" };
  const personal = [{ id: "personal", balance: { eggs: 2, kg: 0.1, trays: 0 } }];
  const impossible = saleStockPreview([last, last], personal);
  assert.match(impossible.issues.get("personal")!, /Periksa berat/);
  assert.equal(impossible.estimatedEggs.size, 0);
  assert.deepEqual([...saleStockPreview([{ ...last, kg: "0.099" }], personal).estimatedEggs], [[0, 1]]);
  assert.deepEqual([...saleStockPreview([{ ...last, kg: "0.1" }], personal).estimatedEggs], [[0, 2]]);
  for (const eggs of ["0", "-1", "1.25", "0x10"])
    assert.match(saleStockPreview([{ ...last, eggs }], personal).issues.get("personal")!, /Jumlah butir/);
});

test("warehouse options use the current farm inventory and exclude categories with no saleable eggs", () => {
  const state = createDemoState(new Date("2026-11-06T03:00:00Z"));
  state.inventory = { ...emptyEggQuantities(), good: { eggs: 8, kg: 0.48, trays: 0 }, cracked: { eggs: 0, kg: 0, trays: 1 } };
  const options = warehouseSaleOptions(state);
  assert.deepEqual(options.map(o => [o.id, o.category, o.balance]), [["good", "good", state.inventory.good]]);
  const line = { pickup_id: "p-123", category: "cracked" as const, eggs: "1", kg: "0.05" };
  assert.equal(saleStockKey(line, "warehouse"), "cracked");
  assert.equal(saleStockKey(line, "pickup"), "p-123");
  assert.match(saleStockIssues([line], options, "warehouse").get("cracked")!, /habis di gudang/);
});

test("warehouse form aggregates quantities by category, including crates, without consuming a pickup", () => {
  const options = [
    { id: "good", balance: { eggs: 30, kg: 1.8, trays: 2 } },
    { id: "cracked", balance: { eggs: 10, kg: 0.6, trays: 1 } },
  ];
  const line = { pickup_id: "", category: "good" as const, eggs: "15", kg: "0.9", trays: "1" };
  const other = { ...line, category: "cracked" as const, eggs: "10", kg: "0.6" };
  assert.equal(saleStockIssues([line, line, other], options, "warehouse").size, 0);
  for (const changed of [{ eggs: "16" }, { kg: "0.901" }, { trays: "2" }])
    assert.match(saleStockIssues([line, { ...line, ...changed }], options, "warehouse").get("good")!, /Di gudang tersisa/);
  assert.match(saleStockIssues([line, { ...line, kg: "0.899" }], options, "warehouse").get("good")!, /sisakan butir/);
  assert.equal(saleStockIssues([{ ...line, pickup_id: "good", trays: "3" }], options, "pickup").size, 0);
});
