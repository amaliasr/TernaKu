import test from "node:test";
import assert from "node:assert/strict";
import { today } from "../src/lib/domain";
import { inReportRange, reportRange, reportRangeError } from "../src/lib/report-range";

test("quick report periods count inclusive WIB calendar days across months and years", () => {
  assert.deepEqual(reportRange("today", "2026-01-01"), { from: "2026-01-01", to: "2026-01-01" });
  assert.deepEqual(reportRange("yesterday", "2026-01-01"), { from: "2025-12-31", to: "2025-12-31" });
  assert.deepEqual(reportRange("7days", "2026-01-03"), { from: "2025-12-28", to: "2026-01-03" });
  assert.deepEqual(reportRange("30days", "2026-03-01"), { from: "2026-01-31", to: "2026-03-01" });
  assert.deepEqual(reportRange("30days", "2024-03-01"), { from: "2024-02-01", to: "2024-03-01" });
});

test("report dates include midnight and end of the selected WIB day without UTC drift", () => {
  const range = reportRange("today", "2026-11-08");
  assert.equal(inReportRange("2026-11-07T16:59:59Z", range), false);
  assert.equal(inReportRange("2026-11-07T17:00:00Z", range), true);
  assert.equal(inReportRange("2026-11-08T16:59:59.999Z", range), true);
  assert.equal(inReportRange("2026-11-08T17:00:00Z", range), false);
  assert.equal(inReportRange("2026-11-08", range), true);
  assert.equal(inReportRange("2026-11-08 23:59:59", range), true);
  assert.equal(inReportRange("invalid", range), false);
  assert.equal(today(new Date("2026-11-08T17:00:00Z")), "2026-11-09");
});

test("custom report periods reject incomplete, impossible, inverted and future dates", () => {
  const day = "2026-11-08";
  assert.equal(reportRangeError({ from: "2026-01-01", to: day }, day), null);
  assert.equal(reportRangeError({ from: day, to: day }, day), null);
  for (const range of [
    { from: "", to: day }, { from: day, to: "" },
    { from: "2026-02-29", to: day }, { from: "2026-11-08", to: "2026-11-07" },
    { from: day, to: "2026-11-09" }, { from: "2026-2-01", to: day },
  ]) assert.ok(reportRangeError(range, day));
});
