import test from "node:test";
import assert from "node:assert/strict";
import {
  availableSalePickups,
  saleStockIssues,
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
