import assert from "node:assert/strict";
import test from "node:test";
import { employeeHistoryWindow, employeeRecords, nextJakartaDayDelay } from "../src/lib/employee-history";

const actor = { id: "me", can_check_stock: true };
const row = (id: string, date: string, user_id = "me") => ({ id, date, user_id, created_at: `${date.slice(0, 10)}T10:00:00+07:00` });

test("today lists use the transaction date in WIB and remain personal for stock checkers", () => {
  const rows = [row("yesterday", "2026-11-07"), row("today", "2026-11-08"), row("other", "2026-11-08", "other"), row("utc-today", "2026-11-07T17:00:00Z"), row("tomorrow", "2026-11-08T17:00:00Z")];
  assert.deepEqual(employeeRecords(rows, actor, { from: "2026-11-08", to: "2026-11-08" }).map(r => r.id).sort(), ["today", "utc-today"]);
});

test("history includes exactly thirty dates across month/year and leap-day boundaries", () => {
  assert.deepEqual(employeeHistoryWindow("2027-01-01"), { from: "2026-12-03", to: "2027-01-01" });
  assert.deepEqual(employeeHistoryWindow("2028-03-01"), { from: "2028-02-01", to: "2028-03-01" });
  const range = employeeHistoryWindow("2026-11-08");
  assert.deepEqual(employeeRecords([row("old", "2026-10-09"), row("first", "2026-10-10"), row("last", "2026-11-08"), row("future", "2026-11-09")], actor, range).map(r => r.id), ["last", "first"]);
});

test("team history requires checker permission and supports one employee/date range without changing source", () => {
  const rows = [row("mine", "2026-11-08"), row("other", "2026-11-07", "other")];
  const range = employeeHistoryWindow("2026-11-08");
  assert.equal(employeeRecords(rows, actor, range, "team").length, 2);
  assert.deepEqual(employeeRecords(rows, actor, range, "team", "other").map(r => r.id), ["other"]);
  assert.deepEqual(employeeRecords(rows, { id: "me" }, range, "team").map(r => r.id), ["mine"]);
  assert.deepEqual(rows.map(r => r.id), ["mine", "other"]);
  assert.deepEqual(employeeRecords(rows, actor, { from: "2026-11-08", to: "2026-11-07" }), []);
});

test("rollover timer targets midnight Jakarta independently of the device timezone", () => {
  assert.equal(nextJakartaDayDelay(new Date("2026-11-08T16:59:59.900Z")), 150);
  assert.equal(nextJakartaDayDelay(new Date("2026-11-08T17:00:00.000Z")), 86_400_050);
});
