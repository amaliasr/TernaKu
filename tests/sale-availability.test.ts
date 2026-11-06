import test from "node:test";
import assert from "node:assert/strict";
import {
  availableSalePickups,
  saleStockKey,
  saleStockIssues,
  warehouseSaleOptions,
} from "../src/lib/sale-availability";
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

test("warehouse options use the current farm inventory and exclude categories with no saleable eggs", () => {
  const state = createDemoState(new Date("2026-11-06T03:00:00Z"));
  state.inventory = { good: { eggs: 8, kg: 0.48, trays: 0 }, cracked: { eggs: 0, kg: 0, trays: 1 } };
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
