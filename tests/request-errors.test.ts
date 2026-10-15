import test from "node:test";
import assert from "node:assert/strict";
import {
  ApiError,
  isUncertainWriteError,
  shouldPreserveUnconfirmedWrite,
} from "../src/lib/request-errors";

test("explicit validation and authorization rejections permit editing the form", () => {
  for (const status of [400, 401, 403, 404, 409, 422, 429]) {
    assert.equal(isUncertainWriteError(new ApiError("Rejected", status)), false);
  }
});

test("server failures and HTTP timeout require retrying the original write", () => {
  for (const status of [408, 500, 502, 503, 504]) {
    assert.equal(isUncertainWriteError(new ApiError("Unavailable", status)), true);
  }
});

test("missing or invalid responses do not prove a transaction failed", () => {
  for (const error of [
    new TypeError("Failed to fetch"),
    new DOMException("Request aborted", "AbortError"),
    new SyntaxError("Invalid JSON"),
    new Error("Data respons API tidak lengkap."),
    new ApiError("Unexpected success error envelope", 200),
    undefined,
    null,
    "Unknown failure",
  ]) {
    assert.equal(isUncertainWriteError(error), true);
  }
});

test("a later login or gateway rejection cannot discard an earlier uncertain sale", () => {
  for (const status of [401, 403, 404, 408, 429, 500, 502, 503, 504]) {
    assert.equal(
      shouldPreserveUnconfirmedWrite(new ApiError("Retry rejected", status)),
      true,
    );
  }
  assert.equal(shouldPreserveUnconfirmedWrite(new TypeError("offline")), true);
});

test("a retry rejected by application validation can be corrected after idempotency lookup", () => {
  for (const status of [400, 409, 422]) {
    assert.equal(
      shouldPreserveUnconfirmedWrite(new ApiError("Input must be corrected", status)),
      false,
    );
  }
});
