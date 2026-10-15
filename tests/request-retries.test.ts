import test from "node:test";
import assert from "node:assert/strict";
import { readPendingRequestIds } from "../src/lib/request-retries";

test("retry IDs survive parsing and serialization unchanged", () => {
  const fingerprint = `user-1:${"a".repeat(64)}`;
  const requestId = "005e8767-d530-4532-83ea-d55463e299d6";
  const raw = JSON.stringify({ [fingerprint]: requestId });
  const retries = readPendingRequestIds(raw);
  assert.equal(retries[fingerprint], requestId);
  assert.equal(JSON.stringify(retries), raw);
  assert.deepEqual(readPendingRequestIds(null), {});
  assert.deepEqual(readPendingRequestIds("{}"), {});
});

test("damaged maps fail closed instead of dropping the next request ID", () => {
  for (const raw of ["[]", "[1]", "null", '"text"', "123", "true", "", "{broken"]) {
    assert.throws(() => readPendingRequestIds(raw), /Hubungi admin/);
  }
});

test("invalid stored IDs cannot be replaced silently before retrying a write", () => {
  for (const id of [null, 123, {}, [], "", "short", "a".repeat(81), "id with spaces"]) {
    assert.throws(
      () => readPendingRequestIds(JSON.stringify({ fingerprint: id })),
      /Hubungi admin/,
    );
  }
});
