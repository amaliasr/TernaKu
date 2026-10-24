import test from "node:test";
import assert from "node:assert/strict";
import { lockBodyScroll } from "../src/lib/scroll-lock";

test("nested dialog locks restore the original overflow in either unmount order", () => {
  for (const original of ["", "auto", "scroll", "hidden"]) {
    for (const parentFirst of [true, false]) {
      const body = { style: { overflow: original } };
      const releaseParent = lockBodyScroll(body);
      const releasePhoto = lockBodyScroll(body);
      const first = parentFirst ? releaseParent : releasePhoto;
      const last = parentFirst ? releasePhoto : releaseParent;
      assert.equal(body.style.overflow, "hidden");
      first();
      assert.equal(body.style.overflow, "hidden", "remaining dialog keeps its lock");
      last();
      assert.equal(body.style.overflow, original);
    }
  }
});

test("repeated cleanup cannot release another dialog's lock", () => {
  const body = { style: { overflow: "auto" } };
  const releaseParent = lockBodyScroll(body);
  const releasePhoto = lockBodyScroll(body);
  releaseParent(); releaseParent();
  assert.equal(body.style.overflow, "hidden");
  releasePhoto(); releasePhoto();
  assert.equal(body.style.overflow, "auto");
});

test("a later dialog captures the current overflow after previous locks are released", () => {
  const body = { style: { overflow: "" } };
  const discardedMount = lockBodyScroll(body);
  discardedMount();
  body.style.overflow = "scroll";
  const nextMount = lockBodyScroll(body);
  discardedMount();
  assert.equal(body.style.overflow, "hidden");
  nextMount();
  assert.equal(body.style.overflow, "scroll");
});
